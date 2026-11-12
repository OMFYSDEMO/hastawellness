// Hasta Clinic — staff attendance, leave, absences / warning letters and monthly pay.
//
// Clock-in / out: the clinic desktop (a registered "kiosk") shows a QR code that changes every 30 seconds.
// A staff member scans it with their phone; the phone must be inside the clinic geofence. The first scan
// needs the staff member to be signed in; after that their phone is remembered for attendance only.
//
// Leave: staff apply in the app; only the leave approver(s) (Settings → Attendance, default Dr Akshara)
// can approve. Paid leave: 1 annual leave day accrues each month (configurable), plus optional sick /
// casual allowances per calendar year. A working day with no attendance and no approved leave is an
// unauthorised absence: its pay is deducted and a manager confirms it, which issues a warning letter.
//
// Pay (pro-rata, no overtime): hourly rate = monthly salary ÷ contract hours for the month
// (working days × daily hours; weekly off and clinic holidays are not working days and are paid).
// Paid hours = min(contract hours − absent/unpaid-leave days × daily hours, hours worked + paid leave hours).
// Pay = paid hours × rate. Salaries are visible to admins and managers only.
import { PDFDocument, StandardFonts, rgb } from './vendor/pdf-lib.esm.min.js';
import qrcode from './vendor/qrcode.js';
import { json, clean, nz, sha256 } from './util.js';
import { settings } from './clinic.js';
import { signerFor, issueGenerated } from './docs.js';

const IST = 330 * 60000;
const today = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
const nowSec = () => new Date(Date.now() + IST).toISOString().slice(0, 19);
const nowIso = () => new Date().toISOString().slice(0, 19) + 'Z';
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dow = d => new Date(d + 'T00:00:00Z').getUTCDay();
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const isMonth = s => /^\d{4}-\d{2}$/.test(s || '');
const isTime = s => /^\d{2}:\d{2}$/.test(s || '');
const r2 = x => Math.round((Number(x) || 0) * 100) / 100;
const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const randomHex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
const HEADERS = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'x-content-type-options': 'nosniff' };
const api = (data, status = 200) => json(data, status, HEADERS);
const done = ([status, error, extra]) => status === 200 ? api({ ok: true, ...(extra || {}) }) : api({ ok: false, error, ...(extra || {}) }, status);
const R = (s, e, x) => [s, e, x];
const OK = x => [200, null, x];
const canManage = u => u.admin || u.role === 'manager';
const deny = (m = 'Managers or admins only.') => api({ ok: false, error: m }, 403);
const minutesBetween = (a, b) => Math.max(0, Math.round((Date.parse(b + 'Z') - Date.parse(a + 'Z')) / 60000));
const monthDays = m => { const n = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate(); return Array.from({ length: n }, (_, i) => `${m}-${String(i + 1).padStart(2, '0')}`); };
const KINDS = { annual: 'Annual leave', sick: 'Sick leave', casual: 'Casual leave', unpaid: 'Unpaid leave' };
const PAID_KINDS = ['annual', 'sick', 'casual'];
const WINDOW_S = 30;

export const approverIds = s => String(s.leave_approvers || '').split(',').map(Number).filter(Boolean);
export const isApprover = (u, s) => { const ids = approverIds(s); return ids.length ? ids.includes(u.id) : u.admin; };

export async function audit(env, me, action, entity, id, detail) {
  await env.DB.prepare('INSERT INTO cl_audit (staff_id, staff_name, action, entity, entity_id, detail) VALUES (?,?,?,?,?,?)').bind(me.id, me.name, action, entity, id || null, detail ? String(detail).slice(0, 500) : null).run();
}

/* ---------------- kiosk QR (clinic desktop) ---------------- */
async function hmac(keyText, msg) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(keyText), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)));
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...sig.slice(0, 8)].map(b => A[b % 32]).join('');
}
const kioskCookie = (base, token, secure) => `hw_kiosk=${token}; Path=${base || '/'}; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Strict; Max-Age=${3 * 365 * 86400}`;
const deviceCookie = (base, token, secure) => `hw_att=${token}; Path=${base || '/'}; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Lax; Max-Age=${2 * 365 * 86400}`;
const cookie = (request, name) => { const m = (request.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([a-f0-9]{64})')); return m ? m[1] : null; };
const isSecure = url => !(url.protocol === 'http:' && /^(localhost|127\.)/.test(url.hostname));

async function kioskFrom(request, env) {
  const t = cookie(request, 'hw_kiosk'); if (!t) return null;
  return env.DB.prepare('SELECT * FROM cl_kiosks WHERE token_hash=? AND active=1').bind(await sha256(t)).first();
}
async function currentCode(k, offset = 0) {
  const w = Math.floor(Date.now() / 1000 / WINDOW_S) + offset;
  return `${k.id}-${await hmac(k.token_hash, 'att:' + w)}`;
}
function qrSvg(text) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  const n = q.getModuleCount(), m = 2; let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 2 * m} ${n + 2 * m}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#1d3437"/></svg>`;
}

// Kiosk endpoints work with the desktop's kiosk cookie, not a staff sign-in.
export async function kioskRoute(request, env, url, base, p) {
  if (p === '/kiosk/code' && request.method === 'GET') {
    const k = await kioskFrom(request, env);
    if (!k) return api({ ok: false, error: 'This computer is not set up as the attendance screen.' }, 401);
    const code = await currentCode(k);
    const link = `${url.origin}${base}/#/scan/${code}`;
    const left = WINDOW_S - Math.floor(Date.now() / 1000) % WINDOW_S;
    const [, recent] = await env.DB.batch([
      env.DB.prepare('UPDATE cl_kiosks SET last_seen=? WHERE id=?').bind(nowIso(), k.id),
      env.DB.prepare(`SELECT s.name, a.in_at, a.out_at FROM cl_attendance a JOIN ems_staff s ON s.id=a.staff_id WHERE a.day=? AND a.source='qr' ORDER BY COALESCE(a.out_at, a.in_at) DESC LIMIT 6`).bind(today()),
    ]);
    return api({ ok: true, kiosk: k.name, svg: qrSvg(link), refresh_in: left, recent: recent.results || [] });
  }
  return null;
}

