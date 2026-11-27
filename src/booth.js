// Outreach booth (e.g. a Technopark campaign day) for the EMS Progress Studio.
// Staff measure a visitor at the booth, show them their numbers (BMI, body fat, BMR, daily calories),
// and — with the visitor's consent — save them as a lead with their readings, so the team can follow up.
//
// Routes (EMS staff session, called from src/ems.js):
//   GET  /staff/campaigns                 campaigns with funnel numbers
//   POST /staff/campaigns                 create   · PUT /staff/campaigns/:id  edit / close
//   GET  /staff/campaigns/:id             campaign, its visitors and their follow-up state
//   POST /staff/booth                     record a booth check (anonymous if no consent)
//   PUT  /staff/booth/:id                 mark the WhatsApp report as sent
import { json, clean, nz, normalisePhone } from './util.js';
import { bodyComp, nutritionTargets, ACTIVITY, AIMS } from '../public/ems/body.js';

const bad = msg => json({ ok: false, error: msg }, 400);
const ok = data => json({ ok: true, ...data });
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const last10 = p => String(p || '').replace(/\D/g, '').slice(-10);
function num(v, min, max) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return undefined;
  return Math.round(n * 10) / 10;
}

export const CONCERNS = {
  weight: 'Lose weight', belly: 'Belly fat', tone: 'Tone up / firm', energy: 'Low energy / tired',
  sleep: 'Poor sleep', stress: 'Stress', back: 'Back / neck pain from sitting', diet: 'Eat better / diet plan',
};
const INTEREST = ['now', 'later', 'no'];

// How warm the lead is. Hot = wants a trial or consultation now. Warm = later, or said no but the readings
// show a clear reason to follow up. Cold = no, and nothing stands out.
export function heatOf(interest, comp) {
  if (interest === 'now') return 'hot';
  const flag = (comp.bf && comp.bf.band && comp.bf.band.label === 'High') || (comp.ratios.bmi && comp.ratios.bmi.value >= 25) || (comp.visceral && comp.visceral.value >= 10);
  if (interest === 'later' || flag) return 'warm';
  return 'cold';
}

// Work out the numbers shown to the visitor. Same formulas as the client's body-composition page.
export function compute(v) {
  const year = new Date().getUTCFullYear();
  const comp = bodyComp({ gender: v.gender, birth_year: v.age ? year - v.age : null, height_cm: v.height_cm }, v, `${year}-07-01`);
  const nt = nutritionTargets(comp, { activity: v.activity, aim: v.aim }, null);
  return { comp, nt };
}

export async function campaigns(env) {
  const { results } = await env.DB.prepare(`SELECT c.*,
      (SELECT COUNT(*) FROM lead_screenings s WHERE s.campaign_id=c.id) checks,
      (SELECT COUNT(DISTINCT lead_id) FROM lead_screenings s WHERE s.campaign_id=c.id AND s.lead_id>0) leads,
      (SELECT COUNT(DISTINCT lead_id) FROM lead_screenings s WHERE s.campaign_id=c.id AND s.heat='hot' AND s.lead_id>0) hot,
      (SELECT COUNT(DISTINCT lead_id) FROM lead_screenings s WHERE s.campaign_id=c.id AND s.heat='warm' AND s.lead_id>0) warm,
      (SELECT COUNT(*) FROM leads l WHERE l.campaign_id=c.id AND l.status='booked') booked,
      (SELECT COUNT(DISTINCT e.id) FROM ems_clients e JOIN lead_screenings s ON s.lead_id=e.lead_id WHERE s.campaign_id=c.id AND s.lead_id>0 AND e.status!='deleted') clients
    FROM ems_campaigns c ORDER BY c.active DESC, c.start_day DESC LIMIT 50`).all();
  return results || [];
}

function readCampaign(b) {
  const name = clean(b.name, 80), start = isDate(b.start_day) ? b.start_day : null;
  if (!name || !start) return { err: 'Enter a name and the start date.' };
  const end = isDate(b.end_day) && b.end_day >= start ? b.end_day : start;
  const days = Math.min(60, Math.max(1, parseInt(b.offer_days, 10) || 14));
  return { f: { name, place: nz(clean(b.place, 120)), start_day: start, end_day: end, offer: nz(clean(b.offer, 300)), offer_days: days, unit_id: parseInt(b.unit_id, 10) || null } };
}

