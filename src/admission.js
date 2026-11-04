// Programme admission: the gate in front of every EMS / weight-management enrolment.
//
//   1. Health screening      — every question answered yes/no (client in the app, or staff in clinic)
//   2. Clinician assessment  — wellness coach or doctor records vitals, decision and precautions,
//                              and signs the recommendation letter
//   3. Client consent        — client reads both letters, types their name and signs
//                              (in the app, or on the clinic device)
//   4. Admitted              — valid for 12 months for the programmes covered
//
// Packages cannot be assigned and EMS sessions cannot be booked unless the client
// holds a valid admission covering that programme. Signed letters are stored as
// text snapshots with their signatures and can be downloaded as a PDF.

import { PDFDocument, StandardFonts, rgb } from './vendor/pdf-lib.esm.min.js';
import { clean, nz, h, sha256 } from './util.js';

export const CONSENT_VERSION = 'HW-EMS-CONSENT-v1 (Nov 2026)';
const VALID_DAYS = 365;
const OPEN = ['screening', 'assessment', 'client_consent'];
export const PROGRAMMES = { ems: 'EMS body-conditioning programme', weight: 'Weight-management programme' };
export const SCREEN_QS = [
  ['pacemaker', 'Do you have a pacemaker, defibrillator or any implanted electronic device?'],
  ['pregnancy', 'Are you pregnant, could you be pregnant, or have you given birth in the last 6 months?'],
  ['epilepsy', 'Do you have epilepsy or have you ever had a seizure?'],
  ['heart', 'Do you have a heart condition, irregular heartbeat or circulation problem?'],
  ['bp', 'Do you have high or low blood pressure?'],
  ['diabetes', 'Do you have diabetes?'],
  ['surgery', 'Have you had surgery or a serious injury in the last 6 months?'],
  ['implants', 'Do you have metal implants, pins or plates?'],
  ['cancer', 'Do you have cancer, or are you having cancer treatment?'],
  ['thrombosis', 'Have you had a blood clot (thrombosis) or bleeding disorder?'],
  ['kidney', 'Do you have kidney or liver disease?'],
  ['skin', 'Do you have wounds, rashes or skin conditions where pads would be placed?'],
  ['fever', 'Are you currently unwell, with a fever or infection?'],
];
const ROLES = ['Wellness coach', 'Doctor', 'Physiotherapist', 'Dietitian', 'Nurse'];
const DECISIONS = { suitable: 'Suitable', conditions: 'Suitable with precautions', not_suitable: 'Not suitable at this time' };

/* ---------------- helpers ---------------- */
const nowIso = () => new Date().toISOString().slice(0, 19) + 'Z';
const istStamp = iso => new Date(new Date(iso).getTime() + 330 * 60000).toISOString().slice(0, 16).replace('T', ' ') + ' IST';
const istDay = iso => new Date(new Date(iso).getTime() + 330 * 60000).toISOString().slice(0, 10);
const addDaysIso = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const longDay = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const progList = p => p.map(k => PROGRAMMES[k]).join(' and ');
const parse = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const sigOk = s => typeof s === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s) && s.length > 800 && s.length < 180000;
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

export function needsProgrammes(packageProgramme) {
  return packageProgramme === 'combined' ? ['ems', 'weight'] : [packageProgramme === 'weight' ? 'weight' : 'ems'];
}

export async function latestAdmission(env, clientId) {
  return env.DB.prepare('SELECT * FROM ems_admissions WHERE client_id=? ORDER BY id DESC LIMIT 1').bind(clientId).first();
}

