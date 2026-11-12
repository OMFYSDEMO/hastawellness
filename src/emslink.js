// Clinic patient <-> EMS client: one record, one money account.
//
//  Link   cl_patients.ems_client_id, counted only once confirmed by staff (ems_link_at). Matching mobile
//         numbers are offered as suggestions; nothing links itself. If either phone changes so the two no
//         longer match, the link drops back to "needs confirming".
//  Money  An EMS package sold in the EMS app is billed in the clinic app (item EMS-PKG, 18%) and paid
//         there, so it reaches the day book and the GST summary. ems_receipts (a view) lists the money
//         received for each EMS package; old EMS-app payments are brought across or marked as already
//         billed in the clinic.
//  View   EMS sessions at the clinic's own unit(s) show in the clinic calendar, the patient page and
//         the front-desk alerts.
// Every function returns [status, error, extra] like the clinic routes.

import { clean } from './util.js';
import { settings, createInvoiceWithLines, finalise, EMS_ITEM } from './clinic.js';
import { audit } from './hr.js';

const IST = 330 * 60000;
const today = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString().slice(0, 19) + 'Z';
const r2 = x => Math.round((Number(x) || 0) * 100) / 100;
const last10 = p => String(p || '').replace(/\D/g, '').slice(-10);
const R = (s, e, x) => [s, e, x];
const OK = x => [200, null, x];
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const MODE_OF = { UPI: 'upi', Cash: 'cash', Card: 'card', 'Bank transfer': 'bank' };

const phonesOf = p => [last10(p.phone), last10(p.alt_phone)].filter(x => x.length === 10);
const linkOk = (p, c) => !!(p && c && phonesOf(p).includes(last10(c.phone)));

/* ---------------- link ---------------- */

// Patients who could be this EMS client: same mobile (main or alternative). Flags numbers shared by
// several patients (family members), where staff must pick the right person.
async function patientsByPhone(env, phone) {
  const ph = last10(phone);
  if (ph.length !== 10) return [];
  const { results } = await env.DB.prepare(`SELECT p.id, p.patient_no, p.name, p.phone, p.alt_phone, p.gender, p.dob, p.ems_client_id, p.ems_link_at,
      (SELECT COUNT(*) FROM cl_patients q WHERE q.status='active' AND (q.phone=?1 OR q.alt_phone=?1)) shared
    FROM cl_patients p WHERE p.status='active' AND (p.phone=?1 OR p.alt_phone=?1) ORDER BY p.id`).bind(ph).all();
  return results || [];
}

// The EMS side of a clinic patient: link state, suggestions, packages and sessions.
export async function emsForPatient(env, p) {
  let client = null, suggestions = [];
  if (p.ems_client_id) client = await env.DB.prepare("SELECT id, name, phone, status, home_unit_id FROM ems_clients WHERE id=? AND status != 'deleted'").bind(p.ems_client_id).first();
  if (!client || !p.ems_link_at) {
    const phones = phonesOf(p);
    if (phones.length) {
      const { results } = await env.DB.prepare(`SELECT c.id, c.name, c.phone, c.status,
          (SELECT q.id FROM cl_patients q WHERE q.ems_client_id=c.id AND q.status='active' AND q.id != ?) other_patient_id,
          (SELECT q.name FROM cl_patients q WHERE q.ems_client_id=c.id AND q.status='active' AND q.id != ?) other_patient_name
        FROM ems_clients c WHERE c.status != 'deleted' AND substr(replace(c.phone,' ',''),-10) IN (${phones.map(() => '?').join(',')})`).bind(p.id, p.id, ...phones).all();
      suggestions = (results || []).filter(c => !client || c.id !== client.id);
    }
  }
  const shared = (await env.DB.prepare("SELECT COUNT(*) n FROM cl_patients WHERE status='active' AND (phone=?1 OR alt_phone=?1)").bind(p.phone).first()).n;
  const out = { client, confirmed: !!(client && p.ems_link_at), phone_matches: linkOk(p, client), shared_phone: shared > 1, suggestions, packages: [], sessions: [] };
  if (client) {
    const [pk, se] = await env.DB.batch([
      env.DB.prepare(`SELECT cp.id, cp.name, cp.sessions_total, cp.price, cp.discount, cp.start_date, cp.expiry_date, cp.status, cp.invoice_id, i.invoice_no, i.status invoice_status,
          (SELECT COUNT(*) FROM ems_appointments a WHERE a.client_package_id=cp.id AND a.kind='session' AND a.status='attended') used,
          (SELECT IFNULL(SUM(amount),0) FROM ems_receipts r WHERE r.client_package_id=cp.id) paid
        FROM ems_client_packages cp LEFT JOIN cl_invoices i ON i.id=cp.invoice_id WHERE cp.client_id=? ORDER BY cp.id DESC`).bind(client.id),
      env.DB.prepare(`SELECT a.id, a.kind, a.start_at, a.duration, a.status, u.name unit_name, s.name trainer_name FROM ems_appointments a
          LEFT JOIN ems_units u ON u.id=a.unit_id LEFT JOIN ems_staff s ON s.id=a.trainer_id WHERE a.client_id=? ORDER BY a.start_at DESC LIMIT 60`).bind(client.id),
    ]);
    out.packages = (pk.results || []).map(x => { const due = x.price - x.discount; const bal = r2(due - x.paid); return { ...x, due, balance: bal < 1 ? 0 : bal }; });
    out.sessions = se.results || [];
  }
  return out;
}