/* ---------------- scan (phone) ---------------- */
function distanceM(a, b) {
  const R0 = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R0 * Math.asin(Math.sqrt(h));
}
export async function scanRoute(request, env, url, base, me, b) {
  // Who is scanning: a signed-in staff member, or a phone remembered from an earlier scan.
  let staffId = me ? me.id : null, setCookie = null;
  if (!staffId) {
    const t = cookie(request, 'hw_att');
    if (t) { const dvc = await env.DB.prepare('SELECT d.staff_id FROM cl_att_devices d JOIN ems_staff s ON s.id=d.staff_id AND s.active=1 WHERE d.token_hash=? AND d.active=1').bind(await sha256(t)).first(); if (dvc) staffId = dvc.staff_id; }
  }
  if (!staffId) return api({ ok: false, error: 'Please sign in once on this phone, then scan again.', code: 'signin' }, 401);
  if (staffId === 0) return api({ ok: false, error: 'The shared admin login cannot clock in. Sign in with your own account.' }, 400);
  const [s, prof] = await Promise.all([settings(env), env.DB.prepare('SELECT * FROM cl_staff_pay WHERE staff_id=?').bind(staffId).first()]);
  // 1. The code must be the one on the clinic desktop right now (or the previous one).
  const code = String(b.code || '').toUpperCase().trim(), m = code.match(/^(\d+)-([A-Z2-9]{8})$/);
  const k = m && await env.DB.prepare('SELECT * FROM cl_kiosks WHERE id=? AND active=1').bind(+m[1]).first();
  if (!k || ![await currentCode(k), await currentCode(k, -1), await currentCode(k, -2)].includes(code)) return api({ ok: false, error: 'This QR code has expired. Scan the code on the clinic desktop again.' }, 400);
  // 2. The phone must be at the clinic.
  const clinic = { lat: Number(s.geo_lat), lng: Number(s.geo_lng) }, radius = Number(s.geo_radius_m) || 150;
  if (!(clinic.lat && clinic.lng)) return api({ ok: false, error: 'The clinic location has not been set up yet. Ask a manager (Staff → Setup).' }, 400);
  const lat = Number(b.lat), lng = Number(b.lng), acc = Number(b.acc) || 9999;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return api({ ok: false, error: 'Allow location for this site so we can confirm you are at the clinic.', code: 'location' }, 400);
  const dist = Math.round(distanceM(clinic, { lat, lng }));
  if (acc > 250) return api({ ok: false, error: `Your phone's location is not precise enough (±${Math.round(acc)} m). Turn on precise location / GPS and try again.`, code: 'location' }, 400);
  if (dist > radius + Math.min(acc, 75)) return api({ ok: false, error: `You appear to be ${dist} m from the clinic. Clock-in only works at the clinic.`, code: 'far' }, 400);
  // Only the distance from the clinic is kept — not the phone's coordinates.
  const geo = JSON.stringify({ acc: Math.round(acc), dist });
  // 3. Toggle: open entry today → clock out; otherwise clock in. Ignore double scans within 2 minutes.
  const d = today(), now = nowSec();
  const open = await env.DB.prepare('SELECT * FROM cl_attendance WHERE staff_id=? AND day=? AND out_at IS NULL ORDER BY id DESC LIMIT 1').bind(staffId, d).first();
  const last = await env.DB.prepare('SELECT MAX(COALESCE(out_at, in_at)) t FROM cl_attendance WHERE staff_id=? AND day=?').bind(staffId, d).first();
  if (last && last.t && minutesBetween(last.t, now) < 2) return api({ ok: false, error: 'Already recorded a moment ago.' }, 400);
  let action;
  if (open) { await env.DB.prepare('UPDATE cl_attendance SET out_at=?, out_geo=? WHERE id=?').bind(now, geo, open.id).run(); action = 'out'; }
  else { await env.DB.prepare("INSERT INTO cl_attendance (staff_id, day, in_at, in_geo, source) VALUES (?,?,?,?, 'qr')").bind(staffId, d, now, geo).run(); action = 'in'; }
  // Remember this phone for future scans.
  if (me && !cookie(request, 'hw_att')) {
    const t = randomHex(32);
    await env.DB.prepare('INSERT INTO cl_att_devices (staff_id, token_hash, agent) VALUES (?,?,?)').bind(staffId, await sha256(t), clean(request.headers.get('user-agent'), 200)).run();
    setCookie = deviceCookie(base, t, isSecure(url));
  }
  const who = await env.DB.prepare('SELECT name FROM ems_staff WHERE id=?').bind(staffId).first();
  const late = action === 'in' && prof && !open && !(last && last.t) && now.slice(11, 16) > addMinutes(prof.shift_start, Number(s.att_grace_min) || 10);
  const res = api({ ok: true, action, name: who ? who.name : '', at: now, late, dist });
  if (setCookie) res.headers.append('set-cookie', setCookie);
  return res;
}
const addMinutes = (hhmm, n) => { const t = +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5) + n; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

