// Careers: public job listings + applications, and admin screens to manage them.
//
//   GET  /careers/              list of published vacancies
//   GET  /careers/<slug>/       job detail + application form (JobPosting schema for Google Jobs)
//   POST /careers/apply         application (multipart, optional CV to R2)
//   GET  /admin/jobs            manage vacancies (drafts / published / closed)
//   GET  /admin/jobs/new?template=dental-doctor   new job from a template
//   GET  /admin/jobs/<id>       edit;  POST same path to save / publish / close / delete
//   GET  /admin/applications    applications (filter by job / status)
//   GET  /admin/cv/<id>         download an applicant's CV

import { authorised, authResponse, adminHeaders, sameOrigin, clean, nz, normalisePhone, h, sha256, adminShell, ist, waLink, notify } from './util.js';
import { NAV_LINKS } from './site_nav.js';

const PHONE_DISPLAY = '+91 97784 58883';
const PHONE_TEL = '+919778458883';
const JOB_STATUSES = ['draft', 'published', 'closed'];
const APP_STATUSES = ['new', 'shortlisted', 'interviewed', 'hired', 'rejected'];
const EMPLOYMENT_TYPES = { FULL_TIME: 'Full-time', PART_TIME: 'Part-time', CONTRACTOR: 'Visiting / consultant', TEMPORARY: 'Temporary', INTERN: 'Internship' };
const APP_RETENTION_DAYS = 180;
const CV_MAX = 5 * 1024 * 1024;
const CV_TYPES = {
  pdf: { mime: 'application/pdf', sig: [0x25, 0x50, 0x44, 0x46] },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sig: [0x50, 0x4b, 0x03, 0x04] },
  doc: { mime: 'application/msword', sig: [0xd0, 0xcf, 0x11, 0xe0] },
};

/* ---------------- Templates (editable starting points) ---------------- */

export const TEMPLATES = {
  'dental-doctor': {
    title: 'Dental Surgeon (BDS / MDS)', department: 'Dental', employment_type: 'FULL_TIME',
    experience: '1+ years in clinical practice preferred; confident freshers considered',
    qualifications: 'BDS (MDS desirable)\nValid registration with the Kerala State Dental Council',
    summary: 'Join the Smile Forward dental team at Hasta Wellness, Technopark Phase 3, Kazhakkoottam. You will provide consultation-led general and cosmetic dental care in a calm, patient-first clinic that also offers skin, hair and wellness services.',
    responsibilities: 'Examine, diagnose and explain findings clearly to patients\nPrepare treatment plans with written, itemised estimates\nCarry out general dental procedures within your competence (scaling, restorations, endodontics and similar)\nAssess patients for clear aligners and smile corrections with the team\nMaintain accurate records, consent and infection-control standards\nWork with front office to manage reviews and follow-ups',
    requirements: 'Current dental council registration\nGood communication in English and Malayalam\nA patient-first, unhurried consultation style\nAvailability for evening and weekend shifts on a rota',
    benefits: 'Modern clinic close to Technopark\nMulti-specialty team: dental, skin, hair and wellness\nSupport for continuing professional development\nWeekly off as per rota',
  },
  'cosmetologist': {
    title: 'Cosmetologist', department: 'Skin & Aesthetics', employment_type: 'FULL_TIME',
    experience: '1–3 years in a skin or aesthetic clinic preferred',
    qualifications: 'Recognised qualification in cosmetology or aesthetic medicine\nCertification in laser hair reduction and skin procedures desirable',
    summary: 'We are looking for a cosmetologist to support our Skin Comfort, Skin Edits and Laser Edit programmes at Hasta Wellness, Kazhakkoottam. You will help clients understand their options and deliver treatments safely, within protocols and your scope of practice.',
    responsibilities: 'Support skin consultations and explain suitable options honestly\nPerform laser hair reduction and skin procedures within protocols and your scope\nCarry out patch tests and give clear aftercare advice\nKeep treatment records and, with consent, clinical photographs\nMaintain device logs, hygiene and room readiness\nFollow up with clients on reviews and home-care routines',
    requirements: 'Hands-on experience with Indian skin types\nKnowledge of laser safety and contraindications\nGood communication in English and Malayalam\nWarm, non-judgemental approach to clients',
    benefits: 'Work with modern devices in a calm clinic\nTraining on clinic protocols and new treatments\nCollaborative team with dental and hair specialists\nWeekly off as per rota',
  },
  'nursing-assistant': {
    title: 'Nursing Assistant', department: 'Clinical support', employment_type: 'FULL_TIME',
    experience: 'Freshers and experienced candidates welcome',
    qualifications: 'ANM / GNM or a recognised nursing assistant certificate\nBasic Life Support (BLS) certification desirable',
    summary: 'Help our clinicians deliver safe, comfortable care across dental, skin, hair and wellness services at Hasta Wellness, Technopark Phase 3, Kazhakkoottam.',
    responsibilities: 'Prepare treatment rooms and instruments before each appointment\nSterilise instruments and follow infection-control procedures\nAssist dentists and clinicians chairside\nRecord basic vitals and help clients feel at ease\nManage consumables and inform the team when stock is low\nKeep work areas clean, safe and organised',
    requirements: 'Understanding of sterilisation and hygiene standards\nCaring, calm and dependable\nGood communication in Malayalam; basic English\nAble to work shifts on a rota',
    benefits: 'On-the-job training across specialties\nFriendly, supportive team\nWeekly off as per rota',
  },
  'front-office-executive': {
    title: 'Front Office Executive', department: 'Front office', employment_type: 'FULL_TIME',
    experience: '1+ years in reception or front office, healthcare preferred',
    qualifications: 'Graduate in any discipline',
    summary: 'Be the first friendly face and voice of Hasta Wellness. You will welcome clients, manage appointments and enquiries, and make every visit to our Kazhakkoottam clinic feel organised and personal.',
    responsibilities: 'Welcome clients and manage the reception area\nHandle calls, WhatsApp and website enquiries promptly\nSchedule and confirm appointments with clinicians\nFollow up website leads and record outcomes\nManage billing, payments and daily reports\nKeep client records accurate and confidential',
    requirements: 'Fluent English and Malayalam (Hindi or Tamil is a plus)\nComfortable with computers, WhatsApp Business and spreadsheets\nWell-organised, polite and calm under pressure\nAble to work evening and weekend shifts on a rota',
    benefits: 'Customer-facing role in a growing clinic\nTraining on clinic systems\nWeekly off as per rota',
  },
};
const TEMPLATE_LABELS = { 'dental-doctor': 'Dental Doctor', 'cosmetologist': 'Cosmetologist', 'nursing-assistant': 'Nursing Assistant', 'front-office-executive': 'Front Office Executive', blank: 'Blank job' };