export async function saveCampaign(env, me, id, b) {
  if (id && b.active !== undefined && Object.keys(b).length === 1) {
    await env.DB.prepare('UPDATE ems_campaigns SET active=? WHERE id=?').bind(b.active ? 1 : 0, id).run();
    return ok({});
  }
  const { f, err } = readCampaign(b);
  if (err) return bad(err);
  if (id) {
    await env.DB.prepare('UPDATE ems_campaigns SET name=?, place=?, start_day=?, end_day=?, offer=?, offer_days=?, unit_id=? WHERE id=?')
      .bind(f.name, f.place, f.start_day, f.end_day, f.offer, f.offer_days, f.unit_id, id).run();
    return ok({ id });
  }
  const r = await env.DB.prepare('INSERT INTO ems_campaigns (name, place, start_day, end_day, offer, offer_days, unit_id, created_by) VALUES (?,?,?,?,?,?,?,?)')
    .bind(f.name, f.place, f.start_day, f.end_day, f.offer, f.offer_days, f.unit_id, me.id).run();
  return ok({ id: r.meta.last_row_id });
}

export async function campaignDetail(env, id) {
  const c = await env.DB.prepare('SELECT * FROM ems_campaigns WHERE id=?').bind(id).first();
  if (!c) return json({ ok: false, error: 'Not found' }, 404);
  const { results } = await env.DB.prepare(`SELECT s.*, l.name, l.phone, l.status lead_status, l.notes lead_notes,
      (SELECT id FROM ems_clients e WHERE e.lead_id=l.id AND e.status!='deleted') client_id,
      (SELECT MIN(start_at) FROM ems_appointments a WHERE a.lead_id=l.id AND a.status IN ('booked','attended')) booked_at,
      (SELECT MAX(a.status='attended') FROM ems_appointments a WHERE a.lead_id=l.id) attended,
      (SELECT COUNT(*) FROM ems_reminder_log r WHERE r.lead_id=l.id) contacts,
      (SELECT group_concat(r.ref) FROM ems_reminder_log r WHERE r.lead_id=l.id AND r.kind='booth') done_refs,
      st.name staff_name
    FROM lead_screenings s LEFT JOIN leads l ON l.id=s.lead_id LEFT JOIN ems_staff st ON st.id=s.staff_id
    WHERE s.campaign_id=? ORDER BY s.id DESC LIMIT 500`).bind(id).all();
  const rows = (results || []).map(r => ({ ...r, concerns: (() => { try { return JSON.parse(r.concerns || '[]'); } catch { return []; } })() }));
  return ok({ campaign: c, visitors: rows });
}