/* ---------------- day-by-day calculation ---------------- */
// Status per day: na (not employed) · off (weekly off) · holiday · present · in (clocked in now) · leave · pending (leave awaiting approval) · absent · upcoming
function staffMonth(prof, month, att, leaves, holidays, absences, s) {
  const t = today(), days = monthDays(month), grace = Number(s.att_grace_min) || 10;
  const hol = new Map(holidays.map(h => [h.day, h.name]));
  const out = days.map(d => {
    const row = { day: d, entries: att.filter(a => a.day === d) };
    row.minutes = row.entries.reduce((n, a) => n + (a.out_at ? minutesBetween(a.in_at, a.out_at) : 0), 0);
    row.open = row.entries.some(a => !a.out_at);
    row.missing_out = row.open && d < t;
    const first = row.entries.map(a => a.in_at).sort()[0];
    row.first_in = first ? first.slice(11, 16) : null;
    const working = !(prof.joined_on && d < prof.joined_on) && !(prof.left_on && d > prof.left_on) && dow(d) !== prof.weekly_off && !hol.has(d);
    row.working = working;
    const lv = leaves.find(l => l.from_date <= d && l.to_date >= d && ['approved', 'pending'].includes(l.status));
    if (prof.joined_on && d < prof.joined_on || prof.left_on && d > prof.left_on) row.status = 'na';
    else if (hol.has(d)) { row.status = 'holiday'; row.label = hol.get(d); }
    else if (dow(d) === prof.weekly_off) row.status = 'off';
    else if (lv && lv.status === 'approved') { row.status = 'leave'; row.kind = lv.kind; row.leave_id = lv.id; }
    else if (row.entries.length) { row.status = row.open && d === t ? 'in' : 'present'; row.late = !!(row.first_in && row.first_in > addMinutes(prof.shift_start || '09:30', grace)); }
    else if (lv) { row.status = 'pending'; row.kind = lv.kind; row.leave_id = lv.id; }
    else if (d < t) { row.status = 'absent'; const ab = absences.find(a => a.day === d); row.confirmed = !!ab; row.letter_id = ab ? ab.letter_id : null; }
    else row.status = 'upcoming';
    if (row.status !== 'present' && row.status !== 'in' && row.entries.length) row.worked_extra = true;
    return row;
  });
  return out;
}
function payFor(prof, month, days) {
  const dh = Number(prof.daily_hours) || 8, sal = Number(prof.monthly_salary) || 0;
  const fullWorking = days.filter(d => dow(d.day) !== prof.weekly_off && d.status !== 'holiday').length; // whole month, for the rate
  const empWorking = days.filter(d => d.working).length;
  const contractH = fullWorking * dh, rate = contractH ? sal / contractH : 0;
  const n = st => days.filter(d => d.working && d.status === st).length;
  const paidLeave = days.filter(d => d.working && d.status === 'leave' && PAID_KINDS.includes(d.kind)).length;
  const unpaidLeave = days.filter(d => d.working && d.status === 'leave' && d.kind === 'unpaid').length;
  const absent = n('absent'), pending = n('pending');
  // Today is still in progress: count it as a full expected day rather than the hours so far.
  const t = today(), todayRow = days.find(d => d.day === t && d.working && ['in', 'present', 'upcoming'].includes(d.status));
  const workedH = r2(days.reduce((x, d) => x + (d === todayRow ? 0 : d.minutes), 0) / 60);
  const capH = Math.max(0, empWorking * dh - (absent + unpaidLeave + pending) * dh);
  // Days still to come this month are assumed worked in full, so a part-month shows the expected pay.
  const upcomingH = days.filter(d => d.working && (d.status === 'upcoming' || d === todayRow)).length * dh;
  const paidH = Math.min(capH, workedH + paidLeave * dh + upcomingH);
  const shortH = r2(Math.max(0, capH - (workedH + paidLeave * dh + upcomingH)));
  const ded = { not_employed: r2((fullWorking - empWorking) * dh * rate), absence: r2(absent * dh * rate), unpaid_leave: r2((unpaidLeave + pending) * dh * rate), short_hours: r2(shortH * rate) };
  const net = Math.round(rate * paidH);
  return {
    salary: sal, daily_hours: dh, working_days: fullWorking, employed_days: empWorking, contract_hours: r2(contractH), rate: r2(rate),
    worked_hours: workedH, paid_leave_days: paidLeave, unpaid_leave_days: unpaidLeave, pending_leave_days: pending, absent_days: absent,
    unconfirmed_absences: days.filter(d => d.working && d.status === 'absent' && !d.confirmed).length,
    late_days: days.filter(d => d.late).length, missing_out: days.filter(d => d.missing_out).length,
    paid_hours: r2(paidH), short_hours: shortH, projected_hours: upcomingH, deductions: ded, net,
  };
}
async function monthData(env, month, staffIds) {
  const from = month + '-01', to = month + '-31', s = await settings(env);
  const where = staffIds ? `WHERE p.staff_id IN (${staffIds.map(() => '?').join(',')})` : 'WHERE p.attendance_required=1';
  const [profs, att, leaves, hol, abs] = await env.DB.batch([
    env.DB.prepare(`SELECT p.*, s.name, s.role, s.active FROM cl_staff_pay p JOIN ems_staff s ON s.id=p.staff_id ${where} ORDER BY s.name`).bind(...(staffIds || [])),
    env.DB.prepare('SELECT * FROM cl_attendance WHERE day >= ? AND day <= ? ORDER BY in_at').bind(from, to),
    env.DB.prepare("SELECT * FROM cl_leave WHERE status IN ('approved','pending') AND from_date <= ? AND to_date >= ?").bind(to, from),
    env.DB.prepare('SELECT * FROM cl_holidays WHERE day >= ? AND day <= ?').bind(from, to),
    env.DB.prepare('SELECT * FROM cl_absences WHERE day >= ? AND day <= ?').bind(from, to),
  ]);
  return { s, rows: (profs.results || []).map(p => {
    const days = staffMonth(p, month, att.results.filter(a => a.staff_id === p.staff_id), leaves.results.filter(l => l.staff_id === p.staff_id), hol.results || [], abs.results.filter(a => a.staff_id === p.staff_id), s);
    return { staff_id: p.staff_id, name: p.name, profile: p, days, pay: payFor(p, month, days) };
  }) };
}

/* ---------------- leave balance ---------------- */
async function leaveBalance(env, staffId, s, prof) {
  const t = today(), y = t.slice(0, 4);
  const from = (prof && prof.leave_from) || (prof && prof.joined_on ? prof.joined_on.slice(0, 8) + '01' : t.slice(0, 8) + '01');
  const months = Math.max(0, (+t.slice(0, 4) - +from.slice(0, 4)) * 12 + (+t.slice(5, 7) - +from.slice(5, 7)) + 1);
  const { results } = await env.DB.prepare("SELECT kind, from_date, days d FROM cl_leave WHERE staff_id=? AND status IN ('approved','pending')").bind(staffId).all();
  const used = (k, yr) => (results || []).filter(r => r.kind === k && (!yr || r.from_date.slice(0, 4) === yr)).reduce((n, r) => n + r.d, 0);
  const usedAnnual = (results || []).filter(r => r.kind === 'annual' && r.from_date >= from).reduce((n, r) => n + r.d, 0);
  return {
    annual: r2((Number(prof && prof.leave_opening) || 0) + months * (Number(s.leave_annual_per_month) || 0) - usedAnnual),
    sick: r2((Number(s.leave_sick_per_year) || 0) - used('sick', y)),
    casual: r2((Number(s.leave_casual_per_year) || 0) - used('casual', y)),
  };
}
async function workingDaysBetween(env, prof, from, to) {
  const { results } = await env.DB.prepare('SELECT day FROM cl_holidays WHERE day >= ? AND day <= ?').bind(from, to).all();
  const hol = new Set((results || []).map(r => r.day)); let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (dow(d) !== (prof ? prof.weekly_off : 0) && !hol.has(d)) n++;
  return n;
}
async function applyLeave(env, me, b, onBehalf) {
  const staffId = onBehalf ? Number(b.staff_id) : me.id;
  const from = b.from_date, to = b.to_date || b.from_date, kind = KINDS[b.kind] ? b.kind : null, reason = clean(b.reason, 300);
  if (!isDate(from) || !isDate(to) || to < from) return R(400, 'Choose the dates.');
  if (!kind) return R(400, 'Choose the type of leave.');
  if (reason.length < 3) return R(400, 'Give a reason.');
  if (addDays(from, 60) < to) return R(400, 'Apply for at most 60 days at a time.');
  if (!onBehalf && from < today()) return R(400, 'Leave must be applied for before the day. For a past day, ask Dr Akshara or a manager — it may be treated as an absence.');
  const prof = await env.DB.prepare('SELECT * FROM cl_staff_pay WHERE staff_id=?').bind(staffId).first();
  const clash = await env.DB.prepare("SELECT id FROM cl_leave WHERE staff_id=? AND status IN ('approved','pending') AND from_date <= ? AND to_date >= ?").bind(staffId, to, from).first();
  if (clash) return R(400, 'You already have leave applied for some of these days.');
  const days = await workingDaysBetween(env, prof, from, to);
  if (!days) return R(400, 'Those dates are your weekly off or clinic holidays — no leave needed.');
  if (PAID_KINDS.includes(kind)) {
    const bal = await leaveBalance(env, staffId, await settings(env), prof);
    if (days > bal[kind]) return R(400, `${KINDS[kind]} left: ${Math.max(0, bal[kind])} day(s). Apply for the rest as unpaid leave.`);
  }
  const r = await env.DB.prepare('INSERT INTO cl_leave (staff_id, from_date, to_date, days, kind, reason, applied_by) VALUES (?,?,?,?,?,?,?)').bind(staffId, from, to, days, kind, reason, me.id).run();
  await audit(env, me, 'leave.apply', 'leave', r.meta.last_row_id, `${staffId} ${kind} ${from}–${to} (${days} d)`);
  return OK({ id: r.meta.last_row_id, days });
}
async function decideLeave(env, me, id, b) {
  const l = await env.DB.prepare('SELECT * FROM cl_leave WHERE id=?').bind(id).first();
  if (!l) return R(404, 'Not found.');
  if (l.status !== 'pending') return R(400, 'This application has already been decided.');
  const st = b.status === 'approved' ? 'approved' : b.status === 'rejected' ? 'rejected' : null;
  if (!st) return R(400, 'Approve or reject.');
  if (st === 'rejected' && clean(b.note, 300).length < 3) return R(400, 'Give a reason for rejecting.');
  await env.DB.prepare('UPDATE cl_leave SET status=?, decided_by=?, decided_by_name=?, decided_at=?, decision_note=? WHERE id=?').bind(st, me.id, me.name, nowIso(), nz(clean(b.note, 300)), id).run();
  await audit(env, me, 'leave.' + st, 'leave', id, `${l.staff_id} ${l.kind} ${l.from_date}–${l.to_date}`);
  return OK();
}

