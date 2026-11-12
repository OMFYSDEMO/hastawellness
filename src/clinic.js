// Hasta Clinic App — clinicapp.hastawellnessclinic.com
// Phase 1: patients, appointments, catalogue, GST billing, payments and packages.
// Shares staff accounts, sessions and website leads with the EMS platform (src/ems.js).
//
// Money rules (agreed for HASWEL CARE):
//  - Catalogue prices exclude GST; GST is added on top per line (CGST + SGST, intra-state).
//  - Dental services are exempt (rate 0); other services 18%; products 0/5/12/18%.
//  - Pass-through items (outsourced imaging) are collected for a partner: no GST, not clinic revenue.
//  - Packages are priced from their contents' list value minus a package discount; GST on a package
//    is split across its contents in proportion to their list value.
//  - Discounts above the limit need an approver (Settings: discount_approvers; default any doctor/admin) to authorise with their password; recorded.
//  - Every completed visit must end billed, covered by a package, or marked no-charge with a reason.
//  - Payments carry a mode and a reference (UPI/card/bank/finance). A payment is applied to one invoice;
//    any excess stays as the patient's advance, which can later be applied to another invoice.

import { PDFDocument, StandardFonts, rgb } from './vendor/pdf-lib.esm.min.js';
import { json, sameOrigin, clean, nz, h, normalisePhone, sha256 } from './util.js';
import { verifySecret, hashSecret, handleEms } from './ems.js';
import { stockRoute, stockOutForInvoice, stockBackForInvoice, stockAlertStmts, stockAlertsFrom } from './stock.js';
import { careRoute, uploadPhoto, recallStmt } from './care.js';
import { hrRoute, kioskRoute, scanRoute } from './hr.js';
import { docsRoute, uploadDocFile } from './docs.js';
import { emsForPatient, link as emsLink, unlink as emsUnlink, recheck as emsRecheck, billPackage, legacyPayments, moveLegacyPayment, resolveLegacyPayment, emsAppointments, emsAlerts, markEmsAppt } from './emslink.js';

/* ---------------- helpers ---------------- */
const IST = 330 * 60000;
const today = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
const nowLocal = () => new Date(Date.now() + IST).toISOString().slice(0, 16);
const nowIso = () => new Date().toISOString().slice(0, 19) + 'Z';
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const isLocal = s => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s || '');
const r2 = x => Math.round((Number(x) || 0) * 100) / 100;
const last10 = p => String(p || '').replace(/\D/g, '').slice(-10);
const parse = (s, f) => { try { return s ? JSON.parse(s) : f; } catch { return f; } };
const minutesOf = s => { const [hh, mm] = s.slice(11, 16).split(':').map(Number); return hh * 60 + mm; };
const addMin = (s, m) => { const d = new Date(s + ':00Z'); d.setUTCMinutes(d.getUTCMinutes() + m); return d.toISOString().slice(0, 16); };

const HEADERS = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', 'permissions-policy': 'camera=(), microphone=(), geolocation=(self)' };
const CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const api = (data, status = 200) => json(data, status, HEADERS);
const bad = msg => api({ ok: false, error: msg }, 400);
const done = ([status, error, extra]) => status === 200 ? api({ ok: true, ...(extra || {}) }) : api({ ok: false, error, ...(extra || {}) }, status);
const R = (s, e, x) => [s, e, x];
const OK = x => [200, null, x];

export const EMS_ITEM = 'EMS-PKG';
export const MODES = { cash: 'Cash', upi: 'UPI', card: 'Card (POS)', bank: 'Bank transfer', finance: 'Healthcare finance' };
export const APPT_STATUS = ['booked', 'arrived', 'in_treatment', 'completed', 'no_show', 'cancelled'];
const HOURS = { 0: ['10:00', '16:00'], 1: ['10:00', '20:30'], 2: ['10:00', '20:30'], 3: ['10:00', '20:30'], 4: ['10:00', '20:30'], 5: ['10:00', '20:30'], 6: ['10:00', '20:30'] };
const DEFAULT_DEPTS = [['Dental', '#2f6f8f'], ['Skin & Aesthetics', '#b0607a'], ['Hair', '#8a6a2f'], ['Wellness', '#34595e'], ['Body Contouring', '#6b4a8f'], ['General / Clinic', '#5e6d6c']];
const SETTING_KEYS = { legal_name: 'HASWEL CARE Private Limited', trade_name: 'Hasta Wellness', gstin: '', address: '1st floor, Anjali Arcade, near Nippon Toyota, Technopark Phase 3 Service Road, Kazhakkoottam, Thiruvananthapuram, Kerala 695582', state: 'Kerala (32)', phone: '+91 97784 58883', email: 'hello@hastawellnessclinic.com', invoice_prefix: 'HW', discount_limit_pct: '10', discount_approvers: '', invoice_footer: 'Thank you for choosing Hasta Wellness.',
  // Attendance & leave (src/hr.js)
  leave_approvers: '', leave_annual_per_month: '1', leave_sick_per_year: '0', leave_casual_per_year: '0', att_grace_min: '10', geo_lat: '', geo_lng: '', geo_radius_m: '150' };

async function audit(env, me, action, entity, id, detail) {
  await env.DB.prepare('INSERT INTO cl_audit (staff_id, staff_name, action, entity, entity_id, detail) VALUES (?,?,?,?,?,?)').bind(me.id, me.name, action, entity, id || null, detail ? String(detail).slice(0, 500) : null).run();
}

/* ---------------- access ---------------- */
// One round trip: session → staff → departments. (Each D1 query is a network hop, so fewer is faster.)
async function clinicSession(request, env) {
  const m = (request.headers.get('cookie') || '').match(/(?:^|;\s*)ems_s=([a-f0-9]{64})/);
  if (!m) return { status: 401 };
  const r = await env.DB.prepare(`SELECT s.subject_id sid, st.id, st.name, st.role, st.username, st.skills, st.apps, st.reg_no,
      (SELECT group_concat(dept_id) FROM cl_staff_depts WHERE staff_id=st.id) depts
    FROM ems_sessions s LEFT JOIN ems_staff st ON st.id=s.subject_id AND st.active=1
    WHERE s.token_hash=? AND s.kind='staff' AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%SZ','now')`).bind(await sha256(m[1])).first();
  if (!r) return { status: 401 };
  if (r.sid === 0) return { me: { kind: 'staff', id: 0, name: 'Clinic admin', role: 'admin', username: 'hasta', skills: ['doctor'], admin: true, depts: [] } };
  if (!r.id) return { status: 401 };
  const apps = parse(r.apps, ['ems']);
  // Staff without the clinic app can still use attendance & leave ("My attendance" only).
  const limited = r.role !== 'admin' && !apps.includes('clinic');
  return { me: { kind: 'staff', id: r.id, name: r.name, role: r.role, username: r.username, reg_no: r.reg_no, skills: parse(r.skills, []), admin: r.role === 'admin', depts: String(r.depts || '').split(',').filter(Boolean).map(Number), limited } };
}
const canManage = u => u.admin || u.role === 'manager';
// Who may approve discounts above the limit: the staff named in Settings (discount_approvers),
// or — if nobody is named — any doctor or admin.
const approverIds = s => String(s.discount_approvers || '').split(',').map(Number).filter(Boolean);
const canAuthorise = (u, s) => { const ids = approverIds(s); return ids.length ? ids.includes(u.id) : (u.admin || u.skills.includes('doctor')); };