/* ---------------- Public pages ---------------- */

const lines = t => String(t || '').split('\n').map(s => s.trim()).filter(Boolean);
const ul = t => { const l = lines(t); return l.length ? `<ul>${l.map(x => `<li>${h(x)}</li>`).join('')}</ul>` : ''; };
const today = () => new Date().toISOString().slice(0, 10);
const isOpen = j => j.status === 'published' && (!j.closing_date || j.closing_date >= today());

function chrome(origin, title, desc, path, body, ld = []) {
  const nav = NAV_LINKS.map(([p, l]) => `<a href="${p}">${h(l)}</a>`).join('');
  const ig = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.4" cy="6.6" r="1" fill="currentColor" stroke="none"/></svg>';
  return `<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${h(title)}</title><meta name="description" content="${h(desc)}">
<link rel="canonical" href="${origin}${path}"><meta name="robots" content="index,follow"><meta name="theme-color" content="#34595e">
<meta property="og:type" content="website"><meta property="og:site_name" content="Hasta Wellness"><meta property="og:title" content="${h(title)}"><meta property="og:description" content="${h(desc)}">
<meta property="og:url" content="${origin}${path}"><meta property="og:image" content="${origin}/img/og-hasta-wellness.jpg"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.ico" sizes="48x48"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&amp;family=Manrope:wght@400;500;600;700&amp;display=swap">
<link rel="stylesheet" href="/assets/service.css">
${ld.map(x => `<script type="application/ld+json">${JSON.stringify(x).replace(/</g, '\\u003c')}</script>`).join('')}
<style>.jobs{display:grid;gap:16px}.job{display:grid;grid-template-columns:1fr auto;gap:16px;align-items:center;padding:24px;border:1px solid var(--line);border-left:2px solid var(--gold);border-radius:8px;text-decoration:none}.job:hover{border-color:var(--gold)}.job h3{font-size:22px;margin:0 0 6px}.job p{margin:0;color:var(--muted);font-size:14px}.meta{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:13px;color:var(--muted);margin:10px 0 0}.meta span:before{content:'·';margin-right:8px;color:var(--gold)}.meta span:first-child:before{content:none}
.jd{display:grid;grid-template-columns:1.2fr .8fr;gap:56px;align-items:start}.jd h2{font-size:24px;margin:34px 0 10px}.jd ul{padding-left:20px;margin:0}.jd li{margin:6px 0;color:#3f5f62}.jd p{color:var(--muted)}
.apply{position:sticky;top:100px}form.lead input[type=email],form.lead input[type=file],form.lead textarea{width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:6px;font:inherit;font-size:15px;color:var(--green);background:#fff}form.lead textarea{min-height:90px;resize:vertical}
.okmsg{padding:22px;border-left:2px solid var(--gold);background:var(--soft);margin-bottom:20px}.errmsg{padding:14px;border-left:2px solid #a0442f;background:#fbefeb;margin-bottom:14px;color:#7a3322}
@media(max-width:900px){.jd{grid-template-columns:1fr}.apply{position:static}.job{grid-template-columns:1fr}}</style>
</head><body>
<div class="top">YOUR EVERYDAY WELLNESS, BEAUTIFULLY REIMAGINED · KAZHAKOOTTAM, TRIVANDRUM</div>
<header class="site"><nav class="wrap"><a class="logo" href="/" aria-label="Hasta Wellness home"><img src="/img/hasta-wellness-logo.webp" alt="Hasta Wellness" width="185" height="66"></a>
<div class="navlinks"><a href="/#care">Find your care</a><a href="/#programmes">All programmes</a><a href="/careers/">Careers</a><a href="/#visit">Visit us</a></div>
<a class="btn" href="/#visit">Book a consultation <span>↗</span></a></nav></header>
<main>${body}</main>
<footer class="site"><div class="wrap"><div class="row">
<div><a href="/"><img src="/img/hasta-wellness-logo.webp" alt="Hasta Wellness" width="170" height="61" loading="lazy"></a>
<p>Dental · Skin · Hair | Kazhakkoottam, Trivandrum<br>Mon – Sat 10 am – 8 pm · Sun 10 am – 2 pm<br><a href="tel:${PHONE_TEL}">${PHONE_DISPLAY}</a></p>
<a class="social" href="https://www.instagram.com/hasta_wellness/" target="_blank" rel="noopener" aria-label="Hasta Wellness on Instagram (opens in a new tab)">${ig}<span>@hasta_wellness</span></a></div>
<nav aria-label="Site">${nav}</nav></div>
<div class="fine"><span>© ${new Date().getFullYear()} Hasta Wellness. All rights reserved. A venture of HASWEL CARE Private Limited.</span><span>Equal-opportunity employer.</span></div></div></footer>
<div class="mobilebar"><a href="tel:${PHONE_TEL}">Call clinic ↗</a><a class="primary" href="/careers/">Open roles ↗</a></div>
</body></html>`;
}