/* ---------------- manual attendance ---------------- */
async function saveEntry(env, me, id, b) {
  const reason = clean(b.reason, 200);
  if (reason.length < 5) return R(400, 'Give the reason for the change (e.g. forgot to scan out — confirmed by Sherly).');
  const d = b.day, inT = b.in_time, outT = b.out_time || null;
  if (!isDate(d) || !isTime(inT) || (outT && !isTime(outT))) return R(400, 'Enter the day and times.');
  if (outT && outT <= inT) return R(400, 'Clock-out must be after clock-in.');
  if (d > today()) return R(400, 'Cannot record future attendance.');
  const inAt = `${d}T${inT}:00`, outAt = outT ? `${d}T${outT}:00` : null;
  if (id) {
    const e = await env.DB.prepare('SELECT * FROM cl_attendance WHERE id=?').bind(id).first();
    if (!e) return R(404, 'Not found.');
    await env.DB.prepare('UPDATE cl_attendance SET day=?, in_at=?, out_at=?, edited_by=?, edited_by_name=?, edited_reason=? WHERE id=?').bind(d, inAt, outAt, me.id, me.name, reason, id).run();
    await audit(env, me, 'att.edit', 'attendance', id, `${e.in_at}–${e.out_at || ''} → ${inAt}–${outAt || ''}: ${reason}`);
    return OK();
  }
  const staffId = Number(b.staff_id);
  if (!staffId) return R(400, 'Choose the staff member.');
  const r = await env.DB.prepare("INSERT INTO cl_attendance (staff_id, day, in_at, out_at, source, edited_by, edited_by_name, edited_reason) VALUES (?,?,?,?, 'manual', ?,?,?)").bind(staffId, d, inAt, outAt, me.id, me.name, reason).run();
  await env.DB.prepare('DELETE FROM cl_absences WHERE staff_id=? AND day=? AND letter_id IS NULL').bind(staffId, d).run();
  await audit(env, me, 'att.add', 'attendance', r.meta.last_row_id, `${staffId} ${inAt}–${outAt || ''}: ${reason}`);
  return OK();
}

/* ---------------- absences → warning letter ---------------- */
async function confirmAbsences(env, me, b, request) {
  const staffId = Number(b.staff_id), days = [...new Set((b.days || []).filter(isDate))].sort();
  if (!staffId || !days.length) return R(400, 'Choose the absent days.');
  const [sst, serr, sig] = await signerFor(env, me, request, b.sign);
  if (sst !== 200) return R(sst, serr);
  const months = [...new Set(days.map(d => d.slice(0, 7)))];
  for (const m of months) {
    const { rows } = await monthData(env, m, [staffId]);
    const row = rows[0]; if (!row) return R(400, 'This staff member has no pay profile.');
    for (const d of days.filter(x => x.startsWith(m))) { const r = row.days.find(x => x.day === d); if (!r || r.status !== 'absent') return R(400, `${d} is not an unauthorised absence.`); if (r.confirmed) return R(400, `${d} was already confirmed.`); }
  }
  const y = today().slice(0, 4), pre = `WL/${y}/`;
  const last = await env.DB.prepare('SELECT letter_no n FROM cl_warnings WHERE letter_no LIKE ? ORDER BY id DESC LIMIT 1').bind(pre + '%').first();
  const no = pre + String((last ? parseInt(last.n.slice(pre.length), 10) : 0) + 1).padStart(4, '0');
  const r = await env.DB.prepare('INSERT INTO cl_warnings (letter_no, staff_id, days, body, issued_by, issued_by_name) VALUES (?,?,?,?,?,?)').bind(no, staffId, JSON.stringify(days), nz(clean(b.note, 600)), me.id, me.name).run();
  const lid = r.meta.last_row_id;
  await env.DB.batch(days.map(d => env.DB.prepare('INSERT INTO cl_absences (staff_id, day, letter_id, confirmed_by, confirmed_by_name, confirmed_at, note) VALUES (?,?,?,?,?,?,?) ON CONFLICT(staff_id, day) DO UPDATE SET letter_id=excluded.letter_id, confirmed_by=excluded.confirmed_by, confirmed_by_name=excluded.confirmed_by_name, confirmed_at=excluded.confirmed_at').bind(staffId, d, lid, me.id, me.name, nowIso(), nz(clean(b.note, 300)))));
  await audit(env, me, 'absence.warning', 'warning', lid, `${no} staff ${staffId}: ${days.join(', ')}`);
  // The letter goes to the staff member's documents to acknowledge within 3 days (or dispute).
  const bytes = await warningBytes(env, lid, sig);
  const doc = await issueGenerated(env, me, { kind: 'warning', ref_no: no, title: `Warning letter — unauthorised absence (${days.map(fd).join(', ')})`, body: null, bytes, file_name: `${no.replace(/\//g, '-')}.pdf`,
    staff_ids: [staffId], due_date: addDays(today(), 3), source: 'warning', source_id: lid, sig });
  await env.DB.prepare('UPDATE cl_warnings SET doc_id=? WHERE id=?').bind(doc.id, lid).run();
  return OK({ id: lid, letter_no: no, doc_id: doc.id });
}

