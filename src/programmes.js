// EMS sold as structured programmes ("tracks"), not single sessions.
//  - TRACKS: the programme each package belongs to (shown to the client as their journey)
//  - Progress photos: private (client + staff), stored in R2; separate, revocable consent for anonymised marketing use
//  - 30-day progress card: one-page PDF the client and coach can download or share
//  - Weekly accountability: who needs a weekly check-in this week, and a log of contacts made

import { PDFDocument, StandardFonts, rgb } from './vendor/pdf-lib.esm.min.js';
import { clean, json } from './util.js';

const IST = 330 * 60000;
const istNow = () => new Date(Date.now() + IST);
const today = () => istNow().toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dow = d => new Date(d + 'T00:00:00Z').getUTCDay();
export const mondayOf = d => addDays(d, -((dow(d) + 6) % 7));
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const api = (data, status = 200) => json(data, status, { 'cache-control': 'no-store' });
const bad = msg => api({ ok: false, error: msg }, 400);

// weeks: programme length; checkpoints: weeks with a body-composition assessment (0 = start).
export const TRACKS = {
  transformation: { name: 'Body Transformation', tagline: 'Fat loss and toning with measurable results', weeks: 12, checkpoints: [0, 6, 12],
    focus: ['Body-composition assessment at the start, middle and end', 'Supervised EMS sessions', 'Fat-loss or toning diet guide', 'Weekly WhatsApp check-in and weigh-in'] },
  bridal: { name: '90-Day Bridal Sculpt', tagline: 'Toned, confident and camera-ready for the big day', weeks: 13, checkpoints: [0, 4, 8, 12],
    focus: ['EMS body toning: arms, back, waist and legs', 'Optional RF body contouring and skin-tightening add-ons', 'Bridal nutrition guide', 'Progress check every 4 weeks, timed to the wedding date'] },
  groom: { name: 'Groom Fit in 60 Days', tagline: 'A flatter belly and a stronger frame for the wedding', weeks: 9, checkpoints: [0, 4, 8],
    focus: ['Belly reduction and core focus', 'Chest and shoulder toning', 'Fat-loss diet guide', 'Weekly weigh-in and check-in'] },
  women: { name: "Women's Metabolic Health", tagline: 'For PCOS, thyroid-related weight gain and after pregnancy — with doctor review', weeks: 12, checkpoints: [0, 4, 8, 12],
    focus: ['Doctor review every month', 'EMS to build and keep muscle while losing fat', 'Hormone-friendly Kerala meal guide', 'Gentle, supervised progression'] },
  sports: { name: 'Performance Conditioning', tagline: 'Off-season strength, core and muscle activation for athletes', weeks: 8, checkpoints: [0, 4, 8],
    focus: ['EMS muscle activation and core strength', 'Programme planned around training and match days', 'Recovery and protein guidance', 'Strength and body-composition checks'] },
};
export const trackOf = k => (k && TRACKS[k]) ? { key: k, ...TRACKS[k] } : null;

// Where the client is in their programme (from the start of their current package).
export function journey(pkg, trackKey) {
  const t = trackOf(trackKey);
  if (!t || !pkg || !pkg.start_date) return null;
  const day = Math.max(0, daysBetween(pkg.start_date, today()));
  const week = Math.min(t.weeks, Math.floor(day / 7) + 1);
  const next = t.checkpoints.find(w => w * 7 >= day);
  return { track: t.key, name: t.name, tagline: t.tagline, focus: t.focus, weeks: t.weeks, week, day: day + 1,
    next_check: next != null ? addDays(pkg.start_date, next * 7) : null, checkpoints: t.checkpoints.map(w => ({ week: w, date: addDays(pkg.start_date, w * 7) })) };
}

// ---------- Progress photos ----------
const POSES = ['front', 'side', 'back'];
const SIGS = { jpg: [[0xff, 0xd8, 0xff], 'image/jpeg'], png: [[0x89, 0x50, 0x4e, 0x47], 'image/png'], webp: [[0x52, 0x49, 0x46, 0x46], 'image/webp'] };
const PHOTO_MAX = 6 * 1024 * 1024;

