// Hasta EMS Academy — admissions for external candidates.
//
//   Website   GET  /academy/            course, entry requirements, open batches (fee incl. GST), apply form
//             POST /academy/apply       multipart application with documents (R2 academy-apply/…)
//             GET  /academy/status      check an application with its number + mobile
//   EMS app   Academy → Admissions      batches; review, interview, offer, enrol (managers and admins)
//
// Flow: submitted → interview → offered (clinic patient record + draft course-fee bill, 18% GST) →
//       paid at the clinic desk or by UPI in the clinic app → enrolled (trainee login, Academy only,
//       training record on the batch's machine) → completed when the certificate is issued.
//       Side exits: waitlisted, rejected, withdrawn. Every step is written to ems_academy_events.
// Trainee accounts (ems_staff.role = 'trainee') can use only "My course": materials, their own
// record and the theory test. Supervised practice is with Hasta clients who agree to a trainee.

import { clean, nz, h, sha256, normalisePhone, notify, sameOrigin } from './util.js';
import { chrome, htmlResponse } from './careers.js';
import { createInvoiceWithLines, ACADEMY_ITEM } from './clinic.js';
import { audit } from './hr.js';
import { hashSecret } from './ems.js';
import { approvedCurriculum, listRecords, RULES, ensureSeed } from './academy.js';

const R = (s, e, x) => [s, e, x];
const OK = x => [200, null, x];
const IST = 330 * 60000;
const today = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString().slice(0, 19) + 'Z';
const r2 = x => Math.round((Number(x) || 0) * 100) / 100;
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const last10 = p => String(p || '').replace(/\D/g, '').slice(-10);
const parse = (s, f) => { try { return s ? JSON.parse(s) : f; } catch { return f; } };
const longDay = d => d ? new Date(d.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';
const inr = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });
export const withGst = fee => r2(fee + 2 * r2(fee * 9 / 100));

export const BATCH_STATUS = ['draft', 'open', 'closed', 'completed', 'cancelled'];
export const APP_STATUS = { submitted: 'New', interview: 'Interview', offered: 'Offered — awaiting fee', enrolled: 'Enrolled', completed: 'Certified', waitlisted: 'Waitlisted', rejected: 'Not accepted', withdrawn: 'Withdrawn' };
const HOLDS_SEAT = ['offered', 'enrolled', 'completed'];
const ACTIVE = ['submitted', 'interview', 'offered', 'enrolled', 'waitlisted'];
export const QUALS = { aesthetic: 'Aesthetic therapist', cosmetic_doctor: 'Cosmetic doctor', physio: 'Physiotherapist (BPT / MPT)' };
// Minimum 6 months' work experience in that role.
export const EXP_BANDS = { m6: '6–12 months', y1: '1–3 years', y3: 'More than 3 years' };
export const DEFAULT_FEE = 20000;
export const DOCS = { id_proof: ['Photo ID (Aadhaar with number masked, passport, driving licence or voter ID)', true], qualification: ['Qualification certificate', true], bls: ['BLS / CPR certificate (if you have one)', false], photo: ['Passport-size photo', false] };
export const CHECKS = { id: 'Photo ID matches the applicant', qualification: 'Qualification certificate checked', background: 'Aesthetic therapist, cosmetic doctor or physiotherapist with 6+ months’ experience', bls: 'Valid BLS certificate (or booked before supervised practice)', interview: 'Interview done — communication and attitude suitable' };
const OFFER_CHECKS = ['id', 'qualification', 'background', 'interview'];
const DOC_MAX = 5 * 1024 * 1024;
const SIGS = { pdf: [[0x25, 0x50, 0x44, 0x46], 'application/pdf'], jpg: [[0xff, 0xd8, 0xff], 'image/jpeg'], png: [[0x89, 0x50, 0x4e, 0x47], 'image/png'] };
const DEFAULT_REQS = 'Aged 18 or over\nWorking as an aesthetic therapist, cosmetic doctor or physiotherapist, with at least 6 months’ experience\nA valid Basic Life Support (BLS) certificate before supervised practice starts (you can take it during the course)\nComfortable speaking with clients in English or Malayalam\nAble to attend every classroom day and complete the supervised sessions at Hasta, Kazhakkoottam';

async function settingsOf(env) {
  const { results } = await env.DB.prepare("SELECT key, value FROM cl_settings WHERE key IN ('academy_terms','academy_requirements','gstin','trade_name')").all();
  const s = Object.fromEntries((results || []).map(r => [r.key, r.value]));
  return { terms: s.academy_terms || '', requirements: s.academy_requirements || DEFAULT_REQS };
}

async function batchesWithSeats(env, where = '', ...bind) {
  const { results } = await env.DB.prepare(`SELECT b.*, m.name machine_name,
      (SELECT COUNT(*) FROM ems_academy_applications a WHERE a.batch_id=b.id AND a.status IN ('offered','enrolled','completed')) taken,
      (SELECT COUNT(*) FROM ems_academy_applications a WHERE a.batch_id=b.id) applications,
      (SELECT COUNT(*) FROM ems_academy_applications a WHERE a.batch_id=b.id AND a.status IN ('submitted','interview')) to_review
    FROM ems_academy_batches b LEFT JOIN ems_machine_types m ON m.id=b.machine_type_id ${where} ORDER BY b.start_date DESC, b.id DESC`).bind(...bind).all();
  return (results || []).map(b => ({ ...b, left: Math.max(0, b.seats - b.taken), fee_total: withGst(b.fee) }));
}
const openForApply = b => b.status === 'open' && (!b.apply_by || b.apply_by >= today()) && b.start_date >= today();

/* =============================== public website =============================== */

