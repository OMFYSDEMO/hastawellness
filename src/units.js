// Satellite units: availability and allocation.
//
// A slot at a unit is offered only when, for its whole length:
//   • the unit is open (its own weekly hours),
//   • for EMS sessions: an active device of a machine type the package allows is free
//     AND a rostered trainer certified for that machine type is free
//     (each trainer supervises one client at a time),
//   • for in-person consultations/reviews: a rostered coach or doctor is free,
//   • for video consultations: any coach or doctor rostered for video (any unit) is free.
// Booking then assigns a specific device and staff member automatically.

import { clean, nz } from './util.js';

export const SKILLS = { trainer: 'EMS trainer', coach: 'Wellness coach', doctor: 'Doctor', medical_lead: 'Medical lead', front: 'Front desk' };
export const MAX_DEVICES = 3;
const DAYS = [0, 1, 2, 3, 4, 5, 6];
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fromMin = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const dowOf = d => new Date(d + 'T00:00:00Z').getUTCDay();
const parse = (s, f) => { try { return s ? JSON.parse(s) : f; } catch { return f; } };
const isTime = s => /^([01]\d|2[0-3]):[0-5]\d$/.test(s || '');

export async function listUnits(env, { activeOnly = false } = {}) {
  const { results } = await env.DB.prepare(`SELECT u.*, (SELECT COUNT(*) FROM ems_devices d WHERE d.unit_id=u.id AND d.status='active') devices
    FROM ems_units u ${activeOnly ? 'WHERE u.active=1' : ''} ORDER BY u.id`).all();
  return (results || []).map(u => ({ ...u, hours: parse(u.hours, {}) }));
}
export async function getUnit(env, id) {
  const u = await env.DB.prepare('SELECT * FROM ems_units WHERE id=?').bind(id).first();
  return u ? { ...u, hours: parse(u.hours, {}) } : null;
}
export const publicUnit = u => ({ id: u.id, code: u.code, name: u.name, address: u.address, district: u.district, phone: u.phone, hours: u.hours });

/* ---------------- access scope ---------------- */

// Which units a staff member can see. Admins see every unit.
export async function scopeOf(env, me) {
  if (me.role === 'admin') {
    const { results } = await env.DB.prepare('SELECT id FROM ems_units').all();
    return { all: true, units: (results || []).map(r => r.id) };
  }
  const { results } = await env.DB.prepare('SELECT unit_id FROM ems_staff_units WHERE staff_id=?').bind(me.id).all();
  return { all: false, units: (results || []).map(r => r.unit_id) };
}
// Units selected for this request (?unit=ID, else every unit in scope), as a safe SQL list.
export function selectedUnits(url, scope) {
  const u = parseInt(url.searchParams.get('unit'), 10);
  const ids = u && scope.units.includes(u) ? [u] : scope.units;
  return { ids, sql: ids.length ? ids.map(Number).join(',') : '0', one: u && scope.units.includes(u) ? u : null };
}

/* ---------------- availability ---------------- */

async function dayData(env, unitId, d, withVideo) {
  const wd = dowOf(d);
  const q = (sql, ...b) => env.DB.prepare(sql).bind(...b).all().then(r => r.results || []);
  const [unit, devices, rota, leave, appts, certs] = await Promise.all([
    getUnit(env, unitId),
    q("SELECT id, name, machine_type_id FROM ems_devices WHERE unit_id=? AND status='active' ORDER BY id", unitId),
    q(`SELECT r.*, s.name, s.skills FROM ems_rota r JOIN ems_staff s ON s.id=r.staff_id AND s.active=1 WHERE r.weekday=? ${withVideo ? '' : 'AND r.unit_id=?'}`, ...(withVideo ? [wd] : [wd, unitId])),
    q('SELECT staff_id FROM ems_leave WHERE day=?', d),
    q("SELECT id, unit_id, kind, mode, start_at, duration, device_id, trainer_id, client_id FROM ems_appointments WHERE substr(start_at,1,10)=? AND status IN ('booked','attended')", d),
    q("SELECT staff_id, machine_type_id FROM ems_certifications WHERE status='active' AND issued_on <= ? AND valid_until >= ?", d, d),
  ]);
  const certified = {};
  for (const c of certs) (certified[c.staff_id] ||= new Set()).add(c.machine_type_id);
  const off = new Set(leave.map(l => l.staff_id));
  return { unit, devices, certified, rota: rota.filter(r => !off.has(r.staff_id)).map(r => ({ ...r, skills: parse(r.skills, []) })), appts };
}

