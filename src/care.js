// Hasta Clinic — care records (phase 2).
// Visit notes (with vitals and prescription, PDF), dental chart (FDI numbering), treatment plans that
// turn into a draft bill, recalls / follow-ups, and clinical photos stored privately in R2.
// Clinical content (notes, chart, photos) is visible only to clinicians: doctors, nurses, dental assistants
// and admins. Plans and recalls are visible to every clinic user (front desk books and bills them).
import { PDFDocument, StandardFonts, rgb } from './vendor/pdf-lib.esm.min.js';
import { json, clean, nz } from './util.js';
import { settings, createInvoiceWithLines } from './clinic.js';

const IST = 330 * 60000;
const today = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString().slice(0, 19) + 'Z';
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const r2 = x => Math.round((Number(x) || 0) * 100) / 100;
const parse = (s, f) => { try { return s ? JSON.parse(s) : f; } catch { return f; } };
const HEADERS = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'x-content-type-options': 'nosniff' };
const api = (data, status = 200) => json(data, status, HEADERS);
const done = ([status, error, extra]) => status === 200 ? api({ ok: true, ...(extra || {}) }) : api({ ok: false, error, ...(extra || {}) }, status);
const R = (s, e, x) => [s, e, x];
const OK = x => [200, null, x];
const canManage = u => u.admin || u.role === 'manager';
export const canClinical = u => u.admin || u.skills.some(s => ['doctor', 'nurse', 'dental_assistant', 'medical_lead'].includes(s));
const noClin = () => api({ ok: false, error: 'Clinical records are open to doctors, nurses and dental assistants only.' }, 403);
const TEETH = new Set([...[1, 2, 3, 4].flatMap(q => [1, 2, 3, 4, 5, 6, 7, 8].map(n => `${q}${n}`)), ...[5, 6, 7, 8].flatMap(q => [1, 2, 3, 4, 5].map(n => `${q}${n}`))]);
export const CONDITIONS = ['caries', 'filled', 'rct', 'crown', 'bridge', 'implant', 'missing', 'extraction', 'fractured', 'mobile', 'impacted', 'veneer', 'sensitivity', 'stain', 'other'];
const SURF = ['M', 'O', 'D', 'B', 'L', 'I'];
const LOCK_HOURS = 24;
const PHOTO_MAX = 4 * 1024 * 1024;

async function audit(env, me, action, entity, id, detail) {
  await env.DB.prepare('INSERT INTO cl_audit (staff_id, staff_name, action, entity, entity_id, detail) VALUES (?,?,?,?,?,?)').bind(me.id, me.name, action, entity, id || null, detail ? String(detail).slice(0, 500) : null).run();
}
const patientOk = async (env, id) => !!(await env.DB.prepare("SELECT 1 FROM cl_patients WHERE id=? AND status='active'").bind(id).first());

/* ---------------- router ---------------- */
export async function careRoute(request, env, me, p, m, b, q) {
  let r;
  if ((r = p.match(/^\/care\/(\d+)$/)) && m === 'GET') return api({ ok: true, ...(await careFor(env, me, +r[1])) });

  if (p === '/notes' && m === 'POST') { if (!canClinical(me)) return noClin(); return done(await saveNote(env, me, null, b)); }
  if ((r = p.match(/^\/notes\/(\d+)$/)) && m === 'PUT') { if (!canClinical(me)) return noClin(); return done(await saveNote(env, me, +r[1], b)); }
  if ((r = p.match(/^\/notes\/(\d+)\/addendum$/)) && m === 'POST') { if (!canClinical(me)) return noClin(); return done(await addAddendum(env, me, +r[1], b)); }
  if ((r = p.match(/^\/notes\/(\d+)\/rx$/)) && m === 'GET') { if (!canClinical(me)) return noClin(); return rxPdf(env, request, +r[1]); }

  if (p === '/chart' && m === 'POST') { if (!canClinical(me)) return noClin(); return done(await addChart(env, me, b)); }
  if ((r = p.match(/^\/chart\/(\d+)$/)) && m === 'PUT') { if (!canClinical(me)) return noClin(); return done(await updateChart(env, me, +r[1], b)); }

  if (p === '/plans' && m === 'POST') { if (!canClinical(me)) return noClin(); return done(await savePlan(env, me, null, b)); }
  if ((r = p.match(/^\/plans\/(\d+)$/)) && m === 'PUT') { if (!canClinical(me)) return noClin(); return done(await savePlan(env, me, +r[1], b)); }
  if ((r = p.match(/^\/plans\/(\d+)\/status$/)) && m === 'POST') return done(await planStatus(env, me, +r[1], b));
  if ((r = p.match(/^\/plans\/(\d+)\/bill$/)) && m === 'POST') return done(await billPlan(env, me, +r[1], b));
  if ((r = p.match(/^\/plan-items\/(\d+)\/done$/)) && m === 'POST') { if (!canClinical(me)) return noClin(); return done(await itemDone(env, me, +r[1], b)); }

  if (p === '/recalls' && m === 'GET') return api({ ok: true, recalls: await recallList(env, q('scope') || 'due') });
  if (p === '/recalls' && m === 'POST') return done(await addRecall(env, me, b));
  if ((r = p.match(/^\/recalls\/(\d+)$/)) && m === 'PUT') return done(await updateRecall(env, me, +r[1], b));

  if ((r = p.match(/^\/photos\/(\d+)$/)) && m === 'GET') { if (!canClinical(me)) return noClin(); return photoFile(env, +r[1]); }
  if ((r = p.match(/^\/photos\/(\d+)$/)) && m === 'DELETE') { if (!canClinical(me)) return noClin(); return done(await deletePhoto(env, me, +r[1])); }
  return null;
}