const CSS = `.ac-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:56px;align-items:start}.ac-steps{counter-reset:s;display:grid;gap:14px;padding:0;margin:0;list-style:none}
.ac-steps li{counter-increment:s;display:grid;grid-template-columns:36px 1fr;gap:14px;align-items:start}.ac-steps li:before{content:counter(s);display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:var(--soft);color:var(--green);font-weight:700}
.ac-steps b{display:block;margin-bottom:2px}.ac-mods{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}.ac-mod{padding:16px 18px;border:1px solid var(--line);border-radius:8px}.ac-mod b{display:block;margin-bottom:4px}.ac-mod span{font-size:13px;color:var(--muted)}
.ac-batch{display:grid;grid-template-columns:1fr auto;gap:12px 20px;align-items:center;padding:20px 22px;border:1px solid var(--line);border-left:2px solid var(--gold);border-radius:8px;margin-bottom:12px}.ac-batch h3{margin:0 0 4px;font-size:20px}.ac-batch p{margin:0;color:var(--muted);font-size:14px}
.ac-fee{text-align:right}.ac-fee b{font-size:22px;display:block}.ac-fee small{color:var(--muted)}.ac-seat{display:inline-block;font-size:12px;font-weight:700;padding:3px 10px;border-radius:99px;background:var(--soft);margin-top:8px}
form.lead select,form.lead input[type=date],form.lead input[type=email],form.lead input[type=file],form.lead textarea{width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:6px;font:inherit;font-size:15px;color:var(--green);background:#fff}form.lead textarea{min-height:90px;resize:vertical}
form.lead fieldset{border:0;padding:0;margin:0;display:grid;gap:14px}form.lead legend{font-weight:700;font-size:15px;margin-bottom:6px}.two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.okmsg{padding:22px;border-left:2px solid var(--gold);background:var(--soft);margin-bottom:20px}.errmsg{padding:14px;border-left:2px solid #a0442f;background:#fbefeb;margin-bottom:14px;color:#7a3322}.terms{font-size:13px;color:var(--muted);line-height:1.7}
.st{display:inline-block;padding:5px 12px;border-radius:99px;font-weight:700;background:var(--soft)}
@media(max-width:900px){.ac-grid{grid-template-columns:1fr}.ac-batch{grid-template-columns:1fr}.ac-fee{text-align:left}.two{grid-template-columns:1fr}}`;
const BAR = '<a class="primary" href="/academy/#apply">Apply now ↗</a>';
const page = (url, title, desc, path, body, ld = []) => htmlResponse(url, chrome(url.origin, title, desc, path, body, ld, { css: CSS, bar: BAR, fine: 'Hasta EMS Academy' }));