const overlaps = (a, t, dur) => { const s = toMin(a.start_at.slice(11, 16)); return s < t + dur && s + (a.duration || 30) > t; };

// Evaluate one start time. Returns { left, device, staff } for the best allocation.
// Largest set of (device, trainer) pairs where the trainer is certified for the device's machine type.
function bestPairs(devices, trainers, certified, prefer) {
  const ok = (dv, tr) => dv.machine_type_id && certified[tr] && certified[tr].has(dv.machine_type_id);
  let best = [];
  const order = trainers.slice().sort((a, b) => (b === prefer) - (a === prefer));
  const walk = (i, used, pairs) => {
    if (pairs.length > best.length) best = pairs.slice();
    if (i >= devices.length || best.length === Math.min(devices.length, order.length)) return;
    for (const tr of order) if (!used.has(tr) && ok(devices[i], tr)) { used.add(tr); pairs.push([devices[i].id, tr]); walk(i + 1, used, pairs); pairs.pop(); used.delete(tr); }
    walk(i + 1, used, pairs);
  };
  walk(0, new Set(), []);
  return best;
}

function evaluate(dd, d, t, kind, mode, { exceptId = 0, prefer = null, types = [] } = {}) {
  const u = dd.unit, dur = u.slot_minutes;
  const live = dd.appts.filter(a => a.id !== exceptId && overlaps(a, t, dur));
  const busyOf = id => live.filter(a => a.trainer_id === id);
  const onShift = (r, needUnit) => (!needUnit || r.unit_id === u.id) && toMin(r.start_time) <= t && toMin(r.end_time) >= t + dur;
  if (kind === 'session') {
    const here = live.filter(a => a.unit_id === u.id && a.kind === 'session');
    const usedDevices = new Set(here.map(a => a.device_id).filter(Boolean));
    const anonymous = here.filter(a => !a.device_id || !a.trainer_id).length;    // older bookings without an assignment
    const freeDevices = dd.devices.filter(x => !usedDevices.has(x.id) && (!types.length || types.includes(x.machine_type_id)));
    const trainers = [...new Set(dd.rota.filter(r => onShift(r, true) && r.skills.includes('trainer')).map(r => r.staff_id))]
      .filter(id => !busyOf(id).length);                                       // one client at a time
    const pairs = bestPairs(freeDevices, trainers, dd.certified, prefer);
    const left = Math.max(0, pairs.length - anonymous);
    if (!left) return { left: 0 };
    const pick = pairs.find(p => p[1] === prefer) || pairs[0];
    return { left, device: pick[0], staff: pick[1] };
  }
  const video = mode === 'video';
  const clin = dd.rota.filter(r => onShift(r, !video) && (!video || r.video) && (r.skills.includes('coach') || r.skills.includes('doctor')));
  const free = [...new Set(clin.map(r => r.staff_id))].filter(id => !busyOf(id).length);
  if (!free.length) return { left: 0 };
  free.sort((a, b) => (b === prefer) - (a === prefer));
  return { left: free.length, device: null, staff: free[0] };
}

