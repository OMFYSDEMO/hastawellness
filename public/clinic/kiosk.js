// Clinic desktop attendance screen: shows the clock-in QR code, which changes every 30 seconds.
const BASE = document.querySelector('meta[name="ems-base"]').content || '';
const root = document.getElementById('kiosk');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const time = s => { const [h, m] = s.slice(11, 16).split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
let timer;
function clock() {
  const el = root.querySelector('[data-clock]'); if (!el) return;
  el.textContent = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' });
}
async function tick() {
  clearTimeout(timer);
  let r;
  try { r = await fetch(BASE + '/api/kiosk/code', { credentials: 'same-origin', cache: 'no-store' }).then(x => x.json()); }
  catch { root.querySelector('[data-note]') && (root.querySelector('[data-note]').textContent = 'No connection — retrying…'); timer = setTimeout(tick, 5000); return; }
  if (!r.ok) {
    root.innerHTML = `<div class="kiosk-card"><img src="/img/hasta-emblem.webp" alt="" width="64" height="64"><h1>Attendance screen not set up</h1>
      <p>${esc(r.error)}</p><p>A manager should sign in to the clinic app on this computer and choose <b>Staff → Setup → Make this computer the attendance screen</b>.</p></div>`;
    timer = setTimeout(tick, 30000); return;
  }
  root.innerHTML = `<div class="kiosk-wrap"><div class="kiosk-qr">${r.svg}</div>
    <div class="kiosk-side"><img src="/img/hasta-emblem.webp" alt="" width="56" height="56"><h1>Staff clock in / out</h1>
      <p class="kiosk-clock" data-clock></p>
      <ol><li>Open your phone camera and scan this code.</li><li>Allow location if asked — you must be at the clinic.</li><li>Scan again when you finish work.</li></ol>
      <p class="kiosk-note" data-note>Code changes every 30 seconds · ${esc(r.kiosk)}</p>
      ${r.recent.length ? `<div class="kiosk-recent"><h2>Just now</h2>${r.recent.map(x => `<div><b>${esc(x.name)}</b><span>${x.out_at ? 'out ' + time(x.out_at) : 'in ' + time(x.in_at)}</span></div>`).join('')}</div>` : ''}</div></div>`;
  clock();
  timer = setTimeout(tick, Math.max(1, r.refresh_in) * 1000 + 300);
}
setInterval(clock, 15000);
tick();
// Keep the screen awake where the browser allows it.
try { navigator.wakeLock && navigator.wakeLock.request('screen').catch(() => {}); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { navigator.wakeLock && navigator.wakeLock.request('screen').catch(() => {}); tick(); } }); } catch {}