function htmlResponse(url, html, status = 200) {
  const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', 'x-frame-options': 'SAMEORIGIN' };
  if (/\.workers\.dev$|^localhost|^127\./.test(url.hostname)) headers['x-robots-tag'] = 'noindex, nofollow';
  return new Response(html, { status, headers });
}

function jobMeta(j) {
  return `<div class="meta"><span>${h(j.department || 'Hasta Wellness')}</span><span>${h(EMPLOYMENT_TYPES[j.employment_type] || 'Full-time')}</span><span>${h(j.location)}</span>${j.experience ? `<span>${h(j.experience)}</span>` : ''}${j.salary_text ? `<span>${h(j.salary_text)}</span>` : ''}</div>`;
}

function jobPostingLd(j, origin) {
  const desc = `<p>${h(j.summary || '')}</p>` +
    (j.responsibilities ? `<p><strong>Responsibilities</strong></p>${ul(j.responsibilities)}` : '') +
    (j.qualifications ? `<p><strong>Qualifications</strong></p>${ul(j.qualifications)}` : '') +
    (j.requirements ? `<p><strong>Requirements</strong></p>${ul(j.requirements)}` : '') +
    (j.benefits ? `<p><strong>Benefits</strong></p>${ul(j.benefits)}` : '');
  const posted = (j.published_at || j.created_at || '').slice(0, 10) || today();
  const valid = j.closing_date || new Date(Date.parse(posted) + 60 * 864e5).toISOString().slice(0, 10);
  const ld = {
    '@context': 'https://schema.org', '@type': 'JobPosting', title: j.title, description: desc,
    identifier: { '@type': 'PropertyValue', name: 'Hasta Wellness', value: String(j.id) },
    datePosted: posted, validThrough: `${valid}T23:59:59+05:30`, employmentType: j.employment_type || 'FULL_TIME',
    hiringOrganization: { '@type': 'Organization', name: 'Hasta Wellness (HASWEL CARE Private Limited)', sameAs: origin + '/', logo: origin + '/img/hasta-wellness-logo.jpg' },
    jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', streetAddress: '1st floor, Anjali Arcade, Near Nippon Toyota, Technopark Phase 3 Service Road', addressLocality: 'Kazhakkoottam, Thiruvananthapuram', addressRegion: 'Kerala', postalCode: '695583', addressCountry: 'IN' } },
    directApply: true, url: `${origin}/careers/${j.slug}/`,
  };
  if (j.openings) ld.totalJobOpenings = j.openings;
  if (j.experience) ld.experienceRequirements = j.experience;
  if (j.qualifications) ld.qualifications = lines(j.qualifications).join('; ');
  if (j.salary_min || j.salary_max) {
    ld.baseSalary = { '@type': 'MonetaryAmount', currency: 'INR', value: { '@type': 'QuantitativeValue', unitText: 'MONTH' } };
    if (j.salary_min) ld.baseSalary.value.minValue = j.salary_min;
    if (j.salary_max) ld.baseSalary.value.maxValue = j.salary_max;
  }
  return ld;
}