const VIDEO_HOURS = ['08:00', '21:00']; // video consultations follow the clinician's video shifts, not centre hours
function times(u, d, mode) {
  const h = mode === 'video' ? VIDEO_HOURS : u.hours[String(dowOf(d))];
  if (!h || !isTime(h[0]) || !isTime(h[1])) return [];
  const out = [];
  for (let t = toMin(h[0]); t + u.slot_minutes <= toMin(h[1]); t += u.slot_minutes) out.push(t);
  return out;
}

export async function unitSlots(env, unitId, d, kind = 'session', mode = 'in_person', { minAheadH = 0, nowLocal, prefer = null, types = [] } = {}) {
  const dd = await dayData(env, unitId, d, mode === 'video');
  if (!dd.unit || !dd.unit.active) return [];
  const now = nowLocal ? toMin(nowLocal.slice(11)) : 0;
  const isToday = nowLocal && nowLocal.slice(0, 10) === d;
  return times(dd.unit, d, mode)
    .filter(t => !isToday || t - now >= minAheadH * 60)
    .map(t => ({ time: fromMin(t), left: evaluate(dd, d, t, kind, mode, { prefer, types }).left }));
}

// Allocate a device and staff member for a booking; { ok, device_id, trainer_id, error }.
export async function allocate(env, unitId, start, kind, mode, { exceptId = 0, prefer = null, force = false, types = [] } = {}) {
  const d = start.slice(0, 10), t = toMin(start.slice(11, 16));
  const dd = await dayData(env, unitId, d, mode === 'video');
  if (!dd.unit || !dd.unit.active) return { ok: false, error: 'That unit is not taking bookings.' };
  const inHours = times(dd.unit, d, mode).includes(t);
  const r = evaluate(dd, d, t, kind, mode, { exceptId, prefer, types });
  if (r.left && inHours) return { ok: true, device_id: r.device || null, trainer_id: r.staff || null, duration: dd.unit.slot_minutes };
  if (force) return { ok: true, device_id: null, trainer_id: null, duration: dd.unit.slot_minutes, warning: inHours ? 'Overbooked: no free device or trainer was left.' : 'Outside this unit\'s opening hours.' };
  if (!inHours) return { ok: false, error: 'That time is outside the unit\'s opening hours.' };
  return { ok: false, error: kind === 'session' ? 'No free device with a certified trainer at that time. Choose another slot.' : mode === 'video' ? 'No coach or doctor is free for a video call then.' : 'No coach or doctor is free at that time.' };
}

// Unit for a new lead: matching pin code, else district, else none (head office assigns).
export async function routeUnit(env, { pincode, district } = {}) {
  const units = await listUnits(env, { activeOnly: true });
  if (pincode) { const u = units.find(x => String(x.pincodes || '').split(/[ ,]+/).includes(String(pincode))); if (u) return u.id; }
  if (district) { const u = units.find(x => (x.district || '').toLowerCase() === String(district).toLowerCase()); if (u) return u.id; }
  return null;
}

/* ---------------- admin: units, devices, rota, leave ---------------- */

