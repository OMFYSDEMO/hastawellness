// Duty Watch — the app checks every working day that each person did their part, records any lapse with
// points against the person responsible, tells them in a signed notice, keeps a monthly score, and escalates
// repeated lapses to the disciplinary procedure (src/discipline.js).
//
// Day close (cron, 03:00 IST, for the previous day — and on demand by the clinic admin):
//   Front desk (staff signed on as front desk that day; if nobody signed on, front-desk staff who were at
//   work; failing that, managers at work):
//     no_arrival      appointment left "booked" — arrival (or no-show / cancellation) never marked
//     late_mark       arrival marked only after the appointment should have finished
//     not_completed   patient arrived / in treatment, never marked completed
//     not_billed      completed but not billed, put on a package or marked no charge on the day
//     still_unbilled  still not closed on a later day (each day, up to 3 days)
//     unpaid          bill finalised on the day with money not collected
//     ems_unmarked    EMS session not marked attended / no-show
//   Duty manager (signed on as duty manager; else managers at work who were not on the front desk):
//     mgr_no_action   front-desk lapses left unresolved at the end of the day
//     leave_pending   a leave application waiting more than 48 hours for the approver
//   Everyone on attendance:
//     late, absent (no attendance, no approved leave), no_clock_out, doc_overdue (document not signed by its date)
// Points are configurable (Settings key duty_points, JSON). Nothing before duty_watch_from is counted.
// Monthly score = 100 − points (excused lapses do not count). Good ≥ 90, needs attention 75–89, poor < 75.
// Escalation: when the un-escalated points of the last 30 days reach duty_escalate_points (default 10), or the
// same lapse happens duty_repeat times (default 3), a disciplinary case is opened automatically with the
// lapses as the facts, for the Operations Head / clinic admin to take through the procedure.
// No money is deducted for lapses: fines on wages need a government-approved list of acts and a show-cause
// (Payment of Wages Act, s.8). Pay consequences, if any, go through the disciplinary procedure.
import { clean } from './util.js';
import { settings } from './clinic.js';
import { audit, pdfKit, pdfResponse, isSuper, approverIds, monthData } from './hr.js';
import { issueGenerated } from './docs.js';

const IST = 330 * 60000;
const today = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
const nowLocal = () => new Date(Date.now() + IST).toISOString().slice(0, 16);
const nowIso = () => new Date().toISOString().slice(0, 19) + 'Z';
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const isMonth = s => /^\d{4}-\d{2}$/.test(s || '');
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const addMin = (iso, n) => new Date(Date.parse(iso.slice(0, 16) + ':00Z') + n * 60000).toISOString().slice(0, 16);
const istOf = utc => utc ? new Date(Date.parse(utc.endsWith('Z') ? utc : utc + 'Z') + IST).toISOString().slice(0, 16) : null;
const fd = d => d ? new Date(d.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }) : '';
const ft = iso => iso ? iso.slice(11, 16) : '';
const parse = (s, f) => { try { return s ? JSON.parse(s) : f; } catch { return f; } };
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
const safe = t => String(t == null ? '' : t).replace(/₹/g, 'Rs.').replace(/→/g, '>').replace(/[^\x20-\x7E\xA0-\xFF–—‘’“”•…\n]/g, '?');
const SYSTEM = { id: 0, name: 'Hasta Duty Watch' };
const GRACE = 15;

export const CODES = {
  no_arrival: { label: 'Arrival not marked', who: 'front', points: 3, help: 'An appointment was left as "booked": the patient was never marked arrived, no-show or cancelled.' },
  late_mark: { label: 'Arrival marked late', who: 'front', points: 1, help: 'The arrival was marked only after the appointment should have finished.' },
  not_completed: { label: 'Treatment not marked complete', who: 'front', points: 2, help: 'The patient was marked arrived or in treatment and never marked completed.' },
  not_billed: { label: 'Not billed on the day', who: 'front', points: 3, help: 'A completed visit was not billed, put on a package or marked no charge on the day.' },
  still_unbilled: { label: 'Still not billed', who: 'front', points: 2, help: 'A visit from an earlier day was still not closed at the end of this day.' },
  unpaid: { label: 'Payment not collected', who: 'front', points: 1, help: 'A bill finalised on the day was left with money not collected.' },
  ems_unmarked: { label: 'EMS session not marked', who: 'front', points: 2, help: 'An EMS session was not marked attended or no-show.' },
  mgr_no_action: { label: 'Front-desk lapses not acted on', who: 'manager', points: 2, help: 'As duty manager, front-desk items were left unresolved at the end of the day.' },
  leave_pending: { label: 'Leave application not decided', who: 'approver', points: 1, help: 'A leave application waited more than 48 hours for a decision.' },
  late: { label: 'Late arrival', who: 'all', points: 1, help: 'Clocked in after the shift start plus the grace period.' },
  absent: { label: 'Absent without approved leave', who: 'all', points: 3, help: 'A working day with no attendance and no approved leave.' },
  no_clock_out: { label: 'No clock-out', who: 'all', points: 1, help: 'Clocked in but did not clock out.' },
  doc_overdue: { label: 'Document not signed on time', who: 'all', points: 1, help: 'A memo, policy or notice was not signed by its sign-by date.' },
};
const BANDS = [[90, 'good', 'Good'], [75, 'attention', 'Needs attention'], [-1, 'poor', 'Poor']];
const band = score => { const b = BANDS.find(([min]) => score >= min); return { key: b[1], label: b[2] }; };

async function config(env) {
  const s = await settings(env);
  const over = parse(s.duty_points, {});
  const points = Object.fromEntries(Object.entries(CODES).map(([k, c]) => [k, Number.isFinite(+over[k]) && +over[k] >= 0 ? +over[k] : c.points]));
  return { s, from: isDate(s.duty_watch_from) ? s.duty_watch_from : null, points,
    escalate: Number(s.duty_escalate_points) > 0 ? Number(s.duty_escalate_points) : 10, repeat: Number(s.duty_repeat) > 0 ? Number(s.duty_repeat) : 3,
    writtenBy: String(s.disc_written_by || s.leave_approvers || '').split(',').map(Number).filter(Boolean) };
}
const isMgr = u => !!u.admin || u.role === 'manager';
const skillsOf = r => parse(r.skills, []);