export async function uploadPhoto(env, me, clientId, request) {
  if (!env.CVS) return bad('Photo storage is not available right now.');
  const c = await env.DB.prepare("SELECT id FROM ems_clients WHERE id=? AND status != 'deleted'").bind(clientId).first();
  if (!c) return api({ ok: false, error: 'Not found' }, 404);
  let form; try { form = await request.formData(); } catch { return bad('Choose a photo to upload.'); }
  const pose = POSES.includes(form.get('pose')) ? form.get('pose') : null;
  if (!pose) return bad('Choose front, side or back.');
  const on = /^\d{4}-\d{2}-\d{2}$/.test(form.get('taken_on') || '') ? form.get('taken_on') : today();
  if (on > today()) return bad('The photo date cannot be in the future.');
  const f = form.get('photo');
  if (!f || typeof f !== 'object' || !f.size) return bad('Choose a photo to upload.');
  if (f.size > PHOTO_MAX) return bad('That photo is larger than 6 MB. Please use a smaller one.');
  const buf = new Uint8Array(await f.arrayBuffer());
  const ext = Object.keys(SIGS).find(e => SIGS[e][0].every((b, i) => buf[i] === b));
  if (!ext) return bad('Please upload a JPG, PNG or WebP photo.');
  const key = `ems-photos/${clientId}/${on}-${pose}-${crypto.randomUUID()}.${ext}`;
  await env.CVS.put(key, buf, { httpMetadata: { contentType: SIGS[ext][1] } });
  await env.DB.prepare('INSERT INTO ems_photos (client_id, taken_on, pose, r2_key, mime, uploaded_by, uploaded_by_name) VALUES (?,?,?,?,?,?,?)')
    .bind(clientId, on, pose, key, SIGS[ext][1], me.kind === 'staff' ? me.id : null, me.kind === 'staff' ? me.name : 'Client (app)').run();
  return api({ ok: true });
}

export async function listPhotos(env, clientId) {
  const { results } = await env.DB.prepare('SELECT id, taken_on, pose, uploaded_by_name, created_at FROM ems_photos WHERE client_id=? AND deleted=0 ORDER BY taken_on, id').bind(clientId).all();
  return results || [];
}

