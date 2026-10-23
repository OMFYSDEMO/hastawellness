// Hasta Wellness — Cloudflare Worker
// Serves the static site (./public) and a small lead-capture API.
//
//   POST /api/lead   store a consultation lead (from the assistant or booking form)
//   GET  /admin      password-protected list of leads for the clinic team
//   POST /admin      update a lead's status / notes
//   GET  /admin.csv  export leads as CSV
//
// The admin password is the ADMIN_PASSWORD secret, set in the Cloudflare
// dashboard (Worker → Settings → Variables and Secrets). Username: hasta

const STATUSES = ['new', 'contacted', 'booked', 'not interested'];
const MAX = { name: 80, phone: 20, interest: 120, concern: 160, timing: 60, request_type: 40, page: 60, notes: 500 };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === '/api/lead') return await handleLead(request, env);
      if (path === '/admin' || path === '/admin/') return await handleAdmin(request, env, url);
      if (path === '/admin.csv') return await handleCsv(request, env);
    } catch (err) {
      console.error('Worker error', path, err && err.stack || err);
      return json({ ok: false, error: 'Something went wrong. Please call the clinic.' }, 500);
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    const days = parseInt(env.LEAD_RETENTION_DAYS || '90', 10);
    const r = await env.DB.prepare(
      "DELETE FROM leads WHERE created_at < strftime('%Y-%m-%dT%H:%M:%SZ','now', ?)"
    ).bind(`-${days} days`).run();
    console.log('Lead retention clean-up removed', r.meta && r.meta.changes, 'rows');
  },
};

/* ---------------- Lead capture ---------------- */

async function handleLead(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405, { Allow: 'POST' });
  if (!sameOrigin(request)) return json({ ok: false, error: 'Forbidden' }, 403);
  if (!(request.headers.get('content-type') || '').includes('application/json')) return json({ ok: false, error: 'Unsupported' }, 415);
  const len = parseInt(request.headers.get('content-length') || '0', 10);
  if (len > 4000) return json({ ok: false, error: 'Too large' }, 413);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid request' }, 400); }
  if (!body || typeof body !== 'object') return json({ ok: false, error: 'Invalid request' }, 400);

  // Honeypot: real visitors never fill this hidden field.
  if (body.company) return json({ ok: true });

  if (body.consent !== true) return json({ ok: false, error: 'Consent is required.' }, 400);

  const name = clean(body.name, MAX.name);
  const phone = normalisePhone(body.phone);
  if (name.length < 2) return json({ ok: false, error: 'Please enter your name.' }, 400);
  if (!phone) return json({ ok: false, error: 'Please enter a valid mobile number.' }, 400);

  const source = body.source === 'assistant' ? 'assistant' : 'booking form';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(body.preferred_date || '') ? body.preferred_date : null;

  const ip = request.headers.get('cf-connecting-ip') || '';
  const day = new Date().toISOString().slice(0, 10);
  const ipHash = ip ? (await sha256(`hasta:${day}:${ip}`)).slice(0, 24) : null;

  if (ipHash) {
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM leads WHERE ip_hash = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 hour')"
    ).bind(ipHash).first();
    if (row && row.n >= 8) return json({ ok: false, error: 'Too many requests. Please call the clinic.' }, 429);
  }

  // Same number, same interest within 30 minutes → update rather than duplicate.
  const dup = await env.DB.prepare(
    "SELECT id FROM leads WHERE phone = ? AND IFNULL(interest,'') = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%SZ','now','-30 minutes') ORDER BY id DESC LIMIT 1"
  ).bind(phone, clean(body.interest, MAX.interest)).first();

  if (dup) {
    await env.DB.prepare(
      "UPDATE leads SET name=?, request_type=COALESCE(?,request_type), concern=COALESCE(?,concern), timing=COALESCE(?,timing), preferred_date=COALESCE(?,preferred_date), updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?"
    ).bind(name, nz(clean(body.request_type, MAX.request_type)), nz(clean(body.concern, MAX.concern)), nz(clean(body.timing, MAX.timing)), date, dup.id).run();
    return json({ ok: true });
  }

  await env.DB.prepare(
    'INSERT INTO leads (source, request_type, name, phone, interest, concern, timing, preferred_date, page, ip_hash) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).bind(
    source,
    nz(clean(body.request_type, MAX.request_type)),
    name,
    phone,
    nz(clean(body.interest, MAX.interest)),
    nz(clean(body.concern, MAX.concern)),
    nz(clean(body.timing, MAX.timing)),
    date,
    nz(clean(body.page, MAX.page)),
    ipHash
  ).run();

  return json({ ok: true });
}

