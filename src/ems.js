// Hasta EMS — client progress & clinic platform (ems.hastawellnessclinic.com)
//
// Served by the same Worker as the website. On the ems.* host the app lives at
// the root; on any other host (preview / main domain) it is mounted at /ems.
//
// Sign-in
//   Staff   username + password (ems_staff), or the clinic owner account
//           "hasta" + the existing ADMIN_PASSWORD secret (always admin).
//   Client  mobile number + 6-digit PIN issued by the clinic.
//
// Everything lives in the website's D1 database (tables prefixed ems_), so
// consultation enquiries from the website appear here automatically.

import { json, sameOrigin, clean, nz, normalisePhone, h, sha256, notify, leadChannel } from './util.js';
import * as AC from './academy.js';
import { listUnits, getUnit, publicUnit, scopeOf, selectedUnits, unitSlots, allocate, routeUnit, saveUnit, unitDetail, saveShift, saveLeave, settlement, unitStats, SKILLS, listMachines, saveMachine, listCertifications, certify, revokeCert, MACHINE_CATEGORIES } from './units.js';
import { entOf, priceList, savePriceList, valuation, readEntitlements, usage, access, NOT_INCLUDED } from './packages.js';
import { EMS_DUE, clinicForClient, link as clinicLink, unlink as clinicUnlink, recheck as linkRecheck, confirmedPatient, billPackage, createPatientFor } from './emslink.js';
import { eligible, needsProgrammes, latestAdmission, publicAdmission, startAdmission, saveScreening, saveAssessment, clientSign, withdraw, admissionPdf, stepLabel, PROGRAMMES, SCREEN_QS } from './admission.js';

const STAFF_TTL_H = 12;
const CLIENT_TTL_D = 30;
const SLOT_MIN = 30;
const HOURS = { 0: ['10:00', '16:00'], 1: ['10:00', '20:30'], 2: ['10:00', '20:30'], 3: ['10:00', '20:30'], 4: ['10:00', '20:30'], 5: ['10:00', '20:30'], 6: ['10:00', '20:30'] };
const APPT_STATUSES = ['booked', 'attended', 'no_show', 'cancelled'];
const APPT_KINDS = ['session', 'consultation', 'review', 'wm_consult'];
const PAY_METHODS = ['UPI', 'Cash', 'Card', 'Bank transfer'];
const LEAD_STATUSES = ['new', 'contacted', 'booked', 'not interested'];
const DIETS = ['kerala-balanced', 'vegetarian', 'high-protein', 'low-gi'];
const SCREENING = ['pacemaker', 'pregnancy', 'epilepsy', 'heart', 'surgery', 'implants', 'cancer', 'diabetes', 'bp', 'skin'];

/* ---------------- Time (IST) ---------------- */

const istDate = () => new Date(Date.now() + 330 * 60000);
const today = () => istDate().toISOString().slice(0, 10);
const nowLocal = () => istDate().toISOString().slice(0, 16);
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dow = d => new Date(d + 'T00:00:00Z').getUTCDay();
const daysBetween = (a, b) => Math.round((new Date(b.slice(0, 10) + 'T00:00:00Z') - new Date(a.slice(0, 10) + 'T00:00:00Z')) / 86400000);
const hoursBetween = (a, b) => (new Date(b + ':00Z') - new Date(a + ':00Z')) / 3600000;
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const isLocal = s => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s || '');
const mondayOf = d => addDays(d, -((dow(d) + 6) % 7));

/* ---------------- Small helpers ---------------- */

function num(v, min, max) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return undefined; // undefined = invalid
  return Math.round(n * 10) / 10;
}
function int(v, min, max) { const n = num(v, min, max); return n == null || n === undefined ? n : Math.round(n); }
const bad = msg => json({ ok: false, error: msg }, 400);
const last10 = p => String(p || '').replace(/\D/g, '').slice(-10);

const HEADERS = {
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};
const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

function api(data, status = 200, extra = {}) {
  return json(data, status, { ...HEADERS, ...extra });
}