export async function servePhoto(env, clientId, id) {
  const p = await env.DB.prepare('SELECT r2_key, mime FROM ems_photos WHERE id=? AND client_id=? AND deleted=0').bind(id, clientId).first();
  if (!p || !env.CVS) return new Response('Not found', { status: 404 });
  const obj = await env.CVS.get(p.r2_key);
  if (!obj) return new Response('Not found', { status: 404 });
  return new Response(obj.body, { headers: { 'content-type': p.mime, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
}

export async function deletePhoto(env, clientId, id) {
  const p = await env.DB.prepare('SELECT r2_key FROM ems_photos WHERE id=? AND client_id=? AND deleted=0').bind(id, clientId).first();
  if (!p) return api({ ok: false, error: 'Not found' }, 404);
  if (env.CVS) await env.CVS.delete(p.r2_key);
  await env.DB.prepare('UPDATE ems_photos SET deleted=1 WHERE id=?').bind(id).run();
  return api({ ok: true });
}

// The client's own choice; staff may record a signed paper consent on their behalf.
export async function setPhotoConsent(env, clientId, on) {
  await env.DB.prepare('UPDATE ems_clients SET photo_marketing=?, photo_marketing_at=? WHERE id=?').bind(on ? 1 : 0, istNow().toISOString().slice(0, 16).replace('T', ' '), clientId).run();
  return api({ ok: true, photo_marketing: on ? 1 : 0 });
}

// ---------- Weekly accountability ----------
// Clients with an active package who have not had a weigh-in (measurement or self weigh-in) or a staff contact this week.
export async function weeklyList(env, unitIds) {
  const wk = mondayOf(today());
  const units = (unitIds || []).filter(Number.isFinite);
  const { results } = await env.DB.prepare(`SELECT c.id, c.name, c.phone, c.coach_id, s.name coach_name,
      (SELECT MAX(m.measured_on) FROM ems_measurements m WHERE m.client_id=c.id) last_weigh,
      (SELECT MAX(day) FROM ems_checkins k WHERE k.client_id=c.id) last_checkin,
      (SELECT MAX(a.start_at) FROM ems_appointments a WHERE a.client_id=c.id AND a.status='attended') last_session,
      (SELECT MIN(a.start_at) FROM ems_appointments a WHERE a.client_id=c.id AND a.status='booked' AND a.start_at >= ?) next_session,
      (SELECT w.staff_name || ' · ' || w.channel || ' · ' || substr(w.at,1,10) FROM ems_weekly_contacts w WHERE w.client_id=c.id AND w.week=? ORDER BY w.id DESC LIMIT 1) contacted
    FROM ems_clients c LEFT JOIN ems_staff s ON s.id=c.coach_id
    WHERE c.status='active' AND EXISTS (SELECT 1 FROM ems_client_packages cp WHERE cp.client_id=c.id AND cp.status='active' AND (cp.expiry_date IS NULL OR cp.expiry_date >= ?))
      ${units.length ? `AND (c.home_unit_id IS NULL OR c.home_unit_id IN (${units.join(',')}))` : ''}
    ORDER BY c.name`).bind(today() + 'T00:00', wk, today()).all();
  const list = (results || []).map(r => ({ ...r, weighed_this_week: !!(r.last_weigh && r.last_weigh >= wk), due: !(r.last_weigh && r.last_weigh >= wk) && !r.contacted }));
  return api({ ok: true, week: wk, clients: list });
}

export async function logContact(env, me, clientId, b) {
  const channel = ['whatsapp', 'call', 'in_person'].includes(b.channel) ? b.channel : 'whatsapp';
  await env.DB.prepare('INSERT INTO ems_weekly_contacts (client_id, week, staff_id, staff_name, channel, note) VALUES (?,?,?,?,?,?)')
    .bind(clientId, mondayOf(today()), me.id, me.name, channel, clean(b.note || '', 300) || null).run();
  return api({ ok: true });
}

// ---------- 30-day progress card (PDF) ----------
const n1 = v => (v == null || v === '' ? null : Math.round(Number(v) * 10) / 10);
const fmtD = d => { if (!d) return ''; const [y, m, dd] = d.split('-'); return `${+dd} ${'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')[+m - 1]} ${y}`; };

export async function progressCard(env, clientId, days = 30) {
  const c = await env.DB.prepare("SELECT id, name, gender, height_cm FROM ems_clients WHERE id=? AND status != 'deleted'").bind(clientId).first();
  if (!c) return new Response('Not found', { status: 404 });
  const { results: ms } = await env.DB.prepare('SELECT * FROM ems_measurements WHERE client_id=? ORDER BY measured_on, id').bind(clientId).all();
  const end = today(), from = addDays(end, -days);
  const all = ms || [];
  const latest = all[all.length - 1];
  const base = [...all].reverse().find(m => m.measured_on <= from) || all[0];
  const att = await env.DB.prepare("SELECT COUNT(*) n FROM ems_appointments WHERE client_id=? AND kind='session' AND status='attended' AND substr(start_at,1,10) BETWEEN ? AND ?").bind(clientId, from, end).first();
  const pk = await env.DB.prepare("SELECT cp.name, cp.start_date, p.track FROM ems_client_packages cp LEFT JOIN ems_packages p ON p.id=cp.package_id WHERE cp.client_id=? ORDER BY cp.id DESC LIMIT 1").bind(clientId).first();
  const tr = pk ? trackOf(pk.track) : null;

  const rows = [
    ['Weight', 'weight', 'kg', -1], ['Body fat', 'body_fat', '%', -1], ['Muscle mass', 'muscle_mass', 'kg', 1], ['Visceral fat level', 'visceral_fat', '', -1],
    ['Waist', 'waist', 'cm', -1], ['Belly (at navel)', 'belly', 'cm', -1], ['Hips', 'hips', 'cm', -1], ['Thigh', 'thigh', 'cm', -1], ['Upper arm', 'arm', 'cm', -1],
  ].map(([label, k, unit, good]) => {
    const a = base ? n1(base[k]) : null, b = latest ? n1(latest[k]) : null;
    if (a == null && b == null) return null;
    const d = a != null && b != null ? n1(b - a) : null;
    return { label, unit, a, b, d, tone: d == null || d === 0 ? 0 : (Math.sign(d) === good ? 1 : -1) };
  }).filter(Boolean);
  const inches = ['waist', 'belly', 'hips', 'thigh', 'arm'].reduce((s, k) => {
    const a = base ? n1(base[k]) : null, b = latest ? n1(latest[k]) : null; return a != null && b != null && b < a ? s + (a - b) : s;
  }, 0);

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const F = await pdf.embedFont(StandardFonts.Helvetica), B = await pdf.embedFont(StandardFonts.HelveticaBold);
  const TEAL = rgb(0.12, 0.31, 0.35), GREY = rgb(0.36, 0.42, 0.44), SOFT = rgb(0.93, 0.96, 0.96), GOOD = rgb(0.13, 0.5, 0.33), WARN = rgb(0.7, 0.33, 0.2);
  const t = (x, y, s, size = 10, f = F, col = rgb(0.1, 0.12, 0.13)) => page.drawText(String(s), { x, y, size, font: f, color: col });
  const safe = s => String(s).replace(/[^\x20-\x7E]/g, '');
  page.drawRectangle({ x: 0, y: 762, width: 595, height: 80, color: TEAL });
  t(40, 808, 'HASTA WELLNESS', 11, B, rgb(1, 1, 1));
  t(40, 788, `${days}-day progress card`, 20, B, rgb(1, 1, 1));
  t(40, 772, 'Doctor-supervised EMS body transformation', 9, F, rgb(0.85, 0.93, 0.93));
  t(40, 730, safe(c.name), 16, B, TEAL);
  t(40, 712, safe(`${tr ? tr.name + '  |  ' : ''}${pk ? pk.name : ''}`), 10, F, GREY);
  t(40, 696, `${base ? fmtD(base.measured_on) : '-'}  to  ${latest ? fmtD(latest.measured_on) : '-'}`, 10, F, GREY);
  // Headline tiles
  const tiles = [
    ['Weight change', rows.find(r => r.label === 'Weight')],
    ['Body fat change', rows.find(r => r.label === 'Body fat')],
    ['Inches lost', { d: n1(inches / 2.54), unit: 'in', tone: inches > 0 ? 1 : 0, raw: true }],
    ['EMS sessions', { d: att ? att.n : 0, unit: '', tone: 0, raw: true }],
  ];
  tiles.forEach(([label, r], i) => {
    const x = 40 + i * 130;
    page.drawRectangle({ x, y: 610, width: 120, height: 66, color: SOFT });
    t(x + 10, 656, label, 8.5, F, GREY);
    const v = r && r.d != null ? `${r.raw || r.d <= 0 ? '' : '+'}${r.d}${r.unit ? ' ' + r.unit : ''}` : '-';
    t(x + 10, 626, v, 20, B, r && r.tone === 1 ? GOOD : r && r.tone === -1 ? WARN : TEAL);
  });
  // Table
  let y = 580;
  t(40, y, 'Measurement', 9, B, GREY); t(260, y, 'Start', 9, B, GREY); t(350, y, 'Latest', 9, B, GREY); t(450, y, 'Change', 9, B, GREY);
  y -= 8; page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.6, color: rgb(0.8, 0.85, 0.86) });
  for (const r of rows) {
    y -= 20;
    t(40, y, r.label, 10.5); t(260, y, r.a != null ? `${r.a} ${r.unit}` : '-', 10.5); t(350, y, r.b != null ? `${r.b} ${r.unit}` : '-', 10.5);
    t(450, y, r.d != null ? `${r.d > 0 ? '+' : ''}${r.d} ${r.unit}` : '-', 10.5, B, r.tone === 1 ? GOOD : r.tone === -1 ? WARN : GREY);
  }
  if (!rows.length) { y -= 22; t(40, y, 'No measurements recorded yet. Book your body-composition assessment.', 10.5, F, GREY); }
  y -= 34;
  if (tr) {
    t(40, y, 'Your programme', 12, B, TEAL); y -= 16;
    for (const f of tr.focus) { t(48, y, safe('-  ' + f), 10, F); y -= 14; }
    y -= 10;
  }
  t(40, y, 'Keep going', 12, B, TEAL); y -= 16;
  for (const s of ['Attend your sessions as planned: consistency matters more than intensity.', 'Weigh in once a week and log water, steps and sleep in the app.', 'Tell your coach about any pain, illness, new medicine or pregnancy before a session.']) { t(48, y, '-  ' + s, 10, F); y -= 14; }
  t(40, 60, 'Readings from the clinic body-composition analyser and tape measurements. Results vary from person to person.', 8, F, GREY);
  t(40, 48, 'Hasta Wellness, a venture of HASWEL CARE Private Limited · Kazhakkoottam, Thiruvananthapuram · +91 97784 58883', 8, F, GREY);
  const bytes = await pdf.save();
  return new Response(bytes, { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="progress-card-${clientId}.pdf"`, 'cache-control': 'private, no-store' } });
}