export async function academyPage(env, url) {
  const path = url.pathname;
  if (path === '/academy') return Response.redirect(new URL('/academy/', url).toString(), 301);
  if (path === '/academy/status' || path === '/academy/status/') return statusPage(env, url);
  if (path !== '/academy/') return page(url, 'Page not found | Hasta EMS Academy', '', path, '<div class="wrap" style="padding:80px 0"><h1>Page not found</h1><p><a href="/academy/">EMS Trainer Programme</a></p></div>');
  await ensureSeed(env);
  const [s, cur, batches] = await Promise.all([settingsOf(env), approvedCurriculum(env).then(c => c || env.DB.prepare('SELECT * FROM ems_curriculum ORDER BY id DESC LIMIT 1').first()), batchesWithSeats(env, "WHERE b.status IN ('open','closed') AND b.start_date >= ?", today())]);
  const mods = parse(cur && cur.modules, []);
  const open = batches.filter(openForApply);
  const applied = url.searchParams.get('applied'), err = url.searchParams.get('error');
  const reqs = s.requirements.split('\n').map(x => x.trim()).filter(Boolean);
  const batchList = batches.length ? batches.slice().reverse().map(b => `<div class="ac-batch"><div><h3>${h(b.title)}</h3>
      <p>${h(longDay(b.start_date))}${b.end_date ? ' – ' + h(longDay(b.end_date)) : ''}${b.machine_name ? ' · ' + h(b.machine_name) : ''}</p>${b.schedule ? `<p>${h(b.schedule)}</p>` : ''}
      <span class="ac-seat">${openForApply(b) ? (b.left ? `${b.left} of ${b.seats} seats left` : 'Full — join the waiting list') : 'Applications closed'}</span>${b.apply_by && openForApply(b) ? ` <small style="color:var(--muted)">Apply by ${h(longDay(b.apply_by))}</small>` : ''}</div>
    <div class="ac-fee">${b.fee > 0 ? `<b>${inr(b.fee_total)}</b><small>${inr(b.fee)} + 18% GST</small>` : '<small>Fee on request</small>'}</div></div>`).join('')
    : `<p style="padding:22px;border:1px dashed var(--line);border-radius:8px;color:var(--muted)">No batch is open for applications right now. Leave your details through the form and we’ll tell you when the next batch opens, or WhatsApp <a href="https://wa.me/919778458883">+91 97784 58883</a>.</p>`;
  const docInputs = Object.entries(DOCS).map(([k, [l, req]]) => `<label>${h(l)}${req ? '' : ' <span style="font-weight:400;color:var(--muted)">(optional)</span>'}<input type="file" name="doc_${k}" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"${req ? ' required' : ''}></label>`).join('');
  const form = applied ? `<div class="okmsg" role="status"><strong>Thank you — your application ${h(applied)} has been received.</strong><p style="margin:8px 0 0">Keep this number. The Academy team will review your documents and call or WhatsApp you within 3 working days. You can <a href="/academy/status?no=${encodeURIComponent(applied)}">check your application</a> at any time.</p></div>`
    : `${err ? `<div class="errmsg" role="alert">${h(err)}</div>` : ''}<form class="lead" method="post" action="/academy/apply" enctype="multipart/form-data">
<fieldset><legend>Batch</legend><label>Batch you want to join<select name="batch" required>${open.length ? open.map(b => `<option value="${b.id}">${h(b.title)} — starts ${h(longDay(b.start_date))}${b.left ? '' : ' (waiting list)'}</option>`).join('') : '<option value="next">Next available batch</option>'}</select></label></fieldset>
<fieldset><legend>About you</legend><label>Full name (as on your certificates)<input type="text" name="name" autocomplete="name" required maxlength="80"></label>
<div class="two"><label>Mobile number<input type="tel" name="phone" autocomplete="tel" inputmode="tel" required pattern="[0-9+ \\(\\)\\-]{10,20}"></label><label>Email<input type="email" name="email" autocomplete="email" required maxlength="120"></label></div>
<div class="two"><label>Date of birth<input type="date" name="dob" required max="${today()}"></label><label>Gender<select name="gender"><option value="">Prefer not to say</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></label></div>
<label>City / town<input type="text" name="city" maxlength="80" required></label></fieldset>
<fieldset><legend>Qualification and experience</legend><label>You are a<select name="qualification" required><option value="">Choose</option>${Object.entries(QUALS).map(([k, l]) => `<option value="${k}">${h(l)}</option>`).join('')}</select></label>
<div class="two"><label>Course / certificate name and institute<input type="text" name="qualification_body" maxlength="160" required placeholder="e.g. Diploma in Cosmetology, VLCC Institute"></label><label>Registration number (if any)<input type="text" name="registration_no" maxlength="60" placeholder="e.g. council registration"></label></div>
<div class="two"><label>Experience in this role<select name="exp_band" required><option value="">Choose</option><option value="lt6">Less than 6 months</option>${Object.entries(EXP_BANDS).map(([k, l]) => `<option value="${k}">${h(l)}</option>`).join('')}</select></label><label>Current or last employer<input type="text" name="employer" maxlength="120" required></label></div>
<label>Your work in brief (optional)<input type="text" name="experience" maxlength="120" placeholder="e.g. skin treatments and body contouring at a clinic in Kochi"></label>
<label>Basic Life Support (BLS / CPR)<select name="bls"><option value="valid">I have a valid BLS certificate</option><option value="expired">My BLS certificate has expired</option><option value="none">I don’t have one yet</option></select></label>
<label>Why do you want to become an EMS trainer? (optional)<textarea name="statement" maxlength="1000"></textarea></label>
<label>How did you hear about us?<select name="how_heard"><option value="">—</option><option>Instagram</option><option>Facebook</option><option>Google</option><option>Friend or colleague</option><option>Hasta client</option><option>Other</option></select></label></fieldset>
<fieldset><legend>Documents</legend><p style="margin:0;font-size:13px;color:var(--muted)">PDF, JPG or PNG, up to 5 MB each. Mask the first 8 digits of an Aadhaar card. Don’t send bank or PAN details.</p>${docInputs}</fieldset>
<label class="hp" aria-hidden="true">Company<input type="text" name="company" tabindex="-1" autocomplete="off"></label>
<label class="consent"><input type="checkbox" name="consent" value="yes" required><span>I confirm the information and documents are true. I agree that HASWEL CARE Private Limited (Hasta Wellness) may store and check them, including with the issuers, to assess my application and run the course. <a href="/privacy/">Privacy notice</a></span></label>
<label class="consent"><input type="checkbox" name="terms" value="yes" required><span>I have read the fee and refund terms below.</span></label>
<button class="btn" type="submit">Submit application <span>↗</span></button></form>`;
  const minFee = open.filter(b => b.fee > 0).map(b => b.fee).sort((a, b) => a - b)[0];
  const ld = [{ '@context': 'https://schema.org', '@type': 'Course', name: 'Hasta EMS Trainer Programme', description: 'Classroom training, supervised practice with real clients and a practical assessment to become a certified whole-body EMS trainer.',
    provider: { '@type': 'Organization', name: 'Hasta Wellness (HASWEL CARE Private Limited)', sameAs: url.origin },
    ...(open.length ? { hasCourseInstance: open.map(b => ({ '@type': 'CourseInstance', courseMode: 'Onsite', startDate: b.start_date, ...(b.end_date ? { endDate: b.end_date } : {}), location: { '@type': 'Place', name: 'Hasta Wellness', address: 'Technopark Phase 3 Service Road, Kazhakkoottam, Thiruvananthapuram 695582' } })) } : {}),
    ...(minFee ? { offers: { '@type': 'Offer', price: withGst(minFee), priceCurrency: 'INR', category: 'Paid' } } : {}) }];
  const body = `<div class="wrap"><p class="crumbs"><a href="/">Home</a> / EMS Academy</p>
<div class="hero" style="grid-template-columns:1fr;padding-bottom:30px"><div><div class="eyebrow">HASTA EMS ACADEMY · KAZHAKKOOTTAM, TRIVANDRUM</div>
<h1>Become a certified <em>EMS trainer.</em></h1>
<p>A practical programme for aesthetic therapists, cosmetic doctors and physiotherapists with at least 6 months’ experience: classroom modules, hands-on machine training and real sessions with Hasta clients under a Master Trainer, ending in a certificate anyone can check online.</p>
<p><a class="btn" href="#apply">Apply for the next batch <span>↗</span></a></p></div></div></div>
<section class="block"><div class="wrap"><div class="eyebrow">BATCHES</div><h2>Upcoming batches</h2>${batchList}</div></section>
<section class="block"><div class="wrap ac-grid"><div><div class="eyebrow">HOW IT WORKS</div><h2>From application to certificate</h2>
<ol class="ac-steps"><li><div><b>Apply online</b>Choose a batch and upload your ID and qualification certificate.</div></li>
<li><div><b>Review and a short interview</b>We check your documents and call you, usually within 3 working days.</div></li>
<li><div><b>Offer and fee</b>If you’re offered a seat, pay the course fee at the clinic or by UPI. Your seat is confirmed once it’s paid.</div></li>
<li><div><b>Classroom and machine training</b>${mods.length ? mods.length - 1 : 10} modules at Hasta, Kazhakkoottam, with the study materials in your own Academy login.</div></li>
<li><div><b>Supervised practice</b>At least ${RULES.supervised} real sessions with Hasta clients (who agree to a trainee), including ${RULES.first_sessions} first sessions, with a Master Trainer beside you.</div></li>
<li><div><b>Test, practical and certificate</b>A ${RULES.questions}-question theory test (pass mark ${RULES.pass_mark}%, ${RULES.max_attempts} attempts) and a practical assessment. Your certificate is valid for ${RULES.cert_months} months on the machine you trained on and can be verified at ${h(url.host)}/verify.</div></li></ol></div>
<div><div class="eyebrow">WHO CAN APPLY</div><h2>Entry requirements</h2><ul>${reqs.map(r => `<li>${h(r)}</li>`).join('')}</ul></div></div></section>
${mods.length ? `<section class="block"><div class="wrap"><div class="eyebrow">CURRICULUM${cur && cur.status === 'approved' ? ' · VERSION ' + h(cur.version) : ''}</div><h2>What you’ll learn</h2><div class="ac-mods">${mods.map(m => `<div class="ac-mod"><b>${m.no}. ${h(m.title)}</b><span>${h(m.hours)}${/session/.test(m.hours) ? '' : ' h'} · ${h(m.assessed)}</span></div>`).join('')}</div></div></section>` : ''}
<section class="block" id="apply"><div class="wrap ac-grid"><div><div class="eyebrow">APPLY</div><h2>Apply for the programme</h2>${form}</div>
<div><div class="eyebrow">FEES</div><h2>Fee and refunds</h2><p>The course fee is shown with each batch: the fee plus 18% GST. You get a GST invoice from HASWEL CARE Private Limited.</p>${s.terms ? `<p class="terms">${h(s.terms)}</p>` : ''}
<p class="terms">Already applied? <a href="/academy/status">Check your application</a>.</p><p class="terms">Questions? Call or WhatsApp <a href="https://wa.me/919778458883">+91 97784 58883</a>.</p></div></div></section>`;
  return page(url, 'EMS Trainer Course in Trivandrum – Hasta EMS Academy, Kazhakkoottam', 'Become a certified whole-body EMS trainer at Hasta Wellness, Kazhakkoottam: classroom modules, supervised practice with real clients and an online-verifiable certificate.', '/academy/', body, ld);
}

function backTo(url, error, appNo) {
  const u = new URL('/academy/', url);
  if (appNo) u.searchParams.set('applied', appNo);
  if (error) u.searchParams.set('error', error);
  u.hash = 'apply';
  return Response.redirect(u.toString(), 303);
}

