// Hasta EMS Academy — training and certification framework v1.0, enforced.
//
// Chain: Level A external qualification (verified by someone other than the holder)
//   → Hasta Master Trainer (coach/doctor + verified Level A covering the machine + Master Trainer course)
//   → Hasta Certified EMS Trainer (approved curriculum, theory ≥80%, ≥10 supervised sessions incl. 3 first
//     sessions, every practical checklist item passed) — per machine, 12 months, with a public verification code.

import { PDFDocument, StandardFonts, rgb } from './vendor/pdf-lib.esm.min.js';
import qrcode from './vendor/qrcode.js';
import { clean, nz, h } from './util.js';

export const RULES = { pass_mark: 80, questions: 40, max_attempts: 3, supervised: 10, first_sessions: 3, cert_months: 12, master_months: 24, renewal_activity: 20 };
export const BLUEPRINT = { how: 6, contra: 10, rhabdo: 6, machine: 6, session: 5, emergency: 4, protocols: 3 };
export const AREAS = { how: 'How EMS works', contra: 'Contraindications and pre-session checks', rhabdo: 'Rhabdomyolysis, hydration and recovery', machine: 'Machine operation and electrode placement', session: 'Running a session', emergency: 'Emergencies and incident reporting', protocols: 'Hasta protocols, consent and data protection' };
export const CHECKLIST = [
  ['admission', 'Confirms the client\'s admission is complete and checks for changes since the last session (health, medicines, pregnancy, illness)', true],
  ['recovery', 'Checks the 48-hour recovery gap and asks about soreness or dark urine after the last session', true],
  ['hydration', 'Checks hydration and that the client has eaten; advises water before and after', false],
  ['inspect', 'Inspects the device, cables, suit and electrodes for damage before use', false],
  ['fit', 'Fits the suit and electrodes correctly for the client\'s size; moistens contact areas as specified by the supplier', false],
  ['placement', 'Avoids placement over wounds, rashes, implants or areas restricted by the clinician', true],
  ['explain', 'Explains what the client will feel and how to signal discomfort', false],
  ['programme', 'Selects the programme approved for the client\'s stage and the clinician\'s precautions', false],
  ['intensity', 'Increases intensity gradually per muscle group, within first-session limits', true],
  ['observe', 'Watches and talks with the client throughout; adjusts intensity on feedback', false],
  ['estop', 'Demonstrates the emergency stop and responds correctly to a simulated adverse reaction', true],
  ['cooldown', 'Completes cool-down and checks how the client feels before they leave', false],
  ['advice', 'Gives recovery and hydration advice and books the next session at least 48 hours later', false],
  ['clean', 'Cleans and stores the suit and electrodes as specified by the supplier', false],
  ['notes', 'Records session notes, any concerns and incidents in the platform', false],
  ['conduct', 'Maintains privacy, dignity and professional conduct throughout', false],
];

const MODULES_V1 = [
  [1, 'How EMS works', 'Muscle physiology, impulse parameters, programme types, expected effects and limits, evidence and claims.', '3', 'Theory test'],
  [2, 'Client safety and contraindications', 'Absolute and relative contraindications, pre-session checks, when to stop, referral to clinician. Uses Hasta\'s admission screening.', '4', 'Theory + practical'],
  [3, 'Rhabdomyolysis, hydration and recovery', 'Risk factors, first-session limits, 48-hour recovery rule, warning signs (pain, dark urine), escalation.', '2', 'Theory + scenario'],
  [4, 'Machine module (per model)', 'Supplier\'s official course: set-up, suit/electrode fitting, controls, programmes, cleaning, faults.', 'Per supplier', 'Practical'],
  [5, 'Running a session', 'Intensity progression, per-muscle-group adjustment, communication during the session, cool-down, session notes.', '4', 'Practical'],
  [6, 'Emergencies and first aid', 'Emergency stop, fainting, cramps, skin reactions, incident reporting. Basic life support certificate required separately.', '2', 'Scenario'],
  [7, 'Hasta protocols and the platform', 'Admission and consent, package rules, booking, measurements, data protection and confidentiality.', '2', 'Theory'],
  [8, 'Client care and ethics', 'Respectful practice, privacy and chaperone policy, realistic expectations, no outcome promises, complaints.', '1', 'Theory'],
  [9, 'Supervised practice', 'Logged sessions with real clients under direct Master Trainer supervision.', '10 sessions', 'Log + sign-off'],
].map(([no, title, content, hours, assessed]) => ({ no, title, content, hours, assessed }));