/* ---------------- payroll ---------------- */
async function finalisePayroll(env, me, month, sign, request) {
  if (!isMonth(month)) return R(400, 'Choose the month.');
  const [sst, serr, sig] = await signerFor(env, me, request, sign);
  if (sst !== 200) return R(sst, serr);
  if (month >= today().slice(0, 7)) return R(400, 'A month can be finalised once it has ended.');
  const done1 = await env.DB.prepare('SELECT COUNT(*) n FROM cl_payroll WHERE month=?').bind(month).first();
  if (done1.n) return R(400, 'This month is already finalised.');
  const { rows } = await monthData(env, month);
  const issues = rows.flatMap(r => [r.pay.pending_leave_days && `${r.name}: ${r.pay.pending_leave_days} day(s) of leave not yet decided`, r.pay.missing_out && `${r.name}: ${r.pay.missing_out} day(s) with no clock-out`, r.pay.unconfirmed_absences && `${r.name}: ${r.pay.unconfirmed_absences} absence(s) not reviewed`].filter(Boolean));
  if (issues.length) return R(400, 'Sort these out first: ' + issues.join('; ') + '.', { issues });
  await env.DB.batch(rows.map(r => env.DB.prepare('INSERT INTO cl_payroll (month, staff_id, data, net, finalised_by, finalised_by_name) VALUES (?,?,?,?,?,?)').bind(month, r.staff_id, JSON.stringify({ name: r.name, ...r.pay, days: r.days.map(d => ({ day: d.day, status: d.status, kind: d.kind, minutes: d.minutes, first_in: d.first_in, late: d.late })) }), r.pay.net, me.id, me.name)));
  await audit(env, me, 'payroll.finalise', 'payroll', null, `${month}: ${rows.length} staff, ₹${rows.reduce((n, r) => n + r.pay.net, 0)}`);
  // Each payslip goes to the staff member's documents to acknowledge (or dispute) within 7 days.
  const { results: fin } = await env.DB.prepare('SELECT p.id, p.staff_id, s.name FROM cl_payroll p JOIN ems_staff s ON s.id=p.staff_id WHERE p.month=?').bind(month).all();
  let sent = 0;
  for (const r of fin || []) {
    const bytes = await payslipBytes(env, month, r.staff_id, sig);
    if (!bytes) continue;
    await issueGenerated(env, me, { kind: 'payslip', title: `Payslip — ${fm(month)} — ${r.name}`, body: null, bytes, file_name: `payslip-${month}.pdf`, staff_ids: [r.staff_id], due_date: addDays(today(), 7), source: 'payroll', source_id: r.id, sig });
    sent++;
  }
  return OK({ payslips: sent });
}