/* ---------------- patient care summary ---------------- */
async function careFor(env, me, pid) {
  const clin = canClinical(me);
  const [plans, items, recalls] = await Promise.all([
    env.DB.prepare('SELECT * FROM cl_plans WHERE patient_id=? ORDER BY id DESC').bind(pid).all(),
    env.DB.prepare(`SELECT pi.*, i.status inv_status, i.invoice_no FROM cl_plan_items pi JOIN cl_plans pl ON pl.id=pi.plan_id LEFT JOIN cl_invoices i ON i.id=pi.invoice_id WHERE pl.patient_id=? ORDER BY pi.plan_id, pi.stage, pi.sort, pi.id`).bind(pid).all(),
    env.DB.prepare('SELECT * FROM cl_recalls WHERE patient_id=? ORDER BY due_date DESC LIMIT 50').bind(pid).all(),
  ]);
  const its = (items.results || []).map(x => ({ ...x, billed: !!(x.invoice_id && x.inv_status && x.inv_status !== 'cancelled') }));
  const out = {
    clinical: clin,
    plans: (plans.results || []).map(pl => { const li = its.filter(x => x.plan_id === pl.id); return { ...pl, items: li, total: r2(li.reduce((s, x) => s + x.qty * x.unit_price - x.discount, 0)), billed_total: r2(li.filter(x => x.billed).reduce((s, x) => s + x.qty * x.unit_price - x.discount, 0)) }; }),
    recalls: recalls.results || [],
  };
  if (!clin) return out;
  const [notes, chart, photos] = await Promise.all([
    env.DB.prepare('SELECT n.*, d.name dept_name FROM cl_notes n LEFT JOIN cl_departments d ON d.id=n.dept_id WHERE n.patient_id=? ORDER BY n.visit_date DESC, n.id DESC LIMIT 200').bind(pid).all(),
    env.DB.prepare('SELECT * FROM cl_dental_chart WHERE patient_id=? AND active=1 ORDER BY tooth, id').bind(pid).all(),
    env.DB.prepare('SELECT id, note_id, tag, area, caption, taken_on, uploaded_by_name, created_at FROM cl_photos WHERE patient_id=? ORDER BY COALESCE(taken_on, substr(created_at,1,10)) DESC, id DESC').bind(pid).all(),
  ]);
  const lockedAt = n => new Date(Date.parse(n.created_at) + LOCK_HOURS * 3600e3).toISOString();
  out.notes = (notes.results || []).map(n => ({ ...n, vitals: parse(n.vitals, {}), rx: parse(n.rx, []), addenda: parse(n.addenda, []), editable: n.author_id === me.id && nowIso() < lockedAt(n) }));
  out.chart = chart.results || [];
  out.photos = photos.results || [];
  return out;
}