/* ------------------------------ who was on duty ------------------------------ */

async function rosterFor(env, day, cf) {
  const [staff, att, sign] = await env.DB.batch([
    env.DB.prepare("SELECT id, name, role, skills, username FROM ems_staff WHERE active=1 AND external=0 AND role <> 'trainee' AND username <> 'hasta'"),
    env.DB.prepare('SELECT DISTINCT staff_id FROM cl_attendance WHERE day=?').bind(day),
    env.DB.prepare('SELECT d.staff_id, d.role, d.on_at, s.name FROM cl_duty_signons d JOIN ems_staff s ON s.id=d.staff_id WHERE d.day=? ORDER BY d.on_at').bind(day),
  ]);
  const sup = id => isSuper({ id, username: '' }, cf.s);
  const all = (staff.results || []).filter(x => !sup(x.id));
  const present = new Set((att.results || []).map(a => a.staff_id));
  const signed = sign.results || [];
  let front = signed.filter(x => x.role === 'front').map(x => x.staff_id);
  let frontHow = 'signed on';
  if (!front.length) { front = all.filter(x => present.has(x.id) && skillsOf(x).includes('front')).map(x => x.id); frontHow = 'front-desk staff at work (nobody signed on)'; }
  if (!front.length) { front = all.filter(x => present.has(x.id) && x.role === 'manager').map(x => x.id); frontHow = 'manager at work (nobody signed on as front desk)'; }
  let mgr = signed.filter(x => x.role === 'manager').map(x => x.staff_id), mgrHow = 'signed on';
  if (!mgr.length) { mgr = all.filter(x => present.has(x.id) && x.role === 'manager' && !front.includes(x.id)).map(x => x.id); mgrHow = 'manager at work (nobody signed on as duty manager)'; }
  return { front: [...new Set(front)], frontHow, mgr: [...new Set(mgr)], mgrHow, signed, staff: all };
}

/* ---------------------------------- findings ---------------------------------- */

// What went wrong on `day`. With `cut` (today, live preview) only items whose time has passed are counted
// and the attendance / leave checks are left out.
async function findings(env, day, cf, cut) {
  const end = cut || day + 'T23:59';
  const ref = (type, id) => ({ ref_type: type, ref_id: id });
  const out = [];
  const pt = a => `${a.patient_name}${a.patient_no ? ' (' + a.patient_no + ')' : ''}`;
  const appts = await env.DB.prepare(`SELECT a.id, a.start_at, a.minutes, a.status, a.closure, a.invoice_id, i.status inv_status, p.name patient_name, p.patient_no, d.name doctor_name
      FROM cl_appointments a JOIN cl_patients p ON p.id=a.patient_id LEFT JOIN cl_invoices i ON i.id=a.invoice_id LEFT JOIN ems_staff d ON d.id=a.doctor_id
      WHERE substr(a.start_at,1,10)=? ORDER BY a.start_at`).bind(day).all().then(r => r.results || []);
  const finished = a => addMin(a.start_at, a.minutes + GRACE) <= end;
  const marks = await env.DB.prepare("SELECT entity_id, detail, at FROM cl_audit WHERE action='appt.status' AND entity='appointment' AND entity_id IN (SELECT id FROM cl_appointments WHERE substr(start_at,1,10)=?) ORDER BY id").bind(day).all().then(r => r.results || []);
  for (const a of appts) {
    if (!finished(a) && a.status !== 'completed') continue;
    const what = `${pt(a)} · ${ft(a.start_at)}${a.doctor_name ? ' · ' + a.doctor_name : ''}`;
    if (a.status === 'booked') out.push({ code: 'no_arrival', ...ref('appointment', a.id), detail: what });
    else if (['arrived', 'in_treatment'].includes(a.status)) out.push({ code: 'not_completed', ...ref('appointment', a.id), detail: what });
    else if (a.status === 'completed' && (!a.closure || (a.closure === 'billed' && a.inv_status === 'draft'))) out.push({ code: 'not_billed', ...ref('appointment', a.id), detail: what + (a.inv_status === 'draft' ? ' · draft bill not finalised' : '') });
    const first = marks.find(m => m.entity_id === a.id && /^booked → (arrived|in_treatment|completed)/.test(m.detail || ''));
    if (first && istOf(first.at) > addMin(a.start_at, a.minutes + GRACE)) out.push({ code: 'late_mark', ...ref('appointment', a.id), detail: `${what} · marked at ${ft(istOf(first.at))}${istOf(first.at).slice(0, 10) !== day ? ' on ' + fd(istOf(first.at)) : ''}` });
  }
  {
    // Visits from the 3 days before still not closed.
    const older = await env.DB.prepare(`SELECT a.id, a.start_at, p.name patient_name, p.patient_no, i.status inv_status FROM cl_appointments a JOIN cl_patients p ON p.id=a.patient_id LEFT JOIN cl_invoices i ON i.id=a.invoice_id
        WHERE a.status='completed' AND (a.closure IS NULL OR (a.closure='billed' AND i.status='draft')) AND substr(a.start_at,1,10) BETWEEN ? AND ? AND substr(a.start_at,1,10) >= ?`)
      .bind(addDays(day, -3), addDays(day, -1), cf.from || day).all().then(r => r.results || []);
    for (const a of older) out.push({ code: 'still_unbilled', ...ref('appointment', a.id), detail: `${pt(a)} · visit of ${fd(a.start_at)} ${ft(a.start_at)}` });
  }
  const unpaid = await env.DB.prepare(`SELECT i.id, i.invoice_no, i.total, COALESCE((SELECT SUM(a.amount) FROM cl_allocations a JOIN cl_payments pay ON pay.id=a.payment_id WHERE a.invoice_id=i.id AND pay.voided=0),0) paid, p.name patient_name, p.patient_no
      FROM cl_invoices i JOIN cl_patients p ON p.id=i.patient_id WHERE i.status='final' AND i.legacy=0 AND i.invoice_date=?`).bind(day).all().then(r => (r.results || []).filter(x => x.total - x.paid >= 1));
  if (!cut || cut.slice(11) >= '20:00') for (const i of unpaid) out.push({ code: 'unpaid', ...ref('invoice', i.id), detail: `${i.invoice_no} · ${pt(i)} · Rs. ${Math.round(i.total - i.paid)} not collected` });
  const units = String(cf.s.ems_calendar_units || '1').split(',').map(Number).filter(Boolean);
  const ems = await env.DB.prepare(`SELECT a.id, a.start_at, a.duration minutes, COALESCE(c.name, a.guest_name, 'Guest') client_name FROM ems_appointments a LEFT JOIN ems_clients c ON c.id=a.client_id
      WHERE substr(a.start_at,1,10)=? AND a.status='booked' AND a.unit_id IN (${units.join(',') || 0})`).bind(day).all().then(r => r.results || []);
  for (const a of ems) if (addMin(a.start_at, (a.minutes || 30) + GRACE) <= end) out.push({ code: 'ems_unmarked', ...ref('ems_appointment', a.id), detail: `${a.client_name} · EMS ${ft(a.start_at)}` });
  return out;
}