// The clinic side of an EMS client.
export async function clinicForClient(env, c) {
  const linked = await env.DB.prepare("SELECT id, patient_no, name, phone, alt_phone, ems_link_at FROM cl_patients WHERE ems_client_id=? AND status='active' ORDER BY ems_link_at IS NULL, id LIMIT 1").bind(c.id).first();
  const all = await patientsByPhone(env, c.phone);
  const suggestions = all.filter(p => !linked || p.id !== linked.id).map(p => ({ ...p, linked_elsewhere: !!(p.ems_client_id && p.ems_client_id !== c.id) }));
  return { patient: linked, confirmed: !!(linked && linked.ems_link_at), phone_matches: linkOk(linked, c), shared_phone: all.length > 1 || (all[0] && all[0].shared > 1), suggestions };
}

export async function link(env, me, patientId, clientId) {
  const [p, c] = await Promise.all([
    env.DB.prepare("SELECT * FROM cl_patients WHERE id=? AND status='active'").bind(patientId).first(),
    env.DB.prepare("SELECT id, name, phone FROM ems_clients WHERE id=? AND status != 'deleted'").bind(clientId).first(),
  ]);
  if (!p || !c) return R(404, 'Patient or EMS client not found.');
  if (p.ems_client_id && p.ems_client_id !== c.id) return R(400, `${p.name} is already linked to another EMS client. Unlink first.`);
  const other = await env.DB.prepare("SELECT id, name, patient_no FROM cl_patients WHERE ems_client_id=? AND id != ? AND status='active'").bind(c.id, p.id).first();
  if (other) return R(400, `This EMS client is already linked to ${other.name} (${other.patient_no}). Unlink that first.`);
  await env.DB.prepare('UPDATE cl_patients SET ems_client_id=?, ems_link_by=?, ems_link_at=? WHERE id=?').bind(c.id, me.id, nowIso(), p.id).run();
  await audit(env, me, 'ems.link', 'patient', p.id, `${p.name} ↔ EMS client ${c.id} ${c.name}${linkOk(p, c) ? '' : ' (phones differ)'}`);
  return OK();
}

export async function unlink(env, me, patientId) {
  const p = await env.DB.prepare("SELECT * FROM cl_patients WHERE id=?").bind(patientId).first();
  if (!p || !p.ems_client_id) return R(400, 'This patient is not linked to an EMS client.');
  const draft = await env.DB.prepare("SELECT COUNT(*) n FROM ems_client_packages cp JOIN cl_invoices i ON i.id=cp.invoice_id WHERE cp.client_id=? AND i.status='draft'").bind(p.ems_client_id).first();
  if (draft.n) return R(400, 'An EMS package bill for this client is still a draft. Finalise or delete it before unlinking.');
  await env.DB.prepare('UPDATE cl_patients SET ems_client_id=NULL, ems_link_by=NULL, ems_link_at=NULL WHERE id=?').bind(p.id).run();
  await audit(env, me, 'ems.unlink', 'patient', p.id, `${p.name} ✕ EMS client ${p.ems_client_id}`);
  return OK();
}