// Returns { ok, reason, admission } — the single rule every enrolment and booking goes through.
export async function eligible(env, clientId, programmes = ['ems']) {
  const { results } = await env.DB.prepare("SELECT * FROM ems_admissions WHERE client_id=? AND status='admitted' AND valid_until >= ? ORDER BY id DESC").bind(clientId, today()).all();
  const latest = await latestAdmission(env, clientId);
  if (latest && latest.status === 'withdrawn') return { ok: false, reason: 'This client has withdrawn consent. Start a new admission before enrolling them again.' };
  const a = (results || []).find(x => programmes.every(p => (parse(x.programmes) || []).includes(p)));
  if (a) return { ok: true, admission: a };
  if (latest && OPEN.includes(latest.status)) return { ok: false, reason: `Admission is not complete yet (${stepLabel(latest.status)}). Both the clinician and the client must sign before enrolment.` };
  if (results && results.length) return { ok: false, reason: `The current admission doesn't cover the ${progList(programmes)}. Start a new admission for it.` };
  return { ok: false, reason: 'No completed admission. Complete the health screening, clinician assessment and both signed consents first.' };
}
export const stepLabel = s => ({ screening: 'step 1 of 3: health screening', assessment: 'step 2 of 3: clinician assessment', client_consent: 'step 3 of 3: client consent', admitted: 'admitted', not_suitable: 'not suitable', withdrawn: 'withdrawn' }[s] || s);

/* ---------------- letters ---------------- */