// Attendance, leave and documents — per person (day close only).
async function personal(env, day, cf, roster) {
  const out = [];
  const ids = new Set(roster.staff.map(x => x.id));
  const { rows } = await monthData(env, day.slice(0, 7));
  for (const r of rows) {
    if (!ids.has(r.staff_id)) continue;
    const d = r.days.find(x => x.day === day);
    if (!d || !d.working) continue;
    if (d.status === 'absent') out.push({ staff_id: r.staff_id, code: 'absent', ref_type: 'day', ref_id: 0, detail: `No attendance and no approved leave on ${fd(day)}` });
    if (d.late) out.push({ staff_id: r.staff_id, code: 'late', ref_type: 'day', ref_id: 0, detail: `First in ${d.first_in} (shift ${String(r.profile.shift_start || '').slice(0, 5)})` });
    if (d.open || d.missing_out) out.push({ staff_id: r.staff_id, code: 'no_clock_out', ref_type: 'day', ref_id: 0, detail: `Clocked in ${d.first_in || ''}, no clock-out` });
  }
  // Leave waiting > 48 h: the approver(s).
  const appr = approverIds(cf.s).filter(id => ids.has(id));
  if (appr.length) {
    const cutoff = new Date(Date.parse(day + 'T23:59:00Z') - IST - 48 * 3600000).toISOString().slice(0, 19) + 'Z';
    const { results } = await env.DB.prepare("SELECT l.id, l.staff_id, l.from_date, l.applied_at, s.name FROM cl_leave l JOIN ems_staff s ON s.id=l.staff_id WHERE l.status='pending' AND l.applied_at <= ?").bind(cutoff).all();
    for (const l of results || []) {
      if (appr.includes(l.staff_id)) continue; // an approver's own leave is decided by the clinic admin
      for (const a of appr) out.push({ staff_id: a, code: 'leave_pending', ref_type: 'leave', ref_id: l.id, detail: `${l.name} — leave from ${fd(l.from_date)}, applied ${fd(istOf(l.applied_at))}` });
    }
  }
  // Documents due by the day and not signed (automatic duty notices excluded).
  const { results: docs } = await env.DB.prepare(`SELECT d.id, d.ref_no, d.title, r.staff_id FROM cl_docs d JOIN cl_doc_recipients r ON r.doc_id=d.id
      WHERE d.status='issued' AND d.requires_ack=1 AND d.due_date=? AND r.ack_at IS NULL AND r.refused_at IS NULL AND d.kind <> 'duty'`).bind(day).all();
  for (const d of docs || []) if (ids.has(d.staff_id)) out.push({ staff_id: d.staff_id, code: 'doc_overdue', ref_type: 'doc', ref_id: d.id, detail: `${d.ref_no} ${d.title}` });
  return out;
}

// Who carries each finding.
function attribute(list, roster) {
  const out = [];
  for (const f of list) {
    if (f.staff_id != null) { out.push(f); continue; }
    const who = CODES[f.code].who === 'front' ? roster.front : roster.mgr;
    if (!who.length) out.push({ ...f, staff_id: 0 });
    else for (const id of who) out.push({ ...f, staff_id: id });
  }
  return out;
}

/* ---------------------------------- day close ---------------------------------- */

export async function closeDay(env, day, opts = {}) {
  const cf = await config(env);
  if (!cf.from || day < cf.from) return { day, skipped: 'Duty Watch has not started for this day.', recorded: 0 };
  if (day >= today()) return { day, skipped: 'A day is closed after it ends.', recorded: 0 };
  const roster = await rosterFor(env, day, cf);
  const front = await findings(env, day, cf, null);
  const list = attribute(front, roster);
  // The duty manager: once a day, when front-desk items were left unresolved.
  if (front.filter(f => f.code !== 'late_mark').length) {
    const n = front.filter(f => f.code !== 'late_mark').length;
    list.push(...attribute([{ code: 'mgr_no_action', ref_type: 'day', ref_id: 0, detail: `${n} front-desk item(s) left unresolved: ${[...new Set(front.map(f => CODES[f.code].label.toLowerCase()))].join(', ')}` }], roster));
  }
  list.push(...await personal(env, day, cf, roster));
  const stmts = list.map(f => env.DB.prepare(`INSERT OR IGNORE INTO cl_duty_lapses (day, staff_id, code, ref_type, ref_id, detail, points, how) VALUES (?,?,?,?,?,?,?,?)`)
    .bind(day, f.staff_id, f.code, f.ref_type, f.ref_id || 0, clean(f.detail, 300), cf.points[f.code], CODES[f.code].who === 'front' ? roster.frontHow : CODES[f.code].who === 'manager' ? roster.mgrHow : null));
  let recorded = 0;
  for (let i = 0; i < stmts.length; i += 50) for (const r of await env.DB.batch(stmts.slice(i, i + 50))) recorded += r.meta.changes || 0;
  await env.DB.prepare("INSERT INTO cl_settings (key, value) VALUES ('duty_last_closed', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE excluded.value > cl_settings.value").bind(day).run();
  // Escalate first (on lapses already notified), then send today's notices.
  const cases = opts.escalate === false ? [] : await escalate(env, cf, day);
  const notices = opts.notices === false ? [] : await sendNotices(env, cf);
  return { day, recorded, notices, cases, front: roster.front, front_how: roster.frontHow, mgr: roster.mgr };
}