// EMS client with no clinic record yet: create the patient from the EMS details and link them.
// A number already used by a clinic patient needs confirm_shared_phone (a family member's phone).
export async function createPatientFor(env, me, clientId, b) {
  const c = await env.DB.prepare("SELECT * FROM ems_clients WHERE id=? AND status != 'deleted'").bind(clientId).first();
  if (!c) return R(404, 'Client not found.');
  if (await env.DB.prepare("SELECT 1 FROM cl_patients WHERE ems_client_id=? AND status='active'").bind(c.id).first()) return R(400, 'This client already has a clinic record.');
  const ph = last10(c.phone);
  const same = await patientsByPhone(env, ph);
  if (same.length && !b.confirm_shared_phone) return R(409, 'A clinic patient already uses this mobile number. Link to them if it is the same person.', { matches: same });
  const dob = c.birth_year ? `${c.birth_year}-01-01` : null;
  const res = await env.DB.prepare("INSERT INTO cl_patients (name, phone, email, gender, dob, source, ems_client_id, ems_link_by, ems_link_at, notes, created_by) VALUES (?,?,?,?,?,'EMS',?,?,?,?,?)")
    .bind(c.name, ph, c.email || null, ['female', 'male', 'other'].includes(c.gender) ? c.gender : null, dob, c.id, me.id, nowIso(), dob ? 'Date of birth is approximate (birth year from the EMS app).' : null, me.id).run();
  const id = res.meta.last_row_id;
  const no = 'HW-' + String(id).padStart(6, '0');
  await env.DB.prepare('UPDATE cl_patients SET patient_no=? WHERE id=?').bind(no, id).run();
  await audit(env, me, 'patient.add', 'patient', id, `${c.name} (from EMS client ${c.id})`);
  return OK({ id, patient_no: no });
}

// After a phone number changes on either side: a link whose numbers no longer match needs confirming again.
export async function recheck(env, me, { patientId, clientId }) {
  const p = patientId ? await env.DB.prepare('SELECT * FROM cl_patients WHERE id=?').bind(patientId).first()
    : await env.DB.prepare("SELECT * FROM cl_patients WHERE ems_client_id=? AND status='active'").bind(clientId).first();
  if (!p || !p.ems_client_id || !p.ems_link_at) return;
  const c = await env.DB.prepare('SELECT id, phone FROM ems_clients WHERE id=?').bind(p.ems_client_id).first();
  if (linkOk(p, c)) return;
  await env.DB.prepare('UPDATE cl_patients SET ems_link_at=NULL, ems_link_by=NULL WHERE id=?').bind(p.id).run();
  await audit(env, me, 'ems.link_recheck', 'patient', p.id, 'phone changed; EMS link needs confirming again');
}

/* ---------------- money ---------------- */

export async function confirmedPatient(env, clientId) {
  return env.DB.prepare("SELECT * FROM cl_patients WHERE ems_client_id=? AND status='active' AND ems_link_at IS NOT NULL").bind(clientId).first();
}