export async function boothCheck(env, me, b) {
  const campaignId = parseInt(b.campaign_id, 10);
  const c = campaignId ? await env.DB.prepare('SELECT * FROM ems_campaigns WHERE id=?').bind(campaignId).first() : null;
  if (!c) return bad('Choose the campaign first.');
  const v = {
    gender: b.gender === 'male' || b.gender === 'female' ? b.gender : null,
    age: num(b.age, 16, 90), height_cm: num(b.height_cm, 120, 220), weight: num(b.weight, 30, 250),
    body_fat: num(b.body_fat, 3, 70), muscle_mass: num(b.muscle_mass, 5, 150), visceral_fat: num(b.visceral_fat, 1, 59),
    water_pct: num(b.water_pct, 25, 80), metabolic_age: num(b.metabolic_age, 10, 100), waist: num(b.waist, 40, 250), bmr: num(b.bmr, 600, 4000),
    sleep_hours: num(b.sleep_hours, 2, 14),
  };
  const badKey = Object.entries(v).find(([, x]) => x === undefined);
  if (badKey) return bad(`"${badKey[0].replace('_', ' ')}" looks out of range. Check kg, cm and %.`);
  if (!v.gender || !v.age || !v.height_cm || !v.weight) return bad('Enter sex, age, height and weight.');
  v.activity = ACTIVITY[b.activity] ? b.activity : 'sedentary';
  v.aim = AIMS[b.aim] ? b.aim : null;
  const energy = Math.min(5, Math.max(1, parseInt(b.energy, 10) || 0)) || null;
  const concerns = (Array.isArray(b.concerns) ? b.concerns : []).filter(k => CONCERNS[k]).slice(0, 8);
  const interest = INTEREST.includes(b.interest) ? b.interest : 'later';
  const { comp, nt } = compute(v);
  const heat = heatOf(interest, comp);
  const consent = b.consent === true;
  let leadId = 0, reused = false;
  if (consent) {
    const name = clean(b.name, 80), phone = normalisePhone(b.phone);
    if (name.length < 2 || !phone) return bad('Enter the visitor\'s name and a valid mobile number, or untick consent to show the results without saving them.');
    const concernText = concerns.map(k => CONCERNS[k]).join(', ');
    const prev = await env.DB.prepare("SELECT id FROM leads WHERE substr(replace(phone,'+',''),-10)=? AND created_at > strftime('%Y-%m-%dT%H:%M:%SZ','now','-30 days') ORDER BY id DESC LIMIT 1").bind(last10(phone)).first();
    if (prev) {
      leadId = prev.id; reused = true;
      await env.DB.prepare("UPDATE leads SET name=?, campaign_id=COALESCE(campaign_id, ?), concern=COALESCE(?, concern), timing=COALESCE(?, timing), status=CASE WHEN status='not interested' AND ?='hot' THEN 'new' ELSE status END, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?")
        .bind(name, c.id, nz(concernText), nz(clean(b.best_time, 60)), heat, leadId).run();
    } else {
      const r = await env.DB.prepare("INSERT INTO leads (source, request_type, name, phone, interest, concern, timing, page, channel, unit_id, campaign_id, status, notes) VALUES ('booth','Body check',?,?,'EMS & Weight Management',?,?,?,'event',?,?,'new',?)")
        .bind(name, phone, nz(concernText), nz(clean(b.best_time, 60)), c.name, c.unit_id, c.id, `Booth ${heat}: wants trial ${interest}`).run();
      leadId = r.meta.last_row_id;
    }
  }
  // Without consent nothing identifying is kept: only sex, age band and readings, for the day's numbers.
  const r = await env.DB.prepare(`INSERT INTO lead_screenings (lead_id, campaign_id, gender, age, height_cm, weight, body_fat, muscle_mass, visceral_fat, water_pct, metabolic_age, waist,
      bmi, bmr, bmr_source, tdee, kcal_target, activity, aim, concerns, sleep_hours, energy, interest, heat, best_time, device, consent_contact, staff_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(leadId, c.id, v.gender, consent ? v.age : Math.floor(v.age / 10) * 10, v.height_cm, v.weight, v.body_fat, v.muscle_mass, v.visceral_fat, v.water_pct, v.metabolic_age, v.waist,
      comp.ratios.bmi ? comp.ratios.bmi.value : null, comp.bmr ? comp.bmr.value : null, comp.bmr ? comp.bmr.source : null, nt ? nt.tdee : null, nt ? nt.kcal : null,
      v.activity, nt ? nt.aim : v.aim, JSON.stringify(concerns), v.sleep_hours, energy, interest, heat, consent ? nz(clean(b.best_time, 60)) : null, nz(clean(b.device, 60)), consent ? 1 : 0, me.id).run();
  return ok({ id: r.meta.last_row_id, lead_id: leadId || null, reused, heat, comp, nt });
}

export async function markBooth(env, id, b) {
  if (b.wa_sent) await env.DB.prepare('UPDATE lead_screenings SET wa_sent=1 WHERE id=?').bind(id).run();
  return ok({});
}

// When a booth lead becomes a client: fill in sex / age / height and copy the booth reading as their first measurement.
export async function seedClientFromBooth(env, clientId, leadId) {
  const s = await env.DB.prepare('SELECT * FROM lead_screenings WHERE lead_id=? ORDER BY id DESC LIMIT 1').bind(leadId).first();
  if (!s) return;
  const year = new Date().getUTCFullYear();
  await env.DB.prepare('UPDATE ems_clients SET gender=COALESCE(gender, ?), birth_year=COALESCE(birth_year, ?), height_cm=COALESCE(height_cm, ?) WHERE id=?')
    .bind(s.gender, s.age ? year - s.age : null, s.height_cm, clientId).run();
  await env.DB.prepare('INSERT INTO ems_measurements (client_id, measured_on, weight, waist, body_fat, muscle_mass, water_pct, visceral_fat, bmr, metabolic_age, device, notes, staff_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(clientId, s.created_at.slice(0, 10), s.weight, s.waist, s.body_fat, s.muscle_mass, s.water_pct, s.visceral_fat, s.bmr_source === 'Analyser' ? s.bmr : null, s.metabolic_age, s.device || 'Booth', 'Baseline from the outreach booth check', s.staff_id).run();
}

// Daily: booth readings go with their lead (90-day lead clean-up); anonymous ones after 90 days.
export async function purgeBooth(env, days) {
  await env.DB.prepare("DELETE FROM lead_screenings WHERE (lead_id > 0 AND lead_id NOT IN (SELECT id FROM leads) AND lead_id NOT IN (SELECT lead_id FROM ems_clients WHERE lead_id IS NOT NULL)) OR (lead_id = 0 AND created_at < strftime('%Y-%m-%dT%H:%M:%SZ','now', ?))").bind(`-${days} days`).run();
}