async function nextAppNo(env) {
  const y = today().slice(0, 4);
  const r = await env.DB.prepare("SELECT app_no FROM ems_academy_applications WHERE app_no LIKE ? ORDER BY id DESC LIMIT 1").bind(`EMSA/${y}/%`).first();
  const n = r ? parseInt(r.app_no.split('/')[2], 10) + 1 : 1;
  return `EMSA/${y}/${String(n).padStart(4, '0')}`;
}

export async function academyApply(request, env, url, ctx) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!sameOrigin(request)) return new Response('Forbidden', { status: 403 });
  if (parseInt(request.headers.get('content-length') || '0', 10) > 4 * DOC_MAX + 128 * 1024) return backTo(url, 'Your files are too large. Each must be under 5 MB.');
  let form;
  try { form = await request.formData(); } catch { return backTo(url, 'Something went wrong. Please try again.'); }
  if (form.get('company')) return backTo(url, null, 'received'); // honeypot
  if (form.get('consent') !== 'yes' || form.get('terms') !== 'yes') return backTo(url, 'Please tick both boxes to apply.');
  const name = clean(form.get('name'), 80), phone = normalisePhone(form.get('phone')), email = clean(form.get('email'), 120);
  if (name.length < 2) return backTo(url, 'Please enter your name.');
  if (!phone) return backTo(url, 'Please enter a valid mobile number.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return backTo(url, 'Please check your email address.');
  const dob = isDate(form.get('dob')) ? form.get('dob') : null;
  if (!dob) return backTo(url, 'Please enter your date of birth.');
  const age = (Date.parse(today()) - Date.parse(dob)) / (365.25 * 864e5);
  if (age < 18) return backTo(url, 'Applicants must be 18 or over.');
  const qual = QUALS[form.get('qualification')] ? form.get('qualification') : null;
  if (!qual) return backTo(url, 'Please choose whether you are an aesthetic therapist, cosmetic doctor or physiotherapist.');
  const band = form.get('exp_band');
  if (band === 'lt6') return backTo(url, 'The programme needs at least 6 months’ experience as an aesthetic therapist, cosmetic doctor or physiotherapist. You’re welcome to apply once you have it.');
  if (!EXP_BANDS[band]) return backTo(url, 'Please choose your experience.');
  if (!clean(form.get('employer'), 120)) return backTo(url, 'Please enter your current or last employer.');
  // Batch: an open batch, or the next one if none is open (kept as a waiting list).
  let batch = null;
  const bid = parseInt(form.get('batch'), 10);
  if (bid) { batch = (await batchesWithSeats(env, 'WHERE b.id=?', bid))[0]; if (!batch || !openForApply(batch)) return backTo(url, 'That batch is no longer taking applications. Please choose another.'); }
  else {
    batch = (await batchesWithSeats(env, "WHERE b.status IN ('draft','open') AND b.start_date >= ?", today())).pop();
    if (!batch) return backTo(url, 'No batch is open yet. Please WhatsApp +91 97784 58883 and we’ll tell you when the next batch opens.');
  }
  const ph = last10(phone);
  const dup = await env.DB.prepare(`SELECT app_no FROM ems_academy_applications WHERE batch_id=? AND substr(replace(phone,' ',''),-10)=? AND status IN (${ACTIVE.map(() => '?').join(',')})`).bind(batch.id, ph, ...ACTIVE).first();
  if (dup) return backTo(url, `You have already applied for this batch (application ${dup.app_no}). We’ll be in touch.`);
  const ip = request.headers.get('cf-connecting-ip') || '';
  const ipHash = ip ? (await sha256(`hasta-academy:${today()}:${ip}`)).slice(0, 24) : null;
  if (ipHash) {
    const r = await env.DB.prepare("SELECT COUNT(*) n FROM ems_academy_applications WHERE consent_ip_hash=? AND created_at > strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 hour')").bind(ipHash).first();
    if (r && r.n >= 5) return backTo(url, 'Too many applications from this connection. Please try again later or WhatsApp us.');
  }
  // Documents: checked by their first bytes, stored privately in R2.
  const docs = {};
  for (const [k, [label, req]] of Object.entries(DOCS)) {
    const f = form.get('doc_' + k);
    if (!f || typeof f !== 'object' || !f.size) { if (req) return backTo(url, `Please upload your ${label.split(' (')[0].toLowerCase()}.`); continue; }
    if (f.size > DOC_MAX) return backTo(url, `${label.split(' (')[0]} is larger than 5 MB. Please upload a smaller file.`);
    const buf = new Uint8Array(await f.arrayBuffer());
    const ext = Object.keys(SIGS).find(e => SIGS[e][0].every((b, i) => buf[i] === b));
    if (!ext) return backTo(url, `${label.split(' (')[0]}: please upload a PDF, JPG or PNG file.`);
    if (!env.CVS) return backTo(url, 'Uploads are unavailable right now. Please WhatsApp +91 97784 58883.');
    const key = `academy-apply/${today().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
    await env.CVS.put(key, buf, { httpMetadata: { contentType: SIGS[ext][1] } });
    docs[k] = { key, name: clean(String(f.name || '').replace(/[^\w.\- ]/g, '_'), 100) || `${k}.${ext}`, type: SIGS[ext][1] };
  }
  const bls = ['valid', 'expired', 'none'].includes(form.get('bls')) ? form.get('bls') : 'none';
  const status = batch.status === 'open' && batch.left > 0 ? 'submitted' : 'waitlisted';
  let appNo = null, id = null;
  for (let i = 0; i < 3 && !id; i++) {
    appNo = await nextAppNo(env);
    try {
      id = (await env.DB.prepare(`INSERT INTO ems_academy_applications (app_no, batch_id, name, phone, email, dob, gender, city, qualification, qualification_body, registration_no, experience, employer, bls, statement, how_heard, docs, consent_at, consent_ip_hash, status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(appNo, batch.id, name, ph, email, dob, ['female', 'male', 'other'].includes(form.get('gender')) ? form.get('gender') : null, nz(clean(form.get('city'), 80)),
        qual, nz(clean(form.get('qualification_body'), 160)), nz(clean(form.get('registration_no'), 60)), `${EXP_BANDS[band]}${clean(form.get('experience'), 120) ? ' — ' + clean(form.get('experience'), 120) : ''}`, nz(clean(form.get('employer'), 120)), bls,
        nz(clean(form.get('statement'), 1000)), nz(clean(form.get('how_heard'), 40)), JSON.stringify(docs), nowIso(), ipHash, status).run()).meta.last_row_id;
    } catch (e) { if (!/UNIQUE/i.test(String(e && e.message))) throw e; }
  }
  if (!id) return backTo(url, 'Something went wrong. Please try again.');
  await event(env, id, status === 'waitlisted' ? 'Applied — batch full, placed on the waiting list' : 'Applied on the website', null, 'Applicant');
  const alert = notify(env, `EMS Academy application: ${name}`, [['Application', appNo], ['Batch', `${batch.title} (${batch.start_date})`], ['Name', name], ['Mobile', ph], ['Email', email], ['Role', `${QUALS[qual]} — ${clean(form.get('qualification_body'), 160)}`], ['Experience', EXP_BANDS[band]], ['BLS', bls], ['Status', APP_STATUS[status]]],
    '/#/academy?tab=admissions', env.EMS_ORIGIN || (url.origin.includes('localhost') ? url.origin + '/ems' : url.origin.replace('//', '//ems.')));
  if (ctx && ctx.waitUntil) ctx.waitUntil(alert); else await alert;
  return backTo(url, null, appNo);
}