// Turn an EMS package into a clinic bill (draft). The EMS package price is what the client pays;
// with ems_price_incl_gst=1 (default) the GST is taken out of it rather than added on top.
export async function billPackage(env, me, cpId) {
  const cp = await env.DB.prepare('SELECT * FROM ems_client_packages WHERE id=?').bind(cpId).first();
  if (!cp) return R(404, 'Package not found.');
  if (cp.invoice_id) {
    const inv = await env.DB.prepare('SELECT id, invoice_no, status FROM cl_invoices WHERE id=?').bind(cp.invoice_id).first();
    if (inv && inv.status !== 'cancelled') return OK({ invoice_id: inv.id, invoice_no: inv.invoice_no, existing: true });
  }
  const p = await confirmedPatient(env, cp.client_id);
  if (!p) return R(400, 'Link this client to their clinic patient record first (Clinic record on the client page), so the bill goes to the right person.');
  const [item, s] = await Promise.all([env.DB.prepare('SELECT * FROM cl_items WHERE code=?').bind(EMS_ITEM).first(), settings(env)]);
  if (!item) return R(500, 'The EMS package item is missing from the clinic catalogue.');
  const incl = String(s.ems_price_incl_gst ?? '1') !== '0', k = incl ? 1 + (item.gst_rate || 0) / 100 : 1;
  const label = `EMS: ${cp.name}${cp.sessions_total ? ` (${cp.sessions_total} session${cp.sessions_total === 1 ? '' : 's'})` : ''}`;
  // Price before GST chosen so the bill total comes to exactly the EMS price (GST rounds to the paisa).
  const rate = incl ? item.gst_rate || 0 : 0;
  // When no exact split exists the bill comes to a paisa under the price (never over).
  const exact = target => { const base = r2(target / k); let best = null; for (let d = -0.03; d <= 0.031; d += 0.01) { const n = r2(base + d), t = r2(n + 2 * r2(n * rate / 200)); if (t === r2(target)) return n; if (t < target && (best === null || n > best)) best = n; } return best ?? base; };
  const unit = incl ? exact(cp.price) : cp.price, net = incl ? exact(cp.price - cp.discount) : cp.price - cp.discount;
  const line = { item_id: item.id, qty: 1, unit_price: unit, discount: r2(unit - net), discount_reason: cp.discount ? 'EMS package discount (EMS app)' : null, label };
  const r = await createInvoiceWithLines(env, me, p.id, [line], null, { id: me.id, name: me.name });
  if (r[0] !== 200) return r;
  const id = r[2].id;
  await env.DB.batch([
    env.DB.prepare('UPDATE ems_client_packages SET invoice_id=? WHERE id=?').bind(id, cp.id),
    env.DB.prepare('UPDATE cl_invoices SET notes=? WHERE id=?').bind(`EMS package sold in the EMS app by ${me.name}. Take payment here.`, id),
  ]);
  return OK({ invoice_id: id, invoice_no: null });
}

// Payments recorded in the EMS app before billing moved to the clinic.
export async function legacyPayments(env, all) {
  const { results } = await env.DB.prepare(`SELECT e.*, c.name client_name, c.phone client_phone, cp.name package_name, cp.invoice_id,
      p.id patient_id, p.name patient_name, p.patient_no, p.ems_link_at,
      (SELECT group_concat(DISTINCT i.invoice_no) FROM cl_payments x JOIN cl_allocations a ON a.payment_id=x.id JOIN cl_invoices i ON i.id=a.invoice_id
        WHERE e.reference IS NOT NULL AND x.reference=e.reference AND x.voided=0) same_ref_invoices
    FROM ems_payments e JOIN ems_clients c ON c.id=e.client_id LEFT JOIN ems_client_packages cp ON cp.id=e.client_package_id
    LEFT JOIN cl_patients p ON p.ems_client_id=e.client_id AND p.status='active'
    ${all ? '' : 'WHERE e.clinic_payment_id IS NULL AND e.resolved_note IS NULL'} ORDER BY e.paid_on, e.id`).all();
  return results || [];
}