export async function handleCareers(request, env, url) {
  const path = url.pathname;
  if (path === '/careers') return Response.redirect(new URL('/careers/', url).toString(), 301);
  if (path === '/careers/') {
    const { results } = await env.DB.prepare("SELECT * FROM jobs WHERE status='published' AND (closing_date IS NULL OR closing_date >= ?) ORDER BY published_at DESC, id DESC").bind(today()).all();
    const list = (results || []).map(j => `<a class="job" href="/careers/${h(j.slug)}/"><div><h3>${h(j.title)}</h3><p>${h((j.summary || '').slice(0, 170))}${(j.summary || '').length > 170 ? '…' : ''}</p>${jobMeta(j)}</div><span class="btn light">View &amp; apply <span>↗</span></span></a>`).join('');
    const body = `<div class="wrap"><p class="crumbs"><a href="/">Home</a> / Careers</p>
<div class="hero" style="grid-template-columns:1fr;padding-bottom:40px"><div><div class="eyebrow">JOIN US · CAREERS AT HASTA WELLNESS</div>
<h1>Grow with a clinic that <em>puts people first.</em></h1>
<p>Hasta Wellness brings dental, skin, hair and signature wellness care together near Technopark Phase 3, Kazhakkoottam. We’re building a calm, consultation-led clinic — and a team that listens to clients and to each other.</p>
<p>Hasta Wellness is a venture of HASWEL CARE Private Limited.</p></div></div></div>
<section class="block"><div class="wrap"><div class="eyebrow">OPEN ROLES</div><h2>Current vacancies</h2>
<div class="jobs">${list || `<p class="empty" style="padding:26px;border:1px dashed var(--line);border-radius:8px;color:var(--muted)">There are no open vacancies right now. You’re welcome to send your CV for future roles by WhatsApp to <a href="https://wa.me/919778458883">${PHONE_DISPLAY}</a>.</p>`}</div></div></section>
<section class="block"><div class="wrap note"><div><div class="eyebrow">WORKING HERE</div><h2>What we value</h2></div><div>
<p><strong>Honest care.</strong> We explain options clearly, give written costs and never push treatment.</p>
<p><strong>Respect.</strong> For clients, colleagues and every role in the clinic — front office to clinicians.</p>
<p><strong>Learning.</strong> Training on clinic protocols and support to keep growing in your field.</p></div></div></section>`;
    return htmlResponse(url, chrome(url.origin, 'Careers at Hasta Wellness – Jobs in Kazhakkoottam, Trivandrum', 'Join Hasta Wellness near Technopark, Kazhakkoottam. Open roles for dental surgeons, cosmetologists, nursing assistants and front office executives.', '/careers/', body));
  }
  const m = path.match(/^\/careers\/([a-z0-9-]+)\/?$/);
  if (!m) return htmlResponse(url, chrome(url.origin, 'Page not found | Hasta Wellness', '', path, '<div class="wrap" style="padding:80px 0"><h1>Page not found</h1><p><a href="/careers/">See current vacancies</a></p></div>'), 404);
  if (!path.endsWith('/')) return Response.redirect(new URL(path + '/', url).toString(), 301);
  const j = await env.DB.prepare('SELECT * FROM jobs WHERE slug = ?').bind(m[1]).first();
  if (!j || j.status === 'draft') return htmlResponse(url, chrome(url.origin, 'Vacancy not found | Hasta Wellness', '', path, '<div class="wrap" style="padding:80px 0"><h1>This vacancy isn’t available.</h1><p><a class="btn" href="/careers/">See current vacancies</a></p></div>'), 404);
  const open = isOpen(j);
  const applied = url.searchParams.get('applied') === '1';
  const err = url.searchParams.get('error');
  const form = !open ? `<div class="okmsg"><strong>This vacancy is now closed.</strong><p style="margin:8px 0 0">See <a href="/careers/">current vacancies</a>.</p></div>`
    : applied ? `<div class="okmsg" role="status"><strong>Thank you — your application has been received.</strong><p style="margin:8px 0 0">The team will review it and contact shortlisted candidates by phone or WhatsApp.</p></div>`
    : `${err ? `<div class="errmsg" role="alert">${h(err)}</div>` : ''}<form class="lead" method="post" action="/careers/apply" enctype="multipart/form-data">
<input type="hidden" name="job" value="${h(j.slug)}">
<label>Full name<input type="text" name="name" autocomplete="name" required maxlength="80"></label>
<label>Mobile number<input type="tel" name="phone" autocomplete="tel" inputmode="tel" required pattern="[0-9+ \\(\\)\\-]{10,20}"></label>
<label>Email (optional)<input type="email" name="email" autocomplete="email" maxlength="120"></label>
<label>Highest qualification<input type="text" name="qualification" required maxlength="120"></label>
<label>Years of experience<input type="text" name="experience_years" maxlength="40" placeholder="e.g. 2 years, or Fresher"></label>
<label>Current location<input type="text" name="current_location" maxlength="80"></label>
<label>Notice period<input type="text" name="notice_period" maxlength="40" placeholder="e.g. Immediate, 30 days"></label>
<label>Anything you’d like us to know (optional)<textarea name="message" maxlength="1000"></textarea></label>
<label>CV / résumé (PDF or Word, up to 5 MB)<input type="file" name="cv" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"></label>
<label class="hp" aria-hidden="true">Company<input type="text" name="company" tabindex="-1" autocomplete="off"></label>
<label class="consent"><input type="checkbox" name="consent" value="yes" required><span>I agree that HASWEL CARE Private Limited (Hasta Wellness) may store my application and CV to assess me for this and similar roles. Applications are deleted after ${APP_RETENTION_DAYS} days unless I’m hired. <a href="/privacy/">Privacy notice</a></span></label>
<button class="btn" type="submit">Submit application <span>↗</span></button>
<small style="color:var(--muted);font-size:12px">Please don’t include Aadhaar, PAN, bank details or other ID numbers in your CV or message.</small></form>`;
  const body = `<div class="wrap"><p class="crumbs"><a href="/">Home</a> / <a href="/careers/">Careers</a> / ${h(j.title)}</p>
<div style="padding:30px 0 10px"><div class="eyebrow">${open ? 'NOW HIRING' : 'VACANCY CLOSED'} · ${h(j.department || 'HASTA WELLNESS')}</div><h1 style="font-size:clamp(34px,4.6vw,52px);margin:16px 0 8px">${h(j.title)}</h1>${jobMeta(j)}${j.closing_date && open ? `<p class="muted" style="font-size:13px;color:var(--muted)">Apply by ${h(ist(j.closing_date + 'T12:00:00Z', false))}</p>` : ''}</div></div>
<section class="block" style="border-top:0;padding-top:20px"><div class="wrap jd"><div>
<p style="font-size:17px">${h(j.summary || '')}</p>
${j.responsibilities ? `<h2>What you’ll do</h2>${ul(j.responsibilities)}` : ''}
${j.qualifications ? `<h2>Qualifications</h2>${ul(j.qualifications)}` : ''}
${j.requirements ? `<h2>What we’re looking for</h2>${ul(j.requirements)}` : ''}
${j.benefits ? `<h2>What we offer</h2>${ul(j.benefits)}` : ''}
<h2>Where you’ll work</h2><p>Hasta Wellness, 1st floor, Anjali Arcade, near Nippon Toyota, Technopark Phase 3 Service Road, Kazhakkoottam, Thiruvananthapuram 695583. Clinic hours: Monday–Saturday 10 am–8 pm, Sunday 10 am–2 pm (shifts on a rota).</p>
</div><div class="apply" id="apply"><div class="eyebrow">APPLY</div><h2 style="margin-top:12px">Apply for this role</h2>${form}</div></div></section>`;
  const ld = open ? [jobPostingLd(j, url.origin)] : [];
  return htmlResponse(url, chrome(url.origin, `${j.title} – Job in Kazhakkoottam, Trivandrum | Hasta Wellness`, `${j.title} vacancy at Hasta Wellness near Technopark, Kazhakkoottam. ${(j.summary || '').slice(0, 100)}`, `/careers/${j.slug}/`, body, ld));
}

export async function careerSitemapPaths(env) {
  const { results } = await env.DB.prepare("SELECT slug FROM jobs WHERE status='published' AND (closing_date IS NULL OR closing_date >= ?)").bind(today()).all();
  return ['/careers/'].concat((results || []).map(r => `/careers/${r.slug}/`));
}