async function statusPage(env, url) {
  const no = clean(url.searchParams.get('no'), 20).toUpperCase(), ph = last10(url.searchParams.get('phone'));
  let res = '';
  if (no && ph.length === 10) {
    const a = await env.DB.prepare('SELECT a.*, b.title batch_title, b.start_date, b.fee FROM ems_academy_applications a JOIN ems_academy_batches b ON b.id=a.batch_id WHERE a.app_no=? AND a.phone=?').bind(no, ph).first();
    if (!a) res = '<div class="errmsg" role="alert">We couldn’t find an application with that number and mobile number.</div>';
    else {
      const inv = a.invoice_id ? await invoiceRow(env, a.invoice_id) : null;
      const next = { submitted: 'We are reviewing your documents and will call you.', interview: 'We will call you to arrange or confirm a short interview.', waitlisted: 'You are on the waiting list. We will contact you if a seat opens or when the next batch is announced.',
        offered: `You have been offered a seat. Pay the course fee${inv ? ` of ${inr(inv.total)}` : ''} at the clinic or by UPI${a.offer_expires ? ` by ${longDay(a.offer_expires)}` : ''} to confirm it.`,
        enrolled: 'You are enrolled. Sign in to your Academy account for materials and your progress.', completed: 'Congratulations — your certificate has been issued.', rejected: 'Thank you for applying. We are unable to offer you a seat this time.', withdrawn: 'This application has been withdrawn.' }[a.status];
      res = `<div class="okmsg"><span class="st">${h(APP_STATUS[a.status])}</span><p style="margin:12px 0 0"><b>${h(a.app_no)}</b> · ${h(a.batch_title)}, starting ${h(longDay(a.start_date))}</p><p style="margin:8px 0 0">${h(next)}</p></div>`;
    }
  } else if (no || url.searchParams.has('phone')) res = '<div class="errmsg" role="alert">Enter your application number and the mobile number you applied with.</div>';
  const body = `<div class="wrap" style="max-width:640px;padding:40px 0 80px"><p class="crumbs"><a href="/">Home</a> / <a href="/academy/">EMS Academy</a> / Application status</p><h1 style="font-size:clamp(30px,4vw,44px)">Check your application</h1>${res}
<form class="lead" method="get" action="/academy/status"><label>Application number<input type="text" name="no" value="${h(no)}" placeholder="EMSA/2026/0001" required maxlength="20"></label><label>Mobile number<input type="tel" name="phone" inputmode="tel" required></label><button class="btn" type="submit">Check <span>↗</span></button></form></div>`;
  const r = page(url, 'Application status | Hasta EMS Academy', '', '/academy/status', body);
  r.headers.set('x-robots-tag', 'noindex');
  return r;
}

/* =============================== staff: admissions =============================== */

async function event(env, appId, action, note, byName) {
  await env.DB.prepare('INSERT INTO ems_academy_events (application_id, action, note, by_name) VALUES (?,?,?,?)').bind(appId, action, nz(clean(note, 500)), byName || null).run();
}
const canAdmit = me => me.role === 'admin' || me.role === 'manager';

// An enrolled application whose training record now has a certificate is complete.
async function syncCompleted(env) {
  const { results } = await env.DB.prepare("SELECT a.id FROM ems_academy_applications a JOIN ems_training_records r ON r.id=a.record_id WHERE a.status='enrolled' AND r.status='certified'").all();
  for (const x of results || []) { await env.DB.prepare("UPDATE ems_academy_applications SET status='completed', updated_at=? WHERE id=?").bind(nowIso(), x.id).run(); await event(env, x.id, 'Certified — course complete', null, 'System'); }
}

const PAID = `COALESCE((SELECT SUM(al.amount) FROM cl_allocations al JOIN cl_payments pay ON pay.id=al.payment_id WHERE al.invoice_id=i.id AND pay.voided=0),0)`;
const invoiceSql = `(SELECT json_object('id', i.id, 'no', i.invoice_no, 'status', i.status, 'total', i.total, 'paid', ${PAID}) FROM cl_invoices i WHERE i.id=a.invoice_id)`;
const invoiceRow = (env, id) => env.DB.prepare(`SELECT i.status, i.total, ${PAID} paid FROM cl_invoices i WHERE i.id=?`).bind(id).first();
function shapeApp(a) {
  const inv = parse(a.invoice, null);
  return { ...a, docs: Object.fromEntries(Object.entries(parse(a.docs, {})).map(([k, v]) => [k, { name: v.name, type: v.type }])), checks: parse(a.checks, {}), invoice: inv,
    paid: !!(inv && inv.status === 'final' && r2(inv.total - inv.paid) <= 0) };
}

export async function overview(env) {
  await syncCompleted(env);
  const [batches, apps, s, machines] = await Promise.all([
    batchesWithSeats(env),
    env.DB.prepare(`SELECT a.id, a.app_no, a.batch_id, a.name, a.phone, a.qualification, a.experience, a.bls, a.status, a.created_at, a.offer_expires, a.invoice_id, a.staff_id, ${invoiceSql} invoice FROM ems_academy_applications a ORDER BY a.id DESC LIMIT 500`).all().then(r => r.results || []),
    settingsOf(env),
    env.DB.prepare('SELECT id, name FROM ems_machine_types WHERE active=1 ORDER BY name').all().then(r => r.results || []),
  ]);
  return { batches, applications: apps.map(shapeApp), default_fee: DEFAULT_FEE, settings: s, machines, statuses: APP_STATUS, quals: QUALS, docs: Object.fromEntries(Object.entries(DOCS).map(([k, [l]]) => [k, l])), checks: CHECKS, offer_checks: OFFER_CHECKS };
}

