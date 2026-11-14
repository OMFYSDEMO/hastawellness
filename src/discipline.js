// Disciplinary procedure — Staff → Discipline.
//
// Stages, always in this order for a staff member (a stage stays "live" for a set period, then lapses):
//   1. Verbal warning           — by the duty doctor in charge, a manager or an admin; recorded and acknowledged
//   2. First written warning    — by the Operations Head (Settings: disc_written_by) or the clinic admin
//   3. Final written warning    — by the Operations Head or the clinic admin
//   4. Dismissal / termination  — by the clinic admin only
// Safeguards (natural justice), enforced by the app:
//   • every action belongs to a case with specific facts: date, what happened, the rule broken, the evidence;
//   • before a written warning, final warning or dismissal, a show-cause notice is issued and the employee has
//     at least disc_reply_days to reply in writing (in the app); the decision must record how the reply was
//     considered;
//   • a hearing / inquiry is recorded before a final warning or dismissal (who attended, the employee's
//     account, findings); the employee may bring a colleague;
//   • stages cannot be skipped; only gross misconduct may go straight to dismissal, and still needs the
//     show-cause notice, the reply period, a hearing and the clinic admin;
//   • nobody acts in their own case; cases about the Operations Head or a manager are handled by the clinic admin;
//   • every letter states the right of appeal (disc_appeal_days); an appeal is decided by the clinic admin
//     and can uphold, reduce or overturn the action;
//   • letters are e-signed by the issuer, sent in the app and signed for by the employee (signing confirms
//     receipt, not agreement); a dismissal letter's delivery is recorded too.

import { clean, nz } from './util.js';
import { settings } from './clinic.js';
import { audit, pdfKit, isSuper } from './hr.js';
import { signerFor, issueGenerated, nextRef } from './docs.js';

const R = (s, e, x) => [s, e, x];
const OK = x => [200, null, x];
const IST = 330 * 60000;
const today = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString().slice(0, 19) + 'Z';
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const parse = (s, f) => { try { return s ? JSON.parse(s) : f; } catch { return f; } };
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const addMonths = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCMonth(t.getUTCMonth() + n); return t.toISOString().slice(0, 10); };
// Dates: plain YYYY-MM-DD as given; timestamps (UTC) shown as the clinic's local (IST) date.
const ist = d => d && d.length > 10 ? new Date(Date.parse(d.endsWith('Z') ? d : d + 'Z') + IST).toISOString().slice(0, 10) : d;
const fd = d => d ? new Date(ist(d).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }) : '';
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export const CATEGORIES = {
  attendance: 'Attendance and punctuality', conduct: 'Behaviour and conduct', confidentiality: 'Patient confidentiality and data',
  phone_social: 'Use of the clinic phone or social media', clinical: 'Clinical standards and patient safety', procedure: 'Not following clinic procedures',
  financial: 'Cash, billing or stock', property: 'Clinic property', other: 'Other',
};
// Gross misconduct — may go straight to dismissal (after show-cause, reply period and hearing).
export const GROSS = ['Theft, fraud or dishonesty', 'Serious breach of patient confidentiality or data', 'Violence, threats or harassment', 'Being under the influence of alcohol or drugs at work',
  'Falsifying records, attendance or bills', 'Serious risk to patient safety through negligence', 'Serious insubordination'];
export const STAGES = { verbal: 'Verbal warning', written: 'First written warning', final: 'Final written warning', dismissal: 'Dismissal' };
const LEVEL = { verbal: 1, written: 2, final: 3, dismissal: 4 };
// Clinic standards offered when typing the rule broken (alongside the policies, memos and notices issued in the app).
// A standard that is not in a policy the employee signed is weaker evidence — issue it as a policy when you can.
export const STANDARDS = [
  'Patient confidentiality — patient information, records and photographs must not be shared outside the clinic',
  'Attendance and punctuality — be at work for the full shift and clock in / out in the app',
  'Leave — apply in the app and get approval before taking leave',
  'Cash and billing — every payment is recorded in the clinic app when it is received',
  'Respectful behaviour towards patients, visitors and colleagues',
  "Clinical protocols, infection control and the duty doctor's instructions",
  'Clinic phone and social media — official use only; no clinic or patient content on personal social media',
  'Uniform, ID card and personal presentation',
  'Clinic property, stock and equipment — care and proper use',
  'No alcohol or drugs at work',
  'Honest records — attendance, patient records and bills must be true and complete',
];
const DEFAULTS = { disc_verbal_months: 6, disc_written_months: 12, disc_final_months: 12, disc_reply_days: 3, disc_appeal_days: 7 };

async function rules(env) {
  const s = await settings(env);
  const n = k => Number(s[k]) > 0 ? Number(s[k]) : DEFAULTS[k];
  const writtenBy = String(s.disc_written_by || s.leave_approvers || '').split(',').map(Number).filter(Boolean);
  return { s, verbal_months: n('disc_verbal_months'), written_months: n('disc_written_months'), final_months: n('disc_final_months'), reply_days: n('disc_reply_days'), appeal_days: n('disc_appeal_days'), writtenBy };
}
const staffRow = (env, id) => env.DB.prepare('SELECT s.id, s.name, s.role, s.skills, s.active, s.external, p.designation, p.joined_on FROM ems_staff s LEFT JOIN cl_staff_pay p ON p.staff_id=s.id WHERE s.id=?').bind(id).first();
const isDoctor = u => (u.skills || []).includes('doctor');
const isMgr = u => !!u.admin || u.role === 'manager';