/* ---------------- Applications ---------------- */

export async function handleApply(request, env, url, ctx) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!sameOrigin(request)) return new Response('Forbidden', { status: 403 });
  const len = parseInt(request.headers.get('content-length') || '0', 10);
  if (len > CV_MAX + 64 * 1024) return backTo(url, null, 'Your CV is larger than 5 MB. Please upload a smaller file.');
  let form;
  try { form = await request.formData(); } catch { return backTo(url, null, 'Something went wrong. Please try again.'); }
  const slug = String(form.get('job') || '');
  const job = /^[a-z0-9-]{1,80}$/.test(slug) ? await env.DB.prepare('SELECT * FROM jobs WHERE slug = ?').bind(slug).first() : null;
  if (!job || !isOpen(job)) return Response.redirect(new URL('/careers/', url).toString(), 303);
  if (form.get('company')) return backTo(url, slug, null, true); // honeypot
  if (form.get('consent') !== 'yes') return backTo(url, slug, 'Please tick the consent box to apply.');
  const name = clean(form.get('name'), 80), phone = normalisePhone(form.get('phone'));
  const email = clean(form.get('email'), 120);
  if (name.length < 2) return backTo(url, slug, 'Please enter your name.');
  if (!phone) return backTo(url, slug, 'Please enter a valid mobile number.');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return backTo(url, slug, 'Please check your email address.');

  const ip = request.headers.get('cf-connecting-ip') || '';
  const ipHash = ip ? (await sha256(`hasta-careers:${today()}:${ip}`)).slice(0, 24) : null;
  if (ipHash) {
    const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM applications WHERE ip_hash = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 hour')").bind(ipHash).first();
    if (r && r.n >= 5) return backTo(url, slug, 'Too many applications from this connection. Please try again later or WhatsApp us.');
  }

  let cvKey = null, cvName = null;
  const cv = form.get('cv');
  if (cv && typeof cv === 'object' && cv.size > 0) {
    if (cv.size > CV_MAX) return backTo(url, slug, 'Your CV is larger than 5 MB. Please upload a smaller file.');
    const ext = (String(cv.name || '').toLowerCase().match(/\.(pdf|docx|doc)$/) || [])[1];
    const buf = new Uint8Array(await cv.arrayBuffer());
    const type = ext && CV_TYPES[ext];
    if (!type || !type.sig.every((b, i) => buf[i] === b)) return backTo(url, slug, 'Please upload your CV as a PDF or Word document.');
    if (!env.CVS) return backTo(url, slug, 'CV upload is unavailable right now. Please apply without a CV and WhatsApp it to us.');
    cvKey = `cv/${today().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
    cvName = clean(String(cv.name).replace(/[^\w.\- ]/g, '_'), 100) || `cv.${ext}`;
    await env.CVS.put(cvKey, buf, { httpMetadata: { contentType: type.mime } });
  }

  await env.DB.prepare(`INSERT INTO applications (job_id, job_title, name, phone, email, qualification, experience_years, current_location, notice_period, message, cv_key, cv_name, ip_hash)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    job.id, job.title, name, phone, nz(email), nz(clean(form.get('qualification'), 120)), nz(clean(form.get('experience_years'), 40)),
    nz(clean(form.get('current_location'), 80)), nz(clean(form.get('notice_period'), 40)), nz(clean(form.get('message'), 1000)), cvKey, cvName, ipHash
  ).run();
  const alert = notify(env, `New job application: ${job.title}`, [
    ['Role', job.title], ['Name', name], ['Mobile', phone], ['Email', email], ['Qualification', clean(form.get('qualification'), 120)],
    ['Experience', clean(form.get('experience_years'), 40)], ['Location', clean(form.get('current_location'), 80)],
    ['Notice period', clean(form.get('notice_period'), 40)], ['CV attached', cvKey ? 'Yes — download from admin' : 'No'],
  ], `/admin/applications?job=${job.id}`, url.origin);
  if (ctx && ctx.waitUntil) ctx.waitUntil(alert); else await alert;
  return backTo(url, slug, null, true);
}

function backTo(url, slug, error, ok) {
  const u = new URL(slug ? `/careers/${slug}/` : '/careers/', url);
  if (ok) u.searchParams.set('applied', '1');
  if (error) u.searchParams.set('error', error);
  u.hash = 'apply';
  return Response.redirect(u.toString(), 303);
}

export async function purgeOldApplications(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, cv_key FROM applications WHERE status != 'hired' AND created_at < strftime('%Y-%m-%dT%H:%M:%SZ','now', ?)"
  ).bind(`-${APP_RETENTION_DAYS} days`).all();
  for (const r of results || []) {
    if (r.cv_key && env.CVS) await env.CVS.delete(r.cv_key);
    await env.DB.prepare('DELETE FROM applications WHERE id = ?').bind(r.id).run();
  }
  console.log('Application retention clean-up removed', (results || []).length, 'rows');
}

/* ---------------- Admin: jobs ---------------- */

function slugify(t) {
  return String(t || 'job').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'job';
}

async function uniqueSlug(env, base, id) {
  let slug = base, n = 2;
  while (await env.DB.prepare('SELECT id FROM jobs WHERE slug = ? AND id != ?').bind(slug, id || 0).first()) slug = `${base}-${n++}`;
  return slug;
}