export function clinicianLetter(a, c) {
  const age = c.birth_year ? new Date().getFullYear() - c.birth_year : null;
  const prog = progList(parse(a.programmes) || []);
  const who = `${a.clinician_name}, ${a.clinician_role}${a.clinician_reg ? ` (Registration no. ${a.clinician_reg})` : ''}`;
  const lines = [
    `I, ${who} at Hasta Wellness, a venture of HASWEL CARE Private Limited, assessed ${c.name}${age ? `, aged ${age}` : ''}, on ${longDay(today())} for the ${prog}.`,
    `I have reviewed the health screening answers given by the client and the assessment findings recorded in this form${a.bp ? ` (blood pressure ${a.bp} mmHg` : ''}${a.heart_rate ? `${a.bp ? ', ' : ' ('}resting heart rate ${a.heart_rate} bpm` : ''}${a.bp || a.heart_rate ? ')' : ''}.`,
    a.decision === 'not_suitable'
      ? `In my professional judgement the client is not suitable to start this programme at this time. Reason: ${a.findings || 'see findings'}.`
      : `In my professional judgement the client is ${a.decision === 'conditions' ? 'suitable to start this programme with the following precautions' : 'suitable to start this programme'}${a.decision === 'conditions' ? `: ${a.precautions}` : '.'}`,
    a.decision === 'not_suitable' ? 'I have explained this to the client and advised them on next steps.'
      : 'I have explained the programme, how sessions are supervised, the expected effort and the possible side effects, and the client had the opportunity to ask questions. This recommendation is based on the information available today and must be reviewed if the client\'s health changes. It remains valid for 12 months unless withdrawn.',
  ];
  return lines.join('\n\n');
}

export function clientLetter(a, c, typedName) {
  const progs = parse(a.programmes) || [];
  const pts = [
    'The health information I have given is true and complete. I will tell the clinic before my next session if my health changes, including pregnancy, new medicines, surgery, or any heart, seizure, blood-pressure or skin condition.',
    `The programme, its expected benefits and its limits have been explained to me by ${a.clinician_name} (${a.clinician_role}). I understand that results vary from person to person and that no particular result has been promised.`,
  ];
  if (progs.includes('ems')) pts.push('I understand that EMS (electrical muscle stimulation) can cause muscle soreness, tiredness and skin redness where the pads are placed, and that, rarely, over-exertion can cause serious muscle injury (rhabdomyolysis). I will drink enough water, follow the trainer\'s instructions on intensity and rest days, and report unusual pain, dark urine, dizziness, chest pain or palpitations straight away.');
  if (progs.includes('weight')) pts.push('I understand that weight-management results depend on my food, activity and sleep, and that the diet and lifestyle guidance is general wellness advice that does not replace advice from my own doctor.');
  pts.push(a.precautions ? `I agree to follow the precautions recorded by my clinician: ${a.precautions}` : 'I will follow the advice of the clinic team during my programme.');
  pts.push('I can stop a session at any time, and I can withdraw from the programme at any time by telling the clinic.');
  pts.push('I agree to Hasta Wellness keeping my health screening, assessment, measurements, attendance and payment records for my programme and using them only to provide and manage my care. I can ask for a copy, or for them to be deleted, except records the clinic is required by law to keep.');
  pts.push('I am 18 years of age or older and I am signing this consent voluntarily.');
  return `I, ${typedName || c.name}, mobile ${c.phone}, consent to join the ${progList(progs)} at Hasta Wellness, operated by HASWEL CARE Private Limited, Kazhakkoottam, Thiruvananthapuram. I confirm that:\n\n` + pts.map((p, i) => `${i + 1}. ${p}`).join('\n');
}

/* ---------------- views ---------------- */

// Admission data safe to send to the browser (signature images stay on the server).
export function publicAdmission(a, c, forStaff) {
  if (!a) return null;
  const out = {
    id: a.id, status: a.status, step: stepLabel(a.status), programmes: parse(a.programmes) || [], consent_version: a.consent_version,
    screening: parse(a.screening), screened_at: a.screened_at, screened_by: a.screened_by,
    bp: a.bp, heart_rate: a.heart_rate, assess_weight: a.assess_weight, findings: a.findings, precautions: a.precautions, decision: a.decision,
    clinician_name: a.clinician_name, clinician_role: a.clinician_role, clinician_reg: a.clinician_reg, clinician_signed_at: a.clinician_signed_at,
    client_typed_name: a.client_typed_name, client_signed_at: a.client_signed_at, client_sign_where: a.client_sign_where,
    valid_until: a.valid_until, withdrawn_at: a.withdrawn_at, withdrawn_reason: a.withdrawn_reason, created_at: a.created_at,
    clinician_letter: a.clinician_letter, client_letter: a.client_letter || (a.status === 'client_consent' ? clientLetter(a, c) : null),
    expired: a.status === 'admitted' && a.valid_until < today(),
  };
  if (!forStaff) { delete out.findings; }
  return out;
}

/* ---------------- actions ---------------- */

export async function startAdmission(env, me, clientId, b) {
  const c = await env.DB.prepare("SELECT * FROM ems_clients WHERE id=? AND status != 'deleted'").bind(clientId).first();
  if (!c) return [404, 'Client not found.'];
  const progs = Array.isArray(b.programmes) ? b.programmes.filter(p => PROGRAMMES[p]) : [];
  if (!progs.length) return [400, 'Choose at least one programme.'];
  if (!c.birth_year || new Date().getFullYear() - c.birth_year < 18) return [400, 'Add the client\'s year of birth first. Programmes are for adults aged 18 and over.'];
  const open = await env.DB.prepare(`SELECT id FROM ems_admissions WHERE client_id=? AND status IN ('screening','assessment','client_consent')`).bind(clientId).first();
  if (open) return [400, 'This client already has an admission in progress.'];
  const r = await env.DB.prepare('INSERT INTO ems_admissions (client_id, programmes, consent_version, created_by) VALUES (?,?,?,?)')
    .bind(clientId, JSON.stringify(progs), CONSENT_VERSION, me.id).run();
  return [200, null, { id: r.meta.last_row_id }];
}

export async function saveScreening(env, adm, b, by) {
  if (!adm || !['screening', 'assessment'].includes(adm.status)) return [400, 'The health screening can no longer be changed. Start a new admission if the answers have changed.'];
  const answers = {};
  for (const [k] of SCREEN_QS) {
    const v = b.answers && b.answers[k];
    if (v !== true && v !== false) return [400, 'Please answer every question with Yes or No.'];
    answers[k] = v;
  }
  const scr = { answers, medicines: clean(b.medicines, 300) || null, other: clean(b.other, 500) || null };
  await env.DB.prepare("UPDATE ems_admissions SET screening=?, screened_at=?, screened_by=?, status='assessment', updated_at=? WHERE id=?")
    .bind(JSON.stringify(scr), nowIso(), by, nowIso(), adm.id).run();
  return [200];
}

export async function saveAssessment(env, me, adm, c, b) {
  if (!adm || adm.status !== 'assessment') return [400, adm && adm.status === 'screening' ? 'Complete the health screening first.' : 'This assessment has already been signed.'];
  const decision = DECISIONS[b.decision] ? b.decision : null;
  if (!decision) return [400, 'Choose the assessment decision.'];
  const bp = clean(b.bp, 9);
  if (bp && !/^\d{2,3}\/\d{2,3}$/.test(bp)) return [400, 'Enter blood pressure as, for example, 120/80.'];
  const hr = b.heart_rate === '' || b.heart_rate == null ? null : parseInt(b.heart_rate, 10);
  if (hr !== null && !(hr >= 30 && hr <= 220)) return [400, 'Check the resting heart rate.'];
  const wt = b.assess_weight === '' || b.assess_weight == null ? null : Number(b.assess_weight);
  if (wt !== null && !(wt >= 25 && wt <= 300)) return [400, 'Check the weight.'];
  const findings = clean(b.findings, 1000), precautions = clean(b.precautions, 600);
  if (decision === 'conditions' && !precautions) return [400, 'Write the precautions the client must follow.'];
  if (decision === 'not_suitable' && !findings) return [400, 'Write the reason in the findings.'];
  const scr = parse(adm.screening) || { answers: {} };
  const yes = Object.entries(scr.answers || {}).filter(([, v]) => v).map(([k]) => k);
  if (yes.length && decision !== 'not_suitable' && !findings) return [400, 'The client answered Yes to some screening questions. Record your findings on them before signing.'];
  const name = clean(b.clinician_name, 80), role = ROLES.includes(b.clinician_role) ? b.clinician_role : null, reg = clean(b.clinician_reg, 40);
  if (name.length < 3 || !role) return [400, 'Enter the clinician\'s full name and role.'];
  if (role === 'Doctor' && !reg) return [400, 'Enter the doctor\'s registration number.'];
  if (!sigOk(b.signature)) return [400, 'The clinician must sign in the signature box.'];
  if (b.confirm !== true) return [400, 'Tick the confirmation to sign the recommendation.'];
  const row = { ...adm, bp: bp || null, heart_rate: hr, assess_weight: wt, findings: findings || null, precautions: precautions || null, decision, clinician_name: name, clinician_role: role, clinician_reg: reg || null };
  const letter = clinicianLetter(row, c);
  const status = decision === 'not_suitable' ? 'not_suitable' : 'client_consent';
  await env.DB.prepare(`UPDATE ems_admissions SET bp=?, heart_rate=?, assess_weight=?, findings=?, precautions=?, decision=?, clinician_id=?, clinician_name=?, clinician_role=?, clinician_reg=?,
    clinician_sig=?, clinician_signed_at=?, clinician_letter=?, status=?, updated_at=? WHERE id=?`)
    .bind(row.bp, hr, wt, row.findings, row.precautions, decision, me.id, name, role, row.clinician_reg, b.signature, nowIso(), letter, status, nowIso(), adm.id).run();
  if (wt) await env.DB.prepare('INSERT INTO ems_measurements (client_id, measured_on, weight, notes, staff_id) VALUES (?,?,?,?,?)').bind(c.id, today(), wt, 'Admission assessment', me.id).run();
  if (status === 'not_suitable') await env.DB.prepare('UPDATE ems_clients SET cleared=0 WHERE id=?').bind(c.id).run();
  return [200, null, { status }];
}

export async function clientSign(env, adm, c, b, where, request) {
  if (!adm || adm.status !== 'client_consent') return [400, adm && OPEN.includes(adm.status) ? 'The clinician must complete and sign the assessment first.' : 'There is nothing waiting for a signature.'];
  const typed = clean(b.typed_name, 80);
  const norm = s => s.toLowerCase().replace(/[^a-z]/g, '');
  if (typed.length < 3) return [400, 'Type your full name.'];
  if (norm(typed) !== norm(c.name) && !(b.name_differs_ok === true && where === 'clinic')) return [400, `The typed name must match the name on the record (${c.name}).`];
  if (!sigOk(b.signature)) return [400, 'Please sign in the signature box.'];
  if (b.agree !== true) return [400, 'Tick the box to confirm you have read and agree to the consent.'];
  const ip = request.headers.get('cf-connecting-ip') || '';
  const ipHash = ip ? (await sha256('ems-consent:' + ip)).slice(0, 24) : null;
  const signedAt = nowIso();
  const letter = clientLetter(adm, c, typed);
  const valid = addDaysIso(istDay(signedAt), VALID_DAYS);
  await env.DB.prepare(`UPDATE ems_admissions SET client_typed_name=?, client_sig=?, client_signed_at=?, client_sign_where=?, client_ip=?, client_letter=?, status='admitted', valid_until=?, updated_at=? WHERE id=?`)
    .bind(typed, b.signature, signedAt, where, ipHash, letter, valid, signedAt, adm.id).run();
  const scr = parse(adm.screening) || { answers: {} };
  const flags = {};
  for (const [k, v] of Object.entries(scr.answers || {})) if (v) flags[k] = true;
  await env.DB.prepare("UPDATE ems_clients SET cleared=1, screening=?, consent_at=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?").bind(JSON.stringify(flags), signedAt, c.id).run();
  return [200, null, { valid_until: valid }];
}

export async function withdraw(env, adm, b, by) {
  if (!adm || !(OPEN.includes(adm.status) || adm.status === 'admitted')) return [400, 'Nothing to withdraw.'];
  const reason = clean(b.reason, 300) || null;
  await env.DB.prepare("UPDATE ems_admissions SET status='withdrawn', withdrawn_at=?, withdrawn_reason=?, updated_at=? WHERE id=?").bind(nowIso(), `${reason || 'No reason given'} (recorded by ${by})`, nowIso(), adm.id).run();
  await env.DB.prepare('UPDATE ems_clients SET cleared=0 WHERE id=?').bind(adm.client_id).run();
  const now = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 16);
  const r = await env.DB.prepare("UPDATE ems_appointments SET status='cancelled', notes=TRIM(IFNULL(notes,'')||' Cancelled: consent withdrawn') WHERE client_id=? AND kind='session' AND status='booked' AND start_at >= ?").bind(adm.client_id, now).run();
  return [200, null, { cancelled: r.meta.changes || 0 }];
}