// Starter question bank — every question must be approved by the medical lead before use.
const Q = [
  ['how', 'What does EMS do?', ['Uses electrical impulses through electrodes to make muscles contract', 'Heats fat cells so they shrink', 'Replaces the need for diet and activity', 'Vibrates the bones to build strength'], 0],
  ['how', 'Which claim about EMS is realistic?', ['EMS guarantees a set amount of weight loss', 'EMS can support strength and muscle tone as part of a programme', 'EMS works the same for every client', 'EMS removes the need for rest days'], 1],
  ['how', 'Why are EMS sessions short and limited to about twice a week?', ['The device overheats', 'The muscle load is high and muscles need time to recover', 'Clients get bored', 'Electricity bills are high'], 1],
  ['how', 'How should impulse intensity be set?', ['The same level for every client', 'The maximum the device allows', 'Individually for each muscle group, based on client feedback', 'By the client alone without supervision'], 2],
  ['how', 'Which statement about EMS and weight loss is accurate?', ['EMS alone is a complete weight-loss treatment', 'EMS is not a weight-loss treatment on its own; food, activity and sleep matter', 'EMS burns fat while the client sleeps', 'EMS works best with no change to diet'], 1],
  ['how', 'Why are contact areas or electrodes moistened (where the supplier specifies)?', ['To cool the client down', 'To ensure good conduction and comfort', 'To clean the suit', 'It is not needed'], 1],
  ['how', 'What should the client feel during a correctly set session?', ['Sharp pain', 'Nothing at all', 'A strong but tolerable muscle contraction, never pain', 'Numbness'], 2],
  ['contra', 'Which of these is an absolute contraindication to EMS?', ['A pacemaker or other implanted electronic device', 'Mild muscle stiffness', 'Being new to exercise', 'Wearing glasses'], 0],
  ['contra', 'A client tells you she may be pregnant. What do you do?', ['Continue at low intensity', 'Do not give EMS and inform the clinician', 'Avoid the abdomen only', 'Ask her to sign a waiver'], 1],
  ['contra', 'A client mentions they have epilepsy, which was not on their screening. What do you do?', ['Continue as planned', 'Do not start the session; refer to the clinician for review', 'Use only leg electrodes', 'Lower the intensity by half'], 1],
  ['contra', 'A client arrives with a fever. What do you do?', ['Go ahead with a short session', 'Postpone the session', 'Increase hydration and continue', 'Use a different programme'], 1],
  ['contra', 'A client had surgery four months ago. Before any EMS session:', ['Nothing is needed after three months', 'The clinician must have reviewed it and cleared the client', 'Avoid only the scar', 'The client decides'], 1],
  ['contra', 'There is an open wound where an electrode would sit. You should:', ['Cover it with tape and continue', 'Not place an electrode there and check with the clinician', 'Increase intensity elsewhere', 'Ignore it if it is small'], 1],
  ['contra', 'Before every session, the trainer must:', ['Only check the device', 'Ask about any changes in health since the last session', 'Check the client\'s payment first', 'Nothing if the client is a regular'], 1],
  ['contra', 'A client answered Yes to "heart condition" in screening. What applies?', ['They can start at low intensity', 'They cannot start until a clinician has assessed and cleared them', 'They need only a doctor\'s phone call', 'Trainers decide case by case'], 1],
  ['contra', 'The platform shows a client\'s admission is not complete. You:', ['Give a trial session', 'Cannot give an EMS session', 'Give a session and complete paperwork later', 'Ask the client to sign at the end'], 1],
  ['contra', 'A client has started a new regular medicine since admission. You:', ['Ignore it', 'Inform the clinician before proceeding', 'Halve the intensity', 'Ask the client if they feel fine'], 1],
  ['contra', 'A client reports a past blood clot (thrombosis). You:', ['Continue as normal', 'Treat it as needing clinician review; EMS may not be suitable', 'Avoid the legs only', 'Increase recovery time only'], 1],
  ['rhabdo', 'What is rhabdomyolysis?', ['A skin rash from electrodes', 'Breakdown of muscle tissue that releases its contents into the blood and can damage the kidneys', 'Normal muscle soreness', 'A device fault'], 1],
  ['rhabdo', 'Which is a warning sign of rhabdomyolysis?', ['Mild tiredness', 'Dark, cola-coloured urine', 'Feeling hungry', 'Slight redness under pads'], 1],
  ['rhabdo', 'What most increases the risk of rhabdomyolysis with EMS?', ['Drinking water', 'Too high an intensity, especially in early sessions or without enough recovery', 'Short sessions', 'Wearing the suit snugly'], 1],
  ['rhabdo', 'What is the Hasta minimum gap between a client\'s EMS sessions?', ['12 hours', '24 hours', '48 hours', 'No minimum'], 2],
  ['rhabdo', 'Two days after a session, a client reports severe muscle pain, swelling and dark urine. You:', ['Tell them it is normal soreness', 'Advise urgent medical attention, inform the clinician and report an incident', 'Book a lighter session', 'Suggest a massage'], 1],
  ['rhabdo', 'What hydration advice should clients get?', ['Avoid water before sessions', 'Drink water before and after the session', 'Only drink after the session', 'Hydration does not matter'], 1],
  ['rhabdo', 'How should first-session intensity be set?', ['At the client\'s maximum tolerance', 'Conservatively, within the first-session limits set by the medical lead', 'The same as an experienced client', 'By the client'], 1],
  ['machine', 'Before each session you should check:', ['Only the power switch', 'Cables, suit and electrodes for damage', 'Nothing if it worked yesterday', 'The client\'s shoes'], 1],
  ['machine', 'The device shows a fault during a session. You:', ['Restart and carry on', 'Stop the session, do not continue on that device, and report the fault', 'Turn intensity up to compensate', 'Ask the client to hold still'], 1],
  ['machine', 'A device is marked "under maintenance" in the platform. It:', ['Can be used for short sessions', 'Cannot be used or booked', 'Can be used by managers', 'Can be used if the client agrees'], 1],
  ['machine', 'How should the suit fit?', ['Loose for comfort', 'Snug and sized to the client for good electrode contact', 'Any size is fine', 'Tight enough to restrict breathing'], 1],
  ['machine', 'After the session, the suit and electrodes should be:', ['Left to dry on the floor', 'Cleaned and stored as the supplier specifies', 'Washed with any detergent', 'Shared without cleaning'], 1],
  ['machine', 'You are certified only on one machine model and are asked to run a session on another model. You:', ['Run it carefully', 'Decline; you may only run sessions on machines you are certified for', 'Ask the client', 'Run it if a manager agrees'], 1],
  ['session', 'How should intensity be increased?', ['Quickly to the maximum', 'Gradually, per muscle group, with client feedback', 'Only by the client', 'Once at the start'], 1],
  ['session', 'During the session the trainer:', ['May supervise two clients at once', 'Stays with the client and watches throughout, one client at a time', 'Can leave once settings are done', 'Checks in every ten minutes'], 1],
  ['session', 'The client says one area feels painful. You:', ['Tell them to push through', 'Reduce the intensity for that area', 'Stop all future sessions', 'Increase other areas'], 1],
  ['session', 'At the end of a session you:', ['Remove the suit and send the client away', 'Complete a cool-down and check how the client feels', 'Book a session for tomorrow', 'Skip notes if busy'], 1],
  ['session', 'When should the client\'s next EMS session be booked?', ['The next day', 'At least 48 hours later', 'Any time', 'Only after a week'], 1],
  ['session', 'Session notes should be:', ['Kept on paper at home', 'Recorded in the platform, including any concerns', 'Shared on WhatsApp groups', 'Optional'], 1],
  ['emergency', 'A client feels dizzy and faint during a session. You:', ['Lower intensity slightly and continue', 'Stop immediately, help them lie down with legs raised, monitor them and get help if needed', 'Give them sugar and continue', 'Ask them to walk it off'], 1],
  ['emergency', 'When should you know where the emergency stop is?', ['Only during the first session', 'Before every session, and you should be able to use it at once', 'Only managers need to know', 'It is not needed'], 1],
  ['emergency', 'When must an adverse event be reported?', ['Only if the client complains', 'The same day, in the incident log', 'At the monthly meeting', 'Only if serious'], 1],
  ['emergency', 'A client is unresponsive and not breathing normally. You:', ['Wait for them to recover', 'Call emergency services and start basic life support', 'Remove the suit first, then decide', 'Call the manager first'], 1],
  ['protocols', 'A client\'s package does not include progress reviews and they ask for one. You:', ['Do one anyway', 'Explain it is not included and offer an upgrade; it cannot be booked', 'Do it off the record', 'Charge cash'], 1],
  ['protocols', 'Client health information must be:', ['Shared with friends if asked', 'Kept confidential and shared only within the care team', 'Posted for training', 'Discussed in public areas'], 1],
  ['protocols', 'Who approves clinical exceptions such as entry requirements or contraindication rules?', ['Any trainer', 'The unit manager', 'The medical lead', 'The client'], 2],
];