// Who may do what, for a case about `staff`.
// "Clinic admin" below means the super admin (hr.js isSuper), not every admin-role account.
function powers(me, staff, rl) {
  const own = staff.id === me.id, sup = isSuper(me, rl.s);
  const senior = rl.writtenBy.includes(staff.id) || staff.role === 'manager' || staff.role === 'admin';
  const written = sup || (rl.writtenBy.includes(me.id) && !senior);
  return {
    own, senior,
    open: !own && (sup || (!senior && (isMgr(me) || isDoctor(me) || written))),
    verbal: !own && (sup || (!senior && (isMgr(me) || isDoctor(me)))),
    written: !own && written, final: !own && written, dismissal: !own && sup, appeal: sup,
  };
}

// Live (not lapsed, not overturned) warnings for a staff member, highest first.
async function standing(env, staffId) {
  const { results } = await env.DB.prepare(`SELECT a.*, c.case_no FROM cl_disc_actions a JOIN cl_disc_cases c ON c.id=a.case_id
    WHERE a.staff_id=? AND a.stage IN ('verbal','written','final') AND a.status='active' AND a.valid_until >= ? ORDER BY a.id DESC`).bind(staffId, today()).all();
  const live = results || [];
  const level = live.reduce((m, a) => Math.max(m, LEVEL[a.stage]), 0);
  return { live, level, next: ['verbal', 'written', 'final', 'dismissal'][Math.min(level, 3)] };
}

async function caseFull(env, id) {
  const c = await env.DB.prepare(`SELECT c.*, s.name staff_name, d.ref_no rule_ref, d.issued_at rule_issued_at, r.ack_at rule_ack_at FROM cl_disc_cases c JOIN ems_staff s ON s.id=c.staff_id
    LEFT JOIN cl_docs d ON d.id=c.rule_doc_id LEFT JOIN cl_doc_recipients r ON r.doc_id=c.rule_doc_id AND r.staff_id=c.staff_id WHERE c.id=?`).bind(id).first();
  if (!c) return null;
  const { results } = await env.DB.prepare(`SELECT a.*, d.ref_no, r.ack_at, r.response, r.ack_comment, r.form_data, r.refused_at
    FROM cl_disc_actions a LEFT JOIN cl_docs d ON d.id=a.doc_id LEFT JOIN cl_doc_recipients r ON r.doc_id=a.doc_id AND r.staff_id=a.staff_id WHERE a.case_id=? ORDER BY a.id`).bind(id).all();
  const actions = (results || []).map(a => ({ ...a, details: parse(a.details, {}), form_data: parse(a.form_data, null) }));
  return { ...c, attachments: parse(c.attachments, []), actions };
}
// Where a case stands and what may happen next.
function caseState(c, st, rl) {
  const acts = c.actions;
  const sc = [...acts].reverse().find(a => a.stage === 'show_cause');
  const hearing = [...acts].reverse().find(a => a.stage === 'hearing');
  const decided = acts.find(a => ['verbal', 'written', 'final', 'dismissal', 'no_action'].includes(a.stage));
  const replied = !!(sc && sc.ack_at && sc.form_data && sc.form_data.reply);
  const replyClosed = !!(sc && (replied || (sc.reply_due && sc.reply_due < today())));
  const ceiling = c.gross ? 'dismissal' : st.next; // the most the app allows for this case
  return { show_cause: sc || null, hearing: hearing || null, decided: decided || null, replied, reply_closed: replyClosed, ceiling,
    allowed: Object.keys(STAGES).filter(k => LEVEL[k] <= LEVEL[ceiling]) };
}

/* ---------------------------------- letters ---------------------------------- */