/* ---------------- PDF ---------------- */

const WIN = /[^\x20-\x7E\xA0-\xFF–—‘’“”•…€\n]/g;
const safe = s => String(s == null ? '' : s).replace(/₹/g, 'Rs. ').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/\t/g, ' ').replace(WIN, '?');

export async function admissionPdf(env, request, adm, c) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Programme admission and consent — ${safe(c.name)}`);
  pdf.setAuthor('Hasta Wellness · HASWEL CARE Private Limited');
  pdf.setSubject(CONSENT_VERSION);
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const teal = rgb(0.204, 0.349, 0.369), ink = rgb(0.12, 0.19, 0.2), muted = rgb(0.37, 0.43, 0.42), gold = rgb(0.77, 0.64, 0.36), line = rgb(0.85, 0.88, 0.87);
  const W = 595.28, H = 841.89, M = 50;
  let page, y;
  let logo = null;
  try {
    const res = await env.ASSETS.fetch(new Request(new URL('/img/hasta-wellness-logo.jpg', request.url)));
    if (res.ok) logo = await pdf.embedJpg(new Uint8Array(await res.arrayBuffer()));
  } catch { /* logo optional */ }
  const newPage = () => {
    page = pdf.addPage([W, H]);
    page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: teal });
    if (logo) { const s = 40 / logo.height; page.drawImage(logo, { x: M, y: H - 60, width: logo.width * s, height: 40 }); }
    else page.drawText('Hasta Wellness', { x: M, y: H - 40, size: 13, font: bold, color: teal });
    const v = 'A venture of HASWEL CARE Private Limited';
    page.drawText(v, { x: W - M - reg.widthOfTextAtSize(v, 8.5), y: H - 36, size: 8.5, font: reg, color: muted });
    const t = 'Programme admission record';
    page.drawText(t, { x: W - M - bold.widthOfTextAtSize(t, 8.5), y: H - 49, size: 8.5, font: bold, color: teal });
    const addr = '1st floor, Anjali Arcade, near Nippon Toyota, Technopark Phase 3 Service Road, Kazhakkoottam, Thiruvananthapuram, Kerala 695582';
    page.drawText(safe(addr), { x: M, y: 28, size: 7.5, font: reg, color: muted });
    page.drawText(safe(`Record ${adm.id} · ${CONSENT_VERSION} · ${pdf.getPageCount()}`), { x: W - M - reg.widthOfTextAtSize(safe(`Record ${adm.id} · ${CONSENT_VERSION} · ${pdf.getPageCount()}`), 7.5), y: 16, size: 7.5, font: reg, color: muted });
    y = H - 90;
  };
  const need = hgt => { if (y - hgt < 58) newPage(); };
  const wrap = (text, font, size, width) => {
    const out = [];
    for (const para of safe(text).split('\n')) {
      if (!para.trim()) { out.push(''); continue; }
      let cur = '';
      for (const w of para.split(' ')) {
        const t = cur ? cur + ' ' + w : w;
        if (font.widthOfTextAtSize(t, size) > width && cur) { out.push(cur); cur = w; } else cur = t;
      }
      out.push(cur);
    }
    return out;
  };
  const para = (text, { size = 10, font = reg, color = ink, indent = 0, gap = 4 } = {}) => {
    for (const l of wrap(text, font, size, W - 2 * M - indent)) { need(size + 4); if (l) page.drawText(l, { x: M + indent, y, size, font, color }); y -= size + 4; }
    y -= gap;
  };
  const heading = t => { need(40); y -= 6; page.drawText(safe(t), { x: M, y, size: 12.5, font: bold, color: teal }); y -= 8; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: gold }); y -= 16; };
  const kv = rows => {
    for (const [k, v] of rows) {
      const lines = wrap(v || '—', reg, 9.5, W - 2 * M - 150);
      need(lines.length * 13 + 2);
      page.drawText(safe(k), { x: M, y, size: 9.5, font: bold, color: muted });
      lines.forEach((l, i) => page.drawText(l, { x: M + 150, y: y - i * 13, size: 9.5, font: reg, color: ink }));
      y -= lines.length * 13 + 3;
    }
    y -= 4;
  };
  const signature = async (dataUrl, name, sub, when) => {
    need(110);
    if (dataUrl) {
      try {
        const img = await pdf.embedPng(Uint8Array.from(atob(dataUrl.split(',')[1]), ch => ch.charCodeAt(0)));
        const s = Math.min(200 / img.width, 60 / img.height);
        page.drawImage(img, { x: M, y: y - 60, width: img.width * s, height: img.height * s });
      } catch { /* unreadable image */ }
    }
    y -= 64;
    page.drawLine({ start: { x: M, y }, end: { x: M + 230, y }, thickness: 0.6, color: line });
    y -= 13; page.drawText(safe(name), { x: M, y, size: 10, font: bold, color: ink });
    y -= 12; page.drawText(safe(sub), { x: M, y, size: 8.5, font: reg, color: muted });
    y -= 12; page.drawText(safe(when), { x: M, y, size: 8.5, font: reg, color: muted });
    y -= 18;
  };

  newPage();
  page.drawText('Programme admission and consent', { x: M, y, size: 18, font: bold, color: ink }); y -= 20;
  const status = { admitted: adm.valid_until < today() ? 'Admission expired' : `Admitted — valid until ${longDay(adm.valid_until)}`, not_suitable: 'Not suitable at this time', withdrawn: 'Consent withdrawn', client_consent: 'Awaiting client signature', assessment: 'Awaiting clinician assessment', screening: 'Awaiting health screening' }[adm.status];
  page.drawText(safe(status), { x: M, y, size: 10.5, font: bold, color: adm.status === 'admitted' ? teal : rgb(0.66, 0.39, 0.17) }); y -= 24;

  heading('Client');
  kv([['Name', c.name], ['Mobile', c.phone], ['Year of birth', c.birth_year ? String(c.birth_year) : ''], ['Gender', c.gender ? c.gender[0].toUpperCase() + c.gender.slice(1) : ''], ['Height', c.height_cm ? c.height_cm + ' cm' : ''],
    ['Programme', progList(JSON.parse(adm.programmes))], ['Goal', c.goal || '']]);

  heading('1. Health screening');
  const scr = parse(adm.screening);
  if (scr) {
    for (const [k, q] of SCREEN_QS) {
      const ans = scr.answers[k] ? 'Yes' : 'No';
      const lines = wrap(q, reg, 9.5, W - 2 * M - 50);
      need(lines.length * 13 + 2);
      lines.forEach((l, i) => page.drawText(l, { x: M, y: y - i * 13, size: 9.5, font: reg, color: ink }));
      page.drawText(ans, { x: W - M - 30, y, size: 9.5, font: bold, color: scr.answers[k] ? rgb(0.64, 0.23, 0.17) : muted });
      y -= lines.length * 13 + 3;
    }
    y -= 4;
    kv([['Medicines', scr.medicines || 'None stated'], ['Other information', scr.other || 'None stated'], ['Completed', `${istStamp(adm.screened_at)} by ${adm.screened_by}`]]);
  } else para('Not completed yet.', { color: muted });

  heading('2. Clinician assessment and recommendation');
  if (adm.clinician_signed_at) {
    kv([['Blood pressure', adm.bp ? adm.bp + ' mmHg' : 'Not recorded'], ['Resting heart rate', adm.heart_rate ? adm.heart_rate + ' bpm' : 'Not recorded'], ['Weight', adm.assess_weight ? adm.assess_weight + ' kg' : 'Not recorded'],
      ['Findings', adm.findings || 'No concerns noted'], ['Decision', DECISIONS[adm.decision]], ['Precautions', adm.precautions || 'None']]);
    para(adm.clinician_letter, { size: 10 });
    await signature(adm.clinician_sig, adm.clinician_name, `${adm.clinician_role}${adm.clinician_reg ? ' · Reg. no. ' + adm.clinician_reg : ''} · Hasta Wellness`, 'Signed electronically ' + istStamp(adm.clinician_signed_at));
  } else para('Not completed yet.', { color: muted });

  if (adm.client_signed_at) newPage();
  heading('3. Client consent');
  if (adm.client_signed_at) {
    para(adm.client_letter, { size: 10 });
    await signature(adm.client_sig, adm.client_typed_name, `Client · signed ${adm.client_sign_where === 'app' ? 'in the Hasta EMS app' : 'at the clinic'}`, 'Signed electronically ' + istStamp(adm.client_signed_at));
  } else para('Not signed yet.', { color: muted });

  if (adm.status === 'withdrawn') { heading('Withdrawal'); kv([['Withdrawn', istStamp(adm.withdrawn_at)], ['Reason', adm.withdrawn_reason]]); }
  const note = safe(`Generated ${istStamp(nowIso())}. Electronic signatures were captured on screen with the signer's typed name and time of signing.`);
  page.drawText(note, { x: M, y: 40, size: 7.5, font: reg, color: muted });
  return pdf.save();
}

export { DECISIONS, ROLES };