export async function detail(env, id) {
  const a = await env.DB.prepare(`SELECT a.*, ${invoiceSql} invoice, b.title batch_title, b.code batch_code, b.start_date, b.fee, b.machine_type_id, s.username, p.patient_no, p.name patient_name
    FROM ems_academy_applications a JOIN ems_academy_batches b ON b.id=a.batch_id LEFT JOIN ems_staff s ON s.id=a.staff_id LEFT JOIN cl_patients p ON p.id=a.patient_id WHERE a.id=?`).bind(id).first();
  if (!a) return null;
  const { results: events } = await env.DB.prepare('SELECT * FROM ems_academy_events WHERE application_id=? ORDER BY id').bind(id).all();
  const rec = a.record_id ? await env.DB.prepare('SELECT status FROM ems_training_records WHERE id=?').bind(a.record_id).first() : null;
  return { application: { ...shapeApp(a), record_status: rec ? rec.status : null }, events: events || [] };
}

export async function docFile(env, id, k) {
  const a = await env.DB.prepare('SELECT docs FROM ems_academy_applications WHERE id=?').bind(id).first();
  const d = a && parse(a.docs, {})[k];
  if (!d || !/^academy-apply\//.test(d.key)) return null;
  const obj = await env.CVS.get(d.key);
  return obj ? { obj, d } : null;
}

export async function saveBatch(env, me, id, b) {
  if (!canAdmit(me)) return R(403, 'Only managers and admins can manage batches.');
  const title = clean(b.title, 120), code = clean(b.code, 30).toUpperCase();
  if (!title || !/^[A-Z0-9-]{3,30}$/.test(code)) return R(400, 'Enter a title and a code like EMSA-2026-12.');
  if (!isDate(b.start_date)) return R(400, 'Choose the start date.');
  if (b.end_date && (!isDate(b.end_date) || b.end_date < b.start_date)) return R(400, 'The end date must be after the start date.');
  if (b.apply_by && (!isDate(b.apply_by) || b.apply_by > b.start_date)) return R(400, 'Applications must close on or before the start date.');
  const seats = parseInt(b.seats, 10), fee = r2(b.fee), mt = parseInt(b.machine_type_id, 10) || null;
  if (!(seats >= 1 && seats <= 50)) return R(400, 'Seats must be between 1 and 50.');
  if (!(fee >= 0 && fee <= 500000)) return R(400, 'Enter the course fee before GST.');
  const status = BATCH_STATUS.includes(b.status) ? b.status : 'draft';
  if (status === 'open' && !(fee > 0)) return R(400, 'Set the course fee before opening the batch for applications.');
  if (status === 'open' && !mt) return R(400, 'Choose the machine this batch trains on before opening it.');
  if (mt && !(await env.DB.prepare('SELECT 1 FROM ems_machine_types WHERE id=? AND active=1').bind(mt).first())) return R(400, 'Choose an active machine.');
  const cols = [code, title, mt, b.start_date, nz(b.end_date), nz(clean(b.schedule, 200)), seats, fee, nz(b.apply_by), status, nz(clean(b.notes, 300))];
  try {
    if (id) {
      const old = await env.DB.prepare('SELECT * FROM ems_academy_batches WHERE id=?').bind(id).first();
      if (!old) return R(404, 'Batch not found.');
      const taken = (await env.DB.prepare("SELECT COUNT(*) n FROM ems_academy_applications WHERE batch_id=? AND status IN ('offered','enrolled','completed')").bind(id).first()).n;
      if (seats < taken) return R(400, `${taken} seats are already offered or taken. Seats can’t go below that.`);
      if (fee !== old.fee && taken) return R(400, 'Offers have already been made at the current fee. Create a new batch instead, or cancel those bills first.');
      await env.DB.prepare('UPDATE ems_academy_batches SET code=?, title=?, machine_type_id=?, start_date=?, end_date=?, schedule=?, seats=?, fee=?, apply_by=?, status=?, notes=? WHERE id=?').bind(...cols, id).run();
    } else id = (await env.DB.prepare('INSERT INTO ems_academy_batches (code, title, machine_type_id, start_date, end_date, schedule, seats, fee, apply_by, status, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(...cols, me.id).run()).meta.last_row_id;
  } catch (e) { if (/UNIQUE/i.test(String(e && e.message))) return R(400, 'Another batch already uses that code.'); throw e; }
  await audit(env, me, 'academy.batch', 'academy_batch', id, `${code} ${status} fee ${fee} seats ${seats}`);
  return OK({ id });
}

export async function saveTerms(env, me, b) {
  if (me.role !== 'admin') return R(403, 'Only admins can change the course page terms.');
  const terms = clean(b.terms, 1500), reqs = String(b.requirements || '').split('\n').map(x => clean(x, 240)).filter(Boolean).slice(0, 12).join('\n');
  await env.DB.batch([
    env.DB.prepare("INSERT INTO cl_settings (key, value) VALUES ('academy_terms', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(terms),
    env.DB.prepare("INSERT INTO cl_settings (key, value) VALUES ('academy_requirements', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(reqs || DEFAULT_REQS),
  ]);
  await audit(env, me, 'academy.terms', 'settings', null, 'Academy terms / requirements');
  return OK();
}

const TEMP_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
const tempPassword = () => [...crypto.getRandomValues(new Uint8Array(10))].map(b => TEMP_CHARS[b % TEMP_CHARS.length]).join('');

export async function act(env, me, id, action, b) {
  if (!canAdmit(me)) return R(403, 'Only managers and admins can handle admissions.');
  const a = await env.DB.prepare('SELECT * FROM ems_academy_applications WHERE id=?').bind(id).first();
  if (!a) return R(404, 'Application not found.');
  const batch = await env.DB.prepare('SELECT * FROM ems_academy_batches WHERE id=?').bind(a.batch_id).first();
  const set = async (status, note, extra = {}) => {
    const cols = Object.keys(extra);
    await env.DB.prepare(`UPDATE ems_academy_applications SET status=?, updated_at=?${cols.map(c => `, ${c}=?`).join('')} WHERE id=?`).bind(status, nowIso(), ...cols.map(c => extra[c]), id).run();
    await event(env, id, note, b.note, me.name);
    await audit(env, me, 'academy.' + action, 'academy_application', id, `${a.app_no} → ${status}`);
  };
  const seatsTaken = async () => (await env.DB.prepare("SELECT COUNT(*) n FROM ems_academy_applications WHERE batch_id=? AND status IN ('offered','enrolled','completed') AND id<>?").bind(a.batch_id, id).first()).n;
  const note = clean(b.note, 500);

  if (action === 'note') { if (!note) return R(400, 'Write the note.'); await event(env, id, 'Note', note, me.name); return OK(); }
  if (action === 'checks') {
    const checks = {};
    for (const k of Object.keys(CHECKS)) checks[k] = !!(b.checks && b.checks[k]);
    await env.DB.prepare('UPDATE ems_academy_applications SET checks=?, updated_at=? WHERE id=?').bind(JSON.stringify(checks), nowIso(), id).run();
    await event(env, id, 'Checks updated', Object.entries(checks).filter(([, v]) => v).map(([k]) => CHECKS[k]).join('; ') || 'none ticked', me.name);
    return OK();
  }
  if (action === 'move') {
    const nb = await env.DB.prepare('SELECT * FROM ems_academy_batches WHERE id=?').bind(parseInt(b.batch_id, 10)).first();
    if (!nb || nb.id === a.batch_id || ['completed', 'cancelled'].includes(nb.status)) return R(400, 'Choose another batch that is not finished.');
    if (a.invoice_id || ['enrolled', 'completed'].includes(a.status)) return R(400, 'Move only before the fee bill is made. Withdraw and apply again otherwise.');
    await env.DB.prepare('UPDATE ems_academy_applications SET batch_id=?, updated_at=? WHERE id=?').bind(nb.id, nowIso(), id).run();
    await event(env, id, `Moved to batch ${nb.code}`, note, me.name);
    return OK();
  }
  if (action === 'interview') {
    if (!['submitted', 'waitlisted', 'interview'].includes(a.status)) return R(400, 'Only new or waitlisted applications can go to interview.');
    const at = clean(b.interview_at, 16);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at)) return R(400, 'Choose the interview date and time.');
    await set('interview', `Interview ${at.replace('T', ' ')}`, { interview_at: at });
    return OK();
  }
  if (action === 'waitlist') {
    if (!['submitted', 'interview', 'offered'].includes(a.status)) return R(400, 'This application cannot be waitlisted now.');
    if (a.status === 'offered' && a.invoice_id) await cancelBill(env, me, a.invoice_id);
    await set('waitlisted', 'Waiting list', a.status === 'offered' ? { invoice_id: null } : {});
    return OK();
  }
  if (action === 'reject') {
    if (!['submitted', 'interview', 'waitlisted'].includes(a.status)) return R(400, 'Only applications not yet offered can be declined. Withdraw an offer instead.');
    if (note.length < 5) return R(400, 'Give the reason (kept internal).');
    await set('rejected', 'Not accepted', { reject_reason: note });
    return OK();
  }
  if (action === 'withdraw') {
    if (!ACTIVE.includes(a.status)) return R(400, 'This application is already closed.');
    if (note.length < 5) return R(400, 'Give the reason.');
    let msg = 'Withdrawn';
    if (a.invoice_id) {
      const inv = await invoiceRow(env, a.invoice_id);
      if (inv && inv.status === 'draft') await cancelBill(env, me, a.invoice_id);
      else if (inv && inv.paid > 0) msg += ' — fee paid: decide any refund under the terms and record it in the clinic app';
    }
    if (a.staff_id) await env.DB.batch([env.DB.prepare('UPDATE ems_staff SET active=0 WHERE id=? AND role=\'trainee\'').bind(a.staff_id), env.DB.prepare('DELETE FROM ems_sessions WHERE kind=\'staff\' AND subject_id=?').bind(a.staff_id)]);
    if (a.record_id) await env.DB.prepare("UPDATE ems_training_records SET status='closed' WHERE id=? AND status IN ('in_training','retraining')").bind(a.record_id).run();
    await set('withdrawn', msg);
    return OK();
  }
  if (action === 'offer') {
    if (!['submitted', 'interview', 'waitlisted'].includes(a.status)) return R(400, 'Only new, interviewed or waitlisted applications can be offered a seat.');
    if (!batch || !['open', 'closed'].includes(batch.status)) return R(400, 'The batch must be open or closed to applications (not draft, completed or cancelled).');
    if (!(batch.fee > 0)) return R(400, 'Set the batch fee first.');
    const checks = parse(a.checks, {});
    const missing = OFFER_CHECKS.filter(k => !checks[k]);
    if (missing.length) return R(400, 'Tick these checks first: ' + missing.map(k => CHECKS[k]).join('; ') + '.');
    if (await seatsTaken() >= batch.seats) return R(400, `All ${batch.seats} seats are offered or taken. Waitlist this applicant, or add seats to the batch.`);
    const expires = isDate(b.offer_expires) && b.offer_expires >= today() ? b.offer_expires : null;
    if (!expires) return R(400, 'Choose the date the offer is held until.');
    // Clinic patient record for the GST bill: reuse one with this mobile number only when staff choose it.
    let pid = a.patient_id;
    if (!pid) {
      const { results: same } = await env.DB.prepare("SELECT id, name, patient_no FROM cl_patients WHERE phone=? AND status='active'").bind(a.phone).all();
      if (b.patient_id) { pid = parseInt(b.patient_id, 10); if (!(same || []).some(p => p.id === pid)) return R(400, 'Choose one of the matching records.'); }
      else if ((same || []).length && !b.new_patient) return R(409, 'A clinic patient already uses this mobile number. Choose the same person, or create a new record.', { matches: same });
      else {
        pid = (await env.DB.prepare("INSERT INTO cl_patients (name, phone, email, gender, dob, address, source, notes, created_by) VALUES (?,?,?,?,?,?,'Academy',?,?)")
          .bind(a.name, a.phone, a.email, a.gender, a.dob, a.city, `EMS Academy candidate ${a.app_no}`, me.id).run()).meta.last_row_id;
        await env.DB.prepare('UPDATE cl_patients SET patient_no=? WHERE id=?').bind('HW-' + String(pid).padStart(6, '0'), pid).run();
        await audit(env, me, 'patient.add', 'patient', pid, `${a.name} (Academy ${a.app_no})`);
      }
    }
    const item = await env.DB.prepare('SELECT * FROM cl_items WHERE code=?').bind(ACADEMY_ITEM).first();
    if (!item) return R(500, 'The Academy course-fee item is missing from the clinic catalogue.');
    const label = `EMS Trainer Programme — ${batch.code}, starts ${batch.start_date.split('-').reverse().join('-')}`;
    const r = await createInvoiceWithLines(env, me, pid, [{ item_id: item.id, qty: 1, unit_price: batch.fee, label }], null, { id: me.id, name: me.name });
    if (r[0] !== 200) return r;
    await env.DB.prepare('UPDATE cl_invoices SET notes=? WHERE id=?').bind(`EMS Academy ${a.app_no} — offer made by ${me.name}. Finalise and take payment here; the seat is confirmed once paid.`, r[2].id).run();
    await set('offered', `Offered a seat — fee ${inr(withGst(batch.fee))} incl. GST, held until ${expires}`, { patient_id: pid, invoice_id: r[2].id, offer_expires: expires });
    return OK({ invoice_id: r[2].id, total: withGst(batch.fee) });
  }
  if (action === 'enrol') {
    if (a.status !== 'offered') return R(400, 'Only an offered applicant can be enrolled.');
    const inv = a.invoice_id ? await invoiceRow(env, a.invoice_id) : null;
    const paid = inv && inv.status === 'final' && r2(inv.total - inv.paid) <= 0;
    const waive = clean(b.waive_reason, 200);
    if (!paid) {
      if (!waive) return R(400, 'The course-fee bill is not fully paid yet. Take the payment in the clinic app (Billing) first.');
      if (me.role !== 'admin') return R(403, 'Only an admin can enrol before the fee is paid.');
      if (waive.length < 10) return R(400, 'Explain why enrolment goes ahead before payment.');
    }
    if (await seatsTaken() >= batch.seats) return R(400, 'The batch is full.');
    // Trainee login: Academy only, no unit, no clinic app.
    const base = a.name.toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '').slice(0, 10) || 'trainee';
    let username = null;
    for (let i = 0; i < 20 && !username; i++) { const u = `${base}${i ? i + 1 : ''}.t`; if (!(await env.DB.prepare('SELECT 1 FROM ems_staff WHERE username=?').bind(u).first())) username = u; }
    if (!username) return R(500, 'Could not make a username.');
    const pw = tempPassword();
    const sid = (await env.DB.prepare("INSERT INTO ems_staff (name, username, role, pass_hash, skills, apps, reg_no) VALUES (?,?,'trainee',?,'[\"trainer\"]','[\"ems\"]',?)").bind(a.name, username, await hashSecret(pw), nz(a.registration_no)).run()).meta.last_row_id;
    let recordId = null, recNote = '';
    const cur = await approvedCurriculum(env);
    if (cur && batch.machine_type_id) recordId = (await env.DB.prepare("INSERT INTO ems_training_records (staff_id, machine_type_id, curriculum_id, kind, opened_by) VALUES (?,?,?,'initial',?)").bind(sid, batch.machine_type_id, cur.id, me.id).run()).meta.last_row_id;
    else recNote = cur ? ' — training record not opened: the batch has no machine' : ' — training record opens when the medical lead approves the curriculum';
    await set('enrolled', `Enrolled — login ${username}${paid ? '' : `; fee not yet paid (admin: ${waive})`}${recNote}`, { staff_id: sid, record_id: recordId, fee_waived_reason: paid ? null : waive });
    return OK({ username, password: pw, phone: a.phone, name: a.name, record: !!recordId });
  }
  if (action === 'open-record') {
    if (a.status !== 'enrolled' || !a.staff_id || a.record_id) return R(400, 'Nothing to open.');
    const cur = await approvedCurriculum(env);
    if (!cur) return R(400, 'The medical lead must approve the curriculum first.');
    if (!batch.machine_type_id) return R(400, 'Set the batch machine first.');
    const rid = (await env.DB.prepare("INSERT INTO ems_training_records (staff_id, machine_type_id, curriculum_id, kind, opened_by) VALUES (?,?,?,'initial',?)").bind(a.staff_id, batch.machine_type_id, cur.id, me.id).run()).meta.last_row_id;
    await env.DB.prepare('UPDATE ems_academy_applications SET record_id=? WHERE id=?').bind(rid, id).run();
    await event(env, id, 'Training record opened', null, me.name);
    return OK();
  }
  if (action === 'reset-password') {
    if (!a.staff_id || a.status !== 'enrolled') return R(400, 'Only enrolled trainees have a login.');
    const pw = tempPassword();
    await env.DB.prepare("UPDATE ems_staff SET pass_hash=? WHERE id=? AND role='trainee'").bind(await hashSecret(pw), a.staff_id).run();
    const u = await env.DB.prepare('SELECT username FROM ems_staff WHERE id=?').bind(a.staff_id).first();
    await event(env, id, 'Password reset', null, me.name);
    return OK({ username: u.username, password: pw, phone: a.phone, name: a.name });
  }
  return R(400, 'Unknown action.');
}

async function cancelBill(env, me, invoiceId) {
  const inv = await env.DB.prepare('SELECT status FROM cl_invoices WHERE id=?').bind(invoiceId).first();
  if (inv && inv.status === 'draft') {
    await env.DB.batch([env.DB.prepare('DELETE FROM cl_invoice_lines WHERE invoice_id=?').bind(invoiceId), env.DB.prepare('DELETE FROM cl_invoices WHERE id=?').bind(invoiceId)]);
    await audit(env, me, 'invoice.delete_draft', 'invoice', invoiceId, 'Academy offer withdrawn');
  }
}

/* =============================== trainee: my course =============================== */

export async function myCourse(env, me) {
  const [app, cur, records, certs] = await Promise.all([
    env.DB.prepare('SELECT a.app_no, a.status, b.title, b.code, b.start_date, b.end_date, b.schedule, m.name machine_name FROM ems_academy_applications a JOIN ems_academy_batches b ON b.id=a.batch_id LEFT JOIN ems_machine_types m ON m.id=b.machine_type_id WHERE a.staff_id=? ORDER BY a.id DESC LIMIT 1').bind(me.id).first(),
    approvedCurriculum(env),
    listRecords(env, me, false),
    env.DB.prepare("SELECT c.id, c.code, c.issued_on, c.valid_until, c.status, m.name machine_name FROM ems_certifications c JOIN ems_machine_types m ON m.id=c.machine_type_id WHERE c.staff_id=? AND c.code IS NOT NULL ORDER BY c.id DESC").bind(me.id).all().then(r => r.results || []),
  ]);
  const materials = cur ? ((await env.DB.prepare('SELECT id, module_no, title, kind, url, file_key, file_name, source FROM ems_materials WHERE curriculum_id=? ORDER BY module_no, id').bind(cur.id).all()).results || []) : [];
  return { me: { id: me.id, name: me.name }, application: app, curriculum: cur ? { version: cur.version, modules: parse(cur.modules, []) } : null, materials, records, certificates: certs, rules: RULES };
}
// Files a trainee may open: materials of the approved curriculum only.
export async function traineeMayOpen(env, key) {
  return !!(await env.DB.prepare("SELECT 1 FROM ems_materials m JOIN ems_curriculum c ON c.id=m.curriculum_id AND c.status='approved' WHERE m.file_key=?").bind(key).first());
}

// Privacy: documents of applicants who never got a seat are deleted after 180 days (daily cron).
export async function purgeAcademyDocs(env) {
  const { results } = await env.DB.prepare("SELECT id, docs FROM ems_academy_applications WHERE status IN ('rejected','withdrawn','waitlisted','submitted','interview') AND staff_id IS NULL AND docs <> '{}' AND created_at < strftime('%Y-%m-%dT%H:%M:%SZ','now','-180 days')").all();
  for (const a of results || []) {
    for (const d of Object.values(parse(a.docs, {}))) if (d && d.key && env.CVS) await env.CVS.delete(d.key);
    await env.DB.prepare("UPDATE ems_academy_applications SET docs='{}' WHERE id=?").bind(a.id).run();
    await event(env, a.id, 'Documents deleted (180-day privacy rule)', null, 'System');
  }
}