const done = ([status, error, extra]) => status === 200 ? api({ ok: true, ...(extra || {}) }) : api({ ok: false, error }, status);
async function pdfResponse(env, request, a, clientId) {
  if (!a) return api({ ok: false, error: 'No admission record yet.' }, 404);
  const c = await env.DB.prepare('SELECT * FROM ems_clients WHERE id=?').bind(clientId).first();
  const bytes = await admissionPdf(env, request, a, c);
  const fname = `Hasta-admission-consent-${c.name.replace(/[^A-Za-z0-9]+/g, '-')}-${a.id}.pdf`;
  return new Response(bytes, { headers: { ...HEADERS, 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${fname}"` } });
}

/* ---------------- Passwords & sessions ---------------- */

const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function pbkdf2(secret, salt, iter = 100000) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
}
export async function hashSecret(secret) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$100000$${b64(salt)}$${b64(await pbkdf2(secret, salt))}`;
}
export async function verifySecret(secret, stored) {
  if (!stored) return false;
  const [kind, iter, salt, hash] = stored.split('$');
  if (kind !== 'pbkdf2') return false;
  const got = b64(await pbkdf2(secret, unb64(salt), parseInt(iter, 10)));
  let diff = got.length ^ hash.length;
  for (let i = 0; i < Math.min(got.length, hash.length); i++) diff |= got.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}
const randomHex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
const randomPin = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');

let SECURE = true; // cleared only for plain-http local development
function cookieFor(base, token, maxAge) {
  return `ems_s=${token}; Path=${base || '/'}; HttpOnly;${SECURE ? ' Secure;' : ''} SameSite=Lax; Max-Age=${maxAge}`;
}
function readCookie(request) {
  const m = (request.headers.get('cookie') || '').match(/(?:^|;\s*)ems_s=([a-f0-9]{64})/);
  return m ? m[1] : null;
}

export async function getSession(request, env) {
  const token = readCookie(request);
  if (!token) return null;
  const s = await env.DB.prepare("SELECT * FROM ems_sessions WHERE token_hash=? AND expires_at > strftime('%Y-%m-%dT%H:%M:%SZ','now')")
    .bind(await sha256(token)).first();
  if (!s) return null;
  if (s.kind === 'staff') {
    if (s.subject_id === 0) return { kind: 'staff', id: 0, name: 'Clinic admin', role: 'admin', username: 'hasta' };
    const u = await env.DB.prepare('SELECT id, name, role, username FROM ems_staff WHERE id=? AND active=1').bind(s.subject_id).first();
    return u ? { kind: 'staff', ...u } : null;
  }
  const c = await env.DB.prepare("SELECT id, name, phone FROM ems_clients WHERE id=? AND status != 'deleted'").bind(s.subject_id).first();
  return c ? { kind: 'client', ...c } : null;
}

async function startSession(env, base, kind, id) {
  const token = randomHex(32);
  const ttl = kind === 'staff' ? STAFF_TTL_H * 3600 : CLIENT_TTL_D * 86400;
  const exp = new Date(Date.now() + ttl * 1000).toISOString().slice(0, 19) + 'Z';
  await env.DB.prepare('INSERT INTO ems_sessions (token_hash, kind, subject_id, expires_at) VALUES (?,?,?,?)')
    .bind(await sha256(token), kind, id, exp).run();
  return cookieFor(base, token, ttl);
}

async function tooManyAttempts(env, keys) {
  for (const k of keys) {
    const r = await env.DB.prepare("SELECT COUNT(*) n FROM ems_login_attempts WHERE key=? AND at > strftime('%Y-%m-%dT%H:%M:%SZ','now','-15 minutes')").bind(k).first();
    if (r && r.n >= (k.startsWith('ip:') ? 30 : 8)) return true;
  }
  return false;
}
async function recordFailure(env, keys) {
  for (const k of keys) await env.DB.prepare('INSERT INTO ems_login_attempts (key) VALUES (?)').bind(k).run();
}

/* ---------------- Entry ---------------- */

export async function handleEms(request, env, url, ctx, base, serveAsset) {
  const path = url.pathname.slice(base.length) || '/';
  SECURE = !(url.protocol === 'http:' && /^(localhost|127\.)/.test(url.hostname));

  if (path === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n', { headers: { 'content-type': 'text/plain' } });
  if (/^\/(ems|fonts|img)\/[\w.\-/]+\.\w+$/.test(path) || /^\/(favicon\.ico|apple-touch-icon\.png)$/.test(path)) {
    const res = await serveAsset(request, env, url);
    const headers = new Headers(res.headers);
    headers.set('x-robots-tag', 'noindex, nofollow');
    if (path.startsWith('/ems/')) headers.set('cache-control', 'public, max-age=300, must-revalidate');
    return new Response(res.body, { status: res.status, headers });
  }
  if (path.startsWith('/api/')) {
    try {
      return await route(request, env, url, ctx, base, path.slice(4));
    } catch (err) {
      console.error('EMS error', path, err && err.stack || err);
      return api({ ok: false, error: 'Something went wrong. Please try again.' }, 500);
    }
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
  return new Response(shell(base), { headers: { ...HEADERS, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP } });
}

function shell(base) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#34595e">
<meta name="ems-base" content="${h(base)}">
<title>Hasta EMS · Progress Studio</title>
<link rel="icon" href="/favicon.ico"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preload" href="/fonts/manrope-var.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/ems/app.css?v=8">
</head><body><div id="app"><div class="boot"><img src="/img/hasta-emblem.webp" alt="" width="56" height="56"></div></div>
<script type="module" src="/ems/app.js?v=9"></script></body></html>`;
}

/* ---------------- Router ---------------- */

async function route(request, env, url, ctx, base, p) {
  const m = request.method;
  let body = {};
  if (p === '/staff/academy/upload' && m === 'POST') return academyUpload(request, env);
  if (m !== 'GET') {
    if (!sameOrigin(request)) return api({ ok: false, error: 'Forbidden' }, 403);
    if (!(request.headers.get('content-type') || '').includes('application/json')) return api({ ok: false, error: 'Unsupported' }, 415);
    if (parseInt(request.headers.get('content-length') || '0', 10) > (/\/(assess|sign|client-sign)$/.test(p) ? 400000 : 20000)) return api({ ok: false, error: 'Too large' }, 413);
    try { body = await request.json(); } catch { return bad('Invalid request'); }
    if (!body || typeof body !== 'object') return bad('Invalid request');
  }

  // Public
  if (p === '/auth/staff' && m === 'POST') return staffLogin(request, env, base, body);
  if (p === '/auth/client' && m === 'POST') return clientLogin(request, env, base, body);
  if (p === '/auth/logout' && m === 'POST') {
    const t = readCookie(request);
    if (t) await env.DB.prepare('DELETE FROM ems_sessions WHERE token_hash=?').bind(await sha256(t)).run();
    return api({ ok: true }, 200, { 'set-cookie': cookieFor(base, '', 0) });
  }
  if (p === '/consult' && m === 'POST') return consultRequest(request, env, ctx, url, body);

  const me = await getSession(request, env);
  if (p === '/me' && m === 'GET') return api({ ok: true, me });
  if (!me) return api({ ok: false, error: 'Please sign in.' }, 401);

  if (p === '/units' && m === 'GET') return api({ ok: true, units: (await listUnits(env, { activeOnly: true })).map(publicUnit) });
  if (p === '/slots' && m === 'GET') {
    const d = url.searchParams.get('date');
    if (!isDate(d)) return bad('Choose a date.');
    const kind = APPT_KINDS.includes(url.searchParams.get('kind')) ? url.searchParams.get('kind') : 'session';
    const mode = kind !== 'session' && url.searchParams.get('mode') === 'video' ? 'video' : 'in_person';
    let unitId = parseInt(url.searchParams.get('unit'), 10);
    let prefer = null;
    let types = [];
    const cid = me.kind === 'client' ? me.id : parseInt(url.searchParams.get('client'), 10);
    if (cid) {
      const c = await env.DB.prepare('SELECT home_unit_id, coach_id FROM ems_clients WHERE id=?').bind(cid).first();
      if (c) { unitId = unitId || c.home_unit_id || 1; prefer = c.coach_id; }
      if (kind === 'session') types = typesOf(await bookablePackage(env, cid));
    }
    const list = await unitSlots(env, unitId || 1, d, kind, mode, { minAheadH: me.kind === 'staff' ? 0 : 2, nowLocal: nowLocal(), prefer, types });
    return api({ ok: true, slots: list });
  }
  if (p === '/me/secret' && m === 'POST') return changeSecret(env, me, body);
  if (me.kind === 'staff' && me.id !== 0 && me.role !== 'admin') {
    const row = await env.DB.prepare('SELECT apps FROM ems_staff WHERE id=?').bind(me.id).first();
    let apps = ['ems']; try { apps = JSON.parse(row && row.apps || '["ems"]'); } catch { /* default */ }
    if (!apps.includes('ems')) return api({ ok: false, error: 'Your account is for the clinic app only. Use clinicapp.hastawellnessclinic.com.' }, 403);
  }

  if (me.kind === 'client') {
    if (p === '/client/overview' && m === 'GET') return api({ ok: true, ...(await clientView(env, me.id, false)) });
    if (p === '/client/appointments' && m === 'POST') return clientBook(env, ctx, url, me, body);
    let r;
    if ((r = p.match(/^\/client\/appointments\/(\d+)\/cancel$/)) && m === 'POST') return clientCancel(env, me, +r[1]);
    if (p === '/client/checkins' && m === 'POST') return saveCheckin(env, me.id, body);
    if (p === '/client/admission/screening' && m === 'PUT') { const a = await latestAdmission(env, me.id); return done(await saveScreening(env, a, body, 'client (app)')); }
    if (p === '/client/admission/sign' && m === 'POST') {
      const a = await latestAdmission(env, me.id), c = await env.DB.prepare('SELECT * FROM ems_clients WHERE id=?').bind(me.id).first();
      const r = await clientSign(env, a, c, body, 'app', request);
      if (r[0] === 200) { const al = notify(env, `Consent signed: ${c.name}`, [['Client', c.name], ['Mobile', c.phone], ['Programme', (JSON.parse(a.programmes) || []).map(k => PROGRAMMES[k]).join(', ')]], `/#/clients/${c.id}?tab=admission`, emsOrigin(env, url)); if (ctx && ctx.waitUntil) ctx.waitUntil(al); }
      return done(r);
    }
    if (p === '/client/admission/pdf' && m === 'GET') {
      const id = parseInt(url.searchParams.get('id'), 10);
      const a = id ? await env.DB.prepare('SELECT * FROM ems_admissions WHERE id=? AND client_id=?').bind(id, me.id).first() : await latestAdmission(env, me.id);
      return pdfResponse(env, request, a, me.id);
    }
    return api({ ok: false, error: 'Not found' }, 404);
  }

  // Staff
  const admin = me.role === 'admin';
  const manager = admin || me.role === 'manager';
  const scope = await scopeOf(env, me);
  const sc = selectedUnits(url, scope);
  let r;
  if (p === '/staff/units' && m === 'GET') {
    const all = await listUnits(env);
    return api({ ok: true, units: all.filter(u => scope.units.includes(u.id)), all_units: all.map(u => ({ id: u.id, name: u.name, code: u.code, active: u.active })), role: me.role, skills: SKILLS });
  }
  if (p === '/staff/units' && m === 'POST') return admin ? done(await saveUnit(env, null, body)) : api({ ok: false, error: 'Only head-office admins can add units.' }, 403);
  if ((r = p.match(/^\/staff\/units\/(\d+)$/))) {
    if (!scope.units.includes(+r[1])) return api({ ok: false, error: 'Not your unit.' }, 403);
    if (m === 'GET') { const d = await unitDetail(env, +r[1]); return d ? api({ ok: true, ...d }) : api({ ok: false, error: 'Not found' }, 404); }
    if (m === 'PUT') return admin ? done(await saveUnit(env, +r[1], body)) : api({ ok: false, error: 'Only head-office admins can change unit settings.' }, 403);
  }
  if (p === '/staff/price-list' && m === 'GET') return api({ ok: true, items: await priceList(env) });
  if (p === '/staff/price-list' && m === 'PUT') return admin ? done(await savePriceList(env, body.items)) : api({ ok: false, error: 'Only admins can change prices.' }, 403);
  if (p === '/staff/machines' && m === 'GET') return api({ ok: true, machines: await listMachines(env), categories: MACHINE_CATEGORIES });
  if (p === '/staff/machines' && m === 'POST') return admin ? done(await saveMachine(env, null, body)) : api({ ok: false, error: 'Only admins can add machines.' }, 403);
  if ((r = p.match(/^\/staff\/machines\/(\d+)$/)) && m === 'PUT') return admin ? done(await saveMachine(env, +r[1], body)) : api({ ok: false, error: 'Only admins can change machines.' }, 403);
  if (p === '/staff/certifications' && m === 'GET') return api({ ok: true, certifications: await listCertifications(env) });
  if (p === '/staff/certifications' && m === 'POST') return api({ ok: false, error: 'Trainers are now certified through the Hasta EMS Academy (Academy → Trainees).' }, 410);
  if (p.startsWith('/staff/academy')) { const res = await academyRoute(request, env, url, me, p, m, body, admin); if (res) return res; }
  if ((r = p.match(/^\/staff\/certifications\/(\d+)\/revoke$/)) && m === 'POST') return done(await revokeCert(env, me, +r[1], body));
  if (p === '/staff/rota' && m === 'POST') {
    if (!manager || !scope.units.includes(parseInt(body.unit_id, 10))) return api({ ok: false, error: 'Only a unit manager or admin can change the rota.' }, 403);
    return done(await saveShift(env, body));
  }
  if ((r = p.match(/^\/staff\/rota\/(\d+)$/)) && m === 'DELETE') {
    const sh = await env.DB.prepare('SELECT unit_id FROM ems_rota WHERE id=?').bind(+r[1]).first();
    if (!sh || !manager || !scope.units.includes(sh.unit_id)) return api({ ok: false, error: 'Not allowed.' }, 403);
    await env.DB.prepare('DELETE FROM ems_rota WHERE id=?').bind(+r[1]).run(); return api({ ok: true });
  }
  if (p === '/staff/leave' && m === 'POST') { if (!manager) return api({ ok: false, error: 'Only a unit manager or admin can record leave.' }, 403); return done(await saveLeave(env, body)); }
  if ((r = p.match(/^\/staff\/leave\/(\d+)$/)) && m === 'DELETE') { if (!manager) return api({ ok: false, error: 'Not allowed.' }, 403); await env.DB.prepare('DELETE FROM ems_leave WHERE id=?').bind(+r[1]).run(); return api({ ok: true }); }
  if (p === '/staff/reports/settlement' && m === 'GET') {
    if (!admin) return api({ ok: false, error: 'Admins only.' }, 403);
    const from = isDate(url.searchParams.get('from')) ? url.searchParams.get('from') : today().slice(0, 8) + '01';
    const to = isDate(url.searchParams.get('to')) ? url.searchParams.get('to') : today();
    return api({ ok: true, from, to, rows: await settlement(env, from, to) });
  }
  if (p === '/staff/dashboard' && m === 'GET') return api({ ok: true, ...(await dashboard(env, sc, admin)) });
  if (p === '/staff/clients' && m === 'GET') return listClients(env, url, sc);
  if (p === '/staff/clients' && m === 'POST') return createClient(env, me, body, sc);
  if ((r = p.match(/^\/staff\/clients\/(\d+)/)) && !scope.all) {
    const ok = await env.DB.prepare(`SELECT 1 FROM ems_clients c WHERE c.id=? AND (c.home_unit_id IS NULL OR c.home_unit_id IN (${scope.units.join(',') || 0})
      OR EXISTS (SELECT 1 FROM ems_appointments a WHERE a.client_id=c.id AND a.unit_id IN (${scope.units.join(',') || 0})))`).bind(+r[1]).first();
    if (!ok) return api({ ok: false, error: 'This client belongs to another unit.' }, 403);
  }
  if ((r = p.match(/^\/staff\/clients\/(\d+)$/))) {
    if (m === 'GET') { const v = await clientView(env, +r[1], true); return v ? api({ ok: true, ...v }) : api({ ok: false, error: 'Not found' }, 404); }
    if (m === 'PUT') return updateClient(env, +r[1], body, me);
    if (m === 'DELETE') return admin ? deleteClient(env, +r[1]) : api({ ok: false, error: 'Only an admin can delete records.' }, 403);
  }
  if ((r = p.match(/^\/staff\/clients\/(\d+)\/pin$/)) && m === 'POST') return resetPin(env, +r[1]);
  // Clinic record: one person, one record, one money account (src/emslink.js)
  if ((r = p.match(/^\/staff\/clients\/(\d+)\/clinic$/)) && m === 'GET') {
    const c = await env.DB.prepare('SELECT * FROM ems_clients WHERE id=?').bind(+r[1]).first();
    return c ? api({ ok: true, ...(await clinicForClient(env, c)) }) : api({ ok: false, error: 'Not found' }, 404);
  }
  if ((r = p.match(/^\/staff\/clients\/(\d+)\/clinic-link$/)) && m === 'POST') return done(await clinicLink(env, me, parseInt(body.patient_id, 10) || 0, +r[1]));
  if ((r = p.match(/^\/staff\/clients\/(\d+)\/clinic-create$/)) && m === 'POST') { const x = await createPatientFor(env, me, +r[1], body); return x[0] === 200 ? api({ ok: true, ...x[2] }) : api({ ok: false, error: x[1], ...(x[2] || {}) }, x[0]); }
  if ((r = p.match(/^\/staff\/clients\/(\d+)\/clinic-unlink$/)) && m === 'POST') {
    const pt = await env.DB.prepare("SELECT id FROM cl_patients WHERE ems_client_id=? AND status='active'").bind(+r[1]).first();
    return pt ? done(await clinicUnlink(env, me, pt.id)) : bad('This client is not linked to a clinic record.');
  }
  if ((r = p.match(/^\/staff\/client-packages\/(\d+)\/bill$/)) && m === 'POST') { const x = await billPackage(env, me, +r[1]); return x[0] === 200 ? api({ ok: true, ...x[2] }) : api({ ok: false, error: x[1] }, x[0]); }
  if ((r = p.match(/^\/staff\/clients\/(\d+)\/admissions$/)) && m === 'POST') return done(await startAdmission(env, me, +r[1], body));
  if ((r = p.match(/^\/staff\/admissions\/(\d+)\/(screening|assess|client-sign|withdraw|pdf)$/))) {
    const a = await env.DB.prepare('SELECT * FROM ems_admissions WHERE id=?').bind(+r[1]).first();
    if (!a) return api({ ok: false, error: 'Not found' }, 404);
    const c = await env.DB.prepare('SELECT * FROM ems_clients WHERE id=?').bind(a.client_id).first();
    if (r[2] === 'pdf' && m === 'GET') return pdfResponse(env, request, a, a.client_id);
    if (r[2] === 'screening' && m === 'PUT') return done(await saveScreening(env, a, body, `${me.name} (staff, with client)`));
    if (r[2] === 'assess' && m === 'POST') return done(await saveAssessment(env, me, a, c, body));
    if (r[2] === 'client-sign' && m === 'POST') return done(await clientSign(env, a, c, body, 'clinic', request));
    if (r[2] === 'withdraw' && m === 'POST') return done(await withdraw(env, a, body, me.name));
  }
  if ((r = p.match(/^\/staff\/clients\/(\d+)\/plan$/)) && m === 'PUT') return savePlan(env, me, +r[1], body);
  if ((r = p.match(/^\/staff\/clients\/(\d+)\/packages$/)) && m === 'POST') return assignPackage(env, +r[1], body, me);
  if ((r = p.match(/^\/staff\/client-packages\/(\d+)$/)) && m === 'PUT') { if (body.sessions_total !== undefined && !admin) return api({ ok: false, error: 'Only admins can change the sessions on a sold package.' }, 403); return updateClientPackage(env, +r[1], { ...body, _admin: admin }); }
  if (p === '/staff/measurements' && m === 'POST') return addMeasurement(env, me, body);
  if ((r = p.match(/^\/staff\/measurements\/(\d+)$/)) && m === 'DELETE') { await env.DB.prepare('DELETE FROM ems_measurements WHERE id=?').bind(+r[1]).run(); return api({ ok: true }); }
  if (p === '/staff/payments' && m === 'POST') return addPayment(env, me, body);
  if ((r = p.match(/^\/staff\/payments\/(\d+)$/)) && m === 'DELETE') {
    if (!admin) return api({ ok: false, error: 'Only an admin can remove payments.' }, 403);
    await env.DB.prepare('DELETE FROM ems_payments WHERE id=?').bind(+r[1]).run(); return api({ ok: true });
  }
  if (p === '/staff/payments' && m === 'GET') return listPayments(env, url, sc);
  if (p === '/staff/appointments' && m === 'GET') return listAppointments(env, url, sc);
  if (p === '/staff/appointments' && m === 'POST') return staffBook(env, me, body, sc);
  if ((r = p.match(/^\/staff\/appointments\/(\d+)$/)) && m === 'PUT') return updateAppointment(env, +r[1], body);
  if (p === '/staff/leads' && m === 'GET') return listLeads(env, url, sc, scope);
  if ((r = p.match(/^\/staff\/leads\/(\d+)$/)) && m === 'PUT') return updateLead(env, +r[1], body);
  if ((r = p.match(/^\/staff\/leads\/(\d+)\/convert$/)) && m === 'POST') return convertLead(env, me, +r[1], body, sc);
  if (p === '/staff/reminders' && m === 'GET') return api({ ok: true, reminders: await reminders(env, sc) });
  if (p === '/staff/reminders/log' && m === 'POST') return logReminder(env, me, body);
  if (p === '/staff/packages' && m === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM ems_packages ORDER BY active DESC, sessions, id').all();
    const list = await priceList(env);
    return api({ ok: true, packages: (results || []).map(p => { const ent = entOf(p, false); ent.sessions = p.sessions; return { ...p, ent, valuation: valuation(ent, list) }; }), price_list: list });
  }
  if (p === '/staff/packages' && m === 'POST') return admin ? savePackageDef(env, null, body) : api({ ok: false, error: 'Admins only.' }, 403);
  if ((r = p.match(/^\/staff\/packages\/(\d+)$/)) && m === 'PUT') return admin ? savePackageDef(env, +r[1], body) : api({ ok: false, error: 'Admins only.' }, 403);
  if (p === '/staff/team' && m === 'GET') {
    const { results } = await env.DB.prepare(`SELECT s.id, s.name, s.role, s.skills, s.reg_no, (SELECT COUNT(*) FROM ems_clients c WHERE c.coach_id=s.id AND c.status='active') clients,
      (SELECT group_concat(unit_id) FROM ems_staff_units x WHERE x.staff_id=s.id) units
      FROM ems_staff s WHERE s.active=1 ORDER BY s.name`).all();
    for (const t of results || []) { t.skills = safeJson(t.skills); t.units = String(t.units || '').split(',').filter(Boolean).map(Number); }
    return api({ ok: true, team: results, me: me.id });
  }
  if (p === '/staff/users' && m === 'GET') {
    if (!admin) return api({ ok: false, error: 'Admins only.' }, 403);
    const { results } = await env.DB.prepare('SELECT id, name, username, role, active, created_at, skills, reg_no, (SELECT group_concat(unit_id) FROM ems_staff_units x WHERE x.staff_id=ems_staff.id) units FROM ems_staff ORDER BY active DESC, name').all();
    for (const t of results || []) { t.skills = safeJson(t.skills); t.units = String(t.units || '').split(',').filter(Boolean).map(Number); }
    return api({ ok: true, users: results });
  }
  if (p === '/staff/users' && m === 'POST') return admin ? saveUser(env, null, body) : api({ ok: false, error: 'Admins only.' }, 403);
  if ((r = p.match(/^\/staff\/users\/(\d+)$/)) && m === 'PUT') return admin ? saveUser(env, +r[1], body) : api({ ok: false, error: 'Admins only.' }, 403);
  return api({ ok: false, error: 'Not found' }, 404);
}

/* ---------------- Auth handlers ---------------- */

async function ipKey(request) {
  const ip = request.headers.get('cf-connecting-ip') || '';
  return 'ip:' + (await sha256('ems:' + ip)).slice(0, 20);
}

async function staffLogin(request, env, base, b) {
  const username = clean(b.username, 40).toLowerCase();
  const password = String(b.password || '').slice(0, 200);
  if (!username || !password) return bad('Enter your username and password.');
  const keys = [await ipKey(request), 'u:' + username];
  if (await tooManyAttempts(env, keys)) return api({ ok: false, error: 'Too many attempts. Please wait 15 minutes.' }, 429);
  let id = null;
  if (username === 'hasta' && env.ADMIN_PASSWORD) {
    const [a, c] = await Promise.all([sha256(`hasta:${password}`), sha256(`hasta:${env.ADMIN_PASSWORD}`)]);
    if (a === c) id = 0;
  }
  if (id === null) {
    const u = await env.DB.prepare('SELECT id, pass_hash FROM ems_staff WHERE username=? AND active=1').bind(username).first();
    if (u && await verifySecret(password, u.pass_hash)) id = u.id;
  }
  if (id === null) { await recordFailure(env, keys); return api({ ok: false, error: 'Username or password is not right.' }, 401); }
  return api({ ok: true }, 200, { 'set-cookie': await startSession(env, base, 'staff', id) });
}

async function clientLogin(request, env, base, b) {
  const phone = last10(b.phone);
  const pin = String(b.pin || '');
  if (phone.length !== 10 || !/^\d{6}$/.test(pin)) return bad('Enter your mobile number and 6-digit PIN.');
  const keys = [await ipKey(request), 'c:' + phone];
  if (await tooManyAttempts(env, keys)) return api({ ok: false, error: 'Too many attempts. Please wait 15 minutes or call the clinic.' }, 429);
  const c = await env.DB.prepare("SELECT id, pin_hash FROM ems_clients WHERE substr(phone,-10)=? AND status != 'deleted'").bind(phone).first();
  if (!c || !(await verifySecret(pin, c.pin_hash))) { await recordFailure(env, keys); return api({ ok: false, error: 'Mobile number or PIN is not right.' }, 401); }
  return api({ ok: true }, 200, { 'set-cookie': await startSession(env, base, 'client', c.id) });
}

async function changeSecret(env, me, b) {
  if (me.kind === 'client') {
    if (!/^\d{6}$/.test(String(b.next || ''))) return bad('Your new PIN must be 6 digits.');
    const c = await env.DB.prepare('SELECT pin_hash FROM ems_clients WHERE id=?').bind(me.id).first();
    if (!(await verifySecret(String(b.current || ''), c.pin_hash))) return bad('Your current PIN is not right.');
    await env.DB.prepare('UPDATE ems_clients SET pin_hash=? WHERE id=?').bind(await hashSecret(String(b.next)), me.id).run();
    return api({ ok: true });
  }
  if (me.id === 0) return bad('The clinic admin password is changed in Cloudflare (ADMIN_PASSWORD).');
  if (String(b.next || '').length < 8) return bad('Use at least 8 characters.');
  const u = await env.DB.prepare('SELECT pass_hash FROM ems_staff WHERE id=?').bind(me.id).first();
  if (!(await verifySecret(String(b.current || ''), u.pass_hash))) return bad('Your current password is not right.');
  await env.DB.prepare('UPDATE ems_staff SET pass_hash=? WHERE id=?').bind(await hashSecret(String(b.next)), me.id).run();
  return api({ ok: true });
}

/* ---------------- Public consultation request ---------------- */

async function consultRequest(request, env, ctx, url, b) {
  if (b.company) return api({ ok: true }); // honeypot
  if (b.consent !== true) return bad('Please agree to be contacted.');
  const name = clean(b.name, 80), phone = normalisePhone(b.phone);
  if (name.length < 2) return bad('Please enter your name.');
  if (!phone) return bad('Please enter a valid mobile number.');
  const date = isDate(b.preferred_date) && b.preferred_date >= today() ? b.preferred_date : null;
  const key = await ipKey(request);
  if (await tooManyAttempts(env, [key + ':consult'])) return api({ ok: false, error: 'Too many requests. Please call the clinic.' }, 429);
  await recordFailure(env, [key + ':consult']); // counts requests, not failures
  const goal = clean(b.goal, 160);
  const pin = /^\d{6}$/.test(String(b.pincode || '')) ? String(b.pincode) : null;
  const unitId = parseInt(b.unit_id, 10) || await routeUnit(env, { pincode: pin });
  const mode = b.mode === 'video' ? 'Video call' : 'At the centre';
  await env.DB.prepare("INSERT INTO leads (source, request_type, name, phone, interest, concern, timing, preferred_date, page, unit_id, channel) VALUES ('ems portal',?,?,?,'EMS & Weight Management',?,?,?,'ems portal',?,?)")
    .bind('Consultation · ' + mode, name, phone, nz([goal, pin ? 'PIN ' + pin : ''].filter(Boolean).join(' · ')), nz(clean(b.timing, 60)), date, unitId || null, leadChannel(request)).run();
  const alert = notify(env, 'New EMS consultation request', [['Name', name], ['Mobile', phone], ['Goal', goal], ['Preferred date', date], ['Timing', clean(b.timing, 60)]], '/#/leads', emsOrigin(env, url));
  if (ctx && ctx.waitUntil) ctx.waitUntil(alert);
  return api({ ok: true });
}
const emsOrigin = (env, url) => env.EMS_ORIGIN || (url.hostname.startsWith('ems.') ? url.origin : url.origin + '/ems');

/* ---------------- Slots & booking ---------------- */

const APPT_MODES = ['in_person', 'video'];
const typesOf = p => { try { const v = JSON.parse((p && p.machine_types) || '[]'); return Array.isArray(v) ? v.map(Number).filter(Boolean) : []; } catch { return []; } };
async function unitFor(env, b, fallback) {
  const id = parseInt(b.unit_id, 10) || fallback || 1;
  const u = await getUnit(env, id);
  return u && u.active ? u : null;
}

async function packagesFor(env, clientId) {
  const { results } = await env.DB.prepare(`SELECT cp.*,
    (SELECT COUNT(*) FROM ems_appointments a WHERE a.client_package_id=cp.id AND a.kind='session' AND a.status='attended') used,
    (SELECT COUNT(*) FROM ems_appointments a WHERE a.client_package_id=cp.id AND a.kind='session' AND a.status='booked') booked,
    (SELECT IFNULL(SUM(amount),0) FROM ems_receipts r WHERE r.client_package_id=cp.id) paid,
    i.invoice_no, i.status invoice_status, ${EMS_DUE} bill_due
    FROM ems_client_packages cp LEFT JOIN cl_invoices i ON i.id=cp.invoice_id WHERE cp.client_id=? ORDER BY cp.start_date, cp.id`).bind(clientId).all();
  const t = today();
  const use = await usage(env, (results || []).map(p => p.id));
  return (results || []).map(p => {
    const u = use[p.id] || {};
    const ent = entOf(p);
    const sessUsed = p.used - 0, sessBooked = p.booked;
    // used/booked above count every linked appointment; sessions only count kind='session'
    const reviews = u.review || 0, wm = u.wm_consult || 0;
    const usedS = Math.max(0, sessUsed), bookedS = Math.max(0, sessBooked);
    const remaining = Math.max(0, p.sessions_total - usedS);
    const due = Math.max(0, p.bill_due); // with GST once billed in the clinic
    const reviews_left = Math.max(0, ent.reviews - reviews), wm_left = Math.max(0, ent.wm_consults - wm);
    let state = p.status;
    if (state === 'active') {
      if (p.expiry_date && p.expiry_date < t) state = 'expired';
      else if (p.sessions_total > 0 && usedS >= p.sessions_total && !reviews_left && !wm_left) state = 'completed';
      else if (p.sessions_total === 0 && !reviews_left && !wm_left && !ent.diet_plan) state = 'completed';
    }
    // Bills are GST-inclusive splits of the package price, so a fully paid bill can be a paisa short.
    const left = Math.round((due - p.paid) * 100) / 100, paid = left < 1 ? due : Math.round(p.paid * 100) / 100;
    const billing = !p.invoice_id || p.invoice_status === 'cancelled' ? 'none' : p.invoice_status;
    return { ...p, paid, billing, ent, used: usedS, booked: bookedS, remaining, available: Math.max(0, remaining - bookedS), due, balance: left < 1 ? 0 : left, state, reviews_used: reviews, wm_used: wm, reviews_left, wm_left };
  });
}
async function bookablePackage(env, clientId) {
  return (await packagesFor(env, clientId)).find(p => p.state === 'active' && p.available > 0) || null;
}
async function recoveryClash(env, clientId, start, exceptId = 0) {
  const { results } = await env.DB.prepare("SELECT start_at FROM ems_appointments WHERE client_id=? AND kind='session' AND status IN ('booked','attended') AND id != ? AND substr(start_at,1,10) BETWEEN ? AND ?")
    .bind(clientId, exceptId, addDays(start.slice(0, 10), -2), addDays(start.slice(0, 10), 2)).all();
  return (results || []).find(r => Math.abs(hoursBetween(r.start_at, start)) < 40) || null;
}

async function clientBook(env, ctx, url, me, b) {
  const start = String(b.start_at || '');
  if (!isLocal(start)) return bad('Please choose one of the available times.');
  if (hoursBetween(nowLocal(), start) < 2) return bad('Please book at least 2 hours ahead, or call the clinic.');
  if (start.slice(0, 10) > addDays(today(), 30)) return bad('You can book up to 30 days ahead.');
  const c = await env.DB.prepare('SELECT cleared, status, home_unit_id, coach_id FROM ems_clients WHERE id=?').bind(me.id).first();
  if (!c || c.status !== 'active') return bad('Your programme is paused. Please contact the clinic.');
  const unit = await unitFor(env, b, c.home_unit_id);
  if (!unit) return bad('Please choose a centre.');
  const pkg = await bookablePackage(env, me.id);
  if (!pkg) return bad('You have no sessions left to book. Ask the clinic about renewing your package.');
  const el = await eligible(env, me.id, needsProgrammes(pkg.programme));
  if (!el.ok) return bad('Your admission needs to be completed (or renewed) before you can book. Open "Admission" in the app, or contact the clinic.');
  const clash = await recoveryClash(env, me.id, start);
  if (clash) return bad('EMS works best with about 48 hours of recovery between sessions. Please pick a time further from your other session.');
  const al = await allocate(env, unit.id, start, 'session', 'in_person', { prefer: c.coach_id, types: typesOf(pkg) });
  if (!al.ok) return bad(al.error.startsWith('No free device') ? 'That time has just been taken. Please choose another.' : al.error);
  await env.DB.prepare("INSERT INTO ems_appointments (client_id, kind, start_at, duration, client_package_id, created_by, unit_id, device_id, trainer_id) VALUES (?,'session',?,?,?,'client',?,?,?)")
    .bind(me.id, start, al.duration, pkg.id, unit.id, al.device_id, al.trainer_id).run();
  const alert = notify(env, `EMS session booked by ${me.name} at ${unit.name}`, [['Client', me.name], ['Mobile', me.phone], ['Unit', unit.name], ['When', start.replace('T', ' ') + ' IST'], ['Package', pkg.name]], '/#/schedule', emsOrigin(env, url));
  if (ctx && ctx.waitUntil) ctx.waitUntil(alert);
  return api({ ok: true });
}

async function clientCancel(env, me, id) {
  const a = await env.DB.prepare("SELECT * FROM ems_appointments WHERE id=? AND client_id=? AND status='booked'").bind(id, me.id).first();
  if (!a) return bad('That booking was not found.');
  if (hoursBetween(nowLocal(), a.start_at) < 3) return bad('Bookings within 3 hours can only be changed by calling the clinic.');
  await env.DB.prepare("UPDATE ems_appointments SET status='cancelled', notes=TRIM(IFNULL(notes,'')||' Cancelled by client'), updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?").bind(id).run();
  return api({ ok: true });
}

async function staffBook(env, me, b, sc) {
  const start = String(b.start_at || '');
  const kind = APPT_KINDS.includes(b.kind) ? b.kind : 'session';
  const mode = kind !== 'session' && b.mode === 'video' ? 'video' : 'in_person';
  if (!isLocal(start)) return bad('Choose a date and time.');
  const clientId = parseInt(b.client_id, 10) || null;
  let guestName = null, guestPhone = null;
  if (!clientId) {
    guestName = clean(b.guest_name, 80); guestPhone = normalisePhone(b.guest_phone);
    if (!guestName || !guestPhone) return bad('Choose a client, or enter a name and mobile for a new consultation.');
  }
  let pkgId = null, types = [];
  const warnings = [];
  if (clientId && kind === 'session') {
    const pkg = await bookablePackage(env, clientId);
    if (!pkg) return bad('This client has no sessions left. Add a package first.');
    const el = await eligible(env, clientId, needsProgrammes(pkg.programme));
    if (!el.ok) return bad(el.reason);
    pkgId = pkg.id; types = typesOf(pkg);
    if (await recoveryClash(env, clientId, start)) warnings.push('Less than 48 hours from another session.');
  }
  if (clientId && (kind === 'review' || kind === 'wm_consult')) {
    const pk = (await packagesFor(env, clientId)).find(p => p.state === 'active' && (kind === 'review' ? p.reviews_left : p.wm_left) > 0);
    if (!pk) return bad(NOT_INCLUDED[kind]);
    pkgId = pk.id;
  }
  if (clientId && kind === 'consultation') {
    const pkgs = await packagesFor(env, clientId);
    const el = await eligible(env, clientId, ['ems']);
    if (el.ok && pkgs.some(p => p.state === 'active')) return bad('This client is already admitted and on a package. Book a progress review or weight-management consultation included in their package instead.');
  }
  const cl = clientId ? await env.DB.prepare('SELECT home_unit_id, coach_id FROM ems_clients WHERE id=?').bind(clientId).first() : null;
  const unit = await unitFor(env, b, (cl && cl.home_unit_id) || sc.one || sc.ids[0]);
  if (!unit || !sc.ids.concat(sc.one || []).length) return bad('Choose a unit.');
  const al = await allocate(env, unit.id, start, kind, mode, { prefer: cl && cl.coach_id, force: !!b.force, types });
  if (!al.ok) return bad(al.error + ' Or tick "overbook".');
  if (al.warning) warnings.push(al.warning);
  await env.DB.prepare('INSERT INTO ems_appointments (client_id, lead_id, guest_name, guest_phone, kind, mode, start_at, duration, client_package_id, staff_id, notes, unit_id, device_id, trainer_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(clientId, parseInt(b.lead_id, 10) || null, guestName, guestPhone, kind, mode, start, al.duration, pkgId, me.id, nz(clean(b.notes, 300)), unit.id, al.device_id, al.trainer_id).run();
  return api({ ok: true, warnings });
}

async function updateAppointment(env, id, b) {
  const a = await env.DB.prepare('SELECT * FROM ems_appointments WHERE id=?').bind(id).first();
  if (!a) return api({ ok: false, error: 'Not found' }, 404);
  const status = APPT_STATUSES.includes(b.status) ? b.status : a.status;
  const start = isLocal(b.start_at) ? b.start_at : a.start_at;
  const unitId = parseInt(b.unit_id, 10) || a.unit_id || 1;
  let deviceId = a.device_id, trainerId = a.trainer_id;
  const moving = start !== a.start_at || unitId !== a.unit_id || (status === 'booked' && a.status !== 'booked');
  if (moving && ['booked', 'attended'].includes(status)) {
    const cl = a.client_id ? await env.DB.prepare('SELECT coach_id FROM ems_clients WHERE id=?').bind(a.client_id).first() : null;
    const pk = a.client_package_id ? await env.DB.prepare('SELECT machine_types FROM ems_client_packages WHERE id=?').bind(a.client_package_id).first() : null;
    const al = await allocate(env, unitId, start, a.kind, a.mode || 'in_person', { exceptId: a.id, prefer: cl && cl.coach_id, force: !!b.force, types: typesOf(pk) });
    if (!al.ok) return bad(al.error);
    deviceId = al.device_id; trainerId = al.trainer_id;
  }
  let pkgId = a.client_package_id;
  // A session moving back to booked/attended needs a package with room.
  if (a.kind === 'session' && a.client_id && ['booked', 'attended'].includes(status) && !pkgId) {
    const pkg = await bookablePackage(env, a.client_id);
    if (!pkg) return bad('No sessions left on this client\'s packages.');
    pkgId = pkg.id;
  }
  if (a.kind === 'session' && a.client_id && status === 'booked' && (start !== a.start_at || a.status !== 'booked')) {
    const el = await eligible(env, a.client_id, ['ems']);
    if (!el.ok) return bad(el.reason);
  }
  const notes = b.notes !== undefined ? nz(clean(b.notes, 300)) : a.notes;
  if (b.trainer_id !== undefined && parseInt(b.trainer_id, 10)) trainerId = parseInt(b.trainer_id, 10);
  await env.DB.prepare("UPDATE ems_appointments SET status=?, start_at=?, client_package_id=?, notes=?, unit_id=?, device_id=?, trainer_id=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?")
    .bind(status, start, pkgId, notes, unitId, deviceId, trainerId, id).run();
  return api({ ok: true });
}

const APPT_SELECT = `SELECT a.*, c.name client_name, c.phone client_phone, cp.name package_name, c.coach_id, s.name coach_name,
    t.name trainer_name, dv.name device_name, un.name unit_name, un.code unit_code,
    (SELECT ce.code FROM ems_certifications ce WHERE ce.staff_id=a.trainer_id AND ce.machine_type_id=dv.machine_type_id AND ce.status='active' AND ce.code IS NOT NULL ORDER BY ce.valid_until DESC LIMIT 1) trainer_cert
    FROM ems_appointments a LEFT JOIN ems_clients c ON c.id=a.client_id LEFT JOIN ems_client_packages cp ON cp.id=a.client_package_id
    LEFT JOIN ems_staff s ON s.id=c.coach_id LEFT JOIN ems_staff t ON t.id=a.trainer_id LEFT JOIN ems_devices dv ON dv.id=a.device_id LEFT JOIN ems_units un ON un.id=a.unit_id`;
async function listAppointments(env, url, sc) {
  const from = isDate(url.searchParams.get('from')) ? url.searchParams.get('from') : today();
  const to = isDate(url.searchParams.get('to')) ? url.searchParams.get('to') : from;
  const { results } = await env.DB.prepare(`${APPT_SELECT}
    WHERE substr(a.start_at,1,10) BETWEEN ? AND ? AND (a.unit_id IN (${sc.sql}) OR (a.mode='video' AND a.trainer_id IS NOT NULL AND ${sc.one ? '0' : '1'})) ORDER BY a.start_at, a.id`).bind(from, to).all();
  return api({ ok: true, appointments: results });
}

/* ---------------- Clients ---------------- */

async function listClients(env, url, sc) {
  const q = clean(url.searchParams.get('q'), 60);
  const status = url.searchParams.get('status') || 'active';
  const binds = [];
  let where = `c.status != 'deleted' AND (c.home_unit_id IN (${sc.sql}) OR c.home_unit_id IS NULL${sc.one ? '' : ` OR EXISTS (SELECT 1 FROM ems_appointments x WHERE x.client_id=c.id AND x.unit_id IN (${sc.sql}))`})`;
  if (['active', 'paused', 'completed'].includes(status)) { where += ' AND c.status=?'; binds.push(status); }
  if (q) { where += ' AND (c.name LIKE ? OR c.phone LIKE ?)'; binds.push(`%${q}%`, `%${q.replace(/\D/g, '') || q}%`); }
  const coach = url.searchParams.get('coach') || '';
  if (coach === 'none') where += ' AND c.coach_id IS NULL';
  else if (/^\d+$/.test(coach)) { where += ' AND c.coach_id=?'; binds.push(+coach); }
  const { results } = await env.DB.prepare(`SELECT c.id, c.name, c.phone, c.status, c.goal, c.cleared, c.target_weight, c.created_at, c.coach_id,
    (SELECT name FROM ems_staff s WHERE s.id=c.coach_id) coach_name, c.home_unit_id,
    (SELECT name FROM ems_units u WHERE u.id=c.home_unit_id) unit_name,
    (SELECT status FROM ems_admissions x WHERE x.client_id=c.id ORDER BY x.id DESC LIMIT 1) adm_status,
    (SELECT valid_until FROM ems_admissions x WHERE x.client_id=c.id ORDER BY x.id DESC LIMIT 1) adm_valid,
    (SELECT COUNT(*) FROM ems_appointments a WHERE a.client_id=c.id AND a.status='attended') attended,
    (SELECT MAX(start_at) FROM ems_appointments a WHERE a.client_id=c.id AND a.status='attended') last_visit,
    (SELECT MIN(start_at) FROM ems_appointments a WHERE a.client_id=c.id AND a.status='booked' AND a.start_at >= ?) next_visit,
    (SELECT weight FROM ems_measurements m WHERE m.client_id=c.id AND weight IS NOT NULL ORDER BY measured_on, id LIMIT 1) first_weight,
    (SELECT weight FROM ems_measurements m WHERE m.client_id=c.id AND weight IS NOT NULL ORDER BY measured_on DESC, id DESC LIMIT 1) last_weight,
    (SELECT IFNULL(SUM(sessions_total),0) FROM ems_client_packages p WHERE p.client_id=c.id AND p.status != 'closed') sessions_total
    FROM ems_clients c WHERE ${where} ORDER BY c.name LIMIT 500`).bind(nowLocal(), ...binds).all();
  return api({ ok: true, clients: results });
}

function readClientFields(b, partial) {
  const f = {};
  const bad = [];
  if (!partial || b.name !== undefined) { f.name = clean(b.name, 80); if (f.name.length < 2) bad.push('name'); }
  if (!partial || b.phone !== undefined) { f.phone = normalisePhone(b.phone); if (!f.phone) bad.push('mobile number'); }
  if (b.email !== undefined) { f.email = clean(b.email, 120) || null; if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) bad.push('email'); }
  if (b.gender !== undefined) f.gender = ['female', 'male', 'other'].includes(b.gender) ? b.gender : null;
  if (b.birth_year !== undefined) { f.birth_year = int(b.birth_year, 1920, new Date().getFullYear() - 18); if (f.birth_year === undefined) bad.push('birth year (18+ only)'); }
  if (b.height_cm !== undefined) { f.height_cm = num(b.height_cm, 120, 230); if (f.height_cm === undefined) bad.push('height'); }
  if (b.target_weight !== undefined) { f.target_weight = num(b.target_weight, 30, 250); if (f.target_weight === undefined) bad.push('target weight'); }
  if (b.goal !== undefined) f.goal = clean(b.goal, 200) || null;
  if (b.home_unit_id !== undefined) { const v = parseInt(b.home_unit_id, 10); f.home_unit_id = v > 0 ? v : null; }
  if (b.coach_id !== undefined) { const v = parseInt(b.coach_id, 10); f.coach_id = v > 0 ? v : null; }
  if (b.staff_notes !== undefined) f.staff_notes = String(b.staff_notes || '').slice(0, 2000) || null;
  if (b.status !== undefined && ['active', 'paused', 'completed'].includes(b.status)) f.status = b.status;
  // Clearance and screening are set only by the admission workflow (admission.js).
  return { f, bad };
}

async function createClient(env, me, b, sc) {
  const { f, bad: errs } = readClientFields(b, false);
  if (!f.home_unit_id) f.home_unit_id = sc.one || sc.ids[0] || 1;
  if (!sc.ids.includes(f.home_unit_id)) return bad('Choose one of your units as the home unit.');
  if (errs.length) return bad('Please check: ' + errs.join(', ') + '.');
  if (b.consent !== true) return bad('Confirm the client has agreed to their data being kept.');
  const dup = await env.DB.prepare("SELECT id FROM ems_clients WHERE substr(phone,-10)=? AND status != 'deleted'").bind(last10(f.phone)).first();
  if (dup) return api({ ok: false, error: 'A client with this mobile number already exists.', id: dup.id }, 409);
  const pin = randomPin();
  f.pin_hash = await hashSecret(pin);
  f.consent_at = new Date().toISOString().slice(0, 19) + 'Z';
  if (parseInt(b.lead_id, 10)) f.lead_id = parseInt(b.lead_id, 10);
  const cols = Object.keys(f);
  const r = await env.DB.prepare(`INSERT INTO ems_clients (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).bind(...cols.map(k => f[k])).run();
  const id = r.meta.last_row_id;
  await env.DB.prepare('INSERT OR IGNORE INTO ems_plans (client_id, updated_by) VALUES (?,?)').bind(id, me.id).run();
  if (f.lead_id) await env.DB.prepare("UPDATE leads SET status='booked', updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?").bind(f.lead_id).run();
  return api({ ok: true, id, pin });
}

async function updateClient(env, id, b, me) {
  const { f, bad: errs } = readClientFields(b, true);
  if (errs.length) return bad('Please check: ' + errs.join(', ') + '.');
  if (f.phone) {
    const dup = await env.DB.prepare("SELECT id FROM ems_clients WHERE substr(phone,-10)=? AND id != ? AND status != 'deleted'").bind(last10(f.phone), id).first();
    if (dup) return bad('Another client already uses this mobile number.');
  }
  const cols = Object.keys(f);
  if (!cols.length) return api({ ok: true });
  await env.DB.prepare(`UPDATE ems_clients SET ${cols.map(k => k + '=?').join(',')}, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`).bind(...cols.map(k => f[k]), id).run();
  if (f.phone && me) await linkRecheck(env, me, { clientId: id });
  return api({ ok: true });
}

async function deleteClient(env, id) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM ems_measurements WHERE client_id=?').bind(id),
    env.DB.prepare('DELETE FROM ems_checkins WHERE client_id=?').bind(id),
    env.DB.prepare('DELETE FROM ems_plans WHERE client_id=?').bind(id),
    env.DB.prepare('DELETE FROM ems_payments WHERE client_id=?').bind(id),
    env.DB.prepare('DELETE FROM ems_appointments WHERE client_id=?').bind(id),
    env.DB.prepare('DELETE FROM ems_client_packages WHERE client_id=?').bind(id),
    env.DB.prepare("DELETE FROM ems_sessions WHERE kind='client' AND subject_id=?").bind(id),
    env.DB.prepare('DELETE FROM ems_reminder_log WHERE client_id=?').bind(id),
    env.DB.prepare('DELETE FROM ems_clients WHERE id=?').bind(id),
  ]);
  return api({ ok: true });
}

async function resetPin(env, id) {
  const pin = randomPin();
  const r = await env.DB.prepare('UPDATE ems_clients SET pin_hash=? WHERE id=?').bind(await hashSecret(pin), id).run();
  if (!r.meta.changes) return api({ ok: false, error: 'Not found' }, 404);
  await env.DB.prepare("DELETE FROM ems_sessions WHERE kind='client' AND subject_id=?").bind(id).run();
  return api({ ok: true, pin });
}

async function savePlan(env, me, id, b) {
  if (!access(await packagesFor(env, id)).diet_plan) return bad(NOT_INCLUDED.diet_plan);
  const diet = DIETS.includes(b.diet) ? b.diet : 'kerala-balanced';
  const water = int(b.water_target, 4, 20), steps = int(b.steps_target, 1000, 25000), sleep = num(b.sleep_target, 5, 10);
  if ([water, steps, sleep].some(v => v === undefined || v === null)) return bad('Check the daily targets.');
  await env.DB.prepare(`INSERT INTO ems_plans (client_id, diet, water_target, steps_target, sleep_target, focus, updated_at, updated_by)
    VALUES (?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%SZ','now'),?)
    ON CONFLICT(client_id) DO UPDATE SET diet=excluded.diet, water_target=excluded.water_target, steps_target=excluded.steps_target,
    sleep_target=excluded.sleep_target, focus=excluded.focus, updated_at=excluded.updated_at, updated_by=excluded.updated_by`)
    .bind(id, diet, water, steps, sleep, nz(clean(b.focus, 600)), me.id).run();
  return api({ ok: true });
}

async function assignPackage(env, clientId, b, me) {
  const admin = me && me.role === 'admin';
  const def = parseInt(b.package_id, 10) ? await env.DB.prepare('SELECT * FROM ems_packages WHERE id=? AND active=1').bind(parseInt(b.package_id, 10)).first() : null;
  if (!def && !admin) return bad('Choose a package from the catalogue. Only admins can create custom packages.');
  let ent, name, price, programme, validity, mts, maxDisc;
  if (def) {
    ent = entOf(def, false); ent.sessions = def.sessions;
    name = def.name; price = def.price; programme = def.programme; validity = def.validity_days; mts = def.machine_types || '[]'; maxDisc = def.max_discount || 0;
    if (price == null) return bad('This package has no price yet. An admin must set it in the package builder.');
  } else {
    ent = readEntitlements(b);
    if (!ent) return bad('Check what the custom package includes.');
    name = clean(b.name, 80); price = int(b.price, 0, 10000000); programme = ['ems', 'weight', 'combined'].includes(b.programme) ? b.programme : 'ems';
    validity = int(b.validity_days, 7, 730) || 90; mts = JSON.stringify((Array.isArray(b.machine_types) ? b.machine_types : []).map(Number).filter(Boolean)); maxDisc = 100;
    if (!name || price == null || price === undefined) return bad('Enter the custom package name and price.');
  }
  if (programme !== 'weight' && ent.sessions < 1) return bad('An EMS package needs at least one session.');
  const discount = int(b.discount || 0, 0, 10000000);
  if (discount === undefined || discount > price) return bad('Check the discount.');
  const limit = Math.floor(price * maxDisc / 100);
  if (!admin && discount > limit) return bad(maxDisc ? `The most you can discount this package is ${maxDisc}% (₹${limit.toLocaleString('en-IN')}). Ask an admin for more.` : 'Discounts are not allowed on this package. Ask an admin.');
  const el = await eligible(env, clientId, needsProgrammes(programme));
  if (!el.ok) return bad(el.reason);
  if (price - discount > 0 && !(await confirmedPatient(env, clientId))) return bad('Packages are billed in the clinic app. Link this client to their clinic patient record first (Clinic record, on the Overview tab).');
  const start = isDate(b.start_date) ? b.start_date : today();
  const expiry = addDays(start, validity);
  const cl = await env.DB.prepare('SELECT home_unit_id FROM ems_clients WHERE id=?').bind(clientId).first();
  const unitId = parseInt(b.unit_id, 10) || (cl && cl.home_unit_id) || 1;
  const r = await env.DB.prepare('INSERT INTO ems_client_packages (client_id, package_id, name, sessions_total, price, discount, start_date, expiry_date, programme, unit_id, machine_types, entitlements) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(clientId, def ? def.id : null, name, ent.sessions, price, discount, start, expiry, programme, unitId, mts, JSON.stringify(ent)).run();
  const id = r.meta.last_row_id;
  if (price - discount <= 0) return api({ ok: true, id });
  const bill = await billPackage(env, me, id);
  if (bill[0] !== 200) {
    await env.DB.prepare('DELETE FROM ems_client_packages WHERE id=?').bind(id).run();
    return api({ ok: false, error: bill[1] }, bill[0]);
  }
  return api({ ok: true, id, invoice_id: bill[2].invoice_id });
}

async function updateClientPackage(env, id, b) {
  const sets = [], binds = [];
  if (['active', 'paused', 'closed'].includes(b.status)) { sets.push('status=?'); binds.push(b.status); }
  if (isDate(b.expiry_date)) { sets.push('expiry_date=?'); binds.push(b.expiry_date); }
  const s = int(b.sessions_total, 1, 200); if (s && b._admin) { sets.push('sessions_total=?'); binds.push(s); }
  if (!sets.length) return bad('Nothing to change.');
  await env.DB.prepare(`UPDATE ems_client_packages SET ${sets.join(',')} WHERE id=?`).bind(...binds, id).run();
  return api({ ok: true });
}

async function addMeasurement(env, me, b) {
  const clientId = parseInt(b.client_id, 10);
  if (!access(await packagesFor(env, clientId)).measurements) return bad(NOT_INCLUDED.measurements);
  const day = isDate(b.measured_on) && b.measured_on <= today() ? b.measured_on : today();
  const v = { weight: num(b.weight, 25, 300), waist: num(b.waist, 40, 250), hips: num(b.hips, 50, 250), body_fat: num(b.body_fat, 3, 70), muscle_mass: num(b.muscle_mass, 5, 150) };
  if (Object.values(v).some(x => x === undefined)) return bad('One of the measurements looks out of range. Check kg, cm/in and %.');
  if (Object.values(v).every(x => x === null)) return bad('Enter at least one measurement.');
  await env.DB.prepare('INSERT INTO ems_measurements (client_id, measured_on, weight, waist, hips, body_fat, muscle_mass, notes, staff_id) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(clientId, day, v.weight, v.waist, v.hips, v.body_fat, v.muscle_mass, nz(clean(b.notes, 300)), me.id).run();
  return api({ ok: true });
}

async function addPayment(env, me, b) {
  return bad('EMS payments are now taken in the clinic app, against the package bill, so they count in the clinic day book. Open the package and choose "Collect in clinic".');
}
async function listPayments(env, url, sc) {
  const from = isDate(url.searchParams.get('from')) ? url.searchParams.get('from') : today().slice(0, 8) + '01';
  const to = isDate(url.searchParams.get('to')) ? url.searchParams.get('to') : today();
  const { results } = await env.DB.prepare(`SELECT p.*, c.name client_name, cp.name package_name, (SELECT name FROM ems_units u WHERE u.id=p.unit_id) unit_name FROM ems_receipts p
    LEFT JOIN ems_clients c ON c.id=p.client_id LEFT JOIN ems_client_packages cp ON cp.id=p.client_package_id
    WHERE p.paid_on BETWEEN ? AND ? AND p.unit_id IN (${sc.sql}) ORDER BY p.paid_on DESC, p.id DESC`).bind(from, to).all();
  const out = await env.DB.prepare(`SELECT IFNULL(SUM(CASE WHEN ${EMS_DUE} - IFNULL((SELECT SUM(amount) FROM ems_receipts p WHERE p.client_package_id=cp.id),0) >= 1 THEN ${EMS_DUE} - IFNULL((SELECT SUM(amount) FROM ems_receipts p WHERE p.client_package_id=cp.id),0) ELSE 0 END),0) due
    FROM ems_client_packages cp JOIN ems_clients c ON c.id=cp.client_id WHERE c.status != 'deleted' AND cp.status != 'closed' AND IFNULL(cp.unit_id,1) IN (${sc.sql})`).first();
  return api({ ok: true, payments: results, from, to, outstanding: out ? out.due : 0 });
}

async function saveCheckin(env, clientId, b) {
  if (!access(await packagesFor(env, clientId)).diet_plan) return bad('Daily check-ins come with the diet and lifestyle plan, which isn\'t part of your package. Ask the clinic about upgrading.');
  const day = isDate(b.day) && b.day <= today() && b.day >= addDays(today(), -7) ? b.day : today();
  const v = { water: int(b.water, 0, 30), steps: int(b.steps, 0, 60000), sleep: num(b.sleep, 0, 16), meals: int(b.meals, 0, 4), energy: int(b.energy, 1, 5) };
  if (Object.values(v).some(x => x === undefined)) return bad('Please check your entries.');
  await env.DB.prepare(`INSERT INTO ems_checkins (client_id, day, water, steps, sleep, meals, energy, note) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(client_id, day) DO UPDATE SET water=excluded.water, steps=excluded.steps, sleep=excluded.sleep, meals=excluded.meals, energy=excluded.energy, note=excluded.note`)
    .bind(clientId, day, v.water, v.steps, v.sleep, v.meals, v.energy, nz(clean(b.note, 300))).run();
  return api({ ok: true });
}

/* ---------------- Client view + insights ---------------- */

async function clientView(env, id, staff) {
  const c = await env.DB.prepare("SELECT * FROM ems_clients WHERE id=? AND status != 'deleted'").bind(id).first();
  if (!c) return null;
  const [pkgs, appts, meas, pays, plan, checks] = await Promise.all([
    packagesFor(env, id),
    env.DB.prepare(`${APPT_SELECT} WHERE a.client_id=? ORDER BY a.start_at DESC LIMIT 300`).bind(id).all(),
    env.DB.prepare('SELECT * FROM ems_measurements WHERE client_id=? ORDER BY measured_on, id').bind(id).all(),
    env.DB.prepare('SELECT p.*, cp.name package_name FROM ems_receipts p LEFT JOIN ems_client_packages cp ON cp.id=p.client_package_id WHERE p.client_id=? ORDER BY p.paid_on DESC, p.id DESC').bind(id).all(),
    env.DB.prepare('SELECT * FROM ems_plans WHERE client_id=?').bind(id).first(),
    env.DB.prepare('SELECT * FROM ems_checkins WHERE client_id=? AND day >= ? ORDER BY day DESC').bind(id, addDays(today(), -60)).all(),
  ]);
  const client = { ...c, screening: safeJson(c.screening) };
  delete client.pin_hash;
  const coach = c.coach_id ? await env.DB.prepare('SELECT name FROM ems_staff WHERE id=?').bind(c.coach_id).first() : null;
  client.coach_name = coach ? coach.name : null;
  const hu = c.home_unit_id ? await getUnit(env, c.home_unit_id) : null;
  client.unit_name = hu ? hu.name : null;
  const p = plan || { diet: 'kerala-balanced', water_target: 10, steps_target: 7000, sleep_target: 7, focus: null };
  const data = { client, packages: pkgs, appointments: appts.results || [], measurements: meas.results || [], payments: pays.results || [], plan: p, checkins: checks.results || [] };
  const { results: adms } = await env.DB.prepare('SELECT * FROM ems_admissions WHERE client_id=? ORDER BY id DESC').bind(id).all();
  data.admissions = (adms || []).map(a => publicAdmission(a, c, staff));
  if (staff) data.clinic = await clinicForClient(env, c);
  data.admission = data.admissions[0] || null;
  data.screen_questions = SCREEN_QS;
  data.access = access(pkgs);
  data.insights = insights(data, staff);
  if (!staff) {
    delete client.staff_notes; delete client.screening; delete client.lead_id;
    data.appointments = data.appointments.map(({ staff_id, notes, device_id, ...a }) => a);
    data.units = (await listUnits(env, { activeOnly: true })).map(publicUnit);
    data.payments = data.payments.map(({ staff_id, ...x }) => x);

  }
  return data;
}
const safeJson = s => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };

function slope(points) { // points: [{d: days, v}] → per-day slope (least squares)
  const n = points.length;
  if (n < 2) return null;
  const mx = points.reduce((a, p) => a + p.d, 0) / n, my = points.reduce((a, p) => a + p.v, 0) / n;
  let num = 0, den = 0;
  for (const p of points) { num += (p.d - mx) * (p.v - my); den += (p.d - mx) ** 2; }
  return den ? num / den : null;
}
const r1 = v => Math.round(v * 10) / 10;

export function insights({ client: c, packages, appointments, measurements: meas, checkins, plan }, staff) {
  const t = today();
  const items = [];
  const add = (level, icon, title, text, staffOnly = false) => { if (!staffOnly || staff) items.push({ level, icon, title, text }); };
  const latest = k => { for (let i = meas.length - 1; i >= 0; i--) if (meas[i][k] != null) return meas[i]; return null; };
  const first = k => meas.find(m => m[k] != null) || null;
  const metrics = { change: {} };

  for (const k of ['weight', 'waist', 'hips', 'body_fat', 'muscle_mass']) {
    const a = first(k), b = latest(k);
    if (a && b) metrics.change[k] = { from: a[k], to: b[k], diff: r1(b[k] - a[k]), since: a.measured_on };
  }
  const w = latest('weight');
  if (w && c.height_cm) {
    const bmi = r1(w.weight / ((c.height_cm / 100) ** 2));
    metrics.bmi = { value: bmi, band: bmi < 18.5 ? 'Below range' : bmi < 23 ? 'Healthy range' : bmi < 25 ? 'Above range' : 'Well above range' };
  }
  const wa = latest('waist'), hi = latest('hips');
  if (wa && hi && wa.measured_on === hi.measured_on) {
    const v = Math.round((wa.waist / hi.hips) * 100) / 100;
    const lim = c.gender === 'male' ? 0.9 : 0.85;
    metrics.whr = { value: v, limit: lim, ok: v <= lim };
  }

  // Weight trend over the last 6 weeks
  const recent = meas.filter(m => m.weight != null && daysBetween(m.measured_on, t) <= 42);
  const sp = recent.length >= 2 && daysBetween(recent[0].measured_on, recent[recent.length - 1].measured_on) >= 7
    ? slope(recent.map(m => ({ d: daysBetween(recent[0].measured_on, m.measured_on), v: m.weight }))) : null;
  const perWeek = sp == null ? null : r1(sp * 7);
  metrics.weeklyRate = perWeek;
  const wantLoss = c.target_weight && w ? c.target_weight < w.weight - 0.2 : null;
  if (c.target_weight && w) {
    const gap = r1(w.weight - c.target_weight);
    metrics.target = { value: c.target_weight, gap };
    if (Math.abs(gap) <= 0.5) add('good', 'trophy', 'Target reached', `You're within half a kilo of your ${c.target_weight} kg goal. Talk to your coach about a maintenance plan.`);
    else if (perWeek && Math.sign(perWeek) === -Math.sign(gap) && Math.abs(perWeek) >= 0.1) {
      const weeks = Math.ceil(Math.abs(gap / perWeek));
      if (weeks <= 104) metrics.target.eta = addDays(t, weeks * 7);
    }
  }

  const ch = metrics.change;
  if (ch.weight && ch.weight.diff <= -1) add('good', 'trending-down', `${Math.abs(ch.weight.diff)} kg down`, `Since ${fmtDay(ch.weight.since)} — steady progress you can build on.`);
  if (ch.waist && ch.waist.diff <= -1) add('good', 'ruler', `${Math.abs(ch.waist.diff)} cm (${Math.round(Math.abs(ch.waist.diff) / 2.54 * 10) / 10} in) off your waist`, 'Waist size is one of the best signs of healthy change.');
  if (ch.waist && ch.waist.diff <= -1.5 && ch.weight && Math.abs(ch.weight.diff) < 1) add('tip', 'sparkles', 'Inches before kilos', 'Your waist is shrinking while weight holds steady — common when muscle tone improves. Keep going.');
  if (ch.muscle_mass && ch.muscle_mass.diff >= 0.5) add('good', 'dumbbell', `+${ch.muscle_mass.diff} kg muscle`, 'More muscle helps your body use energy better, even at rest.');

  if (perWeek != null && perWeek < -1.1 && recent.length >= 3) add('warn', 'alert-triangle', 'Losing faster than recommended', `About ${Math.abs(perWeek)} kg a week lately. A safer pace is 0.5–1 kg a week — make sure you're eating enough protein and not skipping meals.`);
  if (perWeek != null && perWeek < -1.1 && recent.length >= 3) add('alert', 'stethoscope', 'Review rapid weight loss', 'Check meals, hydration and wellbeing at the next visit; consider doctor review.', true);
  const last3w = meas.filter(m => m.weight != null && daysBetween(m.measured_on, t) <= 21);
  if (wantLoss && last3w.length >= 3 && daysBetween(last3w[0].measured_on, last3w[last3w.length - 1].measured_on) >= 14) {
    const ws = last3w.map(m => m.weight);
    if (Math.max(...ws) - Math.min(...ws) < 0.4) add('tip', 'activity', 'Plateau — time to mix it up', 'Weight has held steady for about 3 weeks. Try adding a 20-minute walk after dinner, swapping one rice serving for vegetables, and checking your sleep.');
  }
  if (wantLoss && perWeek != null && perWeek > 0.3) add('warn', 'trending-up', 'Weight is creeping up', 'Look at portion sizes, evening snacks and sugary drinks this week. Your coach can help adjust your plan.');

  // Attendance & packages
  const attended = appointments.filter(a => a.kind === 'session' && a.status === 'attended').map(a => a.start_at).sort();
  const lastVisit = attended[attended.length - 1] || null;
  const upcoming = appointments.filter(a => a.status === 'booked' && a.start_at >= nowLocal()).map(a => a.start_at).sort();
  const active = packages.filter(p => p.state === 'active');
  const sessionsLeft = active.reduce((a, p) => a + p.available, 0);
  const in28 = attended.filter(s => daysBetween(s, t) <= 28).length;
  metrics.attendance = { last28: in28, lastVisit, next: upcoming[0] || null, sessionsLeft };
  if (active.length && sessionsLeft > 0 && !upcoming.length) {
    const gap = lastVisit ? daysBetween(lastVisit, t) : null;
    if (gap == null || gap >= 5) add(gap != null && gap >= 10 ? 'warn' : 'tip', 'calendar-plus', 'Book your next session', gap != null ? `It's been ${gap} days since your last session. Twice a week keeps results moving.` : 'Your package is ready — book your first session.');
  }
  if (in28 >= 7) add('good', 'flame', 'Great consistency', `${in28} sessions in the last 4 weeks. Consistency is what makes EMS work.`);
  const pairs = attended.concat(upcoming).sort();
  for (let i = 1; i < pairs.length; i++) if (daysBetween(pairs[i - 1], t) <= 14 && Math.abs(hoursBetween(pairs[i - 1], pairs[i])) < 40) {
    add('tip', 'battery-charging', 'Allow recovery time', 'Two sessions were close together. Muscles need about 48 hours to recover between EMS sessions.'); break;
  }
  for (const p of active) {
    if (p.remaining <= 2 && p.remaining > 0) add('tip', 'package', `${p.remaining} session${p.remaining > 1 ? 's' : ''} left on ${p.name}`, 'Plan your next package now so your routine doesn\'t break.');
    if (p.expiry_date && p.remaining > 0 && daysBetween(t, p.expiry_date) <= 14) add('warn', 'clock', `${p.name} expires ${fmtDay(p.expiry_date)}`, `${p.remaining} session${p.remaining > 1 ? 's' : ''} still to use. Book them soon.`);
  }
  if (packages.some(p => p.balance > 0 && p.state !== 'closed')) add('tip', 'wallet', 'Payment pending', 'There is a balance on a package.', true);
  const lastM = meas.length ? meas[meas.length - 1].measured_on : null;
  if (lastM && daysBetween(lastM, t) > 14 && lastVisit && lastVisit.slice(0, 10) > lastM) add('tip', 'ruler', 'Progress check due', 'It\'s been over two weeks since the last measurements. Ask for a quick check at your next visit.');
  if (!meas.length) add('tip', 'ruler', 'Record a baseline', 'Take starting measurements so progress can be tracked.', true);

  // Lifestyle check-ins (last 7 days)
  const week = checkins.filter(x => daysBetween(x.day, t) < 7);
  const avg = k => { const v = week.map(x => x[k]).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const habits = { days: week.length, water: avg('water'), steps: avg('steps'), sleep: avg('sleep'), meals: avg('meals'), energy: avg('energy') };
  metrics.habits = habits;
  if (!week.length) add('tip', 'clipboard-check', 'Log your daily check-in', 'Takes 20 seconds: water, steps, sleep and meals. It helps us guide you better.');
  else {
    if (habits.water != null && habits.water < plan.water_target * 0.7) add('tip', 'droplet', 'Drink more water', `You're averaging ${r1(habits.water)} glasses a day against a target of ${plan.water_target}. Keep a bottle at your desk and drink a glass before each meal.`);
    if (habits.sleep != null && habits.sleep < plan.sleep_target - 0.5) add('tip', 'moon', 'Protect your sleep', `About ${r1(habits.sleep)} hours a night. Short sleep raises hunger hormones — aim for ${plan.sleep_target} hours and switch screens off 30 minutes before bed.`);
    if (habits.steps != null && habits.steps < plan.steps_target * 0.7) add('tip', 'footprints', 'Move a little more', `About ${Math.round(habits.steps).toLocaleString('en-IN')} steps a day. A 10-minute walk after lunch and after dinner adds roughly 2,000.`);
    if (habits.meals != null && habits.meals < 2) add('tip', 'utensils', 'Stick closer to your meal plan', 'Fewer than half your meals were on plan. Prepare tomorrow\'s lunch the night before and keep a healthy snack handy.');
    if (habits.energy != null && habits.energy <= 2) add('warn', 'battery-low', 'Low energy noticed', 'You\'ve logged low energy this week. Make sure you\'re eating enough, and mention it to your coach at your next visit.');
    if (week.length >= 5 && habits.water >= plan.water_target * 0.9 && (habits.meals == null || habits.meals >= 3)) add('good', 'check-circle', 'Strong habits this week', 'Hydration and meals are on track — this is where lasting change comes from.');
  }

  // Staff-only safety
  const flags = Object.keys(c.screening || {});
  if (!c.cleared) add('alert', 'shield-alert', 'Admission not complete', 'No package or EMS session until the health screening, clinician assessment and both signed consents are done. Open the Admission tab.', true);
  if (flags.length) add('alert', 'stethoscope', 'Screening flags', `Flagged: ${flags.join(', ')}. Confirm clinician clearance and adjust intensity.`, true);

  // Momentum score (0-100)
  const att = Math.min(1, in28 / 6) * 40;
  let hab = 15;
  if (week.length) {
    const parts = [];
    if (habits.water != null) parts.push(Math.min(1, habits.water / plan.water_target));
    if (habits.sleep != null) parts.push(Math.min(1, habits.sleep / plan.sleep_target));
    if (habits.steps != null) parts.push(Math.min(1, habits.steps / plan.steps_target));
    if (habits.meals != null) parts.push(Math.min(1, habits.meals / 3));
    hab = (parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0.5) * 30 * Math.min(1, week.length / 5 + 0.2);
  }
  let prog = 15;
  if (perWeek != null && wantLoss !== null) prog = wantLoss ? (perWeek <= -0.3 ? 30 : perWeek <= 0 ? 20 : 8) : (Math.abs(perWeek) < 0.3 ? 28 : 15);
  else if (ch.waist && ch.waist.diff < 0) prog = 25;
  metrics.score = Math.round(att + hab + prog);

  const order = { alert: 0, warn: 1, tip: 2, good: 3 };
  items.sort((a, b) => order[a.level] - order[b.level]);
  return { metrics, items };
}
const fmtDay = d => new Date(d.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/* ---------------- Dashboard ---------------- */

async function dashboard(env, sc, admin) {
  const t = today(), mon = mondayOf(t), monthStart = t.slice(0, 8) + '01';
  const U = sc.sql;
  const q = (sql, ...b) => env.DB.prepare(sql).bind(...b);
  const [todayAppts, counts, weekly, revenue, leads, outstanding] = await Promise.all([
    q(`${APPT_SELECT} WHERE substr(a.start_at,1,10)=? AND a.status != 'cancelled' AND a.unit_id IN (${U}) ORDER BY a.start_at`, t).all(),
    q(`SELECT
       (SELECT COUNT(*) FROM ems_clients WHERE status='active' AND IFNULL(home_unit_id,1) IN (${U})) active_clients,
       (SELECT COUNT(*) FROM ems_appointments WHERE status='attended' AND kind='session' AND unit_id IN (${U}) AND substr(start_at,1,10) BETWEEN ? AND ?) week_sessions,
       (SELECT COUNT(*) FROM ems_appointments WHERE status='booked' AND unit_id IN (${U}) AND start_at >= ?) upcoming,
       (SELECT IFNULL(SUM(amount),0) FROM ems_receipts WHERE unit_id IN (${U}) AND paid_on >= ?) month_revenue,
       (SELECT COUNT(*) FROM ems_appointments WHERE status='no_show' AND unit_id IN (${U}) AND substr(start_at,1,10) >= ?) month_noshow,
       (SELECT COUNT(*) FROM ems_appointments WHERE status IN ('attended','no_show') AND unit_id IN (${U}) AND substr(start_at,1,10) >= ?) month_closed`,
      mon, t, nowLocal(), monthStart, monthStart, monthStart).first(),
    q(`SELECT substr(start_at,1,10) d, COUNT(*) n FROM ems_appointments WHERE status='attended' AND kind='session' AND unit_id IN (${U}) AND substr(start_at,1,10) >= ? GROUP BY d`, addDays(mon, -49)).all(),
    q(`SELECT substr(paid_on,1,7) m, SUM(amount) n FROM ems_receipts WHERE unit_id IN (${U}) AND paid_on >= ? GROUP BY m`, addDays(monthStart, -160).slice(0, 8) + '01').all(),
    q(`SELECT COUNT(*) n FROM leads WHERE status='new' AND (interest LIKE '%EMS%' OR interest LIKE '%eight%' OR source='ems portal') AND (unit_id IS NULL OR unit_id IN (${U}))`).first(),
    q(`SELECT IFNULL(SUM(CASE WHEN ${EMS_DUE} - IFNULL((SELECT SUM(amount) FROM ems_receipts p WHERE p.client_package_id=cp.id),0) >= 1 THEN ${EMS_DUE} - IFNULL((SELECT SUM(amount) FROM ems_receipts p WHERE p.client_package_id=cp.id),0) ELSE 0 END),0) due
       FROM ems_client_packages cp JOIN ems_clients c ON c.id=cp.client_id WHERE cp.status != 'closed' AND IFNULL(cp.unit_id,1) IN (${U})`).first(),
  ]);
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const s = addDays(mon, -7 * i), e = addDays(s, 6);
    weeks.push({ label: s, value: (weekly.results || []).filter(r => r.d >= s && r.d <= e).reduce((a, r) => a + r.n, 0) });
  }
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(monthStart + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - i);
    const key = d.toISOString().slice(0, 7);
    months.push({ label: key, value: ((revenue.results || []).find(r => r.m === key) || {}).n || 0 });
  }
  const rem = await reminders(env, sc);
  const units = await unitStats(env, sc.ids, mon, monthStart);
  return { today: todayAppts.results || [], counts: { ...counts, new_leads: leads ? leads.n : 0, outstanding: outstanding ? outstanding.due : 0, reminders: rem.length }, weeks, months, reminders: rem.slice(0, 6), units };
}

/* ---------------- Reminders ---------------- */

async function reminders(env, sc) {
  const U = sc ? sc.sql : '0';
  const t = today(), tomorrow = addDays(t, 1), now = nowLocal();
  const out = [];
  const q = (sql, ...b) => env.DB.prepare(sql).bind(...b).all().then(r => r.results || []);
  const [logged, tmr, clients, leads] = await Promise.all([
    q("SELECT kind, ref FROM ems_reminder_log WHERE created_at > strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 days')"),
    q(`SELECT a.id, a.start_at, a.kind, a.guest_name, a.guest_phone, a.client_id, c.name, c.phone FROM ems_appointments a LEFT JOIN ems_clients c ON c.id=a.client_id
       WHERE a.status='booked' AND substr(a.start_at,1,10)=? AND a.unit_id IN (${U}) ORDER BY a.start_at`, tomorrow),
    q(`SELECT c.id, c.name, c.phone,
       (SELECT MAX(start_at) FROM ems_appointments a WHERE a.client_id=c.id AND a.status='attended') last_visit,
       (SELECT COUNT(*) FROM ems_appointments a WHERE a.client_id=c.id AND a.status='booked' AND a.start_at >= ?) upcoming,
       (SELECT MAX(measured_on) FROM ems_measurements m WHERE m.client_id=c.id) last_meas
       FROM ems_clients c WHERE c.status='active' AND IFNULL(c.home_unit_id,1) IN (${U})`, now),
    q(`SELECT id, name, phone, created_at, interest FROM leads WHERE status='new' AND (interest LIKE '%EMS%' OR interest LIKE '%eight%' OR source='ems portal') AND (unit_id IS NULL OR unit_id IN (${U}))
       AND created_at < strftime('%Y-%m-%dT%H:%M:%SZ','now','-2 hours') ORDER BY id DESC LIMIT 20`),
  ]);
  const done = new Set(logged.map(l => `${l.kind}:${l.ref}`));
  const push = r => { if (!done.has(`${r.kind}:${r.ref}`)) out.push(r); };

  for (const a of tmr) push({ kind: 'tomorrow', ref: String(a.id), priority: 1, client_id: a.client_id, name: a.name || a.guest_name, phone: a.phone || a.guest_phone,
    title: `${({ session: 'EMS session', consultation: 'Initial consultation', review: 'Progress review', wm_consult: 'Weight-management consultation' })[a.kind] || 'Appointment'} tomorrow at ${fmtTime(a.start_at)}`, start_at: a.start_at });

  for (const c of clients) {
    const pk = await packagesFor(env, c.id);
    const act = pk.filter(p => p.state === 'active');
    const avail = act.reduce((a, p) => a + p.available, 0);
    const gap = c.last_visit ? daysBetween(c.last_visit, t) : null;
    if (avail > 0 && !c.upcoming && (gap == null || gap >= 4)) push({ kind: 'rebook', ref: `${c.id}:${c.last_visit || 'none'}`, priority: gap != null && gap >= 10 ? 1 : 2, client_id: c.id, name: c.name, phone: c.phone,
      title: gap == null ? 'No session booked yet' : `No session booked · last visit ${gap} days ago`, sessions_left: avail });
    for (const p of act) {
      if (p.remaining <= 2 && p.remaining > 0) push({ kind: 'renew', ref: String(p.id), priority: 2, client_id: c.id, name: c.name, phone: c.phone, title: `${p.remaining} session${p.remaining > 1 ? 's' : ''} left on ${p.name} — offer renewal` });
      if (p.expiry_date && p.remaining > 0 && daysBetween(t, p.expiry_date) <= 14) push({ kind: 'expiry', ref: String(p.id), priority: 1, client_id: c.id, name: c.name, phone: c.phone, title: `${p.name} expires ${fmtDay(p.expiry_date)} with ${p.remaining} unused` });
    }
    for (const p of pk.filter(p => p.balance > 0 && p.status !== 'closed')) push({ kind: 'balance', ref: `${p.id}:${p.balance}`, priority: 3, client_id: c.id, name: c.name, phone: c.phone, title: `Balance due ₹${p.balance.toLocaleString('en-IN')} on ${p.name}`, amount: p.balance });
    if (c.last_visit && (!c.last_meas || daysBetween(c.last_meas, t) > 14) && (!c.last_meas || c.last_visit.slice(0, 10) > c.last_meas)) push({ kind: 'measure', ref: `${c.id}:${c.last_meas || 'none'}`, priority: 3, client_id: c.id, name: c.name, phone: c.phone, title: c.last_meas ? `Measurements due · last on ${fmtDay(c.last_meas)}` : 'No measurements recorded yet' });
  }
  const { results: adm } = await env.DB.prepare(`SELECT a.id, a.status, a.valid_until, a.updated_at, a.created_at, c.id cid, c.name, c.phone FROM ems_admissions a JOIN ems_clients c ON c.id=a.client_id
    WHERE c.status='active' AND IFNULL(c.home_unit_id,1) IN (${U}) AND a.id=(SELECT MAX(id) FROM ems_admissions x WHERE x.client_id=c.id)
    AND (a.status IN ('screening','client_consent') OR (a.status='admitted' AND a.valid_until <= ?))`).bind(addDays(t, 21)).all();
  for (const a of adm || []) {
    if (a.status === 'screening') push({ kind: 'admission', ref: `${a.id}:screen`, priority: 2, client_id: a.cid, name: a.name, phone: a.phone, title: 'Admission: health questionnaire not filled in', step: 'screening' });
    else if (a.status === 'client_consent') push({ kind: 'admission', ref: `${a.id}:sign`, priority: 1, client_id: a.cid, name: a.name, phone: a.phone, title: 'Admission: waiting for the client to sign consent', step: 'sign' });
    else push({ kind: 'admission', ref: `${a.id}:renew`, priority: 2, client_id: a.cid, name: a.name, phone: a.phone, title: `Admission ${a.valid_until < t ? 'expired' : 'expires'} ${fmtDay(a.valid_until)} — renew screening and consent`, step: 'renew' });
  }
  for (const l of leads) push({ kind: 'lead', ref: String(l.id), priority: 1, lead_id: l.id, name: l.name, phone: l.phone, title: `New enquiry not contacted · ${l.interest || 'EMS'}` });
  out.sort((a, b) => a.priority - b.priority);
  return out;
}
const fmtTime = s => { const [hh, mm] = s.slice(11, 16).split(':').map(Number); return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}`; };

async function logReminder(env, me, b) {
  const kind = clean(b.kind, 20), ref = clean(b.ref, 60);
  if (!kind || !ref) return bad('Missing reminder');
  await env.DB.prepare('INSERT INTO ems_reminder_log (client_id, lead_id, kind, ref, staff_id) VALUES (?,?,?,?,?)')
    .bind(parseInt(b.client_id, 10) || null, parseInt(b.lead_id, 10) || null, kind, ref, me.id).run();
  if (kind === 'lead' && parseInt(b.lead_id, 10)) await env.DB.prepare("UPDATE leads SET status='contacted', updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=? AND status='new'").bind(parseInt(b.lead_id, 10)).run();
  return api({ ok: true });
}

/* ---------------- Leads (from the website) ---------------- */

async function listLeads(env, url, sc, unitScope) {
  const scope = url.searchParams.get('scope') === 'all' ? '' : "AND (l.interest LIKE '%EMS%' OR l.interest LIKE '%eight%' OR l.source='ems portal')";
  const status = url.searchParams.get('status') || 'open';
  let sw = '';
  const binds = [];
  if (status === 'open') sw = "AND l.status IN ('new','contacted')";
  else if (LEAD_STATUSES.includes(status)) { sw = 'AND l.status=?'; binds.push(status); }
  const { results } = await env.DB.prepare(`SELECT l.*,
    (SELECT id FROM ems_clients c WHERE substr(c.phone,-10)=substr(l.phone,-10) AND c.status != 'deleted') client_id,
    (SELECT MIN(start_at) FROM ems_appointments a WHERE a.lead_id=l.id AND a.status='booked') booked_at
    , (SELECT name FROM ems_units u WHERE u.id=l.unit_id) unit_name
    FROM leads l WHERE 1=1 ${scope} ${sw} AND (l.unit_id IN (${sc.sql}) ${sc.one ? '' : 'OR l.unit_id IS NULL'}) ORDER BY l.id DESC LIMIT 200`).bind(...binds).all();
  return api({ ok: true, leads: results });
}

async function updateLead(env, id, b) {
  if (b.unit_id !== undefined) {
    const u = parseInt(b.unit_id, 10) || null;
    await env.DB.prepare("UPDATE leads SET unit_id=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?").bind(u, id).run();
    if (!b.status) return api({ ok: true });
  }
  const status = LEAD_STATUSES.includes(b.status) ? b.status : null;
  if (!status) return bad('Choose a status.');
  await env.DB.prepare("UPDATE leads SET status=?, notes=COALESCE(?,notes), updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?")
    .bind(status, b.notes !== undefined ? nz(clean(b.notes, 500)) : null, id).run();
  return api({ ok: true });
}

async function convertLead(env, me, id, b, sc) {
  const l = await env.DB.prepare('SELECT * FROM leads WHERE id=?').bind(id).first();
  if (!l) return api({ ok: false, error: 'Not found' }, 404);
  const start = String(b.start_at || '');
  if (!isLocal(start)) return bad('Choose a date and time for the consultation.');
  const mode = b.mode === 'video' ? 'video' : 'in_person';
  const unit = await unitFor(env, b, l.unit_id || sc.one || sc.ids[0]);
  if (!unit) return bad('Choose a unit.');
  const al = await allocate(env, unit.id, start, 'consultation', mode, { force: !!b.force });
  if (!al.ok) return bad(al.error);
  const existing = await env.DB.prepare("SELECT id FROM ems_clients WHERE substr(phone,-10)=? AND status != 'deleted'").bind(last10(l.phone)).first();
  await env.DB.prepare("INSERT INTO ems_appointments (client_id, lead_id, guest_name, guest_phone, kind, mode, start_at, duration, staff_id, notes, unit_id, trainer_id) VALUES (?,?,?,?,'consultation',?,?,?,?,?,?,?)")
    .bind(existing ? existing.id : null, id, l.name, l.phone, mode, start, al.duration, me.id, nz(clean(b.notes, 300) || l.concern), unit.id, al.trainer_id).run();
  await env.DB.prepare("UPDATE leads SET status='booked', unit_id=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?").bind(unit.id, id).run();
  return api({ ok: true });
}

/* ---------------- Admin: packages & staff ---------------- */

async function savePackageDef(env, id, b) {
  const name = clean(b.name, 80), validity = int(b.validity_days, 7, 730), price = int(b.price, 0, 10000000);
  const ent = readEntitlements(b);
  if (!name || !validity || !ent) return bad('Enter a name, validity and what the package includes.');
  const prog = ['ems', 'weight', 'combined'].includes(b.programme) ? b.programme : 'ems';
  if (prog !== 'weight' && ent.sessions < 1) return bad('An EMS package needs at least one EMS session.');
  if (prog === 'ems' && (ent.wm_consults || ent.diet_plan)) return bad('Weight-management consultations and the diet plan need the "EMS + weight management" or "Weight management" programme.');
  if (prog === 'weight' && ent.sessions) return bad('A weight-management-only package cannot include EMS sessions.');
  if (price === undefined || price === null) return bad('Enter the selling price.');
  const v = valuation(ent, await priceList(env));
  if (price < v.cost && b.below_cost !== true) return api({ ok: false, error: `The price is below cost (₹${v.cost.toLocaleString('en-IN')}). Tick "allow below cost" to save anyway.`, below_cost: true }, 400);
  const maxDisc = Math.min(50, Math.max(0, parseInt(b.max_discount, 10) || 0));
  const desc = nz(clean(b.description, 200)), active = b.active === false ? 0 : 1;
  const mts = JSON.stringify((Array.isArray(b.machine_types) ? b.machine_types : []).map(Number).filter(Boolean));
  const vals = [name, ent.sessions, price, validity, desc, active, prog, mts, JSON.stringify(ent), v.cost, maxDisc];
  if (id) await env.DB.prepare('UPDATE ems_packages SET name=?, sessions=?, price=?, validity_days=?, description=?, active=?, programme=?, machine_types=?, entitlements=?, cost=?, max_discount=? WHERE id=?').bind(...vals, id).run();
  else await env.DB.prepare('INSERT INTO ems_packages (name, sessions, price, validity_days, description, active, programme, machine_types, entitlements, cost, max_discount) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(...vals).run();
  return api({ ok: true });
}

async function saveUser(env, id, b) {
  const name = clean(b.name, 80), username = clean(b.username, 40).toLowerCase(), role = ['admin', 'manager'].includes(b.role) ? b.role : 'staff';
  const skills = (Array.isArray(b.skills) ? b.skills : []).filter(k => SKILLS[k]);
  const unitIds = (Array.isArray(b.units) ? b.units : []).map(Number).filter(Boolean);
  if (role !== 'admin' && !unitIds.length) return bad('Choose at least one unit for this team member.');
  if (skills.includes('doctor') && !clean(b.reg_no, 40)) return bad('Enter the doctor\'s registration number.');
  const cur = id ? await env.DB.prepare('SELECT username FROM ems_staff WHERE id=?').bind(id).first() : null;
  if (name.length < 2 || !/^[a-z0-9._-]{3,40}$/.test(username) || (username === 'hasta' && !(cur && cur.username === 'hasta'))) return bad('Enter a name and a username (letters and numbers, not "hasta").');
  if (cur && cur.username === 'hasta' && (username !== 'hasta' || b.role !== 'admin' || b.active === false)) return bad('The main clinic admin account keeps the username "hasta" and stays an active admin.');
  const pw = String(b.password || '');
  if (!id && pw.length < 8) return bad('Set a password of at least 8 characters.');
  if (pw && pw.length < 8) return bad('Passwords need at least 8 characters.');
  const dup = await env.DB.prepare('SELECT id FROM ems_staff WHERE username=? AND id != ?').bind(username, id || 0).first();
  if (dup) return bad('That username is taken.');
  let staffId = id;
  if (id) {
    await env.DB.prepare('UPDATE ems_staff SET name=?, username=?, role=?, active=?, skills=?, reg_no=? WHERE id=?').bind(name, username, role, b.active === false ? 0 : 1, JSON.stringify(skills), nz(clean(b.reg_no, 40)), id).run();
    if (pw) await env.DB.prepare('UPDATE ems_staff SET pass_hash=? WHERE id=?').bind(await hashSecret(pw), id).run();
    if (b.active === false) await env.DB.prepare("DELETE FROM ems_sessions WHERE kind='staff' AND subject_id=?").bind(id).run();
  } else {
    staffId = (await env.DB.prepare('INSERT INTO ems_staff (name, username, role, pass_hash, skills, reg_no) VALUES (?,?,?,?,?,?)').bind(name, username, role, await hashSecret(pw), JSON.stringify(skills), nz(clean(b.reg_no, 40))).run()).meta.last_row_id;
  }
  await env.DB.prepare('DELETE FROM ems_staff_units WHERE staff_id=?').bind(staffId).run();
  for (const u of unitIds) await env.DB.prepare('INSERT OR IGNORE INTO ems_staff_units (staff_id, unit_id) VALUES (?,?)').bind(staffId, u).run();
  await env.DB.prepare(`DELETE FROM ems_rota WHERE staff_id=? AND unit_id NOT IN (${unitIds.length ? unitIds.join(',') : 0})`).bind(staffId).run();
  return api({ ok: true });
}

/* ---------------- Daily jobs ---------------- */

export async function emsDaily(env) {
  await env.DB.prepare("DELETE FROM ems_sessions WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%SZ','now')").run();
  await env.DB.prepare("DELETE FROM ems_login_attempts WHERE at < strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 day')").run();
  await env.DB.prepare("DELETE FROM ems_reminder_log WHERE created_at < strftime('%Y-%m-%dT%H:%M:%SZ','now','-60 days')").run();
  await env.DB.prepare(`UPDATE ems_clients SET cleared=0 WHERE cleared=1 AND NOT EXISTS (SELECT 1 FROM ems_admissions a WHERE a.client_id=ems_clients.id AND a.status='admitted' AND a.valid_until >= ?)`).bind(today()).run();
  // Morning digest for the team (cron runs ~03:00 IST).
  const t = today();
  const { results } = await env.DB.prepare(`SELECT a.start_at, a.kind, IFNULL(c.name, a.guest_name) name FROM ems_appointments a LEFT JOIN ems_clients c ON c.id=a.client_id
    WHERE a.status='booked' AND substr(a.start_at,1,10)=? ORDER BY a.start_at`).bind(t).all();
  const rem = await reminders(env);
  if (!(results || []).length && !rem.length) return;
  const rows = [['Appointments today', String((results || []).length)]];
  for (const a of (results || []).slice(0, 15)) rows.push([fmtTime(a.start_at), `${a.name} · ${a.kind}`]);
  rows.push(['Follow-ups waiting', String(rem.length)]);
  await notify(env, `EMS today: ${(results || []).length} appointments, ${rem.length} follow-ups`, rows, '/', env.EMS_ORIGIN || 'https://ems.hastawellnessclinic.com');
}

/* ---------------- Hasta EMS Academy ---------------- */

const UPLOAD_TYPES = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
async function academyUpload(request, env) {
  if (!sameOrigin(request)) return api({ ok: false, error: 'Forbidden' }, 403);
  const me = await getSession(request, env);
  if (!me || me.kind !== 'staff') return api({ ok: false, error: 'Please sign in.' }, 401);
  const type = (request.headers.get('content-type') || '').split(';')[0].trim();
  if (!UPLOAD_TYPES[type]) return bad('Upload a PDF, JPG, PNG or WebP file.');
  const len = parseInt(request.headers.get('content-length') || '0', 10);
  if (!len || len > 8 * 1024 * 1024) return api({ ok: false, error: 'Files must be under 8 MB.' }, 413);
  const buf = await request.arrayBuffer();
  if (buf.byteLength > 8 * 1024 * 1024) return api({ ok: false, error: 'Files must be under 8 MB.' }, 413);
  const key = `academy/${crypto.randomUUID()}.${UPLOAD_TYPES[type]}`;
  await env.CVS.put(key, buf, { httpMetadata: { contentType: type }, customMetadata: { by: String(me.id) } });
  return api({ ok: true, key });
}

async function academyRoute(request, env, url, me, p, m, body, admin) {
  let r;
  const ok = x => api({ ok: true, ...x });
  if (p === '/staff/academy' && m === 'GET') return ok(await AC.overview(env, me));
  if (p === '/staff/academy/file' && m === 'GET') {
    const key = url.searchParams.get('key') || '';
    if (!/^academy\/[0-9a-f-]{36}\.(pdf|jpg|png|webp)$/.test(key)) return bad('Invalid file.');
    const obj = await env.CVS.get(key);
    if (!obj) return api({ ok: false, error: 'Not found' }, 404);
    return new Response(obj.body, { headers: { ...HEADERS, 'content-type': obj.httpMetadata?.contentType || 'application/octet-stream', 'content-disposition': 'inline', 'cache-control': 'private, no-store' } });
  }
  if ((r = p.match(/^\/staff\/academy\/curriculum\/(\d+)\/approve$/)) && m === 'POST') return done(await AC.approveCurriculum(env, me, +r[1]));
  if (p === '/staff/academy/curriculum' && m === 'POST') return done(await AC.newVersion(env, me, body));
  if (p === '/staff/academy/materials' && m === 'GET') return ok({ materials: await AC.listMaterials(env) });
  if (p === '/staff/academy/materials' && m === 'POST') return done(await AC.addMaterial(env, me, body));
  if (p === '/staff/academy/questions' && m === 'GET') return ok({ questions: await AC.listQuestions(env) });
  if (p === '/staff/academy/questions' && m === 'POST') return done(await AC.saveQuestion(env, me, null, body));
  if ((r = p.match(/^\/staff\/academy\/questions\/(\d+)$/)) && m === 'PUT') return done(await AC.saveQuestion(env, me, +r[1], body));
  if (p === '/staff/academy/questions/approve' && m === 'POST') return done(await AC.approveQuestions(env, me, body.ids, body.status));
  if (p === '/staff/academy/quals' && m === 'GET') return ok({ quals: await AC.listQuals(env) });
  if (p === '/staff/academy/quals' && m === 'POST') return done(await AC.submitQual(env, me, body));
  if ((r = p.match(/^\/staff\/academy\/quals\/(\d+)\/(verify|reject)$/)) && m === 'POST') return done(await AC.verifyQual(env, me, +r[1], body, r[2]));
  if ((r = p.match(/^\/staff\/academy\/master-course\/(\d+)$/)) && m === 'POST') return done(await AC.recordMasterCourse(env, me, +r[1], body));
  if (p === '/staff/academy/records' && m === 'GET') return ok({ records: await AC.listRecords(env, me, url.searchParams.get('mine') !== '1') });
  if (p === '/staff/academy/records' && m === 'POST') return done(await AC.openRecord(env, me, body));
  if ((r = p.match(/^\/staff\/academy\/records\/(\d+)\/test$/)) && m === 'POST') return done(await AC.startTest(env, me, +r[1]));
  if ((r = p.match(/^\/staff\/academy\/attempts\/(\d+)$/)) && m === 'POST') return done(await AC.submitTest(env, me, +r[1], body));
  if ((r = p.match(/^\/staff\/academy\/records\/(\d+)\/retrain$/)) && m === 'POST') return done(await AC.resetRetraining(env, me, +r[1], body));
  if ((r = p.match(/^\/staff\/academy\/records\/(\d+)\/logs$/)) && m === 'POST') return done(await AC.addLog(env, me, +r[1], body));
  if ((r = p.match(/^\/staff\/academy\/records\/(\d+)\/practical$/)) && m === 'POST') return done(await AC.addPractical(env, me, +r[1], body));
  if ((r = p.match(/^\/staff\/academy\/records\/(\d+)\/certify$/)) && m === 'POST') return done(await AC.certifyRecord(env, me, +r[1]));
  if ((r = p.match(/^\/staff\/academy\/certificates\/(\d+)\/countersign$/)) && m === 'POST') return done(await AC.countersign(env, me, +r[1]));
  if ((r = p.match(/^\/staff\/academy\/certificates\/(\d+)\/pdf$/)) && m === 'GET') {
    const c = await AC.certDetail(env, 'c.id=?', +r[1]);
    if (!c || !c.code) return api({ ok: false, error: 'This certificate was issued before the Academy and has no PDF.' }, 404);
    const bytes = await AC.certificatePdf(env, request, c);
    return new Response(bytes, { headers: { ...HEADERS, 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="Hasta-EMS-certificate-${c.code}.pdf"` } });
  }
  return null;
}