const COMPANY = s => s.legal_name || 'HASWEL CARE Private Limited';
// Standard PDF fonts cover Latin text only; anything else (e.g. Malayalam, arrows) prints as '?'.
const safe = t => String(t).replace(/₹/g, 'Rs.').replace(/→/g, '>').replace(/[^\x20-\x7E\xA0-\xFF–—‘’“”•…\n]/g, '?');
async function letter(env, { s, ref, staff: st0, subject, paras, sig, receipt }) {
  const k = await pdfKit(s);
  const staff = { ...st0, name: safe(st0.name), designation: st0.designation ? safe(st0.designation) : null };
  subject = safe(subject); sig = { ...sig, name: safe(sig.name), title: safe(sig.title || '') };
  k.text(`Ref: ${ref}`, k.L, 10, k.bold); k.right(`Date: ${fd(today())}`, k.L + k.W, 10); k.y -= 26;
  k.text('To', k.L, 9, k.reg, k.muted); k.y -= 13; k.text(staff.name, k.L, 11, k.bold); k.y -= 13;
  if (staff.designation) { k.text(staff.designation, k.L, 9.5); k.y -= 13; }
  k.y -= 12; k.text(`Subject: ${subject}`, k.L, 11, k.bold); k.y -= 22;
  k.wrap(`Dear ${staff.name.replace(/^Dr\.?\s+/i, '').split(' ')[0]},`); k.y -= 6;
  for (const p of paras.filter(Boolean)) {
    if (k.y < 140) { k.newPage(); }
    if (typeof p === 'object' && p.h) { k.y -= 2; k.text(safe(p.h), k.L, 10, k.bold); k.y -= 15; continue; }
    k.wrap(safe(p)); k.y -= 6;
  }
  if (k.y < 170) k.newPage();
  k.y -= 16; k.text(`For ${COMPANY(s)}`, k.L, 10); k.y -= 20;
  k.text(sig.name, k.L, 12, k.bold); k.y -= 13; k.text(sig.title || 'Authorised signatory', k.L, 9.5); k.y -= 12;
  k.text(`Electronically signed in the Hasta Clinic app on ${new Date(Date.parse(sig.at) + IST).toISOString().replace('T', ' ').slice(0, 16)} IST`, k.L, 8, k.reg, k.muted);
  k.y -= 30;
  k.wrap(safe(receipt || 'Employee acknowledgement: this letter is sent to you in the Hasta Clinic app (My documents). Signing it there confirms that you have received it; it does not mean you agree with it. If you disagree, choose "I disagree" and give your reasons — your response is kept with this letter.'), 8.5, k.reg, k.L, k.W, 11);
  return await k.pdf.save();
}
const facts = c => [
  `Date of the incident: ${fd(c.incident_date)}${c.incident_end && c.incident_end !== c.incident_date ? ` to ${fd(c.incident_end)}` : ''}.`,
  `What happened: ${c.allegation}`,
  `Rule or standard concerned: ${c.rule_breached}${c.rule_ack_at ? ` (${c.rule_ref}, which you read and signed in the Hasta Clinic app on ${fd(c.rule_ack_at)})` : c.rule_ref ? ` (${c.rule_ref}, issued to you in the Hasta Clinic app on ${fd(c.rule_issued_at)})` : ''}`,
  c.evidence ? `Evidence considered: ${c.evidence}` : null,
];
// Appeals go to someone not involved in the decision: the Managing Director, or — when the MD made the
// decision — the Board of Directors.
const appealPara = (rl, byMd, inApp = true) => `You have the right to appeal against this decision. To appeal, ${inApp ? 'choose "I disagree" when you sign this letter in the app, or ' : ''}write to ${byMd ? 'the Board of Directors of the company at the registered office' : 'the Managing Director'} within ${rl.appeal_days} days of receiving this letter, giving your reasons. The appeal will be decided by ${byMd ? 'the Board of Directors (a director who was not involved in this decision)' : 'the Managing Director, who was not involved in this decision'}, and you may attend an appeal meeting with a colleague.`;
const priorPara = st => st.live.length ? `Your record shows the following warning(s), which are still in force: ${st.live.map(a => `${STAGES[a.stage]} (${a.case_no}, issued ${fd(a.created_at)}, valid until ${fd(a.valid_until)})`).join('; ')}.` : null;
const replyPara = (sc, consideration) => sc ? (sc.form_data && sc.form_data.reply
  ? `We issued a show-cause notice (${sc.ref_no}) on ${fd(sc.created_at)} and received your written explanation on ${fd(sc.ack_at)}. We have considered it carefully. ${consideration}`
  : `We issued a show-cause notice (${sc.ref_no}) on ${fd(sc.created_at)} asking for your written explanation by ${fd(sc.reply_due)}. No explanation was received by that date. ${consideration}`) : null;

/* ---------------------------------- actions ---------------------------------- */