/* ---------------- Admin ---------------- */

async function authorised(request, env) {
  if (!env.ADMIN_PASSWORD) return 'unset';
  const h = request.headers.get('authorization') || '';
  if (!h.startsWith('Basic ')) return false;
  let decoded = '';
  try { decoded = atob(h.slice(6)); } catch { return false; }
  const i = decoded.indexOf(':');
  const user = decoded.slice(0, i), pass = decoded.slice(i + 1);
  const [a, b] = await Promise.all([sha256(`${user}:${pass}`), sha256(`hasta:${env.ADMIN_PASSWORD}`)]);
  return a === b;
}

function authResponse(state) {
  if (state === 'unset') {
    return new Response('Admin password not set. In Cloudflare: Worker → Settings → Variables and Secrets → add a Secret named ADMIN_PASSWORD.', {
      status: 503, headers: adminHeaders({ 'content-type': 'text/plain; charset=utf-8' }),
    });
  }
  return new Response('Sign in required', {
    status: 401, headers: adminHeaders({ 'WWW-Authenticate': 'Basic realm="Hasta Wellness leads", charset="UTF-8"', 'content-type': 'text/plain' }),
  });
}

async function handleAdmin(request, env, url) {
  const auth = await authorised(request, env);
  if (auth !== true) return authResponse(auth);

  if (request.method === 'POST') {
    if (!sameOrigin(request)) return new Response('Forbidden', { status: 403, headers: adminHeaders() });
    const form = await request.formData();
    const id = parseInt(form.get('id'), 10);
    const status = String(form.get('status') || '');
    const notes = clean(form.get('notes'), MAX.notes);
    if (id && STATUSES.includes(status)) {
      await env.DB.prepare("UPDATE leads SET status=?, notes=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?")
        .bind(status, notes || null, id).run();
    }
    const back = new URL('/admin', url);
    const f = form.get('filter');
    if (f && STATUSES.concat('all').includes(String(f))) back.searchParams.set('status', String(f));
    return Response.redirect(back.toString(), 303);
  }

  const filter = url.searchParams.get('status') || 'open';
  let where = '';
  const binds = [];
  if (filter === 'open') where = "WHERE status IN ('new','contacted')";
  else if (STATUSES.includes(filter)) { where = 'WHERE status = ?'; binds.push(filter); }

  const { results } = await env.DB.prepare(`SELECT * FROM leads ${where} ORDER BY id DESC LIMIT 300`).bind(...binds).all();
  const counts = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM leads GROUP BY status').all();
  const c = Object.fromEntries((counts.results || []).map(r => [r.status, r.n]));

  return new Response(adminPage(results || [], filter, c), { headers: adminHeaders({ 'content-type': 'text/html; charset=utf-8' }) });
}

