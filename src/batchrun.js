// Hasta EMS Academy — running a batch after admission.
//   Batch page: roster with each trainee's fee, BLS, attendance, modules, test, supervised sessions,
//   practical and certificate, with "falling behind" flags; timetable (teaching days, modules, trainer);
//   attendance register; module sign-off by Master Trainers; BLS certificate check; WhatsApp messages
//   (logged); completion report PDF and close-out; end-of-course feedback.
// Gates for Academy trainees (role 'trainee'): theory test needs modules 1–10 signed off and attendance
// at or above the batch minimum; supervised sessions need a verified BLS certificate; certification needs both.

import { clean, nz } from './util.js';
import { audit } from './hr.js';
import { masterQual, recordState, RULES, safe } from './academy.js';
import { PDFDocument, StandardFonts, rgb } from './vendor/pdf-lib.esm.min.js';

const R = (s, e, x) => [s, e, x];
const OK = x => [200, null, x];
const IST = 330 * 60000;
const today = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString().slice(0, 19) + 'Z';
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const isTime = s => /^\d{2}:\d{2}$/.test(s || '');
const parse = (s, f) => { try { return s ? JSON.parse(s) : f; } catch { return f; } };
const longDay = d => d ? new Date(d.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';
export const TAUGHT = 10;                 // modules 1–10 are signed off; module 11 is the supervised-practice log
const ROSTER = ['offered', 'enrolled', 'completed', 'withdrawn'];
const ATT = ['present', 'late', 'absent', 'excused'];
export const FEEDBACK = { content: 'Course content', trainers: 'Trainers', practice: 'Supervised practice', materials: 'Study materials', organisation: 'Organisation and timing', overall: 'Overall' };

const isMgr = me => me.role === 'admin' || me.role === 'manager';
async function event(env, appId, action, note, byName) {
  await env.DB.prepare('INSERT INTO ems_academy_events (application_id, action, note, by_name) VALUES (?,?,?,?)').bind(appId, action, nz(clean(note, 500)), byName || null).run();
}
const getBatch = (env, id) => env.DB.prepare('SELECT b.*, m.name machine_name, s.name lead_name FROM ems_academy_batches b LEFT JOIN ems_machine_types m ON m.id=b.machine_type_id LEFT JOIN ems_staff s ON s.id=b.lead_trainer_id WHERE b.id=?').bind(id).first();
async function mayTeach(env, me, batch) {
  if (isMgr(me)) return true;
  return !!batch.machine_type_id && (await masterQual(env, me.id, batch.machine_type_id)).ok;
}

// Attendance across teaching days held so far (excused days don't count against the trainee).
function attendanceOf(appId, days, marks) {
  const held = days.filter(d => d.day_date <= today());
  let att = 0, den = 0, absent = 0, unmarked = 0;
  for (const d of held) {
    const s = (marks[d.id] || {})[appId];
    if (!s) { unmarked++; continue; }
    if (s === 'excused') continue;
    den++;
    if (s === 'present' || s === 'late') att++; else absent++;
  }
  return { held: held.length, attended: att, absent, unmarked, pct: den ? Math.round(att / den * 100) : null };
}

// Gate for a trainee's training record: what is still missing before the test / certification.
export async function traineeGate(env, recordId) {
  const a = await env.DB.prepare('SELECT a.id, a.batch_id, a.bls_status, b.min_attendance FROM ems_academy_applications a JOIN ems_academy_batches b ON b.id=a.batch_id WHERE a.record_id=?').bind(recordId).first();
  if (!a) return null;
  const [signed, days, marks] = await Promise.all([
    env.DB.prepare('SELECT module_no FROM ems_academy_module_signoffs WHERE record_id=?').bind(recordId).all().then(r => (r.results || []).map(x => x.module_no)),
    env.DB.prepare('SELECT id, day_date FROM ems_academy_days WHERE batch_id=?').bind(a.batch_id).all().then(r => r.results || []),
    env.DB.prepare('SELECT t.day_id, t.application_id, t.status FROM ems_academy_attendance t WHERE t.application_id=?').bind(a.id).all().then(r => r.results || []),
  ]);
  const map = {};
  for (const m of marks) (map[m.day_id] = map[m.day_id] || {})[m.application_id] = m.status;
  const att = attendanceOf(a.id, days, map);
  const missingModules = [];
  for (let n = 1; n <= TAUGHT; n++) if (!signed.includes(n)) missingModules.push(n);
  return { modules: missingModules, attendance: att, min: a.min_attendance, attendanceOk: att.pct === null || att.pct >= a.min_attendance, bls: a.bls_status === 'verified' };
}

/* ------------------------------ batch page ------------------------------ */

export async function batchDetail(env, me, id) {
  const batch = await getBatch(env, id);
  if (!batch) return R(404, 'Batch not found.');
  const q = (sql, ...b) => env.DB.prepare(sql).bind(...b).all().then(r => r.results || []);
  const [apps, days, marks, fb, msgs] = await Promise.all([
    q(`SELECT a.id, a.app_no, a.name, a.phone, a.status, a.bls, a.bls_status, a.docs, a.record_id, a.staff_id, a.invoice_id, a.offer_expires,
         (SELECT json_object('status', i.status, 'total', i.total, 'paid', COALESCE((SELECT SUM(al.amount) FROM cl_allocations al JOIN cl_payments p ON p.id=al.payment_id WHERE al.invoice_id=i.id AND p.voided=0),0)) FROM cl_invoices i WHERE i.id=a.invoice_id) invoice
       FROM ems_academy_applications a WHERE a.batch_id=? AND a.status IN (${ROSTER.map(() => '?').join(',')}) ORDER BY a.status='withdrawn', a.name`, id, ...ROSTER),
    q('SELECT d.*, s.name trainer_name FROM ems_academy_days d LEFT JOIN ems_staff s ON s.id=d.trainer_id WHERE d.batch_id=? ORDER BY d.day_date, d.start_time', id),
    q('SELECT t.day_id, t.application_id, t.status FROM ems_academy_attendance t JOIN ems_academy_days d ON d.id=t.day_id WHERE d.batch_id=?', id),
    q('SELECT * FROM ems_academy_feedback WHERE batch_id=?', id),
    q("SELECT e.application_id, e.note, e.at, e.by_name FROM ems_academy_events e JOIN ems_academy_applications a ON a.id=e.application_id WHERE a.batch_id=? AND e.action='WhatsApp message' ORDER BY e.id DESC LIMIT 40", id),
  ]);
  const map = {};
  for (const m of marks) (map[m.day_id] = map[m.day_id] || {})[m.application_id] = m.status;
  const roster = [];
  for (const a of apps) {
    const inv = parse(a.invoice, null);
    const row = { id: a.id, app_no: a.app_no, name: a.name, phone: a.phone, status: a.status, bls: a.bls, bls_status: a.bls_status, bls_doc: !!parse(a.docs, {}).bls, offer_expires: a.offer_expires,
      fee: inv ? { status: inv.status, total: inv.total, paid: inv.paid, due: Math.round((inv.total - inv.paid) * 100) / 100 } : null,
      attendance: attendanceOf(a.id, days, map), modules: [], record: null, certificate: null, feedback: fb.some(f => f.application_id === a.id), flags: [] };
    roster.push(row);
    if (a.record_id) {
      const r = await env.DB.prepare('SELECT * FROM ems_training_records WHERE id=?').bind(a.record_id).first();
      if (r) {
        const st = await recordState(env, r);
        row.record = { id: r.id, status: r.status, test: st.req.test, logs: st.req.logs, practical: { done: st.req.practical.done, tried: !!st.req.practical.last }, ready: st.req.ready };
        row.modules = (await q('SELECT module_no, signed_name, signed_at FROM ems_academy_module_signoffs WHERE record_id=? ORDER BY module_no', r.id));
        row.certificate = await env.DB.prepare('SELECT id, code, valid_until, status FROM ems_certifications WHERE staff_id=? AND machine_type_id=? AND code IS NOT NULL ORDER BY id DESC LIMIT 1').bind(a.staff_id, r.machine_type_id).first();
      }
    }
    // Falling-behind flags.
    const f = row.flags, started = batch.start_date <= today();
    if (a.status === 'offered') f.push(row.offer_expires && row.offer_expires < today() ? 'Offer expired — fee not paid' : 'Fee not paid yet');
    if (a.status === 'enrolled') {
      if (row.fee && row.fee.due > 0) f.push(`Fee due ₹${row.fee.due}`);
      if (!row.record) f.push('Training record not open');
      if (row.bls_status !== 'verified') f.push(row.bls_status === 'pending' ? 'BLS certificate to check' : row.bls_status === 'rejected' ? 'BLS certificate rejected' : 'No BLS certificate yet');
      if (row.attendance.pct !== null && row.attendance.pct < batch.min_attendance) f.push(`Attendance ${row.attendance.pct}% (min ${batch.min_attendance}%)`);
      if (row.attendance.unmarked) f.push(`${row.attendance.unmarked} day(s) not marked`);
      const taughtSoFar = new Set(days.filter(d => d.day_date < today()).flatMap(d => parse(d.modules, [])).filter(n => n <= TAUGHT));
      const behind = [...taughtSoFar].filter(n => !row.modules.some(m => m.module_no === n));
      if (behind.length) f.push(`Modules taught but not signed: ${behind.sort((x, y) => x - y).join(', ')}`);
      if (row.record && row.record.status === 'retraining') f.push('Failed the test 3 times — retraining needed');
      if (row.record && batch.end_date && batch.end_date < today() && !row.record.ready) f.push('Batch has ended — not yet ready to certify');
      if (started && row.record && row.record.logs.count === 0 && days.length && days[days.length - 1].day_date < today()) f.push('No supervised sessions yet');
    }
  }
  const trainers = [];
  if (batch.machine_type_id) {
    const { results } = await env.DB.prepare("SELECT id, name FROM ems_staff WHERE active=1 AND role <> 'trainee' AND (skills LIKE '%coach%' OR skills LIKE '%doctor%') ORDER BY name").all();
    for (const s of results || []) if ((await masterQual(env, s.id, batch.machine_type_id)).ok) trainers.push({ id: s.id, name: s.name });
  }
  const fbSum = {};
  for (const k of Object.keys(FEEDBACK)) { const v = fb.map(x => parse(x.ratings, {})[k]).filter(n => n >= 1); fbSum[k] = v.length ? Math.round(v.reduce((s, n) => s + n, 0) / v.length * 10) / 10 : null; }
  const rec = fb.map(x => x.recommend).filter(n => n !== null && n !== undefined);
  const cur = await env.DB.prepare("SELECT modules FROM ems_curriculum WHERE status='approved' ORDER BY id DESC LIMIT 1").first() || await env.DB.prepare('SELECT modules FROM ems_curriculum ORDER BY id DESC LIMIT 1').first();
  return OK({
    batch, roster, days: days.map(d => ({ ...d, modules: parse(d.modules, []), marks: map[d.id] || {} })), trainers,
    modules: parse(cur && cur.modules, []).map(m => ({ no: m.no, title: m.title, hours: m.hours })), taught: TAUGHT,
    feedback: { count: fb.length, averages: fbSum, labels: FEEDBACK, recommend: rec.length ? Math.round(rec.reduce((s, n) => s + n, 0) / rec.length * 10) / 10 : null,
      comments: fb.map(x => ({ name: (apps.find(a => a.id === x.application_id) || {}).name, best: x.best, improve: x.improve, recommend: x.recommend })) },
    messages: msgs, can_teach: await mayTeach(env, me, batch), can_sign: !!batch.machine_type_id && (await masterQual(env, me.id, batch.machine_type_id)).ok, can_manage: isMgr(me),
  });
}

export async function saveBatchRun(env, me, id, b) {
  if (!isMgr(me)) return R(403, 'Only managers and admins can change the batch.');
  const batch = await getBatch(env, id);
  if (!batch) return R(404, 'Batch not found.');
  const lead = parseInt(b.lead_trainer_id, 10) || null, min = parseInt(b.min_attendance, 10);
  if (!(min >= 50 && min <= 100)) return R(400, 'Minimum attendance must be between 50% and 100%.');
  if (lead && !(batch.machine_type_id && (await masterQual(env, lead, batch.machine_type_id)).ok)) return R(400, 'The lead trainer must be a Master Trainer qualified for this batch’s machine.');
  await env.DB.prepare('UPDATE ems_academy_batches SET lead_trainer_id=?, min_attendance=? WHERE id=?').bind(lead, min, id).run();
  await audit(env, me, 'academy.batch_run', 'academy_batch', id, `lead ${lead || '-'} min attendance ${min}%`);
  return OK();
}

/* ------------------------------ timetable ------------------------------ */

export async function saveDay(env, me, batchId, dayId, b) {
  if (!isMgr(me)) return R(403, 'Only managers and admins can change the timetable.');
  const batch = await getBatch(env, batchId);
  if (!batch) return R(404, 'Batch not found.');
  if (!isDate(b.day_date)) return R(400, 'Choose the date.');
  if (b.day_date < batch.start_date || (batch.end_date && b.day_date > batch.end_date)) return R(400, 'The day must fall within the batch dates.');
  const st = isTime(b.start_time) ? b.start_time : null, et = isTime(b.end_time) ? b.end_time : null;
  if (st && et && et <= st) return R(400, 'The end time must be after the start time.');
  const mods = [...new Set((Array.isArray(b.modules) ? b.modules : []).map(n => parseInt(n, 10)).filter(n => n >= 1 && n <= 11))].sort((x, y) => x - y);
  const trainer = parseInt(b.trainer_id, 10) || null;
  if (trainer && !(await env.DB.prepare("SELECT 1 FROM ems_staff WHERE id=? AND active=1 AND role <> 'trainee'").bind(trainer).first())) return R(400, 'Choose an active team member as trainer.');
  const vals = [b.day_date, st, et, JSON.stringify(mods), trainer, nz(clean(b.topic, 160))];
  if (dayId) {
    const r = await env.DB.prepare('UPDATE ems_academy_days SET day_date=?, start_time=?, end_time=?, modules=?, trainer_id=?, topic=? WHERE id=? AND batch_id=?').bind(...vals, dayId, batchId).run();
    if (!r.meta.changes) return R(404, 'Day not found.');
  } else dayId = (await env.DB.prepare('INSERT INTO ems_academy_days (day_date, start_time, end_time, modules, trainer_id, topic, batch_id) VALUES (?,?,?,?,?,?,?)').bind(...vals, batchId).run()).meta.last_row_id;
  return OK({ id: dayId });
}
export async function deleteDay(env, me, batchId, dayId) {
  if (!isMgr(me)) return R(403, 'Only managers and admins can change the timetable.');
  const marked = await env.DB.prepare('SELECT COUNT(*) n FROM ems_academy_attendance WHERE day_id=?').bind(dayId).first();
  if (marked.n) return R(400, 'Attendance is already marked for this day. Change the day instead of deleting it.');
  await env.DB.prepare('DELETE FROM ems_academy_days WHERE id=? AND batch_id=?').bind(dayId, batchId).run();
  return OK();
}

/* ------------------------------ attendance ------------------------------ */

export async function markAttendance(env, me, batchId, dayId, b) {
  const batch = await getBatch(env, batchId);
  if (!batch) return R(404, 'Batch not found.');
  if (!(await mayTeach(env, me, batch))) return R(403, 'Only managers, admins or this batch’s Master Trainers can mark attendance.');
  const day = await env.DB.prepare('SELECT * FROM ems_academy_days WHERE id=? AND batch_id=?').bind(dayId, batchId).first();
  if (!day) return R(404, 'Day not found.');
  if (day.day_date > today()) return R(400, 'Attendance can be marked on or after the day.');
  const marks = b.marks && typeof b.marks === 'object' ? b.marks : {};
  const { results } = await env.DB.prepare("SELECT id FROM ems_academy_applications WHERE batch_id=? AND status IN ('enrolled','completed')").bind(batchId).all();
  const ok = new Set((results || []).map(r => r.id));
  const stmts = [];
  for (const [k, v] of Object.entries(marks)) {
    const aid = parseInt(k, 10);
    if (!ok.has(aid)) continue;
    if (v === '' || v === null) stmts.push(env.DB.prepare('DELETE FROM ems_academy_attendance WHERE day_id=? AND application_id=?').bind(dayId, aid));
    else if (ATT.includes(v)) stmts.push(env.DB.prepare('INSERT INTO ems_academy_attendance (day_id, application_id, status, marked_by, marked_at) VALUES (?,?,?,?,?) ON CONFLICT(day_id, application_id) DO UPDATE SET status=excluded.status, marked_by=excluded.marked_by, marked_at=excluded.marked_at').bind(dayId, aid, v, me.name, nowIso()));
  }
  if (!stmts.length) return R(400, 'Nothing to save.');
  await env.DB.batch(stmts);
  await audit(env, me, 'academy.attendance', 'academy_day', dayId, `${batch.code} ${day.day_date}: ${stmts.length} marks`);
  return OK();
}

/* ------------------------------ module sign-off ------------------------------ */

export async function signModule(env, me, batchId, b) {
  const batch = await getBatch(env, batchId);
  if (!batch) return R(404, 'Batch not found.');
  const mq = batch.machine_type_id ? await masterQual(env, me.id, batch.machine_type_id) : { ok: false, reason: '' };
  if (!mq.ok) return R(403, 'Only a Master Trainer qualified for this machine can sign off modules. ' + (mq.reason || ''));
  const a = await env.DB.prepare("SELECT id, name, record_id, staff_id FROM ems_academy_applications WHERE id=? AND batch_id=? AND status='enrolled'").bind(parseInt(b.application_id, 10), batchId).first();
  if (!a || !a.record_id) return R(400, 'Choose an enrolled trainee with an open training record.');
  if (a.staff_id === me.id) return R(403, 'You cannot sign off your own modules.');
  const rec = await env.DB.prepare('SELECT status FROM ems_training_records WHERE id=?').bind(a.record_id).first();
  if (!rec || !['in_training', 'retraining'].includes(rec.status)) return R(400, 'This training record is closed.');
  const nos = (Array.isArray(b.modules) ? b.modules : [b.module_no]).map(n => parseInt(n, 10)).filter(n => n >= 1 && n <= TAUGHT);
  if (!nos.length) return R(400, 'Choose the module.');
  const stmts = nos.map(n => b.done === false
    ? env.DB.prepare('DELETE FROM ems_academy_module_signoffs WHERE record_id=? AND module_no=?').bind(a.record_id, n)
    : env.DB.prepare('INSERT OR IGNORE INTO ems_academy_module_signoffs (record_id, module_no, signed_by, signed_name) VALUES (?,?,?,?)').bind(a.record_id, n, me.id, me.name));
  await env.DB.batch(stmts);
  await event(env, a.id, b.done === false ? `Module sign-off removed: ${nos.join(', ')}` : `Module${nos.length > 1 ? 's' : ''} signed off: ${nos.join(', ')}`, null, me.name);
  return OK();
}

/* ------------------------------ BLS ------------------------------ */

const BLS_SIGS = { pdf: [[0x25, 0x50, 0x44, 0x46], 'application/pdf'], jpg: [[0xff, 0xd8, 0xff], 'image/jpeg'], png: [[0x89, 0x50, 0x4e, 0x47], 'image/png'] };
export async function uploadBls(env, me, request) {
  const a = await env.DB.prepare("SELECT id, docs, bls_status FROM ems_academy_applications WHERE staff_id=? AND status='enrolled' ORDER BY id DESC LIMIT 1").bind(me.id).first();
  if (!a) return R(400, 'No active course found.');
  if (a.bls_status === 'verified') return R(400, 'Your BLS certificate is already verified.');
  const url = new URL(request.url), expiry = url.searchParams.get('expiry');
  if (!isDate(expiry) || expiry < today()) return R(400, 'Enter the certificate’s expiry date (it must still be valid).');
  const buf = new Uint8Array(await request.arrayBuffer());
  if (!buf.length || buf.length > 5 * 1024 * 1024) return R(400, 'Upload a file up to 5 MB.');
  const ext = Object.keys(BLS_SIGS).find(e => BLS_SIGS[e][0].every((x, i) => buf[i] === x));
  if (!ext) return R(400, 'Upload a PDF, JPG or PNG.');
  const key = `academy-apply/${today().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
  await env.CVS.put(key, buf, { httpMetadata: { contentType: BLS_SIGS[ext][1] } });
  const docs = parse(a.docs, {});
  docs.bls = { key, name: `bls-certificate.${ext}`, type: BLS_SIGS[ext][1] };
  await env.DB.prepare("UPDATE ems_academy_applications SET docs=?, bls='valid', bls_expiry=?, bls_status='pending', updated_at=? WHERE id=?").bind(JSON.stringify(docs), expiry, nowIso(), a.id).run();
  await event(env, a.id, 'BLS certificate uploaded by the trainee', `expires ${expiry}`, me.name);
  return OK();
}
export async function blsDecision(env, me, appId, b) {
  if (!isMgr(me)) return R(403, 'Only managers and admins can check BLS certificates.');
  const a = await env.DB.prepare('SELECT id, docs, bls_expiry FROM ems_academy_applications WHERE id=?').bind(appId).first();
  if (!a) return R(404, 'Application not found.');
  if (!parse(a.docs, {}).bls) return R(400, 'No BLS certificate has been uploaded.');
  const ok = b.decision === 'verify';
  const expiry = isDate(b.expiry) ? b.expiry : a.bls_expiry;
  if (ok && (!expiry || expiry < today())) return R(400, 'Enter a valid expiry date to verify.');
  if (!ok && clean(b.note, 300).length < 5) return R(400, 'Say why the certificate is not accepted (the trainee will see it).');
  await env.DB.prepare('UPDATE ems_academy_applications SET bls_status=?, bls_expiry=?, bls_checked_by=?, bls_checked_at=?, updated_at=? WHERE id=?').bind(ok ? 'verified' : 'rejected', expiry || null, me.name, nowIso(), nowIso(), appId).run();
  await event(env, appId, ok ? `BLS certificate verified (valid to ${expiry})` : 'BLS certificate not accepted', ok ? null : b.note, me.name);
  return OK();
}

/* ------------------------------ messages ------------------------------ */

export async function logMessage(env, me, batchId, b) {
  if (!isMgr(me)) return R(403, 'Only managers and admins can message the batch.');
  const ids = (Array.isArray(b.application_ids) ? b.application_ids : []).map(n => parseInt(n, 10)).filter(Boolean);
  const { results } = await env.DB.prepare('SELECT id FROM ems_academy_applications WHERE batch_id=?').bind(batchId).all();
  const ok = new Set((results || []).map(r => r.id));
  for (const id of ids.filter(i => ok.has(i))) await event(env, id, 'WhatsApp message', clean(b.template, 80), me.name);
  return OK();
}

/* ------------------------------ close-out ------------------------------ */

export async function completeBatch(env, me, id, b) {
  if (!isMgr(me)) return R(403, 'Only managers and admins can close a batch.');
  const batch = await getBatch(env, id);
  if (!batch) return R(404, 'Batch not found.');
  if (batch.status === 'completed') return R(400, 'This batch is already completed.');
  const { results } = await env.DB.prepare("SELECT id, name, status FROM ems_academy_applications WHERE batch_id=? AND status IN ('offered','enrolled')").bind(id).all();
  const open = results || [];
  const note = clean(b.note, 500);
  if (open.length && note.length < 10) return R(400, `${open.map(a => a.name).join(', ')} ${open.length > 1 ? 'are' : 'is'} not certified or withdrawn yet. Write a note on how they will be followed up to close anyway.`);
  await env.DB.prepare("UPDATE ems_academy_batches SET status='completed', completed_at=?, completed_by=?, completion_note=? WHERE id=?").bind(nowIso(), me.name, nz(note), id).run();
  for (const a of open) await event(env, a.id, 'Batch closed — still to complete', note, me.name);
  await audit(env, me, 'academy.batch_complete', 'academy_batch', id, `${batch.code} closed${open.length ? `; ${open.length} open` : ''}`);
  return OK();
}

export async function reportPdf(env, me, id) {
  const r = await batchDetail(env, me, id);
  if (r[0] !== 200) return null;
  const d = r[2], b = d.batch;
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Batch report ${b.code}`);
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const teal = rgb(0.204, 0.349, 0.369), muted = rgb(0.37, 0.43, 0.42), ink = rgb(0.12, 0.19, 0.2), line = rgb(0.85, 0.88, 0.87), gold = rgb(0.77, 0.64, 0.36);
  const W = 841.89, H = 595.28, M = 36;
  let page, y;
  const fit = (t, f, s, w) => { t = safe(t); if (f.widthOfTextAtSize(t, s) <= w) return t; while (t.length > 1 && f.widthOfTextAtSize(t + '..', s) > w) t = t.slice(0, -1); return t + '..'; };
  const text = (t, x, yy, s = 9, f = reg, c = ink, w = 400) => page.drawText(fit(t, f, s, w), { x, y: yy, size: s, font: f, color: c });
  const newPage = () => { page = pdf.addPage([W, H]); y = H - M; page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: teal });
    text('Hasta EMS Academy · Batch report', M, y - 6, 9, bold, teal); text(`${b.code} · printed ${longDay(today())}`, W - M - 200, y - 6, 9, reg, muted, 200); y -= 26; };
  newPage();
  text(b.title, M, y, 18, bold, ink, 600); y -= 20;
  text(`${b.code} · ${longDay(b.start_date)}${b.end_date ? ' – ' + longDay(b.end_date) : ''} · ${b.machine_name || 'machine not set'} · lead trainer: ${b.lead_name || 'not set'} · status: ${b.status}`, M, y, 10, reg, muted, W - 2 * M); y -= 22;
  const active = d.roster.filter(x => x.status !== 'withdrawn');
  const cert = d.roster.filter(x => x.certificate && x.certificate.code).length;
  const sum = [['Seats', String(b.seats)], ['Enrolled', String(d.roster.filter(x => ['enrolled', 'completed'].includes(x.status)).length)], ['Certified', String(cert)], ['Withdrawn', String(d.roster.filter(x => x.status === 'withdrawn').length)],
    ['Teaching days', `${d.days.filter(x => x.day_date <= today()).length} of ${d.days.length}`], ['Min attendance', `${b.min_attendance}%`], ['Feedback', `${d.feedback.count} response(s)`]];
  let x = M;
  for (const [k, v] of sum) { page.drawRectangle({ x, y: y - 30, width: 104, height: 38, borderColor: line, borderWidth: 0.8 }); text(k, x + 8, y - 4, 7.5, reg, muted, 90); text(v, x + 8, y - 21, 12, bold, ink, 90); x += 110; }
  y -= 52;
  const cols = [['Trainee', 150], ['Status', 62], ['Fee', 62], ['BLS', 56], ['Attendance', 62], ['Modules', 50], ['Test', 60], ['Sessions', 58], ['Practical', 52], ['Certificate', 158]];
  const header = () => { let cx = M; page.drawRectangle({ x: M, y: y - 5, width: W - 2 * M, height: 17, color: rgb(0.93, 0.95, 0.94) }); for (const [h, w] of cols) { text(h, cx + 3, y, 8, bold, teal, w - 4); cx += w; } y -= 18; };
  header();
  for (const t of d.roster) {
    if (y < M + 60) { newPage(); header(); }
    const rec = t.record;
    const vals = [`${t.name} (${t.app_no})`, t.status, !t.fee ? '-' : t.fee.status === 'final' && t.fee.due <= 0 ? 'Paid' : `Due ${t.fee.due}`, t.bls_status || 'none',
      t.attendance.pct === null ? '-' : `${t.attendance.pct}% (${t.attendance.attended}/${t.attendance.held})`, `${t.modules.length}/${d.taught}`,
      rec ? (rec.test.done ? `Pass ${rec.test.score}%` : rec.test.attempts ? `${rec.test.score}% (${rec.test.attempts} try)` : 'Not taken') : '-',
      rec ? `${rec.logs.count}/${rec.logs.need} (${rec.logs.first} first)` : '-', rec ? (rec.practical.done ? 'Passed' : rec.practical.tried ? 'Not passed' : 'Not done') : '-',
      t.certificate && t.certificate.code ? `${t.certificate.code} to ${t.certificate.valid_until}` : '-'];
    let cx = M;
    vals.forEach((v, i) => { text(v, cx + 3, y, 8, i === 0 ? bold : reg, ink, cols[i][1] - 5); cx += cols[i][1]; });
    y -= 12;
    if (t.flags.length) { text('Pending: ' + t.flags.join('; '), M + 10, y, 7.5, reg, rgb(0.55, 0.3, 0.2), W - 2 * M - 20); y -= 11; }
    page.drawLine({ start: { x: M, y: y + 4 }, end: { x: W - M, y: y + 4 }, thickness: 0.4, color: line }); y -= 6;
  }
  // Attendance register
  if (d.days.length && active.length) {
    if (y < M + 120) newPage(); y -= 10;
    text('Attendance register', M, y, 12, bold, ink); y -= 16;
    const nameW = 150, cw = Math.min(42, (W - 2 * M - nameW) / d.days.length);
    let cx = M + nameW;
    for (const day of d.days) { text(day.day_date.slice(5).split('-').reverse().join('/'), cx + 2, y, 7, bold, teal, cw - 2); cx += cw; } y -= 12;
    const abbr = { present: 'P', late: 'L', absent: 'A', excused: 'E' };
    for (const t of active.filter(t => ['enrolled', 'completed'].includes(t.status))) {
      if (y < M + 20) { newPage(); }
      text(t.name, M, y, 8, reg, ink, nameW - 6); cx = M + nameW;
      for (const day of d.days) { text(abbr[day.marks[t.id]] || (day.day_date <= today() ? '?' : ''), cx + 8, y, 8, reg, day.marks[t.id] === 'absent' ? rgb(0.6, 0.25, 0.2) : ink, cw - 4); cx += cw; }
      y -= 12;
    }
    text('P present · L late · A absent · E excused · ? not marked', M, y - 2, 7.5, reg, muted, 400); y -= 16;
  }
  // Feedback
  if (d.feedback.count) {
    if (y < M + 120) newPage(); y -= 8;
    text(`Course feedback (${d.feedback.count} response${d.feedback.count > 1 ? 's' : ''})`, M, y, 12, bold, ink); y -= 16;
    for (const [k, l] of Object.entries(d.feedback.labels)) { text(l, M, y, 9, reg, muted, 160); text(d.feedback.averages[k] === null ? '-' : `${d.feedback.averages[k]} / 5`, M + 170, y, 9, bold, ink); y -= 12; }
    if (d.feedback.recommend !== null) { text('Would recommend', M, y, 9, reg, muted); text(`${d.feedback.recommend} / 10`, M + 170, y, 9, bold, ink); y -= 14; }
    for (const c of d.feedback.comments) {
      for (const [lab, v] of [['Best', c.best], ['Improve', c.improve]]) if (v) { if (y < M + 20) newPage(); text(`${c.name} · ${lab}: ${v}`, M, y, 8, reg, ink, W - 2 * M); y -= 11; }
    }
  }
  if (b.status === 'completed') { if (y < M + 30) newPage(); y -= 10; text(`Batch closed ${longDay(b.completed_at)} by ${b.completed_by}${b.completion_note ? ' — ' + b.completion_note : ''}`, M, y, 9, bold, gold, W - 2 * M); }
  return { bytes: await pdf.save(), name: `Batch-report-${b.code}.pdf` };
}