function jobForm(j, isNew, flash) {
  const opt = (list, cur) => Object.entries(list).map(([k, v]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${h(v)}</option>`).join('');
  const ta = (name, label, hint) => `<label>${label}${hint ? ` <small>${hint}</small>` : ''}<textarea name="${name}">${h(j[name] || '')}</textarea></label>`;
  const action = isNew ? '/admin/jobs/new' : `/admin/jobs/${j.id}`;
  const publicUrl = `/careers/${j.slug}/`;
  return `${flash ? `<div class="flash">${h(flash)}</div>` : ''}
<div class="bar"><h2 style="margin:0;font-size:20px">${isNew ? 'New vacancy' : 'Edit vacancy'}</h2>${!isNew ? `<span class="pill ${h(j.status)}">${h(j.status)}</span>` : ''}</div>
${!isNew && j.status !== 'draft' ? `<p class="muted">Public page: <a href="${publicUrl}" target="_blank" rel="noopener">${h(publicUrl)}</a></p>` : ''}
<form class="edit" method="post" action="${action}">
<label>Job title<input name="title" required maxlength="100" value="${h(j.title || '')}"></label>
<div class="grid">
<label>Department<input name="department" maxlength="60" value="${h(j.department || '')}"></label>
<label>Employment type<select name="employment_type">${opt(EMPLOYMENT_TYPES, j.employment_type || 'FULL_TIME')}</select></label>
<label>Number of openings<input name="openings" type="number" min="1" max="50" value="${h(j.openings || 1)}"></label>
<label>Closing date <small>(optional)</small><input name="closing_date" type="date" value="${h(j.closing_date || '')}"></label>
</div>
<label>Location<input name="location" maxlength="100" value="${h(j.location || 'Kazhakkoottam, Thiruvananthapuram')}"></label>
<label>Experience<input name="experience" maxlength="160" value="${h(j.experience || '')}"></label>
<div class="grid">
<label>Salary shown to applicants <small>(optional text, e.g. "As per experience")</small><input name="salary_text" maxlength="80" value="${h(j.salary_text || '')}"></label>
<label>Salary min ₹/month <small>(optional, for Google Jobs)</small><input name="salary_min" type="number" min="0" step="500" value="${h(j.salary_min || '')}"></label>
<label>Salary max ₹/month <small>(optional)</small><input name="salary_max" type="number" min="0" step="500" value="${h(j.salary_max || '')}"></label>
</div>
<label>Summary <small>(2–3 sentences shown at the top of the job)</small><textarea name="summary" style="min-height:80px">${h(j.summary || '')}</textarea></label>
${ta('responsibilities', 'Responsibilities', 'one per line')}
${ta('qualifications', 'Qualifications', 'one per line')}
${ta('requirements', 'What we’re looking for', 'one per line')}
${ta('benefits', 'What we offer', 'one per line')}
<label>Status<select name="status">${JOB_STATUSES.map(s => `<option${s === (j.status || 'draft') ? ' selected' : ''}>${s}</option>`).join('')}</select><small>Draft = hidden. Published = live on the Careers page and Google Jobs. Closed = shown as closed, no new applications.</small></label>
<div class="actions"><button class="btn" name="do" value="save">Save</button>${(j.status || 'draft') !== 'published' ? '<button class="btn gold" name="do" value="publish">Save &amp; publish</button>' : '<button class="btn ghost" name="do" value="close">Close vacancy</button>'}
<a class="btn ghost" href="/admin/jobs">Cancel</a></div>
</form>
${!isNew ? `<form method="post" action="/admin/jobs/${j.id}" onsubmit="return confirm('Delete this vacancy permanently? Its applications are kept.')" style="margin-top:14px"><button class="btn danger" name="do" value="delete">Delete vacancy</button></form>` : ''}`;
}

function readJobForm(form) {
  const int = (v, max) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? Math.min(n, max) : null; };
  const date = String(form.get('closing_date') || '');
  const et = String(form.get('employment_type') || 'FULL_TIME');
  const st = String(form.get('status') || 'draft');
  const text = (k, m) => nz(String(form.get(k) || '').replace(/\r/g, '').replace(/[\u0000-\u0009\u000b-\u001f]/g, '').trim().slice(0, m));
  return {
    title: clean(form.get('title'), 100), department: nz(clean(form.get('department'), 60)),
    employment_type: EMPLOYMENT_TYPES[et] ? et : 'FULL_TIME', location: clean(form.get('location'), 100) || 'Kazhakkoottam, Thiruvananthapuram',
    experience: nz(clean(form.get('experience'), 160)), salary_text: nz(clean(form.get('salary_text'), 80)),
    salary_min: int(form.get('salary_min'), 10000000), salary_max: int(form.get('salary_max'), 10000000), openings: int(form.get('openings'), 50) || 1,
    closing_date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    summary: text('summary', 800), responsibilities: text('responsibilities', 3000), qualifications: text('qualifications', 2000),
    requirements: text('requirements', 3000), benefits: text('benefits', 2000), status: JOB_STATUSES.includes(st) ? st : 'draft',
  };
}

const JOB_COLS = ['title', 'department', 'employment_type', 'location', 'experience', 'salary_text', 'salary_min', 'salary_max', 'openings', 'closing_date', 'summary', 'responsibilities', 'qualifications', 'requirements', 'benefits', 'status'];

export async function handleAdminJobs(request, env, url) {
  const auth = await authorised(request, env);
  if (auth !== true) return authResponse(auth);
  const page = (title, body) => new Response(adminShell(title, 'jobs', body), { headers: adminHeaders({ 'content-type': 'text/html; charset=utf-8' }) });
  const path = url.pathname.replace(/\/$/, '');

  if (request.method === 'POST') {
    if (!sameOrigin(request)) return new Response('Forbidden', { status: 403, headers: adminHeaders() });
    const form = (request.headers.get('content-type') || '').match(/form/) ? await request.formData() : new FormData();
    const doAct = String(form.get('do') || 'save');
    if (path === '/admin/jobs/seed') {
      const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM jobs').first();
      if (!n || !n.n) for (const key of Object.keys(TEMPLATES)) await insertJob(env, { ...TEMPLATES[key], status: 'draft', location: 'Kazhakkoottam, Thiruvananthapuram', openings: 1 });
      return Response.redirect(new URL('/admin/jobs?msg=Starter+drafts+created', url).toString(), 303);
    }
    const idm = path.match(/^\/admin\/jobs\/(\d+)$/);
    if (doAct === 'delete' && idm) {
      await env.DB.prepare('DELETE FROM jobs WHERE id = ?').bind(+idm[1]).run();
      return Response.redirect(new URL('/admin/jobs?msg=Vacancy+deleted', url).toString(), 303);
    }
    const data = readJobForm(form);
    if (doAct === 'publish') data.status = 'published';
    if (doAct === 'close') data.status = 'closed';
    if (!data.title) return page('Edit vacancy', jobForm({ ...data, id: idm && idm[1] }, !idm, 'Please enter a job title.'));
    let id;
    if (path === '/admin/jobs/new') id = await insertJob(env, data);
    else if (idm) {
      id = +idm[1];
      const cur = await env.DB.prepare('SELECT status, published_at FROM jobs WHERE id = ?').bind(id).first();
      if (!cur) return Response.redirect(new URL('/admin/jobs', url).toString(), 303);
      const publishedAt = data.status === 'published' && !cur.published_at ? new Date().toISOString() : cur.published_at;
      await env.DB.prepare(`UPDATE jobs SET ${JOB_COLS.map(c => `${c}=?`).join(', ')}, published_at=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`)
        .bind(...JOB_COLS.map(c => data[c] ?? null), publishedAt, id).run();
    } else return new Response('Not found', { status: 404, headers: adminHeaders() });
    const msg = data.status === 'published' ? 'Saved — the vacancy is live on the Careers page.' : data.status === 'closed' ? 'Saved — the vacancy is closed.' : 'Saved as draft (not public).';
    return Response.redirect(new URL(`/admin/jobs/${id}?msg=${encodeURIComponent(msg)}`, url).toString(), 303);
  }

  if (path === '/admin/jobs/new') {
    const key = url.searchParams.get('template') || 'blank';
    const t = TEMPLATES[key] || { title: '', employment_type: 'FULL_TIME' };
    return page('New vacancy', jobForm({ ...t, status: 'draft', openings: 1 }, true));
  }
  const idm = path.match(/^\/admin\/jobs\/(\d+)$/);
  if (idm) {
    const j = await env.DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(+idm[1]).first();
    if (!j) return page('Not found', '<p class="empty">Vacancy not found. <a href="/admin/jobs">Back to jobs</a></p>');
    return page('Edit vacancy', jobForm(j, false, url.searchParams.get('msg')));
  }

  const { results } = await env.DB.prepare(`SELECT j.*, (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id) AS apps,
    (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id AND a.status='new') AS new_apps FROM jobs j
    ORDER BY CASE status WHEN 'published' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, id DESC`).all();
  const rows = results || [];
  const cards = rows.map(j => `<article class="card ${h(j.status)}"><header><div><strong>${h(j.title)}</strong> <span class="muted">· ${h(j.department || '')} · ${h(EMPLOYMENT_TYPES[j.employment_type] || '')}</span></div><span class="pill ${h(j.status)}">${h(j.status)}</span></header>
<p class="muted">${j.closing_date ? `Closes ${h(ist(j.closing_date + 'T12:00:00Z', false))} · ` : ''}${j.apps} application${j.apps === 1 ? '' : 's'}${j.new_apps ? ` (${j.new_apps} new)` : ''}${j.published_at ? ` · published ${h(ist(j.published_at, false))}` : ''}</p>
<div class="actions"><a class="btn" href="/admin/jobs/${j.id}">Edit</a><a class="btn ghost" href="/admin/applications?job=${j.id}">Applications</a>${j.status !== 'draft' ? `<a class="btn ghost" href="/careers/${h(j.slug)}/" target="_blank" rel="noopener">View public page ↗</a>` : ''}</div></article>`).join('');
  const tpl = Object.entries(TEMPLATE_LABELS).map(([k, v]) => `<option value="${k}">${h(v)}</option>`).join('');
  const seed = rows.length ? '' : `<form method="post" action="/admin/jobs/seed" style="margin-bottom:14px"><p class="empty" style="margin:0 0 10px">No vacancies yet. Create editable drafts for Dental Doctor, Cosmetologist, Nursing Assistant and Front Office Executive in one click — nothing goes live until you publish.</p><button class="btn gold">Create the 4 starter drafts</button></form>`;
  const flash = url.searchParams.get('msg');
  return page('Jobs', `${flash ? `<div class="flash">${h(flash)}</div>` : ''}
<div class="bar"><h2 style="margin:0;font-size:20px">Vacancies</h2>
<form method="get" action="/admin/jobs/new" class="inline"><select name="template" aria-label="Template">${tpl}</select><button>New from template</button></form></div>
${seed}${cards}
<p class="muted">Public careers page: <a href="/careers/" target="_blank" rel="noopener">/careers/</a> · Published jobs also appear in the sitemap for Google Jobs.</p>`);
}

async function insertJob(env, data) {
  const slug = await uniqueSlug(env, slugify(data.title), 0);
  const publishedAt = data.status === 'published' ? new Date().toISOString() : null;
  const r = await env.DB.prepare(`INSERT INTO jobs (slug, ${JOB_COLS.join(', ')}, published_at) VALUES (?, ${JOB_COLS.map(() => '?').join(', ')}, ?)`)
    .bind(slug, ...JOB_COLS.map(c => data[c] ?? null), publishedAt).run();
  return r.meta.last_row_id;
}

/* ---------------- Admin: applications ---------------- */

export async function handleAdminApplications(request, env, url) {
  const auth = await authorised(request, env);
  if (auth !== true) return authResponse(auth);
  if (request.method === 'POST') {
    if (!sameOrigin(request)) return new Response('Forbidden', { status: 403, headers: adminHeaders() });
    const form = (request.headers.get('content-type') || '').match(/form/) ? await request.formData() : new FormData();
    const id = parseInt(form.get('id'), 10), status = String(form.get('status') || '');
    if (id && APP_STATUSES.includes(status)) {
      await env.DB.prepare("UPDATE applications SET status=?, notes=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?")
        .bind(status, nz(clean(form.get('notes'), 500)), id).run();
    }
    const back = new URL('/admin/applications', url);
    for (const k of ['job', 'status']) { const v = form.get('f_' + k); if (v) back.searchParams.set(k, String(v)); }
    return Response.redirect(back.toString(), 303);
  }
  const jobId = parseInt(url.searchParams.get('job') || '', 10) || null;
  const st = url.searchParams.get('status') || 'active';
  const where = [], binds = [];
  if (jobId) { where.push('job_id = ?'); binds.push(jobId); }
  if (st === 'active') where.push("status IN ('new','shortlisted','interviewed')");
  else if (APP_STATUSES.includes(st)) { where.push('status = ?'); binds.push(st); }
  const { results } = await env.DB.prepare(`SELECT * FROM applications ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 300`).bind(...binds).all();
  const jobs = (await env.DB.prepare('SELECT id, title FROM jobs ORDER BY id DESC').all()).results || [];
  const q = (k, v) => { const u = new URLSearchParams(); if (jobId) u.set('job', jobId); if (st) u.set('status', st); u.set(k, v); return '?' + u.toString(); };
  const tabs = ['active', ...APP_STATUSES, 'all'].map(s => `<a href="/admin/applications${q('status', s)}" class="${s === st ? 'on' : ''}">${s === 'active' ? 'In progress' : s[0].toUpperCase() + s.slice(1)}</a>`).join('');
  const jobSel = `<form method="get" class="inline" action="/admin/applications"><input type="hidden" name="status" value="${h(st)}"><select name="job" onchange="this.form.submit()"><option value="">All vacancies</option>${jobs.map(j => `<option value="${j.id}"${j.id === jobId ? ' selected' : ''}>${h(j.title)}</option>`).join('')}</select><noscript><button>Filter</button></noscript></form>`;
  const cards = (results || []).map(a => `<article class="card ${h(a.status)}"><header><div><strong>${h(a.name)}</strong> <span class="muted">· ${h(a.job_title || '')} · ${h(ist(a.created_at))} IST</span></div><span class="pill">${h(a.status)}</span></header>
<dl class="kv">${a.qualification ? `<dt>Qualification</dt><dd>${h(a.qualification)}</dd>` : ''}${a.experience_years ? `<dt>Experience</dt><dd>${h(a.experience_years)}</dd>` : ''}${a.current_location ? `<dt>Location</dt><dd>${h(a.current_location)}</dd>` : ''}${a.notice_period ? `<dt>Notice</dt><dd>${h(a.notice_period)}</dd>` : ''}${a.email ? `<dt>Email</dt><dd><a href="mailto:${h(a.email)}">${h(a.email)}</a></dd>` : ''}${a.message ? `<dt>Message</dt><dd>${h(a.message)}</dd>` : ''}</dl>
<div class="actions"><a class="btn" href="tel:${h(a.phone)}">Call ${h(a.phone)}</a><a class="btn ghost" href="${h(waLink(a.phone))}" target="_blank" rel="noopener">WhatsApp</a>${a.cv_key ? `<a class="btn ghost" href="/admin/cv/${a.id}">Download CV ↓</a>` : '<span class="muted">No CV uploaded</span>'}</div>
<form class="inline" method="post" action="/admin/applications"><input type="hidden" name="id" value="${a.id}"><input type="hidden" name="f_job" value="${jobId || ''}"><input type="hidden" name="f_status" value="${h(st)}">
<select name="status" aria-label="Status">${APP_STATUSES.map(s => `<option${s === a.status ? ' selected' : ''}>${s}</option>`).join('')}</select>
<input name="notes" maxlength="500" placeholder="Interview notes" value="${h(a.notes || '')}" aria-label="Notes"><button>Save</button></form></article>`).join('');
  return new Response(adminShell('Applications', 'apps', `<div class="bar"><h2 style="margin:0;font-size:20px">Applications</h2>${jobSel}</div>
<nav class="tabs">${tabs}</nav>${cards || '<p class="empty">No applications here yet.</p>'}
<p class="muted">Applications and CVs are deleted automatically after ${APP_RETENTION_DAYS} days unless marked “hired”. Treat CVs as confidential.</p>`), { headers: adminHeaders({ 'content-type': 'text/html; charset=utf-8' }) });
}

export async function handleAdminCv(request, env, url) {
  const auth = await authorised(request, env);
  if (auth !== true) return authResponse(auth);
  const id = parseInt(url.pathname.split('/').pop(), 10);
  const a = id ? await env.DB.prepare('SELECT cv_key, cv_name, name FROM applications WHERE id = ?').bind(id).first() : null;
  if (!a || !a.cv_key || !env.CVS) return new Response('CV not found', { status: 404, headers: adminHeaders() });
  const obj = await env.CVS.get(a.cv_key);
  if (!obj) return new Response('CV not found', { status: 404, headers: adminHeaders() });
  const ext = a.cv_key.split('.').pop();
  const file = `${slugify(a.name)}-cv.${ext}`;
  return new Response(obj.body, { headers: adminHeaders({ 'content-type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'application/octet-stream', 'content-disposition': `attachment; filename="${file}"`, 'x-content-type-options': 'nosniff' }) });
}