async function handleCsv(request, env) {
  const auth = await authorised(request, env);
  if (auth !== true) return authResponse(auth);
  const { results } = await env.DB.prepare('SELECT * FROM leads ORDER BY id DESC').all();
  const cols = ['id', 'created_at', 'source', 'request_type', 'name', 'phone', 'interest', 'concern', 'timing', 'preferred_date', 'status', 'notes'];
  const esc = v => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // spreadsheet formula guard
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const csv = [cols.join(',')].concat((results || []).map(r => cols.map(k => k === 'phone' ? '"' + String(r[k]).replace(/"/g, '') + '"' : esc(r[k])).join(','))).join('\r\n');
  return new Response('﻿' + csv, {
    headers: adminHeaders({
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="hasta-leads-${new Date().toISOString().slice(0, 10)}.csv"`,
    }),
  });
}

function adminPage(rows, filter, counts) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const tab = (key, label, n) =>
    `<a href="/admin?status=${encodeURIComponent(key)}" class="${filter === key ? 'on' : ''}">${h(label)}${n != null ? ` <b>${n}</b>` : ''}</a>`;
  const ist = iso => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  };
  const wa = p => {
    let d = String(p).replace(/\D/g, '');
    if (d.length === 10) d = '91' + d;
    return `https://wa.me/${d}`;
  };
  const items = rows.map(r => `
    <article class="lead ${h(r.status.replace(' ', '-'))}">
      <header>
        <div><strong>${h(r.name)}</strong> <span class="muted">· ${h(ist(r.created_at))} IST · ${h(r.source)}</span></div>
        <span class="pill">${h(r.status)}</span>
      </header>
      <p class="interest">${h(r.interest || 'Not specified')}${r.concern ? ` — <span class="muted">${h(r.concern)}</span>` : ''}</p>
      <p class="muted">${h(r.request_type || '')}${r.timing ? ` · ${h(r.timing)}` : ''}${r.preferred_date ? ` · preferred ${h(r.preferred_date)}` : ''}</p>
      <div class="actions">
        <a class="btn" href="tel:${h(r.phone)}">Call ${h(r.phone)}</a>
        <a class="btn ghost" href="${h(wa(r.phone))}" target="_blank" rel="noopener">WhatsApp</a>
      </div>
      <form method="post" action="/admin">
        <input type="hidden" name="id" value="${r.id}"><input type="hidden" name="filter" value="${h(filter)}">
        <select name="status" aria-label="Status">${STATUSES.map(s => `<option${s === r.status ? ' selected' : ''}>${s}</option>`).join('')}</select>
        <input name="notes" maxlength="500" placeholder="Notes (no medical details)" value="${h(r.notes || '')}" aria-label="Notes">
        <button>Save</button>
      </form>
    </article>`).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Hasta Wellness · Leads</title>
<style>
:root{--g:#34595e;--gold:#c4a45b;--t:#b96856;--line:#dce0d7;--m:#6c746d}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:var(--g);background:#f6f8f7}
.top{background:var(--g);color:#fff;padding:16px;border-bottom:2px solid var(--gold);display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.top h1{font-size:18px;margin:0}.top a{color:#fff}
main{max-width:860px;margin:0 auto;padding:16px}
nav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}nav a{padding:7px 12px;border:1px solid var(--line);border-radius:999px;background:#fff;color:var(--g);text-decoration:none;font-size:13px}nav a.on{background:var(--g);color:#fff;border-color:var(--g)}
.lead{background:#fff;border:1px solid var(--line);border-left:3px solid var(--gold);border-radius:8px;padding:14px 16px;margin-bottom:12px}
.lead.booked{border-left-color:#3c8a5a}.lead.not-interested{opacity:.7;border-left-color:#aaa}.lead.contacted{border-left-color:var(--t)}
.lead header{display:flex;justify-content:space-between;gap:10px;align-items:start}
.pill{font-size:11px;text-transform:uppercase;letter-spacing:.08em;padding:3px 8px;border-radius:999px;background:#eef3f3;white-space:nowrap}
.muted{color:var(--m);font-size:13px}.interest{margin:6px 0 2px;font-weight:600}
.actions{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
.btn{display:inline-block;padding:8px 12px;border-radius:6px;background:var(--g);color:#fff;text-decoration:none;font-size:13px}.btn.ghost{background:#fff;color:var(--g);border:1px solid var(--g)}
form{display:flex;gap:8px;flex-wrap:wrap}form select,form input{padding:7px 9px;border:1px solid var(--line);border-radius:6px;font:inherit;font-size:13px}form input{flex:1;min-width:160px}
form button{padding:7px 14px;border:0;border-radius:6px;background:var(--gold);color:#fff;font:inherit;font-size:13px;cursor:pointer}
.empty{background:#fff;border:1px dashed var(--line);padding:30px;text-align:center;border-radius:8px;color:var(--m)}
</style></head><body>
<div class="top"><h1>Hasta Wellness · Consultation leads</h1><a href="/admin.csv">Download CSV ↓</a></div>
<main>
<nav>${tab('open', 'To follow up', (counts.new || 0) + (counts.contacted || 0))}${tab('new', 'New', counts.new || 0)}${tab('contacted', 'Contacted', counts.contacted || 0)}${tab('booked', 'Booked', counts.booked || 0)}${tab('not interested', 'Not interested', counts['not interested'] || 0)}${tab('all', 'All', total)}</nav>
${items || '<p class="empty">No leads here yet.</p>'}
<p class="muted">Leads are deleted automatically after 90 days. Please don't record medical details in notes.</p>
</main></body></html>`;
}

/* ---------------- Helpers ---------------- */

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}

function adminHeaders(extra = {}) {
  return {
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex, nofollow',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    ...extra,
  };
}

function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true; // some browsers omit Origin on same-origin requests
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
}

function clean(v, max) {
  if (v == null) return '';
  return String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function nz(v) { return v ? v : null; }

function normalisePhone(v) {
  const s = clean(v, MAX.phone);
  if (!/^[0-9+ ()\-]{10,20}$/.test(s)) return '';
  const digits = s.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return '';
  return (s.trim().startsWith('+') ? '+' : '') + digits;
}

function h(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
