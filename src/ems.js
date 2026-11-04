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

import { json, sameOrigin, clean, nz, normalisePhone, h, sha256, notify } from './util.js';

const STAFF_TTL_H = 12;
const CLIENT_TTL_D = 30;
const SLOT_MIN = 30;
const HOURS = { 0: ['10:00', '14:00'], 1: ['10:00', '20:00'], 2: ['10:00', '20:00'], 3: ['10:00', '20:00'], 4: ['10:00', '20:00'], 5: ['10:00', '20:00'], 6: ['10:00', '20:00'] };
const APPT_STATUSES = ['booked', 'attended', 'no_show', 'cancelled'];
const APPT_KINDS = ['session', 'consultation', 'review'];
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
async function verifySecret(secret, stored) {
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

async function getSession(request, env) {
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
<link rel="stylesheet" href="/ems/app.css?v=1">
</head><body><div id="app"><div class="boot"><img src="/img/hasta-emblem.webp" alt="" width="56" height="56"></div></div>
<script type="module" src="/ems/app.js?v=1"></script></body></html>`;
}

/* ---------------- Router ---------------- */

async function route(request, env, url, ctx, base, p) {
  const m = request.method;
  let body = {};
  if (m !== 'GET') {
    if (!sameOrigin(request)) return api({ ok: false, error: 'Forbidden' }, 403);
    if (!(request.headers.get('content-type') || '').includes('application/json')) return api({ ok: false, error: 'Unsupported' }, 415);
    if (parseInt(request.headers.get('content-length') || '0', 10) > 20000) return api({ ok: false, error: 'Too large' }, 413);
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

  if (p === '/slots' && m === 'GET') {
    const d = url.searchParams.get('date');
    if (!isDate(d)) return bad('Choose a date.');
    return api({ ok: true, slots: await slots(env, d, me.kind === 'staff') });
  }
  if (p === '/me/secret' && m === 'POST') return changeSecret(env, me, body);

  if (me.kind === 'client') {
    if (p === '/client/overview' && m === 'GET') return api({ ok: true, ...(await clientView(env, me.id, false)) });
    if (p === '/client/appointments' && m === 'POST') return clientBook(env, ctx, url, me, body);
    let r;
    if ((r = p.match(/^\/client\/appointments\/(\d+)\/cancel$/)) && m === 'POST') return clientCancel(env, me, +r[1]);
    if (p === '/client/checkins' && m === 'POST') return saveCheckin(env, me.id, body);
    return api({ ok: false, error: 'Not found' }, 404);
  }

  // Staff
  const admin = me.role === 'admin';
  let r;
  if (p === '/staff/dashboard' && m === 'GET') return api({ ok: true, ...(await dashboard(env)) });
  if (p === '/staff/clients' && m === 'GET') return listClients(env, url);
  if (p === '/staff/clients' && m === 'POST') return createClient(env, me, body);
  if ((r = p.match(/^\/staff\/clients\/(\d+)$/))) {
    if (m === 'GET') { const v = await clientView(env, +r[1], true); return v ? api({ ok: true, ...v }) : api({ ok: false, error: 'Not found' }, 404); }
    if (m === 'PUT') return updateClient(env, +r[1], body);
    if (m === 'DELETE') return admin ? deleteClient(env, +r[1]) : api({ ok: false, error: 'Only an admin can delete records.' }, 403);
  }
  if ((r = p.match(/^\/staff\/clients\/(\d+)\/pin$/)) && m === 'POST') return resetPin(env, +r[1]);
  if ((r = p.match(/^\/staff\/clients\/(\d+)\/plan$/)) && m === 'PUT') return savePlan(env, me, +r[1], body);
  if ((r = p.match(/^\/staff\/clients\/(\d+)\/packages$/)) && m === 'POST') return assignPackage(env, +r[1], body);
  if ((r = p.match(/^\/staff\/client-packages\/(\d+)$/)) && m === 'PUT') return updateClientPackage(env, +r[1], body);
  if (p === '/staff/measurements' && m === 'POST') return addMeasurement(env, me, body);
  if ((r = p.match(/^\/staff\/measurements\/(\d+)$/)) && m === 'DELETE') { await env.DB.prepare('DELETE FROM ems_measurements WHERE id=?').bind(+r[1]).run(); return api({ ok: true }); }
  if (p === '/staff/payments' && m === 'POST') return addPayment(env, me, body);
  if ((r = p.match(/^\/staff\/payments\/(\d+)$/)) && m === 'DELETE') {
    if (!admin) return api({ ok: false, error: 'Only an admin can remove payments.' }, 403);
    await env.DB.prepare('DELETE FROM ems_payments WHERE id=?').bind(+r[1]).run(); return api({ ok: true });
  }
  if (p === '/staff/payments' && m === 'GET') return listPayments(env, url);
  if (p === '/staff/appointments' && m === 'GET') return listAppointments(env, url);
  if (p === '/staff/appointments' && m === 'POST') return staffBook(env, me, body);
  if ((r = p.match(/^\/staff\/appointments\/(\d+)$/)) && m === 'PUT') return updateAppointment(env, +r[1], body);
  if (p === '/staff/leads' && m === 'GET') return listLeads(env, url);
  if ((r = p.match(/^\/staff\/leads\/(\d+)$/)) && m === 'PUT') return updateLead(env, +r[1], body);
  if ((r = p.match(/^\/staff\/leads\/(\d+)\/convert$/)) && m === 'POST') return convertLead(env, me, +r[1], body);
  if (p === '/staff/reminders' && m === 'GET') return api({ ok: true, reminders: await reminders(env) });
  if (p === '/staff/reminders/log' && m === 'POST') return logReminder(env, me, body);
  if (p === '/staff/packages' && m === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM ems_packages ORDER BY active DESC, sessions, id').all();
    return api({ ok: true, packages: results });
  }
  if (p === '/staff/packages' && m === 'POST') return admin ? savePackageDef(env, null, body) : api({ ok: false, error: 'Admins only.' }, 403);
  if ((r = p.match(/^\/staff\/packages\/(\d+)$/)) && m === 'PUT') return admin ? savePackageDef(env, +r[1], body) : api({ ok: false, error: 'Admins only.' }, 403);
  if (p === '/staff/users' && m === 'GET') {
    if (!admin) return api({ ok: false, error: 'Admins only.' }, 403);
    const { results } = await env.DB.prepare('SELECT id, name, username, role, active, created_at FROM ems_staff ORDER BY active DESC, name').all();
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
  await env.DB.prepare("INSERT INTO leads (source, request_type, name, phone, interest, concern, timing, preferred_date, page) VALUES ('ems portal','Consultation',?,?,'EMS & Weight Management',?,?,?,'ems portal')")
    .bind(name, phone, nz(goal), nz(clean(b.timing, 60)), date).run();
  const alert = notify(env, 'New EMS consultation request', [['Name', name], ['Mobile', phone], ['Goal', goal], ['Preferred date', date], ['Timing', clean(b.timing, 60)]], '/#/leads', emsOrigin(env, url));
  if (ctx && ctx.waitUntil) ctx.waitUntil(alert);
  return api({ ok: true });
}
const emsOrigin = (env, url) => env.EMS_ORIGIN || (url.hostname.startsWith('ems.') ? url.origin : url.origin + '/ems');

/* ---------------- Slots & booking ---------------- */

function slotTimes(d) {
  const [open, close] = HOURS[dow(d)];
  const out = [];
  let [hh, mm] = open.split(':').map(Number);
  const [ch, cm] = close.split(':').map(Number);
  while (hh * 60 + mm + SLOT_MIN <= ch * 60 + cm) {
    out.push(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
    mm += SLOT_MIN; if (mm >= 60) { hh++; mm -= 60; }
  }
  return out;
}
const capacity = env => Math.max(1, parseInt(env.EMS_SLOT_CAPACITY || '2', 10));

async function slots(env, d, staff) {
  const { results } = await env.DB.prepare("SELECT substr(start_at,12,5) t, COUNT(*) n FROM ems_appointments WHERE substr(start_at,1,10)=? AND status IN ('booked','attended') GROUP BY t").bind(d).all();
  const used = Object.fromEntries((results || []).map(r => [r.t, r.n]));
  const cap = capacity(env), now = nowLocal();
  const minAhead = staff ? 0 : 2;
  return slotTimes(d).map(t => ({ time: t, left: Math.max(0, cap - (used[t] || 0)) }))
    .filter(s => hoursBetween(now, `${d}T${s.time}`) >= minAhead);
}

async function slotFree(env, start) {
  const r = await env.DB.prepare("SELECT COUNT(*) n FROM ems_appointments WHERE start_at=? AND status IN ('booked','attended')").bind(start).first();
  return (r ? r.n : 0) < capacity(env);
}
function withinHours(start) {
  return slotTimes(start.slice(0, 10)).includes(start.slice(11));
}

async function packagesFor(env, clientId) {
  const { results } = await env.DB.prepare(`SELECT cp.*,
    (SELECT COUNT(*) FROM ems_appointments a WHERE a.client_package_id=cp.id AND a.status='attended') used,
    (SELECT COUNT(*) FROM ems_appointments a WHERE a.client_package_id=cp.id AND a.status='booked') booked,
    (SELECT IFNULL(SUM(amount),0) FROM ems_payments p WHERE p.client_package_id=cp.id) paid
    FROM ems_client_packages cp WHERE cp.client_id=? ORDER BY cp.start_date, cp.id`).bind(clientId).all();
  const t = today();
  return (results || []).map(p => {
    const remaining = Math.max(0, p.sessions_total - p.used);
    const due = Math.max(0, p.price - p.discount);
    let state = p.status;
    if (state === 'active') {
      if (p.used >= p.sessions_total) state = 'completed';
      else if (p.expiry_date && p.expiry_date < t) state = 'expired';
    }
    return { ...p, remaining, available: Math.max(0, remaining - p.booked), due, balance: due - p.paid, state };
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
  if (!isLocal(start) || !withinHours(start)) return bad('Please choose one of the available times.');
  if (hoursBetween(nowLocal(), start) < 2) return bad('Please book at least 2 hours ahead, or call the clinic.');
  if (start.slice(0, 10) > addDays(today(), 30)) return bad('You can book up to 30 days ahead.');
  const c = await env.DB.prepare('SELECT cleared, status FROM ems_clients WHERE id=?').bind(me.id).first();
  if (!c || c.status !== 'active') return bad('Your programme is paused. Please contact the clinic.');
  if (!c.cleared) return bad('Your suitability check is still to be confirmed by the clinic. Please call us to book your first session.');
  const pkg = await bookablePackage(env, me.id);
  if (!pkg) return bad('You have no sessions left to book. Ask the clinic about renewing your package.');
  const clash = await recoveryClash(env, me.id, start);
  if (clash) return bad('EMS works best with about 48 hours of recovery between sessions. Please pick a time further from your other session.');
  if (!(await slotFree(env, start))) return bad('That time has just been taken. Please choose another.');
  await env.DB.prepare("INSERT INTO ems_appointments (client_id, kind, start_at, client_package_id, created_by) VALUES (?,'session',?,?,'client')")
    .bind(me.id, start, pkg.id).run();
  const alert = notify(env, `EMS session booked by ${me.name}`, [['Client', me.name], ['Mobile', me.phone], ['When', start.replace('T', ' ') + ' IST'], ['Package', pkg.name]], '/#/schedule', emsOrigin(env, url));
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

async function staffBook(env, me, b) {
  const start = String(b.start_at || '');
  const kind = APPT_KINDS.includes(b.kind) ? b.kind : 'session';
  if (!isLocal(start)) return bad('Choose a date and time.');
  const clientId = parseInt(b.client_id, 10) || null;
  let guestName = null, guestPhone = null;
  if (!clientId) {
    guestName = clean(b.guest_name, 80); guestPhone = normalisePhone(b.guest_phone);
    if (!guestName || !guestPhone) return bad('Choose a client, or enter a name and mobile for a new consultation.');
  }
  let pkgId = null;
  const warnings = [];
  if (clientId && kind === 'session') {
    const pkg = await bookablePackage(env, clientId);
    if (!pkg) return bad('This client has no sessions left. Add a package first.');
    pkgId = pkg.id;
    if (await recoveryClash(env, clientId, start)) warnings.push('Less than 48 hours from another session.');
    const c = await env.DB.prepare('SELECT cleared FROM ems_clients WHERE id=?').bind(clientId).first();
    if (c && !c.cleared) warnings.push('Suitability not yet confirmed.');
  }
  if (!b.force && !(await slotFree(env, start))) return bad('That time slot is full. Choose another or tick "overbook".');
  if (!withinHours(start)) warnings.push('Outside normal clinic hours.');
  await env.DB.prepare('INSERT INTO ems_appointments (client_id, lead_id, guest_name, guest_phone, kind, start_at, client_package_id, staff_id, notes) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(clientId, parseInt(b.lead_id, 10) || null, guestName, guestPhone, kind, start, pkgId, me.id, nz(clean(b.notes, 300))).run();
  return api({ ok: true, warnings });
}

async function updateAppointment(env, id, b) {
  const a = await env.DB.prepare('SELECT * FROM ems_appointments WHERE id=?').bind(id).first();
  if (!a) return api({ ok: false, error: 'Not found' }, 404);
  const status = APPT_STATUSES.includes(b.status) ? b.status : a.status;
  const start = isLocal(b.start_at) ? b.start_at : a.start_at;
  if (start !== a.start_at && !b.force && !(await slotFree(env, start))) return bad('That time slot is full.');
  let pkgId = a.client_package_id;
  // A session moving back to booked/attended needs a package with room.
  if (a.kind === 'session' && a.client_id && ['booked', 'attended'].includes(status) && !pkgId) {
    const pkg = await bookablePackage(env, a.client_id);
    if (!pkg) return bad('No sessions left on this client\'s packages.');
    pkgId = pkg.id;
  }
  const notes = b.notes !== undefined ? nz(clean(b.notes, 300)) : a.notes;
  await env.DB.prepare("UPDATE ems_appointments SET status=?, start_at=?, client_package_id=?, notes=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?")
    .bind(status, start, pkgId, notes, id).run();
  return api({ ok: true });
}

async function listAppointments(env, url) {
  const from = isDate(url.searchParams.get('from')) ? url.searchParams.get('from') : today();
  const to = isDate(url.searchParams.get('to')) ? url.searchParams.get('to') : from;
  const { results } = await env.DB.prepare(`SELECT a.*, c.name client_name, c.phone client_phone, cp.name package_name
    FROM ems_appointments a LEFT JOIN ems_clients c ON c.id=a.client_id LEFT JOIN ems_client_packages cp ON cp.id=a.client_package_id
    WHERE substr(a.start_at,1,10) BETWEEN ? AND ? ORDER BY a.start_at, a.id`).bind(from, to).all();
  return api({ ok: true, appointments: results, capacity: capacity(env) });
}

/* ---------------- Clients ---------------- */

async function listClients(env, url) {
  const q = clean(url.searchParams.get('q'), 60);
  const status = url.searchParams.get('status') || 'active';
  const binds = [];
  let where = "c.status != 'deleted'";
  if (['active', 'paused', 'completed'].includes(status)) { where += ' AND c.status=?'; binds.push(status); }
  if (q) { where += ' AND (c.name LIKE ? OR c.phone LIKE ?)'; binds.push(`%${q}%`, `%${q.replace(/\D/g, '') || q}%`); }
  const { results } = await env.DB.prepare(`SELECT c.id, c.name, c.phone, c.status, c.goal, c.cleared, c.target_weight, c.created_at,
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
  if (b.staff_notes !== undefined) f.staff_notes = String(b.staff_notes || '').slice(0, 2000) || null;
  if (b.status !== undefined && ['active', 'paused', 'completed'].includes(b.status)) f.status = b.status;
  if (b.cleared !== undefined) f.cleared = b.cleared ? 1 : 0;
  if (b.screening !== undefined && typeof b.screening === 'object' && b.screening) {
    const s = {};
    for (const k of SCREENING) if (b.screening[k]) s[k] = true;
    f.screening = JSON.stringify(s);
  }
  return { f, bad };
}

async function createClient(env, me, b) {
  const { f, bad: errs } = readClientFields(b, false);
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

async function updateClient(env, id, b) {
  const { f, bad: errs } = readClientFields(b, true);
  if (errs.length) return bad('Please check: ' + errs.join(', ') + '.');
  if (f.phone) {
    const dup = await env.DB.prepare("SELECT id FROM ems_clients WHERE substr(phone,-10)=? AND id != ? AND status != 'deleted'").bind(last10(f.phone), id).first();
    if (dup) return bad('Another client already uses this mobile number.');
  }
  const cols = Object.keys(f);
  if (!cols.length) return api({ ok: true });
  await env.DB.prepare(`UPDATE ems_clients SET ${cols.map(k => k + '=?').join(',')}, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`).bind(...cols.map(k => f[k]), id).run();
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

async function assignPackage(env, clientId, b) {
  const def = parseInt(b.package_id, 10) ? await env.DB.prepare('SELECT * FROM ems_packages WHERE id=?').bind(parseInt(b.package_id, 10)).first() : null;
  const name = clean(b.name, 80) || (def && def.name);
  const sessions = int(b.sessions_total != null && b.sessions_total !== '' ? b.sessions_total : def && def.sessions, 1, 200);
  const price = int(b.price != null && b.price !== '' ? b.price : def && def.price, 0, 10000000);
  const discount = int(b.discount || 0, 0, 10000000);
  const start = isDate(b.start_date) ? b.start_date : today();
  if (!name || !sessions) return bad('Choose a package and the number of sessions.');
  if (price == null || price === undefined) return bad('Enter the package price.');
  if (discount > price) return bad('The discount is more than the price.');
  const validity = def ? def.validity_days : int(b.validity_days, 7, 730) || 90;
  const expiry = isDate(b.expiry_date) ? b.expiry_date : addDays(start, validity);
  const r = await env.DB.prepare('INSERT INTO ems_client_packages (client_id, package_id, name, sessions_total, price, discount, start_date, expiry_date) VALUES (?,?,?,?,?,?,?,?)')
    .bind(clientId, def ? def.id : null, name, sessions, price, discount, start, expiry).run();
  return api({ ok: true, id: r.meta.last_row_id });
}

async function updateClientPackage(env, id, b) {
  const sets = [], binds = [];
  if (['active', 'paused', 'closed'].includes(b.status)) { sets.push('status=?'); binds.push(b.status); }
  if (isDate(b.expiry_date)) { sets.push('expiry_date=?'); binds.push(b.expiry_date); }
  const s = int(b.sessions_total, 1, 200); if (s) { sets.push('sessions_total=?'); binds.push(s); }
  if (!sets.length) return bad('Nothing to change.');
  await env.DB.prepare(`UPDATE ems_client_packages SET ${sets.join(',')} WHERE id=?`).bind(...binds, id).run();
  return api({ ok: true });
}

async function addMeasurement(env, me, b) {
  const clientId = parseInt(b.client_id, 10);
  const day = isDate(b.measured_on) && b.measured_on <= today() ? b.measured_on : today();
  const v = { weight: num(b.weight, 25, 300), waist: num(b.waist, 40, 250), hips: num(b.hips, 50, 250), body_fat: num(b.body_fat, 3, 70), muscle_mass: num(b.muscle_mass, 5, 150) };
  if (Object.values(v).some(x => x === undefined)) return bad('One of the measurements looks out of range. Use kg, cm and %.');
  if (Object.values(v).every(x => x === null)) return bad('Enter at least one measurement.');
  await env.DB.prepare('INSERT INTO ems_measurements (client_id, measured_on, weight, waist, hips, body_fat, muscle_mass, notes, staff_id) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(clientId, day, v.weight, v.waist, v.hips, v.body_fat, v.muscle_mass, nz(clean(b.notes, 300)), me.id).run();
  return api({ ok: true });
}

async function addPayment(env, me, b) {
  const cp = await env.DB.prepare('SELECT * FROM ems_client_packages WHERE id=?').bind(parseInt(b.client_package_id, 10) || 0).first();
  if (!cp) return bad('Choose the package this payment is for.');
  const amount = int(b.amount, 1, 10000000);
  if (!amount) return bad('Enter the amount received.');
  const method = PAY_METHODS.includes(b.method) ? b.method : 'UPI';
  const day = isDate(b.paid_on) && b.paid_on <= today() ? b.paid_on : today();
  const r = await env.DB.prepare('INSERT INTO ems_payments (client_id, client_package_id, amount, method, paid_on, reference, staff_id) VALUES (?,?,?,?,?,?,?)')
    .bind(cp.client_id, cp.id, amount, method, day, nz(clean(b.reference, 80)), me.id).run();
  return api({ ok: true, id: r.meta.last_row_id });
}

async function listPayments(env, url) {
  const from = isDate(url.searchParams.get('from')) ? url.searchParams.get('from') : today().slice(0, 8) + '01';
  const to = isDate(url.searchParams.get('to')) ? url.searchParams.get('to') : today();
  const { results } = await env.DB.prepare(`SELECT p.*, c.name client_name, cp.name package_name FROM ems_payments p
    LEFT JOIN ems_clients c ON c.id=p.client_id LEFT JOIN ems_client_packages cp ON cp.id=p.client_package_id
    WHERE p.paid_on BETWEEN ? AND ? ORDER BY p.paid_on DESC, p.id DESC`).bind(from, to).all();
  const out = await env.DB.prepare(`SELECT IFNULL(SUM(cp.price - cp.discount - IFNULL((SELECT SUM(amount) FROM ems_payments p WHERE p.client_package_id=cp.id),0)),0) due
    FROM ems_client_packages cp JOIN ems_clients c ON c.id=cp.client_id WHERE c.status != 'deleted' AND cp.status != 'closed'`).first();
  return api({ ok: true, payments: results, from, to, outstanding: out ? out.due : 0 });
}

async function saveCheckin(env, clientId, b) {
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
    env.DB.prepare('SELECT a.*, cp.name package_name FROM ems_appointments a LEFT JOIN ems_client_packages cp ON cp.id=a.client_package_id WHERE a.client_id=? ORDER BY a.start_at DESC LIMIT 300').bind(id).all(),
    env.DB.prepare('SELECT * FROM ems_measurements WHERE client_id=? ORDER BY measured_on, id').bind(id).all(),
    env.DB.prepare('SELECT p.*, cp.name package_name FROM ems_payments p LEFT JOIN ems_client_packages cp ON cp.id=p.client_package_id WHERE p.client_id=? ORDER BY p.paid_on DESC, p.id DESC').bind(id).all(),
    env.DB.prepare('SELECT * FROM ems_plans WHERE client_id=?').bind(id).first(),
    env.DB.prepare('SELECT * FROM ems_checkins WHERE client_id=? AND day >= ? ORDER BY day DESC').bind(id, addDays(today(), -60)).all(),
  ]);
  const client = { ...c, screening: safeJson(c.screening) };
  delete client.pin_hash;
  const p = plan || { diet: 'kerala-balanced', water_target: 10, steps_target: 7000, sleep_target: 7, focus: null };
  const data = { client, packages: pkgs, appointments: appts.results || [], measurements: meas.results || [], payments: pays.results || [], plan: p, checkins: checks.results || [] };
  data.insights = insights(data, staff);
  if (!staff) {
    delete client.staff_notes; delete client.screening; delete client.lead_id;
    data.appointments = data.appointments.map(({ staff_id, notes, ...a }) => a);
    data.payments = data.payments.map(({ staff_id, ...x }) => x);
    data.capacity = capacity(env);
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
  if (ch.waist && ch.waist.diff <= -1) add('good', 'ruler', `${Math.abs(ch.waist.diff)} cm off your waist`, 'Waist size is one of the best signs of healthy change.');
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
  if (!c.cleared) add('alert', 'shield-alert', 'Suitability not confirmed', 'Complete the suitability check and mark the client as cleared before EMS sessions.', true);
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

async function dashboard(env) {
  const t = today(), mon = mondayOf(t), monthStart = t.slice(0, 8) + '01';
  const q = (sql, ...b) => env.DB.prepare(sql).bind(...b);
  const [todayAppts, counts, weekly, revenue, leads, outstanding] = await Promise.all([
    q(`SELECT a.*, c.name client_name, c.phone client_phone FROM ems_appointments a LEFT JOIN ems_clients c ON c.id=a.client_id
       WHERE substr(a.start_at,1,10)=? AND a.status != 'cancelled' ORDER BY a.start_at`, t).all(),
    q(`SELECT
       (SELECT COUNT(*) FROM ems_clients WHERE status='active') active_clients,
       (SELECT COUNT(*) FROM ems_appointments WHERE status='attended' AND kind='session' AND substr(start_at,1,10) BETWEEN ? AND ?) week_sessions,
       (SELECT COUNT(*) FROM ems_appointments WHERE status='booked' AND start_at >= ?) upcoming,
       (SELECT IFNULL(SUM(amount),0) FROM ems_payments WHERE paid_on >= ?) month_revenue,
       (SELECT COUNT(*) FROM ems_appointments WHERE status='no_show' AND substr(start_at,1,10) >= ?) month_noshow,
       (SELECT COUNT(*) FROM ems_appointments WHERE status IN ('attended','no_show') AND substr(start_at,1,10) >= ?) month_closed`,
      mon, t, nowLocal(), monthStart, monthStart, monthStart).first(),
    q(`SELECT substr(start_at,1,10) d, COUNT(*) n FROM ems_appointments WHERE status='attended' AND kind='session' AND substr(start_at,1,10) >= ? GROUP BY d`, addDays(mon, -49)).all(),
    q(`SELECT substr(paid_on,1,7) m, SUM(amount) n FROM ems_payments WHERE paid_on >= ? GROUP BY m`, addDays(monthStart, -160).slice(0, 8) + '01').all(),
    q(`SELECT COUNT(*) n FROM leads WHERE status='new' AND (interest LIKE '%EMS%' OR interest LIKE '%eight%' OR source='ems portal')`).first(),
    q(`SELECT IFNULL(SUM(cp.price - cp.discount - IFNULL((SELECT SUM(amount) FROM ems_payments p WHERE p.client_package_id=cp.id),0)),0) due
       FROM ems_client_packages cp JOIN ems_clients c ON c.id=cp.client_id WHERE cp.status != 'closed'`).first(),
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
  const rem = await reminders(env);
  return { today: todayAppts.results || [], counts: { ...counts, new_leads: leads ? leads.n : 0, outstanding: outstanding ? outstanding.due : 0, reminders: rem.length }, weeks, months, reminders: rem.slice(0, 6), capacity: capacity(env) };
}

/* ---------------- Reminders ---------------- */

async function reminders(env) {
  const t = today(), tomorrow = addDays(t, 1), now = nowLocal();
  const out = [];
  const q = (sql, ...b) => env.DB.prepare(sql).bind(...b).all().then(r => r.results || []);
  const [logged, tmr, clients, leads] = await Promise.all([
    q("SELECT kind, ref FROM ems_reminder_log WHERE created_at > strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 days')"),
    q(`SELECT a.id, a.start_at, a.kind, a.guest_name, a.guest_phone, a.client_id, c.name, c.phone FROM ems_appointments a LEFT JOIN ems_clients c ON c.id=a.client_id
       WHERE a.status='booked' AND substr(a.start_at,1,10)=? ORDER BY a.start_at`, tomorrow),
    q(`SELECT c.id, c.name, c.phone,
       (SELECT MAX(start_at) FROM ems_appointments a WHERE a.client_id=c.id AND a.status='attended') last_visit,
       (SELECT COUNT(*) FROM ems_appointments a WHERE a.client_id=c.id AND a.status='booked' AND a.start_at >= ?) upcoming,
       (SELECT MAX(measured_on) FROM ems_measurements m WHERE m.client_id=c.id) last_meas
       FROM ems_clients c WHERE c.status='active'`, now),
    q(`SELECT id, name, phone, created_at, interest FROM leads WHERE status='new' AND (interest LIKE '%EMS%' OR interest LIKE '%eight%' OR source='ems portal')
       AND created_at < strftime('%Y-%m-%dT%H:%M:%SZ','now','-2 hours') ORDER BY id DESC LIMIT 20`),
  ]);
  const done = new Set(logged.map(l => `${l.kind}:${l.ref}`));
  const push = r => { if (!done.has(`${r.kind}:${r.ref}`)) out.push(r); };

  for (const a of tmr) push({ kind: 'tomorrow', ref: String(a.id), priority: 1, client_id: a.client_id, name: a.name || a.guest_name, phone: a.phone || a.guest_phone,
    title: `${a.kind === 'session' ? 'Session' : a.kind === 'consultation' ? 'Consultation' : 'Review'} tomorrow at ${fmtTime(a.start_at)}`, start_at: a.start_at });

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

async function listLeads(env, url) {
  const scope = url.searchParams.get('scope') === 'all' ? '' : "AND (l.interest LIKE '%EMS%' OR l.interest LIKE '%eight%' OR l.source='ems portal')";
  const status = url.searchParams.get('status') || 'open';
  let sw = '';
  const binds = [];
  if (status === 'open') sw = "AND l.status IN ('new','contacted')";
  else if (LEAD_STATUSES.includes(status)) { sw = 'AND l.status=?'; binds.push(status); }
  const { results } = await env.DB.prepare(`SELECT l.*,
    (SELECT id FROM ems_clients c WHERE substr(c.phone,-10)=substr(l.phone,-10) AND c.status != 'deleted') client_id,
    (SELECT MIN(start_at) FROM ems_appointments a WHERE a.lead_id=l.id AND a.status='booked') booked_at
    FROM leads l WHERE 1=1 ${scope} ${sw} ORDER BY l.id DESC LIMIT 200`).bind(...binds).all();
  return api({ ok: true, leads: results });
}

async function updateLead(env, id, b) {
  const status = LEAD_STATUSES.includes(b.status) ? b.status : null;
  if (!status) return bad('Choose a status.');
  await env.DB.prepare("UPDATE leads SET status=?, notes=COALESCE(?,notes), updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?")
    .bind(status, b.notes !== undefined ? nz(clean(b.notes, 500)) : null, id).run();
  return api({ ok: true });
}

async function convertLead(env, me, id, b) {
  const l = await env.DB.prepare('SELECT * FROM leads WHERE id=?').bind(id).first();
  if (!l) return api({ ok: false, error: 'Not found' }, 404);
  const start = String(b.start_at || '');
  if (!isLocal(start)) return bad('Choose a date and time for the consultation.');
  if (!b.force && !(await slotFree(env, start))) return bad('That time slot is full.');
  const existing = await env.DB.prepare("SELECT id FROM ems_clients WHERE substr(phone,-10)=? AND status != 'deleted'").bind(last10(l.phone)).first();
  await env.DB.prepare("INSERT INTO ems_appointments (client_id, lead_id, guest_name, guest_phone, kind, start_at, staff_id, notes) VALUES (?,?,?,?,'consultation',?,?,?)")
    .bind(existing ? existing.id : null, id, l.name, l.phone, start, me.id, nz(clean(b.notes, 300) || l.concern)).run();
  await env.DB.prepare("UPDATE leads SET status='booked', updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?").bind(id).run();
  return api({ ok: true });
}

/* ---------------- Admin: packages & staff ---------------- */

async function savePackageDef(env, id, b) {
  const name = clean(b.name, 80), sessions = int(b.sessions, 1, 200), price = int(b.price, 0, 10000000), validity = int(b.validity_days, 7, 730);
  if (!name || !sessions || price === undefined || !validity) return bad('Enter a name, sessions, price and validity.');
  const desc = nz(clean(b.description, 200)), active = b.active === false ? 0 : 1;
  if (id) await env.DB.prepare('UPDATE ems_packages SET name=?, sessions=?, price=?, validity_days=?, description=?, active=? WHERE id=?').bind(name, sessions, price, validity, desc, active, id).run();
  else await env.DB.prepare('INSERT INTO ems_packages (name, sessions, price, validity_days, description, active) VALUES (?,?,?,?,?,?)').bind(name, sessions, price, validity, desc, active).run();
  return api({ ok: true });
}

async function saveUser(env, id, b) {
  const name = clean(b.name, 80), username = clean(b.username, 40).toLowerCase(), role = b.role === 'admin' ? 'admin' : 'staff';
  if (name.length < 2 || !/^[a-z0-9._-]{3,40}$/.test(username) || username === 'hasta') return bad('Enter a name and a username (letters and numbers, not "hasta").');
  const pw = String(b.password || '');
  if (!id && pw.length < 8) return bad('Set a password of at least 8 characters.');
  if (pw && pw.length < 8) return bad('Passwords need at least 8 characters.');
  const dup = await env.DB.prepare('SELECT id FROM ems_staff WHERE username=? AND id != ?').bind(username, id || 0).first();
  if (dup) return bad('That username is taken.');
  if (id) {
    await env.DB.prepare('UPDATE ems_staff SET name=?, username=?, role=?, active=? WHERE id=?').bind(name, username, role, b.active === false ? 0 : 1, id).run();
    if (pw) await env.DB.prepare('UPDATE ems_staff SET pass_hash=? WHERE id=?').bind(await hashSecret(pw), id).run();
    if (b.active === false) await env.DB.prepare("DELETE FROM ems_sessions WHERE kind='staff' AND subject_id=?").bind(id).run();
  } else {
    await env.DB.prepare('INSERT INTO ems_staff (name, username, role, pass_hash) VALUES (?,?,?,?)').bind(name, username, role, await hashSecret(pw)).run();
  }
  return api({ ok: true });
}

/* ---------------- Daily jobs ---------------- */

export async function emsDaily(env) {
  await env.DB.prepare("DELETE FROM ems_sessions WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%SZ','now')").run();
  await env.DB.prepare("DELETE FROM ems_login_attempts WHERE at < strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 day')").run();
  await env.DB.prepare("DELETE FROM ems_reminder_log WHERE created_at < strftime('%Y-%m-%dT%H:%M:%SZ','now','-60 days')").run();
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
