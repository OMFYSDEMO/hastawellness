// Shared helpers for the Hasta Wellness Worker.

export async function authorised(request, env) {
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

export function authResponse(state) {
  if (state === 'unset') {
    return new Response('Admin password not set. In Cloudflare: Worker → Settings → Variables and Secrets → add a Secret named ADMIN_PASSWORD.', {
      status: 503, headers: adminHeaders({ 'content-type': 'text/plain; charset=utf-8' }),
    });
  }
  return new Response('Sign in required', {
    status: 401, headers: adminHeaders({ 'WWW-Authenticate': 'Basic realm="Hasta Wellness leads", charset="UTF-8"', 'content-type': 'text/plain' }),
  });
}

/* ---------------- Helpers ---------------- */

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}

export function adminHeaders(extra = {}) {
  return {
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex, nofollow',
    'x-frame-options': 'DENY',
    'referrer-policy': 'same-origin',
    ...extra,
  };
}

export function sameOrigin(request) {
  // Browsers mark same-site form posts with Sec-Fetch-Site; trust that first.
  const site = request.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin';
  const origin = request.headers.get('origin');
  if (!origin || origin === 'null') {
    // No usable Origin (older browsers / strict referrer policy): fall back to Referer if present.
    const ref = request.headers.get('referer');
    if (!ref) return !origin; // missing Origin entirely: allow (same-origin GET-style posts); literal "null": reject
    try { return new URL(ref).host === new URL(request.url).host; } catch { return false; }
  }
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
}

export function clean(v, max) {
  if (v == null) return '';
  return String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
export function nz(v) { return v ? v : null; }

export function normalisePhone(v) {
  const s = clean(v, 20);
  if (!/^[0-9+ ()\-]{10,20}$/.test(s)) return '';
  const digits = s.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return '';
  return (s.trim().startsWith('+') ? '+' : '') + digits;
}

export function h(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function ist(iso, withTime = true) {
  if (!iso) return '';
  const opts = withTime ? { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }
    : { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' };
  return new Date(iso).toLocaleString('en-IN', opts);
}

export function waLink(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.length === 10) d = '91' + d;
  return `https://wa.me/${d}`;
}

const ADMIN_CSS = `
:root{--g:#34595e;--gold:#c4a45b;--t:#b96856;--line:#dce0d7;--m:#6c746d}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:var(--g);background:#f6f8f7}
.top{background:var(--g);color:#fff;padding:14px 16px;border-bottom:2px solid var(--gold)}
.top .in{max-width:900px;margin:0 auto;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.top h1{font-size:17px;margin:0}.top a{color:#fff}
.mainnav{display:flex;gap:4px;flex-wrap:wrap}.mainnav a{padding:6px 12px;border-radius:6px;text-decoration:none;font-size:14px;color:#fff;opacity:.85}.mainnav a.on{background:#ffffff26;opacity:1;font-weight:600}
main{max-width:900px;margin:0 auto;padding:16px}
nav.tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}nav.tabs a{padding:7px 12px;border:1px solid var(--line);border-radius:999px;background:#fff;color:var(--g);text-decoration:none;font-size:13px}nav.tabs a.on{background:var(--g);color:#fff;border-color:var(--g)}
.lead,.card{background:#fff;border:1px solid var(--line);border-left:3px solid var(--gold);border-radius:8px;padding:14px 16px;margin-bottom:12px}
.lead.booked,.card.published,.card.hired{border-left-color:#3c8a5a}.lead.not-interested,.card.closed,.card.rejected{opacity:.75;border-left-color:#aaa}.lead.contacted,.card.draft,.card.shortlisted{border-left-color:var(--t)}
.lead header,.card header{display:flex;justify-content:space-between;gap:10px;align-items:start}
.pill{font-size:11px;text-transform:uppercase;letter-spacing:.08em;padding:3px 8px;border-radius:999px;background:#eef3f3;white-space:nowrap}
.pill.published{background:#e3f1e7}.pill.draft{background:#f7ebe7}.pill.closed{background:#eee}
.muted{color:var(--m);font-size:13px}.interest{margin:6px 0 2px;font-weight:600}
.actions{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
.btn{display:inline-block;padding:8px 12px;border-radius:6px;background:var(--g);color:#fff;text-decoration:none;font-size:13px;border:1px solid var(--g);cursor:pointer;font:inherit;font-size:13px}.btn.ghost{background:#fff;color:var(--g)}.btn.gold{background:var(--gold);border-color:var(--gold)}.btn.danger{background:#fff;color:#a0442f;border-color:#a0442f}
form.inline{display:flex;gap:8px;flex-wrap:wrap}form.inline select,form.inline input{padding:7px 9px;border:1px solid var(--line);border-radius:6px;font:inherit;font-size:13px}form.inline input{flex:1;min-width:160px}
form.inline button{padding:7px 14px;border:0;border-radius:6px;background:var(--gold);color:#fff;font:inherit;font-size:13px;cursor:pointer}
form.edit{background:#fff;border:1px solid var(--line);border-radius:8px;padding:18px;display:grid;gap:14px}
form.edit label{display:grid;gap:5px;font-size:13px;font-weight:600}
form.edit input,form.edit select,form.edit textarea{padding:9px 10px;border:1px solid var(--line);border-radius:6px;font:inherit;font-size:14px;font-weight:400;color:var(--g);width:100%}
form.edit textarea{min-height:110px;resize:vertical}
form.edit .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px}
form.edit small{font-weight:400;color:var(--m)}
.bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between;margin-bottom:14px}
.empty{background:#fff;border:1px dashed var(--line);padding:30px;text-align:center;border-radius:8px;color:var(--m)}
.flash{background:#e3f1e7;border:1px solid #bcdcc6;padding:10px 14px;border-radius:8px;margin-bottom:14px;font-size:14px}
dl.kv{display:grid;grid-template-columns:max-content 1fr;gap:4px 14px;margin:8px 0;font-size:14px}dl.kv dt{color:var(--m)}dl.kv dd{margin:0}
`;

export function adminShell(title, active, body, extraHead = '') {
  const link = (href, label, key) => `<a href="${href}" class="${active === key ? 'on' : ''}">${label}</a>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${h(title)} · Hasta Wellness admin</title><style>${ADMIN_CSS}</style>${extraHead}</head><body>
<div class="top"><div class="in"><h1>Hasta Wellness · Admin</h1><nav class="mainnav">${link('/admin', 'Leads', 'leads')}${link('/admin/jobs', 'Jobs', 'jobs')}${link('/admin/applications', 'Applications', 'apps')}</nav></div></div>
<main>${body}</main></body></html>`;
}