// Bring one old EMS payment across: a final clinic bill for its package (if it has none) and a clinic
// payment on the original date, applied to that bill. Refused when the same reference is already on a
// clinic payment, unless the person confirms it is a different payment.
export async function moveLegacyPayment(env, me, id, b) {
  const e = await env.DB.prepare('SELECT * FROM ems_payments WHERE id=?').bind(id).first();
  if (!e || e.clinic_payment_id || e.resolved_note) return R(400, 'This payment has already been dealt with.');
  const p = await confirmedPatient(env, e.client_id);
  if (!p) return R(400, 'Confirm the link between this EMS client and their clinic patient record first.');
  if (e.reference && !b.confirm_different) {
    const dup = await env.DB.prepare('SELECT COUNT(*) n FROM cl_payments WHERE reference=? AND voided=0').bind(e.reference).first();
    if (dup.n) return R(409, `Reference ${e.reference} is already on a clinic payment. If the clinic bill already includes this EMS payment, choose "Already billed in clinic" instead.`, { code: 'same_ref' });
  }
  let bill = await billPackage(env, me, e.client_package_id);
  if (bill[0] !== 200) return bill;
  const invId = bill[2].invoice_id;
  const res = await env.DB.prepare('INSERT INTO cl_payments (patient_id, paid_on, amount, mode, reference, received_by, notes) VALUES (?,?,?,?,?,?,?)')
    .bind(p.id, e.paid_on, e.amount, MODE_OF[e.method] || 'upi', e.reference, e.staff_id, `Brought across from the EMS app (EMS payment ${e.id})`).run();
  const payId = res.meta.last_row_id;
  const inv = await env.DB.prepare('SELECT status, total FROM cl_invoices WHERE id=?').bind(invId).first();
  const used = await env.DB.prepare('SELECT IFNULL(SUM(amount),0) s FROM cl_allocations WHERE invoice_id=?').bind(invId).first();
  const amt = r2(Math.min(e.amount, inv.total - used.s));
  if (amt > 0) await env.DB.prepare('INSERT INTO cl_allocations (payment_id, invoice_id, amount, created_by) VALUES (?,?,?,?)').bind(payId, invId, amt, me.id).run();
  if (inv.status === 'draft') { const f = await finalise(env, me, invId); if (f[0] !== 200) return f; }
  await env.DB.prepare('UPDATE ems_payments SET clinic_payment_id=?, resolved_by=?, resolved_at=? WHERE id=?').bind(payId, me.name, nowIso(), id).run();
  await audit(env, me, 'ems.payment_moved', 'payment', payId, `EMS payment ${id} ₹${e.amount} ${e.method} ${e.paid_on}`);
  return OK({ payment_id: payId, invoice_id: invId });
}

// The EMS payment is already inside a clinic bill (e.g. one UPI transfer for several things).
// Point the package at that bill so its paid amount comes from the clinic, and stop counting the EMS row.
export async function resolveLegacyPayment(env, me, id, b) {
  const e = await env.DB.prepare('SELECT * FROM ems_payments WHERE id=?').bind(id).first();
  if (!e || e.clinic_payment_id || e.resolved_note) return R(400, 'This payment has already been dealt with.');
  const note = clean(b.note, 200);
  if (note.length < 5) return R(400, 'Say where the money is in the clinic records (for example, the bill number).');
  const invNo = clean(b.invoice_no, 30);
  let inv = null;
  if (invNo) {
    inv = await env.DB.prepare("SELECT i.id, i.patient_id FROM cl_invoices i WHERE i.invoice_no=? AND i.status='final'").bind(invNo).first();
    if (!inv) return R(400, `No final clinic bill ${invNo}.`);
    const taken = await env.DB.prepare('SELECT id FROM ems_client_packages WHERE invoice_id=? AND id != ?').bind(inv.id, e.client_package_id).first();
    if (taken) return R(400, `${invNo} is already the bill for another EMS package.`);
  }
  const ops = [env.DB.prepare('UPDATE ems_payments SET resolved_note=?, resolved_by=?, resolved_at=? WHERE id=?').bind(note + (invNo ? ` (bill ${invNo})` : ''), me.name, nowIso(), id)];
  if (inv) ops.push(env.DB.prepare('UPDATE ems_client_packages SET invoice_id=? WHERE id=? AND invoice_id IS NULL').bind(inv.id, e.client_package_id));
  await env.DB.batch(ops);
  await audit(env, me, 'ems.payment_resolved', 'ems_payment', id, note + (invNo ? ` (bill ${invNo})` : ''));
  return OK();
}

/* ---------------- view ---------------- */

const calUnits = s => String(s.ems_calendar_units || '1').split(',').map(Number).filter(Boolean);
const EMS_APPT = `SELECT a.id, a.client_id, a.kind, a.start_at, a.duration minutes, a.status, a.mode, a.unit_id, COALESCE(c.name, a.guest_name, 'Guest') client_name, COALESCE(c.phone, a.guest_phone) client_phone,
    u.name unit_name, t.name trainer_name, d.name device_name, cp.name package_name,
    p.id patient_id, p.name patient_name, p.patient_no, p.medical_alert, p.ems_link_at
  FROM ems_appointments a LEFT JOIN ems_clients c ON c.id=a.client_id LEFT JOIN ems_units u ON u.id=a.unit_id
  LEFT JOIN ems_staff t ON t.id=a.trainer_id LEFT JOIN ems_devices d ON d.id=a.device_id LEFT JOIN ems_client_packages cp ON cp.id=a.client_package_id
  LEFT JOIN cl_patients p ON p.ems_client_id=a.client_id AND p.status='active'`;