export async function saveUnit(env, id, b) {
  const name = clean(b.name, 80), code = clean(b.code, 8).toUpperCase();
  if (name.length < 3 || !/^[A-Z0-9]{2,8}$/.test(code)) return [400, 'Enter a unit name and a short code (2–8 letters or numbers).'];
  const dup = await env.DB.prepare('SELECT id FROM ems_units WHERE code=? AND id != ?').bind(code, id || 0).first();
  if (dup) return [400, 'That unit code is already used.'];
  const ownership = b.ownership === 'franchise' ? 'franchise' : 'owned';
  const share = parseInt(b.revenue_share, 10);
  if (!(share >= 0 && share <= 100)) return [400, 'Revenue share must be between 0 and 100%.'];
  const hours = {};
  for (const dnum of DAYS) {
    const h = b.hours && b.hours[dnum];
    if (h && h.open) {
      if (!isTime(h.from) || !isTime(h.to) || toMin(h.to) <= toMin(h.from)) return [400, 'Check the opening hours.'];
      hours[dnum] = [h.from, h.to];
    }
  }
  const slot = [20, 30, 40, 45, 60].includes(parseInt(b.slot_minutes, 10)) ? parseInt(b.slot_minutes, 10) : 30;
  const cpt = 1; // one trainer supervises one client at a time
  const vals = [code, name, ownership, ownership === 'franchise' ? nz(clean(b.franchise_name, 120)) : null, share, nz(clean(b.address, 250)), nz(clean(b.district, 60)),
    nz(String(b.pincodes || '').replace(/[^0-9, ]/g, '').slice(0, 300)), nz(clean(b.phone, 20)), nz(clean(b.upi, 80)), JSON.stringify(hours), slot, cpt, b.active === false ? 0 : 1];
  if (ownership === 'franchise' && !vals[3]) return [400, 'Enter the franchisee\'s legal name.'];
  let unitId = id;
  if (id) await env.DB.prepare('UPDATE ems_units SET code=?, name=?, ownership=?, franchise_name=?, revenue_share=?, address=?, district=?, pincodes=?, phone=?, upi=?, hours=?, slot_minutes=?, clients_per_trainer=?, active=? WHERE id=?').bind(...vals, id).run();
  else unitId = (await env.DB.prepare('INSERT INTO ems_units (code, name, ownership, franchise_name, revenue_share, address, district, pincodes, phone, upi, hours, slot_minutes, clients_per_trainer, active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(...vals).run()).meta.last_row_id;
  // Devices: list of {id?, name, status}; at most 3 active or in maintenance.
  if (Array.isArray(b.devices)) {
    const list = b.devices.filter(x => x && clean(x.name, 40));
    const listed = new Set(list.filter(x => x.id).map(x => parseInt(x.id, 10)));
    const { results: cur } = await env.DB.prepare("SELECT id FROM ems_devices WHERE unit_id=? AND status != 'retired'").bind(unitId).all();
    const total = (cur || []).filter(x => !listed.has(x.id)).length + list.filter(x => x.status !== 'retired').length;
    if (total > MAX_DEVICES) return [400, `A unit can have at most ${MAX_DEVICES} EMS devices. Retire one first.`];
    for (const x of list) if (x.status !== 'retired' && !parseInt(x.machine_type_id, 10)) return [400, `Choose the machine type for ${clean(x.name, 40)}.`];
    for (const x of list) {
      const st = ['active', 'maintenance', 'retired'].includes(x.status) ? x.status : 'active';
      const mt = parseInt(x.machine_type_id, 10) || null, sn = nz(clean(x.serial_no, 60));
      if (x.id) await env.DB.prepare('UPDATE ems_devices SET name=?, status=?, notes=?, machine_type_id=?, serial_no=? WHERE id=? AND unit_id=?').bind(clean(x.name, 40), st, nz(clean(x.notes, 200)), mt, sn, parseInt(x.id, 10), unitId).run();
      else await env.DB.prepare('INSERT INTO ems_devices (unit_id, name, status, notes, machine_type_id, serial_no) VALUES (?,?,?,?,?,?)').bind(unitId, clean(x.name, 40), st, nz(clean(x.notes, 200)), mt, sn).run();
    }
  }
  return [200, null, { id: unitId }];
}

export async function unitDetail(env, id) {
  const u = await getUnit(env, id);
  if (!u) return null;
  const q = (sql, ...b) => env.DB.prepare(sql).bind(...b).all().then(r => r.results || []);
  const [devices, staff, rota, leave] = await Promise.all([
    q('SELECT d.*, m.name machine_name FROM ems_devices d LEFT JOIN ems_machine_types m ON m.id=d.machine_type_id WHERE d.unit_id=? ORDER BY d.status, d.id', id),
    q('SELECT s.id, s.name, s.role, s.skills FROM ems_staff s JOIN ems_staff_units x ON x.staff_id=s.id WHERE x.unit_id=? AND s.active=1 ORDER BY s.name', id),
    q('SELECT r.*, s.name FROM ems_rota r JOIN ems_staff s ON s.id=r.staff_id WHERE r.unit_id=? ORDER BY r.weekday, r.start_time', id),
    q("SELECT l.*, s.name FROM ems_leave l JOIN ems_staff s ON s.id=l.staff_id JOIN ems_staff_units x ON x.staff_id=s.id AND x.unit_id=? WHERE l.day >= date('now','-1 day') ORDER BY l.day", id),
  ]);
  const { results: certs } = await env.DB.prepare("SELECT c.staff_id, c.machine_type_id, c.valid_until, m.name machine_name FROM ems_certifications c JOIN ems_machine_types m ON m.id=c.machine_type_id WHERE c.status='active' AND c.valid_until >= date('now')").all();
  return { unit: u, devices, staff: staff.map(s => ({ ...s, skills: parse(s.skills, []), certs: (certs || []).filter(c => c.staff_id === s.id) })), rota, leave };
}

export async function saveShift(env, b) {
  const staff = parseInt(b.staff_id, 10), unit = parseInt(b.unit_id, 10);
  const days = (Array.isArray(b.weekdays) ? b.weekdays : []).map(Number).filter(x => DAYS.includes(x));
  if (!staff || !unit || !days.length) return [400, 'Choose the team member, unit and days.'];
  if (!isTime(b.start_time) || !isTime(b.end_time) || toMin(b.end_time) <= toMin(b.start_time)) return [400, 'Check the shift times.'];
  const member = await env.DB.prepare('SELECT 1 FROM ems_staff_units WHERE staff_id=? AND unit_id=?').bind(staff, unit).first();
  if (!member) return [400, 'Add this team member to the unit first (Settings → Team).'];
  for (const wd of days) {
    const clash = await env.DB.prepare('SELECT u.name FROM ems_rota r JOIN ems_units u ON u.id=r.unit_id WHERE r.staff_id=? AND r.weekday=? AND r.start_time < ? AND r.end_time > ?').bind(staff, wd, b.end_time, b.start_time).first();
    if (clash) return [400, `That overlaps another shift for this person (${clash.name}).`];
  }
  for (const wd of days) await env.DB.prepare('INSERT INTO ems_rota (staff_id, unit_id, weekday, start_time, end_time, video) VALUES (?,?,?,?,?,?)').bind(staff, unit, wd, b.start_time, b.end_time, b.video ? 1 : 0).run();
  return [200];
}

export async function saveLeave(env, b) {
  const staff = parseInt(b.staff_id, 10);
  if (!staff || !/^\d{4}-\d{2}-\d{2}$/.test(b.day || '')) return [400, 'Choose the team member and the day.'];
  await env.DB.prepare('INSERT OR IGNORE INTO ems_leave (staff_id, day, note) VALUES (?,?,?)').bind(staff, b.day, nz(clean(b.note, 120))).run();
  const { results } = await env.DB.prepare("SELECT a.start_at, IFNULL(c.name, a.guest_name) name FROM ems_appointments a LEFT JOIN ems_clients c ON c.id=a.client_id WHERE a.trainer_id=? AND substr(a.start_at,1,10)=? AND a.status='booked'").bind(staff, b.day).all();
  return [200, null, { affected: results || [] }];
}

/* ---------------- reports ---------------- */

// Sessions delivered at one unit for a client whose package was sold by another unit.
export async function settlement(env, from, to) {
  const { results } = await env.DB.prepare(`SELECT a.unit_id delivered_by, cp.unit_id sold_by, COUNT(*) sessions,
      SUM(CAST(cp.price - cp.discount AS REAL) / cp.sessions_total) value
    FROM ems_appointments a JOIN ems_client_packages cp ON cp.id=a.client_package_id
    WHERE a.status='attended' AND a.kind='session' AND a.unit_id IS NOT NULL AND cp.unit_id IS NOT NULL AND a.unit_id != cp.unit_id
      AND substr(a.start_at,1,10) BETWEEN ? AND ? GROUP BY a.unit_id, cp.unit_id`).bind(from, to).all();
  const units = Object.fromEntries((await listUnits(env)).map(u => [u.id, u]));
  return (results || []).map(r => {
    const del = units[r.delivered_by], sold = units[r.sold_by];
    return { delivered_by: r.delivered_by, delivered_name: del && del.name, sold_by: r.sold_by, sold_name: sold && sold.name, sessions: r.sessions,
      value: Math.round(r.value || 0), share: del ? del.revenue_share : 100, payable: Math.round((r.value || 0) * (del ? del.revenue_share : 100) / 100),
      franchise: !!((del && del.ownership === 'franchise') || (sold && sold.ownership === 'franchise')) };
  });
}

// Per-unit numbers for this week (Mon–Sun) and month.
export async function unitStats(env, ids, mon, monthStart) {
  const units = (await listUnits(env)).filter(u => ids.includes(u.id));
  const out = [];
  for (const u of units) {
    let capacity = 0;
    for (let i = 0; i < 7; i++) { const x = new Date(mon + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + i); capacity += times(u, x.toISOString().slice(0, 10)).length * u.devices; }
    const r = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM ems_appointments WHERE unit_id=? AND kind='session' AND status IN ('booked','attended') AND substr(start_at,1,10) BETWEEN ? AND date(?, '+6 days')) week_booked,
      (SELECT COUNT(*) FROM ems_appointments WHERE unit_id=? AND kind='session' AND status='attended' AND substr(start_at,1,10) BETWEEN ? AND date(?, '+6 days')) week_attended,
      (SELECT COUNT(*) FROM ems_clients WHERE home_unit_id=? AND status='active') clients,
      (SELECT IFNULL(SUM(amount),0) FROM ems_receipts WHERE unit_id=? AND paid_on >= ?) revenue`).bind(u.id, mon, mon, u.id, mon, mon, u.id, u.id, monthStart).first();
    out.push({ id: u.id, name: u.name, code: u.code, ownership: u.ownership, devices: u.devices, capacity, ...r, utilisation: capacity ? Math.round(r.week_booked / capacity * 100) : 0 });
  }
  return out;
}

/* ---------------- machines & trainer certification ---------------- */

export const MACHINE_CATEGORIES = ['Whole-body EMS suit', 'Wireless EMS suit', 'EMS vest / partial body', 'Pelvic-floor EMS chair', 'Body-sculpting (HIFEM)', 'Other'];

export async function listMachines(env) {
  const { results } = await env.DB.prepare(`SELECT m.*, (SELECT COUNT(*) FROM ems_devices d WHERE d.machine_type_id=m.id AND d.status != 'retired') devices,
    (SELECT COUNT(DISTINCT staff_id) FROM ems_certifications c WHERE c.machine_type_id=m.id AND c.status='active' AND c.valid_until >= date('now')) trainers
    FROM ems_machine_types m ORDER BY m.active DESC, m.name`).all();
  return (results || []).map(m => ({ ...m, features: parse(m.features, []) }));
}

export async function saveMachine(env, id, b) {
  const name = clean(b.name, 80), category = MACHINE_CATEGORIES.includes(b.category) ? b.category : null;
  if (name.length < 2 || !category) return [400, 'Enter the machine name and choose its type.'];
  const feats = (Array.isArray(b.features) ? b.features : String(b.features || '').split('\n')).map(x => clean(x, 80)).filter(Boolean).slice(0, 15);
  const vals = [name, nz(clean(b.brand, 60)), category, JSON.stringify(feats), nz(clean(b.notes, 400)), b.active === false ? 0 : 1];
  if (id) await env.DB.prepare('UPDATE ems_machine_types SET name=?, brand=?, category=?, features=?, notes=?, active=? WHERE id=?').bind(...vals, id).run();
  else id = (await env.DB.prepare('INSERT INTO ems_machine_types (name, brand, category, features, notes, active) VALUES (?,?,?,?,?,?)').bind(...vals).run()).meta.last_row_id;
  return [200, null, { id }];
}

export async function listCertifications(env) {
  const { results } = await env.DB.prepare(`SELECT c.*, s.name trainer_name, m.name machine_name FROM ems_certifications c
    JOIN ems_staff s ON s.id=c.staff_id JOIN ems_machine_types m ON m.id=c.machine_type_id ORDER BY c.status, c.valid_until DESC`).all();
  return results || [];
}

// Only a wellness coach or doctor can certify, and never themselves.
export async function certify(env, me, b) {
  const meRow = me.id ? await env.DB.prepare('SELECT skills, reg_no FROM ems_staff WHERE id=?').bind(me.id).first() : null;
  const mySkills = parse(meRow && meRow.skills, []);
  const role = mySkills.includes('doctor') ? 'Doctor' : mySkills.includes('coach') ? 'Wellness coach' : null;
  if (!role) return [403, 'Only a Hasta wellness coach or doctor can certify trainers. Sign in with your own account.'];
  const staffId = parseInt(b.staff_id, 10), mt = parseInt(b.machine_type_id, 10);
  if (!staffId || !mt) return [400, 'Choose the trainer and the machine.'];
  if (staffId === me.id) return [400, 'You cannot certify yourself. Ask another coach or doctor.'];
  const tr = await env.DB.prepare('SELECT skills, active, role FROM ems_staff WHERE id=?').bind(staffId).first();
  if (tr && tr.role === 'trainee') return [400, 'Academy trainees are certified through Academy → Trainees.'];
  if (!tr || !tr.active || !parse(tr.skills, []).includes('trainer')) return [400, 'That person is not an active EMS trainer. Add the EMS trainer skill first.'];
  const m = await env.DB.prepare('SELECT id FROM ems_machine_types WHERE id=? AND active=1').bind(mt).first();
  if (!m) return [400, 'Choose an active machine.'];
  const months = Math.min(24, Math.max(1, parseInt(b.months, 10) || 12));
  if (b.confirm !== true) return [400, 'Confirm that you have assessed the trainer on this machine.'];
  const notes = clean(b.notes, 500);
  if (notes.length < 10) return [400, 'Write a short note on what you assessed (e.g. set-up, pad placement, intensity control, contraindication checks, emergency stop).'];
  const issued = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const until = new Date(issued + 'T00:00:00Z'); until.setUTCMonth(until.getUTCMonth() + months);
  await env.DB.prepare("UPDATE ems_certifications SET status='revoked', revoked_at=?, revoked_reason='Replaced by a new certificate' WHERE staff_id=? AND machine_type_id=? AND status='active'").bind(issued, staffId, mt).run();
  await env.DB.prepare('INSERT INTO ems_certifications (staff_id, machine_type_id, certified_by, certifier_name, certifier_role, issued_on, valid_until, notes) VALUES (?,?,?,?,?,?,?,?)')
    .bind(staffId, mt, me.id, me.name + (role === 'Doctor' && meRow.reg_no ? ` (Reg. ${meRow.reg_no})` : ''), role, issued, until.toISOString().slice(0, 10), notes).run();
  return [200];
}

export async function revokeCert(env, me, id, b) {
  const meRow = me.id ? await env.DB.prepare('SELECT skills FROM ems_staff WHERE id=?').bind(me.id).first() : null;
  const sk = parse(meRow && meRow.skills, []);
  if (!(me.role === 'admin' || sk.includes('coach') || sk.includes('doctor'))) return [403, 'Only a coach, doctor or admin can revoke a certificate.'];
  await env.DB.prepare("UPDATE ems_certifications SET status='revoked', revoked_at=date('now'), revoked_reason=? WHERE id=?").bind(clean(b.reason, 200) || `Revoked by ${me.name}`, id).run();
  return [200];
}