async function openCase(env, me, b) {
  const rl = await rules(env);
  const staff = await staffRow(env, parseInt(b.staff_id, 10));
  if (!staff || !staff.active || staff.external || staff.role === 'trainee') return R(400, 'Choose a current member of staff.');
  const pw = powers(me, staff, rl);
  if (!pw.open) return R(403, pw.own ? 'You cannot open a case about yourself.' : pw.senior ? 'Cases about the Operations Head or a manager are handled by the clinic admin.' : 'Only the duty doctor in charge, a manager, the Operations Head or the clinic admin can open a case.');
  const cat = CATEGORIES[b.category] ? b.category : null;
  const allegation = clean(b.allegation, 1500), rule = clean(b.rule_breached, 400), evidence = clean(b.evidence, 1500);
  if (!cat) return R(400, 'Choose the category.');
  if (!isDate(b.incident_date) || b.incident_date > today()) return R(400, 'Enter the date of the incident (not in the future).');
  if (b.incident_end && (!isDate(b.incident_end) || b.incident_end < b.incident_date || b.incident_end > today())) return R(400, 'Check the end date of the incident.');
  if (allegation.length < 30) return R(400, 'Describe specifically what happened — when, where, what was done or said (at least a few sentences). Vague allegations cannot be acted on.');
  if (rule.length < 5) return R(400, 'Name the rule, policy or standard that was broken (e.g. Office Order HCPL/OO/2026/001, clinic leave policy).');
  const gross = GROSS.includes(b.gross_type) ? b.gross_type : null;
  // A policy / memo issued in the app: it must have been sent to this employee.
  let ruleDoc = null;
  if (b.rule_doc_id) {
    ruleDoc = await env.DB.prepare("SELECT d.id FROM cl_docs d JOIN cl_doc_recipients r ON r.doc_id=d.id AND r.staff_id=? WHERE d.id=? AND d.status='issued' AND d.kind IN ('policy','memo','notice','training','form')").bind(staff.id, parseInt(b.rule_doc_id, 10)).first();
    if (!ruleDoc) return R(400, 'That document was not issued to this employee. Choose another, or type the rule.');
  }
  if (gross && !isSuper(me, rl.s) && !rl.writtenBy.includes(me.id)) return R(403, 'Only the Operations Head or the clinic admin can mark a case as gross misconduct.');
  const atts = (Array.isArray(b.attachments) ? b.attachments : []).filter(f => f && typeof f.key === 'string' && f.key.startsWith('staff-docs/')).slice(0, 10).map(f => ({ key: f.key, name: clean(f.name, 120), type: clean(f.type, 40) }));
  const pre = `DC/${today().slice(0, 4)}/`;
  const last = await env.DB.prepare('SELECT case_no FROM cl_disc_cases WHERE case_no LIKE ? ORDER BY id DESC LIMIT 1').bind(pre + '%').first();
  const no = pre + String((last ? parseInt(last.case_no.slice(pre.length), 10) : 0) + 1).padStart(4, '0');
  const id = (await env.DB.prepare(`INSERT INTO cl_disc_cases (case_no, staff_id, category, gross, incident_date, incident_end, allegation, rule_breached, rule_doc_id, evidence, attachments, raised_by, raised_by_name)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(no, staff.id, cat, gross, b.incident_date, nz(b.incident_end), allegation, rule, ruleDoc ? ruleDoc.id : null, nz(evidence), JSON.stringify(atts), me.id, me.name).run()).meta.last_row_id;
  await audit(env, me, 'disc.open', 'disc_case', id, `${no} ${staff.name}: ${CATEGORIES[cat]}${gross ? ' (GROSS: ' + gross + ')' : ''}`);
  return OK({ id, case_no: no });
}

async function act(env, me, id, b, request) {
  const rl = await rules(env);
  const c = await caseFull(env, id);
  if (!c) return R(404, 'Case not found.');
  if (c.status !== 'open' && b.action !== 'appeal') return R(400, 'This case is closed.');
  const staff = await staffRow(env, c.staff_id);
  const pw = powers(me, staff, rl), st = await standing(env, c.staff_id), cs = caseState(c, st, rl);
  const s = rl.s;
  const sign = async () => signerFor(env, me, request, b.sign);
  const addAction = (stage, extra) => env.DB.prepare('INSERT INTO cl_disc_actions (case_id, staff_id, stage, details, doc_id, reply_due, valid_until, by_id, by_name, status) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(c.id, c.staff_id, stage, JSON.stringify(extra.details || {}), extra.doc_id || null, extra.reply_due || null, extra.valid_until || null, me.id, me.name, extra.status || 'active').run();
  const close = async outcome => { await env.DB.prepare("UPDATE cl_disc_cases SET status='closed', outcome=?, closed_at=?, closed_by_name=? WHERE id=?").bind(outcome, nowIso(), me.name, c.id).run(); };
  const issueLetter = async (stage, subject, paras, sig, extra = {}) => {
    const ref = await nextRef(env, 'discipline');
    const bytes = await letter(env, { s, ref, staff, subject, paras, sig, receipt: extra.receipt });
    return issueGenerated(env, me, { kind: 'discipline', ref_no: ref, title: `${subject} — ${staff.name}`, body: null, bytes, file_name: `${ref.replace(/\//g, '-')}.pdf`,
      staff_ids: [staff.id], due_date: extra.due || addDays(today(), 3), source: 'discipline', source_id: c.id, sig, form: extra.form });
  };
  const a = b.action;

  if (a === 'verbal') {
    if (!pw.verbal) return R(403, pw.own ? 'You cannot act in a case about yourself.' : 'Only the duty doctor in charge, a manager or the clinic admin can give a verbal warning.');
    if (cs.decided) return R(400, 'This case already has an outcome.');
    if (!cs.allowed.includes('verbal')) return R(400, 'Not allowed at this stage.');
    const said = clean(b.discussion, 1500), present = clean(b.present, 200), response = clean(b.employee_response, 1000);
    if (!isDate(b.held_on) || b.held_on > today()) return R(400, 'Enter the date of the conversation.');
    if (said.length < 30) return R(400, 'Record what was discussed: the concern, what is expected from now on, and the consequence if it happens again.');
    if (response.length < 3) return R(400, "Record the employee's response during the conversation (or 'no comment').");
    const [ss, se, sig] = await sign(); if (ss !== 200) return R(ss, se);
    const valid = addMonths(today(), rl.verbal_months);
    const doc = await issueLetter('verbal', 'Record of verbal warning', [
      `This letter records the verbal warning given to you on ${fd(b.held_on)} by ${me.name}${present ? `, with ${present} present` : ''}.`,
      ...facts(c), { h: 'What was discussed' }, said, { h: 'Your response at the meeting' }, response,
      `This verbal warning will stay on your record for ${rl.verbal_months} months, until ${fd(valid)}. If the concern is repeated in that time, the next step may be a written warning.`,
      'If you think this record is not accurate, choose "I disagree" when you sign it in the app and say why within 7 days. Your comments are kept with this record.',
    ], sig);
    await addAction('verbal', { doc_id: doc.id, valid_until: valid, details: { held_on: b.held_on, present, discussion: said, employee_response: response } });
    await close('Verbal warning');
    await audit(env, me, 'disc.verbal', 'disc_case', c.id, `${c.case_no} ${doc.ref_no}`);
    return OK({ ref_no: doc.ref_no });
  }

  if (a === 'show_cause') {
    if (!(pw.written || pw.dismissal)) return R(403, 'Only the Operations Head or the clinic admin can issue a show-cause notice.');
    if (cs.decided) return R(400, 'This case already has an outcome.');
    if (cs.show_cause && !cs.reply_closed) return R(400, 'A show-cause notice is already waiting for a reply.');
    const days = Math.max(rl.reply_days, parseInt(b.reply_days, 10) || 0);
    const due = addDays(today(), days);
    const [ss, se, sig] = await sign(); if (ss !== 200) return R(ss, se);
    const proposed = cs.ceiling;
    const doc = await issueLetter('show_cause', 'Show-cause notice', [
      `It is alleged that you have committed the following misconduct. The details are set out below so that you can respond to them fully.`,
      ...facts(c),
      c.gross ? `This allegation, if proved, may amount to gross misconduct (${c.gross}).` : null,
      priorPara(st),
      { h: 'What you need to do' },
      `You are asked to explain in writing why disciplinary action should not be taken against you. Please write your explanation in the Hasta Clinic app (My documents → this notice) by ${fd(due)}. You may include anything you want us to consider, including the names of any witnesses and any documents.`,
      `If you need to see the evidence relied on, or need more time for a good reason, ask the Operations Head before ${fd(due)}.`,
      `After your reply, a meeting may be held at which you can explain your side in person. You may bring a colleague from the clinic with you.`,
      `If no explanation is received by ${fd(due)}, the matter will be decided on the information available. Depending on the findings, the action may be up to ${proposed === 'dismissal' ? 'dismissal from employment' : STAGES[proposed].toLowerCase()}. No decision has been made yet.`,
    ], sig, { due, form: { key: 'show_cause_reply', def: { title: 'Your written explanation', intro: 'Write your explanation in your own words. Your explanation is kept with this notice and will be considered before any decision is made.',
      sections: [{ title: 'Your reply', fields: [
        { k: 'reply', label: 'Your explanation', type: 'textarea', req: true },
        { k: 'witnesses', label: 'Witnesses or documents you want us to consider (optional)', type: 'textarea' },
        { k: 'companion', label: 'Colleague you would like to bring to any meeting (optional)', type: 'text' },
      ] }] } } });
    await addAction('show_cause', { doc_id: doc.id, reply_due: due, details: { proposed } });
    await audit(env, me, 'disc.show_cause', 'disc_case', c.id, `${c.case_no} ${doc.ref_no} reply by ${due}`);
    return OK({ ref_no: doc.ref_no, reply_due: due });
  }

  if (a === 'hearing') {
    if (!(pw.written || pw.dismissal)) return R(403, 'Only the Operations Head or the clinic admin can record a hearing.');
    if (!cs.show_cause) return R(400, 'Issue a show-cause notice first.');
    if (!cs.reply_closed) return R(400, `Wait for the employee's written reply (due ${fd(cs.show_cause.reply_due)}).`);
    if (!isDate(b.held_on) || b.held_on > today()) return R(400, 'Enter the date of the hearing.');
    const present = clean(b.present, 300), account = clean(b.employee_account, 2000), findings = clean(b.findings, 2000);
    if (present.length < 3) return R(400, 'Record who was present (including whether the employee attended, and any colleague with them).');
    if (account.length < 3) return R(400, "Record the employee's account at the hearing (or that they did not attend after being told the date).");
    if (findings.length < 30) return R(400, 'Record the findings: which allegations are proved, on what evidence, and anything in mitigation.');
    await addAction('hearing', { details: { held_on: b.held_on, present, employee_account: account, findings, attended: b.attended === false ? false : true } });
    await audit(env, me, 'disc.hearing', 'disc_case', c.id, `${c.case_no} hearing ${b.held_on}`);
    return OK();
  }

  if (a === 'decide') {
    const stage = b.stage;
    if (cs.decided) return R(400, 'This case already has an outcome.');
    const consideration = clean(b.consideration, 1500), reasons = clean(b.reasons, 1500), improve = clean(b.improvement, 1000);
    if (stage === 'no_action') {
      if (!(pw.written || pw.dismissal || pw.verbal)) return R(403, 'Not allowed.');
      if (reasons.length < 10) return R(400, 'Give the reason for closing without action.');
      await addAction('no_action', { details: { reasons } }); await close('No action');
      await audit(env, me, 'disc.no_action', 'disc_case', c.id, `${c.case_no}: ${reasons}`);
      return OK();
    }
    if (!['written', 'final', 'dismissal'].includes(stage)) return R(400, 'Choose the outcome.');
    if (!pw[stage]) return R(403, stage === 'dismissal' ? 'Only the clinic admin can dismiss an employee.' : 'Only the Operations Head or the clinic admin can issue written warnings.');
    if (!cs.allowed.includes(stage)) return R(400, `Stages cannot be skipped. ${staff.name}'s live warnings allow up to: ${STAGES[cs.ceiling]}.${c.gross ? '' : ' Only a case marked as gross misconduct can go further.'}`);
    if (!cs.show_cause) return R(400, 'A show-cause notice must be issued first, and the employee given time to reply.');
    if (!cs.reply_closed) return R(400, `The employee has until ${fd(cs.show_cause.reply_due)} to reply. Wait for the reply or that date.`);
    if ((stage === 'final' || stage === 'dismissal') && !cs.hearing) return R(400, 'Record the hearing / inquiry before a final warning or dismissal.');
    if (consideration.length < 30) return R(400, cs.replied ? "Explain how the employee's explanation was considered and why it was not accepted (in full or in part)." : 'Record that no reply was received and how the matter was decided on the evidence.');
    if (reasons.length < 30) return R(400, 'Give the reasons for this decision: what is proved, and why this level of action is fair (including any previous record and mitigation).');
    let leaving = null;
    if (stage === 'dismissal') {
      if (!isDate(b.effective) || b.effective < today()) return R(400, 'Choose the date the dismissal takes effect (today or later).');
      if (!isDate(b.last_day) || b.last_day > b.effective) return R(400, 'Enter the last working day (on or before the effective date).');
      if (!['person', 'email', 'whatsapp', 'post'].includes(b.delivery)) return R(400, 'Record how the letter will be delivered to the employee.');
      leaving = { effective: b.effective, last_day: b.last_day, delivery: b.delivery, notice: clean(b.notice_terms, 400) };
    } else if (improve.length < 10) return R(400, 'Say what improvement or conduct is expected from now on.');
    const [ss, se, sig] = await sign(); if (ss !== 200) return R(ss, se);
    const months = stage === 'written' ? rl.written_months : rl.final_months;
    const valid = stage === 'dismissal' ? null : addMonths(today(), months);
    const subject = stage === 'dismissal' ? 'Dismissal from employment' : STAGES[stage];
    const paras = [
      `This letter concerns case ${c.case_no}.`, ...facts(c),
      replyPara(cs.show_cause, consideration),
      cs.hearing ? `A hearing was held on ${fd(cs.hearing.details.held_on)} (present: ${cs.hearing.details.present}). Findings: ${cs.hearing.details.findings}` : null,
      priorPara(st),
      { h: 'Decision' },
      c.gross ? `The clinic finds that this amounts to gross misconduct (${c.gross}).` : null,
      reasons,
    ];
    if (stage === 'written') paras.push(`You are therefore given a first written warning. It will stay on your record for ${months} months, until ${fd(valid)}.`, { h: 'What is expected from now on' }, improve,
      'If there is further misconduct while this warning is in force, the next step may be a final written warning.', appealPara(rl, isSuper(me, s)));
    if (stage === 'final') paras.push(`You are therefore given a final written warning. It will stay on your record for ${months} months, until ${fd(valid)}.`, { h: 'What is expected from now on' }, improve,
      'Please understand clearly that any further misconduct while this final warning is in force is likely to result in your dismissal.', appealPara(rl, isSuper(me, s)));
    if (stage === 'dismissal') paras.push(
      `For these reasons, the clinic has decided to dismiss you from employment with effect from ${fd(leaving.effective)}. Your last working day ${leaving.last_day < today() ? 'was' : 'is'} ${fd(leaving.last_day)}.`,
      leaving.notice || null,
      'Your salary up to your last working day and any other amounts due to you will be paid in a full and final settlement, less any deductions allowed by law. Please return all clinic property (including any clinic phone, uniform, ID card, keys, documents and records) on or before your last working day.',
      'Your duty to keep patient and clinic information confidential continues after your employment ends.',
      appealPara(rl, true, false));
    const DELIVERY = { person: 'handed to you in person', email: 'sent to you by email', whatsapp: 'sent to you on WhatsApp', post: 'sent to you by registered post with acknowledgement due' };
    const doc = await issueLetter(stage, subject, paras, sig, { due: addDays(today(), stage === 'dismissal' ? 1 : 3),
      receipt: stage === 'dismissal' ? `This letter is ${DELIVERY[leaving.delivery]}, and a copy is kept on your staff file in the Hasta Clinic app.\n\nReceived by (employee signature and date): ____________________________` : undefined });
    await addAction(stage, { doc_id: doc.id, valid_until: valid, details: { consideration, reasons, improvement: improve, ...(leaving || {}), show_cause_doc: cs.show_cause.doc_id, hearing_id: cs.hearing ? cs.hearing.id : null } });
    await close(STAGES[stage]);
    if (stage === 'dismissal') {
      // Leaving date for payroll; the account is switched off from the effective date (today if effective today).
      await env.DB.prepare('UPDATE cl_staff_pay SET left_on=?, updated_at=? WHERE staff_id=?').bind(leaving.last_day, nowIso(), staff.id).run();
      if (leaving.effective <= today()) await env.DB.batch([env.DB.prepare('UPDATE ems_staff SET active=0 WHERE id=?').bind(staff.id), env.DB.prepare("DELETE FROM ems_sessions WHERE kind='staff' AND subject_id=?").bind(staff.id)]);
      else await env.DB.prepare("INSERT INTO cl_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(`disc_deactivate_${staff.id}`, leaving.effective).run();
    }
    await audit(env, me, 'disc.' + stage, 'disc_case', c.id, `${c.case_no} ${doc.ref_no}${valid ? ' valid to ' + valid : ''}`);
    return OK({ ref_no: doc.ref_no });
  }

  if (a === 'appeal') {
    if (!pw.appeal) return R(403, 'Appeals are decided by the clinic admin (Managing Director).');
    const target = c.actions.find(x => ['verbal', 'written', 'final', 'dismissal'].includes(x.stage));
    if (!target) return R(400, 'There is no decision to appeal.');
    const decidedBy = clean(b.decided_by, 120);
    if (target.by_id === me.id && decidedBy.length < 3) return R(400, 'You made this decision, so the appeal must be decided by someone else (e.g. the Board of Directors). Enter who decided the appeal; you are recording their decision.');
    const result = ['upheld', 'reduced', 'overturned'].includes(b.result) ? b.result : null;
    const reasons = clean(b.reasons, 1500);
    if (!result) return R(400, 'Choose the appeal outcome.');
    if (reasons.length < 30) return R(400, 'Give the reasons for the appeal decision.');
    let newStage = null;
    if (result === 'reduced') { newStage = b.new_stage; if (!(LEVEL[newStage] && LEVEL[newStage] < LEVEL[target.stage] && newStage !== 'dismissal')) return R(400, 'Choose the lower level the action is reduced to.'); }
    const [ss, se, sig] = await sign(); if (ss !== 200) return R(ss, se);
    const doc = await issueLetter('appeal', 'Outcome of your appeal', [
      `You appealed against the ${STAGES[target.stage].toLowerCase()} issued to you on ${fd(target.created_at)} (${target.ref_no || c.case_no}). The appeal has been considered by ${decidedBy || (sig.name + (sig.title ? ', ' + sig.title : ''))}.`,
      reasons,
      result === 'upheld' ? 'The decision is upheld. This is the final stage of the clinic\'s procedure.' :
      result === 'reduced' ? `The decision is reduced to a ${STAGES[newStage].toLowerCase()}, which will stay on your record until ${fd(addMonths(today(), newStage === 'verbal' ? rl.verbal_months : newStage === 'written' ? rl.written_months : rl.final_months))}.` :
      'The decision is overturned and removed from your disciplinary record.',
      target.stage === 'dismissal' && result !== 'upheld' ? 'You are reinstated with continuity of service. Please contact the Office Manager to arrange your return to work.' : null,
    ], sig, { receipt: 'This letter is sent to you in the Hasta Clinic app. Signing it confirms that you have received it.' });
    await env.DB.prepare("UPDATE cl_disc_actions SET status=? WHERE id=?").bind(result === 'upheld' ? 'active' : result, target.id).run();
    if (result === 'reduced') await addAction(newStage, { doc_id: doc.id, valid_until: addMonths(today(), newStage === 'verbal' ? rl.verbal_months : newStage === 'written' ? rl.written_months : rl.final_months), details: { on_appeal: true, reasons } });
    await addAction('appeal', { doc_id: doc.id, details: { result, reasons, new_stage: newStage, decided_by: decidedBy || null }, status: result });
    if (target.stage === 'dismissal' && result !== 'upheld') await env.DB.batch([env.DB.prepare('UPDATE ems_staff SET active=1 WHERE id=?').bind(staff.id), env.DB.prepare('UPDATE cl_staff_pay SET left_on=NULL WHERE staff_id=?').bind(staff.id)]);
    await env.DB.prepare('UPDATE cl_disc_cases SET outcome=? WHERE id=?').bind(`${c.outcome} — appeal ${result}`, c.id).run();
    await audit(env, me, 'disc.appeal', 'disc_case', c.id, `${c.case_no} appeal ${result}`);
    return OK({ ref_no: doc.ref_no });
  }
  if (a === 'withdraw') {
    if (!(pw.written || pw.dismissal)) return R(403, 'Only the Operations Head or the clinic admin can withdraw a case.');
    if (cs.decided) return R(400, 'This case already has an outcome.');
    const reasons = clean(b.reasons, 500); if (reasons.length < 10) return R(400, 'Give the reason.');
    await addAction('no_action', { details: { reasons, withdrawn: true } }); await close('Withdrawn');
    await audit(env, me, 'disc.withdraw', 'disc_case', c.id, `${c.case_no}: ${reasons}`);
    return OK();
  }
  return R(400, 'Unknown action.');
}

// Dismissals that take effect on a later date: switch the account off on the day.
export async function disciplineDaily(env) {
  const { results } = await env.DB.prepare("SELECT key, value FROM cl_settings WHERE key LIKE 'disc_deactivate_%' AND value <= ?").bind(today()).all();
  for (const r of results || []) {
    const id = parseInt(r.key.slice('disc_deactivate_'.length), 10);
    await env.DB.batch([env.DB.prepare('UPDATE ems_staff SET active=0 WHERE id=?').bind(id), env.DB.prepare("DELETE FROM ems_sessions WHERE kind='staff' AND subject_id=?").bind(id), env.DB.prepare('DELETE FROM cl_settings WHERE key=?').bind(r.key)]);
  }
}

/* ---------------------------------- route ---------------------------------- */

export async function disciplineRoute(request, env, url, me, p, m, b) {
  if (!p.startsWith('/hr/discipline')) return null;
  const rl = await rules(env);
  const may = isSuper(me, rl.s) || isMgr(me) || isDoctor(me) || rl.writtenBy.includes(me.id);
  if (!may) return json({ ok: false, error: 'Not available.' }, 403);
  const done = ([s, e, x]) => json(s === 200 ? { ok: true, ...(x || {}) } : { ok: false, error: e, ...(x || {}) }, s);
  const full = isSuper(me, rl.s) || isMgr(me) || rl.writtenBy.includes(me.id);
  let mm;
  if (p === '/hr/discipline' && m === 'GET') {
    const { results: cases } = await env.DB.prepare(`SELECT c.id, c.case_no, c.staff_id, s.name staff_name, c.category, c.gross, c.incident_date, c.status, c.outcome, c.raised_by_name, c.created_at,
        (SELECT stage FROM cl_disc_actions a WHERE a.case_id=c.id ORDER BY a.id DESC LIMIT 1) last_stage,
        (SELECT reply_due FROM cl_disc_actions a WHERE a.case_id=c.id AND a.stage='show_cause' ORDER BY a.id DESC LIMIT 1) reply_due
      FROM cl_disc_cases c JOIN ems_staff s ON s.id=c.staff_id ${full ? '' : 'WHERE c.raised_by=?'} ORDER BY c.status='open' DESC, c.id DESC LIMIT 300`).bind(...(full ? [] : [me.id])).all();
    const { results: staff } = await env.DB.prepare("SELECT id, name, role FROM ems_staff WHERE active=1 AND external=0 AND role <> 'trainee' AND username <> 'hasta' ORDER BY name").all();
    const standings = {};
    for (const x of staff || []) { const st = await standing(env, x.id); standings[x.id] = { level: st.level, next: st.next, live: st.live.map(a => ({ stage: a.stage, case_no: a.case_no, valid_until: a.valid_until })) }; }
    return json({ ok: true, cases: cases || [], staff: (staff || []).map(x => ({ ...x, powers: powers(me, x, rl) })), standings, categories: CATEGORIES, gross: GROSS, stages: STAGES,
      rules: { verbal_months: rl.verbal_months, written_months: rl.written_months, final_months: rl.final_months, reply_days: rl.reply_days, appeal_days: rl.appeal_days }, full });
  }
  if (p === '/hr/discipline' && m === 'POST') return done(await openCase(env, me, b));
  // Suggestions for "Rule, policy or standard broken": documents issued to this employee (with whether they signed), then clinic standards.
  if (p === '/hr/discipline/rules' && m === 'GET') {
    const sid = parseInt(url.searchParams.get('staff_id'), 10) || 0;
    const { results } = await env.DB.prepare(`SELECT d.id, d.ref_no, d.kind, d.title, d.issued_at, r.ack_at, r.response FROM cl_docs d JOIN cl_doc_recipients r ON r.doc_id=d.id AND r.staff_id=?
      WHERE d.status='issued' AND d.kind IN ('policy','memo','notice','training','form') ORDER BY d.id DESC`).bind(sid).all();
    return json({ ok: true, docs: (results || []).map(d => ({ id: d.id, ref_no: d.ref_no, kind: d.kind, title: d.title, issued_at: d.issued_at, ack_at: d.ack_at, disputed: d.response === 'disputed' })), standards: STANDARDS });
  }
  if ((mm = p.match(/^\/hr\/discipline\/(\d+)$/)) && m === 'GET') {
    const c = await caseFull(env, +mm[1]);
    if (!c || (!full && c.raised_by !== me.id)) return json({ ok: false, error: 'Not found.' }, 404);
    const staff = await staffRow(env, c.staff_id), st = await standing(env, c.staff_id);
    return json({ ok: true, case: c, state: caseState(c, st, rl), standing: { level: st.level, next: st.next, live: st.live }, powers: powers(me, staff, rl), stages: STAGES, categories: CATEGORIES,
      rules: { reply_days: rl.reply_days, appeal_days: rl.appeal_days } });
  }
  if ((mm = p.match(/^\/hr\/discipline\/(\d+)\/act$/)) && m === 'POST') return done(await act(env, me, +mm[1], b, request));
  if ((mm = p.match(/^\/hr\/discipline\/(\d+)\/file\/(\d+)$/)) && m === 'GET') {
    if (!full) return json({ ok: false, error: 'Not found.' }, 404);
    const c = await env.DB.prepare('SELECT attachments FROM cl_disc_cases WHERE id=?').bind(+mm[1]).first();
    const f = c && parse(c.attachments, [])[+mm[2]];
    const obj = f && env.CVS ? await env.CVS.get(f.key) : null;
    if (!obj) return json({ ok: false, error: 'Not found.' }, 404);
    return new Response(obj.body, { headers: { 'content-type': f.type || 'application/octet-stream', 'content-disposition': `inline; filename="${(f.name || 'evidence').replace(/"/g, '')}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
  }
  return json({ ok: false, error: 'Not found' }, 404);
}