// EMS bookings at the clinic's unit(s) for the clinic calendar.
export async function emsAppointments(env, from, to) {
  if (!isDate(from) || !isDate(to)) return [];
  const u = calUnits(await settings(env));
  if (!u.length) return [];
  const { results } = await env.DB.prepare(`${EMS_APPT} WHERE a.unit_id IN (${u.join(',')}) AND a.status != 'cancelled' AND a.start_at >= ? AND a.start_at <= ? ORDER BY a.start_at LIMIT 1000`)
    .bind(from + 'T00:00', to + 'T23:59').all();
  return results || [];
}

// Front desk marks an EMS booking at the clinic's unit as attended or no-show (only once its time has come).
export async function markEmsAppt(env, me, id, b) {
  const status = ['attended', 'no_show'].includes(b.status) ? b.status : null;
  if (!status) return R(400, 'Choose attended or no-show.');
  const u = calUnits(await settings(env));
  const a = await env.DB.prepare(`SELECT * FROM ems_appointments WHERE id=? AND unit_id IN (${u.join(',') || 0})`).bind(id).first();
  if (!a) return R(404, 'EMS booking not found.');
  if (a.status !== 'booked') return R(400, 'This EMS booking is already marked.');
  if (a.start_at > new Date(Date.now() + IST).toISOString().slice(0, 16)) return R(400, 'The session has not started yet.');
  await env.DB.prepare("UPDATE ems_appointments SET status=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=? AND status='booked'").bind(status, id).run();
  await audit(env, me, 'ems.appt_' + status, 'ems_appointment', id, a.start_at);
  return OK();
}

// Front desk: EMS sessions not marked (attended / no-show) after they should have finished, and EMS package
// bills not yet finalised or paid.
export async function emsAlerts(env, now, graceMin) {
  const s = await settings(env), u = calUnits(s);
  const from = new Date(Date.now() + IST - 7 * 86400000).toISOString().slice(0, 10) + 'T00:00';
  const stmts = [
    env.DB.prepare(`SELECT * FROM (${EMS_APPT} WHERE a.unit_id IN (${u.join(',') || 0}) AND a.status='booked' AND a.start_at >= ?) x
      WHERE strftime('%Y-%m-%dT%H:%M', x.start_at, '+' || (x.minutes + ?) || ' minutes') <= ? ORDER BY x.start_at`).bind(from, graceMin, now),
    env.DB.prepare(`SELECT cp.id package_id, cp.name package_name, cp.price - cp.discount due, c.name client_name, i.id invoice_id, i.invoice_no, i.status invoice_status, i.total,
        p.name patient_name, p.patient_no,
        IFNULL((SELECT SUM(amount) FROM ems_receipts r WHERE r.client_package_id=cp.id),0) paid
      FROM ems_client_packages cp JOIN ems_clients c ON c.id=cp.client_id LEFT JOIN cl_invoices i ON i.id=cp.invoice_id
      LEFT JOIN cl_patients p ON p.ems_client_id=cp.client_id AND p.status='active'
      WHERE cp.status != 'closed' AND cp.price - cp.discount > 0 AND IFNULL(cp.unit_id,1) IN (${u.join(',') || 0}) AND cp.created_at >= ?
        AND (i.id IS NULL OR i.status='draft' OR (i.status='final' AND cp.price - cp.discount - IFNULL((SELECT SUM(amount) FROM ems_receipts r WHERE r.client_package_id=cp.id),0) >= 1))
      ORDER BY cp.id`).bind(s.ems_billing_from || '2026-11-12'),
  ];
  const [a, b] = await env.DB.batch(stmts);
  return { ems_unmarked: a.results || [], ems_unpaid: (b.results || []).map(x => ({ ...x, balance: r2(x.due - x.paid) })) };
}