/* ---------------- PDFs ---------------- */
const inr = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rs = n => 'Rs. ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fd = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
const fm = m => new Date(m + '-01T00:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' });
export async function pdfKit(s) {
  const pdf = await PDFDocument.create();
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.11, 0.2, 0.22), muted = rgb(0.42, 0.47, 0.47), teal = rgb(0.2, 0.35, 0.37);
  let page, y;
  const L = 50, W = 495;
  const newPage = () => { page = pdf.addPage([595, 842]); y = 790; page.drawText(s.legal_name || 'HASWEL CARE Private Limited', { x: L, y, size: 13, font: bold, color: teal }); y -= 14; page.drawText(s.trade_name || 'Hasta Wellness', { x: L, y, size: 8, font: reg, color: muted }); y -= 10; page.drawText(String(s.address || '').slice(0, 150), { x: L, y, size: 7, font: reg, color: muted }); y -= 9; page.drawLine({ start: { x: L, y }, end: { x: L + W, y }, thickness: 0.6, color: teal }); y -= 24; };
  const text = (t, x, size = 10, f = reg, c = ink) => page.drawText(String(t), { x, y, size, font: f, color: c });
  const right = (t, x, size = 9, f = reg, c = ink) => page.drawText(String(t), { x: x - f.widthOfTextAtSize(String(t), size), y, size, font: f, color: c });
  const wrap = (t, size = 10, f = reg, x = L, w = W, lh = 14) => { for (const para of String(t).split('\n')) { let line = ''; for (const word of para.split(' ')) { const tst = line ? line + ' ' + word : word; if (f.widthOfTextAtSize(tst, size) > w) { text(line, x, size, f); y -= lh; line = word; } else line = tst; } text(line, x, size, f); y -= lh; } };
  newPage();
  return { pdf, reg, bold, ink, muted, L, W, text, right, wrap, newPage, get y() { return y; }, set y(v) { y = v; }, get page() { return page; } };
}
export const pdfResponse = (bytes, name) => new Response(bytes, { headers: { ...HEADERS, 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${name}"` } });

async function warningPdf(env, id) {
  const w = await env.DB.prepare('SELECT doc_id, letter_no FROM cl_warnings WHERE id=?').bind(id).first();
  if (!w) return null;
  // Letters issued as signed documents: serve exactly the PDF that was signed.
  if (w.doc_id && env.CVS) {
    const d = await env.DB.prepare('SELECT file_key FROM cl_docs WHERE id=?').bind(w.doc_id).first();
    const obj = d && d.file_key ? await env.CVS.get(d.file_key) : null;
    if (obj) return pdfResponse(await obj.arrayBuffer(), `${w.letter_no.replace(/\//g, '-')}.pdf`);
  }
  return pdfResponse(await warningBytes(env, id, null), `${w.letter_no.replace(/\//g, '-')}.pdf`);
}
const fdt = iso => new Date(Date.parse(iso) + IST).toISOString().replace('T', ' ').slice(0, 16) + ' IST';
async function warningBytes(env, id, sig) {
  const w = await env.DB.prepare('SELECT w.*, s.name staff_name FROM cl_warnings w JOIN ems_staff s ON s.id=w.staff_id WHERE w.id=?').bind(id).first();
  if (!w) return null;
  const s = await settings(env), k = await pdfKit(s), days = parse(w.days, []);
  const prior = await env.DB.prepare('SELECT COUNT(*) n FROM cl_warnings WHERE staff_id=? AND id < ?').bind(w.staff_id, w.id).first();
  k.text(`Ref: ${w.letter_no}`, k.L, 10, k.bold); k.right(`Date: ${fd(new Date(Date.parse(w.issued_at) + IST).toISOString().slice(0, 10))}`, k.L + k.W, 10); k.y -= 28;
  k.text('To', k.L, 10, k.reg, k.muted); k.y -= 14; k.text(w.staff_name, k.L, 11, k.bold); k.y -= 28;
  k.text(prior.n ? `Subject: Warning — unauthorised absence (warning no. ${prior.n + 1})` : 'Subject: Warning — unauthorised absence', k.L, 11, k.bold); k.y -= 24;
  k.wrap(`Dear ${w.staff_name.split(' ')[0]},`); k.y -= 6;
  k.wrap(`Our attendance records show that you were absent from work on ${days.map(fd).join(', ')} without an approved leave application. Under the clinic's leave policy, all leave must be applied for in advance and approved by the Operations Head before it is taken.`);
  k.y -= 6;
  k.wrap(`This absence has been recorded as unauthorised, and the salary for ${days.length === 1 ? 'this day' : 'these days'} will be deducted in accordance with your terms of employment.`);
  k.y -= 6;
  k.wrap(prior.n ? `This is warning number ${prior.n + 1}. You have previously been warned about unauthorised absence. Any further unauthorised absence may lead to further disciplinary action, up to and including termination of employment.` : 'Please treat this letter as a formal warning. Any further unauthorised absence may lead to further disciplinary action.');
  if (w.body) { k.y -= 6; k.wrap(w.body); }
  k.y -= 6;
  k.wrap('If you believe this record is wrong, please speak to the Operations Head within 3 working days of receiving this letter.');
  k.y -= 30; k.text(`For ${s.legal_name || 'HASWEL CARE Private Limited'}`, k.L, 10);
  if (sig) {
    k.y -= 20; k.text(sig.name, k.L, 12, k.bold); k.y -= 13; k.text(sig.title || 'Authorised signatory', k.L, 9.5); k.y -= 12;
    k.text(`Electronically signed in the Hasta Clinic app on ${fdt(sig.at)}`, k.L, 8, k.reg, k.muted);
    k.y -= 36; k.wrap('Employee acknowledgement: this letter is sent to you in the Hasta Clinic app (My documents). Please read it and acknowledge it there within 3 days. If you disagree with it, choose "I disagree" and give your reasons; your response is kept with this letter.', 8.5, k.reg, k.L, k.W, 11);
  } else {
    k.y -= 44; k.text('Authorised signatory', k.L, 10, k.bold); k.y -= 13; k.text(`Issued by ${w.issued_by_name}`, k.L, 8.5, k.reg, k.muted);
    k.y -= 60; k.text('Received by (employee signature and date): ____________________________', k.L, 9.5);
  }
  return await k.pdf.save();
}

async function payslipBytes(env, month, staffId, sig) {
  const res = await payrollPdf(env, month, staffId, sig);
  return res ? new Uint8Array(await res.arrayBuffer()) : null;
}
async function payrollPdf(env, month, staffId, sig) {
  const fin = await env.DB.prepare('SELECT * FROM cl_payroll WHERE month=? ORDER BY net DESC').bind(month).all();
  let rows = (fin.results || []).map(r => ({ staff_id: r.staff_id, ...parse(r.data, {}), final: true, finalised_by_name: r.finalised_by_name }));
  if (!rows.length) rows = (await monthData(env, month)).rows.map(r => ({ staff_id: r.staff_id, name: r.name, ...r.pay, final: false }));
  if (staffId) rows = rows.filter(r => r.staff_id === staffId);
  if (!rows.length) return null;
  const s = await settings(env), k = await pdfKit(s);
  if (staffId) {
    const r = rows[0];
    k.text(`Payslip — ${fm(month)}`, k.L, 15, k.bold); k.y -= 18; k.text(r.final ? 'Finalised' : 'DRAFT — month not finalised; figures may change', k.L, 9, k.reg, k.muted); k.y -= 26;
    k.text(r.name, k.L, 12, k.bold); k.y -= 26;
    const line = (a, b, f = k.reg) => { k.text(a, k.L, 10, f); k.right(b, k.L + k.W, 10, f); k.y -= 16; };
    line('Monthly salary', rs(r.salary));
    line(`Working days in month · contract hours`, `${r.working_days} days · ${r.contract_hours} h (${r.daily_hours} h/day)`);
    line('Hourly rate', rs(r.rate));
    line('Hours worked', `${r.worked_hours} h`);
    line('Paid leave', `${r.paid_leave_days} day(s)`);
    line('Unpaid leave', `${r.unpaid_leave_days} day(s)`);
    line('Unauthorised absence', `${r.absent_days} day(s)`);
    line('Late arrivals', `${r.late_days}`);
    k.y -= 8; k.text('Deductions', k.L, 11, k.bold); k.y -= 18;
    if (r.deductions.not_employed) line('Days before joining / after leaving', '- ' + rs(r.deductions.not_employed));
    line('Unauthorised absence', '- ' + rs(r.deductions.absence));
    line('Unpaid leave', '- ' + rs(r.deductions.unpaid_leave));
    line(`Short hours (${r.short_hours} h)`, '- ' + rs(r.deductions.short_hours));
    k.y -= 6; k.page.drawLine({ start: { x: k.L, y: k.y + 10 }, end: { x: k.L + k.W, y: k.y + 10 }, thickness: 0.5, color: k.muted });
    line('Net pay (before PF / ESI / TDS, if any)', rs(r.net), k.bold);
    k.y -= 30; k.wrap('Pay is pro-rata: hourly rate = monthly salary ÷ contract hours. Weekly off and clinic holidays are paid. Hours beyond contract are not paid as overtime.', 8.5, k.reg);
    if (sig) { k.y -= 16; k.text(`Approved and electronically signed by ${sig.name}${sig.title ? ', ' + sig.title : ''} on ${fdt(sig.at)}`, k.L, 8.5, k.reg, k.muted); k.y -= 12; k.wrap('Please acknowledge this payslip in the Hasta Clinic app (My documents) within 7 days. If something is wrong, choose "I disagree" and say what.', 8.5, k.reg); }
    return pdfResponse(await k.pdf.save(), `payslip-${month}-${r.name.replace(/\W+/g, '-')}.pdf`);
  }
  k.text(`Staff pay — ${fm(month)}`, k.L, 15, k.bold); k.y -= 16; k.text(rows[0].final ? `Finalised by ${rows[0].finalised_by_name}` : 'DRAFT — month not finalised; figures may change', k.L, 9, k.reg, k.muted); k.y -= 26;
  const cols = [['Staff', k.L, 'l'], ['Salary', 200], ['Contract h', 255], ['Worked h', 305], ['Leave', 345], ['Absent', 385], ['Deductions', 450], ['Net pay', 545]];
  for (const [t, x, a] of cols) a ? k.text(t, x, 8.5, k.bold) : k.right(t, x, 8.5, k.bold); k.y -= 14;
  let tot = 0;
  for (const r of rows) {
    if (k.y < 70) k.newPage();
    const ded = Object.values(r.deductions).reduce((n, v) => n + v, 0); tot += r.net;
    k.text(r.name.slice(0, 26), k.L, 9); k.right(rs(r.salary), 200); k.right(r.contract_hours, 255); k.right(r.worked_hours, 305); k.right(r.paid_leave_days + r.unpaid_leave_days, 345); k.right(r.absent_days, 385); k.right(rs(ded), 450); k.right(rs(r.net), 545, 9, k.bold); k.y -= 14;
  }
  k.y -= 4; k.right('Total net pay  ' + rs(tot), 545, 10, k.bold);
  return pdfResponse(await k.pdf.save(), `staff-pay-${month}.pdf`);
}

/* ---------------- router ---------------- */
export async function hrRoute(request, env, url, me, p, m, b, q, base) {
  if (!p.startsWith('/hr/')) return null;
  const s = await settings(env), mgr = canManage(me), appr = isApprover(me, s), hrUser = mgr || appr;
  let mm;
  // --- everyone (own records) ---
  if (p === '/hr/me' && m === 'GET') {
    const month = isMonth(q('month')) ? q('month') : today().slice(0, 7);
    const prof = await env.DB.prepare('SELECT * FROM cl_staff_pay WHERE staff_id=?').bind(me.id).first();
    const [lv, wr] = await env.DB.batch([
      env.DB.prepare('SELECT * FROM cl_leave WHERE staff_id=? ORDER BY from_date DESC LIMIT 40').bind(me.id),
      env.DB.prepare('SELECT id, letter_no, days, issued_at, doc_id FROM cl_warnings WHERE staff_id=? ORDER BY id DESC').bind(me.id),
    ]);
    let days = null, summary = null;
    if (prof) { const { rows } = await monthData(env, month, [me.id]); if (rows[0]) { days = rows[0].days; const pay = rows[0].pay; summary = { contract_hours: pay.contract_hours, worked_hours: pay.worked_hours, late_days: pay.late_days, absent_days: pay.absent_days, paid_leave_days: pay.paid_leave_days, unpaid_leave_days: pay.unpaid_leave_days }; } }
    return api({ ok: true, month, profile: prof ? { daily_hours: prof.daily_hours, weekly_off: prof.weekly_off, shift_start: prof.shift_start } : null, days, summary,
      balance: await leaveBalance(env, me.id, s, prof), leave: lv.results || [], warnings: wr.results || [], kinds: KINDS,
      allow: { sick: Number(s.leave_sick_per_year) > 0, casual: Number(s.leave_casual_per_year) > 0 } });
  }
  if (p === '/hr/leave' && m === 'POST') {
    if (b.staff_id && Number(b.staff_id) !== me.id) { if (!hrUser) return deny(); return done(await applyLeave(env, me, b, true)); }
    return done(await applyLeave(env, me, b, false));
  }
  if ((mm = p.match(/^\/hr\/leave\/(\d+)\/cancel$/)) && m === 'POST') {
    const l = await env.DB.prepare('SELECT * FROM cl_leave WHERE id=?').bind(+mm[1]).first();
    if (!l || (l.staff_id !== me.id && !hrUser)) return api({ ok: false, error: 'Not found.' }, 404);
    if (l.status === 'approved' && !appr) return api({ ok: false, error: 'Approved leave can only be cancelled by the approver.' }, 400);
    if (!['pending', 'approved'].includes(l.status)) return api({ ok: false, error: 'Already closed.' }, 400);
    await env.DB.prepare("UPDATE cl_leave SET status='cancelled', decided_by=?, decided_by_name=?, decided_at=? WHERE id=?").bind(me.id, me.name, nowIso(), l.id).run();
    await audit(env, me, 'leave.cancel', 'leave', l.id); return api({ ok: true });
  }
  if ((mm = p.match(/^\/hr\/warnings\/(\d+)\/pdf$/)) && m === 'GET') {
    const w = await env.DB.prepare('SELECT staff_id FROM cl_warnings WHERE id=?').bind(+mm[1]).first();
    if (!w || (w.staff_id !== me.id && !hrUser)) return api({ ok: false, error: 'Not found.' }, 404);
    return await warningPdf(env, +mm[1]);
  }
  if ((mm = p.match(/^\/hr\/payslip\/(\d{4}-\d{2})\.pdf$/)) && m === 'GET') {
    const fin = await env.DB.prepare('SELECT 1 FROM cl_payroll WHERE month=? AND staff_id=?').bind(mm[1], me.id).first();
    if (!fin) return api({ ok: false, error: 'This month has not been finalised yet.' }, 404);
    return (await payrollPdf(env, mm[1], me.id)) || api({ ok: false, error: 'Not found.' }, 404);
  }
  if (p === '/hr/payslips' && m === 'GET') {
    const { results } = await env.DB.prepare('SELECT month, net FROM cl_payroll WHERE staff_id=? ORDER BY month DESC LIMIT 24').bind(me.id).all();
    return api({ ok: true, payslips: results || [] });
  }

  // --- managers and the leave approver ---
  if (!hrUser) return deny('Only managers and the leave approver can see this.');
  if (p === '/hr/today' && m === 'GET') {
    const { rows } = await monthData(env, today().slice(0, 7));
    const t = today();
    return api({ ok: true, staff: rows.map(r => { const d = r.days.find(x => x.day === t); return { staff_id: r.staff_id, name: r.name, shift_start: r.profile.shift_start, ...d }; }),
      pending: (await env.DB.prepare("SELECT COUNT(*) n FROM cl_leave WHERE status='pending'").first()).n });
  }
  if (p === '/hr/month' && m === 'GET') {
    const month = isMonth(q('month')) ? q('month') : today().slice(0, 7);
    const { rows } = await monthData(env, month);
    const fin = await env.DB.prepare('SELECT COUNT(*) n FROM cl_payroll WHERE month=?').bind(month).first();
    return api({ ok: true, month, finalised: !!fin.n, staff: rows.map(r => ({ staff_id: r.staff_id, name: r.name, shift_start: r.profile.shift_start, days: r.days,
      summary: { worked_hours: r.pay.worked_hours, contract_hours: r.pay.contract_hours, absent_days: r.pay.absent_days, late_days: r.pay.late_days, unconfirmed: r.pay.unconfirmed_absences, missing_out: r.pay.missing_out } })) });
  }
  if (p === '/hr/leave' && m === 'GET') {
    const st = ['pending', 'approved', 'rejected', 'cancelled'].includes(q('status')) ? q('status') : null;
    const { results } = await env.DB.prepare(`SELECT l.*, s.name staff_name FROM cl_leave l JOIN ems_staff s ON s.id=l.staff_id ${st ? 'WHERE l.status=?' : ''} ORDER BY l.status='pending' DESC, l.from_date DESC LIMIT 200`).bind(...(st ? [st] : [])).all();
    const bal = {}; for (const l of (results || []).filter(x => x.status === 'pending')) if (!bal[l.staff_id]) bal[l.staff_id] = await leaveBalance(env, l.staff_id, s, await env.DB.prepare('SELECT * FROM cl_staff_pay WHERE staff_id=?').bind(l.staff_id).first());
    return api({ ok: true, leave: results || [], balances: bal, can_decide: appr });
  }
  if ((mm = p.match(/^\/hr\/leave\/(\d+)\/decide$/)) && m === 'POST') { if (!appr) return deny('Only the leave approver can approve or reject leave.'); return done(await decideLeave(env, me, +mm[1], b)); }
  if (p === '/hr/absences/confirm' && m === 'POST') return done(await confirmAbsences(env, me, b, request));
  if (p === '/hr/warnings' && m === 'GET') {
    const { results } = await env.DB.prepare('SELECT w.*, s.name staff_name FROM cl_warnings w JOIN ems_staff s ON s.id=w.staff_id ORDER BY w.id DESC LIMIT 200').all();
    return api({ ok: true, warnings: results || [] });
  }

  // --- managers only ---
  if (!mgr) return deny();
  if (p === '/hr/attendance' && m === 'POST') return done(await saveEntry(env, me, null, b));
  if ((mm = p.match(/^\/hr\/attendance\/(\d+)$/)) && m === 'PUT') return done(await saveEntry(env, me, +mm[1], b));
  if ((mm = p.match(/^\/hr\/attendance\/(\d+)$/)) && m === 'DELETE') {
    const e = await env.DB.prepare('SELECT * FROM cl_attendance WHERE id=?').bind(+mm[1]).first();
    if (!e) return api({ ok: false, error: 'Not found.' }, 404);
    await env.DB.prepare('DELETE FROM cl_attendance WHERE id=?').bind(e.id).run();
    await audit(env, me, 'att.delete', 'attendance', e.id, `${e.staff_id} ${e.in_at}–${e.out_at || ''}`); return api({ ok: true });
  }
  if (p === '/hr/payroll' && m === 'GET') {
    const month = isMonth(q('month')) ? q('month') : today().slice(0, 7);
    const fin = await env.DB.prepare('SELECT * FROM cl_payroll WHERE month=?').bind(month).all();
    if ((fin.results || []).length) return api({ ok: true, month, finalised: true, rows: fin.results.map(r => ({ staff_id: r.staff_id, ...parse(r.data, {}), days: undefined, finalised_by_name: r.finalised_by_name, finalised_at: r.finalised_at })) });
    const { rows } = await monthData(env, month);
    return api({ ok: true, month, finalised: false, rows: rows.map(r => ({ staff_id: r.staff_id, name: r.name, ...r.pay })) });
  }
  if (p === '/hr/payroll/finalise' && m === 'POST') return done(await finalisePayroll(env, me, b.month, b.sign, request));
  if ((mm = p.match(/^\/hr\/payroll\/(\d{4}-\d{2})\.pdf$/)) && m === 'GET') return (await payrollPdf(env, mm[1], q('staff') ? +q('staff') : null)) || api({ ok: false, error: 'Nothing to show for that month.' }, 404);
  if (p === '/hr/setup' && m === 'GET') {
    const [staff, hol, kio, dev] = await env.DB.batch([
      env.DB.prepare('SELECT s.id, s.name, s.role, s.active, p.* FROM ems_staff s LEFT JOIN cl_staff_pay p ON p.staff_id=s.id WHERE s.active=1 ORDER BY s.name'),
      env.DB.prepare('SELECT * FROM cl_holidays ORDER BY day'),
      env.DB.prepare('SELECT id, name, created_at, last_seen, active FROM cl_kiosks ORDER BY id'),
      env.DB.prepare('SELECT d.id, d.staff_id, s.name, d.agent, d.created_at, d.last_used FROM cl_att_devices d JOIN ems_staff s ON s.id=d.staff_id WHERE d.active=1 ORDER BY s.name'),
    ]);
    return api({ ok: true, staff: (staff.results || []).map(r => ({ ...r, id: r.id })), holidays: hol.results || [], kiosks: kio.results || [], devices: dev.results || [] });
  }
  if ((mm = p.match(/^\/hr\/pay\/(\d+)$/)) && m === 'PUT') {
    const id = +mm[1], sal = Number(b.monthly_salary), dh = Number(b.daily_hours), wo = Number(b.weekly_off);
    if (!(sal >= 0) || !(dh > 0 && dh <= 16) || !(wo >= 0 && wo <= 6) || !isTime(b.shift_start)) return done(R(400, 'Check salary, daily hours (1–16), weekly off and shift start.'));
    for (const k of ['joined_on', 'left_on']) if (b[k] && !isDate(b[k])) return done(R(400, 'Dates must be valid.'));
    if (b.leave_from && !isMonth(String(b.leave_from).slice(0, 7))) return done(R(400, 'Leave accrual start must be a month.'));
    await env.DB.prepare(`INSERT INTO cl_staff_pay (staff_id, monthly_salary, daily_hours, weekly_off, shift_start, joined_on, left_on, leave_opening, leave_from, attendance_required, designation, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(staff_id) DO UPDATE SET monthly_salary=excluded.monthly_salary, daily_hours=excluded.daily_hours, weekly_off=excluded.weekly_off, shift_start=excluded.shift_start, joined_on=excluded.joined_on, left_on=excluded.left_on, leave_opening=excluded.leave_opening, leave_from=excluded.leave_from, attendance_required=excluded.attendance_required, designation=excluded.designation, updated_at=excluded.updated_at`)
      .bind(id, r2(sal), dh, wo, b.shift_start, nz(b.joined_on), nz(b.left_on), Number(b.leave_opening) || 0, b.leave_from ? String(b.leave_from).slice(0, 7) + '-01' : null, b.attendance_required === false ? 0 : 1, nz(clean(b.designation, 80)), nowIso()).run();
    await audit(env, me, 'pay.profile', 'staff', id, 'updated');
    return api({ ok: true });
  }
  if (p === '/hr/settings' && m === 'PUT') {
    const keys = ['geo_lat', 'geo_lng', 'geo_radius_m', 'att_grace_min', 'leave_annual_per_month', 'leave_sick_per_year', 'leave_casual_per_year'].concat(me.admin ? ['leave_approvers'] : []);
    const lat = b.geo_lat !== undefined ? Number(b.geo_lat) : null, lng = b.geo_lng !== undefined ? Number(b.geo_lng) : null;
    if (lat !== null && (!(lat >= 6 && lat <= 37) || !(lng >= 68 && lng <= 98))) return done(R(400, 'That location is not in India — check the latitude / longitude.'));
    if (b.geo_radius_m !== undefined && !(Number(b.geo_radius_m) >= 30 && Number(b.geo_radius_m) <= 1000)) return done(R(400, 'Geofence radius: 30–1000 metres.'));
    if (b.leave_approvers !== undefined) b.leave_approvers = String(b.leave_approvers).split(',').map(Number).filter(Boolean).join(',');
    for (const k of keys) if (b[k] !== undefined) {
      const v = k === 'leave_approvers' ? b[k] : String(Number(b[k]) || 0);
      await env.DB.prepare('INSERT INTO cl_settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(k, v).run();
    }
    await audit(env, me, 'hr.settings', 'settings', null, JSON.stringify(b).slice(0, 300)); return api({ ok: true });
  }
  if (p === '/hr/holidays' && m === 'POST') {
    if (!isDate(b.day) || clean(b.name, 80).length < 2) return done(R(400, 'Enter the date and name.'));
    await env.DB.prepare('INSERT INTO cl_holidays (day, name) VALUES (?,?) ON CONFLICT(day) DO UPDATE SET name=excluded.name').bind(b.day, clean(b.name, 80)).run();
    await audit(env, me, 'holiday.add', 'holiday', null, `${b.day} ${b.name}`); return api({ ok: true });
  }
  if ((mm = p.match(/^\/hr\/holidays\/(\d{4}-\d{2}-\d{2})$/)) && m === 'DELETE') { await env.DB.prepare('DELETE FROM cl_holidays WHERE day=?').bind(mm[1]).run(); await audit(env, me, 'holiday.delete', 'holiday', null, mm[1]); return api({ ok: true }); }
  if (p === '/hr/kiosks' && m === 'POST') {
    const t = randomHex(32), name = clean(b.name, 60) || 'Clinic desktop';
    const r = await env.DB.prepare('INSERT INTO cl_kiosks (name, token_hash, created_by) VALUES (?,?,?)').bind(name, await sha256(t), me.id).run();
    await audit(env, me, 'kiosk.add', 'kiosk', r.meta.last_row_id, name);
    const res = api({ ok: true, id: r.meta.last_row_id });
    res.headers.append('set-cookie', kioskCookie(base || '', t, isSecure(url)));
    return res;
  }
  if ((mm = p.match(/^\/hr\/kiosks\/(\d+)\/revoke$/)) && m === 'POST') { await env.DB.prepare('UPDATE cl_kiosks SET active=0 WHERE id=?').bind(+mm[1]).run(); await audit(env, me, 'kiosk.revoke', 'kiosk', +mm[1]); return api({ ok: true }); }
  if ((mm = p.match(/^\/hr\/devices\/(\d+)\/revoke$/)) && m === 'POST') { await env.DB.prepare('UPDATE cl_att_devices SET active=0 WHERE id=?').bind(+mm[1]).run(); await audit(env, me, 'att_device.revoke', 'device', +mm[1]); return api({ ok: true }); }
  return null;
}