// Cron: close every day since the last one closed (up to 7 back), so a missed run catches up.
export async function dutyDaily(env) {
  const cf = await config(env);
  if (!cf.from) return;
  const s = await settings(env);
  let d = isDate(s.duty_last_closed) ? addDays(s.duty_last_closed, 1) : cf.from;
  const y = addDays(today(), -1);
  if (d < addDays(y, -6)) d = addDays(y, -6);
  if (d < cf.from) d = cf.from;
  for (; d <= y; d = addDays(d, 1)) await closeDay(env, d);
}

/* ---------------------------------- notices ---------------------------------- */

async function monthPoints(env, staffId, month) {
  const r = await env.DB.prepare("SELECT COALESCE(SUM(points),0) p FROM cl_duty_lapses WHERE staff_id=? AND substr(day,1,7)=? AND status <> 'excused'").bind(staffId, month).first();
  return r.p;
}
async function sendNotices(env, cf) {
  const { results } = await env.DB.prepare(`SELECT l.*, s.name, p.designation FROM cl_duty_lapses l JOIN ems_staff s ON s.id=l.staff_id LEFT JOIN cl_staff_pay p ON p.staff_id=l.staff_id
      WHERE l.notice_doc_id IS NULL AND l.status='open' AND l.staff_id > 0 ORDER BY l.staff_id, l.day, l.id`).all();
  const by = new Map();
  for (const l of results || []) { if (!by.has(l.staff_id)) by.set(l.staff_id, []); by.get(l.staff_id).push(l); }
  const sent = [];
  for (const [sid, lapses] of by) {
    const month = lapses[lapses.length - 1].day.slice(0, 7);
    const pts = await monthPoints(env, sid, month), score = Math.max(0, 100 - pts);
    const ref = await nextDutyRef(env);
    const days = [...new Set(lapses.map(l => l.day))];
    const title = `Duty lapse notice — ${days.map(fd).join(', ')}`;
    const bytes = await noticePdf(env, cf, { ref, staff: lapses[0], lapses, pts, score, month });
    const sig = { name: 'Hasta Duty Watch (automatic)', title: 'Issued by the clinic app on behalf of the Operations Head', at: nowIso(), ip: '' };
    const body = `${lapses.length} duty lapse(s), ${lapses.reduce((s2, l) => s2 + l.points, 0)} point(s). Your duty score for ${month}: ${score}/100. Sign to confirm you have received this notice; choose "I disagree" and explain if a lapse is wrong.`;
    const doc = await issueGenerated(env, SYSTEM, { kind: 'duty', ref_no: ref, title, body, bytes, file_name: ref.replace(/\//g, '-') + '.pdf', staff_ids: [sid], due_date: addDays(today(), 3), source: 'duty', source_id: sid, sig });
    await env.DB.prepare(`UPDATE cl_duty_lapses SET notice_doc_id=? WHERE id IN (${lapses.map(() => '?').join(',')})`).bind(doc.id, ...lapses.map(l => l.id)).run();
    sent.push({ staff_id: sid, ref_no: doc.ref_no, lapses: lapses.length });
  }
  return sent;
}
async function nextDutyRef(env) {
  const pre = `DUTY/${today().slice(0, 4)}/`;
  const last = await env.DB.prepare('SELECT ref_no FROM cl_docs WHERE ref_no LIKE ? ORDER BY id DESC LIMIT 1').bind(pre + '%').first();
  return pre + String((last ? parseInt(last.ref_no.slice(pre.length), 10) : 0) + 1).padStart(4, '0');
}
async function noticePdf(env, cf, { ref, staff, lapses, pts, score, month }) {
  const s = cf.s, k = await pdfKit(s);
  k.text(`Ref: ${ref}`, k.L, 10, k.bold); k.right(`Date: ${fd(today())}`, k.L + k.W, 10); k.y -= 26;
  k.text('To', k.L, 9, k.reg, k.muted); k.y -= 13; k.text(safe(staff.name), k.L, 11, k.bold); k.y -= 13;
  if (staff.designation) { k.text(safe(staff.designation), k.L, 9.5); k.y -= 13; }
  k.y -= 10; k.text('Subject: Duty lapse notice (Duty Watch)', k.L, 11, k.bold); k.y -= 22;
  k.wrap(`The clinic app checks at the end of every working day that appointments, treatments, bills, attendance and documents were completed by the person on duty. The following lapse(s) have been recorded against you:`, 10);
  k.y -= 8;
  const cols = [['Date', k.L], ['Lapse', k.L + 62], ['Details', k.L + 200], ['Points', k.L + k.W]];
  for (const [t, x] of cols) t === 'Points' ? k.right(t, x, 8.5, k.bold) : k.text(t, x, 8.5, k.bold);
  k.y -= 13;
  for (const l of lapses) {
    if (k.y < 120) k.newPage();
    k.text(fd(l.day), k.L, 8.5); k.text(safe(CODES[l.code].label), k.L + 62, 8.5, k.bold); k.right(String(l.points), k.L + k.W, 9, k.bold);
    k.wrap(safe(l.detail || ''), 8.5, k.reg, k.L + 200, k.W - 230, 11);
    if (l.how && CODES[l.code].who !== 'all') { k.text(safe(`Responsible as: ${l.how}`), k.L + 200, 7.5, k.reg, k.muted); k.y -= 11; }
    k.y -= 3;
  }
  k.y -= 6;
  k.text(`Total: ${lapses.reduce((a, l) => a + l.points, 0)} point(s). Your duty score for ${new Date(month + '-01T00:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' })} is now ${score}/100.`, k.L, 10, k.bold); k.y -= 20;
  for (const p of [
    'What this means: duty points are recorded on your performance record and appear in your monthly performance report. Every month starts at 100. Repeated lapses — ' + cf.escalate + ' or more points within 30 days, or the same lapse ' + cf.repeat + ' times — are referred to the Operations Head under the clinic\'s disciplinary procedure, which can lead to a warning.',
    'What to do: put the item right in the app today if it is still open (mark the arrival or completion, finish the bill, collect the payment). If you were not responsible, or there was a good reason, choose "I disagree" when you sign this notice and explain — your manager will review it and can excuse the lapse, which removes the points.',
    'This notice is a record of facts, not a disciplinary warning. No deduction is made from your salary for duty points.',
  ]) { if (k.y < 120) k.newPage(); k.wrap(p, 9.5); k.y -= 6; }
  if (k.y < 140) k.newPage();
  k.y -= 10; k.text(`For ${safe(s.legal_name || 'HASWEL CARE Private Limited')}`, k.L, 10); k.y -= 18;
  k.text('Hasta Duty Watch (automatic)', k.L, 11, k.bold); k.y -= 12; k.text('Issued by the clinic app on behalf of the Operations Head', k.L, 9); k.y -= 12;
  k.text(`Generated ${new Date(Date.now() + IST).toISOString().replace('T', ' ').slice(0, 16)} IST`, k.L, 8, k.reg, k.muted); k.y -= 24;
  k.wrap('Employee acknowledgement: this notice is in the Hasta Clinic app (My documents). Signing confirms that you have received it; it does not mean you agree with it.', 8.5, k.reg, k.L, k.W, 11);
  return await k.pdf.save();
}

/* ---------------------------------- escalation ---------------------------------- */

async function escalate(env, cf, day) {
  const from = addDays(day, -29);
  const { results } = await env.DB.prepare(`SELECT l.*, s.name FROM cl_duty_lapses l JOIN ems_staff s ON s.id=l.staff_id
      WHERE l.staff_id > 0 AND l.status='open' AND l.case_id IS NULL AND l.day BETWEEN ? AND ? AND s.active=1 ORDER BY l.day, l.id`).bind(from, day).all();
  const by = new Map();
  for (const l of results || []) { if (!by.has(l.staff_id)) by.set(l.staff_id, []); by.get(l.staff_id).push(l); }
  const opened = [];
  for (const [sid, ls] of by) {
    const pts = ls.reduce((a, l) => a + l.points, 0);
    // The same lapse counts once per day; repeats are counted over separate days.
    const days = {}; for (const l of ls) (days[l.code] ||= new Set()).add(l.day);
    const rep = Object.entries(days).map(([c, d]) => [c, d.size]).find(([, n]) => n >= cf.repeat);
    if (pts < cf.escalate && !rep) continue;
    // Fairness: only after a written notice — there must be a lapse on a day after the first notice was issued.
    const first = await env.DB.prepare(`SELECT MIN(d.issued_at) at FROM cl_docs d WHERE d.id IN (${ls.map(() => '?').join(',')})`).bind(...ls.map(l => l.notice_doc_id || 0)).first();
    const warnedOn = first && first.at ? istOf(first.at).slice(0, 10) : null;
    if (!warnedOn || !ls.some(l => l.day >= warnedOn)) continue;
    const ruleDoc = await env.DB.prepare(`SELECT d.id, d.ref_no, d.title FROM cl_docs d JOIN cl_doc_recipients r ON r.doc_id=d.id AND r.staff_id=? WHERE d.status='issued' AND d.kind IN ('policy','memo')
        AND (d.title LIKE '%Duty Watch%' OR d.title LIKE '%Code of Conduct%') ORDER BY (d.title LIKE '%Duty Watch%') DESC, d.id DESC LIMIT 1`).bind(sid).first();
    const pre = `DC/${today().slice(0, 4)}/`;
    const last = await env.DB.prepare('SELECT case_no FROM cl_disc_cases WHERE case_no LIKE ? ORDER BY id DESC LIMIT 1').bind(pre + '%').first();
    const no = pre + String((last ? parseInt(last.case_no.slice(pre.length), 10) : 0) + 1).padStart(4, '0');
    const lines = ls.slice(0, 25).map(l => `${fd(l.day)}: ${CODES[l.code].label} — ${l.detail}`);
    const why = rep ? `the same lapse ("${CODES[rep[0]].label}") was recorded ${rep[1]} times` : `${pts} duty points were recorded`;
    const allegation = `Duty Watch recorded ${ls.length} duty lapse(s) between ${fd(ls[0].day)} and ${fd(ls[ls.length - 1].day)} (${pts} points); ${why} within 30 days, including after the employee was given a written duty lapse notice on ${fd(warnedOn)}. The lapses: ${lines.join('; ')}${ls.length > 25 ? `; and ${ls.length - 25} more` : ''}.`;
    const rule = ruleDoc ? `${ruleDoc.title} — duties of the role: every arrival, completion, bill and payment recorded in the app on the day; attendance and documents on time` : 'Clinic procedures — every arrival, completion, bill and payment recorded in the app on the day; attendance and documents on time';
    const evidence = `Duty Watch lapse records and duty lapse notices (${[...new Set(ls.map(l => l.notice_doc_id).filter(Boolean))].length} notice(s)); appointment, billing and attendance records and the app's audit trail for those dates.`;
    const cat = ls.every(l => ['late', 'absent', 'no_clock_out'].includes(l.code)) ? 'attendance' : ls.some(l => ['unpaid', 'not_billed', 'still_unbilled'].includes(l.code)) ? 'financial' : 'procedure';
    const id = (await env.DB.prepare(`INSERT INTO cl_disc_cases (case_no, staff_id, category, incident_date, incident_end, allegation, rule_breached, rule_doc_id, evidence, attachments, raised_by, raised_by_name)
      VALUES (?,?,?,?,?,?,?,?,?,'[]',0,'Hasta Duty Watch (automatic)')`).bind(no, sid, cat, ls[0].day, ls[ls.length - 1].day, allegation.slice(0, 1500), rule.slice(0, 400), ruleDoc ? ruleDoc.id : null, evidence).run()).meta.last_row_id;
    await env.DB.prepare(`UPDATE cl_duty_lapses SET case_id=? WHERE id IN (${ls.map(() => '?').join(',')})`).bind(id, ...ls.map(l => l.id)).run();
    await audit(env, SYSTEM, 'disc.open', 'disc_case', id, `${no} ${ls[0].name}: Duty Watch escalation (${pts} pts${rep ? ', repeated ' + rep[0] : ''})`);
    opened.push({ staff_id: sid, case_id: id, case_no: no });
  }
  return opened;
}

/* ---------------------------------- scoreboard ---------------------------------- */

async function board(env, cf, month, onlyId) {
  const { results: staff } = await env.DB.prepare(`SELECT s.id, s.name, s.role, s.skills, p.designation FROM ems_staff s LEFT JOIN cl_staff_pay p ON p.staff_id=s.id
      WHERE s.active=1 AND s.external=0 AND s.role <> 'trainee' AND s.username <> 'hasta' ORDER BY s.name`).all();
  const { results: lapses } = await env.DB.prepare(`SELECT l.*, d.ref_no notice_ref, r.ack_at notice_ack, r.response notice_response, r.ack_comment notice_comment, c.case_no
      FROM cl_duty_lapses l LEFT JOIN cl_docs d ON d.id=l.notice_doc_id LEFT JOIN cl_doc_recipients r ON r.doc_id=l.notice_doc_id AND r.staff_id=l.staff_id
      LEFT JOIN cl_disc_cases c ON c.id=l.case_id WHERE substr(l.day,1,7)=? ${onlyId != null ? 'AND l.staff_id=?' : ''} ORDER BY l.day DESC, l.id DESC`).bind(...[month, ...(onlyId != null ? [onlyId] : [])]).all();
  const L = lapses || [];
  const d30 = addDays(today(), -30);
  const roll = await env.DB.prepare("SELECT staff_id, SUM(points) p FROM cl_duty_lapses WHERE status='open' AND case_id IS NULL AND day > ? GROUP BY staff_id").bind(d30).all().then(r => Object.fromEntries((r.results || []).map(x => [x.staff_id, x.p])));
  const sup = id => isSuper({ id, username: '' }, cf.s);
  const rows = (staff || []).filter(x => !sup(x.id) && (onlyId == null || x.id === onlyId)).map(x => {
    const mine = L.filter(l => l.staff_id === x.id);
    const counted = mine.filter(l => l.status !== 'excused');
    const points = counted.reduce((a, l) => a + l.points, 0), score = Math.max(0, 100 - points);
    const by = {}; for (const l of counted) by[l.code] = (by[l.code] || 0) + 1;
    return { staff_id: x.id, name: x.name, role: x.role, designation: x.designation, front: skillsOf(x).includes('front'), points, score, band: band(score), by,
      lapses: counted.length, excused: mine.length - counted.length, disputed: mine.filter(l => l.notice_response === 'disputed' && l.status === 'open').length,
      unsigned: new Set(mine.filter(l => l.notice_doc_id && !l.notice_ack).map(l => l.notice_doc_id)).size,
      rolling: roll[x.id] || 0, escalate_at: cf.escalate, cases: [...new Set(mine.filter(l => l.case_no).map(l => l.case_no))] };
  }).sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  // Front desk performance for the month (days already closed).
  const lastClosed = cf.s.duty_last_closed || '';
  const from = cf.from && cf.from > month + '-01' ? cf.from : month + '-01', to = lastClosed < month + '-31' ? lastClosed : month + '-31';
  let kpi = null;
  if (cf.from && to >= from) {
    const a = await env.DB.prepare("SELECT COUNT(*) n, SUM(status='completed') done FROM cl_appointments WHERE substr(start_at,1,10) BETWEEN ? AND ? AND status <> 'cancelled'").bind(from, to).first();
    const n = code => L.filter(l => l.code === code && l.day >= from && l.day <= to).map(l => l.ref_id);
    const uniq = arr => new Set(arr).size;
    kpi = { from, to, appointments: a.n || 0, completed: a.done || 0,
      arrival_ok: a.n ? Math.round(100 * (a.n - uniq(n('no_arrival'))) / a.n) : null,
      billed_same_day: a.done ? Math.round(100 * (a.done - uniq(n('not_billed'))) / a.done) : null,
      marked_on_time: a.n ? Math.round(100 * (a.n - uniq(n('no_arrival')) - uniq(n('late_mark'))) / a.n) : null };
  }
  const unassigned = L.filter(l => l.staff_id === 0 && l.status === 'open');
  return { month, rows, unassigned, lapses: L.filter(l => l.staff_id > 0), kpi };
}

async function reportPdf(env, cf, staffId, month) {
  const b = await board(env, cf, month, staffId);
  const r = b.rows[0];
  if (!r) return null;
  const s = cf.s, k = await pdfKit(s);
  const mLong = new Date(month + '-01T00:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' });
  k.text('Monthly performance report — duty', k.L, 15, k.bold); k.y -= 20;
  k.text(`${safe(r.name)}${r.designation ? ' · ' + safe(r.designation) : ''}`, k.L, 11, k.bold); k.right(mLong, k.L + k.W, 10); k.y -= 24;
  k.text(`Duty score: ${r.score}/100 — ${r.band.label}`, k.L, 13, k.bold); k.y -= 16;
  k.text(`${r.lapses} lapse(s), ${r.points} point(s) · ${r.excused} excused · ${r.disputed} disputed and awaiting review`, k.L, 9.5); k.y -= 13;
  k.text(`Points in the last 30 days not yet referred: ${r.rolling} (referral to the disciplinary procedure at ${cf.escalate})`, k.L, 9.5, k.reg, k.muted); k.y -= 13;
  if (r.cases.length) { k.text(`Referred to the disciplinary procedure: ${r.cases.join(', ')}`, k.L, 9.5, k.bold); k.y -= 13; }
  const { rows: att } = await monthData(env, month, [staffId]);
  if (att[0]) { const p = att[0].pay; k.text(`Attendance: ${p.worked_hours} h worked of ${p.contract_hours} h · late ${p.late_days} · absent ${p.absent_days} · missing clock-out ${p.missing_out}`, k.L, 9.5); k.y -= 13; }
  k.y -= 8; k.text('By type', k.L, 11, k.bold); k.y -= 15;
  const types = Object.entries(r.by);
  if (!types.length) { k.text('No lapses recorded this month.', k.L, 9.5); k.y -= 13; }
  for (const [c, n] of types) { k.text(safe(CODES[c].label), k.L, 9.5); k.right(`${n} × ${cf.points[c]} pt`, k.L + 260, 9.5); k.y -= 13; }
  k.y -= 8; k.text('Lapses', k.L, 11, k.bold); k.y -= 15;
  const mine = b.lapses.filter(l => l.staff_id === staffId).reverse();
  for (const l of mine) {
    if (k.y < 80) k.newPage();
    k.text(fd(l.day), k.L, 8.5); k.text(safe(CODES[l.code].label), k.L + 62, 8.5, k.bold); k.right(l.status === 'excused' ? 'excused' : String(l.points), k.L + k.W, 8.5, k.bold);
    k.wrap(safe(l.detail || '') + (l.notice_ref ? ` · notice ${l.notice_ref}${l.notice_response === 'disputed' ? ' (disputed)' : ''}` : '') + (l.status === 'excused' ? ` · excused by ${l.excused_by_name}: ${l.excused_reason}` : ''), 8.5, k.reg, k.L + 200, k.W - 230, 11);
    k.y -= 2;
  }
  k.y -= 12; if (k.y < 100) k.newPage();
  k.wrap('Score = 100 minus duty points for the month (excused lapses do not count). Good: 90 and above. Needs attention: 75–89. Poor: below 75. Duty points are not deducted from pay.', 8, k.reg, k.L, k.W, 11);
  k.text(`Generated ${new Date(Date.now() + IST).toISOString().replace('T', ' ').slice(0, 16)} IST by the Hasta Clinic app`, k.L, 8, k.reg, k.muted);
  return await k.pdf.save();
}

/* ---------------------------------- route ---------------------------------- */

export async function dutyRoute(request, env, url, me, p, m, b) {
  if (!p.startsWith('/hr/duty')) return null;
  const cf = await config(env);
  const sup = isSuper(me, cf.s), mgr = sup || isMgr(me) || cf.writtenBy.includes(me.id);
  const err = (e, s = 400) => json({ ok: false, error: e }, s);
  let mm;
  const q = k => url.searchParams.get(k);
  const month = isMonth(q('month')) ? q('month') : today().slice(0, 7);

  // Today: who is on the front desk / duty manager, and what would be recorded if the day closed now.
  if (p === '/hr/duty/today' && m === 'GET') {
    const d = today(), roster = await rosterFor(env, d, cf);
    const live = cf.from && d >= cf.from ? attribute(await findings(env, d, cf, nowLocal()), roster) : [];
    const name = id => (roster.staff.find(x => x.id === id) || {}).name || '—';
    const mine = live.filter(l => l.staff_id === me.id);
    return json({ ok: true, day: d, started: !!(cf.from && d >= cf.from), from: cf.from, signed: roster.signed, front: roster.front.map(id => ({ id, name: name(id) })), front_how: roster.frontHow,
      mgr: roster.mgr.map(id => ({ id, name: name(id) })), mgr_how: roster.mgrHow,
      pending: { items: new Set(live.map(l => l.code + l.ref_id)).size, points_each: Object.fromEntries([...new Set(live.map(l => l.staff_id))].map(id => [id, live.filter(l => l.staff_id === id).reduce((a, l) => a + cf.points[l.code], 0)])),
        by: live.filter(l => l.staff_id === (live[0] || {}).staff_id).reduce((o, l) => (o[l.code] = (o[l.code] || 0) + 1, o), {}), mine: mine.reduce((a, l) => a + cf.points[l.code], 0) },
      can_front: !me.limited && ((me.skills || []).includes('front') || me.role === 'manager'), can_mgr: !me.limited && (me.role === 'manager' || me.admin) && !sup, labels: Object.fromEntries(Object.entries(CODES).map(([k, c]) => [k, c.label])) });
  }
  if (p === '/hr/duty/signon' && m === 'POST') {
    const role = b.role === 'manager' ? 'manager' : 'front';
    if (role === 'front' && !((me.skills || []).includes('front') || me.role === 'manager')) return err('Only front-desk staff and managers can sign on to the front desk.', 403);
    if (role === 'manager' && !(me.role === 'manager' || me.admin)) return err('Only managers can sign on as duty manager.', 403);
    if (!me.id) return err('Sign in with your own account.', 403);
    await env.DB.prepare('INSERT OR IGNORE INTO cl_duty_signons (day, role, staff_id, on_at) VALUES (?,?,?,?)').bind(today(), role, me.id, nowLocal()).run();
    await audit(env, me, 'duty.signon', 'staff', me.id, role);
    return json({ ok: true });
  }
  if (p === '/hr/duty/signoff' && m === 'POST') {
    const role = b.role === 'manager' ? 'manager' : 'front';
    // Signing off is allowed only when someone else has taken over, so the desk is never left without a name.
    const others = await env.DB.prepare('SELECT COUNT(*) n FROM cl_duty_signons WHERE day=? AND role=? AND staff_id <> ?').bind(today(), role, me.id).first();
    if (!others.n) return err(`Someone else must sign on as ${role === 'front' ? 'front desk' : 'duty manager'} before you sign off — the day's items stay with you until then.`);
    await env.DB.prepare('DELETE FROM cl_duty_signons WHERE day=? AND role=? AND staff_id=?').bind(today(), role, me.id).run();
    await audit(env, me, 'duty.signoff', 'staff', me.id, role);
    return json({ ok: true });
  }
  // My score (everyone, including staff with attendance-only access).
  if (p === '/hr/duty/me' && m === 'GET') {
    const bd = await board(env, cf, month, me.id);
    return json({ ok: true, month, started: !!cf.from, from: cf.from, row: bd.rows[0] || null, lapses: bd.lapses, labels: Object.fromEntries(Object.entries(CODES).map(([k, c]) => [k, c.label])) });
  }
  if (p === '/hr/duty/report' && m === 'GET') {
    const sid = parseInt(q('staff_id'), 10);
    const id = Number.isFinite(sid) && mgr ? sid : me.id;
    const bytes = await reportPdf(env, cf, id, month);
    if (!bytes) return err('Not found.', 404);
    return pdfResponse(bytes, `Duty-report-${month}-${id}.pdf`);
  }
  if (!mgr) return err('Managers only.', 403);
  if (p === '/hr/duty' && m === 'GET') {
    const bd = await board(env, cf, month, null);
    return json({ ok: true, ...bd, from: cf.from, last_closed: cf.s.duty_last_closed || null, points: cf.points, escalate: cf.escalate, repeat: cf.repeat, sup,
      codes: Object.fromEntries(Object.entries(CODES).map(([k, c]) => [k, { label: c.label, who: c.who, help: c.help, default: c.points }])) });
  }
  if ((mm = p.match(/^\/hr\/duty\/lapses\/(\d+)\/(excuse|reinstate|assign)$/)) && m === 'POST') {
    const l = await env.DB.prepare('SELECT l.*, s.role, s.name FROM cl_duty_lapses l LEFT JOIN ems_staff s ON s.id=l.staff_id WHERE l.id=?').bind(+mm[1]).first();
    if (!l) return err('Not found.', 404);
    if (l.staff_id === me.id) return err('You cannot decide on your own lapses — the clinic admin or the Operations Head does.', 403);
    if (!sup && l.staff_id && (l.role === 'manager' || l.role === 'admin' || cf.writtenBy.includes(l.staff_id)) && !(cf.writtenBy.includes(me.id) && l.role !== 'admin' && !cf.writtenBy.includes(l.staff_id))) return err('Lapses of managers are reviewed by the clinic admin.', 403);
    if (mm[2] === 'excuse') {
      const reason = clean(b.reason, 300);
      if (reason.length < 8) return err('Give the reason for excusing it (e.g. patient left without telling the desk; system was down).');
      if (l.case_id) return err('This lapse is part of a disciplinary case — deal with it in the case.');
      await env.DB.prepare("UPDATE cl_duty_lapses SET status='excused', excused_by=?, excused_by_name=?, excused_reason=?, excused_at=? WHERE id=?").bind(me.id, me.name, reason, nowIso(), l.id).run();
      await audit(env, me, 'duty.excuse', 'duty_lapse', l.id, `${l.name || 'unassigned'} ${l.day} ${l.code}: ${reason}`);
    } else if (mm[2] === 'reinstate') {
      await env.DB.prepare("UPDATE cl_duty_lapses SET status='open', excused_by=NULL, excused_by_name=NULL, excused_reason=NULL, excused_at=NULL WHERE id=?").bind(l.id).run();
      await audit(env, me, 'duty.reinstate', 'duty_lapse', l.id, `${l.name} ${l.day} ${l.code}`);
    } else {
      if (l.staff_id) return err('Only unassigned lapses can be assigned.');
      const sid = parseInt(b.staff_id, 10);
      const st = await env.DB.prepare("SELECT id, name FROM ems_staff WHERE id=? AND active=1 AND external=0").bind(sid).first();
      if (!st) return err('Choose who was on duty.');
      const r = await env.DB.prepare('UPDATE OR IGNORE cl_duty_lapses SET staff_id=?, how=? WHERE id=?').bind(st.id, `assigned by ${me.name}`, l.id).run();
      if (!r.meta.changes) return err(`${st.name} already has this lapse.`);
      await audit(env, me, 'duty.assign', 'duty_lapse', l.id, `${l.day} ${l.code} → ${st.name}`);
    }
    return json({ ok: true });
  }
  if (!sup) return err('Only the clinic admin can do this.', 403);
  if (p === '/hr/duty/close' && m === 'POST') {
    if (!isDate(b.day)) return err('Choose the day.');
    return json({ ok: true, ...(await closeDay(env, b.day)) });
  }
  if (p === '/hr/duty/settings' && m === 'POST') {
    const sets = [];
    if (b.from !== undefined) { if (b.from && !isDate(b.from)) return err('Check the start date.'); sets.push(['duty_watch_from', b.from || '']); }
    if (b.escalate !== undefined) sets.push(['duty_escalate_points', String(Math.max(3, Math.min(50, parseInt(b.escalate, 10) || 10)))]);
    if (b.repeat !== undefined) sets.push(['duty_repeat', String(Math.max(2, Math.min(10, parseInt(b.repeat, 10) || 3)))]);
    if (b.points && typeof b.points === 'object') sets.push(['duty_points', JSON.stringify(Object.fromEntries(Object.keys(CODES).filter(k => b.points[k] !== undefined).map(k => [k, Math.max(0, Math.min(10, parseInt(b.points[k], 10) || 0))])))]);
    await env.DB.batch(sets.map(([k, v]) => env.DB.prepare('INSERT INTO cl_settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(k, v)));
    await audit(env, me, 'duty.settings', 'settings', null, sets.map(x => x.join('=')).join('; '));
    return json({ ok: true });
  }
  return err('Not found', 404);
}