/* ---------------- visit notes ---------------- */
function noteFields(b) {
  const v = b.vitals || {};
  const vitals = { bp: clean(v.bp, 12), pulse: clean(v.pulse, 6), weight: clean(v.weight, 8), spo2: clean(v.spo2, 6), temp: clean(v.temp, 8) };
  const rx = (Array.isArray(b.rx) ? b.rx : []).slice(0, 20).map(x => ({ name: clean(x.name, 120), dose: clean(x.dose, 40), freq: clean(x.freq, 40), days: clean(x.days, 20), note: clean(x.note, 120) })).filter(x => x.name);
  return {
    complaint: nz(clean(b.complaint, 1000)), history: nz(clean(b.history, 2000)), findings: nz(clean(b.findings, 3000)),
    diagnosis: nz(clean(b.diagnosis, 1000)), treatment: nz(clean(b.treatment, 3000)), advice: nz(clean(b.advice, 1500)),
    vitals: Object.values(vitals).some(Boolean) ? JSON.stringify(vitals) : null, rx: rx.length ? JSON.stringify(rx) : null,
    review_date: isDate(b.review_date) ? b.review_date : null, review_note: nz(clean(b.review_note, 200)),
  };
}
async function saveNote(env, me, id, b) {
  const f = noteFields(b);
  if (![f.complaint, f.findings, f.diagnosis, f.treatment, f.advice, f.rx].some(Boolean)) return R(400, 'Write at least the complaint, findings, diagnosis or treatment.');
  if (f.review_date && f.review_date < today()) return R(400, 'The review date has already passed.');
  let note;
  if (id) {
    note = await env.DB.prepare('SELECT * FROM cl_notes WHERE id=?').bind(id).first();
    if (!note) return R(404, 'Not found.');
    if (note.author_id !== me.id) return R(403, 'Only the clinician who wrote this note can change it. Add an addendum instead.');
    if (nowIso() > new Date(Date.parse(note.created_at) + LOCK_HOURS * 3600e3).toISOString()) return R(403, `Notes are locked ${LOCK_HOURS} hours after writing. Add an addendum instead.`);
    await env.DB.prepare('UPDATE cl_notes SET complaint=?, history=?, findings=?, diagnosis=?, treatment=?, advice=?, vitals=?, rx=?, review_date=?, review_note=?, updated_at=? WHERE id=?')
      .bind(f.complaint, f.history, f.findings, f.diagnosis, f.treatment, f.advice, f.vitals, f.rx, f.review_date, f.review_note, nowIso(), id).run();
  } else {
    const pid = parseInt(b.patient_id, 10);
    if (!(await patientOk(env, pid))) return R(400, 'Choose the patient.');
    const apptId = parseInt(b.appointment_id, 10) || null;
    let dept = parseInt(b.dept_id, 10) || null, vdate = isDate(b.visit_date) && b.visit_date <= today() ? b.visit_date : today();
    if (apptId) {
      const a = await env.DB.prepare('SELECT * FROM cl_appointments WHERE id=? AND patient_id=?').bind(apptId, pid).first();
      if (!a) return R(400, 'That appointment is not for this patient.');
      dept = dept || a.dept_id; vdate = a.start_at.slice(0, 10);
    }
    id = (await env.DB.prepare('INSERT INTO cl_notes (patient_id, appointment_id, dept_id, visit_date, complaint, history, findings, diagnosis, treatment, advice, vitals, rx, review_date, review_note, author_id, author_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(pid, apptId, dept, vdate, f.complaint, f.history, f.findings, f.diagnosis, f.treatment, f.advice, f.vitals, f.rx, f.review_date, f.review_note, me.id, me.name).run()).meta.last_row_id;
    note = { id, patient_id: pid, dept_id: dept };
  }
  // A review date on the note becomes (or updates) the recall for the front desk.
  const ex = await env.DB.prepare("SELECT id FROM cl_recalls WHERE note_id=? AND status='open'").bind(id).first();
  if (f.review_date) {
    const reason = f.review_note || 'Review';
    if (ex) await env.DB.prepare('UPDATE cl_recalls SET due_date=?, reason=?, updated_at=? WHERE id=?').bind(f.review_date, reason, nowIso(), ex.id).run();
    else await env.DB.prepare('INSERT INTO cl_recalls (patient_id, due_date, reason, dept_id, note_id, created_by, created_by_name) VALUES (?,?,?,?,?,?,?)').bind(note.patient_id, f.review_date, reason, note.dept_id, id, me.id, me.name).run();
  } else if (ex) await env.DB.prepare("UPDATE cl_recalls SET status='dismissed', outcome='Review removed from note', updated_at=? WHERE id=?").bind(nowIso(), ex.id).run();
  await audit(env, me, 'note.save', 'patient', note.patient_id, `note ${id}`);
  return OK({ id });
}
async function addAddendum(env, me, id, b) {
  const text = clean(b.text, 1500);
  if (text.length < 3) return R(400, 'Write the addendum.');
  const n = await env.DB.prepare('SELECT addenda, patient_id FROM cl_notes WHERE id=?').bind(id).first();
  if (!n) return R(404, 'Not found.');
  const list = parse(n.addenda, []); list.push({ at: nowIso(), by: me.name, text });
  await env.DB.prepare('UPDATE cl_notes SET addenda=? WHERE id=?').bind(JSON.stringify(list), id).run();
  await audit(env, me, 'note.addendum', 'patient', n.patient_id, `note ${id}`);
  return OK();
}

/* ---------------- dental chart ---------------- */
async function addChart(env, me, b) {
  const pid = parseInt(b.patient_id, 10);
  if (!(await patientOk(env, pid))) return R(400, 'Choose the patient.');
  const teeth = (Array.isArray(b.teeth) ? b.teeth : [b.tooth]).map(String).filter(t => TEETH.has(t));
  if (!teeth.length) return R(400, 'Choose the tooth.');
  if (!CONDITIONS.includes(b.condition)) return R(400, 'Choose the condition.');
  const status = ['existing', 'planned', 'done'].includes(b.status) ? b.status : 'existing';
  const surfaces = (Array.isArray(b.surfaces) ? b.surfaces : []).filter(s => SURF.includes(s)).join('') || null;
  for (const t of teeth) await env.DB.prepare('INSERT INTO cl_dental_chart (patient_id, tooth, surfaces, condition, status, note, recorded_by, recorded_by_name) VALUES (?,?,?,?,?,?,?,?)')
    .bind(pid, t, surfaces, b.condition, status, nz(clean(b.note, 200)), me.id, me.name).run();
  await audit(env, me, 'chart.add', 'patient', pid, `${teeth.join(',')} ${b.condition} ${status}`);
  return OK();
}
async function updateChart(env, me, id, b) {
  const c = await env.DB.prepare('SELECT * FROM cl_dental_chart WHERE id=?').bind(id).first();
  if (!c) return R(404, 'Not found.');
  if (b.remove) await env.DB.prepare('UPDATE cl_dental_chart SET active=0, updated_at=? WHERE id=?').bind(nowIso(), id).run();
  else if (['existing', 'planned', 'done'].includes(b.status)) await env.DB.prepare('UPDATE cl_dental_chart SET status=?, updated_at=? WHERE id=?').bind(b.status, nowIso(), id).run();
  else return R(400, 'Nothing to change.');
  await audit(env, me, 'chart.update', 'patient', c.patient_id, `${c.tooth} ${c.condition} → ${b.remove ? 'removed' : b.status}`);
  return OK();
}

/* ---------------- treatment plans ---------------- */
async function savePlan(env, me, id, b) {
  const title = clean(b.title, 120);
  if (title.length < 2) return R(400, 'Give the plan a title (e.g. Full mouth rehabilitation).');
  const raw = (Array.isArray(b.items) ? b.items : []).slice(0, 60);
  let pid, existing = [];
  if (id) {
    const pl = await env.DB.prepare('SELECT * FROM cl_plans WHERE id=?').bind(id).first();
    if (!pl) return R(404, 'Not found.');
    if (['completed', 'cancelled'].includes(pl.status)) return R(400, 'This plan is closed.');
    pid = pl.patient_id;
    existing = (await env.DB.prepare('SELECT pi.*, i.status inv_status FROM cl_plan_items pi LEFT JOIN cl_invoices i ON i.id=pi.invoice_id WHERE plan_id=?').bind(id).all()).results || [];
  } else {
    pid = parseInt(b.patient_id, 10);
    if (!(await patientOk(env, pid))) return R(400, 'Choose the patient.');
  }
  const locked = existing.filter(x => x.done || (x.invoice_id && x.inv_status && x.inv_status !== 'cancelled'));
  const keepIds = new Set(locked.map(x => x.id));
  const rows = [];
  let sort = 0;
  for (const l of raw) {
    if (l.id && keepIds.has(+l.id)) continue; // billed or done lines stay as they are
    const it = await env.DB.prepare('SELECT id, name, kind, price, sellable FROM cl_items WHERE id=?').bind(parseInt(l.item_id, 10)).first();
    if (!it || !it.sellable) return R(400, 'One of the lines is not a billable catalogue item.');
    const qty = Math.max(1, Math.min(99, parseInt(l.qty, 10) || 1)), price = l.unit_price === '' || l.unit_price == null ? it.price : r2(l.unit_price), disc = r2(l.discount || 0);
    if (!(price >= 0) || disc < 0 || disc > qty * price) return R(400, `Check the price and discount for ${it.name}.`);
    const tooth = clean(l.tooth, 30);
    rows.push([it.id, it.name, nz(tooth), qty, price, disc, Math.max(1, Math.min(9, parseInt(l.stage, 10) || 1)), nz(clean(l.note, 200)), sort++]);
  }
  if (!rows.length && !locked.length) return R(400, 'Add at least one treatment to the plan.');
  if (id) {
    await env.DB.prepare('UPDATE cl_plans SET title=?, dept_id=?, notes=? WHERE id=?').bind(title, parseInt(b.dept_id, 10) || null, nz(clean(b.notes, 500)), id).run();
    for (const x of existing) if (!keepIds.has(x.id)) await env.DB.prepare('DELETE FROM cl_plan_items WHERE id=?').bind(x.id).run();
  } else {
    id = (await env.DB.prepare('INSERT INTO cl_plans (patient_id, title, dept_id, notes, created_by, created_by_name) VALUES (?,?,?,?,?,?)').bind(pid, title, parseInt(b.dept_id, 10) || null, nz(clean(b.notes, 500)), me.id, me.name).run()).meta.last_row_id;
  }
  for (const rw of rows) await env.DB.prepare('INSERT INTO cl_plan_items (plan_id, item_id, name, tooth, qty, unit_price, discount, stage, note, sort) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(id, ...rw).run();
  await audit(env, me, 'plan.save', 'patient', pid, `${title} (${id})`);
  return OK({ id });
}
async function planStatus(env, me, id, b) {
  const pl = await env.DB.prepare('SELECT * FROM cl_plans WHERE id=?').bind(id).first();
  if (!pl) return R(404, 'Not found.');
  const to = b.status;
  if (to === 'accepted' && pl.status === 'proposed') await env.DB.prepare("UPDATE cl_plans SET status='accepted', accepted_at=? WHERE id=?").bind(nowIso(), id).run();
  else if (to === 'completed' && pl.status === 'accepted') await env.DB.prepare("UPDATE cl_plans SET status='completed' WHERE id=?").bind(id).run();
  else if (to === 'cancelled' && ['proposed', 'accepted'].includes(pl.status)) {
    if (!canClinical(me) && !canManage(me)) return R(403, 'Only a clinician or manager can cancel a plan.');
    await env.DB.prepare("UPDATE cl_plans SET status='cancelled', notes=? WHERE id=?").bind([pl.notes, clean(b.reason, 200) && 'Cancelled: ' + clean(b.reason, 200)].filter(Boolean).join(' · ') || null, id).run();
  } else return R(400, 'That change is not possible for this plan.');
  await audit(env, me, 'plan.' + to, 'patient', pl.patient_id, pl.title);
  return OK();
}
// Turn the chosen plan lines into a draft bill (the front desk finalises it as usual).
async function billPlan(env, me, id, b) {
  const pl = await env.DB.prepare('SELECT * FROM cl_plans WHERE id=?').bind(id).first();
  if (!pl) return R(404, 'Not found.');
  if (pl.status === 'cancelled' || pl.status === 'proposed') return R(400, pl.status === 'proposed' ? 'Mark the plan as accepted by the patient before billing it.' : 'This plan is cancelled.');
  const ids = (Array.isArray(b.item_ids) ? b.item_ids : []).map(Number);
  const { results } = await env.DB.prepare('SELECT pi.*, i.status inv_status FROM cl_plan_items pi LEFT JOIN cl_invoices i ON i.id=pi.invoice_id WHERE pi.plan_id=?').bind(id).all();
  const pick = (results || []).filter(x => ids.includes(x.id) && !(x.invoice_id && x.inv_status && x.inv_status !== 'cancelled'));
  if (!pick.length) return R(400, 'Choose the treatments to bill (ones not already billed).');
  const lines = pick.map(x => ({ item_id: x.item_id, qty: x.qty, unit_price: x.unit_price, discount: x.discount, discount_reason: x.discount ? `As per treatment plan: ${pl.title}`.slice(0, 120) : null, doctor_id: parseInt(b.doctor_id, 10) || pl.created_by }));
  const res = await createInvoiceWithLines(env, me, pl.patient_id, lines, b.authoriser);
  if (res[0] !== 200) return res;
  const invId = res[2].id;
  for (const x of pick) await env.DB.prepare('UPDATE cl_plan_items SET invoice_id=? WHERE id=?').bind(invId, x.id).run();
  if (pl.status === 'accepted') { /* stays accepted until marked complete */ }
  await audit(env, me, 'plan.bill', 'patient', pl.patient_id, `${pl.title}: ${pick.length} lines → invoice ${invId}`);
  return OK({ invoice_id: invId });
}
async function itemDone(env, me, id, b) {
  const x = await env.DB.prepare('SELECT pi.*, pl.patient_id FROM cl_plan_items pi JOIN cl_plans pl ON pl.id=pi.plan_id WHERE pi.id=?').bind(id).first();
  if (!x) return R(404, 'Not found.');
  const d = b.done !== false;
  await env.DB.prepare('UPDATE cl_plan_items SET done=?, done_at=? WHERE id=?').bind(d ? 1 : 0, d ? today() : null, id).run();
  await audit(env, me, 'plan.item_done', 'patient', x.patient_id, `${x.name} ${d ? 'done' : 'not done'}`);
  return OK();
}

/* ---------------- recalls ---------------- */
export async function recallList(env, scope) {
  const where = scope === 'due' ? "r.status='open' AND r.due_date <= ?" : scope === 'upcoming' ? "r.status='open'" : '1=1';
  const bind = scope === 'due' ? [addDays(today(), 7)] : [];
  const { results } = await env.DB.prepare(`SELECT r.*, p.name patient_name, p.patient_no, p.phone patient_phone, d.name dept_name,
      (SELECT MIN(start_at) FROM cl_appointments a WHERE a.patient_id=r.patient_id AND a.status IN ('booked','arrived') AND a.start_at >= ?) next_appt
    FROM cl_recalls r JOIN cl_patients p ON p.id=r.patient_id LEFT JOIN cl_departments d ON d.id=r.dept_id WHERE ${where} ORDER BY r.due_date LIMIT 200`).bind(today(), ...bind).all();
  return results || [];
}
async function addRecall(env, me, b) {
  const pid = parseInt(b.patient_id, 10);
  if (!(await patientOk(env, pid))) return R(400, 'Choose the patient.');
  if (!isDate(b.due_date)) return R(400, 'Choose when to call the patient back.');
  const reason = clean(b.reason, 200); if (reason.length < 3) return R(400, 'Give the reason (e.g. 6-month cleaning, PRP session 2).');
  const res = await env.DB.prepare('INSERT INTO cl_recalls (patient_id, due_date, reason, dept_id, created_by, created_by_name) VALUES (?,?,?,?,?,?)').bind(pid, b.due_date, reason, parseInt(b.dept_id, 10) || null, me.id, me.name).run();
  await audit(env, me, 'recall.add', 'patient', pid, reason);
  return OK({ id: res.meta.last_row_id });
}
async function updateRecall(env, me, id, b) {
  const rc = await env.DB.prepare('SELECT * FROM cl_recalls WHERE id=?').bind(id).first();
  if (!rc) return R(404, 'Not found.');
  if (isDate(b.due_date) && !b.status) { await env.DB.prepare('UPDATE cl_recalls SET due_date=?, outcome=?, updated_at=? WHERE id=?').bind(b.due_date, nz(clean(b.outcome, 200)) || rc.outcome, nowIso(), id).run(); return OK(); }
  if (!['open', 'booked', 'done', 'dismissed'].includes(b.status)) return R(400, 'Choose what happened.');
  await env.DB.prepare('UPDATE cl_recalls SET status=?, outcome=?, appointment_id=COALESCE(?, appointment_id), updated_at=? WHERE id=?').bind(b.status, nz(clean(b.outcome, 200)), parseInt(b.appointment_id, 10) || null, nowIso(), id).run();
  await audit(env, me, 'recall.' + b.status, 'patient', rc.patient_id, rc.reason);
  return OK();
}

/* ---------------- photos (R2) ---------------- */
export async function uploadPhoto(request, env, me, url) {
  if (!canClinical(me)) return noClin();
  if (!env.CVS) return api({ ok: false, error: 'Photo storage is not set up.' }, 500);
  const type = (request.headers.get('content-type') || '').split(';')[0].trim();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) return api({ ok: false, error: 'Upload a JPEG, PNG or WebP image.' }, 415);
  const len = parseInt(request.headers.get('content-length') || '0', 10);
  if (!len || len > PHOTO_MAX) return api({ ok: false, error: 'Photos must be under 4 MB.' }, 413);
  const pid = parseInt(url.searchParams.get('patient_id'), 10);
  if (!(await patientOk(env, pid))) return api({ ok: false, error: 'Choose the patient.' }, 400);
  const buf = await request.arrayBuffer();
  if (buf.byteLength > PHOTO_MAX) return api({ ok: false, error: 'Photos must be under 4 MB.' }, 413);
  const key = `clinic-photos/${pid}/${crypto.randomUUID()}.${type.split('/')[1].replace('jpeg', 'jpg')}`;
  await env.CVS.put(key, buf, { httpMetadata: { contentType: type } });
  const tag = ['before', 'after', 'progress', 'xray', 'scan', 'other'].includes(url.searchParams.get('tag')) ? url.searchParams.get('tag') : 'other';
  const taken = isDate(url.searchParams.get('taken_on')) ? url.searchParams.get('taken_on') : today();
  const res = await env.DB.prepare('INSERT INTO cl_photos (patient_id, note_id, r2_key, content_type, size, tag, area, caption, taken_on, uploaded_by, uploaded_by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .bind(pid, parseInt(url.searchParams.get('note_id'), 10) || null, key, type, buf.byteLength, tag, nz(clean(url.searchParams.get('area'), 60)), nz(clean(url.searchParams.get('caption'), 200)), taken, me.id, me.name).run();
  await audit(env, me, 'photo.add', 'patient', pid, `${tag} ${key}`);
  return api({ ok: true, id: res.meta.last_row_id });
}
async function photoFile(env, id) {
  const ph = await env.DB.prepare('SELECT * FROM cl_photos WHERE id=?').bind(id).first();
  if (!ph || !env.CVS) return api({ ok: false, error: 'Not found' }, 404);
  const obj = await env.CVS.get(ph.r2_key);
  if (!obj) return api({ ok: false, error: 'Not found' }, 404);
  return new Response(obj.body, { headers: { ...HEADERS, 'content-type': ph.content_type, 'cache-control': 'private, no-store', 'content-disposition': 'inline' } });
}
async function deletePhoto(env, me, id) {
  const ph = await env.DB.prepare('SELECT * FROM cl_photos WHERE id=?').bind(id).first();
  if (!ph) return R(404, 'Not found.');
  if (ph.uploaded_by !== me.id && !canManage(me)) return R(403, 'Only the person who added it or a manager can delete a photo.');
  if (env.CVS) await env.CVS.delete(ph.r2_key);
  await env.DB.prepare('DELETE FROM cl_photos WHERE id=?').bind(id).run();
  await audit(env, me, 'photo.delete', 'patient', ph.patient_id, ph.r2_key);
  return OK();
}

/* ---------------- prescription PDF ---------------- */
const WIN = /[^\x20-\x7E\xA0-\xFF–—‘’“”•…]/g;
const safe = s => String(s == null ? '' : s).replace(/₹/g, 'Rs.').replace(WIN, '?');
async function rxPdf(env, request, id) {
  const n = await env.DB.prepare('SELECT * FROM cl_notes WHERE id=?').bind(id).first();
  if (!n) return api({ ok: false, error: 'Not found' }, 404);
  const p = await env.DB.prepare('SELECT * FROM cl_patients WHERE id=?').bind(n.patient_id).first();
  const doc = await env.DB.prepare('SELECT name, reg_no FROM ems_staff WHERE id=?').bind(n.author_id).first();
  const s = await settings(env), rx = parse(n.rx, []), vit = parse(n.vitals, {});
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Prescription ${p.patient_no} ${n.visit_date}`);
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.12, 0.19, 0.2), muted = rgb(0.37, 0.43, 0.42), teal = rgb(0.204, 0.349, 0.369), line = rgb(0.85, 0.88, 0.87);
  const W = 595.28, H = 841.89, L = 40, Rx = W - 40;
  const page = pdf.addPage([W, H]); let y = H - 40;
  const text = (t, x, yy, size = 9, font = reg, color = ink) => page.drawText(safe(t), { x, y: yy, size, font, color });
  const right = (t, x, yy, size = 9, font = reg, color = ink) => page.drawText(safe(t), { x: x - font.widthOfTextAtSize(safe(t), size), y: yy, size, font, color });
  const wrap = (t, width, size, font = reg) => { const out = []; let cur = ''; for (const w of safe(t).split(/\s+/)) { const nn = cur ? cur + ' ' + w : w; if (font.widthOfTextAtSize(nn, size) > width && cur) { out.push(cur); cur = w; } else cur = nn; } if (cur) out.push(cur); return out; };
  try {
    const res = await env.ASSETS.fetch(new Request(new URL('/img/hasta-wellness-logo.jpg', request.url)));
    if (res.ok) { const img = await pdf.embedJpg(new Uint8Array(await res.arrayBuffer())); const sc = 42 / img.height; page.drawImage(img, { x: L, y: y - 42, width: img.width * sc, height: 42 }); }
  } catch { /* optional */ }
  right(doc ? doc.name : n.author_name, Rx, y - 10, 12, bold, teal);
  if (doc && doc.reg_no) right(`Reg. No. ${doc.reg_no}`, Rx, y - 24, 8.5, reg, muted);
  right(`${s.trade_name} · ${s.phone}`, Rx, y - 36, 8.5, reg, muted);
  y -= 56; page.drawLine({ start: { x: L, y }, end: { x: Rx, y }, thickness: 0.8, color: line }); y -= 18;
  const age = p.dob ? Math.floor((Date.parse(n.visit_date) - Date.parse(p.dob)) / 31557600000) : null;
  text(p.name, L, y, 11, bold); right(`Date ${n.visit_date.split('-').reverse().join('-')}`, Rx, y, 9); y -= 13;
  text(`${p.patient_no}${age != null ? ' · ' + age + ' yrs' : ''}${p.gender ? ' · ' + p.gender : ''} · +91 ${p.phone}`, L, y, 8.5, reg, muted); y -= 18;
  const vs = [vit.bp && `BP ${vit.bp}`, vit.pulse && `Pulse ${vit.pulse}`, vit.weight && `Wt ${vit.weight} kg`, vit.spo2 && `SpO2 ${vit.spo2}%`, vit.temp && `Temp ${vit.temp}`].filter(Boolean);
  if (vs.length) { text(vs.join('  ·  '), L, y, 8.5, reg, muted); y -= 16; }
  if (p.medical_alert) { text(`Alert: ${p.medical_alert}`.slice(0, 110), L, y, 8.5, bold, rgb(0.64, 0.23, 0.17)); y -= 16; }
  for (const [k, v] of [['Complaint', n.complaint], ['Diagnosis', n.diagnosis]]) if (v) { text(k, L, y, 8, bold, muted); y -= 11; for (const ln of wrap(v, Rx - L, 9).slice(0, 4)) { text(ln, L, y, 9); y -= 11; } y -= 6; }
  text('Rx', L, y, 20, bold, teal); y -= 24;
  rx.forEach((x, i) => {
    text(`${i + 1}. ${x.name}`, L + 6, y, 10, bold); y -= 13;
    const det = [x.dose, x.freq, x.days && `for ${x.days}`].filter(Boolean).join('  ·  ');
    if (det) { text(det, L + 20, y, 9, reg, muted); y -= 12; }
    if (x.note) { text(x.note, L + 20, y, 8.5, reg, muted); y -= 12; }
    y -= 6;
  });
  if (!rx.length) { text('No medicines prescribed.', L + 6, y, 9, reg, muted); y -= 16; }
  if (n.advice) { y -= 4; text('Advice', L, y, 8, bold, muted); y -= 11; for (const ln of wrap(n.advice, Rx - L, 9).slice(0, 8)) { text(ln, L, y, 9); y -= 11; } }
  if (n.review_date) { y -= 8; text(`Review on ${n.review_date.split('-').reverse().join('-')}${n.review_note ? ' — ' + n.review_note : ''}`, L, y, 9.5, bold, teal); }
  page.drawLine({ start: { x: L, y: 110 }, end: { x: Rx, y: 110 }, thickness: 0.6, color: line });
  right(doc ? doc.name : n.author_name || '', Rx, 92, 9, bold); right('Signature', Rx, 80, 8, reg, muted);
  text(s.address.slice(0, 100), L, 66, 7.5, reg, muted);
  text(`${s.legal_name} · ${s.email}`, L, 56, 7.5, reg, muted);
  const bytes = await pdf.save();
  return new Response(bytes, { headers: { ...HEADERS, 'content-type': 'application/pdf', 'content-disposition': `inline; filename="Rx-${p.patient_no}-${n.visit_date}.pdf"` } });
}