/* ---------------- helpers ---------------- */
const parse = (s, f) => { try { return s ? JSON.parse(s) : f; } catch { return f; } };
const nowIso = () => new Date().toISOString().slice(0, 19) + 'Z';
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const addMonths = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const R = (s, e, x) => [s, e, x];
// Deterministic shuffle so option order differs per attempt but can be mapped back on submit.
function perm(seed, n) {
  let x = (seed * 2654435761) >>> 0 || 1;
  const rnd = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  const p = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  return p; // p[displayed index] = original index
}

export async function ensureSeed(env) {
  const c = await env.DB.prepare('SELECT COUNT(*) n FROM ems_curriculum').first();
  if (!c.n) await env.DB.prepare("INSERT INTO ems_curriculum (version, modules, status, notes) VALUES ('1.0', ?, 'draft', 'Agreed with the equipment supplier and medical lead (framework v1.0). Awaiting approval in the platform by the medical lead.')").bind(JSON.stringify(MODULES_V1)).run();
  const q = await env.DB.prepare('SELECT COUNT(*) n FROM ems_questions').first();
  if (!q.n) for (const [area, question, options, answer] of Q) await env.DB.prepare('INSERT INTO ems_questions (area, question, options, answer) VALUES (?,?,?,?)').bind(area, question, JSON.stringify(options), answer).run();
}

async function staffRow(env, id) {
  if (!id) return null;
  const s = await env.DB.prepare('SELECT id, name, role, skills, reg_no, master_course_on, master_course_by, active FROM ems_staff WHERE id=?').bind(id).first();
  return s ? { ...s, skills: parse(s.skills, []) } : null;
}
const isMedLead = s => s && s.skills.includes('medical_lead');
const canVerify = (me, s) => me.role === 'admin' || isMedLead(s);
export const approvedCurriculum = env => env.DB.prepare("SELECT * FROM ems_curriculum WHERE status='approved' ORDER BY id DESC LIMIT 1").first();

// A verified, in-date Level A qualification covering the machine, plus coach/doctor skill and a current Master Trainer course.
export async function masterQual(env, staffId, machineId) {
  const s = await staffRow(env, staffId);
  if (!s || !s.active || !(s.skills.includes('coach') || s.skills.includes('doctor'))) return { ok: false, reason: 'Only wellness coaches or doctors can be Master Trainers.' };
  if (!s.master_course_on || addMonths(s.master_course_on, RULES.master_months) < today()) return { ok: false, reason: 'The Hasta Master Trainer course has not been recorded, or is more than 24 months old.' };
  const { results } = await env.DB.prepare("SELECT * FROM ems_external_quals WHERE staff_id=? AND status='verified' AND expires_on >= ? ORDER BY expires_on DESC").bind(staffId, today()).all();
  const q = (results || []).find(x => parse(x.machine_types, []).includes(machineId));
  if (!q) return { ok: false, reason: 'No verified, in-date external qualification covering this machine.' };
  return { ok: true, qual: q, staff: s };
}

/* ---------------- overview ---------------- */
export async function overview(env, me) {
  await ensureSeed(env);
  const s = await staffRow(env, me.id);
  const cur = await env.DB.prepare('SELECT * FROM ems_curriculum ORDER BY id DESC').all();
  const machines = (await env.DB.prepare('SELECT id, name FROM ems_machine_types WHERE active=1 ORDER BY name').all()).results || [];
  const masterOn = [];
  for (const m of machines) if ((await masterQual(env, me.id, m.id)).ok) masterOn.push(m.id);
  const qc = await env.DB.prepare("SELECT area, COUNT(*) n FROM ems_questions WHERE status='approved' GROUP BY area").all();
  const approvedByArea = Object.fromEntries((qc.results || []).map(r => [r.area, r.n]));
  const testReady = Object.entries(BLUEPRINT).every(([a, n]) => (approvedByArea[a] || 0) >= n);
  const { results: staff } = await env.DB.prepare('SELECT id, name, role, skills, reg_no, master_course_on, master_course_by FROM ems_staff WHERE active=1 ORDER BY name').all();
  const people = [];
  for (const p of staff || []) {
    const sk = parse(p.skills, []), on = [];
    if (sk.includes('coach') || sk.includes('doctor')) for (const m of machines) if ((await masterQual(env, p.id, m.id)).ok) on.push(m.id);
    people.push({ id: p.id, name: p.name, role: p.role, skills: sk, reg_no: p.reg_no, master_course_on: p.master_course_on, master_course_by: p.master_course_by, master_on: on });
  }
  return {
    people, rules: RULES, blueprint: BLUEPRINT, areas: AREAS, checklist: CHECKLIST.map(([k, t, crit]) => ({ k, t, crit })),
    me: { id: me.id, name: me.name, role: me.role, skills: s ? s.skills : [], master_course_on: s && s.master_course_on, medical_lead: isMedLead(s), can_verify: canVerify(me, s), master_on: masterOn },
    curricula: (cur.results || []).map(c => ({ ...c, modules: parse(c.modules, []) })), machines, test_ready: testReady, approved_by_area: approvedByArea,
  };
}