/* ---------------- entry ---------------- */
export async function handleClinic(request, env, url, ctx, base, serveAsset) {
  const path = url.pathname.slice(base.length) || '/';
  if (path === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n', { headers: { 'content-type': 'text/plain' } });
  if (/^\/(clinic|ems|fonts|img)\/[\w.\-/]+\.\w+$/.test(path) || /^\/(favicon\.ico|apple-touch-icon\.png)$/.test(path)) {
    const res = await serveAsset(request, env, new URL(path, url));
    const headers = new Headers(res.headers);
    headers.set('x-robots-tag', 'noindex, nofollow');
    // Versioned files (?v=N) never change, so browsers may keep them; the version is bumped on every release.
    if (/^\/(clinic|ems)\//.test(path)) headers.set('cache-control', url.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'public, max-age=300, must-revalidate');
    return new Response(res.body, { status: res.status, headers });
  }
  // Sign-in, sign-out, "who am I" and password change are shared with the EMS platform.
  if (/^\/api\/(auth\/|me(\/secret)?$)/.test(path)) return handleEms(request, env, url, ctx, base, serveAsset);
  if (path.startsWith('/api/clinic/')) {
    try { return await route(request, env, url, path.slice(11), base); }
    catch (err) { console.error('Clinic error', path, err && err.stack || err); return api({ ok: false, error: 'Something went wrong. Please try again.' }, 500); }
  }
  if (path.startsWith('/api/kiosk/')) {
    try { return (await kioskRoute(request, env, url, base, path.slice(4))) || api({ ok: false, error: 'Not found' }, 404); }
    catch (err) { console.error('Kiosk error', err && err.stack || err); return api({ ok: false, error: 'Something went wrong.' }, 500); }
  }
  if (path.startsWith('/api/')) return api({ ok: false, error: 'Not found' }, 404);
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
  if (path === '/kiosk') return new Response(kioskShell(base), { headers: { ...HEADERS, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP } });
  return new Response(shell(base), { headers: { ...HEADERS, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP } });
}

function shell(base) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#34595e">
<meta name="ems-base" content="${h(base)}">
<title>Hasta Clinic</title>
<link rel="icon" href="/favicon.ico"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preload" href="/fonts/manrope-var.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/ems/app.css?v=8"><link rel="stylesheet" href="/clinic/clinic.css?v=10">
<link rel="modulepreload" href="/clinic/app.js?v=15"><link rel="modulepreload" href="/ems/core.js?v=8">
</head><body><div id="app"><div class="boot"><img src="/img/hasta-emblem.webp" alt="" width="56" height="56"></div></div>
<script type="module" src="/clinic/app.js?v=15"></script></body></html>`;
}

// Attendance screen for the clinic desktop: shows the rotating clock-in QR code.
function kioskShell(base) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="ems-base" content="${h(base)}"><title>Staff attendance · Hasta</title>
<link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="/ems/app.css?v=8"><link rel="stylesheet" href="/clinic/clinic.css?v=10">
</head><body class="kiosk-body"><div id="kiosk" class="kiosk"><div class="boot"><img src="/img/hasta-emblem.webp" alt="" width="56" height="56"></div></div>
<script type="module" src="/clinic/kiosk.js?v=1"></script></body></html>`;
}

/* ---------------- router ---------------- */
async function route(request, env, url, p, base) {
  const m = request.method;
  let b = {};
  // Clinical photo upload: raw image body, not JSON.
  if (p === '/photos' && m === 'POST') {
    if (!sameOrigin(request)) return api({ ok: false, error: 'Forbidden' }, 403);
    const { me: u } = await clinicSession(request, env);
    if (!u) return api({ ok: false, error: 'Please sign in.' }, 401);
    return uploadPhoto(request, env, u, url);
  }
  // Staff document upload: raw file body (PDF / image), not JSON.
  if (p === '/hr/docs/file' && m === 'POST') {
    if (!sameOrigin(request)) return api({ ok: false, error: 'Forbidden' }, 403);
    const { me: u } = await clinicSession(request, env);
    if (!u) return api({ ok: false, error: 'Please sign in.' }, 401);
    return uploadDocFile(request, env, u);
  }
  if (m !== 'GET') {
    if (!sameOrigin(request)) return api({ ok: false, error: 'Forbidden' }, 403);
  }
  if (m !== 'GET' && !(m === 'DELETE' && !request.headers.get('content-type'))) {
    if (!(request.headers.get('content-type') || '').includes('application/json')) return api({ ok: false, error: 'Unsupported' }, 415);
    if (parseInt(request.headers.get('content-length') || '0', 10) > (p === '/catalogue/import' ? 600000 : 60000)) return api({ ok: false, error: 'Too large' }, 413);
    try { b = await request.json(); } catch { return bad('Invalid request'); }
    if (!b || typeof b !== 'object') return bad('Invalid request');
  }
  const auth = await clinicSession(request, env);
  // Clock-in / out: a signed-in phone, or one remembered from an earlier scan.
  if (p === '/hr/scan' && m === 'POST') return scanRoute(request, env, url, base, auth.me || null, b);
  if (auth.status === 401) return api({ ok: false, error: 'Please sign in.' }, 401);
  const me = auth.me;
  if (me && me.limited) {
    if (p === '/boot' && m === 'GET') return api({ ok: true, me, limited: true, settings: { trade_name: (await settings(env)).trade_name } });
    if (!p.startsWith('/hr/')) return api({ ok: false, error: 'Your account only has access to My attendance.', code: 'no_access' }, 403);
  }
  if (!me) return api({ ok: false, error: 'Your account does not have access to the clinic app. Ask an admin to turn it on in Settings → Team.', code: 'no_access' }, 403);
  await ensureSeed(env);
  const q = k => url.searchParams.get(k);
  let r;

  if (p === '/boot' && m === 'GET') return api({ ok: true, me, ...(await boot(env)) });
  if (p === '/dashboard' && m === 'GET') return api({ ok: true, ...(await dashboard(env, me)) });
  if (p === '/alerts' && m === 'GET') return api({ ok: true, ...(await visitAlerts(env)) });

  // Settings & reference data
  if (p === '/settings' && m === 'PUT') { if (!me.admin) return api({ ok: false, error: 'Admins only.' }, 403); return done(await saveSettings(env, me, b)); }
  if (p === '/departments' && m === 'POST') { if (!me.admin) return api({ ok: false, error: 'Admins only.' }, 403); return done(await saveDept(env, b)); }
  if (p === '/rooms' && m === 'POST') { if (!me.admin) return api({ ok: false, error: 'Admins only.' }, 403); return done(await saveRoom(env, b)); }
  if (p === '/team' && m === 'GET') return api({ ok: true, team: await team(env) });
  if (p === '/team' && m === 'POST') { if (!me.admin) return api({ ok: false, error: 'Admins only.' }, 403); return done(await saveMember(env, me, null, b)); }
  if ((r = p.match(/^\/team\/(\d+)$/)) && m === 'PUT') { if (!me.admin) return api({ ok: false, error: 'Admins only.' }, 403); return done(await saveMember(env, me, +r[1], b)); }

  // Catalogue
  if (p === '/catalogue' && m === 'GET') return api({ ok: true, items: await catalogue(env, q('all') === '1') });
  if (p === '/catalogue' && m === 'POST') { if (!me.admin) return api({ ok: false, error: 'Admins only.' }, 403); return done(await saveItem(env, me, null, b)); }
  if ((r = p.match(/^\/catalogue\/(\d+)$/)) && m === 'PUT') { if (!me.admin) return api({ ok: false, error: 'Admins only.' }, 403); return done(await saveItem(env, me, +r[1], b)); }
  if (p === '/catalogue/import' && m === 'POST') { if (!me.admin) return api({ ok: false, error: 'Admins only.' }, 403); return done(await importItems(env, me, b)); }

  // Packages
  if (p === '/packages' && m === 'GET') return api({ ok: true, packages: await packageDefs(env) });
  if (p === '/packages' && m === 'POST') { if (!me.admin) return api({ ok: false, error: 'Admins only.' }, 403); return done(await savePackageDef(env, me, null, b)); }
  if ((r = p.match(/^\/packages\/(\d+)$/)) && m === 'PUT') { if (!me.admin) return api({ ok: false, error: 'Admins only.' }, 403); return done(await savePackageDef(env, me, +r[1], b)); }
  if (p === '/redeem' && m === 'POST') return done(await redeem(env, me, b));
  if ((r = p.match(/^\/redemptions\/(\d+)\/void$/)) && m === 'POST') { if (!canManage(me)) return api({ ok: false, error: 'Managers or admins only.' }, 403); return done(await voidRedemption(env, me, +r[1], b)); }

  // Patients & leads
  if (p === '/patients' && m === 'GET') return api({ ok: true, patients: await searchPatients(env, q('q') || '') });
  if (p === '/patients' && m === 'POST') return done(await savePatient(env, me, null, b));
  if ((r = p.match(/^\/patients\/(\d+)$/)) && m === 'GET') { const d = await patientDetail(env, +r[1]); return d ? api({ ok: true, ...d }) : api({ ok: false, error: 'Not found' }, 404); }
  if ((r = p.match(/^\/patients\/(\d+)$/)) && m === 'PUT') return done(await savePatient(env, me, +r[1], b));
  // EMS link (one person, one record)
  if ((r = p.match(/^\/patients\/(\d+)\/ems-link$/)) && m === 'POST') return done(await emsLink(env, me, +r[1], parseInt(b.ems_client_id, 10) || 0));
  if ((r = p.match(/^\/patients\/(\d+)\/ems-unlink$/)) && m === 'POST') return done(await emsUnlink(env, me, +r[1]));
  if ((r = p.match(/^\/ems\/packages\/(\d+)\/bill$/)) && m === 'POST') return done(await billPackage(env, me, +r[1]));
  if ((r = p.match(/^\/ems\/appointments\/(\d+)\/status$/)) && m === 'POST') return done(await markEmsAppt(env, me, +r[1], b));
  if (p === '/ems/payments' && m === 'GET') return api({ ok: true, payments: await legacyPayments(env, q('all') === '1') });
  if ((r = p.match(/^\/ems\/payments\/(\d+)\/(move|resolve)$/)) && m === 'POST') {
    if (!canManage(me)) return api({ ok: false, error: 'Managers or admins only.' }, 403);
    return done(await (r[2] === 'move' ? moveLegacyPayment : resolveLegacyPayment)(env, me, +r[1], b));
  }
  if (p === '/leads' && m === 'GET') return api({ ok: true, leads: await leads(env, q('status') || 'open') });
  if ((r = p.match(/^\/leads\/(\d+)$/)) && m === 'PUT') return done(await updateLead(env, me, +r[1], b));
  if (p === '/leads' && m === 'POST') return done(await addLead(env, me, b));

  // Appointments
  if (p === '/appointments' && m === 'GET') {
    const [appointments, ems] = await Promise.all([listAppointments(env, q('from'), q('to'), q('patient')), q('patient') ? [] : emsAppointments(env, q('from'), q('to'))]);
    return api({ ok: true, appointments, ems });
  }
  if (p === '/appointments' && m === 'POST') return done(await saveAppointment(env, me, null, b));
  if ((r = p.match(/^\/appointments\/(\d+)$/)) && m === 'PUT') return done(await saveAppointment(env, me, +r[1], b));
  if ((r = p.match(/^\/appointments\/(\d+)\/status$/)) && m === 'POST') return done(await setStatus(env, me, +r[1], b));
  if ((r = p.match(/^\/appointments\/(\d+)\/no-charge$/)) && m === 'POST') return done(await noCharge(env, me, +r[1], b));

  // Billing
  if (p === '/invoices' && m === 'GET') return api({ ok: true, invoices: await listInvoices(env, q('from'), q('to'), q('status')) });
  if (p === '/invoices' && m === 'POST') return done(await createInvoice(env, me, b));
  if ((r = p.match(/^\/invoices\/(\d+)$/)) && m === 'GET') { const d = await invoiceDetail(env, +r[1]); return d ? api({ ok: true, ...d }) : api({ ok: false, error: 'Not found' }, 404); }
  if ((r = p.match(/^\/invoices\/(\d+)$/)) && m === 'PUT') return done(await saveInvoice(env, me, +r[1], b));
  if ((r = p.match(/^\/invoices\/(\d+)$/)) && m === 'DELETE') return done(await deleteDraft(env, me, +r[1]));
  if ((r = p.match(/^\/invoices\/(\d+)\/finalise$/)) && m === 'POST') return done(await finalise(env, me, +r[1]));
  if ((r = p.match(/^\/invoices\/(\d+)\/cancel$/)) && m === 'POST') { if (!canManage(me)) return api({ ok: false, error: 'Managers or admins only.' }, 403); return done(await cancelInvoice(env, me, +r[1], b)); }
  if ((r = p.match(/^\/invoices\/(\d+)\/pdf$/)) && m === 'GET') return invoicePdfResponse(env, request, +r[1]);

  // Payments & cash
  if (p === '/payments' && m === 'GET') return api({ ok: true, payments: await listPayments(env, q('from'), q('to')) });
  if (p === '/payments' && m === 'POST') return done(await recordPayment(env, me, b));
  if ((r = p.match(/^\/payments\/(\d+)\/void$/)) && m === 'POST') { if (!canManage(me)) return api({ ok: false, error: 'Managers or admins only.' }, 403); return done(await voidPayment(env, me, +r[1], b)); }
  if (p === '/apply-advance' && m === 'POST') return done(await applyAdvance(env, me, b));
  if (p === '/cash' && m === 'GET') return api({ ok: true, ...(await cashBook(env)) });
  if (p === '/cash/deposits' && m === 'POST') { if (!canManage(me)) return api({ ok: false, error: 'Managers or admins only.' }, 403); return done(await addDeposit(env, me, b)); }

  // Reports
  if (p === '/reports/daybook' && m === 'GET') return api({ ok: true, ...(await dayBook(env, isDate(q('date')) ? q('date') : today())) });
  if (p === '/reports/summary' && m === 'GET') return api({ ok: true, ...(await summary(env, q('month'))) });
  if (p === '/reports/outstanding' && m === 'GET') return api({ ok: true, invoices: await outstanding(env) });

  // Stock & purchasing (src/stock.js)
  const sr = await stockRoute(request, env, me, p, m, b, q);
  if (sr) return sr;
  // Care records: notes, dental chart, plans, recalls, photos (src/care.js)
  { const dr = await docsRoute(request, env, url, me, p, m, b, q); if (dr) return dr; }
  { const hr = await hrRoute(request, env, url, me, p, m, b, q, base); if (hr) return hr; }
  const cr = await careRoute(request, env, me, p, m, b, q);
  if (cr) return cr;

  return api({ ok: false, error: 'Not found' }, 404);
}

/* ---------------- seed, settings, reference data ---------------- */
let seeded = false;
async function ensureSeed(env) {
  if (seeded) return;
  const d = await env.DB.prepare('SELECT COUNT(*) n FROM cl_departments').first();
  seeded = true;
  if (!d.n) for (const [n, c] of DEFAULT_DEPTS) await env.DB.prepare('INSERT INTO cl_departments (name, colour) VALUES (?,?)').bind(n, c).run();
}
export async function settings(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM cl_settings').all();
  const s = { ...SETTING_KEYS };
  for (const r of results || []) s[r.key] = r.value;
  return s;
}
async function saveSettings(env, me, b) {
  if (b.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(String(b.gstin).toUpperCase().trim())) return R(400, 'That GSTIN does not look right (15 characters, e.g. 32ABCDE1234F1Z5).');
  if (b.invoice_prefix && !/^[A-Z0-9-]{1,8}$/i.test(b.invoice_prefix)) return R(400, 'Invoice prefix: up to 8 letters, numbers or hyphens.');
  if (b.discount_approvers !== undefined) b.discount_approvers = String(b.discount_approvers).split(',').map(Number).filter(Boolean).join(',');
  const lim = Number(b.discount_limit_pct);
  if (b.discount_limit_pct !== undefined && !(lim >= 0 && lim <= 100)) return R(400, 'Discount limit must be 0–100%.');
  for (const k of Object.keys(SETTING_KEYS)) if (b[k] !== undefined) {
    let v = clean(b[k], 300); if (k === 'gstin' || k === 'invoice_prefix') v = v.toUpperCase();
    await env.DB.prepare('INSERT INTO cl_settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(k, v).run();
  }
  await audit(env, me, 'settings', 'settings', null, JSON.stringify(b).slice(0, 400));
  return OK();
}
async function boot(env) {
  const [st, depts, rooms, staff, sd, defs, items, cnt] = await env.DB.batch([
    env.DB.prepare('SELECT key, value FROM cl_settings'),
    env.DB.prepare('SELECT * FROM cl_departments ORDER BY id'),
    env.DB.prepare('SELECT * FROM cl_rooms ORDER BY name'),
    env.DB.prepare(TEAM_SQL),
    env.DB.prepare('SELECT * FROM cl_staff_depts'),
    env.DB.prepare(DEFS_SQL),
    env.DB.prepare(DEF_ITEMS_SQL),
    env.DB.prepare('SELECT COUNT(*) n FROM cl_items WHERE active=1'),
  ]);
  const s = { ...SETTING_KEYS }; for (const r of st.results || []) s[r.key] = r.value;
  return { settings: s, departments: depts.results || [], rooms: rooms.results || [], team: teamRows(staff.results, sd.results),
    packages: pricedAll(defs.results, items.results), item_count: cnt.results[0].n, modes: MODES, hours: HOURS };
}
async function saveDept(env, b) {
  const name = clean(b.name, 40); if (!name) return R(400, 'Enter a department name.');
  const colour = /^#[0-9a-f]{6}$/i.test(b.colour || '') ? b.colour : '#34595e';
  if (b.id) await env.DB.prepare('UPDATE cl_departments SET name=?, colour=?, active=? WHERE id=?').bind(name, colour, b.active === false ? 0 : 1, b.id).run();
  else await env.DB.prepare('INSERT INTO cl_departments (name, colour) VALUES (?,?)').bind(name, colour).run();
  return OK();
}
async function saveRoom(env, b) {
  const name = clean(b.name, 40); if (!name) return R(400, 'Enter a room or chair name.');
  const dept = parseInt(b.dept_id, 10) || null;
  if (b.id) await env.DB.prepare('UPDATE cl_rooms SET name=?, dept_id=?, active=? WHERE id=?').bind(name, dept, b.active === false ? 0 : 1, b.id).run();
  else await env.DB.prepare('INSERT INTO cl_rooms (name, dept_id) VALUES (?,?)').bind(name, dept).run();
  return OK();
}
const TEAM_SQL = 'SELECT id, name, username, role, skills, apps, reg_no, active FROM ems_staff ORDER BY active DESC, name';
const teamRows = (results, d) => (results || []).map(s => ({ id: s.id, name: s.name, username: s.username, role: s.role, reg_no: s.reg_no, active: !!s.active, skills: parse(s.skills, []), apps: parse(s.apps, ['ems']), depts: (d || []).filter(x => x.staff_id === s.id).map(x => x.dept_id) }));
async function team(env) {
  const [a, b] = await env.DB.batch([env.DB.prepare(TEAM_SQL), env.DB.prepare('SELECT * FROM cl_staff_depts')]);
  return teamRows(a.results, b.results);
}
const CLINIC_SKILLS = ['trainer', 'coach', 'doctor', 'medical_lead', 'front', 'nurse', 'dental_assistant'];
async function saveMember(env, me, id, b) {
  const name = clean(b.name, 80), username = clean(b.username, 40).toLowerCase();
  const role = ['admin', 'manager', 'staff'].includes(b.role) ? b.role : 'staff';
  const skills = (Array.isArray(b.skills) ? b.skills : []).filter(s => CLINIC_SKILLS.includes(s));
  const apps = (Array.isArray(b.apps) ? b.apps : []).filter(a => a === 'ems' || a === 'clinic');
  const depts = (Array.isArray(b.depts) ? b.depts : []).map(Number).filter(Boolean);
  if (!name) return R(400, 'Enter the name.');
  if (!id) {
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) return R(400, 'Username: 3–40 lowercase letters, numbers, dots or hyphens.');
    if (String(b.password || '').length < 8) return R(400, 'Set a password of at least 8 characters.');
    if (await env.DB.prepare('SELECT 1 FROM ems_staff WHERE username=?').bind(username).first()) return R(400, 'That username is taken.');
    const res = await env.DB.prepare('INSERT INTO ems_staff (name, username, pass_hash, role, skills, apps, reg_no) VALUES (?,?,?,?,?,?,?)')
      .bind(name, username, await hashSecret(String(b.password)), role, JSON.stringify(skills), JSON.stringify(apps.length ? apps : ['clinic']), nz(clean(b.reg_no, 40))).run();
    id = res.meta.last_row_id;
  } else {
    const s = await env.DB.prepare('SELECT id FROM ems_staff WHERE id=?').bind(id).first();
    if (!s) return R(404, 'Not found.');
    await env.DB.prepare('UPDATE ems_staff SET name=?, role=?, skills=?, apps=?, reg_no=?, active=? WHERE id=?').bind(name, role, JSON.stringify(skills), JSON.stringify(apps), nz(clean(b.reg_no, 40)), b.active === false ? 0 : 1, id).run();
    if (b.password) { if (String(b.password).length < 8) return R(400, 'Passwords need at least 8 characters.'); await env.DB.prepare('UPDATE ems_staff SET pass_hash=? WHERE id=?').bind(await hashSecret(String(b.password)), id).run(); }
  }
  await env.DB.prepare('DELETE FROM cl_staff_depts WHERE staff_id=?').bind(id).run();
  for (const d of depts) await env.DB.prepare('INSERT INTO cl_staff_depts (staff_id, dept_id) VALUES (?,?)').bind(id, d).run();
  await audit(env, me, id ? 'team.save' : 'team.add', 'staff', id, name);
  return OK({ id });
}

/* ---------------- catalogue ---------------- */
const KINDS = ['service', 'product', 'passthrough'];
const RATES = [0, 5, 12, 18, 28];
async function catalogue(env, all) {
  const { results } = await env.DB.prepare(`SELECT i.*, d.name dept_name FROM cl_items i LEFT JOIN cl_departments d ON d.id=i.dept_id ${all ? '' : 'WHERE i.active=1'} ORDER BY d.id, i.category, i.name`).all();
  return results || [];
}
export function itemFields(b) {
  const f = {
    code: clean(b.code, 40) || null, name: clean(b.name, 160), dept_id: parseInt(b.dept_id, 10) || null, category: clean(b.category, 80) || null,
    kind: KINDS.includes(b.kind) ? b.kind : 'service', price: Number(b.price), gst_rate: Number(b.gst_rate),
    hsn_sac: clean(b.hsn_sac, 12) || null, chair_minutes: b.chair_minutes === '' || b.chair_minutes == null ? null : parseInt(b.chair_minutes, 10),
    cost: b.cost === '' || b.cost == null ? null : Number(b.cost), partner: clean(b.partner, 80) || null, active: b.active === false || b.active === 0 ? 0 : 1,
    notes: clean(b.notes, 500) || null, sellable: b.sellable === false || b.sellable === 0 ? 0 : 1, unit: clean(b.unit, 20) || null,
    mrp: b.mrp === '' || b.mrp == null || isNaN(Number(b.mrp)) ? null : Number(b.mrp),
  };
  if (f.kind === 'passthrough') f.gst_rate = 0;
  if (!f.name) return [null, 'Enter the item name.'];
  if (!(f.price >= 0 && f.price < 10000000)) return [null, 'Enter a price (0 if it varies case by case).'];
  if (!RATES.includes(f.gst_rate)) return [null, 'GST rate must be 0, 5, 12, 18 or 28%.'];
  if (f.chair_minutes != null && !(f.chair_minutes >= 0 && f.chair_minutes <= 600)) return [null, 'Chair time must be 0–600 minutes.'];
  if (f.cost != null && !(f.cost >= 0)) return [null, 'Cost must be a positive number.'];
  return [f, null];
}
async function saveItem(env, me, id, b) {
  const [f, err] = itemFields(b); if (err) return R(400, err);
  if (f.code) { const dup = await env.DB.prepare('SELECT id FROM cl_items WHERE code=? AND id != ?').bind(f.code, id || 0).first(); if (dup) return R(400, 'Another item already uses that code.'); }
  if (id) await env.DB.prepare('UPDATE cl_items SET code=?, name=?, dept_id=?, category=?, kind=?, price=?, gst_rate=?, hsn_sac=?, chair_minutes=?, cost=?, partner=?, active=?, notes=?, sellable=?, unit=?, mrp=?, updated_at=? WHERE id=?')
    .bind(f.code, f.name, f.dept_id, f.category, f.kind, f.price, f.gst_rate, f.hsn_sac, f.chair_minutes, f.cost, f.partner, f.active, f.notes, f.sellable, f.unit, f.mrp, nowIso(), id).run();
  else await env.DB.prepare('INSERT INTO cl_items (code, name, dept_id, category, kind, price, gst_rate, hsn_sac, chair_minutes, cost, partner, active, notes, sellable, unit, mrp) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(f.code, f.name, f.dept_id, f.category, f.kind, f.price, f.gst_rate, f.hsn_sac, f.chair_minutes, f.cost, f.partner, f.active, f.notes, f.sellable, f.unit, f.mrp).run();
  await audit(env, me, id ? 'item.edit' : 'item.add', 'item', id, `${f.name} ₹${f.price} GST ${f.gst_rate}%`);
  return OK();
}
// Rows come already mapped by the browser: [{code, name, dept, category, kind, price, gst_rate, hsn_sac, chair_minutes, cost}]
async function importItems(env, me, b) {
  const rows = Array.isArray(b.rows) ? b.rows.slice(0, 500) : [];
  if (!rows.length) return R(400, 'No rows to import.');
  const depts = new Map(((await env.DB.prepare('SELECT id, name FROM cl_departments').all()).results || []).map(d => [d.name.toLowerCase(), d.id]));
  let added = 0, updated = 0; const errors = [];
  for (const [i, row] of rows.entries()) {
    const dn = clean(row.dept, 40);
    let dept_id = null;
    if (dn) {
      dept_id = depts.get(dn.toLowerCase());
      if (!dept_id) { dept_id = (await env.DB.prepare('INSERT INTO cl_departments (name, colour) VALUES (?,?)').bind(dn, '#5e6d6c').run()).meta.last_row_id; depts.set(dn.toLowerCase(), dept_id); }
    }
    const kindRaw = String(row.kind || '').toLowerCase();
    const kind = /pass|outsourc|partner/.test(kindRaw) ? 'passthrough' : /good|product|retail|stock|inventory/.test(kindRaw) ? 'product' : 'service';
    const rate = /exempt|nil/i.test(String(row.gst_rate ?? '')) ? 0 : Number(String(row.gst_rate ?? '').replace(/[^\d.]/g, '')) || 0;
    const sellable = /not for sale|internal|fixed asset|capitali/i.test(String(row.sellable ?? '')) ? 0 : 1;
    if (/^[—–-]+$/.test(String(row.hsn_sac ?? '').trim())) row.hsn_sac = '';
    const act = String(row.active ?? '').trim().toLowerCase();
    const [f, err] = itemFields({ ...row, dept_id, kind, gst_rate: rate, price: Number(String(row.price ?? '').replace(/[^\d.]/g, '')) || 0, active: ['no', 'n', 'false', '0', 'inactive'].includes(act) ? 0 : 1, sellable });
    if (err) { errors.push(`Row ${(b.offset || 0) + i + 1}: ${err}`); continue; }
    const ex = f.code ? await env.DB.prepare('SELECT id FROM cl_items WHERE code=?').bind(f.code).first()
      : await env.DB.prepare('SELECT id FROM cl_items WHERE lower(name)=lower(?) AND IFNULL(dept_id,0)=?').bind(f.name, f.dept_id || 0).first();
    if (ex) { await env.DB.prepare('UPDATE cl_items SET name=?, dept_id=?, category=?, kind=?, price=?, gst_rate=?, hsn_sac=COALESCE(?, hsn_sac), chair_minutes=COALESCE(?, chair_minutes), cost=COALESCE(?, cost), active=?, notes=COALESCE(?, notes), sellable=?, unit=COALESCE(?, unit), mrp=COALESCE(?, mrp), partner=COALESCE(?, partner), updated_at=? WHERE id=?').bind(f.name, f.dept_id, f.category, f.kind, f.price, f.gst_rate, f.hsn_sac, f.chair_minutes, f.cost, f.active, f.notes, f.sellable, f.unit, f.mrp, f.partner, nowIso(), ex.id).run(); updated++; }
    else { await env.DB.prepare('INSERT INTO cl_items (code, name, dept_id, category, kind, price, gst_rate, hsn_sac, chair_minutes, cost, active, notes, sellable, unit, mrp, partner) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(f.code, f.name, f.dept_id, f.category, f.kind, f.price, f.gst_rate, f.hsn_sac, f.chair_minutes, f.cost, f.active, f.notes, f.sellable, f.unit, f.mrp, f.partner).run(); added++; }
  }
  await audit(env, me, 'catalogue.import', 'item', null, `${added} added, ${updated} updated, ${errors.length} skipped`);
  return OK({ added, updated, errors: errors.slice(0, 50) });
}

/* ---------------- packages ---------------- */
async function itemMap(env, ids) {
  if (!ids.length) return new Map();
  const { results } = await env.DB.prepare(`SELECT * FROM cl_items WHERE id IN (${[...new Set(ids)].map(Number).join(',')})`).all();
  return new Map((results || []).map(i => [i.id, i]));
}
const DEFS_SQL = 'SELECT * FROM cl_package_defs ORDER BY active DESC, name';
const DEF_ITEMS_SQL = "SELECT * FROM cl_items WHERE id IN (SELECT json_extract(j.value, '$.item_id') FROM cl_package_defs d, json_each(d.items) j)";
function pricedAll(defs, items) {
  const map = new Map((items || []).map(i => [i.id, i]));
  return (defs || []).map(def => {
    const rows = parse(def.items, []).map(x => { const it = map.get(x.item_id); return it ? { item_id: it.id, name: it.name, qty: x.qty, price: it.price, gst_rate: it.kind === 'passthrough' ? 0 : it.gst_rate, kind: it.kind } : null; }).filter(Boolean);
    const list = r2(rows.reduce((s2, x) => s2 + x.price * x.qty, 0));
    return { ...def, items: rows, list_value: list, price: Math.round(list * (1 - (def.discount_pct || 0) / 100)) };
  });
}
async function packageDefs(env) {
  const [a, b] = await env.DB.batch([env.DB.prepare(DEFS_SQL), env.DB.prepare(DEF_ITEMS_SQL)]);
  return pricedAll(a.results, b.results);
}
async function savePackageDef(env, me, id, b) {
  const name = clean(b.name, 120);
  const items = (Array.isArray(b.items) ? b.items : []).map(x => ({ item_id: parseInt(x.item_id, 10), qty: parseInt(x.qty, 10) })).filter(x => x.item_id && x.qty > 0 && x.qty <= 100);
  const disc = Number(b.discount_pct), days = parseInt(b.validity_days, 10);
  if (!name) return R(400, 'Enter the package name.');
  if (!items.length) return R(400, 'Add at least one service to the package.');
  const map = await itemMap(env, items.map(x => x.item_id));
  if (items.some(x => !map.get(x.item_id))) return R(400, 'One of the services was not found.');
  if (items.some(x => map.get(x.item_id).kind === 'passthrough')) return R(400, 'Pass-through items (partner charges) cannot be in a package.');
  if (items.some(x => !map.get(x.item_id).sellable)) return R(400, 'Internal-use items cannot be in a package.');
  if (!(disc >= 0 && disc <= 60)) return R(400, 'Package discount must be 0–60%.');
  if (!(days >= 1 && days <= 1095)) return R(400, 'Validity must be 1–1095 days.');
  const dept = parseInt(b.dept_id, 10) || null;
  if (id) await env.DB.prepare('UPDATE cl_package_defs SET name=?, dept_id=?, items=?, discount_pct=?, validity_days=?, active=? WHERE id=?').bind(name, dept, JSON.stringify(items), disc, days, b.active === false ? 0 : 1, id).run();
  else await env.DB.prepare('INSERT INTO cl_package_defs (name, dept_id, items, discount_pct, validity_days) VALUES (?,?,?,?,?)').bind(name, dept, JSON.stringify(items), disc, days).run();
  await audit(env, me, 'package.save', 'package', id, name);
  return OK();
}
async function patientPackages(env, patientId) {
  const { results } = await env.DB.prepare('SELECT pp.*, i.invoice_no, i.status inv_status FROM cl_patient_packages pp LEFT JOIN cl_invoices i ON i.id=pp.invoice_id WHERE pp.patient_id=? ORDER BY pp.id DESC').bind(patientId).all();
  const { results: red } = await env.DB.prepare(`SELECT r.*, it.name item_name, s.name staff_name FROM cl_redemptions r JOIN cl_patient_packages pp ON pp.id=r.patient_package_id
    LEFT JOIN cl_items it ON it.id=r.item_id LEFT JOIN ems_staff s ON s.id=r.staff_id WHERE pp.patient_id=? ORDER BY r.redeemed_on DESC, r.id DESC`).bind(patientId).all();
  return (results || []).map(pp => {
    const items = parse(pp.items, []).map(x => {
      const used = (red || []).filter(r => r.patient_package_id === pp.id && r.item_id === x.item_id && !r.voided).reduce((s, r) => s + r.qty, 0);
      return { ...x, used, left: x.qty - used };
    });
    const expired = pp.expiry_date < today();
    return { ...pp, items, expired, usable: pp.status === 'active' && !expired && items.some(x => x.left > 0), redemptions: (red || []).filter(r => r.patient_package_id === pp.id) };
  });
}
async function redeem(env, me, b) {
  const pp = await env.DB.prepare('SELECT * FROM cl_patient_packages WHERE id=?').bind(parseInt(b.patient_package_id, 10)).first();
  if (!pp) return R(404, 'Package not found.');
  if (pp.status !== 'active') return R(400, 'This package is not active.');
  if (pp.expiry_date < today()) return R(400, `This package expired on ${pp.expiry_date}.`);
  const lines = (Array.isArray(b.items) ? b.items : []).map(x => ({ item_id: parseInt(x.item_id, 10), qty: parseInt(x.qty, 10) })).filter(x => x.item_id && x.qty > 0);
  if (!lines.length) return R(400, 'Choose what was used from the package.');
  const [state] = (await patientPackages(env, pp.patient_id)).filter(x => x.id === pp.id);
  for (const l of lines) {
    const it = state.items.find(x => x.item_id === l.item_id);
    if (!it) return R(400, 'That service is not part of this package.');
    if (l.qty > it.left) return R(400, `Only ${it.left} × ${it.name} left in this package.`);
  }
  let apptId = parseInt(b.appointment_id, 10) || null;
  if (apptId) {
    const a = await env.DB.prepare('SELECT * FROM cl_appointments WHERE id=? AND patient_id=?').bind(apptId, pp.patient_id).first();
    if (!a) return R(400, 'That appointment is not for this patient.');
  }
  for (const l of lines) await env.DB.prepare('INSERT INTO cl_redemptions (patient_package_id, item_id, qty, appointment_id, redeemed_on, staff_id) VALUES (?,?,?,?,?,?)').bind(pp.id, l.item_id, l.qty, apptId, today(), me.id).run();
  if (apptId) await env.DB.prepare("UPDATE cl_appointments SET closure=COALESCE(closure,'package'), updated_at=? WHERE id=?").bind(nowIso(), apptId).run();
  // Close the package when everything is used.
  const [after] = (await patientPackages(env, pp.patient_id)).filter(x => x.id === pp.id);
  if (after.items.every(x => x.left <= 0)) await env.DB.prepare("UPDATE cl_patient_packages SET status='closed' WHERE id=?").bind(pp.id).run();
  await audit(env, me, 'package.redeem', 'patient_package', pp.id, lines.map(l => `${l.qty}×${l.item_id}`).join(', '));
  return OK();
}
async function voidRedemption(env, me, id, b) {
  const reason = clean(b.reason, 200); if (reason.length < 4) return R(400, 'Give a reason.');
  const r = await env.DB.prepare('SELECT * FROM cl_redemptions WHERE id=? AND voided=0').bind(id).first();
  if (!r) return R(404, 'Not found.');
  await env.DB.prepare('UPDATE cl_redemptions SET voided=1 WHERE id=?').bind(id).run();
  await env.DB.prepare("UPDATE cl_patient_packages SET status='active' WHERE id=? AND status='closed'").bind(r.patient_package_id).run();
  await audit(env, me, 'package.redeem.void', 'redemption', id, reason);
  return OK();
}

/* ---------------- patients & leads ---------------- */
const patientNo = id => 'HW-' + String(id).padStart(6, '0');
async function searchPatients(env, q) {
  q = q.trim();
  let sql = "SELECT p.*, (SELECT MAX(start_at) FROM cl_appointments a WHERE a.patient_id=p.id AND a.status != 'cancelled') last_visit FROM cl_patients p WHERE p.status='active'";
  const bind = [];
  if (q) {
    const digits = q.replace(/\D/g, '');
    if (digits.length >= 4) { sql += ' AND (p.phone LIKE ? OR p.alt_phone LIKE ? OR p.patient_no LIKE ?)'; bind.push(`%${digits}%`, `%${digits}%`, `%${digits}%`); }
    else { sql += ' AND (p.name LIKE ? OR p.patient_no LIKE ?)'; bind.push(`%${q}%`, `%${q.toUpperCase()}%`); }
  }
  sql += ' ORDER BY p.id DESC LIMIT 60';
  const { results } = await env.DB.prepare(sql).bind(...bind).all();
  return results || [];
}
async function savePatient(env, me, id, b) {
  const f = {
    name: clean(b.name, 80), phone: last10(b.phone), alt_phone: last10(b.alt_phone) || null, email: clean(b.email, 120) || null,
    gender: ['female', 'male', 'other'].includes(b.gender) ? b.gender : null, dob: isDate(b.dob) ? b.dob : null,
    address: clean(b.address, 300) || null, medical_alert: clean(b.medical_alert, 300) || null, notes: clean(b.notes, 500) || null,
    source: clean(b.source, 40) || null,
  };
  if (f.name.length < 2) return R(400, 'Enter the patient\'s name.');
  if (f.phone.length !== 10) return R(400, 'Enter a 10-digit mobile number.');
  if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) return R(400, 'That email address does not look right.');
  if (!id) {
    const same = (await env.DB.prepare("SELECT id, name, patient_no FROM cl_patients WHERE phone=? AND status='active'").bind(f.phone).all()).results || [];
    if (same.length && !b.confirm_shared_phone) return R(409, 'This mobile number is already used.', { matches: same });
    const leadId = parseInt(b.lead_id, 10) || null;
    const res = await env.DB.prepare('INSERT INTO cl_patients (name, phone, alt_phone, email, gender, dob, address, medical_alert, notes, source, lead_id, ems_client_id, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(f.name, f.phone, f.alt_phone, f.email, f.gender, f.dob, f.address, f.medical_alert, f.notes, f.source || (leadId ? 'website' : 'walk-in'), leadId, null, me.id).run();
    id = res.meta.last_row_id;
    await env.DB.prepare('UPDATE cl_patients SET patient_no=? WHERE id=?').bind(patientNo(id), id).run();
    if (leadId) await env.DB.prepare("UPDATE leads SET status='contacted' WHERE id=? AND status='new'").bind(leadId).run();
    await audit(env, me, 'patient.add', 'patient', id, f.name);
    return OK({ id });
  }
  await env.DB.prepare('UPDATE cl_patients SET name=?, phone=?, alt_phone=?, email=?, gender=?, dob=?, address=?, medical_alert=?, notes=? WHERE id=?')
    .bind(f.name, f.phone, f.alt_phone, f.email, f.gender, f.dob, f.address, f.medical_alert, f.notes, id).run();
  await audit(env, me, 'patient.edit', 'patient', id, f.name);
  await emsRecheck(env, me, { patientId: id });
  return OK({ id });
}
async function balances(env, patientId) {
  const r = await env.DB.prepare(`SELECT
      (SELECT COALESCE(SUM(amount),0) FROM cl_payments WHERE patient_id=?1 AND voided=0) pay,
      (SELECT COALESCE(SUM(a.amount),0) FROM cl_allocations a JOIN cl_payments p ON p.id=a.payment_id WHERE p.patient_id=?1 AND p.voided=0) alloc,
      (SELECT COALESCE(SUM(i.total - COALESCE((SELECT SUM(a.amount) FROM cl_allocations a JOIN cl_payments p ON p.id=a.payment_id WHERE a.invoice_id=i.id AND p.voided=0),0)),0)
        FROM cl_invoices i WHERE i.patient_id=?1 AND i.status='final') due`).bind(patientId).first();
  return { advance: r2(r.pay - r.alloc), due: r2(r.due) };
}
async function patientDetail(env, id) {
  const p = await env.DB.prepare("SELECT * FROM cl_patients WHERE id=? AND status='active'").bind(id).first();
  if (!p) return null;
  const [appts, invs, pays, pkgs, bal] = await Promise.all([
    listAppointments(env, null, null, id),
    env.DB.prepare(`${INV_SELECT} WHERE i.patient_id=? ORDER BY i.id DESC`).bind(id).all().then(x => (x.results || []).map(withBalance)),
    env.DB.prepare(`SELECT p.*, s.name staff_name, (SELECT COALESCE(SUM(amount),0) FROM cl_allocations WHERE payment_id=p.id) allocated FROM cl_payments p LEFT JOIN ems_staff s ON s.id=p.received_by WHERE p.patient_id=? ORDER BY p.paid_on DESC, p.id DESC`).bind(id).all().then(x => x.results || []),
    patientPackages(env, id),
    balances(env, id),
  ]);
  const [ems, lead] = await Promise.all([
    emsForPatient(env, p),
    p.lead_id ? env.DB.prepare('SELECT id, interest, concern, created_at, source FROM leads WHERE id=?').bind(p.lead_id).first() : null,
  ]);
  return { patient: p, appointments: appts, invoices: invs, payments: pays, packages: pkgs, ...bal, ems_client: ems.client && ems.confirmed ? ems.client : null, ems, lead };
}
async function leads(env, status) {
  const where = status === 'all' ? '' : status === 'open' ? "WHERE l.status IN ('new','contacted')" : 'WHERE l.status=?';
  const { results } = await env.DB.prepare(`SELECT l.*, (SELECT id FROM cl_patients p WHERE p.lead_id=l.id OR (p.phone=substr(replace(replace(l.phone,' ',''),'+',''),-10) AND p.status='active') LIMIT 1) patient_id
    FROM leads l ${where} ORDER BY l.created_at DESC LIMIT 200`).bind(...(status === 'all' || status === 'open' ? [] : [status])).all();
  return results || [];
}
// Enquiries that arrive outside the website (Instagram DMs, WhatsApp, calls, walk-ins), entered by staff.
const LEAD_CHANNELS = ['instagram', 'facebook', 'whatsapp', 'phone', 'walk-in', 'referral', 'google', 'other'];
async function addLead(env, me, b) {
  const name = clean(b.name, 80), phone = normalisePhone(b.phone);
  const channel = LEAD_CHANNELS.includes(b.channel) ? b.channel : null;
  if (name.length < 2) return R(400, 'Enter the name.');
  if (!phone) return R(400, 'Enter a valid mobile number.');
  if (!channel) return R(400, 'Choose where the enquiry came from.');
  const date = isDate(b.preferred_date) ? b.preferred_date : null;
  const notes = [clean(b.notes, 400), `Added by ${me.name}`].filter(Boolean).join('\n');
  const res = await env.DB.prepare("INSERT INTO leads (source, request_type, name, phone, interest, concern, preferred_date, page, channel, notes) VALUES ('staff','Enquiry',?,?,?,?,?,'clinic app',?,?)")
    .bind(name, phone, nz(clean(b.interest, 120)), nz(clean(b.concern, 200)), date, channel, notes).run();
  await audit(env, me, 'lead.add', 'lead', res.meta.last_row_id, `${name} (${channel})`);
  return OK({ id: res.meta.last_row_id });
}
async function updateLead(env, me, id, b) {
  const st = ['new', 'contacted', 'booked', 'not interested'].includes(b.status) ? b.status : null;
  if (!st) return R(400, 'Choose a status.');
  await env.DB.prepare('UPDATE leads SET status=?, notes=COALESCE(?, notes) WHERE id=?').bind(st, nz(clean(b.notes, 500)), id).run();
  return OK();
}

/* ---------------- appointments ---------------- */
const APPT_SELECT = `SELECT a.*, p.name patient_name, p.phone patient_phone, p.patient_no, p.medical_alert, d.name dept_name, d.colour dept_colour,
  doc.name doctor_name, asst.name assistant_name, r.name room_name, i.invoice_no, i.status invoice_status
  FROM cl_appointments a JOIN cl_patients p ON p.id=a.patient_id LEFT JOIN cl_departments d ON d.id=a.dept_id
  LEFT JOIN ems_staff doc ON doc.id=a.doctor_id LEFT JOIN ems_staff asst ON asst.id=a.assistant_id LEFT JOIN cl_rooms r ON r.id=a.room_id
  LEFT JOIN cl_invoices i ON i.id=a.invoice_id`;
async function listAppointments(env, from, to, patient) {
  let sql = APPT_SELECT + ' WHERE 1=1'; const bind = [];
  if (patient) { sql += ' AND a.patient_id=?'; bind.push(+patient); }
  if (isDate(from)) { sql += ' AND a.start_at >= ?'; bind.push(from + 'T00:00'); }
  if (isDate(to)) { sql += ' AND a.start_at <= ?'; bind.push(to + 'T23:59'); }
  sql += patient ? ' ORDER BY a.start_at DESC LIMIT 200' : ' ORDER BY a.start_at LIMIT 1000';
  const { results } = await env.DB.prepare(sql).bind(...bind).all();
  return (results || []).map(a => ({ ...a, planned_items: parse(a.planned_items, []) }));
}
async function clash(env, id, field, value, start, minutes) {
  if (!value) return null;
  const end = addMin(start, minutes);
  const { results } = await env.DB.prepare(`SELECT a.id, a.start_at, a.minutes, p.name FROM cl_appointments a JOIN cl_patients p ON p.id=a.patient_id
    WHERE a.${field}=? AND a.id != ? AND a.status NOT IN ('cancelled','no_show') AND substr(a.start_at,1,10)=?`).bind(value, id || 0, start.slice(0, 10)).all();
  return (results || []).find(a => a.start_at < end && addMin(a.start_at, a.minutes) > start) || null;
}
async function saveAppointment(env, me, id, b) {
  const old = id ? await env.DB.prepare('SELECT * FROM cl_appointments WHERE id=?').bind(id).first() : null;
  if (id && !old) return R(404, 'Not found.');
  if (old && ['completed', 'cancelled', 'no_show'].includes(old.status) && !canManage(me)) return R(400, 'This appointment is closed. Ask a manager to change it.');
  const f = {
    patient_id: parseInt(b.patient_id, 10) || (old && old.patient_id), dept_id: parseInt(b.dept_id, 10) || null,
    doctor_id: parseInt(b.doctor_id, 10) || null, assistant_id: parseInt(b.assistant_id, 10) || null, room_id: parseInt(b.room_id, 10) || null,
    start_at: b.start_at, minutes: parseInt(b.minutes, 10) || 30, reason: clean(b.reason, 200) || null, notes: clean(b.notes, 500) || null,
    planned: (Array.isArray(b.planned_items) ? b.planned_items : []).map(x => ({ item_id: parseInt(x.item_id, 10), qty: parseInt(x.qty, 10) || 1 })).filter(x => x.item_id).slice(0, 30),
  };
  if (!f.patient_id || !(await env.DB.prepare("SELECT 1 FROM cl_patients WHERE id=? AND status='active'").bind(f.patient_id).first())) return R(400, 'Choose the patient.');
  if (!f.dept_id) return R(400, 'Choose the department.');
  if (!isLocal(f.start_at)) return R(400, 'Choose the date and time.');
  if (!(f.minutes >= 5 && f.minutes <= 480)) return R(400, 'Length must be 5–480 minutes.');
  if (!id && f.start_at.slice(0, 10) < today()) return R(400, 'That date has passed.');
  const [open, close] = HOURS[new Date(f.start_at.slice(0, 10) + 'T00:00:00Z').getUTCDay()];
  const st = f.start_at.slice(11, 16), en = addMin(f.start_at, f.minutes).slice(11, 16);
  if (st < open || en > close) { if (!b.outside_hours) return R(409, `Outside clinic hours (${open}–${close} that day).`, { code: 'hours' }); }
  if (f.doctor_id) {
    const doc = await env.DB.prepare('SELECT id, name, skills, active FROM ems_staff WHERE id=?').bind(f.doctor_id).first();
    if (!doc || !doc.active) return R(400, 'That clinician is not active.');
    if (!(await env.DB.prepare('SELECT 1 FROM cl_staff_depts WHERE staff_id=? AND dept_id=?').bind(f.doctor_id, f.dept_id).first()))
      return R(400, `${doc.name} is not set up to work in this department. An admin can change this in Settings → Team.`);
  }
  for (const [fld, val, label] of [['doctor_id', f.doctor_id, 'The clinician'], ['room_id', f.room_id, 'The room'], ['assistant_id', f.assistant_id, 'The assistant'], ['patient_id', f.patient_id, 'The patient']]) {
    const c = await clash(env, id, fld, val, f.start_at, f.minutes);
    if (c) return R(409, `${label} already has an appointment then (${c.name}, ${c.start_at.slice(11)}).`);
  }
  if (id) {
    await env.DB.prepare('UPDATE cl_appointments SET dept_id=?, doctor_id=?, assistant_id=?, room_id=?, start_at=?, minutes=?, reason=?, notes=?, planned_items=?, updated_at=? WHERE id=?')
      .bind(f.dept_id, f.doctor_id, f.assistant_id, f.room_id, f.start_at, f.minutes, f.reason, f.notes, JSON.stringify(f.planned), nowIso(), id).run();
    await audit(env, me, old.start_at !== f.start_at ? 'appt.reschedule' : 'appt.edit', 'appointment', id, `${old.start_at} → ${f.start_at}`);
    return OK({ id });
  }
  const res = await env.DB.prepare('INSERT INTO cl_appointments (patient_id, dept_id, doctor_id, assistant_id, room_id, start_at, minutes, reason, notes, planned_items, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .bind(f.patient_id, f.dept_id, f.doctor_id, f.assistant_id, f.room_id, f.start_at, f.minutes, f.reason, f.notes, JSON.stringify(f.planned), me.id).run();
  const p = await env.DB.prepare('SELECT lead_id FROM cl_patients WHERE id=?').bind(f.patient_id).first();
  if (p && p.lead_id) await env.DB.prepare("UPDATE leads SET status='booked' WHERE id=? AND status IN ('new','contacted')").bind(p.lead_id).run();
  await audit(env, me, 'appt.add', 'appointment', res.meta.last_row_id, f.start_at);
  return OK({ id: res.meta.last_row_id });
}
async function setStatus(env, me, id, b) {
  const a = await env.DB.prepare('SELECT * FROM cl_appointments WHERE id=?').bind(id).first();
  if (!a) return R(404, 'Not found.');
  const st = APPT_STATUS.includes(b.status) ? b.status : null;
  if (!st) return R(400, 'Unknown status.');
  if (['completed', 'cancelled', 'no_show'].includes(a.status) && !canManage(me)) return R(400, 'This appointment is closed. Ask a manager to reopen it.');
  if (st === 'cancelled' && a.invoice_id) return R(400, 'This visit has an invoice. Cancel or delete the invoice first.');
  await env.DB.prepare('UPDATE cl_appointments SET status=?, notes=COALESCE(?, notes), updated_at=? WHERE id=?').bind(st, nz(clean(b.notes, 500)), nowIso(), id).run();
  await audit(env, me, 'appt.status', 'appointment', id, `${a.status} → ${st}`);
  return OK();
}
async function noCharge(env, me, id, b) {
  const reason = clean(b.reason, 200);
  if (reason.length < 5) return R(400, 'Give the reason there is no charge (for example, review included in treatment).');
  const a = await env.DB.prepare('SELECT * FROM cl_appointments WHERE id=?').bind(id).first();
  if (!a) return R(404, 'Not found.');
  if (a.invoice_id) return R(400, 'This visit already has an invoice.');
  await env.DB.prepare("UPDATE cl_appointments SET closure='no_charge', closure_note=?, status=CASE WHEN status IN ('booked','arrived','in_treatment') THEN 'completed' ELSE status END, updated_at=? WHERE id=?").bind(`${reason} — ${me.name}`, nowIso(), id).run();
  await audit(env, me, 'appt.no_charge', 'appointment', id, reason);
  return OK();
}

/* ---------------- billing ---------------- */
const INV_SELECT = `SELECT i.*, p.name patient_name, p.patient_no, p.phone patient_phone,
  COALESCE((SELECT SUM(a.amount) FROM cl_allocations a JOIN cl_payments pay ON pay.id=a.payment_id WHERE a.invoice_id=i.id AND pay.voided=0),0) paid
  FROM cl_invoices i JOIN cl_patients p ON p.id=i.patient_id`;
const withBalance = i => ({ ...i, balance: i.status === 'final' ? r2(i.total - i.paid) : 0 });
async function listInvoices(env, from, to, status) {
  let sql = INV_SELECT + ' WHERE 1=1'; const bind = [];
  if (isDate(from)) { sql += ' AND i.invoice_date >= ?'; bind.push(from); }
  if (isDate(to)) { sql += ' AND i.invoice_date <= ?'; bind.push(to); }
  if (['draft', 'final', 'cancelled'].includes(status)) { sql += ' AND i.status=?'; bind.push(status); }
  sql += ' ORDER BY i.invoice_date DESC, i.id DESC LIMIT 500';
  const { results } = await env.DB.prepare(sql).bind(...bind).all();
  return (results || []).map(withBalance);
}
async function invoiceDetail(env, id) {
  const inv = await env.DB.prepare(INV_SELECT + ' WHERE i.id=?').bind(id).first();
  if (!inv) return null;
  const { results: lines } = await env.DB.prepare('SELECT l.*, s.name doctor_name FROM cl_invoice_lines l LEFT JOIN ems_staff s ON s.id=l.doctor_id WHERE l.invoice_id=? ORDER BY l.id').bind(id).all();
  const { results: allocs } = await env.DB.prepare('SELECT a.*, p.paid_on, p.mode, p.reference, p.lender FROM cl_allocations a JOIN cl_payments p ON p.id=a.payment_id WHERE a.invoice_id=? AND p.voided=0 ORDER BY p.paid_on').bind(id).all();
  const bal = await balances(env, inv.patient_id);
  return { invoice: withBalance(inv), lines: (lines || []).map(l => ({ ...l, tax_parts: parse(l.tax_parts, null) })), payments: allocs || [], advance: bal.advance };
}
// Used by treatment plans: a draft bill with the given lines. Returns the invoice id, or the
// error from saveInvoice (e.g. a discount needing authorisation), in which case the draft is removed.
// `trusted` ({id, name}) is for server-side callers whose own rules already approved any discount (EMS packages).
export async function createInvoiceWithLines(env, me, patientId, lines, authoriser, trusted) {
  const id = (await env.DB.prepare('INSERT INTO cl_invoices (patient_id, invoice_date, created_by) VALUES (?,?,?)').bind(patientId, today(), me.id).run()).meta.last_row_id;
  const r = await saveInvoice(env, me, id, { lines, authoriser }, trusted);
  if (r[0] !== 200) {
    await env.DB.prepare('DELETE FROM cl_invoice_lines WHERE invoice_id=?').bind(id).run();
    await env.DB.prepare('DELETE FROM cl_invoices WHERE id=?').bind(id).run();
    return r;
  }
  await audit(env, me, 'invoice.draft', 'invoice', id, trusted ? 'EMS package' : 'from treatment plan');
  return OK({ id });
}
async function createInvoice(env, me, b) {
  const patientId = parseInt(b.patient_id, 10);
  if (!(await env.DB.prepare("SELECT 1 FROM cl_patients WHERE id=? AND status='active'").bind(patientId).first())) return R(400, 'Choose the patient.');
  let apptId = parseInt(b.appointment_id, 10) || null, lines = [];
  if (apptId) {
    const a = await env.DB.prepare('SELECT * FROM cl_appointments WHERE id=? AND patient_id=?').bind(apptId, patientId).first();
    if (!a) return R(400, 'That appointment is not for this patient.');
    if (a.invoice_id) { const ex = await env.DB.prepare('SELECT id, status FROM cl_invoices WHERE id=?').bind(a.invoice_id).first(); if (ex && ex.status !== 'cancelled') return OK({ id: ex.id, existing: true }); }
    lines = parse(a.planned_items, []).map(x => ({ item_id: x.item_id, qty: x.qty, doctor_id: a.doctor_id }));
  }
  const res = await env.DB.prepare('INSERT INTO cl_invoices (patient_id, appointment_id, invoice_date, created_by) VALUES (?,?,?,?)').bind(patientId, apptId, today(), me.id).run();
  const id = res.meta.last_row_id;
  if (apptId) await env.DB.prepare('UPDATE cl_appointments SET invoice_id=? WHERE id=?').bind(id, apptId).run();
  if (lines.length) { const r = await saveInvoice(env, me, id, { lines }); if (r[0] !== 200) return r; }
  await audit(env, me, 'invoice.draft', 'invoice', id, apptId ? `from appointment ${apptId}` : '');
  return OK({ id });
}

// Compute one line. Returns the stored row (all money server-side).
function computeLine(src, item, pkg) {
  const qty = src.qty;
  let unit, kind, name, hsn = null, rate = 0, partner = null, parts = null;
  if (pkg) { unit = pkg.price; kind = 'package'; name = pkg.name; }
  else { kind = item.kind; name = item.code === EMS_ITEM && src.label ? src.label : item.name; hsn = item.hsn_sac; rate = kind === 'passthrough' ? 0 : item.gst_rate; partner = item.partner; unit = item.price > 0 ? item.price : r2(src.unit_price); }
  const gross = r2(unit * qty);
  const discount = Math.min(gross, Math.max(0, r2(src.discount)));
  const net = r2(gross - discount);
  let taxable = 0, exempt = 0, cgst = 0, sgst = 0;
  if (kind === 'package') {
    // Split the package value across its contents by list value, then tax each part at its own rate.
    const list = pkg.items.reduce((s, x) => s + x.price * x.qty, 0) || 1;
    const byRate = {};
    for (const x of pkg.items) byRate[x.gst_rate] = (byRate[x.gst_rate] || 0) + x.price * x.qty / list * net;
    parts = Object.entries(byRate).map(([rt, v]) => ({ rate: +rt, value: r2(v) }));
    // Make the parts add up exactly to net.
    const diff = r2(net - parts.reduce((s, x) => s + x.value, 0)); if (parts.length) parts[parts.length - 1].value = r2(parts[parts.length - 1].value + diff);
    for (const pt of parts) { if (pt.rate > 0) { taxable = r2(taxable + pt.value); const t = r2(pt.value * pt.rate / 200); cgst = r2(cgst + t); sgst = r2(sgst + t); } else exempt = r2(exempt + pt.value); }
    rate = taxable ? r2((cgst + sgst) / taxable * 100) : 0;
  } else if (kind !== 'passthrough') {
    if (rate > 0) { taxable = net; cgst = r2(net * rate / 200); sgst = cgst; } else exempt = net;
  }
  return { item_id: item ? item.id : null, package_def_id: pkg ? pkg.id : null, kind, name, hsn_sac: hsn, qty, unit_price: unit, discount, gst_rate: rate, taxable, exempt, cgst, sgst, total: r2(net + cgst + sgst), tax_parts: parts ? JSON.stringify(parts) : null, doctor_id: src.doctor_id || null, partner, gross };
}

async function saveInvoice(env, me, id, b, trusted) {
  const inv = await env.DB.prepare('SELECT * FROM cl_invoices WHERE id=?').bind(id).first();
  if (!inv) return R(404, 'Not found.');
  if (inv.status !== 'draft') return R(400, 'Only draft invoices can be changed.');
  const src = (Array.isArray(b.lines) ? b.lines : []).slice(0, 60).map(l => ({
    item_id: parseInt(l.item_id, 10) || null, package_def_id: parseInt(l.package_def_id, 10) || null,
    qty: Math.max(1, Math.min(999, parseInt(l.qty, 10) || 1)), unit_price: Number(l.unit_price) || 0,
    discount: Number(l.discount) || 0, discount_reason: clean(l.discount_reason, 120) || null, doctor_id: parseInt(l.doctor_id, 10) || null,
    label: clean(l.label, 120) || null,
  }));
  const items = await itemMap(env, src.filter(l => l.item_id).map(l => l.item_id));
  const defs = new Map((await packageDefs(env)).map(d => [d.id, d]));
  const s = await settings(env), limit = Number(s.discount_limit_pct) || 0;
  const { results: prevLines } = await env.DB.prepare('SELECT * FROM cl_invoice_lines WHERE invoice_id=?').bind(id).all();
  // Authoriser, if any line goes over the discount limit and the user can't authorise.
  const sets = await settings(env);
  let authoriser = trusted || (canAuthorise(me, sets) ? { id: me.id, name: me.name } : null);
  let authChecked = false;
  const rows = [];
  for (const l of src) {
    const item = l.item_id ? items.get(l.item_id) : null, pkg = l.package_def_id ? defs.get(l.package_def_id) : null;
    if (!item && !pkg) return R(400, 'One of the lines has no catalogue item.');
    if (item && !item.active) return R(400, `${item.name} is no longer active in the catalogue.`);
    // The EMS package item is billed only from the EMS app, which sends the package name as the label.
    if (item && !item.sellable && !(item.code === EMS_ITEM && l.label)) return R(400, item.code === EMS_ITEM ? 'Sell EMS packages from the EMS app; the bill appears here.' : `${item.name} is for internal use and cannot be billed.`);
    if (pkg && !pkg.active) return R(400, `${pkg.name} is no longer on sale.`);
    if (item && item.price <= 0 && !(l.unit_price > 0)) return R(400, `Enter the price for ${item.name} (its price varies).`);
    if (item && item.code === EMS_ITEM && !trusted) {
      // An EMS package line keeps the price, discount and name the EMS app gave it.
      const prev = (prevLines || []).find(x => x.item_id === item.id);
      if (!prev) return R(400, 'Sell EMS packages from the EMS app; the bill appears here.');
      Object.assign(l, { qty: 1, unit_price: prev.unit_price, discount: prev.discount, discount_reason: prev.discount_reason, label: prev.name });
    }
    const row = computeLine(l, item, pkg);
    row.discount_reason = l.discount_reason; row.discount_by = null; row.discount_by_name = null;
    if (row.discount > 0) {
      if (!row.discount_reason) return R(400, `Give a reason for the discount on ${row.name}.`);
      const pct = row.gross ? row.discount / row.gross * 100 : 0;
      if (pct > limit + 1e-9) {
        // Keep an earlier authorisation if this line's discount has not gone up.
        const prev = (prevLines || []).find(p => p.item_id === row.item_id && p.package_def_id === row.package_def_id && p.discount_by && p.discount >= row.discount);
        if (prev) { row.discount_by = prev.discount_by; row.discount_by_name = prev.discount_by_name; }
        else {
          if (!authoriser && !authChecked) {
            authChecked = true;
            const a = b.authoriser || {};
            const u = a.username ? await env.DB.prepare('SELECT id, name, role, skills, pass_hash, apps FROM ems_staff WHERE username=? AND active=1').bind(clean(a.username, 40).toLowerCase()).first() : null;
            if (u && canAuthorise({ id: u.id, admin: u.role === 'admin', skills: parse(u.skills, []) }, sets) && await verifySecret(String(a.password || ''), u.pass_hash)) authoriser = { id: u.id, name: u.name };
          }
          if (!authoriser) return R(403, `The discount on ${row.name} is over ${limit}%. ${approverIds(sets).length ? 'An approved person' : 'A doctor or admin'} must authorise it.`, { code: 'authorise' });
          row.discount_by = authoriser.id; row.discount_by_name = authoriser.name;
        }
      }
    }
    rows.push(row);
  }
  await env.DB.prepare('DELETE FROM cl_invoice_lines WHERE invoice_id=?').bind(id).run();
  for (const r of rows) await env.DB.prepare(`INSERT INTO cl_invoice_lines (invoice_id, item_id, package_def_id, kind, name, hsn_sac, qty, unit_price, discount, discount_reason, discount_by, discount_by_name, gst_rate, taxable, exempt, cgst, sgst, total, tax_parts, doctor_id, partner)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, r.item_id, r.package_def_id, r.kind, r.name, r.hsn_sac, r.qty, r.unit_price, r.discount, r.discount_reason, r.discount_by, r.discount_by_name, r.gst_rate, r.taxable, r.exempt, r.cgst, r.sgst, r.total, r.tax_parts, r.doctor_id, r.partner).run();
  const t = rows.reduce((a, r) => {
    if (r.kind === 'passthrough') a.passthrough += r.total; else { a.gross += r.gross; a.discount += r.discount; }
    a.taxable += r.taxable; a.exempt += r.exempt; a.cgst += r.cgst; a.sgst += r.sgst; a.total += r.total; return a;
  }, { gross: 0, discount: 0, taxable: 0, exempt: 0, cgst: 0, sgst: 0, passthrough: 0, total: 0 });
  await env.DB.prepare('UPDATE cl_invoices SET gross=?, discount=?, taxable=?, exempt=?, cgst=?, sgst=?, passthrough=?, total=?, notes=? WHERE id=?')
    .bind(r2(t.gross), r2(t.discount), r2(t.taxable), r2(t.exempt), r2(t.cgst), r2(t.sgst), r2(t.passthrough), r2(t.total), nz(clean(b.notes, 300)), id).run();
  return OK({ total: r2(t.total) });
}
async function deleteDraft(env, me, id) {
  const inv = await env.DB.prepare('SELECT * FROM cl_invoices WHERE id=?').bind(id).first();
  if (!inv || inv.status !== 'draft') return R(400, 'Only drafts can be deleted.');
  await env.DB.prepare('DELETE FROM cl_invoice_lines WHERE invoice_id=?').bind(id).run();
  await env.DB.prepare('DELETE FROM cl_invoices WHERE id=?').bind(id).run();
  await env.DB.prepare('UPDATE cl_appointments SET invoice_id=NULL WHERE invoice_id=?').bind(id).run();
  await env.DB.prepare('UPDATE ems_client_packages SET invoice_id=NULL WHERE invoice_id=?').bind(id).run();
  await audit(env, me, 'invoice.delete_draft', 'invoice', id);
  return OK();
}
// Invoice numbers continue the previous system's series: HW/<year the financial year starts>/00001 (e.g. HW/2026/00180 for FY 2026-27).
const fyOf = d => { const y = +d.slice(0, 4), m = +d.slice(5, 7); return String(m >= 4 ? y : y - 1); };
export async function finalise(env, me, id) {
  const inv = await env.DB.prepare('SELECT * FROM cl_invoices WHERE id=?').bind(id).first();
  if (!inv) return R(404, 'Not found.');
  if (inv.status !== 'draft') return R(400, 'This invoice is already final.');
  const n = await env.DB.prepare('SELECT COUNT(*) n FROM cl_invoice_lines WHERE invoice_id=?').bind(id).first();
  if (!n.n) return R(400, 'Add at least one line.');
  const s = await settings(env);
  const d = today(), fy = fyOf(d), prefix = `${s.invoice_prefix || 'HW'}/${fy}/`;
  let no = null;
  for (let attempt = 0; attempt < 5 && !no; attempt++) {
    const last = await env.DB.prepare('SELECT invoice_no FROM cl_invoices WHERE invoice_no LIKE ? ORDER BY length(invoice_no) DESC, invoice_no DESC LIMIT 1').bind(prefix + '%').first();
    const seq = (last ? parseInt(last.invoice_no.slice(prefix.length), 10) : 0) + 1 + attempt;
    const candidate = prefix + String(seq).padStart(5, '0');
    try { await env.DB.prepare("UPDATE cl_invoices SET invoice_no=?, status='final', invoice_date=?, finalised_by=?, finalised_at=? WHERE id=? AND status='draft'").bind(candidate, d, me.id, nowIso(), id).run(); no = candidate; }
    catch (e) { if (!/UNIQUE/i.test(String(e))) throw e; }
  }
  if (!no) return R(500, 'Could not number the invoice. Please try again.');
  // Packages sold on this invoice become usable.
  const { results: pl } = await env.DB.prepare("SELECT * FROM cl_invoice_lines WHERE invoice_id=? AND kind='package'").bind(id).all();
  for (const l of pl || []) {
    const def = (await packageDefs(env)).find(x => x.id === l.package_def_id);
    if (!def) continue;
    for (let k = 0; k < l.qty; k++) await env.DB.prepare('INSERT INTO cl_patient_packages (patient_id, def_id, name, items, invoice_id, line_id, start_date, expiry_date) VALUES (?,?,?,?,?,?,?,?)')
      .bind(inv.patient_id, def.id, def.name, JSON.stringify(def.items.map(x => ({ item_id: x.item_id, name: x.name, qty: x.qty }))), id, l.id, d, addDays(d, def.validity_days)).run();
  }
  if (inv.appointment_id) await env.DB.prepare("UPDATE cl_appointments SET closure='billed', updated_at=? WHERE id=?").bind(nowIso(), inv.appointment_id).run();
  // Products sold go out of stock (first expiry first).
  await stockOutForInvoice(env, me, id);
  // Use any advance automatically, oldest payment first.
  await autoApplyAdvance(env, me, inv.patient_id, id);
  await audit(env, me, 'invoice.final', 'invoice', id, no);
  return OK({ invoice_no: no });
}
async function invoiceBalance(env, id) {
  const i = await env.DB.prepare(INV_SELECT + ' WHERE i.id=?').bind(id).first();
  return i ? r2(i.total - i.paid) : 0;
}
async function unallocated(env, patientId) {
  const { results } = await env.DB.prepare(`SELECT p.id, p.amount - COALESCE((SELECT SUM(amount) FROM cl_allocations WHERE payment_id=p.id),0) free
    FROM cl_payments p WHERE p.patient_id=? AND p.voided=0 ORDER BY p.paid_on, p.id`).bind(patientId).all();
  return (results || []).filter(x => x.free > 0.004);
}
async function autoApplyAdvance(env, me, patientId, invoiceId) {
  let need = await invoiceBalance(env, invoiceId);
  for (const p of await unallocated(env, patientId)) {
    if (need <= 0.004) break;
    const amt = r2(Math.min(need, p.free));
    await env.DB.prepare('INSERT INTO cl_allocations (payment_id, invoice_id, amount, created_by) VALUES (?,?,?,?)').bind(p.id, invoiceId, amt, me.id).run();
    need = r2(need - amt);
  }
}
async function cancelInvoice(env, me, id, b) {
  const reason = clean(b.reason, 200); if (reason.length < 5) return R(400, 'Give the reason for cancelling.');
  const inv = await env.DB.prepare('SELECT * FROM cl_invoices WHERE id=?').bind(id).first();
  if (!inv || inv.status !== 'final') return R(400, 'Only final invoices can be cancelled (delete drafts instead).');
  const used = await env.DB.prepare('SELECT COUNT(*) n FROM cl_redemptions r JOIN cl_patient_packages pp ON pp.id=r.patient_package_id WHERE pp.invoice_id=? AND r.voided=0').bind(id).first();
  if (used.n) return R(400, 'A package on this invoice has already been used. Void those redemptions first.');
  // Money already paid stays with the patient as advance.
  await env.DB.prepare('DELETE FROM cl_allocations WHERE invoice_id=?').bind(id).run();
  await env.DB.prepare("UPDATE cl_invoices SET status='cancelled', cancelled_by=?, cancelled_at=?, cancel_reason=? WHERE id=?").bind(me.id, nowIso(), reason, id).run();
  await env.DB.prepare("UPDATE cl_patient_packages SET status='cancelled' WHERE invoice_id=?").bind(id).run();
  await stockBackForInvoice(env, me, id);
  await env.DB.prepare("UPDATE cl_appointments SET closure=NULL, invoice_id=NULL WHERE invoice_id=?").bind(id).run();
  await audit(env, me, 'invoice.cancel', 'invoice', id, `${inv.invoice_no}: ${reason}`);
  return OK();
}

/* ---------------- payments ---------------- */
async function recordPayment(env, me, b) {
  const patientId = parseInt(b.patient_id, 10);
  if (!(await env.DB.prepare("SELECT 1 FROM cl_patients WHERE id=? AND status='active'").bind(patientId).first())) return R(400, 'Choose the patient.');
  const amount = r2(b.amount), mode = MODES[b.mode] ? b.mode : null;
  if (!(amount > 0 && amount < 10000000)) return R(400, 'Enter the amount received.');
  if (!mode) return R(400, 'Choose how it was paid.');
  // The finance company only applies to finance payments (the form's hidden field defaults to Fibe).
  const reference = clean(b.reference, 80), lender = b.mode === 'finance' ? clean(b.lender, 60) : '';
  if (mode !== 'cash' && reference.length < 4) return R(400, mode === 'card' ? 'Enter the POS slip / approval number.' : mode === 'upi' ? 'Enter the UPI transaction reference (UTR).' : mode === 'finance' ? 'Enter the loan or disbursement reference.' : 'Enter the bank transfer reference.');
  if (mode === 'finance' && !lender) return R(400, 'Enter the finance company (for example, Fibe).');
  const paidOn = isDate(b.paid_on) && b.paid_on <= today() ? b.paid_on : today();
  if (reference && mode !== 'cash') {
    const dup = await env.DB.prepare('SELECT id FROM cl_payments WHERE mode=? AND reference=? AND voided=0').bind(mode, reference).first();
    if (dup) return R(400, 'A payment with this reference is already recorded. Check it has not been entered twice.');
  }
  const invId = parseInt(b.invoice_id, 10) || null;
  let apply = 0;
  if (invId) {
    const inv = await env.DB.prepare('SELECT * FROM cl_invoices WHERE id=? AND patient_id=?').bind(invId, patientId).first();
    if (!inv) return R(400, 'That invoice is not for this patient.');
    if (inv.status !== 'final') return R(400, 'Finalise the invoice before taking payment against it.');
    apply = Math.min(amount, await invoiceBalance(env, invId));
  }
  const res = await env.DB.prepare('INSERT INTO cl_payments (patient_id, paid_on, amount, mode, reference, lender, received_by, notes) VALUES (?,?,?,?,?,?,?,?)')
    .bind(patientId, paidOn, amount, mode, nz(reference), nz(lender), me.id, nz(clean(b.notes, 200))).run();
  const pid = res.meta.last_row_id;
  if (apply > 0) await env.DB.prepare('INSERT INTO cl_allocations (payment_id, invoice_id, amount, created_by) VALUES (?,?,?,?)').bind(pid, invId, r2(apply), me.id).run();
  await audit(env, me, 'payment.add', 'payment', pid, `₹${amount} ${mode} ${reference}`);
  return OK({ id: pid, applied: r2(apply), advance: r2(amount - apply) });
}
async function applyAdvance(env, me, b) {
  const invId = parseInt(b.invoice_id, 10);
  const inv = await env.DB.prepare('SELECT * FROM cl_invoices WHERE id=?').bind(invId).first();
  if (!inv || inv.status !== 'final') return R(400, 'Choose a final invoice.');
  const before = await invoiceBalance(env, invId);
  if (before <= 0) return R(400, 'This invoice is already paid.');
  await autoApplyAdvance(env, me, inv.patient_id, invId);
  const after = await invoiceBalance(env, invId);
  if (after === before) return R(400, 'This patient has no advance to apply.');
  await audit(env, me, 'advance.apply', 'invoice', invId, `₹${r2(before - after)}`);
  return OK({ applied: r2(before - after) });
}
async function voidPayment(env, me, id, b) {
  const reason = clean(b.reason, 200); if (reason.length < 5) return R(400, 'Give the reason (for example, entered twice).');
  const p = await env.DB.prepare('SELECT * FROM cl_payments WHERE id=? AND voided=0').bind(id).first();
  if (!p) return R(404, 'Not found.');
  if (p.deposit_id) return R(400, 'This cash is already in a bank deposit.');
  await env.DB.prepare('DELETE FROM cl_allocations WHERE payment_id=?').bind(id).run();
  await env.DB.prepare('UPDATE cl_payments SET voided=1, voided_by=?, void_reason=? WHERE id=?').bind(me.id, reason, id).run();
  await audit(env, me, 'payment.void', 'payment', id, reason);
  return OK();
}
async function listPayments(env, from, to) {
  const f = isDate(from) ? from : addDays(today(), -30), t = isDate(to) ? to : today();
  const { results } = await env.DB.prepare(`SELECT p.*, pt.name patient_name, pt.patient_no, s.name staff_name,
    (SELECT group_concat(i.invoice_no, ', ') FROM cl_allocations a JOIN cl_invoices i ON i.id=a.invoice_id WHERE a.payment_id=p.id) invoices,
    (SELECT COALESCE(SUM(amount),0) FROM cl_allocations WHERE payment_id=p.id) allocated
    FROM cl_payments p JOIN cl_patients pt ON pt.id=p.patient_id LEFT JOIN ems_staff s ON s.id=p.received_by
    WHERE p.paid_on BETWEEN ? AND ? ORDER BY p.paid_on DESC, p.id DESC`).bind(f, t).all();
  return results || [];
}
// Cash book counts cash taken in this app only — payments carried over from the previous system were banked there.
const CASH_SQL = [
  "SELECT COALESCE(SUM(amount),0) s FROM cl_payments WHERE mode='cash' AND voided=0 AND legacy=0",
  'SELECT COALESCE(SUM(amount),0) s FROM cl_cash_deposits',
  'SELECT * FROM cl_cash_deposits ORDER BY deposited_on DESC, id DESC LIMIT 60',
  "SELECT MIN(paid_on) d FROM cl_payments WHERE mode='cash' AND voided=0 AND legacy=0 AND paid_on > COALESCE((SELECT MAX(deposited_on) FROM cl_cash_deposits), '0000')",
];
function cashFrom([cash, dep, deposits, since]) {
  const c = cash.results[0].s, d = dep.results[0].s;
  return { in_hand: r2(c - d), received: r2(c), deposited: r2(d), deposits: deposits.results || [], oldest_undeposited: since.results[0].d };
}
async function cashBook(env) { return cashFrom(await env.DB.batch(CASH_SQL.map(q => env.DB.prepare(q)))); }
async function addDeposit(env, me, b) {
  const amount = r2(b.amount), ref = clean(b.reference, 80);
  if (!(amount > 0)) return R(400, 'Enter the amount deposited.');
  if (ref.length < 4) return R(400, 'Enter the bank deposit reference or slip number.');
  const book = await cashBook(env);
  if (amount > book.in_hand + 0.004) return R(400, `That is more than the cash in hand (₹${book.in_hand}).`);
  const d = isDate(b.deposited_on) && b.deposited_on <= today() ? b.deposited_on : today();
  await env.DB.prepare('INSERT INTO cl_cash_deposits (deposited_on, amount, bank, reference, staff_id, staff_name) VALUES (?,?,?,?,?,?)').bind(d, amount, nz(clean(b.bank, 60)), ref, me.id, me.name).run();
  await audit(env, me, 'cash.deposit', 'deposit', null, `₹${amount} ${ref}`);
  return OK();
}

/* ---------------- dashboard & reports ---------------- */
async function unclosed(env) {
  const { results } = await env.DB.prepare(APPT_SELECT + " WHERE a.status='completed' AND (a.closure IS NULL OR (a.closure='billed' AND i.status='draft')) ORDER BY a.start_at DESC LIMIT 100").all();
  return results || [];
}
async function dashboard(env, me) {
  const d = today(), P = (q, ...b) => env.DB.prepare(q).bind(...b);
  const stockQ = stockAlertStmts(env), recallQ = recallStmt(env, 'due');
  const res = await env.DB.batch([
    P(APPT_SELECT + ' WHERE a.start_at >= ? AND a.start_at <= ? ORDER BY a.start_at LIMIT 1000', d + 'T00:00', d + 'T23:59'),
    P(APPT_SELECT + " WHERE a.status='completed' AND (a.closure IS NULL OR (a.closure='billed' AND i.status='draft')) ORDER BY a.start_at DESC LIMIT 100"),
    P('SELECT mode, COALESCE(SUM(amount),0) s, COUNT(*) n FROM cl_payments WHERE paid_on=? AND voided=0 AND legacy=0 GROUP BY mode', d),
    env.DB.prepare(`SELECT COUNT(*) n, COALESCE(SUM(i.total - COALESCE((SELECT SUM(a.amount) FROM cl_allocations a JOIN cl_payments p ON p.id=a.payment_id WHERE a.invoice_id=i.id AND p.voided=0),0)),0) s FROM cl_invoices i WHERE i.status='final' AND i.total - COALESCE((SELECT SUM(a.amount) FROM cl_allocations a JOIN cl_payments p ON p.id=a.payment_id WHERE a.invoice_id=i.id AND p.voided=0),0) > 0.004`),
    P("SELECT COUNT(*) n FROM leads WHERE status='new'"),
    P("SELECT COALESCE(SUM(total - passthrough),0) s FROM cl_invoices WHERE status='final' AND legacy=0 AND invoice_date=?", d),
    ...CASH_SQL.map(q => P(q)),
    ...stockQ, recallQ,
  ]);
  const [appts, open, pays, out, lds, billed] = res.slice(0, 6).map(x => x.results || []);
  const cash = cashFrom(res.slice(6, 10));
  const stock = stockAlertsFrom(res.slice(10, 10 + stockQ.length));
  const recalls = res[10 + stockQ.length].results || [];
  return { today: d, appointments: appts.map(a => ({ ...a, planned_items: parse(a.planned_items, []) })), unclosed: open, collections: pays, cash,
    outstanding: { count: out[0].n, amount: r2(out[0].s) }, new_leads: lds[0].n, billed_today: r2(billed[0].s), stock, recalls };
}
// Front-desk reminders, checked every minute by the app and shown as a flashing bar until dealt with:
//  checkin  — booked, 15 min past the start time, not marked arrived (or no-show) — includes the last 14 days
//  overrun  — arrived / in treatment, 15 min past the planned end, not marked completed
//  unbilled — completed but not billed, taken from a package or marked no charge (or the bill is still a draft)
//  unpaid   — billed today but payment not (fully) collected
const GRACE_MIN = 15;
async function visitAlerts(env) {
  const now = nowLocal(), d = today(), from = addDays(d, -14) + 'T00:00';
  const late = new Date(Date.parse(now + ':00Z') - GRACE_MIN * 60000).toISOString().slice(0, 16);
  const [a, b, c, u] = await env.DB.batch([
    env.DB.prepare(APPT_SELECT + " WHERE a.status='booked' AND a.start_at >= ? AND a.start_at <= ? ORDER BY a.start_at").bind(from, late),
    env.DB.prepare(APPT_SELECT + " WHERE a.status IN ('arrived','in_treatment') AND a.start_at >= ? AND strftime('%Y-%m-%dT%H:%M', a.start_at, '+' || (a.minutes + ?) || ' minutes') <= ? ORDER BY a.start_at").bind(from, GRACE_MIN, now),
    env.DB.prepare(APPT_SELECT + " WHERE a.status='completed' AND (a.closure IS NULL OR (a.closure='billed' AND i.status='draft')) ORDER BY a.start_at DESC LIMIT 100"),
    env.DB.prepare(`SELECT * FROM (${INV_SELECT} WHERE i.status='final' AND i.legacy=0 AND i.invoice_date=?) WHERE total - paid > 0.004 ORDER BY id`).bind(d),
  ]);
  const tag = (rows, kind) => (rows.results || []).map(x => ({ ...x, kind }));
  const unpaid = (u.results || []).map(withBalance);
  const ems = await emsAlerts(env, now, GRACE_MIN);
  return { now, ...ems, checkin: tag(a, 'checkin'), overrun: tag(b, 'overrun'), unbilled: tag(c, 'unbilled'), unpaid, unpaid_total: r2(unpaid.reduce((s2, x) => s2 + x.balance, 0)) };
}
async function dayBook(env, d) {
  const [invs, pays] = await Promise.all([
    env.DB.prepare(INV_SELECT + " WHERE i.invoice_date=? AND i.legacy=0 AND i.status IN ('final','cancelled') ORDER BY i.invoice_no").bind(d).all().then(x => (x.results || []).map(withBalance)),
    listPayments(env, d, d),
  ]);
  const byMode = {};
  for (const p of pays.filter(x => !x.voided && !x.legacy)) byMode[p.mode] = r2((byMode[p.mode] || 0) + p.amount);
  const fin = invs.filter(i => i.status === 'final');
  const sum = k => r2(fin.reduce((s, i) => s + i[k], 0));
  return { date: d, invoices: invs, payments: pays, by_mode: byMode, totals: { invoiced: sum('total'), taxable: sum('taxable'), exempt: sum('exempt'), cgst: sum('cgst'), sgst: sum('sgst'), passthrough: sum('passthrough'), collected: r2(Object.values(byMode).reduce((a, b) => a + b, 0)) } };
}
async function summary(env, month) {
  const m = /^\d{4}-\d{2}$/.test(month || '') ? month : today().slice(0, 7);
  const from = m + '-01', to = m + '-31';
  const { results: gst } = await env.DB.prepare(`SELECT l.gst_rate rate, l.kind, l.tax_parts, l.taxable, l.exempt, l.cgst, l.sgst, l.total FROM cl_invoice_lines l JOIN cl_invoices i ON i.id=l.invoice_id
    WHERE i.status='final' AND i.legacy=0 AND i.invoice_date BETWEEN ? AND ?`).bind(from, to).all();
  const byRate = {};
  const add = (rate, value) => { const k = String(rate); byRate[k] = byRate[k] || { rate, value: 0, cgst: 0, sgst: 0 }; byRate[k].value = r2(byRate[k].value + value); if (rate > 0) { const t = r2(value * rate / 200); byRate[k].cgst = r2(byRate[k].cgst + t); byRate[k].sgst = r2(byRate[k].sgst + t); } };
  let passthrough = 0;
  for (const l of gst || []) {
    if (l.kind === 'passthrough') { passthrough = r2(passthrough + l.total); continue; }
    const parts = parse(l.tax_parts, null);
    if (parts) for (const pt of parts) add(pt.rate, pt.value); else add(l.taxable ? l.rate : 0, l.taxable || l.exempt);
  }
  const { results: dept } = await env.DB.prepare(`SELECT COALESCE(d.name, CASE WHEN l.kind='package' THEN 'Packages' ELSE 'Other' END) dept, SUM(l.taxable + l.exempt) net, COUNT(*) n
    FROM cl_invoice_lines l JOIN cl_invoices i ON i.id=l.invoice_id LEFT JOIN cl_items it ON it.id=l.item_id LEFT JOIN cl_package_defs pd ON pd.id=l.package_def_id
    LEFT JOIN cl_departments d ON d.id=COALESCE(it.dept_id, pd.dept_id) WHERE i.status='final' AND i.legacy=0 AND l.kind != 'passthrough' AND i.invoice_date BETWEEN ? AND ? GROUP BY 1 ORDER BY 2 DESC`).bind(from, to).all();
  const { results: modes } = await env.DB.prepare('SELECT mode, SUM(amount) s, COUNT(*) n FROM cl_payments WHERE voided=0 AND legacy=0 AND paid_on BETWEEN ? AND ? GROUP BY mode').bind(from, to).all();
  const { results: disc } = await env.DB.prepare(`SELECT COALESCE(l.discount_by_name, 'Within limit') who, SUM(l.discount) s, COUNT(*) n FROM cl_invoice_lines l JOIN cl_invoices i ON i.id=l.invoice_id
    WHERE i.status='final' AND l.discount > 0 AND i.invoice_date BETWEEN ? AND ? GROUP BY 1 ORDER BY 2 DESC`).bind(from, to).all();
  return { month: m, gst: Object.values(byRate).sort((a, b) => a.rate - b.rate), passthrough, departments: (dept || []).map(x => ({ ...x, net: r2(x.net) })), modes: modes || [], discounts: disc || [] };
}
async function outstanding(env) {
  const all = await listInvoices(env, null, null, 'final');
  return all.filter(i => i.balance > 0.004);
}

/* ---------------- invoice PDF ---------------- */
const WIN = /[^\x20-\x7E\xA0-\xFF–—‘’“”•…]/g;
const safe = s => String(s == null ? '' : s).replace(/₹/g, 'Rs.').replace(WIN, '?');
const money = n => (Math.round((n || 0) * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function words(n) {
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const t = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = x => x < 20 ? a[x] : t[Math.floor(x / 10)] + (x % 10 ? ' ' + a[x % 10] : '');
  const three = x => (x >= 100 ? a[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' : '') : '') + (x % 100 ? two(x % 100) : '');
  let r = Math.floor(n), p = Math.round((n - r) * 100), out = [];
  const cr = Math.floor(r / 1e7); r %= 1e7; const lk = Math.floor(r / 1e5); r %= 1e5; const th = Math.floor(r / 1e3); r %= 1e3;
  if (cr) out.push(two(cr) + ' Crore'); if (lk) out.push(two(lk) + ' Lakh'); if (th) out.push(two(th) + ' Thousand'); if (r) out.push(three(r));
  return 'Rupees ' + (out.join(' ') || 'Zero') + (p ? ' and ' + two(p) + ' Paise' : '') + ' Only';
}
async function invoicePdfResponse(env, request, id) {
  const d = await invoiceDetail(env, id);
  if (!d) return api({ ok: false, error: 'Not found' }, 404);
  if (d.invoice.legacy && d.lines.some(l => l.kind === 'opening')) return api({ ok: false, error: 'This is a balance carried over from the previous system. The original invoice is in the old app.' }, 400);
  const p = await env.DB.prepare('SELECT * FROM cl_patients WHERE id=?').bind(d.invoice.patient_id).first();
  const s = await settings(env);
  const bytes = await invoicePdf(env, request, d, p, s);
  const name = (d.invoice.invoice_no || `DRAFT-${id}`).replace(/[^A-Za-z0-9-]+/g, '-');
  return new Response(bytes, { headers: { ...HEADERS, 'content-type': 'application/pdf', 'content-disposition': `inline; filename="Invoice-${name}.pdf"` } });
}
async function invoicePdf(env, request, d, p, s) {
  const inv = d.invoice;
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Invoice ${inv.invoice_no || 'draft'}`);
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.12, 0.19, 0.2), muted = rgb(0.37, 0.43, 0.42), teal = rgb(0.204, 0.349, 0.369), line = rgb(0.85, 0.88, 0.87), mist = rgb(0.93, 0.95, 0.95);
  const W = 595.28, H = 841.89, L = 40, Rx = W - 40;
  let page = pdf.addPage([W, H]), y = H - 40;
  const text = (t, x, yy, size = 9, font = reg, color = ink) => page.drawText(safe(t), { x, y: yy, size, font, color });
  const right = (t, x, yy, size = 9, font = reg, color = ink) => page.drawText(safe(t), { x: x - font.widthOfTextAtSize(safe(t), size), y: yy, size, font, color });
  const wrap = (t, width, size, font = reg) => { const out = []; let cur = ''; for (const w of safe(t).split(/\s+/)) { const n = cur ? cur + ' ' + w : w; if (font.widthOfTextAtSize(n, size) > width && cur) { out.push(cur); cur = w; } else cur = n; } if (cur) out.push(cur); return out; };
  try {
    const res = await env.ASSETS.fetch(new Request(new URL('/img/hasta-wellness-logo.jpg', request.url)));
    if (res.ok) { const img = await pdf.embedJpg(new Uint8Array(await res.arrayBuffer())); const sc = 42 / img.height; page.drawImage(img, { x: L, y: y - 42, width: img.width * sc, height: 42 }); }
  } catch { /* optional */ }
  right(inv.status === 'draft' ? 'DRAFT — NOT A TAX INVOICE' : inv.status === 'cancelled' ? 'CANCELLED INVOICE' : (inv.taxable > 0 ? 'TAX INVOICE' : 'BILL OF SUPPLY'), Rx, y - 12, 13, bold, inv.status === 'final' ? teal : rgb(0.64, 0.23, 0.17));
  right(s.legal_name, Rx, y - 28, 9, bold); right(`Trading as ${s.trade_name}`, Rx, y - 40, 8, reg, muted);
  y -= 58;
  for (const ln of wrap(s.address, 260, 8)) { right(ln, Rx, y, 8, reg, muted); y -= 10; }
  right(`${s.gstin ? 'GSTIN ' + s.gstin + ' · ' : ''}State ${s.state}`, Rx, y, 8, reg, muted); y -= 10;
  right(`${s.phone} · ${s.email}`, Rx, y, 8, reg, muted); y -= 18;
  page.drawLine({ start: { x: L, y }, end: { x: Rx, y }, thickness: 0.8, color: line }); y -= 16;
  text('Billed to', L, y, 8, bold, muted); text('Invoice', 330, y, 8, bold, muted); y -= 13;
  text(p.name, L, y, 10.5, bold); text(`No. ${inv.invoice_no || '—'}`, 330, y, 9.5, bold); y -= 12;
  text(`Patient ID ${p.patient_no} · +91 ${p.phone}`, L, y, 8.5, reg, muted); text(`Date ${inv.invoice_date.split('-').reverse().join('-')}`, 330, y, 8.5, reg, muted); y -= 11;
  if (p.address) for (const ln of wrap(p.address, 260, 8.5).slice(0, 2)) { text(ln, L, y, 8.5, reg, muted); y -= 11; }
  text('Place of supply: Kerala (32)', 330, y + (p.address ? 11 : 0), 8.5, reg, muted);
  y -= 14;
  // Table
  const cols = [[L, 'Description'], [262, 'HSN/SAC'], [340, 'Qty'], [395, 'Rate'], [445, 'Disc.'], [497, 'GST'], [Rx, 'Amount']];
  const head = () => { page.drawRectangle({ x: L, y: y - 5, width: Rx - L, height: 18, color: mist }); cols.forEach(([x, t], i) => i === 0 || i === 1 ? text(t, x + 4, y, 8, bold, muted) : right(t, x - (i === 6 ? 4 : 0), y, 8, bold, muted)); y -= 20; };
  head();
  for (const l of d.lines) {
    const desc = wrap(l.name + (l.kind === 'passthrough' ? ` (collected for ${l.partner || 'partner'})` : '') + (l.discount > 0 && l.discount_reason ? ` — discount: ${l.discount_reason}${l.discount_by_name ? ', authorised by ' + l.discount_by_name : ''}` : ''), 215, 8.5);
    if (y - desc.length * 11 < 120) { page = pdf.addPage([W, H]); y = H - 50; head(); }
    text(desc[0], L + 4, y, 8.5); text(l.hsn_sac || '', 266, y, 8, reg, muted);
    right(String(l.qty), 340, y, 8.5); right(money(l.unit_price), 395, y, 8.5); right(l.discount ? money(l.discount) : '—', 445, y, 8.5);
    right(l.kind === 'passthrough' ? 'n/a' : l.tax_parts ? 'mixed' : l.gst_rate ? `${l.gst_rate}%` : 'Exempt', 497, y, 8, reg, muted);
    right(money(l.total), Rx - 4, y, 8.5, bold);
    for (const extra of desc.slice(1)) { y -= 11; text(extra, L + 4, y, 8, reg, muted); }
    if (l.tax_parts) { y -= 11; text('Package GST split: ' + l.tax_parts.map(pt => `${pt.rate ? pt.rate + '%' : 'exempt'} on ${money(pt.value)}`).join(', '), L + 4, y, 7.5, reg, muted); }
    y -= 6; page.drawLine({ start: { x: L, y }, end: { x: Rx, y }, thickness: 0.4, color: line }); y -= 12;
  }
  if (y < 230) { page = pdf.addPage([W, H]); y = H - 50; }
  // Totals
  const tot = [['Value before discount', inv.gross], ['Discount', -inv.discount], ['Exempt / nil-rated value', inv.exempt], ['Taxable value', inv.taxable], ['CGST', inv.cgst], ['SGST', inv.sgst]];
  if (inv.passthrough) tot.push(['Collected for partners (no GST)', inv.passthrough]);
  y -= 4;
  for (const [k, v] of tot) { if (!v && k !== 'Taxable value') continue; text(k, 340, y, 8.5, reg, muted); right(money(v), Rx - 4, y, 8.5); y -= 13; }
  y -= 6;
  page.drawRectangle({ x: 335, y: y - 6, width: Rx - 335, height: 20, color: mist });
  text('Total payable', 340, y, 10, bold); right('Rs. ' + money(inv.total), Rx - 4, y, 10, bold); y -= 22;
  text(words(inv.total), L, y + 22, 8, reg, muted);
  const paid = d.payments.reduce((s2, x) => s2 + x.amount, 0);
  if (inv.status === 'final') {
    text('Paid', 340, y, 8.5, reg, muted); right(money(paid), Rx - 4, y, 8.5); y -= 13;
    text('Balance due', 340, y, 9, bold); right(money(inv.total - paid), Rx - 4, y, 9, bold); y -= 16;
    for (const x of d.payments) { text(`${x.paid_on.split('-').reverse().join('-')} · ${MODES[x.mode]}${x.reference ? ' · ref ' + x.reference : ''}${x.lender ? ' · ' + x.lender : ''}`, L, y, 8, reg, muted); right(money(x.amount), 300, y, 8, reg, muted); y -= 11; }
  }
  if (inv.status === 'cancelled') { y -= 8; text(`Cancelled: ${inv.cancel_reason}`, L, y, 9, bold, rgb(0.64, 0.23, 0.17)); y -= 12; }
  if (inv.legacy) { y -= 8; text('Reprint of an invoice issued in the previous billing system.', L, y, 8, reg, muted); y -= 11; if (inv.notes) { text(inv.notes.slice(0, 120), L, y, 8, reg, muted); y -= 11; } }
  y = Math.min(y, 110);
  page.drawLine({ start: { x: L, y: 92 }, end: { x: Rx, y: 92 }, thickness: 0.6, color: line });
  text(s.invoice_footer || '', L, 78, 8.5, reg, muted);
  text('Dental healthcare services are exempt from GST. Prices exclude GST; GST is charged at the applicable rate on other items.', L, 66, 7.5, reg, muted);
  text('This is a computer-generated invoice.', L, 55, 7.5, reg, muted);
  right('Authorised signatory', Rx, 55, 8, reg, muted);
  return pdf.save();
}