/* ------------------------------ trainee side ------------------------------ */

export async function traineeExtras(env, me) {
  const a = await env.DB.prepare('SELECT a.id, a.batch_id, a.status, a.record_id, a.bls_status, a.bls_expiry, b.end_date, b.status batch_status, b.min_attendance FROM ems_academy_applications a JOIN ems_academy_batches b ON b.id=a.batch_id WHERE a.staff_id=? ORDER BY a.id DESC LIMIT 1').bind(me.id).first();
  if (!a) return {};
  const [days, marks, signed, fb] = await Promise.all([
    env.DB.prepare('SELECT d.id, d.day_date, d.start_time, d.end_time, d.modules, d.topic, s.name trainer_name FROM ems_academy_days d LEFT JOIN ems_staff s ON s.id=d.trainer_id WHERE d.batch_id=? ORDER BY d.day_date, d.start_time').bind(a.batch_id).all().then(r => r.results || []),
    env.DB.prepare('SELECT day_id, status FROM ems_academy_attendance WHERE application_id=?').bind(a.id).all().then(r => r.results || []),
    a.record_id ? env.DB.prepare('SELECT module_no, signed_name, signed_at FROM ems_academy_module_signoffs WHERE record_id=?').bind(a.record_id).all().then(r => r.results || []) : [],
    env.DB.prepare('SELECT 1 FROM ems_academy_feedback WHERE application_id=?').bind(a.id).first(),
  ]);
  const map = {};
  for (const m of marks) (map[m.day_id] = map[m.day_id] || {})[a.id] = m.status;
  const gate = a.record_id ? await traineeGate(env, a.record_id) : null;
  let testDone = false;
  if (a.record_id) testDone = !!(await env.DB.prepare('SELECT 1 FROM ems_test_attempts WHERE record_id=? AND passed=1').bind(a.record_id).first());
  return {
    timetable: days.map(d => ({ ...d, modules: parse(d.modules, []), mark: (map[d.id] || {})[a.id] || null })),
    attendance: attendanceOf(a.id, days, map), min_attendance: a.min_attendance, signed, taught: TAUGHT,
    bls: { status: a.bls_status, expiry: a.bls_expiry }, gate,
    feedback: { done: !!fb, open: !fb && (testDone || a.status === 'completed' || a.batch_status === 'completed' || (a.end_date && a.end_date <= today())), labels: FEEDBACK },
  };
}
export async function submitFeedback(env, me, b) {
  const x = await traineeExtras(env, me);
  if (!x.feedback) return R(400, 'No course found.');
  if (x.feedback.done) return R(400, 'Thank you — you have already sent your feedback.');
  if (!x.feedback.open) return R(400, 'Feedback opens after you pass the theory test or the course ends.');
  const ratings = {};
  for (const k of Object.keys(FEEDBACK)) { const n = parseInt(b[k], 10); if (!(n >= 1 && n <= 5)) return R(400, `Rate “${FEEDBACK[k]}” from 1 to 5.`); ratings[k] = n; }
  const rec = parseInt(b.recommend, 10);
  const a = await env.DB.prepare('SELECT id, batch_id FROM ems_academy_applications WHERE staff_id=? ORDER BY id DESC LIMIT 1').bind(me.id).first();
  await env.DB.prepare('INSERT INTO ems_academy_feedback (application_id, batch_id, ratings, recommend, best, improve) VALUES (?,?,?,?,?,?)').bind(a.id, a.batch_id, JSON.stringify(ratings), rec >= 0 && rec <= 10 ? rec : null, nz(clean(b.best, 600)), nz(clean(b.improve, 600))).run();
  await event(env, a.id, 'Course feedback received', null, me.name);
  return OK();
}