/* ---------------- curriculum & materials ---------------- */
export async function approveCurriculum(env, me, id) {
  const s = await staffRow(env, me.id);
  if (!isMedLead(s)) return R(403, 'Only the medical lead can approve the curriculum. Sign in with an account that has the Medical lead skill.');
  const c = await env.DB.prepare("SELECT * FROM ems_curriculum WHERE id=? AND status='draft'").bind(id).first();
  if (!c) return R(400, 'Only a draft curriculum can be approved.');
  await env.DB.prepare("UPDATE ems_curriculum SET status='retired' WHERE status='approved'").run();
  await env.DB.prepare("UPDATE ems_curriculum SET status='approved', approved_by=?, approver_name=?, approved_at=? WHERE id=?").bind(me.id, s.name + (s.reg_no ? ` (Reg. ${s.reg_no})` : ''), nowIso(), id).run();
  return R(200);
}
export async function newVersion(env, me, b) {
  const s = await staffRow(env, me.id);
  if (!(me.role === 'admin' || isMedLead(s))) return R(403, 'Only an admin or the medical lead can start a new curriculum version.');
  const ver = clean(b.version, 10);
  if (!/^\d+\.\d+$/.test(ver)) return R(400, 'Enter a version like 1.1.');
  if (await env.DB.prepare("SELECT 1 FROM ems_curriculum WHERE status='draft'").first()) return R(400, 'There is already a draft version. Approve or edit it first.');
  const base = await env.DB.prepare('SELECT * FROM ems_curriculum ORDER BY id DESC LIMIT 1').first();
  const mods = Array.isArray(b.modules) ? b.modules : parse(base && base.modules, MODULES_V1);
  const clean_mods = mods.map((m, i) => ({ no: i + 1, title: clean(m.title, 80), content: clean(m.content, 600), hours: clean(m.hours, 20), assessed: clean(m.assessed, 40) })).filter(m => m.title);
  await env.DB.prepare("INSERT INTO ems_curriculum (version, modules, status, notes) VALUES (?,?,'draft',?)").bind(ver, JSON.stringify(clean_mods), nz(clean(b.notes, 300))).run();
  return R(200);
}
export async function listMaterials(env) {
  const { results } = await env.DB.prepare('SELECT * FROM ems_materials ORDER BY curriculum_id DESC, module_no, id').all();
  return results || [];
}
export async function addMaterial(env, me, b) {
  const s = await staffRow(env, me.id);
  if (!(me.role === 'admin' || isMedLead(s))) return R(403, 'Only an admin or the medical lead can add training materials.');
  const title = clean(b.title, 120), mod = parseInt(b.module_no, 10), cur = parseInt(b.curriculum_id, 10);
  if (!title || !mod || !cur) return R(400, 'Enter a title and choose the module.');
  const url = clean(b.url, 400), key = clean(b.file_key, 200);
  if (!url && !key) return R(400, 'Add a link or upload a file.');
  if (url && !/^https?:\/\//.test(url)) return R(400, 'Links must start with https://');
  await env.DB.prepare('INSERT INTO ems_materials (curriculum_id, module_no, title, kind, url, file_key, file_name, source, added_by) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(cur, mod, title, key ? 'file' : 'link', nz(url), nz(key), nz(clean(b.file_name, 160)), nz(clean(b.source, 80)), me.id).run();
  return R(200);
}

/* ---------------- question bank ---------------- */
export async function listQuestions(env) {
  await ensureSeed(env);
  const { results } = await env.DB.prepare('SELECT * FROM ems_questions ORDER BY area, id').all();
  return (results || []).map(q => ({ ...q, options: parse(q.options, []) }));
}
export async function saveQuestion(env, me, id, b) {
  const s = await staffRow(env, me.id);
  if (!(me.role === 'admin' || isMedLead(s))) return R(403, 'Only an admin or the medical lead can edit questions.');
  const area = AREAS[b.area] ? b.area : null, question = clean(b.question, 300);
  const opts = (Array.isArray(b.options) ? b.options : []).map(o => clean(o, 200)).filter(Boolean);
  const answer = parseInt(b.answer, 10);
  if (!area || question.length < 10 || opts.length < 3 || !(answer >= 0 && answer < opts.length)) return R(400, 'Enter the area, the question, at least three options and the correct answer.');
  // Any edit returns the question to draft so the medical lead re-approves it.
  if (id) await env.DB.prepare("UPDATE ems_questions SET area=?, question=?, options=?, answer=?, explanation=?, status='draft', approved_by=NULL, approver_name=NULL, approved_at=NULL WHERE id=?").bind(area, question, JSON.stringify(opts), answer, nz(clean(b.explanation, 300)), id).run();
  else await env.DB.prepare('INSERT INTO ems_questions (area, question, options, answer, explanation) VALUES (?,?,?,?,?)').bind(area, question, JSON.stringify(opts), answer, nz(clean(b.explanation, 300))).run();
  return R(200);
}
export async function approveQuestions(env, me, ids, status = 'approved') {
  const s = await staffRow(env, me.id);
  if (!isMedLead(s)) return R(403, 'Only the medical lead can approve or retire questions.');
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter(Boolean);
  if (!list.length) return R(400, 'Choose questions.');
  const st = status === 'retired' ? 'retired' : 'approved';
  await env.DB.prepare(`UPDATE ems_questions SET status=?, approved_by=?, approver_name=?, approved_at=? WHERE id IN (${list.join(',')})`).bind(st, me.id, s.name, nowIso()).run();
  return R(200, null, { count: list.length });
}

/* ---------------- external qualifications ---------------- */
export async function listQuals(env) {
  const { results } = await env.DB.prepare('SELECT q.*, s.name staff_name FROM ems_external_quals q JOIN ems_staff s ON s.id=q.staff_id ORDER BY q.status, q.expires_on DESC').all();
  return (results || []).map(q => ({ ...q, machine_types: parse(q.machine_types, []) }));
}
export async function submitQual(env, me, b) {
  const staffId = parseInt(b.staff_id, 10) || me.id;
  if (staffId !== me.id && me.role !== 'admin') return R(403, 'You can only submit your own qualifications.');
  const s = await staffRow(env, staffId);
  if (!s || !(s.skills.includes('coach') || s.skills.includes('doctor'))) return R(400, 'Master Trainers must have the Wellness coach or Doctor skill.');
  const f = { issuer: clean(b.issuer, 120), certificate_no: clean(b.certificate_no, 80), holder_name: clean(b.holder_name, 120), issued_on: b.issued_on, expires_on: b.expires_on };
  if (!f.issuer || !f.certificate_no || !f.holder_name || !isDate(f.issued_on) || !isDate(f.expires_on) || f.expires_on <= f.issued_on) return R(400, 'Enter the issuer, certificate number, holder name as printed, and valid dates.');
  if (f.expires_on < today()) return R(400, 'This certificate has already expired.');
  const mts = (Array.isArray(b.machine_types) ? b.machine_types : []).map(Number).filter(Boolean);
  if (!mts.length) return R(400, 'Choose the machines this qualification covers.');
  if (!b.file_key) return R(400, 'Upload a copy of the certificate.');
  const link = clean(b.verify_link, 300);
  await env.DB.prepare('INSERT INTO ems_external_quals (staff_id, issuer, certificate_no, holder_name, issued_on, expires_on, machine_types, verify_link, file_key, file_name, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .bind(staffId, f.issuer, f.certificate_no, f.holder_name, f.issued_on, f.expires_on, JSON.stringify(mts), nz(link), clean(b.file_key, 200), nz(clean(b.file_name, 160)), me.id).run();
  return R(200);
}
export async function verifyQual(env, me, id, b, decision) {
  const s = await staffRow(env, me.id);
  if (!canVerify(me, s)) return R(403, 'Only a head-office admin or the medical lead can check external qualifications.');
  const q = await env.DB.prepare('SELECT * FROM ems_external_quals WHERE id=?').bind(id).first();
  if (!q) return R(404, 'Not found.');
  if (q.staff_id === me.id || q.created_by === me.id) return R(403, 'You cannot check a qualification you hold or submitted. Ask someone else.');
  if (q.status !== 'pending') return R(400, 'This qualification has already been decided.');
  const who = me.id === 0 ? 'Clinic admin' : me.name;
  if (decision === 'reject') {
    const reason = clean(b.reason, 300);
    if (reason.length < 5) return R(400, 'Give the reason for rejecting it.');
    await env.DB.prepare("UPDATE ems_external_quals SET status='rejected', reject_reason=?, verified_by=?, verifier_name=?, verified_at=? WHERE id=?").bind(reason, me.id, who, nowIso(), id).run();
    return R(200);
  }
  const method = ['online', 'email', 'phone'].includes(b.method) ? b.method : null, contact = clean(b.contact, 160), ref = clean(b.ref, 160);
  if (!method || contact.length < 3) return R(400, 'Record how you confirmed it with the issuer and who you contacted.');
  if (b.confirm !== true) return R(400, 'Confirm that the issuer confirmed the name, number and dates.');
  await env.DB.prepare("UPDATE ems_external_quals SET status='verified', verified_by=?, verifier_name=?, verified_at=?, verify_method=?, verify_contact=?, verify_ref=? WHERE id=?").bind(me.id, who, nowIso(), method, contact, nz(ref), id).run();
  return R(200);
}
export async function recordMasterCourse(env, me, staffId, b) {
  const s = await staffRow(env, me.id);
  if (!(me.role === 'admin' || isMedLead(s))) return R(403, 'Only an admin or the medical lead can record the Master Trainer course.');
  if (staffId === me.id) return R(403, 'You cannot record your own Master Trainer course.');
  const d = isDate(b.day) && b.day <= today() ? b.day : null;
  if (!d) return R(400, 'Choose the date the course was completed.');
  await env.DB.prepare('UPDATE ems_staff SET master_course_on=?, master_course_by=? WHERE id=?').bind(d, me.id === 0 ? 'Clinic admin' : me.name, staffId).run();
  return R(200);
}

/* ---------------- training records ---------------- */
async function recordState(env, r) {
  const q = (sql, ...b) => env.DB.prepare(sql).bind(...b).all().then(x => x.results || []);
  const [attempts, logs, practicals] = await Promise.all([
    q('SELECT id, score, passed, started_at, submitted_at FROM ems_test_attempts WHERE record_id=? ORDER BY id', r.id),
    q('SELECT * FROM ems_supervised_logs WHERE record_id=? ORDER BY session_date, id', r.id),
    q('SELECT * FROM ems_practicals WHERE record_id=? ORDER BY id', r.id),
  ]);
  const submitted = attempts.filter(a => a.submitted_at);
  const passedTest = submitted.find(a => a.passed);
  const lastPractical = practicals[practicals.length - 1];
  const activity = (await env.DB.prepare(`SELECT COUNT(*) n FROM ems_appointments a JOIN ems_devices d ON d.id=a.device_id WHERE a.trainer_id=? AND d.machine_type_id=? AND a.status='attended' AND substr(a.start_at,1,10) >= date('now','-365 days')`).bind(r.staff_id, r.machine_type_id).first()).n;
  const renewalOk = r.kind === 'renewal' && activity >= RULES.renewal_activity;
  const needLogs = renewalOk ? 1 : RULES.supervised, needFirst = renewalOk ? 0 : RULES.first_sessions;
  const firsts = logs.filter(l => l.first_session).length;
  const req = {
    test: { done: !!passedTest, score: passedTest ? passedTest.score : (submitted.length ? submitted[submitted.length - 1].score : null), attempts: submitted.length, left: Math.max(0, RULES.max_attempts - submitted.length) },
    logs: { done: logs.length >= needLogs && firsts >= needFirst, count: logs.length, need: needLogs, first: firsts, need_first: needFirst },
    practical: { done: !!(lastPractical && lastPractical.passed), last: lastPractical ? { passed: !!lastPractical.passed, by: lastPractical.assessor_name, at: lastPractical.assessed_at, items: parse(lastPractical.items, {}), notes: lastPractical.notes } : null },
    renewal: r.kind === 'renewal' ? { activity, reduced: renewalOk } : null,
  };
  req.ready = req.test.done && req.logs.done && req.practical.done;
  return { ...r, attempts, logs, practicals: practicals.map(p => ({ ...p, items: parse(p.items, {}) })), req };
}
export async function listRecords(env, me, all) {
  const { results } = await env.DB.prepare(`SELECT r.*, s.name trainee_name, m.name machine_name, c.version curriculum_version FROM ems_training_records r
    JOIN ems_staff s ON s.id=r.staff_id JOIN ems_machine_types m ON m.id=r.machine_type_id JOIN ems_curriculum c ON c.id=r.curriculum_id
    ${all ? '' : 'WHERE r.staff_id=?'} ORDER BY r.status, r.id DESC`).bind(...(all ? [] : [me.id])).all();
  const out = [];
  for (const r of results || []) out.push(await recordState(env, r));
  return out;
}
export async function openRecord(env, me, b) {
  const staffId = parseInt(b.staff_id, 10), mt = parseInt(b.machine_type_id, 10);
  const mq = await masterQual(env, me.id, mt);
  if (!mq.ok) return R(403, 'Only a Master Trainer qualified for this machine can open training. ' + mq.reason);
  if (staffId === me.id) return R(400, 'You cannot open training for yourself.');
  const t = await staffRow(env, staffId);
  if (!t || !t.active || !t.skills.includes('trainer')) return R(400, 'The trainee must be an active team member with the EMS trainer skill.');
  const cur = await approvedCurriculum(env);
  if (!cur) return R(400, 'No approved curriculum yet. The medical lead must approve the curriculum first.');
  if (await env.DB.prepare("SELECT 1 FROM ems_training_records WHERE staff_id=? AND machine_type_id=? AND status IN ('in_training','retraining')").bind(staffId, mt).first()) return R(400, 'This trainee already has open training for this machine.');
  const kind = b.kind === 'renewal' ? 'renewal' : 'initial';
  if (kind === 'renewal' && !(await env.DB.prepare("SELECT 1 FROM ems_certifications WHERE staff_id=? AND machine_type_id=? AND code IS NOT NULL").bind(staffId, mt).first())) return R(400, 'Renewal needs a previous Academy certificate for this machine. Open initial training instead.');
  const r = await env.DB.prepare('INSERT INTO ems_training_records (staff_id, machine_type_id, curriculum_id, kind, opened_by) VALUES (?,?,?,?,?)').bind(staffId, mt, cur.id, kind, me.id).run();
  return R(200, null, { id: r.meta.last_row_id });
}

// Theory test: 40 questions drawn by blueprint from approved questions.
export async function startTest(env, me, recordId) {
  const r = await env.DB.prepare('SELECT * FROM ems_training_records WHERE id=?').bind(recordId).first();
  if (!r || r.staff_id !== me.id) return R(403, 'You can only take your own test.');
  if (r.status !== 'in_training') return R(400, r.status === 'retraining' ? 'You have used all three attempts. Your Master Trainer must arrange retraining before another attempt.' : 'This training record is closed.');
  const st = await recordState(env, r);
  if (st.req.test.done) return R(400, 'You have already passed the theory test.');
  if (st.req.test.left <= 0) return R(400, 'No attempts left.');
  const open = st.attempts.find(a => !a.submitted_at);
  let ids;
  if (open) ids = parse((await env.DB.prepare('SELECT question_ids FROM ems_test_attempts WHERE id=?').bind(open.id).first()).question_ids, []);
  else {
    ids = [];
    for (const [area, n] of Object.entries(BLUEPRINT)) {
      const { results } = await env.DB.prepare("SELECT id FROM ems_questions WHERE status='approved' AND area=? ORDER BY random() LIMIT ?").bind(area, n).all();
      if ((results || []).length < n) return R(400, 'The question bank is not ready. The medical lead must approve enough questions in every area.');
      ids.push(...results.map(x => x.id));
    }
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  }
  const attemptId = open ? open.id : (await env.DB.prepare('INSERT INTO ems_test_attempts (record_id, question_ids) VALUES (?,?)').bind(recordId, JSON.stringify(ids)).run()).meta.last_row_id;
  const { results } = await env.DB.prepare(`SELECT id, area, question, options FROM ems_questions WHERE id IN (${ids.join(',')})`).all();
  const byId = Object.fromEntries((results || []).map(q => { const o = parse(q.options, []), pm = perm(attemptId * 7919 + q.id, o.length); return [q.id, { id: q.id, area: q.area, question: q.question, options: pm.map(i => o[i]) }]; }));
  return R(200, null, { attempt_id: attemptId, questions: ids.map(i => byId[i]).filter(Boolean), pass_mark: RULES.pass_mark });
}
export async function submitTest(env, me, attemptId, b) {
  const a = await env.DB.prepare('SELECT t.*, r.staff_id FROM ems_test_attempts t JOIN ems_training_records r ON r.id=t.record_id WHERE t.id=?').bind(attemptId).first();
  if (!a || a.staff_id !== me.id) return R(403, 'Not your test.');
  if (a.submitted_at) return R(400, 'This attempt was already submitted.');
  const ids = parse(a.question_ids, []);
  const answers = b.answers && typeof b.answers === 'object' ? b.answers : {};
  if (ids.some(i => answers[i] === undefined || answers[i] === null || answers[i] === '')) return R(400, 'Answer every question before submitting.');
  const { results } = await env.DB.prepare(`SELECT id, answer, options FROM ems_questions WHERE id IN (${ids.join(',')})`).all();
  const correct = (results || []).filter(q => { const pm = perm(attemptId * 7919 + q.id, parse(q.options, []).length); return pm[parseInt(answers[q.id], 10)] === q.answer; }).length;
  const score = Math.round(correct / ids.length * 100), passed = score >= RULES.pass_mark ? 1 : 0;
  await env.DB.prepare('UPDATE ems_test_attempts SET answers=?, score=?, passed=?, submitted_at=? WHERE id=?').bind(JSON.stringify(answers), score, passed, nowIso(), attemptId).run();
  if (!passed) {
    const n = (await env.DB.prepare('SELECT COUNT(*) n FROM ems_test_attempts WHERE record_id=? AND submitted_at IS NOT NULL').bind(a.record_id).first()).n;
    if (n >= RULES.max_attempts) await env.DB.prepare("UPDATE ems_training_records SET status='retraining' WHERE id=?").bind(a.record_id).run();
  }
  return R(200, null, { score, passed: !!passed, correct, total: ids.length });
}
export async function resetRetraining(env, me, recordId, b) {
  const r = await env.DB.prepare('SELECT * FROM ems_training_records WHERE id=?').bind(recordId).first();
  if (!r || r.status !== 'retraining') return R(400, 'This record is not waiting for retraining.');
  const mq = await masterQual(env, me.id, r.machine_type_id);
  if (!mq.ok) return R(403, mq.reason);
  if (clean(b.notes, 300).length < 10) return R(400, 'Describe the retraining given.');
  // A fresh record keeps the history: close this one and open a new one on the same curriculum.
  await env.DB.prepare("UPDATE ems_training_records SET status='closed' WHERE id=?").bind(recordId).run();
  await env.DB.prepare('INSERT INTO ems_training_records (staff_id, machine_type_id, curriculum_id, kind, opened_by) VALUES (?,?,?,?,?)').bind(r.staff_id, r.machine_type_id, r.curriculum_id, r.kind, me.id).run();
  return R(200);
}

export async function addLog(env, me, recordId, b) {
  const r = await env.DB.prepare('SELECT * FROM ems_training_records WHERE id=?').bind(recordId).first();
  if (!r || !['in_training', 'retraining'].includes(r.status)) return R(400, 'This training record is not open.');
  if (r.staff_id === me.id) return R(403, 'Trainees cannot log their own supervised sessions.');
  const mq = await masterQual(env, me.id, r.machine_type_id);
  if (!mq.ok) return R(403, 'Only a Master Trainer qualified for this machine can sign supervised sessions. ' + mq.reason);
  const d = isDate(b.session_date) && b.session_date <= today() ? b.session_date : null;
  if (!d) return R(400, 'Choose the session date.');
  const appt = parseInt(b.appointment_id, 10) || null;
  if (appt) {
    const a = await env.DB.prepare("SELECT a.trainer_id, d.machine_type_id FROM ems_appointments a LEFT JOIN ems_devices d ON d.id=a.device_id WHERE a.id=? AND a.status='attended'").bind(appt).first();
    if (!a) return R(400, 'That booking was not found or not attended.');
    if (a.machine_type_id && a.machine_type_id !== r.machine_type_id) return R(400, 'That booking used a different machine.');
  }
  await env.DB.prepare('INSERT INTO ems_supervised_logs (record_id, session_date, first_session, appointment_id, notes, supervisor_id, supervisor_name) VALUES (?,?,?,?,?,?,?)')
    .bind(recordId, d, b.first_session ? 1 : 0, appt, nz(clean(b.notes, 300)), me.id, mq.staff.name).run();
  return R(200);
}
export async function addPractical(env, me, recordId, b) {
  const r = await env.DB.prepare('SELECT * FROM ems_training_records WHERE id=?').bind(recordId).first();
  if (!r || r.status !== 'in_training') return R(400, 'This training record is not open.');
  if (r.staff_id === me.id) return R(403, 'You cannot assess yourself.');
  const mq = await masterQual(env, me.id, r.machine_type_id);
  if (!mq.ok) return R(403, 'Only a Master Trainer qualified for this machine can assess. ' + mq.reason);
  const items = {};
  for (const [k] of CHECKLIST) items[k] = b.items && b.items[k] === true;
  const passed = Object.values(items).every(Boolean) ? 1 : 0;
  await env.DB.prepare('INSERT INTO ems_practicals (record_id, items, passed, notes, assessor_id, assessor_name) VALUES (?,?,?,?,?,?)').bind(recordId, JSON.stringify(items), passed, nz(clean(b.notes, 500)), me.id, mq.staff.name).run();
  const failedCrit = CHECKLIST.filter(([k, , crit]) => crit && !items[k]).map(([, t]) => t);
  return R(200, null, { passed: !!passed, failed_critical: failedCrit });
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => 'HEA-' + new Date().getUTCFullYear() + '-' + [...crypto.getRandomValues(new Uint8Array(8))].map(b => CODE_CHARS[b % CODE_CHARS.length]).join('');

export async function certifyRecord(env, me, recordId) {
  const r = await env.DB.prepare('SELECT * FROM ems_training_records WHERE id=?').bind(recordId).first();
  if (!r || r.status !== 'in_training') return R(400, 'This training record is not open.');
  if (r.staff_id === me.id) return R(403, 'You cannot certify yourself.');
  const mq = await masterQual(env, me.id, r.machine_type_id);
  if (!mq.ok) return R(403, 'Only a Master Trainer qualified for this machine can certify. ' + mq.reason);
  const st = await recordState(env, r);
  const missing = [];
  if (!st.req.test.done) missing.push(`theory test passed at ${RULES.pass_mark}% or more`);
  if (!st.req.logs.done) missing.push(`${st.req.logs.need} supervised sessions${st.req.logs.need_first ? ` including ${st.req.logs.need_first} first sessions` : ''} (have ${st.req.logs.count}, ${st.req.logs.first} first)`);
  if (!st.req.practical.done) missing.push('practical assessment with every checklist item passed');
  if (missing.length) return R(400, 'Not ready to certify. Still needed: ' + missing.join('; ') + '.');
  const cur = await env.DB.prepare('SELECT version FROM ems_curriculum WHERE id=?').bind(r.curriculum_id).first();
  // Countersignature: a unit manager certifying someone at their own unit needs a second Master Trainer.
  let needsCounter = false;
  if (mq.staff.role === 'manager') needsCounter = !!(await env.DB.prepare('SELECT 1 FROM ems_staff_units a JOIN ems_staff_units b ON a.unit_id=b.unit_id WHERE a.staff_id=? AND b.staff_id=?').bind(me.id, r.staff_id).first());
  const issued = today(), until = addMonths(issued, RULES.cert_months);
  await env.DB.prepare("UPDATE ems_certifications SET status='revoked', revoked_at=?, revoked_reason='Replaced by a new certificate' WHERE staff_id=? AND machine_type_id=? AND status IN ('active','pending')").bind(issued, r.staff_id, r.machine_type_id).run();
  const code = newCode();
  const role = mq.staff.skills.includes('doctor') ? 'Doctor' : 'Wellness coach';
  await env.DB.prepare(`INSERT INTO ems_certifications (staff_id, machine_type_id, certified_by, certifier_name, certifier_role, issued_on, valid_until, notes, status, code, record_id, curriculum_version, theory_score, sessions_logged, practical_on, qual_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(r.staff_id, r.machine_type_id, me.id, mq.staff.name + (role === 'Doctor' && mq.staff.reg_no ? ` (Reg. ${mq.staff.reg_no})` : ''), role, issued, until,
    `Hasta EMS Academy ${r.kind === 'renewal' ? 'renewal' : 'certification'} under curriculum v${cur.version}`, needsCounter ? 'pending' : 'active', code, r.id, cur.version, st.req.test.score, st.req.logs.count, st.req.practical.last.at.slice(0, 10), mq.qual.id).run();
  await env.DB.prepare("UPDATE ems_training_records SET status='certified' WHERE id=?").bind(recordId).run();
  return R(200, null, { code, pending: needsCounter });
}
export async function countersign(env, me, certId) {
  const c = await env.DB.prepare("SELECT * FROM ems_certifications WHERE id=? AND status='pending'").bind(certId).first();
  if (!c) return R(400, 'Nothing waiting for a countersignature.');
  if (c.certified_by === me.id || c.staff_id === me.id) return R(403, 'A different Master Trainer must countersign.');
  const mq = await masterQual(env, me.id, c.machine_type_id);
  if (!mq.ok) return R(403, mq.reason);
  await env.DB.prepare("UPDATE ems_certifications SET status='active', countersigned_by=?, countersigner_name=?, countersigned_at=? WHERE id=?").bind(me.id, mq.staff.name, nowIso(), certId).run();
  return R(200);
}

/* ---------------- certificate PDF & public verification ---------------- */
export async function certDetail(env, where, bind) {
  return env.DB.prepare(`SELECT c.*, s.name trainer_name, m.name machine_name, m.category machine_category, q.issuer qual_issuer, q.certificate_no qual_no
    FROM ems_certifications c JOIN ems_staff s ON s.id=c.staff_id JOIN ems_machine_types m ON m.id=c.machine_type_id LEFT JOIN ems_external_quals q ON q.id=c.qual_id WHERE ${where}`).bind(bind).first();
}
const statusOf = c => c.status === 'revoked' ? 'Revoked' : c.status === 'pending' ? 'Awaiting countersignature' : c.valid_until < today() ? 'Expired' : 'Valid';
const longDay = d => new Date(d.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const siteOrigin = url => url.hostname.startsWith('ems.') ? url.origin.replace('//ems.', '//') : url.origin;
const WIN = /[^\x20-\x7E\xA0-\xFF–—‘’“”•…]/g;
const safe = s => String(s == null ? '' : s).replace(WIN, '?');

export async function certificatePdf(env, request, c) {
  const url = new URL(request.url);
  const link = `${siteOrigin(url)}/verify/${c.code}`;
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Hasta Certified EMS Trainer — ${safe(c.trainer_name)}`);
  const page = pdf.addPage([841.89, 595.28]);
  const W = 841.89, H = 595.28;
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const teal = rgb(0.204, 0.349, 0.369), deep = rgb(0.133, 0.251, 0.247), gold = rgb(0.77, 0.64, 0.36), muted = rgb(0.37, 0.43, 0.42), ink = rgb(0.12, 0.19, 0.2);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 18, y: 18, width: W - 36, height: H - 36, borderColor: gold, borderWidth: 1.2 });
  page.drawRectangle({ x: 24, y: 24, width: W - 48, height: H - 48, borderColor: teal, borderWidth: 0.4 });
  page.drawRectangle({ x: 24, y: H - 24 - 8, width: W - 48, height: 8, color: deep });
  try {
    const res = await env.ASSETS.fetch(new Request(new URL('/img/hasta-wellness-logo.jpg', request.url)));
    if (res.ok) { const img = await pdf.embedJpg(new Uint8Array(await res.arrayBuffer())); const s = 46 / img.height; page.drawImage(img, { x: 60, y: H - 100, width: img.width * s, height: 46 }); }
  } catch { /* logo optional */ }
  const right = (t, y, size, font, color) => page.drawText(safe(t), { x: W - 60 - font.widthOfTextAtSize(safe(t), size), y, size, font, color });
  right('Hasta EMS Academy', H - 66, 12, bold, teal);
  right('A venture of HASWEL CARE Private Limited', H - 82, 9, reg, muted);
  const centre = (t, y, size, font, color) => page.drawText(safe(t), { x: (W - font.widthOfTextAtSize(safe(t), size)) / 2, y, size, font, color });
  centre('This certifies that', H - 160, 12, reg, muted);
  centre(c.trainer_name, H - 200, 30, bold, ink);
  centre('is a Hasta Certified EMS Trainer for', H - 232, 12, reg, muted);
  centre(`${c.machine_name} (${c.machine_category})`, H - 262, 18, bold, teal);
  centre(`Valid from ${longDay(c.issued_on)} to ${longDay(c.valid_until)}`, H - 290, 11, reg, ink);
  const rows = [
    ['Certificate ID', c.code], ['Curriculum', `Hasta EMS Trainer Programme v${c.curriculum_version}`],
    ['Theory test', `${c.theory_score}%`], ['Supervised sessions', String(c.sessions_logged)], ['Practical assessment', longDay(c.practical_on)],
  ];
  let y = 210;
  for (const [k, v] of rows) { page.drawText(safe(k), { x: 70, y, size: 9.5, font: bold, color: muted }); page.drawText(safe(v), { x: 200, y, size: 9.5, font: reg, color: ink }); y -= 16; }
  // Certifier
  page.drawLine({ start: { x: 430, y: 150 }, end: { x: 640, y: 150 }, thickness: 0.6, color: muted });
  page.drawText(safe(c.certifier_name), { x: 430, y: 136, size: 10.5, font: bold, color: ink });
  page.drawText(safe(`Hasta Master Trainer, ${c.certifier_role}`), { x: 430, y: 122, size: 8.5, font: reg, color: muted });
  if (c.qual_issuer) page.drawText(safe(`Qualified by ${c.qual_issuer} (cert. ${c.qual_no})`), { x: 430, y: 109, size: 8.5, font: reg, color: muted });
  if (c.countersigner_name) page.drawText(safe(`Countersigned by ${c.countersigner_name}`), { x: 430, y: 96, size: 8.5, font: reg, color: muted });
  // QR
  const qr = qrcode(0, 'M'); qr.addData(link); qr.make();
  const n = qr.getModuleCount(), size = 96, cell = size / n, qx = W - 60 - size, qy = 70;
  for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (qr.isDark(r, col)) page.drawRectangle({ x: qx + col * cell, y: qy + (n - 1 - r) * cell, width: cell + 0.2, height: cell + 0.2, color: ink });
  page.drawText('Scan to verify', { x: qx + 18, y: qy - 13, size: 8, font: reg, color: muted });
  page.drawText(safe(`Verify at ${link.replace(/^https?:\/\//, '')}`), { x: 70, y: 70, size: 8.5, font: reg, color: muted });
  page.drawText('This certificate is valid only if the verification page shows it as valid. Machine-specific; not transferable.', { x: 70, y: 56, size: 8, font: reg, color: muted });
  return pdf.save();
}

export async function verifyPage(env, url) {
  const code = decodeURIComponent(url.pathname.replace(/^\/verify\/?/, '')).trim().toUpperCase() || (url.searchParams.get('code') || '').trim().toUpperCase();
  let c = null;
  if (/^HEA-\d{4}-[A-Z0-9]{8}$/.test(code)) c = await certDetail(env, 'c.code=?', code);
  const st = c ? statusOf(c) : null;
  const colour = st === 'Valid' ? '#2f7d58' : '#a33b2c';
  const body = !code ? '' : c ? `<div class="res"><div class="st" style="background:${colour}">${h(st)}</div>
      <dl><dt>Certificate ID</dt><dd>${h(c.code)}</dd><dt>Trainer</dt><dd><b>${h(c.trainer_name)}</b></dd><dt>Certified for</dt><dd>${h(c.machine_name)} (${h(c.machine_category)})</dd>
      <dt>Valid</dt><dd>${h(longDay(c.issued_on))} to ${h(longDay(c.valid_until))}</dd><dt>Certified by</dt><dd>${h(c.certifier_name)}, Hasta Master Trainer (${h(c.certifier_role)})${c.qual_issuer ? `<br><span>qualified by ${h(c.qual_issuer)}</span>` : ''}</dd>
      ${c.countersigner_name ? `<dt>Countersigned by</dt><dd>${h(c.countersigner_name)}</dd>` : ''}<dt>Curriculum</dt><dd>Hasta EMS Trainer Programme v${h(c.curriculum_version)}</dd></dl>
      ${st !== 'Valid' ? '<p class="warn">This trainer must not deliver EMS sessions on this machine under this certificate.</p>' : ''}</div>`
    : `<div class="res"><div class="st" style="background:#a33b2c">Not found</div><p>No Hasta certificate has this ID. Check it was typed exactly as printed. If you were shown a certificate with this ID, please tell us on +91 97784 58883.</p></div>`;
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Verify a Hasta EMS trainer certificate</title><link rel="icon" href="/favicon.ico">
<style>@font-face{font-family:Manrope;src:url(/fonts/manrope-var.woff2) format('woff2');font-weight:200 800}@font-face{font-family:'DM Sans';src:url(/fonts/dm-sans-var.woff2) format('woff2');font-weight:100 1000}
body{margin:0;font:15px/1.55 'DM Sans',system-ui,sans-serif;color:#1f3134;background:#eef2f1}main{max-width:620px;margin:0 auto;padding:28px 18px 60px}
header{display:flex;align-items:center;gap:12px;margin-bottom:22px}header img{height:40px}h1{font-family:Manrope;font-size:24px;margin:0 0 6px;color:#1d3437}
p.lede{color:#5e6d6c;margin:0 0 18px}form{display:flex;gap:8px}input{flex:1;height:46px;border:1px solid #d9e1df;border-radius:10px;padding:0 12px;font:inherit;text-transform:uppercase;letter-spacing:.04em}
button{height:46px;padding:0 18px;border:0;border-radius:10px;background:#34595e;color:#fff;font:inherit;font-weight:600;cursor:pointer}
.res{background:#fff;border:1px solid #e8eeec;border-radius:16px;padding:20px;margin-top:20px}.st{display:inline-block;color:#fff;font-weight:700;padding:5px 12px;border-radius:999px;margin-bottom:12px}
dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;margin:0}dt{color:#5e6d6c}dd{margin:0}dd span{color:#5e6d6c;font-size:13px}.warn{color:#a33b2c;font-weight:600;margin:14px 0 0}
footer{margin-top:26px;font-size:13px;color:#5e6d6c}</style></head><body><main>
<header><img src="/img/hasta-wellness-logo.webp" alt="Hasta Wellness"></header>
<h1>Verify a trainer certificate</h1><p class="lede">Every Hasta EMS trainer is certified for each machine they use. Enter the certificate ID printed on the certificate, or scan its QR code.</p>
<form action="/verify" method="get"><input name="code" value="${h(code)}" placeholder="HEA-2026-XXXXXXXX" aria-label="Certificate ID" autocomplete="off"><button>Check</button></form>
${body}<footer>Hasta EMS Academy · HASWEL CARE Private Limited · Kazhakkoottam, Thiruvananthapuram</footer></main></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' } });
}
