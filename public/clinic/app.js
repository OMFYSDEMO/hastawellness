// Hasta Clinic — staff app (clinicapp.hastawellnessclinic.com)
import {
  api, esc, icon, toast, modal, formData, busy, field, inp, sel, emptyState, today, nowLocal, addDays, fDay, fDate, fLong, fTime, fWhen,
  inr, initials, first, prettyPhone, wa, pill, BASE, CLINIC_PHONE,
} from '../ems/core.js?v=8';

const app = document.getElementById('app');
let ME, B, MAIN, CAT = null;
const NAV = [['', 'layout-dashboard', 'Today'], ['appointments', 'calendar-days', 'Appointments'], ['patients', 'users', 'Patients'], ['billing', 'receipt', 'Billing'],
  ['payments', 'wallet', 'Payments'], ['stock', 'package', 'Stock'], ['leads', 'inbox', 'Leads'], ['reports', 'line-chart', 'Reports']];
const ST = { booked: 'Booked', arrived: 'Arrived', in_treatment: 'In treatment', completed: 'Completed', no_show: 'No-show', cancelled: 'Cancelled', draft: 'Draft', final: 'Final', billed: 'Billed', package: 'Package', no_charge: 'No charge' };
const st = (s, label) => pill(s, label || ST[s] || s);
const money = n => '₹' + (Math.round((n || 0) * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const r2 = x => Math.round((Number(x) || 0) * 100) / 100;
const dept = id => B.departments.find(d => d.id === id);
const deptTag = id => { const d = dept(id); return d ? `<span class="dept" style="--c:${esc(d.colour)}">${esc(d.name)}</span>` : ''; };
const staffName = id => (B.team.find(t => t.id === id) || {}).name || '';
const clinicians = deptId => B.team.filter(t => t.active && (t.apps.includes('clinic') || t.role === 'admin') && (deptId ? t.depts.includes(deptId) : t.depts.length));
const assistants = () => B.team.filter(t => t.active && t.skills.some(s => s === 'nurse' || s === 'dental_assistant'));
const isAdmin = () => ME.admin;
const isClin = () => ME.admin || (ME.skills || []).some(s2 => ['doctor', 'nurse', 'dental_assistant', 'medical_lead'].includes(s2));
const canManage = () => ME.admin || ME.role === 'manager';
const approvers = () => String(B.settings.discount_approvers || '').split(',').map(Number).filter(Boolean);
const approverText = () => approvers().length ? B.team.filter(t => approvers().includes(t.id)).map(t => t.name).join(' or ') : 'a doctor or admin';
const TIMES = (() => { const o = []; for (let h = 8; h < 22; h++) for (const m of [0, 15, 30, 45]) o.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`); return o; })();

/* ---------------- start & login ---------------- */
// Start-up: fetch the app data (and, on the Today page, the dashboard) at the same time, straight away.
let DASH = null;
async function start() {
  const sm = location.hash.match(/^#\/scan\/([A-Za-z0-9-]+)/);
  if (sm) return scanScreen(sm[1].toUpperCase());
  const onToday = !location.hash.replace(/^#\/?/, '').split('?')[0];
  const get = path => fetch(BASE + '/api' + path, { credentials: 'same-origin' }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
  const bootP = get('/clinic/boot');
  if (onToday) DASH = get('/clinic/dashboard').then(r => { if (!r.data.ok) throw new Error(r.data.error || 'Could not load.'); return r.data; });
  if (DASH) DASH.catch(() => {});
  let r;
  try { r = await bootP; } catch { app.innerHTML = `<div class="boot"><p class="err">Could not reach the server. Check your connection and try again.</p></div>`; return; }
  if (r.status === 401) { DASH = null; return login(); }
  if (!r.data.ok) {
    DASH = null;
    app.innerHTML = `<div class="auth"><section class="auth-panel" style="grid-column:1/-1"><div class="auth-box">${emptyState('lock', r.data.error || 'Something went wrong.')}<button class="btn ghost" data-out>${icon('log-out', 18)}Sign out</button></div></section></div>`;
    app.querySelector('[data-out]').onclick = signOut; return;
  }
  B = r.data; ME = B.me;
  mount();
}
async function signOut() { await api('/auth/logout', { method: 'POST', body: {} }).catch(() => {}); location.hash = ''; location.reload(); }
function login(note) {
  app.innerHTML = `<div class="auth"><section class="auth-art">
      <div class="brand"><img src="/img/hasta-emblem.webp" alt="" width="44" height="44"><div><b style="font-family:Manrope;font-size:16px">Hasta Wellness</b><div style="font-size:13px;color:#9fb8b4">Clinic</div></div></div>
      <div><h1>Every visit, bill and payment in one place.</h1><p class="lede">Dental, skin, hair and wellness — appointments, GST billing, packages and collections for the Hasta team.</p></div>
      <ul><li>${icon('calendar-days', 20)}Appointments by clinician and room</li><li>${icon('receipt', 20)}GST invoices with packages and discounts</li><li>${icon('wallet', 20)}Payments, advances and cash deposits</li></ul></section>
    <section class="auth-panel"><div class="auth-box"><div><h2>Team sign in</h2><p class="muted" style="margin-top:6px">${note ? esc(note) : 'Use the same username and password as the EMS app.'}</p></div>
      <form class="stack" style="gap:14px" novalidate>${field('Username', inp('username', '', 'autocomplete="username" autocapitalize="none" required'))}${field('Password', inp('password', '', 'type="password" autocomplete="current-password" required'))}
      <div class="msg"></div><button class="btn" style="height:46px">${icon('key-round', 18)}Sign in</button></form>
      <p class="auth-foot">Need help? Call ${esc(CLINIC_PHONE)}</p></div></section></div>`;
  const f = app.querySelector('form');
  f.addEventListener('submit', e => { e.preventDefault(); busy(f.querySelector('button'), async () => { await api('/auth/staff', { method: 'POST', body: formData(f) }); start(); }).catch(() => {}); });
}

/* ---------------- shell & routing ---------------- */
function mount() {
  app.innerHTML = `<div class="shell"><aside class="side">
    <div class="brand"><img src="/img/hasta-emblem.webp" alt="" width="34" height="34"><div><b>Hasta Clinic</b><span>${esc(B.settings.trade_name)}</span></div></div>
    <nav class="nav" aria-label="Main">${(ME.limited ? [['attendance', 'clock', 'My attendance'], ['documents', 'file-text', 'My documents']] : NAV.concat([['attendance', 'clock', 'My attendance'], ['documents', 'file-text', 'My documents']], hrUser() ? [['staff', 'calendar-check', 'Staff']] : [])).map(([k, ic, l]) => `<a href="#/${k}" data-k="${k}">${icon(ic, 20)}<span>${l}</span>${k === 'leads' ? '<i class="badge" data-b hidden></i>' : k === '' ? '<i class="badge alert" data-tb hidden></i>' : k === 'documents' ? '<i class="badge alert" data-db hidden></i>' : ''}</a>`).join('')}
      ${ME.limited ? '' : `<div class="nav-sep"></div><a href="#/settings" data-k="settings">${icon('settings', 20)}<span>Settings</span></a>`}</nav>
    <div class="me"><span class="avatar">${esc(initials(ME.name))}</span><div><b>${esc(ME.name)}</b><span>${ME.admin ? 'Admin' : ME.role === 'manager' ? 'Manager' : 'Team'}</span></div>
      <button data-logout aria-label="Sign out" title="Sign out">${icon('log-out', 18)}</button></div>
  </aside><div class="mainwrap"><div class="alertbar" data-alertbar hidden role="alert"></div><div class="docbar" data-docbar hidden role="status"></div><main class="main" id="main"></main></div></div>`;
  MAIN = app.querySelector('#main');
  app.querySelector('[data-logout]').onclick = signOut;
  window.addEventListener('hashchange', route);
  route();
  if (!ME.limited) setInterval(checkAlerts, 60000);
}
const go = h => { if (location.hash === h) route(); else location.hash = h; };
function parseHash() { const [p, q] = location.hash.replace(/^#\/?/, '').split('?'); return { parts: p.split('/').filter(Boolean), q: new URLSearchParams(q || '') }; }
async function refreshBoot() { B = await api('/clinic/boot'); ME = B.me; CAT = null; }
async function route() {
  const { parts, q } = parseHash(), top = parts[0] || '';
  app.querySelectorAll('.nav a').forEach(a => a.classList.toggle('on', a.dataset.k === top || (top === 'invoice' && a.dataset.k === 'billing') || (top === 'patient' && a.dataset.k === 'patients') || (['po', 'grn'].includes(top) && a.dataset.k === 'stock')));
  MAIN.innerHTML = '<div class="boot" style="min-height:50vh"><img src="/img/hasta-emblem.webp" alt="" width="44" height="44"></div>';
  window.scrollTo(0, 0);
  try {
    if (!top && ME.limited) return go('#/attendance');
    if (!top) await viewToday();
    else if (top === 'attendance') await viewMyAttendance(q.get('m') || today().slice(0, 7));
    else if (top === 'staff') await viewStaff(q.get('tab') || 'today', q);
    else if (top === 'documents') await viewMyDocuments();
    else if (top === 'doc') await viewDoc(+parts[1]);
    else if (top === 'appointments') await viewAppointments(q.get('d') || today(), q.get('dept'), q.get('v'));
    else if (top === 'patients') await viewPatients(q.get('q') || '');
    else if (top === 'patient') await viewPatient(+parts[1], q.get('tab') || 'visits');
    else if (top === 'invoice') await viewInvoice(+parts[1]);
    else if (top === 'billing') await viewBilling(q.get('f') || 'today');
    else if (top === 'payments') await viewPayments(q.get('from') || today(), q.get('to') || today());
    else if (top === 'leads') await viewLeads(q.get('s') || 'open', q.get('ch') || '');
    else if (top === 'stock') await viewStock(q.get('tab') || 'stock', q);
    else if (top === 'po') await viewPO(parts[1] === 'new' ? null : +parts[1]);
    else if (top === 'grn') await (parts[1] === 'new' ? newGRN(+q.get('po') || null) : viewGRN(+parts[1]));
    else if (top === 'reports') await viewReports(q.get('tab') || 'day', q.get('d'), q.get('m'));
    else if (top === 'settings') await viewSettings(q.get('tab') || (isAdmin() ? 'clinic' : 'account'));
    else MAIN.innerHTML = emptyState('info', 'Page not found.');
  } catch (e) { MAIN.innerHTML = `<section class="panel">${emptyState('alert-triangle', e.message)}</section>`; }
  refreshDocBadge();
  if (ME.limited) return;
  checkAlerts();
  api('/clinic/leads?status=new').then(r => { const b = app.querySelector('[data-b]'); if (b) { b.hidden = !r.leads.length; b.textContent = r.leads.length; } }).catch(() => {});
}
async function catalogue() { if (!CAT) CAT = (await api('/clinic/catalogue')).items; return CAT; }
const billable = () => (CAT || []).filter(i => i.sellable);

/* ---------------- shared pickers ---------------- */
// Type-ahead for patients. onPick(patient)
function patientPicker(el, onPick, initial) {
  el.innerHTML = `<div class="picker"><input class="in" placeholder="Search name, mobile or patient ID" autocomplete="off" value="${esc(initial ? `${initial.name} · ${initial.patient_no}` : '')}"><div class="list" hidden></div></div>`;
  const input = el.querySelector('input'), list = el.querySelector('.list');
  let t;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = input.value.trim(); if (q.length < 2) { list.hidden = true; return; }
      const { patients } = await api('/clinic/patients?q=' + encodeURIComponent(q));
      list.innerHTML = patients.length ? patients.slice(0, 12).map(p => `<div class="opt" data-id="${p.id}"><span><b>${esc(p.name)}</b> <small>${esc(p.patient_no)}</small></span><small>${esc(prettyPhone(p.phone))}</small></div>`).join('') : '<div class="opt"><small>No match. Add the patient first.</small></div>';
      list.hidden = false;
      list.querySelectorAll('[data-id]').forEach(o => o.onclick = () => { const p = patients.find(x => x.id === +o.dataset.id); input.value = `${p.name} · ${p.patient_no}`; list.hidden = true; onPick(p); });
    }, 200);
  });
  input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 200));
}
// Type-ahead for catalogue items. onPick(item)
async function itemPicker(el, onPick, { deptId = null, placeholder = 'Add a service or product — type a name or code' } = {}) {
  const items = (await catalogue()).filter(i => i.sellable);
  el.innerHTML = `<div class="picker"><input class="in" placeholder="${esc(placeholder)}" autocomplete="off"><div class="list" hidden></div></div>`;
  const input = el.querySelector('input'), list = el.querySelector('.list');
  const render = () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { list.hidden = true; return; }
    const words = q.split(/\s+/);
    const hits = items.filter(i => words.every(w => (i.name + ' ' + (i.code || '') + ' ' + (i.category || '')).toLowerCase().includes(w)))
      .sort((a, b) => (deptId && a.dept_id === deptId ? -1 : 0) - (deptId && b.dept_id === deptId ? -1 : 0)).slice(0, 15);
    list.innerHTML = hits.length ? hits.map(i => `<div class="opt" data-id="${i.id}"><span>${esc(i.name)} <small>${esc(i.dept_name || '')}${i.code ? ' · ' + esc(i.code) : ''}</small></span><small class="money">${i.price > 0 ? money(i.price) : 'price varies'}${i.kind === 'passthrough' ? ' · partner' : i.gst_rate ? ` + ${i.gst_rate}%` : ' · exempt'}</small></div>`).join('') : '<div class="opt"><small>No match in the catalogue.</small></div>';
    list.hidden = false;
    list.querySelectorAll('[data-id]').forEach(o => o.onmousedown = e => { e.preventDefault(); onPick(items.find(x => x.id === +o.dataset.id)); input.value = ''; list.hidden = true; });
  };
  input.addEventListener('input', render);
  input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
}

/* ---------------- Front-desk alerts ----------------
   Visits not checked in, treatments running past their time, completed visits not billed and today's bills not paid.
   Shown as a flashing bar on every page (and in the tab title) until each one is dealt with. */
let ALERTS = null, ALERT_N = -1;
const muted = () => { try { return localStorage.getItem('hw_alert_mute') === '1'; } catch { return false; } };
function beep() {
  if (muted()) return;
  try { const c = new (window.AudioContext || window.webkitAudioContext)(), o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.value = 880; g.gain.setValueAtTime(0.0001, c.currentTime); g.gain.exponentialRampToValueAtTime(0.2, c.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.6);
    o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + 0.65); setTimeout(() => c.close(), 1000); } catch {}
}
async function checkAlerts() {
  const bar = app.querySelector('[data-alertbar]'); if (!bar) return;
  try { ALERTS = await api('/clinic/alerts'); } catch { return; }
  const A = ALERTS; A.ems_unmarked ||= []; A.ems_unpaid ||= [];
  const n = A.checkin.length + A.overrun.length + A.unbilled.length + A.unpaid.length + A.ems_unmarked.length + A.ems_unpaid.length;
  const parts = [A.checkin.length && `${A.checkin.length} not checked in`, A.overrun.length && `${A.overrun.length} still in treatment past time`,
    A.unbilled.length && `${A.unbilled.length} finished but not billed`, A.unpaid.length && `${money(A.unpaid_total)} billed today not collected`,
    A.ems_unmarked.length && `${A.ems_unmarked.length} EMS session${A.ems_unmarked.length === 1 ? '' : 's'} not marked`, A.ems_unpaid.length && `${A.ems_unpaid.length} EMS package${A.ems_unpaid.length === 1 ? '' : 's'} to collect`].filter(Boolean);
  const tb = app.querySelector('[data-tb]'); if (tb) { tb.hidden = !n; tb.textContent = n; }
  document.title = n ? `(${n}) Action needed · Hasta Clinic` : 'Hasta Clinic';
  if (n > ALERT_N && ALERT_N >= 0) beep();
  ALERT_N = n;
  bar.hidden = !n;
  if (!n) { bar.innerHTML = ''; return; }
  bar.innerHTML = `${icon('alert-triangle', 22)}<div class="grow"><b>${n === 1 ? '1 item needs' : n + ' items need'} action at the front desk</b><span>${parts.join(' · ')}</span></div>
    <button class="btn sm" data-ab-open>Review now</button><button class="ab-mute" data-ab-mute title="${muted() ? 'Turn the alert sound on' : 'Turn the alert sound off'}" aria-label="Alert sound">${icon(muted() ? 'bell-off' : 'bell', 18)}</button>`;
  bar.querySelector('[data-ab-open]').onclick = alertsModal;
  bar.querySelector('[data-ab-mute]').onclick = () => { try { localStorage.setItem('hw_alert_mute', muted() ? '0' : '1'); } catch {} checkAlerts(); };
}
function alertsModal() {
  const A = ALERTS; if (!A) return;
  const late = a => { const m = Math.round((Date.parse(A.now + ':00Z') - Date.parse(a.start_at + ':00Z')) / 60000); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} min ago` : 'on ' + fDay(a.start_at); };
  const who = a => `<b>${esc(a.patient_name)} <small class="muted">${esc(a.patient_no)}</small></b><span>${esc(fTime(a.start_at))}${a.start_at.slice(0, 10) !== today() ? ' · ' + esc(fDay(a.start_at)) : ''} · ${deptTag(a.dept_id)}${a.doctor_name ? ' · ' + esc(a.doctor_name) : ''}</span>`;
  const sec = (title, help, rows) => rows ? `<h4 style="margin:16px 0 4px">${title}</h4><p class="small muted" style="margin:0 0 6px">${help}</p><div class="rows">${rows}</div>` : '';
  const body = sec('Not checked in', 'Their time has passed. If they came, mark them arrived; if not, mark no-show.', A.checkin.map(a => `<div class="row"><div class="grow">${who(a)}<div class="small" style="color:var(--alert);font-weight:600">Was due ${esc(late(a))}</div></div>
        <button class="btn sm ghost" data-next="${a.id}" data-s="arrived">Arrived</button><button class="btn sm ghost" data-next="${a.id}" data-s="completed">Completed</button><button class="btn sm quiet" data-ns="${a.id}">No-show</button></div>`).join(''))
    + sec('Treatment running past time', 'If the treatment is over, mark it completed — you will be asked to bill it.', A.overrun.map(a => `<div class="row"><div class="grow">${who(a)}<div class="small" style="color:var(--alert);font-weight:600">${esc(ST[a.status])} · planned ${a.minutes} min, started ${esc(late(a))}</div></div>
        <button class="btn sm gold" data-next="${a.id}" data-s="completed">Completed</button></div>`).join(''))
    + sec('Finished but not billed', 'Bill it, take it from a package, or mark it no charge.', A.unbilled.map(a => closeRow(a)).join(''))
    + sec('Billed today — payment not collected', 'Take the payment before the patient leaves.', A.unpaid.map(i => `<div class="row"><div class="grow"><b>${esc(i.patient_name)} <small class="muted">${esc(i.patient_no)}</small></b><span>${esc(i.invoice_no)} · total ${money(i.total)}${i.paid ? ' · paid ' + money(i.paid) : ''}</span></div>
        <b class="money" style="color:var(--alert)">${money(i.balance)}</b><button class="btn sm gold" data-inv="${i.id}">${icon('wallet', 15)}Take payment</button></div>`).join(''))
    + sec('EMS sessions not marked', 'The session time is over. Mark whether the client came.', A.ems_unmarked.map(e => `<div class="row"><div class="grow"><b>${esc(e.client_name)}${e.patient_no ? ` <small class="muted">${esc(e.patient_no)}</small>` : ''}</b><span>${esc(fTime(e.start_at))}${e.start_at.slice(0, 10) !== today() ? ' · ' + esc(fDay(e.start_at)) : ''} · <span class="dept" style="--c:${EMS_C}">EMS</span>${e.trainer_name ? ' · ' + esc(e.trainer_name) : ''}</span></div>
        <button class="btn sm ghost" data-ems-mark="${e.id}" data-s="attended">Attended</button><button class="btn sm quiet" data-ems-mark="${e.id}" data-s="no_show">No-show</button></div>`).join(''))
    + sec('EMS packages — payment to collect', 'Sold in the EMS app. Finalise the bill and take the payment here.', A.ems_unpaid.map(x => `<div class="row"><div class="grow"><b>${esc(x.patient_name || x.client_name)}${x.patient_no ? ` <small class="muted">${esc(x.patient_no)}</small>` : ''}</b><span>${esc(x.package_name)} · ${x.invoice_no ? esc(x.invoice_no) : x.invoice_id ? 'draft bill' : 'not billed'}${x.paid ? ' · paid ' + money(x.paid) : ''}</span></div>
        <b class="money" style="color:var(--alert)">${money(x.balance)}</b>${x.invoice_id ? `<button class="btn sm gold" data-inv="${x.invoice_id}">${icon('wallet', 15)}Open bill</button>` : ''}</div>`).join(''));
  modal({ title: 'Front desk — action needed', body: `<div style="max-height:65vh;overflow:auto">${body || emptyState('check-circle', 'All clear.')}</div>`, actions: '<button class="btn ghost" data-close>Close</button>',
    onMount(el, close) {
      const after = () => { close(); checkAlerts(); if (!parseHash().parts[0]) route(); };
      const list = [...A.checkin, ...A.overrun, ...A.unbilled];
      el.querySelectorAll('[data-next]').forEach(b => b.onclick = () => busy(b, () => api(`/clinic/appointments/${b.dataset.next}/status`, { method: 'POST', body: { status: b.dataset.s } })).then(() => {
        if (b.dataset.s === 'completed') { close(); closeVisitModal(list.find(a => a.id === +b.dataset.next), () => { checkAlerts(); if (!parseHash().parts[0]) route(); }); }
        else { toast('Marked ' + ST[b.dataset.s].toLowerCase()); after(); }
      }).catch(() => {}));
      el.querySelectorAll('[data-ns]').forEach(b => b.onclick = () => busy(b, () => api(`/clinic/appointments/${b.dataset.ns}/status`, { method: 'POST', body: { status: 'no_show' } })).then(() => { toast('Marked no-show'); after(); }).catch(() => {}));
      el.querySelectorAll('[data-inv]').forEach(b => b.onclick = () => { close(); go('#/invoice/' + b.dataset.inv); });
      el.querySelectorAll('[data-ems-mark]').forEach(b => b.onclick = () => busy(b, () => api(`/clinic/ems/appointments/${b.dataset.emsMark}/status`, { method: 'POST', body: { status: b.dataset.s } })).then(() => { toast('EMS session marked'); after(); }).catch(() => {}));
      wireApptRows(el, list, after);
      el.querySelectorAll('[data-bill]').forEach(b => { const f = b.onclick; b.onclick = () => { close(); f(); }; });
    } });
}

/* ---------------- Today ---------------- */
async function viewToday() {
  const pre = DASH; DASH = null;
  const d = pre ? await pre.catch(() => api('/clinic/dashboard')) : await api('/clinic/dashboard');
  const h = new Date(Date.now() + 330 * 60000).getUTCHours();
  const collected = d.collections.reduce((s, x) => s + x.s, 0);
  MAIN.innerHTML = `<div class="head"><div><h1>${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}${ME.id ? ', ' + esc(first(ME.name)) : ''}</h1><p>${esc(fLong(d.today))}</p></div>
      <div class="acts" style="display:flex;gap:8px"><button class="btn ghost" data-newp>${icon('user-plus', 18)}Add patient</button><button class="btn gold" data-newa>${icon('calendar-plus', 18)}New appointment</button></div></div>
    ${!B.item_count && isAdmin() ? `<div class="notice">${icon('info', 18)}<span>The catalogue is empty. Import the Item Master in <a href="#/settings?tab=catalogue">Settings → Catalogue</a> before billing.</span></div>` : ''}
    ${!B.settings.gstin && isAdmin() ? `<div class="notice">${icon('info', 18)}<span>Add HASWEL CARE's GSTIN in <a href="#/settings?tab=clinic">Settings → Clinic details</a> so it prints on invoices.</span></div>` : ''}
    <div class="kpis"><div class="kpi"><div class="l">${icon('calendar-days', 16)}Appointments today</div><div class="v">${d.appointments.filter(a => !['cancelled'].includes(a.status)).length}</div><div class="s">${d.appointments.filter(a => ['arrived', 'in_treatment'].includes(a.status)).length} in clinic now</div></div>
      <div class="kpi"><div class="l">${icon('receipt', 16)}Billed today</div><div class="v money">${money(d.billed_today)}</div><div class="s">clinic revenue incl. GST</div></div>
      <div class="kpi"><div class="l">${icon('wallet', 16)}Collected today</div><div class="v money">${money(collected)}</div><div class="s">${d.collections.map(c => `${esc(B.modes[c.mode])} ${money(c.s)}`).join(' · ') || 'nothing yet'}</div></div>
      <div class="kpi"><div class="l">${icon('badge-indian-rupee', 16)}Cash in hand</div><div class="v money">${money(d.cash.in_hand)}</div><div class="s">${d.cash.in_hand > 0 && d.cash.oldest_undeposited ? 'since ' + esc(fDay(d.cash.oldest_undeposited)) : 'all deposited'}</div></div>
      <div class="kpi"><div class="l">${icon('alert-triangle', 16)}Outstanding</div><div class="v money">${money(d.outstanding.amount)}</div><div class="s"><a href="#/billing?f=due">${d.outstanding.count} invoice${d.outstanding.count === 1 ? '' : 's'}</a></div></div></div>
    ${d.stock && (d.stock.low || d.stock.expiring || d.stock.draft_pos) ? `<div class="notice">${icon('package', 18)}<span>${[d.stock.low && `<a href="#/stock?f=low">${d.stock.low} product${d.stock.low === 1 ? '' : 's'} at or below reorder level</a>`, d.stock.expiring && `<a href="#/stock?f=exp">${d.stock.expiring} batch${d.stock.expiring === 1 ? '' : 'es'} expiring within 60 days</a>`, d.stock.draft_pos && `<a href="#/stock?tab=orders">${d.stock.draft_pos} purchase order${d.stock.draft_pos === 1 ? '' : 's'} waiting for approval</a>`].filter(Boolean).join(' · ')}</span></div>` : ''}
    ${d.unclosed.length ? `<section class="panel flush" style="margin-bottom:18px;border-color:#e6c3bc"><div class="panel-h" style="padding:16px 20px 0"><div class="t">${icon('alert-triangle', 20)}<div><h3>Visits to close</h3><p class="small muted">Completed visits must be billed, covered by a package, or marked no charge.</p></div></div></div>
      <div class="rows">${d.unclosed.map(a => closeRow(a)).join('')}</div></section>` : ''}
    ${d.recalls && d.recalls.length ? `<section class="panel flush" style="margin-bottom:18px"><div class="panel-h" style="padding:16px 20px 0"><div class="t">${icon('bell', 20)}<div><h3>Follow-ups due</h3><p class="small muted">Patients to call back this week, from doctors' review dates and recalls.</p></div></div></div><div class="rows" data-recalls></div></section>` : ''}
    <section class="panel flush"><div class="panel-h" style="padding:16px 20px 0"><div class="t">${icon('calendar-days', 20)}<h3>Today's appointments</h3></div><a class="btn quiet sm" href="#/appointments">Calendar ${icon('chevron-right', 16)}</a></div>
      <div class="rows">${d.appointments.length ? d.appointments.map(a => apptRow(a)).join('') : emptyState('calendar-days', 'No appointments today.')}</div></section>`;
  MAIN.querySelector('[data-newp]').onclick = () => patientModal({}, p => go('#/patient/' + p.id));
  MAIN.querySelector('[data-newa]').onclick = () => apptModal({}, () => route());
  wireApptRows(MAIN, d.appointments.concat(d.unclosed), () => route());
  const rc = MAIN.querySelector('[data-recalls]'); if (rc) recallRows(rc, d.recalls, () => route(), true);
}
function closeRow(a) {
  return `<div class="row"><div class="grow"><b>${esc(a.patient_name)} <small class="muted">${esc(a.patient_no)}</small></b><span>${esc(fDay(a.start_at))} ${esc(fTime(a.start_at))} · ${deptTag(a.dept_id)} ${a.doctor_name ? '· ' + esc(a.doctor_name) : ''}${a.invoice_status === 'draft' ? ' · draft invoice not finalised' : ''}</span></div>
    <button class="btn sm gold" data-bill="${a.id}">${icon('receipt', 15)}Bill</button><button class="btn sm ghost" data-pkg="${a.id}">${icon('package', 15)}Package</button><button class="btn sm quiet" data-free="${a.id}">No charge</button></div>`;
}
function apptRow(a) {
  const next = { booked: ['arrived', 'Arrived'], arrived: ['in_treatment', 'Start'], in_treatment: ['completed', 'Complete'] }[a.status];
  return `<div class="row"><div style="width:78px;font-weight:700;color:var(--teal-ink)">${esc(fTime(a.start_at))}<div class="small muted" style="font-weight:500">${a.minutes} min</div></div>
    <div class="grow"><b>${esc(a.patient_name)} <small class="muted">${esc(a.patient_no)}</small></b><span>${deptTag(a.dept_id)} ${a.doctor_name ? '· ' + esc(a.doctor_name) : ''}${a.room_name ? ' · ' + esc(a.room_name) : ''}${a.reason ? ' · ' + esc(a.reason) : ''}</span>
    ${a.medical_alert ? `<div class="small" style="color:var(--alert);font-weight:600">${icon('alert-triangle', 13)} ${esc(a.medical_alert)}</div>` : ''}</div>
    ${st(a.status)}${a.closure ? st(a.closure) : ''}${next ? `<button class="btn sm ghost" data-next="${a.id}" data-s="${next[0]}">${next[1]}</button>` : ''}<button class="btn sm quiet icon" data-open="${a.id}" aria-label="Open">${icon('more-horizontal', 18)}</button></div>`;
}
function wireApptRows(root, list, after) {
  const find = id => list.find(a => a.id === +id);
  root.querySelectorAll('[data-next]').forEach(b => b.onclick = () => busy(b, () => api(`/clinic/appointments/${b.dataset.next}/status`, { method: 'POST', body: { status: b.dataset.s } })).then(() => {
    if (b.dataset.s === 'completed') closeVisitModal(find(b.dataset.next), after); else after();
  }).catch(() => {}));
  root.querySelectorAll('[data-open]').forEach(b => b.onclick = () => apptDetail(find(b.dataset.open), after));
  root.querySelectorAll('[data-bill]').forEach(b => b.onclick = () => billVisit(find(b.dataset.bill)));
  root.querySelectorAll('[data-pkg]').forEach(b => b.onclick = () => redeemModal(find(b.dataset.pkg).patient_id, find(b.dataset.pkg), after));
  root.querySelectorAll('[data-free]').forEach(b => b.onclick = () => noChargeModal(find(b.dataset.free), after));
}
async function billVisit(a) {
  const r = await api('/clinic/invoices', { method: 'POST', body: { patient_id: a.patient_id, appointment_id: a.id } });
  go('#/invoice/' + r.id);
}
function closeVisitModal(a, after) {
  modal({ title: 'Close this visit', body: `<p><b>${esc(a.patient_name)}</b> · ${esc(fTime(a.start_at))}</p><p class="muted">Every completed visit must be billed, taken from a package, or marked no charge.</p>`,
    actions: `<button class="btn quiet" data-later>Later</button><button class="btn quiet" data-free>No charge</button><button class="btn ghost" data-pkg>${icon('package', 16)}Use package</button><button class="btn gold" data-bill>${icon('receipt', 16)}Bill now</button>`,
    onMount(el, close) {
      el.querySelector('[data-later]').onclick = () => { close(); after(); };
      el.querySelector('[data-bill]').onclick = () => { close(); billVisit(a); };
      el.querySelector('[data-pkg]').onclick = () => { close(); redeemModal(a.patient_id, a, after); };
      el.querySelector('[data-free]').onclick = () => { close(); noChargeModal(a, after); };
    } });
}
function noChargeModal(a, after) {
  modal({ title: 'No charge for this visit', body: `<form data-f>${field('Reason', inp('reason', '', 'maxlength="200" placeholder="e.g. review included in treatment fee"'))}</form><p class="small muted">Recorded in your name and shown in reports.</p>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Save</button>`,
    onMount(el, close) { const s = el.querySelector('[data-save]'); s.onclick = () => busy(s, () => api(`/clinic/appointments/${a.id}/no-charge`, { method: 'POST', body: formData(el.querySelector('[data-f]')) })).then(() => { close(); toast('Visit closed — no charge'); after(); }).catch(() => {}); } });
}

/* ---------------- Appointments ---------------- */
// Calendar: day (by clinician), week (by day, times down the side) or month (overview). The last view used is remembered.

/* ---------------- EMS (one person, one record) ---------------- */
const EMS_C = '#6b4fa0';
const EMS_KIND = { session: 'EMS session', consultation: 'EMS consultation', review: 'EMS review' };
const EMS_ST = { booked: 'Booked', attended: 'Attended', no_show: 'No-show', cancelled: 'Cancelled' };
const emsCls = e => 'ems st-' + (e.status === 'attended' ? 'completed' : e.status);
const EMS_APP = location.hostname.startsWith('clinicapp.') ? location.origin.replace('//clinicapp.', '//ems.') : location.origin + '/ems';
const emsOut = (hash, label, cls = 'btn sm ghost') => `<a class="${cls}" href="${esc(EMS_APP + '/#/' + hash)}" target="_blank" rel="noopener">${icon('external-link', 15)}${label}</a>`;
const showEms = deptId => !deptId || /ems|weight/i.test((dept(deptId) || {}).name || '');
function emsDetail(e, after) {
  const due = e.status === 'booked' && e.start_at <= nowLocal();
  modal({ title: `${EMS_KIND[e.kind] || 'EMS'} · ${e.client_name}`, body: `<dl class="kv">
      <dt>When</dt><dd>${esc(fDay(e.start_at))}, ${esc(fTime(e.start_at))} · ${e.minutes} min</dd>
      <dt>Status</dt><dd>${esc(EMS_ST[e.status] || e.status)}</dd>
      ${e.unit_name ? `<dt>Centre</dt><dd>${esc(e.unit_name)}</dd>` : ''}${e.trainer_name ? `<dt>Trainer</dt><dd>${esc(e.trainer_name)}</dd>` : ''}${e.device_name ? `<dt>Device</dt><dd>${esc(e.device_name)}</dd>` : ''}
      ${e.package_name ? `<dt>Package</dt><dd>${esc(e.package_name)}</dd>` : ''}
      <dt>Clinic record</dt><dd>${e.patient_id ? `<a href="#/patient/${e.patient_id}?tab=ems" data-close>${esc(e.patient_name)} · ${esc(e.patient_no)}</a>${e.ems_link_at ? '' : ' <span class="small" style="color:var(--alert)">(link not confirmed)</span>'}` : '<span class="muted">Not linked</span>'}</dd>
      ${e.medical_alert ? `<dt>Alert</dt><dd style="color:var(--alert);font-weight:600">${esc(e.medical_alert)}</dd>` : ''}</dl>
      <p class="small muted" style="margin-top:10px">EMS bookings are made and moved in the EMS app. The front desk can mark attendance here.</p>`,
    actions: `${e.client_id ? emsOut('clients/' + e.client_id, 'Open in EMS app') : ''}${due ? `<button class="btn ghost" data-ems-s="no_show">No-show</button><button class="btn gold" data-ems-s="attended">Attended</button>` : '<button class="btn ghost" data-close>Close</button>'}`,
    onMount(el, close) { el.querySelectorAll('[data-ems-s]').forEach(b => b.onclick = () => busy(b, () => api(`/clinic/ems/appointments/${e.id}/status`, { method: 'POST', body: { status: b.dataset.emsS } })).then(() => { close(); toast('Marked ' + EMS_ST[b.dataset.emsS].toLowerCase()); checkAlerts(); after && after(); }).catch(() => {})); } });
}
function emsRow(e) {
  return `<div class="row"><div style="width:96px;font-weight:700;color:var(--teal-ink)">${esc(fDay(e.start_at))}<div class="small muted" style="font-weight:500">${esc(fTime(e.start_at))} · ${e.minutes || e.duration} min</div></div>
    <div class="grow"><b>${esc(EMS_KIND[e.kind] || 'EMS')}</b><span><span class="dept" style="--c:${EMS_C}">EMS</span>${e.unit_name ? ' · ' + esc(e.unit_name) : ''}${e.trainer_name ? ' · ' + esc(e.trainer_name) : ''}</span></div>
    ${st(e.status === 'attended' ? 'completed' : e.status, EMS_ST[e.status] || e.status)}</div>`;
}

function emsPanel(d) {
  const k = d.ems || {}, c = k.client;
  let html = '';
  if (c && k.confirmed) html += `<div class="row" style="padding:0"><div class="grow"><b>${esc(c.name)}</b><span>EMS client · ${esc(prettyPhone(c.phone))}${k.phone_matches ? '' : ' · <b style="color:var(--alert)">mobile numbers differ</b>'}</span></div>${emsOut('clients/' + c.id, 'Open in EMS app')}<button class="btn sm quiet" data-ems-unlink>Unlink</button></div>`;
  else if (c) html += `<div class="notice" style="margin:0 0 10px">${icon('info', 18)}<span>Linked to EMS client <b>${esc(c.name)}</b> (${esc(prettyPhone(c.phone))}) but not confirmed yet${k.shared_phone ? ' — <b>this mobile number is shared with another patient</b>' : ''}. Check it is the same person.</span></div>
      <div style="display:flex;gap:8px"><button class="btn sm gold" data-ems-link="${c.id}">Confirm — same person</button><button class="btn sm ghost" data-ems-unlink>Not the same person</button></div>`;
  if (!k.confirmed && k.suggestions.length) html += `<p class="small muted" style="margin:${c ? '14px' : '0'} 0 6px">EMS clients with this mobile${k.shared_phone ? ' (the number is shared by more than one patient — link only the right person)' : ''}:</p>
    ${k.suggestions.map(x => `<div class="row" style="padding:4px 0"><div class="grow"><b>${esc(x.name)}</b><span>${esc(prettyPhone(x.phone))}${x.other_patient_id ? ` · linked to ${esc(x.other_patient_name)}` : ''}</span></div>${x.other_patient_id || c ? '' : `<button class="btn sm ghost" data-ems-link="${x.id}">${icon('link', 15)}Link</button>`}</div>`).join('')}`;
  if (!c && !k.suggestions.length) html += `<p class="muted" style="margin:0">Not an EMS client. EMS clients are linked here when the mobile number matches, or from the client's page in the EMS app.</p>`;
  const pk = k.packages || [];
  return `<section class="panel" style="margin-bottom:14px"><div class="panel-h"><div class="t">${icon('link', 20)}<h3>EMS record</h3></div></div>${html}</section>
    ${pk.length ? `<section class="panel flush" style="margin-bottom:14px"><div class="panel-h" style="padding:16px 20px 4px"><div class="t">${icon('package', 20)}<h3>EMS packages</h3></div><span class="small muted">Sold in the EMS app, billed and paid here</span></div>
      <table class="t"><thead><tr><th>Package</th><th class="n">Sessions</th><th class="n">Price</th><th class="n">Paid</th><th class="n">Balance</th><th>Bill</th></tr></thead><tbody>${pk.map(x => `<tr><td><b>${esc(x.name)}</b><div class="small muted">${esc(fDate(x.start_date))}${x.expiry_date ? ' – ' + esc(fDate(x.expiry_date)) : ''}</div></td>
        <td class="n">${x.sessions_total ? `${x.used}/${x.sessions_total}` : '—'}</td><td class="n money">${money(x.due)}</td><td class="n money">${money(x.paid)}</td><td class="n money" style="${x.balance > 0 ? 'color:var(--alert);font-weight:700' : ''}">${money(x.balance)}</td>
        <td>${x.invoice_id && x.invoice_status !== 'cancelled' ? `<a href="#/invoice/${x.invoice_id}">${esc(x.invoice_no || 'Draft')}</a>` : x.balance > 0 && k.confirmed ? `<button class="btn sm ghost" data-ems-bill="${x.id}">Bill now</button>` : '<span class="small muted">EMS app (before)</span>'}</td></tr>`).join('')}</tbody></table></section>` : ''}
    ${k.sessions.length ? `<section class="panel flush"><div class="panel-h" style="padding:16px 20px 4px"><div class="t">${icon('calendar-days', 20)}<h3>EMS sessions</h3></div><span class="small muted">${k.sessions.filter(x => x.status === 'attended').length} attended</span></div><div class="rows">${k.sessions.map(x => emsRow(x)).join('')}</div></section>` : ''}`;
}
function wireEmsPanel(el, d, after) {
  const id = d.patient.id;
  el.querySelectorAll('[data-ems-link]').forEach(b => b.onclick = () => busy(b, () => api(`/clinic/patients/${id}/ems-link`, { method: 'POST', body: { ems_client_id: +b.dataset.emsLink } })).then(() => { toast('EMS record linked'); after(); }).catch(() => {}));
  el.querySelectorAll('[data-ems-unlink]').forEach(b => b.onclick = () => { if (confirm('Unlink the EMS record from this patient? Bills already made stay with this patient.')) busy(b, () => api(`/clinic/patients/${id}/ems-unlink`, { method: 'POST', body: {} })).then(() => { toast('Unlinked'); after(); }).catch(() => {}); });
  el.querySelectorAll('[data-ems-bill]').forEach(b => b.onclick = () => busy(b, () => api(`/clinic/ems/packages/${b.dataset.emsBill}/bill`, { method: 'POST', body: {} })).then(r => go('#/invoice/' + r.invoice_id)).catch(() => {}));
}

const CAL_VIEWS = [['day', 'Day'], ['week', 'Week'], ['month', 'Month']];
const weekStart = d => addDays(d, -((new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7));
const monthStart = d => d.slice(0, 8) + '01';
const addMonths = (d, n) => { const x = new Date(d.slice(0, 8) + '01T00:00:00Z'); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const D2 = (d, o) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { timeZone: 'UTC', ...o });
function calHead(view, d, deptId, title) {
  return `<div class="head"><div><h1>Appointments</h1><p>${esc(title)}</p></div>
      <div class="acts" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <div class="seg" role="tablist">${CAL_VIEWS.map(([k, l]) => `<button data-view="${k}" class="${k === view ? 'on' : ''}" role="tab" aria-selected="${k === view}">${l}</button>`).join('')}</div>
        <select class="in" data-dept style="width:auto">${[['', 'All departments'], ...B.departments.filter(x => x.active).map(x => [x.id, x.name])].map(([v, l]) => `<option value="${v}"${String(v) === String(deptId || '') ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
        <button class="btn ghost icon" data-prev aria-label="Previous">${icon('chevron-left', 18)}</button><input class="in" type="date" value="${d}" data-date style="width:auto"><button class="btn ghost icon" data-nextd aria-label="Next">${icon('chevron-right', 18)}</button>
        <button class="btn ghost" data-today>Today</button><button class="btn gold" data-new>${icon('calendar-plus', 18)}New</button></div></div>`;
}
function wireCalHead(view, d, deptId) {
  const nav = (dd, dp = deptId, v = view) => go(`#/appointments?v=${v}&d=${dd}${dp ? '&dept=' + dp : ''}`);
  const step = n => view === 'month' ? addMonths(d, n) : addDays(d, view === 'week' ? 7 * n : n);
  MAIN.querySelector('[data-prev]').onclick = () => nav(step(-1));
  MAIN.querySelector('[data-nextd]').onclick = () => nav(step(1));
  MAIN.querySelector('[data-today]').onclick = () => nav(today());
  MAIN.querySelector('[data-date]').onchange = e => e.target.value && nav(e.target.value);
  MAIN.querySelector('[data-dept]').onchange = e => nav(d, e.target.value);
  MAIN.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { try { localStorage.setItem('hw_cal_view', b.dataset.view); } catch {} nav(d, deptId, b.dataset.view); });
  MAIN.querySelector('[data-new]').onclick = () => apptModal({ start_at: d + 'T10:00', dept_id: deptId }, () => route());
  return nav;
}
async function viewAppointments(d, deptFilter, v) {
  let view = v; if (!CAL_VIEWS.some(x => x[0] === view)) { try { view = localStorage.getItem('hw_cal_view'); } catch {} }
  if (!CAL_VIEWS.some(x => x[0] === view)) view = 'day';
  if (view === 'week') return viewWeek(d, deptFilter);
  if (view === 'month') return viewMonth(d, deptFilter);
  const deptId = parseInt(deptFilter, 10) || null;
  const { appointments, ems: emsAll = [] } = await api(`/clinic/appointments?from=${d}&to=${d}`);
  const ems = showEms(deptId) ? emsAll : [];
  const dow = new Date(d + 'T00:00:00Z').getUTCDay(), [open, close] = B.hours[dow];
  const both = appointments.concat(ems);
  const startH = Math.min(+open.slice(0, 2), ...both.map(a => +a.start_at.slice(11, 13))), endH = Math.max(+close.slice(0, 2), ...both.map(a => Math.ceil((+a.start_at.slice(11, 13) * 60 + +a.start_at.slice(14, 16) + a.minutes) / 60)));
  let cols = clinicians(deptId);
  const extra = [...new Set(appointments.map(a => a.doctor_id).filter(id => id && !cols.some(c => c.id === id)))].map(id => B.team.find(t => t.id === id)).filter(Boolean);
  cols = cols.concat(extra).map(c => ({ id: c.id, name: c.name, sub: c.depts.map(x => (dept(x) || {}).name).filter(Boolean).join(', ') }));
  cols.push({ id: 0, name: 'No clinician', sub: 'unassigned' });
  const shown = appointments.filter(a => !deptId || a.dept_id === deptId);
  const slotsPerH = 4, px = 22, rows = (endH - startH) * slotsPerH;
  const top = s => ((+s.slice(11, 13) - startH) * 60 + +s.slice(14, 16)) / 15 * px;
  MAIN.innerHTML = `${calHead('day', d, deptId, fLong(d))}
    <div class="cal" style="grid-template-columns:58px repeat(${cols.length + (ems.length ? 1 : 0)}, minmax(150px,1fr))">
      <div class="cal-h time"></div>${cols.map(c => `<div class="cal-h">${esc(c.name)}<small>${esc(c.sub)}</small></div>`).join('')}${ems.length ? `<div class="cal-h">EMS<small>${esc([...new Set(ems.map(e => e.unit_name).filter(Boolean))].join(', ') || 'sessions')}</small></div>` : ''}
      <div class="cal-t">${Array.from({ length: rows }, (_, i) => `<div style="height:${px}px;${i % 4 ? '' : 'transform:translateY(-6px)'}">${i % 4 ? '' : esc(fTime(`${String(startH + i / 4).padStart(2, '0')}:00`))}</div>`).join('')}</div>
      ${cols.map(c => `<div class="cal-col" data-col="${c.id}">${Array.from({ length: rows }, (_, i) => { const t = `${String(startH + Math.floor(i / 4)).padStart(2, '0')}:${String(i % 4 * 15).padStart(2, '0')}`; return `<div class="cal-slot${i % 4 ? '' : ' hr'}${t < open || t >= close ? ' closed' : ''}" data-t="${t}"></div>`; }).join('')}
        ${shown.filter(a => (a.doctor_id || 0) === c.id || (c.id === 0 && a.doctor_id && !cols.some(x => x.id === a.doctor_id))).map(a => `<div class="appt st-${a.status}" data-open="${a.id}" style="--c:${esc(a.dept_colour || '#34595e')};top:${top(a.start_at)}px;height:${Math.max(px - 2, a.minutes / 15 * px - 3)}px">
          <b>${esc(fTime(a.start_at))} ${esc(a.patient_name)}</b><span>${esc(a.reason || a.dept_name || '')}${a.room_name ? ' · ' + esc(a.room_name) : ''}</span><span>${esc(ST[a.status])}${a.closure ? ' · ' + esc(ST[a.closure]) : ''}</span></div>`).join('')}</div>`).join('')}
      ${ems.length ? `<div class="cal-col">${Array.from({ length: rows }, (_, i) => `<div class="cal-slot closed${i % 4 ? '' : ' hr'}" style="cursor:default"></div>`).join('')}
        ${lanes(ems).map(e => `<div class="appt ${emsCls(e)}" data-ems="${e.id}" style="--c:${EMS_C};top:${top(e.start_at)}px;height:${Math.max(px - 2, e.minutes / 15 * px - 3)}px;left:calc(${e._lane / e._lanes * 100}% + 3px);right:auto;width:calc(${100 / e._lanes}% - 6px)">
          <b>${esc(fTime(e.start_at))} ${esc(e.client_name)}</b><span>${esc(EMS_KIND[e.kind] || 'EMS')}${e.trainer_name ? ' · ' + esc(e.trainer_name) : ''}</span><span>${esc(EMS_ST[e.status])}</span></div>`).join('')}</div>` : ''}
    </div><p class="small muted" style="margin-top:10px">Click an empty slot to book with that clinician. Clinicians appear here once they are given departments in Settings → Team.</p>`;
  wireCalHead('day', d, deptId);
  MAIN.querySelectorAll('.cal-slot:not(.closed)').forEach(s => s.onclick = () => { const col = +s.parentElement.dataset.col; const docDepts = col ? (B.team.find(t => t.id === col) || {}).depts || [] : []; apptModal({ start_at: `${d}T${s.dataset.t}`, doctor_id: col || null, dept_id: deptId || (docDepts.length === 1 ? docDepts[0] : null) }, () => route()); });
  MAIN.querySelectorAll('[data-open]').forEach(el => el.onclick = () => apptDetail(appointments.find(a => a.id === +el.dataset.open), () => route()));
  MAIN.querySelectorAll('[data-ems]').forEach(el => el.onclick = () => emsDetail(ems.find(e => e.id === +el.dataset.ems), () => route()));
}

// Side-by-side lanes for overlapping appointments in one day column.
function lanes(list) {
  const end = a => { const t = Date.parse(a.start_at + ':00Z'); return t + a.minutes * 60000; };
  const sorted = [...list].sort((a, b) => a.start_at.localeCompare(b.start_at));
  let group = [], groupEnd = 0; const out = [];
  const flush = () => { const laneEnds = []; for (const a of group) { const st2 = Date.parse(a.start_at + ':00Z'); let l = laneEnds.findIndex(e => e <= st2); if (l < 0) { l = laneEnds.length; laneEnds.push(0); } laneEnds[l] = end(a); a._lane = l; } for (const a of group) { a._lanes = laneEnds.length; out.push(a); } group = []; };
  for (const a of sorted) { if (group.length && Date.parse(a.start_at + ':00Z') >= groupEnd) flush(); group.push(a); groupEnd = Math.max(groupEnd, end(a)); }
  flush(); return out;
}
async function viewWeek(d, deptFilter) {
  const deptId = parseInt(deptFilter, 10) || null, ws = weekStart(d), days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const { appointments, ems: emsAll = [] } = await api(`/clinic/appointments?from=${days[0]}&to=${days[6]}`);
  const ems = (showEms(deptId) ? emsAll : []).map(e => ({ ...e, _ems: true }));
  const shown = appointments.filter(a => !deptId || a.dept_id === deptId).concat(ems);
  const hrs = days.map(x => B.hours[new Date(x + 'T00:00:00Z').getUTCDay()]);
  const startH = Math.min(...hrs.map(h => +h[0].slice(0, 2)), ...shown.map(a => +a.start_at.slice(11, 13)));
  const endH = Math.max(...hrs.map(h => Math.ceil(+h[1].slice(0, 2) + +h[1].slice(3, 5) / 60)), ...shown.map(a => Math.ceil((+a.start_at.slice(11, 13) * 60 + +a.start_at.slice(14, 16) + a.minutes) / 60)));
  const px = 22, rows = (endH - startH) * 4, top = s2 => ((+s2.slice(11, 13) - startH) * 60 + +s2.slice(14, 16)) / 15 * px;
  const title = `${D2(days[0], { day: 'numeric', month: 'short' })} – ${D2(days[6], { day: 'numeric', month: 'short', year: 'numeric' })}`;
  MAIN.innerHTML = `${calHead('week', d, deptId, title)}
    <div class="cal week" style="grid-template-columns:58px repeat(7, minmax(120px,1fr))">
      <div class="cal-h time"></div>${days.map(x => { const n = shown.filter(a => a.start_at.startsWith(x) && a.status !== 'cancelled').length; return `<a class="cal-h${x === today() ? ' is-today' : ''}" href="#/appointments?v=day&d=${x}${deptId ? '&dept=' + deptId : ''}">${esc(D2(x, { weekday: 'short', day: 'numeric' }))}<small>${n ? n + ' booked' : '—'}</small></a>`; }).join('')}
      <div class="cal-t">${Array.from({ length: rows }, (_, i) => `<div style="height:${px}px;${i % 4 ? '' : 'transform:translateY(-6px)'}">${i % 4 ? '' : esc(fTime(`${String(startH + i / 4).padStart(2, '0')}:00`))}</div>`).join('')}</div>
      ${days.map((x, di) => { const [open, close] = hrs[di]; return `<div class="cal-col" data-day="${x}">${Array.from({ length: rows }, (_, i) => { const t = `${String(startH + Math.floor(i / 4)).padStart(2, '0')}:${String(i % 4 * 15).padStart(2, '0')}`; return `<div class="cal-slot${i % 4 ? '' : ' hr'}${t < open || t >= close ? ' closed' : ''}" data-t="${t}"></div>`; }).join('')}
        ${lanes(shown.filter(a => a.start_at.startsWith(x))).map(a => a._ems ? `<div class="appt ${emsCls(a)}" data-ems="${a.id}" title="${esc(`${fTime(a.start_at)} ${a.client_name} · ${EMS_KIND[a.kind] || 'EMS'} · ${EMS_ST[a.status]}`)}" style="--c:${EMS_C};top:${top(a.start_at)}px;height:${Math.max(px - 2, a.minutes / 15 * px - 3)}px;left:calc(${a._lane / a._lanes * 100}% + 3px);right:auto;width:calc(${100 / a._lanes}% - 6px)">
          <b>${esc(fTime(a.start_at))} ${esc(a.client_name)}</b><span>EMS${a.trainer_name ? ' · ' + esc(a.trainer_name) : ''}</span></div>` : `<div class="appt st-${a.status}" data-open="${a.id}" title="${esc(`${fTime(a.start_at)} ${a.patient_name} · ${a.doctor_name || 'no clinician'} · ${ST[a.status]}`)}" style="--c:${esc(a.dept_colour || '#34595e')};top:${top(a.start_at)}px;height:${Math.max(px - 2, a.minutes / 15 * px - 3)}px;left:calc(${a._lane / a._lanes * 100}% + 3px);right:auto;width:calc(${100 / a._lanes}% - 6px)">
          <b>${esc(fTime(a.start_at))} ${esc(a.patient_name)}</b><span>${esc(a.doctor_name || a.dept_name || '')}</span></div>`).join('')}</div>`; }).join('')}
    </div><p class="small muted" style="margin-top:10px">Click a day's heading to see it by clinician. Click an empty slot to book at that time.</p>`;
  wireCalHead('week', d, deptId);
  MAIN.querySelectorAll('.cal-slot:not(.closed)').forEach(s2 => s2.onclick = () => apptModal({ start_at: `${s2.parentElement.dataset.day}T${s2.dataset.t}`, dept_id: deptId }, () => route()));
  MAIN.querySelectorAll('[data-open]').forEach(el => el.onclick = () => apptDetail(appointments.find(a => a.id === +el.dataset.open), () => route()));
  MAIN.querySelectorAll('[data-ems]').forEach(el => el.onclick = () => emsDetail(ems.find(e => e.id === +el.dataset.ems), () => route()));
}
async function viewMonth(d, deptFilter) {
  const deptId = parseInt(deptFilter, 10) || null, ms = monthStart(d), gs = weekStart(ms);
  const weeks = Math.ceil((((new Date(ms + 'T00:00:00Z').getUTCDay() + 6) % 7) + new Date(Date.UTC(+ms.slice(0, 4), +ms.slice(5, 7), 0)).getUTCDate()) / 7);
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(gs, i));
  const { appointments, ems: emsAll = [] } = await api(`/clinic/appointments?from=${days[0]}&to=${days[days.length - 1]}`);
  const ems = (showEms(deptId) ? emsAll : []).map(e => ({ ...e, _ems: true }));
  const shown = appointments.filter(a => !deptId || a.dept_id === deptId).concat(ems);
  const by = {}; for (const a of shown) (by[a.start_at.slice(0, 10)] ||= []).push(a);
  const live = list => (list || []).filter(a => a.status !== 'cancelled');
  const total = days.filter(x => x.slice(0, 7) === ms.slice(0, 7)).reduce((n, x) => n + live(by[x]).length, 0);
  MAIN.innerHTML = `${calHead('month', d, deptId, `${D2(ms, { month: 'long', year: 'numeric' })} · ${total} appointment${total === 1 ? '' : 's'}`)}
    <div class="month">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(w => `<div class="mh">${w}</div>`).join('')}
      ${days.map(x => { const list = (by[x] || []).sort((a, b) => a.start_at.localeCompare(b.start_at)), n = live(list).length, more = list.length - 4;
        return `<div class="md${x.slice(0, 7) !== ms.slice(0, 7) ? ' out' : ''}${x === today() ? ' is-today' : ''}" data-day="${x}">
          <div class="mdh"><span>${+x.slice(8)}</span>${n ? `<b>${n}</b>` : ''}</div>
          ${list.slice(0, 4).map(a => a._ems ? `<div class="mchip ${emsCls(a)}" data-ems="${a.id}" style="--c:${EMS_C}">${esc(fTime(a.start_at))} EMS · ${esc(a.client_name)}</div>` : `<div class="mchip st-${a.status}" data-open="${a.id}" style="--c:${esc(a.dept_colour || '#34595e')}">${esc(fTime(a.start_at))} ${esc(a.patient_name)}</div>`).join('')}
          ${more > 0 ? `<div class="mmore">+${more} more</div>` : ''}</div>`; }).join('')}
    </div><p class="small muted" style="margin-top:10px">Click a day to open it. Numbers count bookings that are not cancelled.</p>`;
  wireCalHead('month', d, deptId);
  MAIN.querySelectorAll('.md').forEach(c => c.onclick = e => { if (e.target.closest('[data-open],[data-ems]')) return; go(`#/appointments?v=day&d=${c.dataset.day}${deptId ? '&dept=' + deptId : ''}`); });
  MAIN.querySelectorAll('[data-ems]').forEach(el => el.onclick = () => emsDetail(ems.find(e => e.id === +el.dataset.ems), () => route()));
  MAIN.querySelectorAll('[data-open]').forEach(el => el.onclick = () => apptDetail(appointments.find(a => a.id === +el.dataset.open), () => route()));
}

function apptDetail(a, after) {
  const next = { booked: ['arrived', 'Mark arrived'], arrived: ['in_treatment', 'Start treatment'], in_treatment: ['completed', 'Complete visit'] }[a.status];
  const closed = ['completed', 'no_show', 'cancelled'].includes(a.status);
  modal({
    title: `${a.patient_name} · ${fTime(a.start_at)}`,
    body: `<dl class="kv"><dt>Patient</dt><dd><a href="#/patient/${a.patient_id}" data-close>${esc(a.patient_name)}</a> · ${esc(a.patient_no)} · ${esc(prettyPhone(a.patient_phone))}</dd>
      <dt>When</dt><dd>${esc(fLong(a.start_at.slice(0, 10)))}, ${esc(fTime(a.start_at))} · ${a.minutes} min</dd><dt>Department</dt><dd>${deptTag(a.dept_id)}</dd>
      <dt>Clinician</dt><dd>${esc(a.doctor_name || '—')}${a.assistant_name ? ` · assisted by ${esc(a.assistant_name)}` : ''}</dd><dt>Room</dt><dd>${esc(a.room_name || '—')}</dd>
      ${a.reason ? `<dt>Reason</dt><dd>${esc(a.reason)}</dd>` : ''}${a.planned_items.length ? `<dt>Planned</dt><dd>${a.planned_items.map(x => esc((CAT || []).find(i => i.id === x.item_id)?.name || 'item') + (x.qty > 1 ? ' × ' + x.qty : '')).join(', ')}</dd>` : ''}
      ${a.notes ? `<dt>Notes</dt><dd>${esc(a.notes)}</dd>` : ''}<dt>Status</dt><dd>${st(a.status)} ${a.closure ? st(a.closure) : ''}${a.invoice_no ? ` <a href="#/invoice/${a.invoice_id}" data-close>${esc(a.invoice_no)}</a>` : a.invoice_id ? ` <a href="#/invoice/${a.invoice_id}" data-close>draft invoice</a>` : ''}${a.closure_note ? `<div class="small muted">${esc(a.closure_note)}</div>` : ''}</dd></dl>
      ${a.medical_alert ? `<div class="alertline" style="margin-top:12px">${icon('alert-triangle', 16)}${esc(a.medical_alert)}</div>` : ''}`,
    actions: `${isClin() && ['arrived', 'in_treatment', 'completed'].includes(a.status) ? `<button class="btn ghost" data-note>${icon('file-text', 16)}Notes</button>` : ''}${!closed || canManage() ? `<button class="btn quiet" data-edit>${icon('pencil', 16)}Edit / reschedule</button>` : ''}
      ${!closed ? '<button class="btn quiet" data-ns>No-show</button><button class="btn quiet" data-cx>Cancel</button>' : ''}
      ${a.status === 'completed' && !a.closure ? `<button class="btn ghost" data-pkg>${icon('package', 16)}Use package</button><button class="btn gold" data-bill>${icon('receipt', 16)}Bill</button>` : ''}
      ${next ? `<button class="btn" data-next="${next[0]}">${next[1]}</button>` : ''}`,
    onMount(el, close) {
      const set = (s, msg) => api(`/clinic/appointments/${a.id}/status`, { method: 'POST', body: { status: s } }).then(() => { close(); toast(msg); s === 'completed' ? closeVisitModal(a, after) : after(); }).catch(e => toast(e.message, true));
      el.querySelector('[data-edit]') && (el.querySelector('[data-edit]').onclick = () => { close(); apptModal(a, after); });
      el.querySelector('[data-note]') && (el.querySelector('[data-note]').onclick = () => { close(); noteModal({ patient_id: a.patient_id, appointment_id: a.id, dept_id: a.dept_id, patient_name: a.patient_name }, after); });
      el.querySelector('[data-ns]') && (el.querySelector('[data-ns]').onclick = () => set('no_show', 'Marked as no-show'));
      el.querySelector('[data-cx]') && (el.querySelector('[data-cx]').onclick = () => confirm('Cancel this appointment?') && set('cancelled', 'Appointment cancelled'));
      el.querySelector('[data-next]') && (el.querySelector('[data-next]').onclick = () => set(el.querySelector('[data-next]').dataset.next, 'Updated'));
      el.querySelector('[data-bill]') && (el.querySelector('[data-bill]').onclick = () => { close(); billVisit(a); });
      el.querySelector('[data-pkg]') && (el.querySelector('[data-pkg]').onclick = () => { close(); redeemModal(a.patient_id, a, after); });
    },
  });
}

async function apptModal(a = {}, after, patient = null) {
  await catalogue();
  const editing = !!a.id;
  let pat = patient || (a.patient_id ? { id: a.patient_id, name: a.patient_name, patient_no: a.patient_no } : null);
  let planned = (a.planned_items || []).map(x => ({ ...x }));
  const date = (a.start_at || nowLocal()).slice(0, 10), time = (a.start_at || '').slice(11, 16) || '10:00';
  const deptOpts = [['', 'Choose…'], ...B.departments.filter(d => d.active).map(d => [d.id, d.name])];
  modal({
    title: editing ? 'Edit appointment' : 'New appointment', wide: true,
    body: `<form data-f class="stack" style="gap:14px">
      ${field('Patient', '<div data-pp></div>')}${!editing ? `<p class="small" style="margin-top:-8px"><a href="#" data-addp>+ New patient</a></p>` : ''}
      <div class="grid3">${field('Department', sel('dept_id', deptOpts, a.dept_id))}${field('Clinician', '<select class="in" name="doctor_id"></select>')}${field('Room / chair', sel('room_id', [['', '—'], ...B.rooms.filter(r => r.active).map(r => [r.id, r.name])], a.room_id))}</div>
      <div class="grid3">${field('Date', inp('date', date, 'type="date"'))}${field('Time', sel('time', TIMES.map(t => [t, fTime(t)]), time))}${field('Length (minutes)', inp('minutes', a.minutes || 30, 'type="number" min="5" max="480" step="5"'))}</div>
      <div class="grid2">${field('Assistant', sel('assistant_id', [['', '—'], ...assistants().map(t => [t.id, t.name])], a.assistant_id))}${field('Reason', inp('reason', a.reason || '', 'maxlength="200" placeholder="e.g. RCT sitting 2, PRP session"'))}</div>
      <div>${field('Planned treatment', '<div data-ip></div>', 'sets the length from chair time')}<div data-planned class="chips" style="margin-top:8px"></div></div>
      ${field('Notes', `<textarea class="in" name="notes" maxlength="500">${esc(a.notes || '')}</textarea>`)}</form>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>${icon('calendar-check', 18)}${editing ? 'Save changes' : 'Book'}</button>`,
    async onMount(el, close) {
      const f = el.querySelector('[data-f]');
      if (editing) el.querySelector('[data-pp]').innerHTML = `<div class="in" style="display:flex;align-items:center">${esc(pat.name)} · ${esc(pat.patient_no)}</div>`;
      else patientPicker(el.querySelector('[data-pp]'), p => { pat = p; }, pat);
      el.querySelector('[data-addp]') && (el.querySelector('[data-addp]').onclick = e => { e.preventDefault(); patientModal({}, p => { pat = p; patientPicker(el.querySelector('[data-pp]'), x => { pat = x; }, p); }); });
      const docSel = f.doctor_id;
      const fillDocs = () => { const did = parseInt(f.dept_id.value, 10) || null; const list = clinicians(did); docSel.innerHTML = `<option value="">${did ? (list.length ? 'Any / not decided' : 'No clinicians for this department') : 'Choose department first'}</option>` + list.map(t => `<option value="${t.id}"${t.id === (a.doctor_id || null) ? ' selected' : ''}>${esc(t.name)}</option>`).join(''); };
      fillDocs(); f.dept_id.onchange = () => { fillDocs(); };
      const drawPlanned = () => {
        el.querySelector('[data-planned]').innerHTML = planned.map((x, i) => `<span class="chip">${esc(CAT.find(c => c.id === x.item_id)?.name || 'item')}${x.qty > 1 ? ' × ' + x.qty : ''} <button type="button" class="btn quiet sm icon" data-rm="${i}" style="height:20px;width:20px">${icon('x', 12)}</button></span>`).join('');
        el.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { planned.splice(+b.dataset.rm, 1); drawPlanned(); setLen(); });
      };
      const setLen = () => { const m = planned.reduce((s, x) => s + (CAT.find(c => c.id === x.item_id)?.chair_minutes || 0) * x.qty, 0); if (m) f.minutes.value = Math.min(480, Math.ceil(m / 5) * 5); };
      itemPicker(el.querySelector('[data-ip]'), it => { if (it.kind === 'product') return toast('Plan services here; products are added on the bill.', true); planned.push({ item_id: it.id, qty: 1 }); if (!f.dept_id.value && it.dept_id) { f.dept_id.value = it.dept_id; fillDocs(); } drawPlanned(); setLen(); }, { placeholder: 'Add a planned service' });
      drawPlanned();
      const save = el.querySelector('[data-save]');
      const submit = (extra = {}) => {
        const v = formData(f);
        if (!pat) return toast('Choose the patient.', true);
        const body = { patient_id: pat.id, dept_id: v.dept_id, doctor_id: v.doctor_id, room_id: v.room_id, assistant_id: v.assistant_id, start_at: `${v.date}T${v.time}`, minutes: v.minutes, reason: v.reason, notes: v.notes, planned_items: planned, ...extra };
        busy(save, () => api('/clinic/appointments' + (editing ? '/' + a.id : ''), { method: editing ? 'PUT' : 'POST', body }), true).then(() => { close(); toast(editing ? 'Appointment updated' : 'Appointment booked'); after && after(); })
          .catch(e => { if (e.data && e.data.code === 'hours' && confirm(e.message + ' Book it anyway?')) submit({ outside_hours: true }); else toast(e.message, true); });
      };
      save.onclick = () => submit();
    },
  });
}

/* ---------------- Patients ---------------- */
async function viewPatients(q) {
  const { patients } = await api('/clinic/patients?q=' + encodeURIComponent(q));
  MAIN.innerHTML = `<div class="head"><div><h1>Patients</h1><p>${q ? `Matching “${esc(q)}”` : 'Most recent first'}</p></div><div class="acts"><button class="btn gold" data-add>${icon('user-plus', 18)}Add patient</button></div></div>
    <form data-s style="display:flex;gap:8px;margin-bottom:14px;max-width:520px"><input class="in" name="q" value="${esc(q)}" placeholder="Name, mobile or patient ID"><button class="btn ghost">${icon('search', 18)}Search</button></form>
    <section class="panel flush">${patients.length ? `<table class="t"><thead><tr><th>Patient</th><th>Mobile</th><th>Last visit</th><th>Added</th></tr></thead><tbody>
      ${patients.map(p => `<tr class="click" data-id="${p.id}" style="cursor:pointer"><td><b>${esc(p.name)}</b><div class="small muted">${esc(p.patient_no)}${p.medical_alert ? ` · <span style="color:var(--alert)">${icon('alert-triangle', 12)} alert</span>` : ''}${p.ems_client_id ? ' · EMS client' : ''}</div></td><td>${esc(prettyPhone(p.phone))}</td><td>${p.last_visit ? esc(fDate(p.last_visit)) : '—'}</td><td>${esc(fDate(p.created_at))}</td></tr>`).join('')}</tbody></table>`
      : emptyState('users', q ? 'No patients match.' : 'No patients yet.')}</section>`;
  MAIN.querySelector('[data-s]').onsubmit = e => { e.preventDefault(); go('#/patients?q=' + encodeURIComponent(formData(e.target).q)); };
  MAIN.querySelector('[data-add]').onclick = () => patientModal({}, p => go('#/patient/' + p.id));
  MAIN.querySelectorAll('tr[data-id]').forEach(r => r.onclick = () => go('#/patient/' + r.dataset.id));
}
function patientForm(p = {}) {
  return `<div class="grid2">${field('Full name', inp('name', p.name, 'maxlength="80" autocomplete="off"'))}${field('Mobile number', inp('phone', p.phone, 'type="tel" inputmode="tel" placeholder="98xxx xxxxx"'))}</div>
    <div class="grid3">${field('Gender', sel('gender', [['', '—'], ['female', 'Female'], ['male', 'Male'], ['other', 'Other']], p.gender))}${field('Date of birth', inp('dob', p.dob, 'type="date"'))}${field('Alternate mobile', inp('alt_phone', p.alt_phone, 'type="tel"'), 'optional')}</div>
    <div class="grid2">${field('Email', inp('email', p.email, 'type="email"'), 'optional')}${field('Address', inp('address', p.address, 'maxlength="300"'), 'printed on invoices')}</div>
    ${field('Medical alert', inp('medical_alert', p.medical_alert, 'maxlength="300" placeholder="Allergies, conditions or medicines the team must see"'), 'shown on every appointment')}
    ${field('Notes', `<textarea class="in" name="notes" maxlength="500">${esc(p.notes || '')}</textarea>`, 'optional')}`;
}
function patientModal(prefill = {}, after) {
  modal({ title: 'Add patient', wide: true, body: `<form data-f class="stack" style="gap:14px">${patientForm(prefill)}</form>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>${icon('user-plus', 18)}Add patient</button>`,
    onMount(el, close) {
      const f = el.querySelector('[data-f]'), s = el.querySelector('[data-save]');
      const submit = (extra = {}) => busy(s, () => api('/clinic/patients', { method: 'POST', body: { ...formData(f), lead_id: prefill.lead_id, ...extra } }), true)
        .then(r => { close(); toast('Patient added'); after && after({ id: r.id, name: formData(f).name, patient_no: 'HW-' + String(r.id).padStart(6, '0') }); })
        .catch(e => {
          if (e.data && e.data.matches) {
            const m = e.data.matches;
            if (confirm(`${e.message} It belongs to ${m.map(x => `${x.name} (${x.patient_no})`).join(', ')}.\n\nPress OK to add a separate patient on the same number (for example a family member), or Cancel to open the existing record.`)) submit({ confirm_shared_phone: true });
            else { close(); go('#/patient/' + m[0].id); }
          } else toast(e.message, true);
        });
      s.onclick = () => submit();
    } });
}
async function viewPatient(id, tab) {
  const d = await api('/clinic/patients/' + id);
  const p = d.patient;
  const TABS = [['visits', 'calendar-days', 'Visits'], ...(isClin() ? [['notes', 'file-text', 'Notes'], ['dental', 'stethoscope', 'Dental chart']] : []), ['plans', 'list-checks', 'Plans'], ...(isClin() ? [['photos', 'eye', 'Photos']] : []), ['followups', 'bell', 'Follow-ups'],
    ['invoices', 'receipt', 'Invoices'], ['payments', 'wallet', 'Payments'], ['packages', 'package', 'Packages'], ...(d.ems && (d.ems.client || d.ems.suggestions.length) ? [['ems', 'zap', 'EMS']] : []), ['details', 'user', 'Details']];
  const age = p.dob ? Math.floor((Date.now() - new Date(p.dob)) / 31557600000) : null;
  MAIN.innerHTML = `<a href="#/patients" class="crumb">${icon('arrow-left', 16)}Patients</a>
    <div class="head"><div style="display:flex;gap:16px;align-items:center"><span class="avatar" style="width:56px;height:56px;font-size:20px">${esc(initials(p.name))}</span><div><h1>${esc(p.name)}</h1>
      <p>${esc(p.patient_no)} · <a href="tel:+91${esc(p.phone)}">${esc(prettyPhone(p.phone))}</a>${age != null ? ` · ${age} yrs` : ''}${p.gender ? ', ' + esc(p.gender) : ''}${d.ems_client ? ` · <a href="#/patient/${p.id}?tab=ems" class="pill active">EMS client</a>` : d.ems && (d.ems.client || d.ems.suggestions.length) ? ` · <a href="#/patient/${p.id}?tab=ems" class="pill draft">EMS: confirm link</a>` : ''}${d.lead ? ` · from website (${esc(d.lead.interest || '')})` : ''}</p></div></div>
      <div class="acts" style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn ghost" href="${wa(p.phone, `Hello ${first(p.name)}, this is Hasta Wellness.`)}" target="_blank" rel="noopener">${icon('message-circle', 18)}WhatsApp</a>
        <button class="btn ghost" data-pay>${icon('wallet', 18)}Take payment</button><button class="btn ghost" data-pkgsell>${icon('package', 18)}Sell package</button><button class="btn ghost" data-inv>${icon('receipt', 18)}New bill</button><button class="btn gold" data-book>${icon('calendar-plus', 18)}Book</button></div></div>
    ${p.medical_alert ? `<div class="alertline" style="margin-bottom:14px">${icon('alert-triangle', 16)}${esc(p.medical_alert)}</div>` : ''}
    <div class="kpis" style="grid-template-columns:repeat(4,minmax(0,1fr))"><div class="kpi"><div class="l">Balance due</div><div class="v money" style="${d.due > 0 ? 'color:var(--alert)' : ''}">${money(d.due)}</div></div>
      <div class="kpi"><div class="l">Advance held</div><div class="v money">${money(d.advance)}</div></div><div class="kpi"><div class="l">Visits</div><div class="v">${d.appointments.filter(a => a.status === 'completed').length}</div></div>
      <div class="kpi"><div class="l">Active packages</div><div class="v">${d.packages.filter(x => x.usable).length}</div></div></div>
    <nav class="tabs">${TABS.map(([k, ic, l]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${icon(ic, 17)}${l}</button>`).join('')}</nav><div data-body></div>`;
  const after = () => route();
  MAIN.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => go(`#/patient/${id}?tab=${b.dataset.tab}`));
  MAIN.querySelector('[data-book]').onclick = () => apptModal({}, after, p);
  MAIN.querySelector('[data-inv]').onclick = e => busy(e.currentTarget, () => api('/clinic/invoices', { method: 'POST', body: { patient_id: id } })).then(r => go('#/invoice/' + r.id)).catch(() => {});
  MAIN.querySelector('[data-pay]').onclick = () => payModal(p, null, after);
  MAIN.querySelector('[data-pkgsell]').onclick = () => sellPackageModal(p);
  const body = MAIN.querySelector('[data-body]');
  if (tab === 'visits') {
    const emsS = d.ems_client ? d.ems.sessions : [];
    const all = d.appointments.map(a => ({ at: a.start_at, h: apptRow(a) })).concat(emsS.map(e => ({ at: e.start_at, h: emsRow(e) }))).sort((a, b) => b.at.localeCompare(a.at));
    body.innerHTML = `<section class="panel flush"><div class="rows">${all.length ? all.map(x => x.h).join('') : emptyState('calendar-days', 'No visits yet.')}</div></section>`;
    await catalogue(); wireApptRows(body, d.appointments, after);
  } else if (tab === 'ems') {
    body.innerHTML = emsPanel(d); wireEmsPanel(body, d, after);
  } else if (tab === 'invoices') {
    body.innerHTML = `<section class="panel flush">${invoiceTable(d.invoices, false)}</section>`; wireInvoiceTable(body);
  } else if (tab === 'payments') {
    body.innerHTML = `<section class="panel flush">${d.payments.length ? `<table class="t"><thead><tr><th>Date</th><th>Mode</th><th>Reference</th><th class="n">Amount</th><th class="n">Applied</th><th>By</th><th></th></tr></thead><tbody>
      ${d.payments.map(x => `<tr${x.voided ? ' style="opacity:.5;text-decoration:line-through"' : ''}><td>${esc(fDate(x.paid_on))}</td><td>${esc(B.modes[x.mode])}${x.lender ? ' · ' + esc(x.lender) : ''}</td><td class="small">${esc(x.reference || '—')}</td><td class="n money">${money(x.amount)}</td><td class="n money">${money(x.allocated)}</td><td class="small">${esc(x.staff_name || '')}</td>
        <td>${!x.voided && canManage() ? `<button class="btn sm quiet" data-void="${x.id}">Void</button>` : x.voided ? `<span class="small">${esc(x.void_reason || '')}</span>` : ''}</td></tr>`).join('')}</tbody></table>` : emptyState('wallet', 'No payments yet.')}</section>
      ${d.advance > 0 ? `<p class="small muted" style="margin-top:10px">${money(d.advance)} is held as advance. It is applied automatically to this patient's next invoice when it is finalised.</p>` : ''}`;
    body.querySelectorAll('[data-void]').forEach(b => b.onclick = () => { const reason = prompt('Why are you voiding this payment? (e.g. entered twice)'); if (!reason) return; busy(b, () => api(`/clinic/payments/${b.dataset.void}/void`, { method: 'POST', body: { reason } })).then(() => { toast('Payment voided'); after(); }).catch(() => {}); });
  } else if (tab === 'packages') {
    body.innerHTML = d.packages.length ? d.packages.map(pp => `<section class="panel" style="margin-bottom:14px"><div class="panel-h"><div class="t">${icon('package', 20)}<div><h3>${esc(pp.name)}</h3><p class="small muted">Sold ${esc(fDate(pp.start_date))}${pp.invoice_no ? ' on ' + esc(pp.invoice_no) : ''} · valid to ${esc(fDate(pp.expiry_date))}</p></div></div>
        <div style="display:flex;gap:8px;align-items:center">${pp.status === 'cancelled' ? st('cancelled') : pp.expired ? st('expired', 'Expired') : pp.status === 'closed' ? st('closed', 'Used up') : st('active', 'Active')}${pp.usable ? `<button class="btn sm gold" data-use="${pp.id}">Use</button>` : ''}</div></div>
      <table class="t"><thead><tr><th>Service</th><th class="n">Included</th><th class="n">Used</th><th class="n">Left</th></tr></thead><tbody>${pp.items.map(x => `<tr><td>${esc(x.name)}</td><td class="n">${x.qty}</td><td class="n">${x.used}</td><td class="n"><b>${x.left}</b></td></tr>`).join('')}</tbody></table>
      ${pp.redemptions.length ? `<details style="margin-top:10px"><summary class="small">History (${pp.redemptions.length})</summary><div class="small" style="margin-top:6px">${pp.redemptions.map(r => `<div style="display:flex;gap:8px;align-items:center;padding:3px 0${r.voided ? ';opacity:.5;text-decoration:line-through' : ''}">${esc(fDate(r.redeemed_on))} · ${esc(r.item_name)} × ${r.qty} · ${esc(r.staff_name || '')}${!r.voided && canManage() ? ` <button class="btn sm quiet" data-vr="${r.id}">Undo</button>` : ''}</div>`).join('')}</div></details>` : ''}</section>`).join('')
      : `<section class="panel">${emptyState('package', 'No packages yet. Use “Sell package” above.')}</section>`;
    body.querySelectorAll('[data-use]').forEach(b => b.onclick = () => redeemModal(id, null, after, +b.dataset.use));
    body.querySelectorAll('[data-vr]').forEach(b => b.onclick = () => { const reason = prompt('Reason for undoing this redemption?'); if (!reason) return; busy(b, () => api(`/clinic/redemptions/${b.dataset.vr}/void`, { method: 'POST', body: { reason } })).then(() => { toast('Redemption undone'); after(); }).catch(() => {}); });
  } else if (['notes', 'dental', 'plans', 'photos', 'followups'].includes(tab)) {
    await careTab(tab, p, body, after);
  } else {
    body.innerHTML = `<section class="panel" style="max-width:860px"><form data-f class="stack" style="gap:14px">${patientForm(p)}</form><div style="margin-top:14px"><button class="btn" data-save>Save details</button></div>
      <p class="small muted" style="margin-top:14px">Added ${esc(fDate(p.created_at))} · source: ${esc(p.source || '—')}</p></section>`;
    const s = body.querySelector('[data-save]');
    s.onclick = () => busy(s, () => api('/clinic/patients/' + id, { method: 'PUT', body: formData(body.querySelector('[data-f]')) })).then(() => { toast('Saved'); after(); }).catch(() => {});
  }
}
async function redeemModal(patientId, appt, after, onlyPkg) {
  const d = await api('/clinic/patients/' + patientId);
  const usable = d.packages.filter(x => x.usable && (!onlyPkg || x.id === onlyPkg));
  if (!usable.length) return toast('This patient has no active package with sessions left. Bill the visit instead.', true);
  modal({ title: 'Use from package', wide: true,
    body: `<form data-f class="stack" style="gap:12px">${field('Package', sel('pp', usable.map(x => [x.id, `${x.name} — valid to ${fDate(x.expiry_date)}`])))}<div data-items></div></form><p class="small muted">Only what is left in the package can be used. Recorded in your name${appt ? ' and closes the visit' : ''}.</p>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn gold" data-save>${icon('check', 18)}Record use</button>`,
    onMount(el, close) {
      const f = el.querySelector('[data-f]');
      const draw = () => { const pp = usable.find(x => x.id === +f.pp.value); el.querySelector('[data-items]').innerHTML = `<table class="t"><thead><tr><th>Service</th><th class="n">Left</th><th class="n">Use now</th></tr></thead><tbody>${pp.items.map(x => `<tr><td>${esc(x.name)}</td><td class="n">${x.left}</td><td class="n"><input class="in" type="number" min="0" max="${x.left}" value="0" name="q${x.item_id}" style="width:80px;margin-left:auto" ${x.left ? '' : 'disabled'}></td></tr>`).join('')}</tbody></table>`; };
      draw(); f.pp.onchange = draw;
      const s = el.querySelector('[data-save]');
      s.onclick = () => { const v = formData(f); const pp = usable.find(x => x.id === +v.pp); const items = pp.items.map(x => ({ item_id: x.item_id, qty: parseInt(v['q' + x.item_id], 10) || 0 })).filter(x => x.qty > 0);
        if (!items.length) return toast('Enter how many of each service were used.', true);
        busy(s, () => api('/clinic/redeem', { method: 'POST', body: { patient_package_id: pp.id, items, appointment_id: appt ? appt.id : null } })).then(() => { close(); toast('Package use recorded'); after(); }).catch(() => {}); };
    } });
}
function sellPackageModal(p) {
  const list = B.packages.filter(x => x.active);
  if (!list.length) return toast(isAdmin() ? 'No packages yet. Build one in Settings → Packages.' : 'No packages on sale yet. Ask an admin to build one.', true);
  modal({ title: 'Sell a package · ' + p.name, wide: true,
    body: `<form data-f class="stack" style="gap:12px">${field('Package', sel('pk', list.map(x => [x.id, `${x.name} — ${money(x.price)} + GST`])))}<div data-info></div></form>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn gold" data-save>${icon('receipt', 18)}Create bill</button>`,
    onMount(el, close) {
      const f = el.querySelector('[data-f]');
      const draw = () => { const k = list.find(x => x.id === +f.pk.value); el.querySelector('[data-info]').innerHTML = `<table class="t"><thead><tr><th>Includes</th><th class="n">Qty</th><th class="n">List value</th></tr></thead><tbody>${k.items.map(x => `<tr><td>${esc(x.name)}</td><td class="n">${x.qty}</td><td class="n money">${money(x.price * x.qty)}</td></tr>`).join('')}</tbody></table>
        <p style="margin-top:10px">List value ${money(k.list_value)} − ${k.discount_pct}% package discount = <b>${money(k.price)}</b> + GST where applicable. Valid for ${k.validity_days} days from the bill date.</p>`; };
      draw(); f.pk.onchange = draw;
      const s = el.querySelector('[data-save]');
      s.onclick = () => busy(s, async () => { const r = await api('/clinic/invoices', { method: 'POST', body: { patient_id: p.id } }); await api('/clinic/invoices/' + r.id, { method: 'PUT', body: { lines: [{ package_def_id: +f.pk.value, qty: 1 }] } }); return r; }).then(r => { close(); go('#/invoice/' + r.id); }).catch(() => {});
    } });
}

/* ---------------- Invoice ---------------- */
function lineCalc(l) {
  const it = l.item_id ? CAT.find(i => i.id === l.item_id) : null, pk = l.package_def_id ? B.packages.find(x => x.id === l.package_def_id) : null;
  const unit = pk ? pk.price : it && it.price > 0 ? it.price : r2(l.unit_price);
  const gross = r2(unit * l.qty), disc = Math.min(gross, Math.max(0, r2(l.discount))), net = r2(gross - disc);
  let tax = 0, kind = pk ? 'package' : it ? it.kind : 'service';
  if (pk) { const list = pk.items.reduce((s, x) => s + x.price * x.qty, 0) || 1; for (const x of pk.items) tax += r2(x.price * x.qty / list * net * x.gst_rate / 200) * 2; }
  else if (it && kind !== 'passthrough' && it.gst_rate) tax = r2(net * it.gst_rate / 200) * 2;
  return { unit, gross, disc, net, tax: r2(tax), total: r2(net + tax), kind, pct: gross ? disc / gross * 100 : 0 };
}
async function viewInvoice(id) {
  await catalogue();
  const d = await api('/clinic/invoices/' + id);
  const inv = d.invoice, draft = inv.status === 'draft';
  let lines = d.lines.map(l => ({ item_id: l.item_id, package_def_id: l.package_def_id, qty: l.qty, unit_price: l.unit_price, discount: l.discount, discount_reason: l.discount_reason || '', doctor_id: l.doctor_id, name: l.name, label: l.name, _saved: l }));
  const limit = Number(B.settings.discount_limit_pct) || 0;
  const docs = B.team.filter(t => t.active && t.depts.length);
  MAIN.innerHTML = `<a href="#/patient/${inv.patient_id}?tab=invoices" class="crumb">${icon('arrow-left', 16)}${esc(inv.patient_name)}</a>
    <div class="head"><div><h1>${draft ? 'Draft bill' : esc(inv.invoice_no)}</h1><p>${esc(inv.patient_name)} · ${esc(inv.patient_no)} · ${esc(fDate(inv.invoice_date))} ${st(inv.status)}</p></div>
      <div class="acts" style="display:flex;gap:8px;flex-wrap:wrap">${draft ? `<button class="btn quiet" data-del>${icon('trash-2', 16)}Delete draft</button><button class="btn ghost" data-save>Save draft</button><button class="btn gold" data-final>${icon('check', 18)}Finalise invoice</button>`
        : `${inv.legacy ? '<span class="small muted" style="align-self:center">From the previous system</span>' : ''}${inv.legacy && d.lines.some(l => l.kind === 'opening') ? '' : `<a class="btn ghost" href="${BASE}/api/clinic/invoices/${id}/pdf" target="_blank" rel="noopener">${icon('printer', 18)}PDF</a>`}${inv.status === 'final' && canManage() ? '<button class="btn quiet" data-cancel>Cancel invoice</button>' : ''}${inv.status === 'final' && inv.balance > 0 && d.advance > 0 ? `<button class="btn ghost" data-adv>Apply advance (${money(d.advance)})</button>` : ''}${inv.status === 'final' && inv.balance > 0 ? `<button class="btn gold" data-pay>${icon('wallet', 18)}Take payment</button>` : ''}`}</div></div>
    ${inv.status === 'cancelled' ? `<div class="alertline" style="margin-bottom:14px">Cancelled: ${esc(inv.cancel_reason || '')}</div>` : ''}
    <section class="panel flush"><table class="t inv-lines"><thead><tr><th>Item</th><th>Clinician</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">Discount (₹)</th><th class="n">GST</th><th class="n">Amount</th>${draft ? '<th></th>' : ''}</tr></thead><tbody data-lines></tbody></table>
      ${draft ? `<div style="padding:14px 16px;border-top:1px solid var(--line-soft);display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:10px"><div data-add></div>${sel('addpkg', [['', '+ Add a package'], ...B.packages.filter(x => x.active).map(x => [x.id, `${x.name} — ${money(x.price)}`])])}</div>` : ''}
      <div style="padding:16px 20px;border-top:1px solid var(--line-soft);display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px;align-items:end">
        <div>${draft ? field('Note on invoice', inp('notes', inv.notes || '', 'maxlength="300" data-notes')) : inv.notes ? `<p class="small muted">${esc(inv.notes)}</p>` : ''}${draft ? `<p class="small muted" style="margin-top:8px">Discounts above ${limit}% need ${esc(approverText())} to authorise. Prices exclude GST.</p>` : ''}</div>
        <div class="inv-tot" data-tot></div></div></section>
    ${!draft ? `<section class="panel" style="margin-top:16px"><div class="panel-h"><div class="t">${icon('wallet', 20)}<h3>Payments on this invoice</h3></div></div>${d.payments.length ? `<table class="t"><tbody>${d.payments.map(x => `<tr><td>${esc(fDate(x.paid_on))}</td><td>${esc(B.modes[x.mode])}${x.lender ? ' · ' + esc(x.lender) : ''}</td><td class="small">${esc(x.reference || '')}</td><td class="n money">${money(x.amount)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No payments yet.</p>'}</section>` : ''}`;
  const tbody = MAIN.querySelector('[data-lines]'), totEl = MAIN.querySelector('[data-tot]');
  const drawTotals = () => {
    let gross = 0, disc = 0, tax = 0, total = 0, partner = 0;
    if (draft) for (const l of lines) { const c = lineCalc(l); if (c.kind === 'passthrough') partner += c.total; else { gross += c.gross; disc += c.disc; } tax += c.tax; total += c.total; }
    else { gross = inv.gross; disc = inv.discount; tax = inv.cgst + inv.sgst; total = inv.total; partner = inv.passthrough; }
    totEl.innerHTML = `<span class="k">Value</span><span class="v">${money(gross)}</span>${disc ? `<span class="k">Discount</span><span class="v">−${money(disc)}</span>` : ''}
      ${draft ? `<span class="k">GST</span><span class="v">${money(tax)}</span>` : `<span class="k">Exempt value</span><span class="v">${money(inv.exempt)}</span><span class="k">Taxable value</span><span class="v">${money(inv.taxable)}</span><span class="k">CGST</span><span class="v">${money(inv.cgst)}</span><span class="k">SGST</span><span class="v">${money(inv.sgst)}</span>`}
      ${partner ? `<span class="k">Partner charges (no GST)</span><span class="v">${money(partner)}</span>` : ''}<span class="k big">Total</span><span class="v big">${money(total)}</span>
      ${!draft && inv.status === 'final' ? `<span class="k">Paid</span><span class="v">${money(inv.paid)}</span><span class="k"><b>Balance due</b></span><span class="v"><b style="${inv.balance > 0 ? 'color:var(--alert)' : ''}">${money(inv.balance)}</b></span>` : ''}`;
  };
  const drawLines = () => {
    if (!draft) {
      tbody.innerHTML = d.lines.map(l => `<tr><td><b>${esc(l.name)}</b>${l.kind === 'passthrough' ? `<div class="small muted">collected for ${esc(l.partner || 'partner')}</div>` : ''}${l.discount ? `<div class="small muted">Discount: ${esc(l.discount_reason || '')}${l.discount_by_name ? ' · authorised by ' + esc(l.discount_by_name) : ''}</div>` : ''}${l.tax_parts ? `<div class="small muted">GST split: ${l.tax_parts.map(pt => `${pt.rate ? pt.rate + '%' : 'exempt'} on ${money(pt.value)}`).join(', ')}</div>` : ''}</td>
        <td class="small">${esc(l.doctor_name || '')}</td><td class="n">${l.qty}</td><td class="n money">${money(l.unit_price)}</td><td class="n money">${l.discount ? money(l.discount) : '—'}</td><td class="n small">${l.kind === 'passthrough' ? 'n/a' : l.tax_parts ? 'mixed' : l.gst_rate ? l.gst_rate + '%' : 'Exempt'}</td><td class="n money"><b>${money(l.total)}</b></td></tr>`).join('') || `<tr><td colspan="7">${emptyState('receipt', 'No lines.')}</td></tr>`;
      return drawTotals();
    }
    tbody.innerHTML = lines.map((l, i) => {
      const it = l.item_id ? CAT.find(x => x.id === l.item_id) : null, pk = l.package_def_id ? B.packages.find(x => x.id === l.package_def_id) : null, c = lineCalc(l);
      const ems = it && it.code === 'EMS-PKG', variable = it && !(it.price > 0) && !ems;
      return `<tr data-i="${i}"><td><b>${esc(pk ? pk.name : it && !ems ? it.name : l.name)}</b><div class="small muted">${pk ? 'Package' : ems ? 'EMS package · price set in the EMS app' : esc(it?.dept_name || '')}${it?.kind === 'passthrough' ? ' · partner charge' : ''}</div>
          ${c.disc > 0 ? `<input class="in" data-k="discount_reason" value="${esc(l.discount_reason)}" placeholder="Reason for discount" maxlength="120" style="margin-top:6px;height:32px">${c.pct > limit + 1e-9 ? `<div class="small" style="color:var(--gold-ink);margin-top:4px">${c.pct.toFixed(0)}% — ${l._saved && l._saved.discount_by_name && l._saved.discount >= c.disc ? 'authorised by ' + esc(l._saved.discount_by_name) : 'needs ' + esc(approverText()) + ' to authorise'}</div>` : ''}` : ''}</td>
        <td>${pk ? '' : `<select class="in" data-k="doctor_id" style="min-width:130px"><option value="">—</option>${docs.map(t => `<option value="${t.id}"${t.id === l.doctor_id ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`}</td>
        <td class="n"><input class="in qty" type="number" min="1" max="999" data-k="qty" value="${l.qty}"${ems ? ' readonly title="Set in the EMS app"' : ''}></td>
        <td class="n">${variable ? `<input class="in amt" type="number" min="0" step="0.01" data-k="unit_price" value="${l.unit_price || ''}" placeholder="price">` : `<span class="money">${money(c.unit)}</span>`}</td>
        <td class="n"><input class="in amt" type="number" min="0" step="0.01" data-k="discount" value="${l.discount || ''}" placeholder="0"${ems ? ' readonly title="EMS package price and discount are set in the EMS app"' : ''}></td>
        <td class="n small">${c.kind === 'passthrough' ? 'n/a' : pk ? 'split' : it?.gst_rate ? it.gst_rate + '%' : 'Exempt'}</td><td class="n money"><b>${money(c.total)}</b></td>
        <td><button class="btn quiet sm icon" data-rm aria-label="Remove">${icon('x', 16)}</button></td></tr>`;
    }).join('') || `<tr><td colspan="8">${emptyState('receipt', 'Add services, products or a package below.')}</td></tr>`;
    tbody.querySelectorAll('tr[data-i]').forEach(tr => {
      const l = lines[+tr.dataset.i];
      tr.querySelectorAll('[data-k]').forEach(inpEl => inpEl.onchange = () => { const k = inpEl.dataset.k; l[k] = k === 'discount_reason' ? inpEl.value : k === 'doctor_id' ? (parseInt(inpEl.value, 10) || null) : Number(inpEl.value) || (k === 'qty' ? 1 : 0); drawLines(); });
      tr.querySelector('[data-rm]').onclick = () => { lines.splice(+tr.dataset.i, 1); drawLines(); };
    });
    drawTotals();
  };
  drawLines();
  if (draft) {
    const defaultDoc = lines.find(l => l.doctor_id)?.doctor_id || (ME.depts.length ? ME.id : null);
    itemPicker(MAIN.querySelector('[data-add]'), it => { lines.push({ item_id: it.id, qty: 1, unit_price: it.price, discount: 0, discount_reason: '', doctor_id: it.kind === 'product' ? null : defaultDoc }); drawLines(); });
    MAIN.querySelector('[name=addpkg]').onchange = e => { const v = +e.target.value; if (v) { lines.push({ package_def_id: v, qty: 1, discount: 0, discount_reason: '' }); e.target.value = ''; drawLines(); } };
    const save = (authoriser) => api('/clinic/invoices/' + id, { method: 'PUT', body: { lines, notes: MAIN.querySelector('[data-notes]').value, authoriser } });
    const withAuth = fn => fn().catch(e => {
      if (!(e.data && e.data.code === 'authorise')) throw e;
      return new Promise((resolve, reject) => modal({ title: 'Discount authorisation', body: `<p>${esc(e.message)}</p><form data-f class="stack" style="gap:12px">${field('Approver username', inp('username', '', 'autocapitalize="none"'))}${field('Their password', inp('password', '', 'type="password"'))}</form><p class="small muted">Their name is recorded on the invoice line.</p>`,
        actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-ok>Authorise</button>`,
        onMount(el, close) { el.querySelector('[data-close]').addEventListener('click', () => reject(new Error('Not authorised.'))); const ok = el.querySelector('[data-ok]'); ok.onclick = () => busy(ok, () => save(formData(el.querySelector('[data-f]'))), true).then(r => { close(); resolve(r); }).catch(err => toast(err.message, true)); } }));
    });
    const sBtn = MAIN.querySelector('[data-save]');
    sBtn.onclick = () => busy(sBtn, () => withAuth(() => save())).then(() => { toast('Draft saved'); route(); }).catch(() => {});
    const fBtn = MAIN.querySelector('[data-final]');
    fBtn.onclick = () => { if (!lines.length) return toast('Add at least one line.', true); if (!confirm('Finalise this invoice? It gets a number and can no longer be edited.')) return;
      busy(fBtn, async () => { await withAuth(() => save()); return api(`/clinic/invoices/${id}/finalise`, { method: 'POST', body: {} }); }).then(r => { toast(`Invoice ${r.invoice_no} finalised`); route(); }).catch(() => {}); };
    const del = MAIN.querySelector('[data-del]');
    del.onclick = () => confirm('Delete this draft?') && busy(del, () => api('/clinic/invoices/' + id, { method: 'DELETE' })).then(() => { toast('Draft deleted'); go(`#/patient/${inv.patient_id}?tab=invoices`); }).catch(() => {});
  } else {
    const p = { id: inv.patient_id, name: inv.patient_name };
    MAIN.querySelector('[data-pay]') && (MAIN.querySelector('[data-pay]').onclick = () => payModal(p, inv, () => route()));
    MAIN.querySelector('[data-adv]') && (MAIN.querySelector('[data-adv]').onclick = e => busy(e.currentTarget, () => api('/clinic/apply-advance', { method: 'POST', body: { invoice_id: id } })).then(r => { toast(`${money(r.applied)} applied`); route(); }).catch(() => {}));
    MAIN.querySelector('[data-cancel]') && (MAIN.querySelector('[data-cancel]').onclick = e => { const reason = prompt('Reason for cancelling this invoice? Any payment stays with the patient as advance.'); if (!reason) return; busy(e.currentTarget, () => api(`/clinic/invoices/${id}/cancel`, { method: 'POST', body: { reason } })).then(() => { toast('Invoice cancelled'); route(); }).catch(() => {}); });
  }
}
function payModal(p, inv, after) {
  const due = inv ? inv.balance : 0;
  const refLabel = { cash: '', upi: 'UPI reference (UTR)', card: 'POS slip / approval number', bank: 'Bank transfer reference', finance: 'Loan / disbursement reference' };
  modal({ title: inv ? `Payment · ${inv.invoice_no}` : `Payment · ${p.name}`,
    body: `<form data-f class="stack" style="gap:14px">${inv ? `<p>Balance due <b>${money(due)}</b>. Anything above this is kept as the patient's advance.</p>` : '<p class="muted">With no invoice chosen, this is held as an advance and applied to the next invoice automatically.</p>'}
      <div class="grid2">${field('Amount (₹)', inp('amount', due || '', 'type="number" min="1" step="0.01" inputmode="decimal"'))}${field('Date', inp('paid_on', today(), `type="date" max="${today()}"`))}</div>
      <div class="chips">${Object.entries(B.modes).map(([k, l], i) => `<label class="chip"><input type="radio" name="mode" value="${k}"${i === 0 ? ' checked' : ''}>${esc(l)}</label>`).join('')}</div>
      <div data-ref hidden>${field('Reference', inp('reference', '', 'maxlength="80"'))}</div><div data-lender hidden>${field('Finance company', inp('lender', 'Fibe', 'maxlength="60"'))}</div>
      ${field('Note', inp('notes', '', 'maxlength="200"'), 'optional')}</form>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn gold" data-save>${icon('check', 18)}Record payment</button>`,
    onMount(el, close) {
      const f = el.querySelector('[data-f]');
      const sync = () => { const m = formData(f).mode; el.querySelector('[data-ref]').hidden = m === 'cash'; el.querySelector('[data-ref] .f').firstChild.textContent = refLabel[m] || 'Reference'; el.querySelector('[data-lender]').hidden = m !== 'finance'; };
      f.querySelectorAll('[name=mode]').forEach(r => r.onchange = sync); sync();
      const s = el.querySelector('[data-save]');
      s.onclick = () => busy(s, () => api('/clinic/payments', { method: 'POST', body: { ...formData(f), patient_id: p.id, invoice_id: inv ? inv.id : null } })).then(r => { close(); toast(r.advance > 0 ? `Payment recorded · ${money(r.advance)} held as advance` : 'Payment recorded'); after && after(); }).catch(() => {});
    } });
}

/* ---------------- Billing list ---------------- */
function invoiceTable(list, withPatient = true) {
  return list.length ? `<table class="t"><thead><tr><th>Invoice</th><th>Date</th>${withPatient ? '<th>Patient</th>' : ''}<th class="n">Total</th><th class="n">Paid</th><th class="n">Due</th><th>Status</th></tr></thead><tbody>
    ${list.map(i => `<tr data-inv="${i.id}" style="cursor:pointer"><td><b>${esc(i.invoice_no || 'Draft')}</b></td><td>${esc(fDate(i.invoice_date))}</td>${withPatient ? `<td>${esc(i.patient_name)}<div class="small muted">${esc(i.patient_no)}</div></td>` : ''}<td class="n money">${money(i.total)}</td><td class="n money">${i.status === 'final' ? money(i.paid) : '—'}</td><td class="n money">${i.balance > 0 ? `<b style="color:var(--alert)">${money(i.balance)}</b>` : '—'}</td><td>${st(i.status)}</td></tr>`).join('')}</tbody></table>`
    : emptyState('receipt', 'No invoices here.');
}
function wireInvoiceTable(root) { root.querySelectorAll('[data-inv]').forEach(r => r.onclick = () => go('#/invoice/' + r.dataset.inv)); }
async function viewBilling(f) {
  const t = today(), FILTERS = [['today', 'Today'], ['week', 'Last 7 days'], ['month', 'This month'], ['due', 'Outstanding'], ['draft', 'Drafts']];
  let list;
  if (f === 'due') list = (await api('/clinic/reports/outstanding')).invoices;
  else if (f === 'draft') list = (await api('/clinic/invoices?status=draft')).invoices;
  else list = (await api(`/clinic/invoices?from=${f === 'today' ? t : f === 'week' ? addDays(t, -6) : t.slice(0, 8) + '01'}&to=${t}`)).invoices;
  const fin = list.filter(i => i.status === 'final');
  MAIN.innerHTML = `<div class="head"><div><h1>Billing</h1><p>${fin.length} final invoice${fin.length === 1 ? '' : 's'} · ${money(fin.reduce((s, i) => s + i.total, 0))}${f === 'due' ? ' outstanding: ' + money(list.reduce((s, i) => s + i.balance, 0)) : ''}</p></div></div>
    <div class="seg" style="margin-bottom:14px">${FILTERS.map(([k, l]) => `<button data-f="${k}" class="${k === f ? 'on' : ''}">${l}</button>`).join('')}</div>
    <section class="panel flush">${invoiceTable(list)}</section><p class="small muted" style="margin-top:10px">To bill, open the patient (or a completed visit) and choose New bill.</p>`;
  MAIN.querySelectorAll('[data-f]').forEach(b => b.onclick = () => go('#/billing?f=' + b.dataset.f));
  wireInvoiceTable(MAIN);
  if (canManage()) emsLegacyPanel();
}
// Payments taken in the EMS app before EMS billing moved here: bring each across, or record that the
// clinic bill already includes it, so the money is counted once.
async function emsLegacyPanel() {
  const { payments } = await api('/clinic/ems/payments').catch(() => ({ payments: [] }));
  if (!payments.length || !location.hash.startsWith('#/billing')) return;
  const box = document.createElement('section'); box.className = 'panel'; box.style.marginBottom = '14px';
  box.innerHTML = `<div class="panel-h"><div class="t">${icon('alert-triangle', 20)}<h3>EMS app payments to bring across (${payments.length})</h3></div></div>
    <p class="small muted" style="margin:0 0 10px">These were taken in the EMS app before EMS billing moved here. <b>Bring across</b> makes the package bill and records the payment on its original date. If the money is already inside a clinic bill (for example one UPI transfer for several things), choose <b>Already billed</b> so it is not counted twice.</p>
    <div class="rows">${payments.map(e => `<div class="row"><div class="grow"><b>${esc(e.client_name)}${e.patient_no ? ` <small class="muted">${esc(e.patient_no)}${e.ems_link_at ? '' : ' · link not confirmed'}</small>` : ' <small style="color:var(--alert)">no clinic record linked</small>'}</b>
        <span>${esc(fDate(e.paid_on))} · ${esc(e.method)}${e.reference ? ' ' + esc(e.reference) : ''} · ${esc(e.package_name || '')}</span>
        ${e.same_ref_invoices ? `<div class="small" style="color:var(--alert);font-weight:600">${icon('alert-triangle', 13)} Same reference is on clinic bill${e.same_ref_invoices.includes(',') ? 's' : ''} ${esc(e.same_ref_invoices)} — check before bringing across</div>` : ''}</div>
      <b class="money">${money(e.amount)}</b>${e.patient_id && e.ems_link_at ? `<button class="btn sm gold" data-mv="${e.id}">Bring across</button>` : e.patient_id ? `<a class="btn sm ghost" href="#/patient/${e.patient_id}?tab=ems">Confirm link</a>` : ''}<button class="btn sm ghost" data-rs="${e.id}">Already billed</button></div>`).join('')}</div>`;
  MAIN.insertBefore(box, MAIN.querySelector('.seg'));
  box.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => {
    const e = payments.find(x => x.id === +b.dataset.mv);
    const send = confirm_different => api(`/clinic/ems/payments/${e.id}/move`, { method: 'POST', body: { confirm_different } });
    busy(b, () => send(false).catch(err => {
      if (err && err.data && err.data.code === 'same_ref' && confirm(err.message + '\n\nPress OK only if this is a different payment that is not in any clinic bill.')) return send(true);
      throw err;
    }), true).then(r => { if (r) { toast(`Brought across: ${money(e.amount)}`); route(); } }).catch(err => err && err.message && toast(err.message, true));
  });
  box.querySelectorAll('[data-rs]').forEach(b => b.onclick = () => {
    const e = payments.find(x => x.id === +b.dataset.rs);
    modal({ title: 'Already billed in the clinic', body: `<form data-f class="stack" style="gap:12px"><p class="small muted">${esc(e.client_name)} · ${money(e.amount)} ${esc(e.method)} on ${esc(fDate(e.paid_on))}${e.reference ? ' · ref ' + esc(e.reference) : ''}. The EMS app will stop counting it; the package's payments will come from the clinic bill.</p>
        ${field('Clinic bill that includes it (optional)', inp('invoice_no', (e.same_ref_invoices || '').split(',')[0] || '', 'placeholder="HW/2026/00177"'))}
        ${field('Note', inp('note', '', 'maxlength="200" placeholder="e.g. Paid with the Sculpt and Glow bill, one UPI transfer"'))}</form>`,
      actions: '<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Save</button>',
      onMount(el, close) { const sv = el.querySelector('[data-save]'); sv.onclick = () => busy(sv, () => api(`/clinic/ems/payments/${e.id}/resolve`, { method: 'POST', body: formData(el.querySelector('[data-f]')) })).then(() => { close(); toast('Recorded'); route(); }).catch(() => {}); } });
  });
}

/* ---------------- Payments & cash ---------------- */
async function viewPayments(from, to) {
  const [{ payments }, cash] = await Promise.all([api(`/clinic/payments?from=${from}&to=${to}`), api('/clinic/cash')]);
  const live = payments.filter(p => !p.voided), byMode = {};
  for (const p of live) byMode[p.mode] = (byMode[p.mode] || 0) + p.amount;
  MAIN.innerHTML = `<div class="head"><div><h1>Payments</h1><p>${esc(fDate(from))}${from !== to ? ' to ' + esc(fDate(to)) : ''}</p></div>
      <form data-r class="acts" style="display:flex;gap:8px;align-items:center">${inp('from', from, 'type="date" style="width:auto"')}<span class="muted">to</span>${inp('to', to, 'type="date" style="width:auto"')}<button class="btn ghost">Show</button></form></div>
    <div class="kpis" style="grid-template-columns:repeat(${Object.keys(B.modes).length + 1},minmax(0,1fr))"><div class="kpi"><div class="l">Total</div><div class="v money">${money(live.reduce((s, p) => s + p.amount, 0))}</div><div class="s">${live.length} payments</div></div>
      ${Object.entries(B.modes).map(([k, l]) => `<div class="kpi"><div class="l">${esc(l)}</div><div class="v money" style="font-size:20px">${money(byMode[k] || 0)}</div></div>`).join('')}</div>
    <div class="grid2" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr);align-items:start">
      <section class="panel flush">${payments.length ? `<table class="t"><thead><tr><th>Date</th><th>Patient</th><th>Mode</th><th>Reference</th><th class="n">Amount</th><th>Applied to</th></tr></thead><tbody>
        ${payments.map(p => `<tr${p.voided ? ' style="opacity:.5;text-decoration:line-through"' : ''}><td>${esc(fDay(p.paid_on))}</td><td><a href="#/patient/${p.patient_id}?tab=payments">${esc(p.patient_name)}</a></td><td>${esc(B.modes[p.mode])}${p.lender ? ' · ' + esc(p.lender) : ''}</td><td class="small">${esc(p.reference || '—')}</td><td class="n money">${money(p.amount)}</td><td class="small">${esc(p.invoices || '')}${p.amount - p.allocated > 0.004 && !p.voided ? ` <span class="pill warn">${money(p.amount - p.allocated)} advance</span>` : ''}</td></tr>`).join('')}</tbody></table>` : emptyState('wallet', 'No payments in this period.')}</section>
      <section class="panel"><div class="panel-h"><div class="t">${icon('badge-indian-rupee', 20)}<h3>Cash in hand</h3></div></div>
        <div class="v money" style="font-family:Manrope;font-weight:700;font-size:28px;color:var(--teal-ink)">${money(cash.in_hand)}</div>
        <p class="small muted">${cash.in_hand > 0 && cash.oldest_undeposited ? `Undeposited since ${esc(fDate(cash.oldest_undeposited))}. Deposit cash to the bank regularly.` : 'All cash is deposited.'}</p>
        ${canManage() ? `<button class="btn gold sm" data-dep style="margin-top:10px">${icon('plus', 16)}Record bank deposit</button>` : ''}
        <h4 style="margin:18px 0 6px">Recent deposits</h4>${cash.deposits.length ? cash.deposits.slice(0, 10).map(x => `<div class="small" style="display:flex;justify-content:space-between;padding:4px 0;border-top:1px solid var(--line-soft)"><span>${esc(fDate(x.deposited_on))} · ${esc(x.bank || '')} ${esc(x.reference)}<br><span class="muted">${esc(x.staff_name || '')}</span></span><b class="money">${money(x.amount)}</b></div>`).join('') : '<p class="small muted">None yet.</p>'}</section></div>`;
  MAIN.querySelector('[data-r]').onsubmit = e => { e.preventDefault(); const v = formData(e.target); go(`#/payments?from=${v.from}&to=${v.to}`); };
  MAIN.querySelector('[data-dep]') && (MAIN.querySelector('[data-dep]').onclick = () => modal({ title: 'Record bank deposit',
    body: `<form data-f class="stack" style="gap:12px"><div class="grid2">${field('Amount (₹)', inp('amount', cash.in_hand || '', 'type="number" min="1" step="0.01"'))}${field('Date', inp('deposited_on', today(), `type="date" max="${today()}"`))}</div><div class="grid2">${field('Bank', inp('bank', '', 'maxlength="60"'))}${field('Deposit slip / reference', inp('reference', '', 'maxlength="80"'))}</div></form>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Save</button>`,
    onMount(el, close) { const s = el.querySelector('[data-save]'); s.onclick = () => busy(s, () => api('/clinic/cash/deposits', { method: 'POST', body: formData(el.querySelector('[data-f]')) })).then(() => { close(); toast('Deposit recorded'); route(); }).catch(() => {}); } }));
}

/* ---------------- Leads ---------------- */
const CHANNEL = { instagram: 'Instagram', facebook: 'Facebook', whatsapp: 'WhatsApp', google: 'Google', youtube: 'YouTube', website: 'Website', phone: 'Phone call', 'walk-in': 'Walk-in', referral: 'Referral', other: 'Other' };
const chTag = c => c ? `<span class="pill" style="margin-left:6px">${esc(CHANNEL[c] || c)}</span>` : '';
function leadModal(after) {
  const ints = ['Dental', 'Skin', 'Laser hair reduction', 'Hair', 'EMS & weight management', 'Wellness / IV therapy', 'Body contouring', 'Not sure yet'];
  modal({ title: 'Add lead', body: `<form data-f class="stack" style="gap:12px">
      ${field('Where did the enquiry come from?', sel('channel', [['', 'Choose…'], ['instagram', 'Instagram (DM or comment)'], ['whatsapp', 'WhatsApp'], ['phone', 'Phone call'], ['walk-in', 'Walk-in'], ['referral', 'Referral'], ['facebook', 'Facebook'], ['google', 'Google'], ['other', 'Other']], ''))}
      <div class="grid2">${field('Name', inp('name', '', 'maxlength="80"'))}${field('Mobile number', inp('phone', '', 'type="tel" maxlength="20"'))}</div>
      <div class="grid2">${field('Interested in', sel('interest', ints.map(x => [x, x]), 'Not sure yet'))}${field('Preferred date', inp('preferred_date', '', 'type="date"'))}</div>
      ${field('What they asked about', inp('concern', '', 'maxlength="200" placeholder="e.g. Price for underarm laser, asked on Instagram"'))}
      ${field('Notes', inp('notes', '', 'maxlength="400" placeholder="e.g. Instagram @username, best time to call"'))}</form>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>${icon('plus', 18)}Add lead</button>`,
    onMount(el, close) { const b = el.querySelector('[data-save]'); b.onclick = () => busy(b, () => api('/clinic/leads', { method: 'POST', body: formData(el.querySelector('[data-f]')) }), true).then(() => { close(); toast('Lead added'); after && after(); }).catch(e => toast(e.message, true)); } });
}
async function viewLeads(s, ch) {
  const { leads: all } = await api('/clinic/leads?status=' + encodeURIComponent(s));
  const leads = ch ? all.filter(l => (l.channel || 'website') === ch) : all;
  const chans = [...new Set(all.map(l => l.channel || 'website'))];
  const F = [['open', 'To follow up'], ['booked', 'Booked'], ['not interested', 'Not interested'], ['all', 'All']];
  MAIN.innerHTML = `<div class="head"><div><h1>Leads</h1><p>Enquiries from the website, Instagram and other channels. EMS enquiries are also in the EMS app.</p></div><div class="acts"><button class="btn gold" data-add>${icon('plus', 18)}Add lead</button></div></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px"><div class="seg">${F.map(([k, l]) => `<button data-s="${esc(k)}" class="${k === s ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${chans.length > 1 || ch ? sel('ch', [['', 'All channels'], ...chans.map(c => [c, CHANNEL[c] || c])], ch || '', 'data-ch style="width:auto;height:36px"') : ''}</div>
    <section class="panel flush"><div class="rows">${leads.length ? leads.map(l => `<div class="row" style="flex-wrap:wrap"><span class="avatar">${esc(initials(l.name))}</span><div class="grow" style="min-width:220px"><b>${esc(l.name)} ${l.status === 'new' ? pill('new', 'New') : ''}${chTag(l.channel)}</b>
        <span>${esc(l.interest || 'Not specified')}${l.concern ? ' — ' + esc(l.concern) : ''}</span><span class="small muted">${esc(l.created_at ? fWhen(new Date(new Date(l.created_at).getTime() + 330 * 60000).toISOString().slice(0, 16)) : '')} · ${esc(l.source || '')}${l.preferred_date ? ' · prefers ' + esc(l.preferred_date) : ''}${l.timing ? ' · ' + esc(l.timing) : ''}</span></div>
      <a class="btn sm ghost icon" href="tel:${esc(l.phone)}" aria-label="Call">${icon('phone', 16)}</a><a class="btn sm ghost icon" href="${wa(l.phone, `Hello ${first(l.name)}, this is Hasta Wellness about your enquiry.`)}" target="_blank" rel="noopener" aria-label="WhatsApp">${icon('message-circle', 16)}</a>
      ${l.patient_id ? `<a class="btn sm ghost" href="#/patient/${l.patient_id}">Open patient</a>` : `<button class="btn sm gold" data-conv="${l.id}">${icon('user-plus', 15)}Add as patient</button>`}
      <select class="in" data-st="${l.id}" style="width:auto;height:32px">${['new', 'contacted', 'booked', 'not interested'].map(x => `<option${x === l.status ? ' selected' : ''}>${x}</option>`).join('')}</select></div>`).join('') : emptyState('inbox', 'No leads here.')}</div></section>`;
  MAIN.querySelectorAll('[data-s]').forEach(b => b.onclick = () => go('#/leads?s=' + encodeURIComponent(b.dataset.s) + (ch ? '&ch=' + encodeURIComponent(ch) : '')));
  const chs = MAIN.querySelector('[data-ch]'); if (chs) chs.onchange = () => go('#/leads?s=' + encodeURIComponent(s) + (chs.value ? '&ch=' + encodeURIComponent(chs.value) : ''));
  MAIN.querySelector('[data-add]').onclick = () => leadModal(() => go('#/leads?s=open&t=' + Date.now()));
  MAIN.querySelectorAll('[data-st]').forEach(x => x.onchange = () => api('/clinic/leads/' + x.dataset.st, { method: 'PUT', body: { status: x.value } }).then(() => toast('Updated')).catch(e => toast(e.message, true)));
  MAIN.querySelectorAll('[data-conv]').forEach(b => b.onclick = () => { const l = leads.find(x => x.id === +b.dataset.conv); patientModal({ name: l.name, phone: String(l.phone || '').replace(/\D/g, '').slice(-10), lead_id: l.id }, p => go('#/patient/' + p.id)); });
}

/* ---------------- Staff attendance, leave & pay ----------------
   Everyone: My attendance (today, month, leave balance, apply for leave, warnings, payslips).
   Managers and the leave approver: Staff (today, month grid, leave, absences, pay, setup). */
// Times stored by the server in UTC (…Z) shown in clinic time.
const fUtc = s => s ? fWhen(new Date(Date.parse(/Z$/.test(s) ? s : s + 'Z') + 330 * 60000).toISOString().slice(0, 16)) : '';
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYST = { present: ['P', 'Present'], in: ['IN', 'Clocked in'], leave: ['L', 'Leave'], pending: ['?', 'Leave awaiting approval'], absent: ['A', 'Absent — no approved leave'], off: ['W', 'Weekly off'], holiday: ['H', 'Holiday'], upcoming: ['', ''], na: ['', 'Not employed'] };
const LEAVE_KIND = { annual: 'Annual leave', sick: 'Sick leave', casual: 'Casual leave', unpaid: 'Unpaid leave' };
const hm = min => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
const tOnly = s => s ? fTime(s.slice(11, 16)) : '—';
const fMonth = m => new Date(m + '-01T00:00:00Z').toLocaleDateString('en-IN', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const prevMonth = m => { const x = new Date(m + '-01T00:00:00Z'); x.setUTCMonth(x.getUTCMonth() - 1); return x.toISOString().slice(0, 7); };
const nextMonth = m => { const x = new Date(m + '-01T00:00:00Z'); x.setUTCMonth(x.getUTCMonth() + 1); return x.toISOString().slice(0, 7); };
const hrUser = () => ME.admin || ME.role === 'manager' || String((B.settings || {}).leave_approvers || '').split(',').map(Number).includes(ME.id);
const isMgr = () => ME.admin || ME.role === 'manager';
const pdfLink = (path, label) => `<a class="btn sm ghost" href="${BASE}/api/clinic${path}" target="_blank" rel="noopener">${icon('printer', 15)}${label}</a>`;
const dayCell = d => { const [c, l] = DAYST[d.status] || ['', '']; return `<span class="dc st-${d.status}${d.late ? ' late' : ''}${d.confirmed ? ' conf' : ''}${d.missing_out ? ' miss' : ''}" title="${esc(d.day)} · ${esc(d.label || l)}${d.minutes ? ' · ' + hm(d.minutes) : ''}${d.late ? ' · late' : ''}${d.missing_out ? ' · no clock-out' : ''}">${esc(d.status === 'leave' && d.kind === 'unpaid' ? 'U' : c)}</span>`; };

// Phone: opened from the QR on the clinic desktop.
async function scanScreen(code) {
  const box = (cls, ic, title, sub, extra = '') => { app.innerHTML = `<div class="scan ${cls}"><div class="scan-card">${icon(ic, 54)}<h1>${title}</h1><p>${sub}</p>${extra}</div></div>`; };
  box('wait', 'clock', 'Checking you are at the clinic…', 'Allow location if your phone asks.');
  const pos = await new Promise(res => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(p => res(p.coords), () => res(null), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });
  const r = await fetch(BASE + '/api/clinic/hr/scan', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, lat: pos && pos.latitude, lng: pos && pos.longitude, acc: pos && pos.accuracy }) })
    .then(async x => ({ status: x.status, d: await x.json().catch(() => ({})) })).catch(() => ({ status: 0, d: { error: 'No connection. Try again.' } }));
  const again = `<button class="btn" data-again style="margin-top:18px">${icon('refresh-cw', 18)}Try again</button>`;
  if (r.status === 401) { ME = null; return login('Sign in once on this phone to clock in. After that, this phone will be remembered.'); }
  if (!r.d.ok) {
    box('bad', 'alert-triangle', 'Not recorded', esc(r.d.error || 'Something went wrong.'), r.d.code === 'location' || r.d.code === 'far' || !r.status ? again : `<p class="small" style="margin-top:14px">Scan the QR code on the clinic desktop again.</p>`);
    const a = app.querySelector('[data-again]'); if (a) a.onclick = () => scanScreen(code);
    return;
  }
  const t = fTime(r.d.at.slice(11, 16));
  box(r.d.action === 'in' ? 'good' : 'out', r.d.action === 'in' ? 'check-circle' : 'log-out', r.d.action === 'in' ? `Clocked in at ${t}` : `Clocked out at ${t}`,
    `${esc(r.d.name)}${r.d.late ? ' · <b>late arrival</b>' : ''}`, `<a class="btn ghost" href="#/attendance" data-home style="margin-top:18px">${icon('calendar-check', 18)}My attendance</a>`);
  app.querySelector('[data-home]').onclick = e => { e.preventDefault(); location.hash = '#/attendance'; start(); };
}

async function viewMyAttendance(month) { renderMyAttendance(await api('/clinic/hr/me?month=' + month)); }
function renderMyAttendance(d) {
  const t = today(), td = (d.days || []).find(x => x.day === t);
  const openE = td && td.entries.find(e => !e.out_at);
  MAIN.innerHTML = `<div class="head"><div><h1>My attendance</h1><p>${esc(ME.name)}${d.profile ? ` · ${d.profile.daily_hours} h a day · weekly off ${DOW[d.profile.weekly_off]} · shift from ${esc(fTime(d.profile.shift_start))}` : ''}</p></div>
      <div class="acts"><button class="btn gold" data-apply>${icon('calendar-plus', 18)}Apply for leave</button></div></div>
    <div class="grid2">
      <section class="panel"><div class="panel-h"><div class="t">${icon('clock', 20)}<h3>Today</h3></div></div>
        ${!d.profile ? `<p class="muted">Your attendance has not been set up yet. Ask Sherly or a manager.</p>` : td && td.status === 'off' ? '<p>Weekly off.</p>' : td && td.status === 'holiday' ? `<p>Holiday — ${esc(td.label)}</p>` : td && td.status === 'leave' ? `<p>On ${esc(LEAVE_KIND[td.kind] || 'leave')}.</p>`
          : openE ? `<p class="big-status good">${icon('check-circle', 22)} In since ${esc(tOnly(openE.in_at))}</p><p class="muted">Scan the QR on the clinic desktop again when you finish.</p>`
          : td && td.entries.length ? `<p class="big-status">${icon('log-out', 22)} Out · ${hm(td.minutes)} today</p>` : `<p class="big-status warn">${icon('alert-triangle', 22)} Not clocked in</p><p class="muted">Scan the QR code on the clinic desktop with your phone camera. Your phone must be at the clinic.</p>`}
        ${td && td.entries.length ? `<div class="rows" style="margin-top:8px">${td.entries.map(e => `<div class="row"><div class="grow"><b>${esc(tOnly(e.in_at))} → ${esc(e.out_at ? tOnly(e.out_at) : 'now')}</b></div>${e.source === 'manual' ? '<span class="small muted">added by manager</span>' : ''}</div>`).join('')}</div>` : ''}</section>
      <section class="panel"><div class="panel-h"><div class="t">${icon('calendar-check', 20)}<h3>Leave balance</h3></div></div>
        <div class="kpis small-kpis"><div><span>Annual leave</span><b>${d.balance.annual}</b><small>1 day added each month</small></div>${d.allow.sick ? `<div><span>Sick leave</span><b>${d.balance.sick}</b><small>this year</small></div>` : ''}${d.allow.casual ? `<div><span>Casual leave</span><b>${d.balance.casual}</b><small>this year</small></div>` : ''}</div>
        <p class="small muted" style="margin-top:10px">Leave must be applied for <b>before</b> the day and approved by Dr Akshara. A working day missed without approved leave is an absence: the day's pay is deducted and a warning letter is issued.</p></section>
    </div>
    <section class="panel"><div class="panel-h"><div class="t">${icon('calendar-days', 20)}<h3>${esc(fMonth(d.month))}</h3></div>
      <div style="display:flex;gap:6px"><button class="btn sm ghost icon" data-pm aria-label="Previous month">${icon('chevron-left', 16)}</button><button class="btn sm ghost icon" data-nm aria-label="Next month">${icon('chevron-right', 16)}</button></div></div>
      ${d.summary ? `<p class="muted">Worked ${d.summary.worked_hours} h of ${d.summary.contract_hours} h contract · late ${d.summary.late_days} · absent ${d.summary.absent_days} · leave ${d.summary.paid_leave_days + d.summary.unpaid_leave_days} day(s)</p>
        <div class="table-wrap"><table class="t"><thead><tr><th>Day</th><th>Status</th><th>In</th><th>Out</th><th class="num">Hours</th></tr></thead><tbody>
        ${d.days.filter(x => x.status !== 'upcoming' && x.status !== 'na').reverse().map(x => `<tr><td>${esc(fDay(x.day))} <small class="muted">${DOW[new Date(x.day + 'T00:00:00Z').getUTCDay()].slice(0, 3)}</small></td><td>${dayCell(x)} ${esc(x.status === 'leave' || x.status === 'pending' ? LEAVE_KIND[x.kind] : x.label || DAYST[x.status][1])}${x.late ? ' <span class="pill no_show">Late</span>' : ''}${x.missing_out ? ' <span class="pill no_show">No clock-out</span>' : ''}</td>
          <td>${esc(x.first_in ? fTime(x.first_in) : '—')}</td><td>${esc(x.entries.length && x.entries[x.entries.length - 1].out_at ? tOnly(x.entries[x.entries.length - 1].out_at) : '—')}</td><td class="num">${x.minutes ? hm(x.minutes) : '—'}</td></tr>`).join('')}</tbody></table></div>` : emptyState('clock', 'No attendance set up.')}</section>
    <div class="grid2">
      <section class="panel"><div class="panel-h"><div class="t">${icon('file-text', 20)}<h3>My leave applications</h3></div></div>
        ${d.leave.length ? `<div class="rows">${d.leave.map(l => `<div class="row"><div class="grow"><b>${esc(LEAVE_KIND[l.kind])} · ${esc(fDay(l.from_date))}${l.to_date !== l.from_date ? ' – ' + esc(fDay(l.to_date)) : ''}</b><span>${l.days} day(s) · ${esc(l.reason || '')}${l.decision_note ? ' · ' + esc(l.decision_note) : ''}</span></div>${pill(l.status === 'approved' ? 'final' : l.status === 'pending' ? 'draft' : 'cancelled', l.status[0].toUpperCase() + l.status.slice(1))}${l.status === 'pending' ? `<button class="btn sm quiet" data-cancel="${l.id}">Withdraw</button>` : ''}</div>`).join('')}</div>` : '<p class="muted">None yet.</p>'}</section>
      <section class="panel"><div class="panel-h"><div class="t">${icon('alert-triangle', 20)}<h3>Warnings & payslips</h3></div></div>
        ${d.warnings.length ? `<div class="rows">${d.warnings.map(w => `<div class="row"><div class="grow"><b>${esc(w.letter_no)}</b><span>Absent ${JSON.parse(w.days).map(fDay).join(', ')}</span></div>${pdfLink(`/hr/warnings/${w.id}/pdf`, 'Letter')}</div>`).join('')}</div>` : '<p class="muted">No warnings.</p>'}
        <div data-slips class="rows" style="margin-top:10px"></div></section>
    </div>`;
  MAIN.querySelector('[data-pm]').onclick = () => go('#/attendance?m=' + prevMonth(d.month));
  MAIN.querySelector('[data-nm]').onclick = () => go('#/attendance?m=' + nextMonth(d.month));
  MAIN.querySelector('[data-apply]').onclick = () => leaveModal(d, null, () => route());
  MAIN.querySelectorAll('[data-cancel]').forEach(b => b.onclick = () => busy(b, () => api(`/clinic/hr/leave/${b.dataset.cancel}/cancel`, { method: 'POST', body: {} })).then(() => { toast('Application withdrawn'); route(); }).catch(() => {}));
  api('/clinic/hr/payslips').then(r => { const el = MAIN.querySelector('[data-slips]'); if (el && r.payslips.length) el.innerHTML = r.payslips.map(p => `<div class="row"><div class="grow"><b>Payslip · ${esc(fMonth(p.month))}</b></div>${pdfLink(`/hr/payslip/${p.month}.pdf`, 'PDF')}</div>`).join(''); }).catch(() => {});
}
function leaveModal(d, staff, after) {
  const kinds = [['annual', `Annual leave (paid${d ? ` · ${d.balance.annual} left` : ''})`], ...(d && d.allow.sick || staff ? [['sick', 'Sick leave (paid)']] : []), ...(d && d.allow.casual || staff ? [['casual', 'Casual leave (paid)']] : []), ['unpaid', 'Unpaid leave']];
  modal({ title: staff ? `Leave for ${staff.name}` : 'Apply for leave',
    body: `<form data-f class="stack" style="gap:12px"><div class="grid2">${field('From', inp('from_date', addDays(today(), 1), `type="date" ${staff ? '' : `min="${today()}"`}`))}${field('To', inp('to_date', addDays(today(), 1), 'type="date"'))}</div>
      ${field('Type', sel('kind', kinds, 'annual'))}${field('Reason', inp('reason', '', 'maxlength="300" placeholder="e.g. family function"'))}</form>
      <p class="small muted">${staff ? 'Recorded on their behalf. You can approve it straight away if you are the approver.' : 'Weekly off and clinic holidays are not counted. Dr Akshara will approve or reject it — you will see the decision here.'}</p>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>${staff ? 'Save' : 'Send application'}</button>`,
    onMount(el, close) {
      const s = el.querySelector('[data-save]');
      s.onclick = () => busy(s, () => api('/clinic/hr/leave', { method: 'POST', body: { ...formData(el.querySelector('[data-f]')), ...(staff ? { staff_id: staff.staff_id } : {}) } })).then(r => { close(); toast(`Applied for ${r.days} day(s)`); after(r); }).catch(() => {});
    } });
}

// ---- Staff (managers & leave approver) ----
function staffTabs(tab) {
  const T = [['today', 'Today'], ['month', 'Attendance'], ['leave', 'Leave'], ['absences', 'Absences & warnings'], ...(isMgr() ? [['docs', 'Documents'], ['files', 'Staff files'], ['pay', 'Pay'], ['setup', 'Setup']] : [])];
  return `<nav class="tabs">${T.map(([k, l]) => `<a href="#/staff?tab=${k}" class="${k === tab ? 'on' : ''}" style="text-decoration:none">${l}</a>`).join('')}</nav>`;
}
async function viewStaff(tab, q) {
  if (!hrUser()) { MAIN.innerHTML = emptyState('lock', 'Only managers and the leave approver can see this.'); return; }
  const head = (sub, acts = '') => `<div class="head"><div><h1>Staff</h1><p>${sub}</p></div><div class="acts" style="display:flex;gap:8px;flex-wrap:wrap">${acts}</div></div>${staffTabs(tab)}`;
  if (tab === 'today') {
    const d = await api('/clinic/hr/today');
    const lab = x => x.status === 'in' ? pill('final', 'In') : x.status === 'present' ? pill('billed', 'Finished') : x.status === 'leave' ? pill('package', LEAVE_KIND[x.kind]) : x.status === 'off' ? pill('no_charge', 'Weekly off') : x.status === 'holiday' ? pill('no_charge', 'Holiday') : x.status === 'pending' ? pill('draft', 'Leave pending') : pill('no_show', 'Not in yet');
    MAIN.innerHTML = head(esc(fLong(today()))) + `${d.pending ? `<div class="notice">${icon('info', 18)}<div>${d.pending} leave application(s) waiting for approval. <a href="#/staff?tab=leave">Review</a></div></div>` : ''}
      <section class="panel flush"><div class="table-wrap"><table class="t"><thead><tr><th>Staff</th><th>Status</th><th>Shift</th><th>First in</th><th class="num">Hours today</th></tr></thead><tbody>
      ${d.staff.map(x => `<tr><td><b>${esc(x.name)}</b></td><td>${lab(x)}${x.late ? ' <span class="pill no_show">Late</span>' : ''}</td><td>${esc(fTime(x.shift_start))}</td><td>${esc(x.first_in ? fTime(x.first_in) : '—')}</td><td class="num">${x.minutes ? hm(x.minutes) : '—'}</td></tr>`).join('') || `<tr><td colspan="5">${emptyState('users', 'No staff set up for attendance yet — see Setup.')}</td></tr>`}</tbody></table></div></section>`;
    return;
  }
  if (tab === 'month') {
    const month = q.get('m') || today().slice(0, 7), d = await api('/clinic/hr/month?month=' + month);
    const days = d.staff[0] ? d.staff[0].days.map(x => x.day) : [];
    MAIN.innerHTML = head(`${esc(fMonth(month))}${d.finalised ? ' · pay finalised' : ''}`, `<button class="btn ghost icon" data-pm>${icon('chevron-left', 18)}</button><button class="btn ghost icon" data-nm>${icon('chevron-right', 18)}</button>${isMgr() ? `<button class="btn gold" data-add>${icon('plus', 18)}Add attendance</button>` : ''}`) +
      `<section class="panel flush"><div class="table-wrap"><table class="t attgrid"><thead><tr><th>Staff</th>${days.map(x => `<th class="${x === today() ? 'is-today' : ''}">${+x.slice(8)}<small>${DOW[new Date(x + 'T00:00:00Z').getUTCDay()][0]}</small></th>`).join('')}<th class="num">Worked / contract</th><th class="num">Late</th><th class="num">Absent</th></tr></thead><tbody>
      ${d.staff.map(s => `<tr><td><b>${esc(s.name)}</b>${s.summary.unconfirmed ? `<div class="small" style="color:var(--alert)">${s.summary.unconfirmed} absence(s) to review</div>` : ''}${s.summary.missing_out ? `<div class="small" style="color:var(--alert)">${s.summary.missing_out} missing clock-out</div>` : ''}</td>
        ${s.days.map(x => `<td data-cell="${s.staff_id}|${x.day}">${dayCell(x)}</td>`).join('')}<td class="num">${s.summary.worked_hours} / ${s.summary.contract_hours} h</td><td class="num">${s.summary.late_days}</td><td class="num">${s.summary.absent_days}</td></tr>`).join('') || `<tr><td>${emptyState('users', 'No staff set up for attendance yet.')}</td></tr>`}</tbody></table></div></section>
      <p class="small muted att-legend">${Object.entries({ P: 'present', IN: 'clocked in', L: 'paid leave', U: 'unpaid leave', '?': 'leave pending', A: 'absent', W: 'weekly off', H: 'holiday' }).map(([k, v]) => `<span class="dc st-${({ P: 'present', IN: 'in', L: 'leave', U: 'leave', '?': 'pending', A: 'absent', W: 'off', H: 'holiday' })[k]}">${k}</span> ${v}`).join(' &nbsp; ')} · red outline = late · click a day to see or correct it.</p>`;
    MAIN.querySelector('[data-pm]').onclick = () => go('#/staff?tab=month&m=' + prevMonth(month));
    MAIN.querySelector('[data-nm]').onclick = () => go('#/staff?tab=month&m=' + nextMonth(month));
    const add = MAIN.querySelector('[data-add]'); if (add) add.onclick = () => entryModal(null, { staff: d.staff }, () => route());
    MAIN.querySelectorAll('[data-cell]').forEach(c => c.onclick = () => { const [sid, day] = c.dataset.cell.split('|'); const s = d.staff.find(x => x.staff_id === +sid); dayModal(s, s.days.find(x => x.day === day), d.staff); });
    return;
  }
  if (tab === 'leave') {
    const d = await api('/clinic/hr/leave' + (q.get('s') ? '?status=' + q.get('s') : ''));
    MAIN.innerHTML = head(d.can_decide ? 'You approve leave.' : 'Leave is approved by the leave approver.', `<button class="btn gold" data-onb>${icon('plus', 18)}Record leave for staff</button>`) +
      `<section class="panel flush"><div class="rows">${d.leave.map(l => { const bal = d.balances[l.staff_id]; return `<div class="row"><div class="grow"><b>${esc(l.staff_name)} · ${esc(LEAVE_KIND[l.kind])}</b><span>${esc(fDay(l.from_date))}${l.to_date !== l.from_date ? ' – ' + esc(fDay(l.to_date)) : ''} · ${l.days} day(s) · ${esc(l.reason || '')}</span>
        <span class="small muted">Applied ${esc(fUtc(l.applied_at))}${bal && l.status === 'pending' ? ` · balance: annual ${bal.annual}${bal.sick ? ', sick ' + bal.sick : ''}${bal.casual ? ', casual ' + bal.casual : ''}` : ''}${l.decided_by_name ? ` · ${esc(l.status)} by ${esc(l.decided_by_name)}${l.decision_note ? ': ' + esc(l.decision_note) : ''}` : ''}</span></div>
        ${l.status === 'pending' && d.can_decide ? `<button class="btn sm quiet" data-rej="${l.id}">Reject</button><button class="btn sm" data-ok="${l.id}">${icon('check', 15)}Approve</button>` : pill(l.status === 'approved' ? 'final' : l.status === 'pending' ? 'draft' : 'cancelled', l.status[0].toUpperCase() + l.status.slice(1))}
        ${l.status === 'approved' && d.can_decide && l.from_date >= today() ? `<button class="btn sm quiet" data-cx="${l.id}">Cancel</button>` : ''}</div>`; }).join('') || emptyState('calendar-check', 'No leave applications.')}</div></section>`;
    MAIN.querySelector('[data-onb]').onclick = async () => { const setup = await api('/clinic/hr/month?month=' + today().slice(0, 7)); pickStaff(setup.staff, s => leaveModal(null, s, async r => { if (d.can_decide && confirm('Approve this leave now?')) await api(`/clinic/hr/leave/${r.id}/decide`, { method: 'POST', body: { status: 'approved', note: 'Recorded by ' + ME.name } }); route(); })); };
    MAIN.querySelectorAll('[data-ok]').forEach(b => b.onclick = () => busy(b, () => api(`/clinic/hr/leave/${b.dataset.ok}/decide`, { method: 'POST', body: { status: 'approved' } })).then(() => { toast('Leave approved'); route(); }).catch(() => {}));
    MAIN.querySelectorAll('[data-rej]').forEach(b => b.onclick = () => modal({ title: 'Reject leave', body: `<form data-f>${field('Reason', inp('note', '', 'maxlength="300"'))}</form>`, actions: '<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Reject</button>',
      onMount(el, close) { const s = el.querySelector('[data-save]'); s.onclick = () => busy(s, () => api(`/clinic/hr/leave/${b.dataset.rej}/decide`, { method: 'POST', body: { status: 'rejected', ...formData(el.querySelector('[data-f]')) } })).then(() => { close(); toast('Leave rejected'); route(); }).catch(() => {}); } }));
    MAIN.querySelectorAll('[data-cx]').forEach(b => b.onclick = () => busy(b, () => api(`/clinic/hr/leave/${b.dataset.cx}/cancel`, { method: 'POST', body: {} })).then(() => route()).catch(() => {}));
    return;
  }
  if (tab === 'absences') {
    const m0 = today().slice(0, 7), [a, bb, w] = await Promise.all([api('/clinic/hr/month?month=' + prevMonth(m0)), api('/clinic/hr/month?month=' + m0), api('/clinic/hr/warnings')]);
    const list = [];
    for (const src of [a, bb]) for (const s of src.staff) for (const x of s.days) if (x.status === 'absent' && !x.confirmed) list.push({ ...x, staff_id: s.staff_id, name: s.name, s });
    const by = {}; for (const x of list) (by[x.staff_id] ||= []).push(x);
    MAIN.innerHTML = head('Working days with no attendance and no approved leave') +
      `<section class="panel"><div class="panel-h"><div class="t">${icon('alert-triangle', 20)}<h3>To review</h3></div></div>
      <p class="small muted">If the person was at work but forgot to scan, add their attendance. Otherwise confirm the absence: their pay for the day is deducted and a warning letter is issued.</p>
      ${Object.values(by).map(arr => `<div class="absgroup"><b>${esc(arr[0].name)}</b><div class="rows">${arr.map(x => `<div class="row"><label class="grow" style="display:flex;gap:10px;align-items:center"><input type="checkbox" data-pick="${x.staff_id}" value="${x.day}" checked> ${esc(fLong(x.day))}</label>${isMgr() ? `<button class="btn sm ghost" data-was="${x.staff_id}|${x.day}">Was at work</button>` : ''}</div>`).join('')}</div>
        <button class="btn sm" data-warn="${arr[0].staff_id}" style="margin-top:8px">${icon('file-text', 15)}Confirm absence & issue warning</button></div>`).join('') || emptyState('check-circle', 'Nothing to review.')}</section>
      <section class="panel"><div class="panel-h"><div class="t">${icon('file-text', 20)}<h3>Warning letters</h3></div></div>
      ${w.warnings.length ? `<div class="rows">${w.warnings.map(x => `<div class="row"><div class="grow"><b>${esc(x.letter_no)} · ${esc(x.staff_name)}</b><span>Absent ${JSON.parse(x.days).map(fDay).join(', ')} · issued ${esc(fDate(x.issued_at.slice(0, 10)))} by ${esc(x.issued_by_name)}</span></div>${pdfLink(`/hr/warnings/${x.id}/pdf`, 'Letter')}</div>`).join('')}</div>` : '<p class="muted">None issued.</p>'}</section>`;
    MAIN.querySelectorAll('[data-was]').forEach(b => b.onclick = () => { const [sid, day] = b.dataset.was.split('|'); entryModal(null, { staff: bb.staff, staff_id: +sid, day }, () => route()); });
    MAIN.querySelectorAll('[data-warn]').forEach(b => b.onclick = () => {
      const sid = +b.dataset.warn, days = [...MAIN.querySelectorAll(`[data-pick="${sid}"]:checked`)].map(x => x.value);
      if (!days.length) return toast('Tick the days first');
      modal({ title: 'Issue warning letter', body: `<p>${esc(by[sid][0].name)} · absent ${days.map(fDay).join(', ')}</p><form data-f>${field('Extra note on the letter (optional)', `<textarea class="in" name="note" rows="3" maxlength="600"></textarea>`)}</form><p class="small muted">The day's pay is deducted. The letter is saved as a PDF to print and hand over for signature.</p>`,
        actions: '<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Issue letter</button>',
        onMount(el, close) { const s = el.querySelector('[data-save]'); s.onclick = () => busy(s, () => api('/clinic/hr/absences/confirm', { method: 'POST', body: { staff_id: sid, days, ...formData(el.querySelector('[data-f]')) } })).then(r => { close(); toast('Warning ' + r.letter_no + ' issued'); window.open(`${BASE}/api/clinic/hr/warnings/${r.id}/pdf`, '_blank'); route(); }).catch(() => {}); } });
    });
    return;
  }
  if (tab === 'docs' && isMgr()) return staffDocsTab(head, q);
  if (tab === 'files' && isMgr()) return staffFilesTab(head, q);
  if (tab === 'pay' && isMgr()) {
    const month = q.get('m') || prevMonth(today().slice(0, 7)), d = await api('/clinic/hr/payroll?month=' + month);
    const sum = k => d.rows.reduce((n, r) => n + (r[k] || 0), 0);
    MAIN.innerHTML = head(`${esc(fMonth(month))} · ${d.finalised ? `finalised by ${esc(d.rows[0] ? d.rows[0].finalised_by_name : '')}` : 'draft — changes until finalised'}`,
      `<button class="btn ghost icon" data-pm>${icon('chevron-left', 18)}</button><button class="btn ghost icon" data-nm>${icon('chevron-right', 18)}</button>${pdfLink(`/hr/payroll/${month}.pdf`, 'Pay sheet PDF')}${!d.finalised && month < today().slice(0, 7) ? `<button class="btn gold" data-fin>${icon('lock', 18)}Finalise month</button>` : ''}`) +
      `<section class="panel flush"><div class="table-wrap"><table class="t"><thead><tr><th>Staff</th><th class="num">Salary</th><th class="num">Contract h</th><th class="num">Rate / h</th><th class="num">Worked h</th><th class="num">Paid leave</th><th class="num">Unpaid / absent</th><th class="num">Deductions</th><th class="num">Net pay</th><th></th></tr></thead><tbody>
      ${d.rows.map(r => { const ded = Object.values(r.deductions).reduce((n, v) => n + v, 0); return `<tr><td><b>${esc(r.name)}</b>${r.pending_leave_days || r.missing_out || r.unconfirmed_absences ? `<div class="small" style="color:var(--alert)">${[r.pending_leave_days && r.pending_leave_days + ' leave pending', r.missing_out && r.missing_out + ' no clock-out', r.unconfirmed_absences && r.unconfirmed_absences + ' absence(s) to review'].filter(Boolean).join(' · ')}</div>` : ''}</td>
        <td class="num">${money(r.salary)}</td><td class="num">${r.contract_hours}</td><td class="num">${money(r.rate)}</td><td class="num">${r.worked_hours}</td><td class="num">${r.paid_leave_days}</td><td class="num">${r.unpaid_leave_days} / ${r.absent_days}</td>
        <td class="num" title="${esc(`Absence ${money(r.deductions.absence)} · unpaid leave ${money(r.deductions.unpaid_leave)} · short hours ${money(r.deductions.short_hours)} (${r.short_hours} h)${r.deductions.not_employed ? ' · not yet joined ' + money(r.deductions.not_employed) : ''}`)}">${money(ded)}</td><td class="num"><b>${money(r.net)}</b></td><td>${pdfLink(`/hr/payroll/${month}.pdf?staff=${r.staff_id}`, 'Payslip')}</td></tr>`; }).join('') || `<tr><td colspan="10">${emptyState('wallet', 'No staff with a pay profile — see Setup.')}</td></tr>`}
      ${d.rows.length ? `<tr class="tot"><td>Total</td><td class="num">${money(sum('salary'))}</td><td colspan="6"></td><td class="num"><b>${money(sum('net'))}</b></td><td></td></tr>` : ''}</tbody></table></div></section>
      <p class="small muted">Rate = salary ÷ contract hours (working days × daily hours; weekly off and holidays are paid). Pay = rate × paid hours, where paid hours = hours worked + paid leave, capped at contract hours less absent and unpaid-leave days. No overtime. PF, ESI and TDS are not included.</p>`;
    MAIN.querySelector('[data-pm]').onclick = () => go('#/staff?tab=pay&m=' + prevMonth(month));
    MAIN.querySelector('[data-nm]').onclick = () => go('#/staff?tab=pay&m=' + nextMonth(month));
    const f = MAIN.querySelector('[data-fin]'); if (f) f.onclick = () => { if (confirm(`Finalise pay for ${fMonth(month)}? Figures are then locked and payslips appear for staff.`)) busy(f, () => api('/clinic/hr/payroll/finalise', { method: 'POST', body: { month } })).then(() => { toast('Pay finalised'); route(); }).catch(() => {}); };
    return;
  }
  if (tab === 'setup' && isMgr()) {
    const d = await api('/clinic/hr/setup'), S = B.settings;
    MAIN.innerHTML = head('Pay profiles, clinic location, holidays and the attendance screen') + `
      <section class="panel flush"><div class="panel-h" style="padding:16px 20px 0"><div class="t">${icon('users', 20)}<h3>Staff pay & hours</h3></div></div>
        <div class="table-wrap"><table class="t"><thead><tr><th>Staff</th><th class="num">Monthly salary</th><th class="num">Hours / day</th><th>Weekly off</th><th>Shift starts</th><th>Joined</th><th>Attendance</th><th></th></tr></thead><tbody>
        ${d.staff.map(s => `<tr><td><b>${esc(s.name)}</b><div class="small muted">${esc(s.role)}</div></td><td class="num">${s.staff_id ? money(s.monthly_salary) : '—'}</td><td class="num">${s.staff_id ? s.daily_hours : '—'}</td><td>${s.staff_id ? DOW[s.weekly_off] : '—'}</td><td>${s.staff_id ? esc(fTime(s.shift_start)) : '—'}</td><td>${esc(s.joined_on ? fDate(s.joined_on) : '—')}</td><td>${s.staff_id ? (s.attendance_required ? pill('final', 'Required') : pill('no_charge', 'Not tracked')) : pill('draft', 'Not set up')}</td><td><button class="btn sm ghost" data-edit="${s.id}">${icon('pencil', 15)}${s.staff_id ? 'Edit' : 'Set up'}</button></td></tr>`).join('')}</tbody></table></div>
        <p class="small muted" style="padding:0 20px 16px">Staff who are not in this list need an account first (Settings → Team). Visiting consultants paid per session can be left "not tracked". Staff without clinic access only see My attendance.</p></section>
      <div class="grid2">
      <section class="panel"><div class="panel-h"><div class="t">${icon('activity', 20)}<h3>Clinic location (geofence)</h3></div></div>
        <form data-geo class="stack" style="gap:12px"><div class="grid2">${field('Latitude', inp('geo_lat', S.geo_lat, 'inputmode="decimal"'))}${field('Longitude', inp('geo_lng', S.geo_lng, 'inputmode="decimal"'))}</div>
        <div class="grid2">${field('Radius (metres)', inp('geo_radius_m', S.geo_radius_m || 150, 'type="number" min="30" max="1000"'))}${field('Late after (minutes past shift start)', inp('att_grace_min', S.att_grace_min || 10, 'type="number" min="0" max="120"'))}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn ghost" data-here>${icon('activity', 18)}Use my current location</button><button class="btn" data-savegeo>Save</button></div></form>
        <p class="small muted">Stand inside the clinic with your phone (GPS on) and press "Use my current location", then Save. Clock-in only works within this distance.</p></section>
      <section class="panel"><div class="panel-h"><div class="t">${icon('calendar-check', 20)}<h3>Leave rules</h3></div></div>
        <form data-lv class="stack" style="gap:12px"><div class="grid2">${field('Paid annual leave per month', inp('leave_annual_per_month', S.leave_annual_per_month ?? 1, 'type="number" step="0.5" min="0" max="5"'))}${field('Sick leave per year', inp('leave_sick_per_year', S.leave_sick_per_year ?? 0, 'type="number" min="0" max="30"'))}</div>
        ${field('Casual leave per year', inp('leave_casual_per_year', S.leave_casual_per_year ?? 0, 'type="number" min="0" max="30"'))}
        ${ME.admin ? field('Leave approver(s)', `<div class="checks">${B.team.filter(t => t.active).map(t => `<label><input type="checkbox" name="appr" value="${t.id}"${String(S.leave_approvers || '').split(',').map(Number).includes(t.id) ? ' checked' : ''}> ${esc(t.name)}</label>`).join('')}</div>`) : `<p class="small">Leave approver: <b>${esc(String(S.leave_approvers || '').split(',').map(Number).filter(Boolean).map(staffName).join(', ') || 'admin')}</b></p>`}
        <button class="btn" data-savelv>Save</button></form></section>
      </div>
      <div class="grid2">
      <section class="panel"><div class="panel-h"><div class="t">${icon('calendar-x', 20)}<h3>Clinic holidays</h3></div></div>
        <form data-hol class="grid2" style="align-items:end">${field('Date', inp('day', '', 'type="date"'))}${field('Name', inp('name', '', 'maxlength="80" placeholder="e.g. Thiruvonam"'))}<button class="btn">${icon('plus', 18)}Add</button></form>
        <div class="rows" style="margin-top:10px">${d.holidays.filter(h => h.day >= today().slice(0, 4) + '-01-01').map(h => `<div class="row"><div class="grow"><b>${esc(fDate(h.day))}</b><span>${esc(h.name)}</span></div><button class="btn sm quiet icon" data-delhol="${h.day}" aria-label="Remove">${icon('x', 15)}</button></div>`).join('') || '<p class="muted">None added.</p>'}</div>
        <p class="small muted">Holidays are paid and are not working days.</p></section>
      <section class="panel"><div class="panel-h"><div class="t">${icon('layout-dashboard', 20)}<h3>Attendance screen (clinic desktop)</h3></div></div>
        <p>Open this page on the clinic desktop and press the button there. The desktop then shows a QR code that changes every 30 seconds; staff scan it with their phones.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0"><button class="btn gold" data-kiosk>${icon('layout-dashboard', 18)}Make this computer the attendance screen</button><a class="btn ghost" href="${BASE}/kiosk" target="_blank" rel="noopener">${icon('external-link', 18)}Open attendance screen</a></div>
        <div class="rows">${d.kiosks.filter(k => k.active).map(k => `<div class="row"><div class="grow"><b>${esc(k.name)}</b><span>Set up ${esc(fDate(k.created_at.slice(0, 10)))}${k.last_seen ? ' · last on ' + esc(fUtc(k.last_seen)) : ''}</span></div><button class="btn sm quiet" data-rk="${k.id}">Remove</button></div>`).join('')}</div>
        <h4 style="margin:16px 0 6px">Remembered phones</h4>
        <div class="rows">${d.devices.map(x => `<div class="row"><div class="grow"><b>${esc(x.name)}</b><span class="small muted">${esc((x.agent || '').slice(0, 70))} · since ${esc(fDate(x.created_at.slice(0, 10)))}</span></div><button class="btn sm quiet" data-rd="${x.id}">Forget</button></div>`).join('') || '<p class="muted small">None yet. A phone is remembered after its first signed-in scan.</p>'}</div></section>
      </div>`;
    MAIN.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => staffPayModal(d.staff.find(s => s.id === +b.dataset.edit), () => route()));
    const geo = MAIN.querySelector('[data-geo]');
    MAIN.querySelector('[data-here]').onclick = e => { const btn = e.currentTarget; btn.disabled = true; navigator.geolocation.getCurrentPosition(p => { geo.geo_lat.value = p.coords.latitude.toFixed(6); geo.geo_lng.value = p.coords.longitude.toFixed(6); btn.disabled = false; toast(`Location found (±${Math.round(p.coords.accuracy)} m)`); }, () => { btn.disabled = false; toast('Could not get your location — allow location for this site.'); }, { enableHighAccuracy: true, timeout: 15000 }); };
    geo.onsubmit = e => { e.preventDefault(); busy(MAIN.querySelector('[data-savegeo]'), () => api('/clinic/hr/settings', { method: 'PUT', body: formData(geo) })).then(async () => { toast('Saved'); await refreshBoot(); route(); }).catch(() => {}); };
    const lv = MAIN.querySelector('[data-lv]');
    lv.onsubmit = e => { e.preventDefault(); const body = formData(lv); delete body.appr; if (ME.admin) body.leave_approvers = [...lv.querySelectorAll('[name=appr]:checked')].map(x => x.value).join(','); busy(MAIN.querySelector('[data-savelv]'), () => api('/clinic/hr/settings', { method: 'PUT', body })).then(async () => { toast('Saved'); await refreshBoot(); route(); }).catch(() => {}); };
    const hol = MAIN.querySelector('[data-hol]');
    hol.onsubmit = e => { e.preventDefault(); busy(hol.querySelector('button'), () => api('/clinic/hr/holidays', { method: 'POST', body: formData(hol) })).then(() => route()).catch(() => {}); };
    MAIN.querySelectorAll('[data-delhol]').forEach(b => b.onclick = () => busy(b, () => api('/clinic/hr/holidays/' + b.dataset.delhol, { method: 'DELETE' })).then(() => route()).catch(() => {}));
    MAIN.querySelector('[data-kiosk]').onclick = e => { const name = prompt('Name for this computer', 'Reception desktop'); if (!name) return; busy(e.currentTarget, () => api('/clinic/hr/kiosks', { method: 'POST', body: { name } })).then(() => { toast('This computer is now the attendance screen'); window.open(BASE + '/kiosk', '_blank'); route(); }).catch(() => {}); };
    MAIN.querySelectorAll('[data-rk]').forEach(b => b.onclick = () => confirm('Remove this attendance screen?') && busy(b, () => api(`/clinic/hr/kiosks/${b.dataset.rk}/revoke`, { method: 'POST', body: {} })).then(() => route()).catch(() => {}));
    MAIN.querySelectorAll('[data-rd]').forEach(b => b.onclick = () => busy(b, () => api(`/clinic/hr/devices/${b.dataset.rd}/revoke`, { method: 'POST', body: {} })).then(() => route()).catch(() => {}));
    return;
  }
  go('#/staff?tab=today');
}
function pickStaff(staff, cb) {
  modal({ title: 'Choose staff member', body: `<div class="rows">${staff.map(s => `<button class="row" data-s="${s.staff_id}" style="width:100%;text-align:left;background:none;border:0;cursor:pointer"><b>${esc(s.name)}</b></button>`).join('')}</div>`, actions: '<button class="btn ghost" data-close>Cancel</button>',
    onMount(el, close) { el.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { close(); cb(staff.find(s => s.staff_id === +b.dataset.s)); }); } });
}
function staffPayModal(s, after) {
  const p = s.staff_id ? s : { monthly_salary: '', daily_hours: 8, weekly_off: 0, shift_start: '09:30', attendance_required: 1, leave_opening: 0 };
  modal({ title: `Pay & hours · ${s.name}`, body: `<form data-f class="stack" style="gap:12px">
      <div class="grid2">${field('Monthly salary (₹)', inp('monthly_salary', p.monthly_salary, 'type="number" min="0" step="1"'))}${field('Contract hours per working day', inp('daily_hours', p.daily_hours, 'type="number" min="1" max="16" step="0.5"'))}</div>
      <div class="grid2">${field('Weekly off', sel('weekly_off', DOW.map((d, i) => [i, d]), p.weekly_off))}${field('Shift starts', inp('shift_start', p.shift_start, 'type="time"'))}</div>
      <div class="grid2">${field('Joined on', inp('joined_on', p.joined_on || '', 'type="date"'))}${field('Left on', inp('left_on', p.left_on || '', 'type="date"'), 'leave blank')}</div>
      <div class="grid2">${field('Annual leave balance brought in', inp('leave_opening', p.leave_opening || 0, 'type="number" step="0.5" min="0"'))}${field('Monthly accrual starts', inp('leave_from', (p.leave_from || today()).slice(0, 7), 'type="month"'))}</div>
      <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="attendance_required" ${p.attendance_required ? 'checked' : ''}> Must clock in (uncheck for visiting consultants)</label></form>`,
    actions: '<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Save</button>',
    onMount(el, close) { const sv = el.querySelector('[data-save]'); sv.onclick = () => { const f = el.querySelector('[data-f]'), body = formData(f); body.attendance_required = f.attendance_required.checked; busy(sv, () => api('/clinic/hr/pay/' + s.id, { method: 'PUT', body })).then(() => { close(); toast('Saved'); after(); }).catch(() => {}); }; } });
}
function dayModal(s, x, all) {
  const canEdit = isMgr();
  modal({ title: `${s.name} · ${fLong(x.day)}`, body: `<p>${dayCell(x)} ${esc(x.status === 'leave' || x.status === 'pending' ? LEAVE_KIND[x.kind] + (x.status === 'pending' ? ' (awaiting approval)' : '') : x.label || DAYST[x.status][1])}${x.late ? ' · <b>late</b>' : ''}${x.minutes ? ' · ' + hm(x.minutes) : ''}</p>
      ${x.entries.length ? `<div class="rows">${x.entries.map(e => `<div class="row"><div class="grow"><b>${esc(tOnly(e.in_at))} → ${esc(e.out_at ? tOnly(e.out_at) : (x.day < today() ? 'no clock-out' : 'now'))}</b><span class="small muted">${e.source === 'manual' ? 'added' : 'QR'}${e.in_geo ? ` · ${JSON.parse(e.in_geo).dist} m from clinic` : ''}${e.edited_by_name ? ` · edited by ${esc(e.edited_by_name)}: ${esc(e.edited_reason)}` : ''}</span></div>${canEdit ? `<button class="btn sm ghost" data-e="${e.id}">${icon('pencil', 15)}Edit</button>` : ''}</div>`).join('')}</div>` : '<p class="muted">No attendance recorded.</p>'}
      ${x.status === 'absent' && !x.confirmed ? '<p class="small" style="color:var(--alert)">Unauthorised absence — review it under Absences & warnings.</p>' : ''}`,
    actions: `<button class="btn ghost" data-close>Close</button>${canEdit && x.day <= today() ? `<button class="btn" data-addh>${icon('plus', 16)}Add attendance</button>` : ''}`,
    onMount(el, close) {
      el.querySelectorAll('[data-e]').forEach(b => b.onclick = () => { close(); entryModal(x.entries.find(e => e.id === +b.dataset.e), { staff: all }, () => route()); });
      const a = el.querySelector('[data-addh]'); if (a) a.onclick = () => { close(); entryModal(null, { staff: all, staff_id: s.staff_id, day: x.day }, () => route()); };
    } });
}
function entryModal(e, ctx, after) {
  const day = e ? e.day : ctx.day || today();
  modal({ title: e ? 'Correct attendance' : 'Add attendance', body: `<form data-f class="stack" style="gap:12px">
      ${e ? '' : field('Staff', sel('staff_id', ctx.staff.map(s => [s.staff_id, s.name]), ctx.staff_id))}
      <div class="grid2">${field('Day', inp('day', day, `type="date" max="${today()}"`))}<div></div></div>
      <div class="grid2">${field('In', inp('in_time', e ? e.in_at.slice(11, 16) : '', 'type="time" required'))}${field('Out', inp('out_time', e && e.out_at ? e.out_at.slice(11, 16) : '', 'type="time"'))}</div>
      ${field('Reason', inp('reason', '', 'maxlength="200" placeholder="e.g. forgot to scan out — confirmed by Dr Akshara" required'))}</form><p class="small muted">Recorded in your name with the reason.</p>`,
    actions: `${e ? '<button class="btn quiet" data-del style="margin-right:auto">Delete</button>' : ''}<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Save</button>`,
    onMount(el, close) {
      const s = el.querySelector('[data-save]');
      s.onclick = () => busy(s, () => api('/clinic/hr/attendance' + (e ? '/' + e.id : ''), { method: e ? 'PUT' : 'POST', body: formData(el.querySelector('[data-f]')) })).then(() => { close(); toast('Saved'); after(); }).catch(() => {});
      const d = el.querySelector('[data-del]'); if (d) d.onclick = () => confirm('Delete this entry?') && busy(d, () => api('/clinic/hr/attendance/' + e.id, { method: 'DELETE' })).then(() => { close(); after(); }).catch(() => {});
    } });
}

/* ---------------- Staff documents ----------------
   Everyone: My documents (read and sign memos, notices, policies, training records; see own records).
   Managers: Staff → Documents (issue, track signatures, withdraw, record PDF) and Staff → Staff files. */
const DOCK = { memo: 'Memo', notice: 'Notice', policy: 'Policy', training: 'Training record', record: 'Staff record' };
const fSize = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
const docState = d => !d.requires_ack ? pill('no_charge', 'For information') : d.ack_at ? pill('final', 'Signed') : d.status === 'withdrawn' ? pill('cancelled', 'Withdrawn') : pill('no_show', 'To sign');
async function refreshDocBadge() {
  try {
    const r = await api('/clinic/hr/docs/pending'), n = r.pending;
    const bdg = app.querySelector('[data-db]'); if (bdg) { bdg.hidden = !n; bdg.textContent = n; }
    const bar = app.querySelector('[data-docbar]'); if (!bar) return;
    const onDocs = ['documents', 'doc'].includes(parseHash().parts[0]);
    bar.hidden = !n || onDocs;
    bar.innerHTML = n ? `${icon('file-text', 20)}<div class="grow"><b>${n === 1 ? '1 document' : n + ' documents'} to read and sign</b><span>Issued to you by the clinic management — please read and sign today.</span></div><a class="btn sm" href="#/documents">Open</a>` : '';
  } catch {}
}
async function viewMyDocuments() {
  const d = await api('/clinic/hr/docs/mine');
  const todo = d.docs.filter(x => x.requires_ack && !x.ack_at && x.status === 'issued');
  const row = x => `<a class="row" href="#/doc/${x.id}" style="text-decoration:none;color:inherit"><div class="grow"><b>${esc(x.title)}</b><span>${esc(x.ref_no)} · ${esc(x.kind === 'record' ? x.record_label || 'Staff record' : x.kind_label)} · issued ${esc(fDate(x.issued_at.slice(0, 10)))} by ${esc(x.issued_by_name)}${x.due_date && !x.ack_at ? ` · <b>sign by ${esc(fDate(x.due_date))}</b>` : ''}</span></div>${docState(x)}</a>`;
  MAIN.innerHTML = `<div class="head"><div><h1>My documents</h1><p>Memos, notices, policies and training records issued to you, and your staff records.</p></div></div>
    ${todo.length ? `<section class="panel" style="border:2px solid var(--alert)"><div class="panel-h"><div class="t">${icon('alert-triangle', 20)}<h3 style="color:var(--alert)">To read and sign (${todo.length})</h3></div></div><div class="rows">${todo.map(row).join('')}</div></section>` : ''}
    <section class="panel"><div class="panel-h"><div class="t">${icon('file-text', 20)}<h3>All documents</h3></div></div>
      ${d.docs.filter(x => !todo.includes(x)).length ? `<div class="rows">${d.docs.filter(x => !todo.includes(x)).map(row).join('')}</div>` : '<p class="muted">Nothing yet.</p>'}</section>
    ${d.warnings.length ? `<section class="panel"><div class="panel-h"><div class="t">${icon('alert-triangle', 20)}<h3>Warning letters</h3></div></div><div class="rows">${d.warnings.map(w => `<div class="row"><div class="grow"><b>${esc(w.letter_no)}</b><span>Absent ${JSON.parse(w.days).map(fDay).join(', ')}</span></div>${pdfLink(`/hr/warnings/${w.id}/pdf`, 'Letter')}</div>`).join('')}</div></section>` : ''}`;
  refreshDocBadge();
}
async function viewDoc(id) {
  const r = await api('/clinic/hr/docs/' + id), d = r.doc, mine = r.mine;
  const fileUrl = `${BASE}/api/clinic/hr/docs/${id}/file`;
  const isImg = d.file_type && d.file_type.startsWith('image/');
  const meta = [`${esc(d.ref_no)}`, esc(d.kind === 'record' ? d.record_label || 'Staff record' : d.kind_label), `issued ${esc(fUtc(d.issued_at))} by ${esc(d.issued_by_name)}`].join(' · ');
  const signBox = !mine ? '' : mine.ack_at ? `<div class="notice good">${icon('check-circle', 18)}<div>You signed this on <b>${esc(fUtc(mine.ack_at))}</b> as “${esc(mine.ack_name)}”. ${pdfLink(`/hr/docs/${id}/signed.pdf`, 'My signed copy')}</div></div>`
    : d.status !== 'issued' ? `<div class="notice">${icon('info', 18)}<div>This document was withdrawn: ${esc(d.withdraw_reason || '')}</div></div>`
    : !d.requires_ack ? '' : `<section class="panel signbox"><div class="panel-h"><div class="t">${icon('pencil', 20)}<h3>Sign this document</h3></div></div>
      <form data-sign class="stack" style="gap:12px">
        <label class="agree"><input type="checkbox" name="agree"> I have read and understood this document${d.kind === 'training' ? ' and attended this training' : ''}, and I agree to follow it.</label>
        ${field('Type your full name as your signature', inp('name', '', `autocomplete="off" placeholder="${esc(ME.name)}"`))}
        ${field('Comment (optional)', inp('comment', '', 'maxlength="500"'))}
        <div style="display:flex;justify-content:flex-end"><button class="btn gold" data-go>${icon('check', 18)}Sign</button></div></form>
      <p class="small muted">Your signature is recorded with the date, time and this device, together with a fingerprint of the exact document you signed.</p></section>`;
  MAIN.innerHTML = `<div class="head"><div><a class="small muted" href="${mine && !canMgr() ? '#/documents' : (d.kind === 'record' ? `#/staff?tab=files&s=${d.staff_id}` : '#/staff?tab=docs')}" style="text-decoration:none">← Back</a><h1>${esc(d.title)}</h1><p>${meta}</p></div>
      <div class="acts" style="display:flex;gap:8px;flex-wrap:wrap">${canMgr() ? pdfLink(`/hr/docs/${id}/record.pdf`, 'Acknowledgement record') : ''}${canMgr() && d.status === 'issued' ? `<button class="btn quiet" data-wd>Withdraw</button>` : ''}</div></div>
    ${d.status === 'withdrawn' ? `<div class="notice">${icon('info', 18)}<div>Withdrawn ${esc(fUtc(d.withdrawn_at))}: ${esc(d.withdraw_reason)}</div></div>` : ''}
    ${d.kind === 'training' ? `<div class="notice">${icon('calendar-check', 18)}<div>Training on <b>${esc(fDate(d.training_date))}</b>${d.trainer ? ` · trainer <b>${esc(d.trainer)}</b>` : ''}${d.training_hours ? ` · ${d.training_hours} h` : ''}</div></div>` : ''}
    ${mine && !mine.ack_at && d.due_date && d.requires_ack ? `<div class="notice">${icon('clock', 18)}<div>Please sign by <b>${esc(fDate(d.due_date))}</b>.</div></div>` : ''}
    <section class="panel doc-body">
      ${d.body ? `<div class="doc-text">${esc(d.body).replace(/\n/g, '<br>')}</div>` : ''}
      ${d.has_file ? `<div class="doc-file"><div class="row"><div class="grow"><b>${icon('file-text', 16)} ${esc(d.file_name || 'Attached file')}</b><span>${d.file_size ? fSize(d.file_size) : ''}</span></div><a class="btn sm ghost" href="${fileUrl}" target="_blank" rel="noopener">${icon('external-link', 15)}Open full screen</a></div>
        ${isImg ? `<img src="${fileUrl}" alt="" style="width:100%;border-radius:8px;margin-top:8px">` : `<iframe src="${fileUrl}" title="Document" class="doc-frame"></iframe>`}</div>` : ''}
    </section>
    ${signBox}
    ${r.recipients ? `<section class="panel flush"><div class="panel-h" style="padding:16px 20px 0"><div class="t">${icon('users', 20)}<h3>Signatures · ${r.recipients.filter(x => x.ack_at).length} of ${r.recipients.length}</h3></div></div>
      <div class="table-wrap"><table class="t"><thead><tr><th>Staff</th><th>Opened</th><th>Signed</th><th>Signed as</th><th>Comment</th></tr></thead><tbody>
      ${r.recipients.map(x => `<tr><td><b>${esc(x.name)}</b></td><td>${x.viewed_at ? esc(fUtc(x.viewed_at)) : '<span class="muted">not opened</span>'}</td><td>${x.ack_at ? esc(fUtc(x.ack_at)) : d.requires_ack ? '<b style="color:var(--alert)">Not signed</b>' : '—'}</td><td>${esc(x.ack_name || '')}</td><td class="small">${esc(x.ack_comment || '')}${x.ack_at ? ` ${pdfLink(`/hr/docs/${id}/signed.pdf?staff=${x.staff_id}`, 'Copy')}` : ''}</td></tr>`).join('')}</tbody></table></div></section>` : ''}`;
  const f = MAIN.querySelector('[data-sign]');
  if (f) MAIN.querySelector('[data-go]').onclick = e => { e.preventDefault(); const v = formData(f); busy(e.currentTarget, () => api(`/clinic/hr/docs/${id}/ack`, { method: 'POST', body: { agree: f.agree.checked, name: v.name, comment: v.comment } })).then(() => { toast('Signed — thank you'); refreshDocBadge(); route(); }).catch(() => {}); };
  const wd = MAIN.querySelector('[data-wd]');
  if (wd) wd.onclick = () => modal({ title: 'Withdraw document', body: `<p>Staff will no longer be asked to sign it. Signatures already given stay on record. To correct a document, withdraw it and issue a new one.</p><form data-f>${field('Reason', inp('reason', '', 'maxlength="300"'))}</form>`, actions: '<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Withdraw</button>',
    onMount(el, close) { const s = el.querySelector('[data-save]'); s.onclick = () => busy(s, () => api(`/clinic/hr/docs/${id}/withdraw`, { method: 'POST', body: formData(el.querySelector('[data-f]')) })).then(() => { close(); toast('Withdrawn'); route(); }).catch(() => {}); } });
}
const canMgr = () => ME.admin || ME.role === 'manager';
async function uploadFile(input) {
  const file = input.files && input.files[0]; if (!file) return null;
  if (file.size > 10 * 1024 * 1024) throw new Error('Files can be up to 10 MB.');
  const res = await fetch(`${BASE}/api/clinic/hr/docs/file`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': file.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) }, body: file });
  const d = await res.json(); if (!d.ok) throw new Error(d.error || 'Upload failed.'); return d.file;
}
async function issueDocModal(opts = {}, after) {
  const team = B.team.filter(t => t.active && t.username !== 'hasta');
  const isRec = opts.kind === 'record';
  modal({ title: isRec ? `Add to ${opts.staff_name}'s file` : 'Issue a document', wide: true,
    body: `<form data-f class="stack" style="gap:12px">
      ${isRec ? `<div class="grid2">${field('Record type', sel('record_type', Object.entries(opts.record_types || {}), 'contract'))}${field('Title', inp('title', '', 'maxlength="160" placeholder="e.g. Appointment letter — Staff Nurse"'))}</div>`
      : `<div class="grid2">${field('Type', sel('kind', [['memo', 'Memo'], ['notice', 'Notice'], ['policy', 'Policy'], ['training', 'Training record']], opts.kind || 'memo'))}${field('Title', inp('title', '', 'maxlength="160" placeholder="e.g. Use of the clinic official phone"'))}</div>
        <div class="grid3" data-train hidden>${field('Training date', inp('training_date', today(), 'type="date"'))}${field('Trainer', inp('trainer', '', 'maxlength="80"'))}${field('Hours', inp('training_hours', '', 'type="number" step="0.5" min="0"'))}</div>`}
      ${field(isRec ? 'Notes (optional)' : 'Text (optional if you attach a file)', `<textarea class="in" name="body" rows="${isRec ? 2 : 6}" maxlength="20000"></textarea>`)}
      ${field('Attach file (PDF or image, up to 10 MB)', '<input class="in" type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp" style="padding:8px">')}
      ${isRec ? `<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="requires_ack"> Ask ${esc(opts.staff_name)} to sign it (e.g. appointment letter)</label>`
      : `<div><b class="small">Send to</b><div style="display:flex;gap:16px;margin:6px 0"><label><input type="radio" name="audience" value="all" checked> All staff</label><label><input type="radio" name="audience" value="selected"> Chosen staff</label></div>
        <div class="checks" data-who hidden>${team.map(t => `<label><input type="checkbox" name="who" value="${t.id}"> ${esc(t.name)}</label>`).join('')}</div></div>
        <div class="grid2">${field('Sign by (optional)', inp('due_date', '', 'type="date"'))}<label style="display:flex;gap:8px;align-items:center;margin-top:22px"><input type="checkbox" name="requires_ack" checked> Recipients must sign</label></div>`}
    </form><p class="small muted">${isRec ? 'Kept in the staff file; the staff member can see it in My documents.' : 'Once issued, a document cannot be edited — only withdrawn. Each recipient sees it in My documents and is reminded until they sign.'}</p>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn gold" data-save>${isRec ? 'Save' : 'Issue'}</button>`,
    onMount(el, close) {
      const f = el.querySelector('[data-f]');
      const sync = () => { const t = el.querySelector('[data-train]'); if (t) t.hidden = f.kind.value !== 'training'; const w = el.querySelector('[data-who]'); if (w) w.hidden = f.querySelector('[name=audience]:checked').value !== 'selected'; };
      f.addEventListener('change', sync); sync();
      const s = el.querySelector('[data-save]');
      s.onclick = () => busy(s, async () => {
        const v = formData(f), file = await uploadFile(f.file);
        const body = { kind: isRec ? 'record' : v.kind, title: v.title, body: v.body, file, requires_ack: f.requires_ack.checked };
        if (isRec) Object.assign(body, { staff_id: opts.staff_id, record_type: v.record_type });
        else Object.assign(body, { audience: f.querySelector('[name=audience]:checked').value, staff_ids: [...f.querySelectorAll('[name=who]:checked')].map(x => +x.value), due_date: v.due_date, training_date: v.training_date, trainer: v.trainer, training_hours: v.training_hours });
        return api('/clinic/hr/docs', { method: 'POST', body });
      }).then(r => { close(); toast(isRec ? 'Saved to staff file' : `${r.ref_no} issued to ${r.recipients} staff`); after(r); }).catch(() => {});
    } });
}
async function staffDocsTab(head, q) {
  const kind = q.get('k') || '', d = await api('/clinic/hr/docs' + (kind ? '?kind=' + kind : ''));
  MAIN.innerHTML = head('Memos, notices, policies and training records — issued and signed in the app', `<button class="btn gold" data-issue>${icon('plus', 18)}Issue document</button>`) +
    `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">${[['', 'All'], ['memo', 'Memos'], ['notice', 'Notices'], ['policy', 'Policies'], ['training', 'Training']].map(([k, l]) => `<a class="btn sm ${k === kind ? '' : 'ghost'}" href="#/staff?tab=docs${k ? '&k=' + k : ''}">${l}</a>`).join('')}</div>
    <section class="panel flush"><div class="rows">${d.docs.map(x => { const pct = x.recipients ? Math.round(x.signed / x.recipients * 100) : 0; return `<a class="row" href="#/doc/${x.id}" style="text-decoration:none;color:inherit"><div class="grow"><b>${esc(x.title)}</b><span>${esc(x.ref_no)} · ${esc(x.kind_label)} · ${esc(fDate(x.issued_at.slice(0, 10)))} · ${esc(x.issued_by_name)}${x.due_date ? ' · sign by ' + esc(fDate(x.due_date)) : ''}</span></div>
      ${x.status === 'withdrawn' ? pill('cancelled', 'Withdrawn') : x.requires_ack ? `<div class="sigbar" title="${x.signed} of ${x.recipients} signed"><i style="width:${pct}%"></i><span>${x.signed}/${x.recipients} signed</span></div>` : pill('no_charge', 'Information')}</a>`; }).join('') || emptyState('file-text', 'No documents issued yet.')}</div></section>`;
  MAIN.querySelector('[data-issue]').onclick = () => issueDocModal({}, r => go('#/doc/' + r.id));
}
async function staffFilesTab(head, q) {
  const team = B.team.filter(t => t.username !== 'hasta').sort((a, b) => a.name.localeCompare(b.name));
  const sid = +q.get('s') || (team[0] && team[0].id);
  const f = sid ? await api('/clinic/hr/staff-file/' + sid) : null;
  MAIN.innerHTML = head('Each person\'s records, the documents issued to them, and warning letters') + `<div class="files">
    <nav class="filelist">${team.map(t => `<a href="#/staff?tab=files&s=${t.id}" class="${t.id === sid ? 'on' : ''}">${esc(t.name)}${t.active ? '' : ' <small>(left)</small>'}</a>`).join('')}</nav>
    <div>${f ? `<section class="panel"><div class="panel-h"><div class="t">${icon('user', 20)}<h3>${esc(f.staff.name)} · records</h3></div><button class="btn sm gold" data-add>${icon('plus', 15)}Add record</button></div>
      ${f.records.length ? `<div class="rows">${f.records.map(x => `<a class="row" href="#/doc/${x.id}" style="text-decoration:none;color:inherit"><div class="grow"><b>${esc(x.title)}</b><span>${esc(x.record_label)} · ${esc(x.ref_no)} · added ${esc(fDate(x.issued_at.slice(0, 10)))} by ${esc(x.issued_by_name)}${x.file_name ? ' · ' + esc(x.file_name) : ''}</span></div>${x.status === 'withdrawn' ? pill('cancelled', 'Removed') : x.requires_ack ? '' : ''}</a>`).join('')}</div>` : '<p class="muted">No records yet — add the appointment letter, ID proof, certificates and registration.</p>'}</section>
      <section class="panel"><div class="panel-h"><div class="t">${icon('file-text', 20)}<h3>Documents issued</h3></div></div>
      ${f.issued.length ? `<div class="rows">${f.issued.map(x => `<a class="row" href="#/doc/${x.id}" style="text-decoration:none;color:inherit"><div class="grow"><b>${esc(x.title)}</b><span>${esc(x.ref_no)} · ${esc(x.kind_label)} · ${esc(fDate(x.issued_at.slice(0, 10)))}${x.ack_at ? ' · signed ' + esc(fUtc(x.ack_at)) : x.viewed_at ? ' · opened, not signed' : ' · not opened'}</span></div>${docState(x)}</a>`).join('')}</div>` : '<p class="muted">None.</p>'}</section>
      <section class="panel"><div class="panel-h"><div class="t">${icon('alert-triangle', 20)}<h3>Warning letters</h3></div></div>
      ${f.warnings.length ? `<div class="rows">${f.warnings.map(w => `<div class="row"><div class="grow"><b>${esc(w.letter_no)}</b><span>Absent ${JSON.parse(w.days).map(fDay).join(', ')} · by ${esc(w.issued_by_name)}</span></div>${pdfLink(`/hr/warnings/${w.id}/pdf`, 'Letter')}</div>`).join('')}</div>` : '<p class="muted">None.</p>'}</section>` : emptyState('users', 'No staff.')}</div></div>`;
  const add = MAIN.querySelector('[data-add]');
  if (add) add.onclick = () => issueDocModal({ kind: 'record', staff_id: sid, staff_name: f.staff.name, record_types: f.record_types }, () => route());
}

/* ---------------- Reports ---------------- */
async function viewReports(tab, d, m) {
  const TABS = [['day', 'Day book'], ['month', 'Month summary']];
  MAIN.innerHTML = `<div class="head"><div><h1>Reports</h1></div><div class="acts"><button class="btn ghost" onclick="window.print()">${icon('printer', 18)}Print</button></div></div>
    <nav class="tabs">${TABS.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</nav><div data-body></div>`;
  MAIN.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => go('#/reports?tab=' + b.dataset.tab));
  const body = MAIN.querySelector('[data-body]');
  if (tab === 'day') {
    const r = await api('/clinic/reports/daybook?date=' + (d || today()));
    const t = r.totals;
    body.innerHTML = `<div style="display:flex;gap:8px;align-items:center;margin-bottom:14px" class="noprint">${inp('d', r.date, 'type="date" style="width:auto" data-d')}</div>
      <div class="kpis"><div class="kpi"><div class="l">Invoiced</div><div class="v money">${money(t.invoiced)}</div><div class="s">${r.invoices.filter(i => i.status === 'final').length} invoices</div></div><div class="kpi"><div class="l">Taxable / exempt</div><div class="v money" style="font-size:20px">${money(t.taxable)} / ${money(t.exempt)}</div></div>
        <div class="kpi"><div class="l">GST (CGST + SGST)</div><div class="v money" style="font-size:20px">${money(t.cgst + t.sgst)}</div></div><div class="kpi"><div class="l">Partner charges</div><div class="v money" style="font-size:20px">${money(t.passthrough)}</div></div><div class="kpi"><div class="l">Collected</div><div class="v money">${money(t.collected)}</div><div class="s">${Object.entries(r.by_mode).map(([k, v]) => `${esc(B.modes[k])} ${money(v)}`).join(' · ')}</div></div></div>
      <section class="panel flush" style="margin-bottom:16px"><div class="panel-h" style="padding:16px 20px 0"><h3>Invoices</h3></div>${invoiceTable(r.invoices)}</section>
      <section class="panel flush"><div class="panel-h" style="padding:16px 20px 0"><h3>Payments</h3></div>${r.payments.length ? `<table class="t"><thead><tr><th>Patient</th><th>Mode</th><th>Reference</th><th class="n">Amount</th><th>By</th></tr></thead><tbody>${r.payments.map(p => `<tr${p.voided ? ' style="opacity:.5;text-decoration:line-through"' : ''}><td>${esc(p.patient_name)}</td><td>${esc(B.modes[p.mode])}</td><td class="small">${esc(p.reference || '—')}</td><td class="n money">${money(p.amount)}</td><td class="small">${esc(p.staff_name || '')}</td></tr>`).join('')}</tbody></table>` : emptyState('wallet', 'No payments.')}</section>`;
    body.querySelector('[data-d]').onchange = e => go('#/reports?tab=day&d=' + e.target.value);
    wireInvoiceTable(body);
  } else {
    const r = await api('/clinic/reports/summary?month=' + (m || today().slice(0, 7)));
    const tot = r.gst.reduce((a, x) => ({ v: a.v + x.value, c: a.c + x.cgst, s: a.s + x.sgst }), { v: 0, c: 0, s: 0 });
    body.innerHTML = `<div style="margin-bottom:14px" class="noprint">${inp('m', r.month, 'type="month" style="width:auto" data-m')}</div>
      <div class="grid2" style="align-items:start"><section class="panel flush"><div class="panel-h" style="padding:16px 20px 0"><h3>GST by rate</h3></div><table class="t sumtable"><thead><tr><th>Rate</th><th class="n">Value</th><th class="n">CGST</th><th class="n">SGST</th></tr></thead><tbody>
        ${r.gst.map(x => `<tr><td>${x.rate ? x.rate + '%' : 'Exempt / nil'}</td><td class="n">${money(x.value)}</td><td class="n">${money(x.cgst)}</td><td class="n">${money(x.sgst)}</td></tr>`).join('')}<tr><td><b>Total</b></td><td class="n"><b>${money(tot.v)}</b></td><td class="n"><b>${money(tot.c)}</b></td><td class="n"><b>${money(tot.s)}</b></td></tr></tbody></table>
        <p class="small muted" style="padding:10px 20px">Partner charges collected (not revenue, no GST): ${money(r.passthrough)}</p></section>
      <section class="panel flush"><div class="panel-h" style="padding:16px 20px 0"><h3>Revenue by department</h3></div><table class="t sumtable"><thead><tr><th>Department</th><th class="n">Lines</th><th class="n">Net (excl. GST)</th></tr></thead><tbody>${r.departments.map(x => `<tr><td>${esc(x.dept)}</td><td class="n">${x.n}</td><td class="n">${money(x.net)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No sales.</td></tr>'}</tbody></table></section>
      <section class="panel flush"><div class="panel-h" style="padding:16px 20px 0"><h3>Collections by mode</h3></div><table class="t sumtable"><tbody>${r.modes.map(x => `<tr><td>${esc(B.modes[x.mode])}</td><td class="n">${x.n}</td><td class="n">${money(x.s)}</td></tr>`).join('') || '<tr><td class="muted">None.</td></tr>'}</tbody></table></section>
      <section class="panel flush"><div class="panel-h" style="padding:16px 20px 0"><h3>Discounts given</h3></div><table class="t sumtable"><thead><tr><th>Authorised by</th><th class="n">Lines</th><th class="n">Amount</th></tr></thead><tbody>${r.discounts.map(x => `<tr><td>${esc(x.who)}</td><td class="n">${x.n}</td><td class="n">${money(x.s)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">None.</td></tr>'}</tbody></table></section></div>`;
    body.querySelector('[data-m]').onchange = e => go('#/reports?tab=month&m=' + e.target.value);
  }
}

/* ---------------- Settings ---------------- */
async function viewSettings(tab) {
  const TABS = isAdmin() ? [['clinic', 'Clinic details'], ['catalogue', 'Catalogue'], ['packages', 'Packages'], ['places', 'Departments & rooms'], ['team', 'Team'], ['account', 'Your account']] : [['account', 'Your account']];
  MAIN.innerHTML = `<div class="head"><div><h1>Settings</h1></div></div><nav class="tabs">${TABS.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</nav><div data-body></div>`;
  MAIN.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => go('#/settings?tab=' + b.dataset.tab));
  const body = MAIN.querySelector('[data-body]');
  const reload = async () => { await refreshBoot(); route(); };
  if (tab === 'account' || !isAdmin()) {
    body.innerHTML = `<section class="panel" style="max-width:520px"><h3>Change your password</h3><form data-f class="stack" style="gap:12px;margin-top:12px">${field('Current password', inp('current', '', 'type="password" autocomplete="current-password"'))}${field('New password', inp('next', '', 'type="password" autocomplete="new-password"'), 'at least 8 characters')}</form><button class="btn" data-save style="margin-top:12px">Change password</button></section>`;
    const s = body.querySelector('[data-save]'); s.onclick = () => busy(s, () => api('/me/secret', { method: 'POST', body: formData(body.querySelector('[data-f]')) })).then(() => toast('Password changed')).catch(() => {});
  } else if (tab === 'clinic') {
    const v = B.settings;
    body.innerHTML = `<section class="panel" style="max-width:860px"><form data-f class="stack" style="gap:14px">
      <div class="grid2">${field('Legal name', inp('legal_name', v.legal_name))}${field('Trading name', inp('trade_name', v.trade_name))}</div>
      <div class="grid3">${field('GSTIN', inp('gstin', v.gstin, 'maxlength="15" placeholder="32XXXXX0000X1Z5" style="text-transform:uppercase"'))}${field('State', inp('state', v.state))}${field('Invoice prefix', inp('invoice_prefix', v.invoice_prefix, 'maxlength="8"'), `e.g. ${esc(v.invoice_prefix || 'HW')}/25-26/0001`)}</div>
      ${field('Address on invoices', inp('address', v.address, 'maxlength="300"'))}
      <div class="grid3">${field('Phone', inp('phone', v.phone))}${field('Email', inp('email', v.email))}${field('Discount without authorisation (%)', inp('discount_limit_pct', v.discount_limit_pct, 'type="number" min="0" max="100"'), 'higher needs an approver')}</div>
      <div><h4 style="margin-bottom:4px">Who can approve discounts above the limit</h4><p class="small muted" style="margin-bottom:8px">If nobody is ticked, any doctor or admin can approve.</p><div class="chips">${B.team.filter(t => t.active && t.apps.includes('clinic')).map(t => `<label class="chip"><input type="checkbox" data-appr="${t.id}" ${approvers().includes(t.id) ? 'checked' : ''}>${esc(t.name)}</label>`).join('')}</div></div>
      ${field('Invoice footer', inp('invoice_footer', v.invoice_footer, 'maxlength="300"'))}</form><button class="btn" data-save style="margin-top:14px">Save</button></section>`;
    const s = body.querySelector('[data-save]'); s.onclick = () => busy(s, () => api('/clinic/settings', { method: 'PUT', body: { ...formData(body.querySelector('[data-f]')), discount_approvers: [...body.querySelectorAll('[data-appr]:checked')].map(x => x.dataset.appr).join(',') } })).then(() => { toast('Saved'); reload(); }).catch(() => {});
  } else if (tab === 'catalogue') await settingsCatalogue(body, reload);
  else if (tab === 'packages') await settingsPackages(body, reload);
  else if (tab === 'places') settingsPlaces(body, reload);
  else if (tab === 'team') settingsTeam(body, reload);
}
async function settingsCatalogue(body, reload) {
  const { items } = await api('/clinic/catalogue?all=1');
  let q = '', dp = '';
  body.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px"><input class="in" data-q placeholder="Search name, code, category" style="max-width:320px">${sel('dp', [['', 'All departments'], ...B.departments.map(d => [d.id, d.name])], '', 'data-dp style="width:auto"')}
      <span style="flex:1"></span><button class="btn ghost" data-imp>${icon('upload', 18)}Import Item Master</button><button class="btn gold" data-add>${icon('plus', 18)}Add item</button></div>
    <p class="small muted" style="margin-bottom:10px">${items.length} items · prices exclude GST · dental services are normally exempt (0%).</p><section class="panel flush" data-list></section>`;
  const draw = () => {
    const ws = q.toLowerCase().split(/\s+/).filter(Boolean);
    const list = items.filter(i => (!dp || i.dept_id === +dp) && ws.every(w => (i.name + ' ' + (i.code || '') + ' ' + (i.category || '')).toLowerCase().includes(w))).slice(0, 300);
    body.querySelector('[data-list]').innerHTML = list.length ? `<table class="t"><thead><tr><th>Item</th><th>Department</th><th>Type</th><th class="n">Price</th><th class="n">GST</th><th>HSN/SAC</th><th class="n">Chair min</th></tr></thead><tbody>
      ${list.map(i => `<tr data-id="${i.id}" style="cursor:pointer${i.active ? '' : ';opacity:.5'}"><td><b>${esc(i.name)}</b><div class="small muted">${esc(i.code || '')}${i.category ? ' · ' + esc(i.category) : ''}</div></td><td>${deptTag(i.dept_id)}</td><td class="small">${i.kind === 'passthrough' ? 'Partner charge' : i.kind === 'product' ? 'Product' : 'Service'}${i.sellable ? '' : '<div class="small muted">internal use</div>'}</td><td class="n money">${i.price > 0 ? money(i.price) : 'varies'}</td><td class="n">${i.kind === 'passthrough' ? 'n/a' : i.gst_rate ? i.gst_rate + '%' : 'Exempt'}</td><td class="small">${esc(i.hsn_sac || '')}</td><td class="n">${i.chair_minutes ?? ''}</td></tr>`).join('')}</tbody></table>${list.length === 300 ? '<p class="small muted" style="padding:10px 16px">Showing the first 300 — search to narrow.</p>' : ''}`
      : emptyState('list-checks', items.length ? 'No items match.' : 'No items yet. Import the Item Master or add items.');
    body.querySelectorAll('tr[data-id]').forEach(r => r.onclick = () => itemModal(items.find(i => i.id === +r.dataset.id), reload));
  };
  body.querySelector('[data-q]').oninput = e => { q = e.target.value; draw(); };
  body.querySelector('[data-dp]').onchange = e => { dp = e.target.value; draw(); };
  body.querySelector('[data-add]').onclick = () => itemModal({}, reload);
  body.querySelector('[data-imp]').onclick = () => importModal(reload);
  draw();
}
function itemModal(i, reload) {
  modal({ title: i.id ? 'Edit item' : 'Add item', wide: true,
    body: `<form data-f class="stack" style="gap:14px"><div class="grid2">${field('Name', inp('name', i.name, 'maxlength="160"'))}${field('Code / SKU', inp('code', i.code, 'maxlength="40"'), 'optional')}</div>
      <div class="grid3">${field('Department', sel('dept_id', [['', '—'], ...B.departments.map(d => [d.id, d.name])], i.dept_id))}${field('Category', inp('category', i.category, 'maxlength="80"'))}${field('Type', sel('kind', [['service', 'Service'], ['product', 'Product'], ['passthrough', 'Partner charge (pass-through)']], i.kind))}</div>
      <div class="grid3">${field('Price excl. GST (₹)', inp('price', i.price ?? '', 'type="number" min="0" step="0.01"'), '0 = varies, entered on the bill')}${field('GST rate', sel('gst_rate', [[0, '0% / exempt'], [5, '5%'], [12, '12%'], [18, '18%'], [28, '28%']], i.gst_rate ?? 18))}${field('HSN / SAC', inp('hsn_sac', i.hsn_sac, 'maxlength="12"'))}</div>
      <div class="grid3">${field('Chair time (minutes)', inp('chair_minutes', i.chair_minutes ?? '', 'type="number" min="0" max="600"'))}${field('Standard cost (₹)', inp('cost', i.cost ?? '', 'type="number" min="0" step="0.01"'), 'optional')}${field('Partner (pass-through)', inp('partner', i.partner, 'maxlength="80"'))}</div>
      <div class="grid3">${field('Unit', inp('unit', i.unit, 'maxlength="20"'))}${field('MRP incl. GST (₹)', inp('mrp', i.mrp ?? '', 'type="number" min="0" step="0.01"'))}<label class="check" style="align-self:end"><input type="checkbox" name="sellable" ${i.sellable === 0 ? '' : 'checked'}> Can be billed (untick for internal use)</label></div>
      ${field('Internal notes', inp('notes', i.notes, 'maxlength="500"'), 'not printed')}
      ${i.id ? `<label class="check"><input type="checkbox" name="active" ${i.active ? 'checked' : ''}> Active (available for billing)</label>` : ''}</form>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Save</button>`,
    onMount(el, close) { const s = el.querySelector('[data-save]'); s.onclick = () => { const v = formData(el.querySelector('[data-f]')); if (!i.id) v.active = true; busy(s, () => api('/clinic/catalogue' + (i.id ? '/' + i.id : ''), { method: i.id ? 'PUT' : 'POST', body: v })).then(() => { close(); toast('Saved'); reload(); }).catch(() => {}); }; } });
}
function loadXlsx() {
  if (window.XLSX && window.XLSX.read) return Promise.resolve(window.XLSX);
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = '/clinic/vendor/xlsx.mini.min.js'; s.onload = () => res(window.XLSX); s.onerror = () => rej(new Error('Could not load the spreadsheet reader.')); document.head.appendChild(s); });
}
const FIELDS = [['name', 'Item name', /^((item|service|product|clinical) ?)?name$|^(service|description|item)$/i], ['code', 'Code / SKU', /^(sku|item ?code|item ?id|service ?id|product ?id)$/i], ['dept', 'Department', /dep(ar)?t/i], ['category', 'Category', /categ|group/i],
  ['kind', 'Type (service/goods)', /^(type|item ?type|product ?type|kind|goods ?\/ ?service)$/i], ['price', 'Price excl. GST', /(selling ?)?(rate|price)|amount/i, /selling/i], ['gst_rate', 'GST rate', /gst|tax ?rate|intra/i, /rate/i], ['hsn_sac', 'HSN / SAC', /hsn|sac/i],
  ['chair_minutes', 'Chair time (min)', /chair|minutes|duration/i], ['cost', 'Cost', /cost|purchase/i], ['unit', 'Unit', /^unit$|uom/i], ['mrp', 'MRP (incl. GST)', /^mrp$/i], ['sellable', 'Sales account / for sale', /sales ?account|for sale|sellable/i], ['partner', 'Partner (pass-through)', /partner/i], ['active', 'Active (Yes/No)', /^(active|status|enabled)$/i], ['notes', 'Notes', /internal ?notes|^notes?$|remarks/i]];
function importModal(reload) {
  let rows = [], headers = [];
  modal({ title: 'Import the Item Master', wide: true,
    body: `<div class="stack" style="gap:14px"><p class="muted">Choose the workbook (.xlsx) or a CSV. You then match its columns to the catalogue fields. Existing items are updated by code (or by name and department), new ones added.</p>
      <input class="in" type="file" accept=".xlsx,.xls,.csv" data-file><div data-sheet></div><div data-map></div><div data-prev></div></div>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn gold" data-go disabled>${icon('upload', 18)}Import</button>`,
    onMount(el, close) {
      const goBtn = el.querySelector('[data-go]');
      let wb;
      const useSheet = name => {
        const XL = window.XLSX, ws = wb.Sheets[name];
        const aoa = XL.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
        const hi = aoa.findIndex(r => r.filter(c => String(c).trim()).length >= 3);
        headers = (aoa[hi] || []).map(h => String(h).trim());
        rows = aoa.slice(hi + 1).filter(r => r.some(c => String(c).trim()));
        el.querySelector('[data-map]').innerHTML = `<h4 style="margin-bottom:8px">Match columns (${rows.length} rows)</h4><div class="map-grid">${FIELDS.map(([k, l, re, pref]) => { let guess = pref ? headers.findIndex(h => pref.test(h)) : -1; if (guess < 0) guess = headers.findIndex(h => re.test(h)); return field(l, `<select class="in" data-f="${k}"><option value="-1">— not in file —</option>${headers.map((h, i) => `<option value="${i}"${i === guess ? ' selected' : ''}>${esc(h || 'Column ' + (i + 1))}</option>`).join('')}</select>`); }).join('')}</div>`;
        const prev = () => { const m = mapping(); el.querySelector('[data-prev]').innerHTML = `<h4 style="margin:6px 0 8px">Preview</h4><div class="preview"><table class="t"><thead><tr>${FIELDS.map(([, l]) => `<th>${esc(l)}</th>`).join('')}</tr></thead><tbody>${rows.slice(0, 6).map(r => `<tr>${FIELDS.map(([k]) => `<td>${esc(m[k] >= 0 ? r[m[k]] : '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; goBtn.disabled = m.name < 0; };
        el.querySelectorAll('[data-f]').forEach(s => s.onchange = prev); prev();
      };
      const mapping = () => Object.fromEntries([...el.querySelectorAll('[data-f]')].map(s => [s.dataset.f, +s.value]));
      el.querySelector('[data-file]').onchange = async e => {
        const file = e.target.files[0]; if (!file) return;
        try { const XL = await loadXlsx(); wb = XL.read(await file.arrayBuffer(), { type: 'array' }); }
        catch (err) { return toast('Could not read that file: ' + err.message, true); }
        const names = wb.SheetNames;
        el.querySelector('[data-sheet]').innerHTML = names.length > 1 ? field('Sheet', `<select class="in" data-sh>${names.map(n => `<option>${esc(n)}</option>`).join('')}</select>`) : '';
        el.querySelector('[data-sh]') && (el.querySelector('[data-sh]').onchange = ev => useSheet(ev.target.value));
        useSheet(names[0]);
      };
      goBtn.onclick = () => busy(goBtn, async () => {
        const m = mapping(), out = rows.map(r => Object.fromEntries(FIELDS.map(([k]) => [k, m[k] >= 0 ? r[m[k]] : '']))).filter(x => String(x.name).trim());
        let added = 0, updated = 0, errors = [];
        for (let i = 0; i < out.length; i += 200) { goBtn.textContent = `Importing ${Math.min(i + 200, out.length)} / ${out.length}…`; const r = await api('/clinic/catalogue/import', { method: 'POST', body: { rows: out.slice(i, i + 200), offset: i } }); added += r.added; updated += r.updated; errors = errors.concat(r.errors); }
        return { added, updated, errors };
      }).then(r => { close(); modal({ title: 'Import finished', body: `<p><b>${r.added}</b> added, <b>${r.updated}</b> updated${r.errors.length ? `, <b>${r.errors.length}</b> skipped` : ''}.</p>${r.errors.length ? `<div class="preview" style="padding:10px"><div class="small">${r.errors.map(esc).join('<br>')}</div></div>` : ''}`, actions: '<button class="btn" data-close>Done</button>' }); reload(); }).catch(() => {});
    } });
}
async function settingsPackages(body, reload) {
  await catalogue();
  body.innerHTML = `<div style="display:flex;justify-content:flex-end;margin-bottom:14px"><button class="btn gold" data-add>${icon('plus', 18)}Build a package</button></div>
    <section class="panel flush">${B.packages.length ? `<table class="t"><thead><tr><th>Package</th><th>Includes</th><th class="n">List value</th><th class="n">Discount</th><th class="n">Price (excl. GST)</th><th class="n">Valid</th></tr></thead><tbody>
      ${B.packages.map(p => `<tr data-id="${p.id}" style="cursor:pointer${p.active ? '' : ';opacity:.5'}"><td><b>${esc(p.name)}</b><div>${deptTag(p.dept_id)}</div></td><td class="small">${p.items.map(x => `${esc(x.name)} × ${x.qty}`).join('<br>')}</td><td class="n money">${money(p.list_value)}</td><td class="n">${p.discount_pct}%</td><td class="n money"><b>${money(p.price)}</b></td><td class="n">${p.validity_days} days</td></tr>`).join('')}</tbody></table>` : emptyState('package', 'No packages yet.')}</section>
    <p class="small muted" style="margin-top:10px">Package price = list value of its services − package discount. GST on a package is split across its services by value, so exempt dental services stay exempt. Changing a package does not change packages already sold.</p>`;
  body.querySelector('[data-add]').onclick = () => packageModal({}, reload);
  body.querySelectorAll('tr[data-id]').forEach(r => r.onclick = () => packageModal(B.packages.find(p => p.id === +r.dataset.id), reload));
}
function packageModal(p, reload) {
  let items = (p.items || []).map(x => ({ item_id: x.item_id, qty: x.qty }));
  modal({ title: p.id ? 'Edit package' : 'Build a package', wide: true,
    body: `<form data-f class="stack" style="gap:14px"><div class="grid2">${field('Package name', inp('name', p.name, 'maxlength="120" placeholder="e.g. Laser hair reduction — full face × 6"'))}${field('Department', sel('dept_id', [['', '—'], ...B.departments.map(d => [d.id, d.name])], p.dept_id))}</div>
      <div data-ip></div><table class="t"><thead><tr><th>Service</th><th class="n">List price</th><th class="n">Qty</th><th class="n">Value</th><th></th></tr></thead><tbody data-rows></tbody></table>
      <div class="grid3">${field('Package discount (%)', inp('discount_pct', p.discount_pct ?? 10, 'type="number" min="0" max="60" step="0.5"'))}${field('Valid for (days)', inp('validity_days', p.validity_days ?? 180, 'type="number" min="1" max="1095"'))}<div data-price class="f"></div></div>
      ${p.id ? `<label class="check"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> On sale</label>` : ''}</form>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Save package</button>`,
    onMount(el, close) {
      const f = el.querySelector('[data-f]');
      const draw = () => {
        el.querySelector('[data-rows]').innerHTML = items.map((x, i) => { const it = CAT.find(c => c.id === x.item_id) || {}; return `<tr><td>${esc(it.name || '?')}<div class="small muted">${it.gst_rate ? it.gst_rate + '% GST' : 'exempt'}</div></td><td class="n money">${money(it.price)}</td><td class="n"><input class="in qty" type="number" min="1" max="100" value="${x.qty}" data-q="${i}" style="width:70px;margin-left:auto"></td><td class="n money">${money(it.price * x.qty)}</td><td><button type="button" class="btn quiet sm icon" data-rm="${i}">${icon('x', 14)}</button></td></tr>`; }).join('') || '<tr><td colspan="5" class="muted">Add services above.</td></tr>';
        const list = items.reduce((s, x) => s + (CAT.find(c => c.id === x.item_id)?.price || 0) * x.qty, 0), disc = Number(f.discount_pct.value) || 0;
        el.querySelector('[data-price]').innerHTML = `<span>Package price</span><div style="font-family:Manrope;font-weight:700;font-size:22px;color:var(--teal-ink);margin-top:6px">${money(Math.round(list * (1 - disc / 100)))}</div><small>list ${money(list)} − ${disc}%</small>`;
        el.querySelectorAll('[data-q]').forEach(q => q.onchange = () => { items[+q.dataset.q].qty = Math.max(1, parseInt(q.value, 10) || 1); draw(); });
        el.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { items.splice(+b.dataset.rm, 1); draw(); });
      };
      itemPicker(el.querySelector('[data-ip]'), it => { if (it.kind === 'passthrough') return toast('Partner charges cannot be in a package.', true); const ex = items.find(x => x.item_id === it.id); if (ex) ex.qty++; else items.push({ item_id: it.id, qty: 1 }); draw(); }, { placeholder: 'Add a service to the package' });
      f.discount_pct.oninput = draw; draw();
      const s = el.querySelector('[data-save]');
      s.onclick = () => { const v = formData(f); busy(s, () => api('/clinic/packages' + (p.id ? '/' + p.id : ''), { method: p.id ? 'PUT' : 'POST', body: { ...v, items, active: p.id ? v.active : true } })).then(() => { close(); toast('Package saved'); reload(); }).catch(() => {}); };
    } });
}
function settingsPlaces(body, reload) {
  body.innerHTML = `<div class="grid2" style="align-items:start"><section class="panel flush"><div class="panel-h" style="padding:16px 20px 0"><h3>Departments</h3><button class="btn sm gold" data-adept>${icon('plus', 16)}Add</button></div><div class="rows">
      ${B.departments.map(d => `<div class="row click" data-dept="${d.id}" style="cursor:pointer${d.active ? '' : ';opacity:.5'}"><span class="dept" style="--c:${esc(d.colour)}">${esc(d.name)}</span></div>`).join('')}</div></section>
    <section class="panel flush"><div class="panel-h" style="padding:16px 20px 0"><h3>Rooms and chairs</h3><button class="btn sm gold" data-aroom>${icon('plus', 16)}Add</button></div><div class="rows">
      ${B.rooms.map(r => `<div class="row click" data-room="${r.id}" style="cursor:pointer${r.active ? '' : ';opacity:.5'}"><div class="grow"><b>${esc(r.name)}</b><span>${esc((dept(r.dept_id) || {}).name || 'Any department')}</span></div></div>`).join('') || emptyState('home', 'No rooms yet.')}</div></section></div>`;
  const deptModal = (d = {}) => modal({ title: d.id ? 'Edit department' : 'Add department', body: `<form data-f class="stack" style="gap:12px">${field('Name', inp('name', d.name))}${field('Colour', inp('colour', d.colour || '#34595e', 'type="color" style="height:40px"'))}${d.id ? `<label class="check"><input type="checkbox" name="active" ${d.active ? 'checked' : ''}> Active</label>` : ''}</form>`,
    actions: '<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Save</button>', onMount(el, close) { const s = el.querySelector('[data-save]'); s.onclick = () => { const v = formData(el.querySelector('[data-f]')); busy(s, () => api('/clinic/departments', { method: 'POST', body: { ...v, id: d.id, active: d.id ? v.active : true } })).then(() => { close(); reload(); }).catch(() => {}); }; } });
  const roomModal = (r = {}) => modal({ title: r.id ? 'Edit room' : 'Add room or chair', body: `<form data-f class="stack" style="gap:12px">${field('Name', inp('name', r.name, 'placeholder="e.g. Dental chair 1, Laser room"'))}${field('Department', sel('dept_id', [['', 'Any'], ...B.departments.map(d => [d.id, d.name])], r.dept_id))}${r.id ? `<label class="check"><input type="checkbox" name="active" ${r.active ? 'checked' : ''}> Active</label>` : ''}</form>`,
    actions: '<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Save</button>', onMount(el, close) { const s = el.querySelector('[data-save]'); s.onclick = () => { const v = formData(el.querySelector('[data-f]')); busy(s, () => api('/clinic/rooms', { method: 'POST', body: { ...v, id: r.id, active: r.id ? v.active : true } })).then(() => { close(); reload(); }).catch(() => {}); }; } });
  body.querySelector('[data-adept]').onclick = () => deptModal();
  body.querySelector('[data-aroom]').onclick = () => roomModal();
  body.querySelectorAll('[data-dept]').forEach(x => x.onclick = () => deptModal(B.departments.find(d => d.id === +x.dataset.dept)));
  body.querySelectorAll('[data-room]').forEach(x => x.onclick = () => roomModal(B.rooms.find(r => r.id === +x.dataset.room)));
}
const SK = { doctor: 'Doctor', coach: 'Wellness coach', nurse: 'Nurse', dental_assistant: 'Dental assistant', front: 'Front desk', trainer: 'EMS trainer', medical_lead: 'Medical lead' };
function settingsTeam(body, reload) {
  body.innerHTML = `<div style="display:flex;justify-content:flex-end;margin-bottom:14px"><button class="btn gold" data-add>${icon('user-plus', 18)}Add team member</button></div>
    <section class="panel flush"><div class="rows">${B.team.map(t => `<div class="row click" data-id="${t.id}" style="cursor:pointer${t.active ? '' : ';opacity:.5'}"><span class="avatar">${esc(initials(t.name))}</span><div class="grow"><b>${esc(t.name)}</b><span>${esc(t.username)} · ${esc(t.skills.map(s => SK[s] || s).join(', ') || 'no skills')}${t.depts.length ? ' · works in ' + esc(t.depts.map(x => (dept(x) || {}).name).join(', ')) : ''}</span></div>
      ${t.apps.includes('clinic') || t.role === 'admin' ? pill('active', 'Clinic') : pill('closed', 'No clinic access')}${t.apps.includes('ems') ? pill('booked', 'EMS') : ''}</div>`).join('')}</div></section>
    <p class="small muted" style="margin-top:10px">Clinicians only appear in the calendar for the departments ticked here. The same login works in the EMS app if EMS is ticked.</p>`;
  body.querySelector('[data-add]').onclick = () => memberModal({ apps: ['clinic'], skills: [], depts: [], role: 'staff', active: true }, reload);
  body.querySelectorAll('[data-id]').forEach(r => r.onclick = () => memberModal(B.team.find(t => t.id === +r.dataset.id), reload));
}
function memberModal(t, reload) {
  const isNew = !t.id;
  modal({ title: isNew ? 'Add team member' : 'Edit · ' + t.name, wide: true,
    body: `<form data-f class="stack" style="gap:14px"><div class="grid3">${field('Name', inp('name', t.name))}${field('Username', inp('username', t.username, isNew ? 'autocapitalize="none"' : 'disabled'))}${field(isNew ? 'Password' : 'New password', inp('password', '', 'type="password" autocomplete="new-password"'), isNew ? 'at least 8 characters' : 'leave blank to keep')}</div>
      <div class="grid2">${field('Role', sel('role', [['staff', 'Team'], ['manager', 'Manager — can cancel invoices, void payments, deposits'], ['admin', 'Admin — everything incl. settings']], t.role))}${field('Registration no.', inp('reg_no', t.reg_no, 'placeholder="for doctors"'))}</div>
      <div><h4 style="margin-bottom:8px">Apps</h4><div class="chips"><label class="chip"><input type="checkbox" name="app.clinic" ${t.apps.includes('clinic') ? 'checked' : ''}>Clinic app</label><label class="chip"><input type="checkbox" name="app.ems" ${t.apps.includes('ems') ? 'checked' : ''}>EMS app</label></div></div>
      <div><h4 style="margin-bottom:8px">Skills</h4><div class="chips">${Object.entries(SK).map(([k, l]) => `<label class="chip"><input type="checkbox" name="sk.${k}" ${t.skills.includes(k) ? 'checked' : ''}>${esc(l)}</label>`).join('')}</div></div>
      <div><h4 style="margin-bottom:8px">Works in (clinical departments)</h4><div class="chips">${B.departments.filter(d => d.active).map(d => `<label class="chip"><input type="checkbox" name="dp.${d.id}" ${t.depts.includes(d.id) ? 'checked' : ''}>${esc(d.name)}</label>`).join('')}</div><p class="small muted" style="margin-top:6px">Only tick departments this person is qualified to treat in. They can only be booked there.</p></div>
      ${!isNew ? `<label class="check"><input type="checkbox" name="active" ${t.active ? 'checked' : ''}> Account active</label>` : ''}</form>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Save</button>`,
    onMount(el, close) { const s = el.querySelector('[data-save]'); s.onclick = () => { const v = formData(el.querySelector('[data-f]'));
      const body = { name: v.name, username: v.username, password: v.password, role: v.role, reg_no: v.reg_no, active: isNew ? true : v.active, apps: Object.entries(v.app || {}).filter(([, x]) => x).map(([k]) => k), skills: Object.entries(v.sk || {}).filter(([, x]) => x).map(([k]) => k), depts: Object.entries(v.dp || {}).filter(([, x]) => x).map(([k]) => +k) };
      busy(s, () => api('/clinic/team' + (isNew ? '' : '/' + t.id), { method: isNew ? 'POST' : 'PUT', body })).then(() => { close(); toast('Saved'); reload(); }).catch(() => {}); }; } });
}

start();

/* ---------------- Stock & purchasing ---------------- */
const GSTR = [0, 5, 12, 18, 28];
const POST = { draft: 'Draft', approved: 'Approved', part_received: 'Part received', received: 'Received', closed: 'Closed', cancelled: 'Cancelled' };
const PAYM = { bank: 'Bank transfer', upi: 'UPI', cash: 'Cash', cheque: 'Cheque', card: 'Card' };
const qtyf = n => (Math.round((n || 0) * 1000) / 1000).toLocaleString('en-IN');
let SUP = null;
async function suppliersList(force) { if (!SUP || force) SUP = (await api('/clinic/suppliers')).suppliers; return SUP; }
const products = async () => (await catalogue()).filter(i => i.kind === 'product');
async function productPicker(el, onPick) {
  const items = await products();
  el.innerHTML = `<div class="picker"><input class="in" placeholder="Add a product — type a name or code" autocomplete="off"><div class="list" hidden></div></div>`;
  const input = el.querySelector('input'), list = el.querySelector('.list');
  input.addEventListener('input', () => {
    const ws = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!ws.length) { list.hidden = true; return; }
    const hits = items.filter(i => ws.every(w => (i.name + ' ' + (i.code || '') + ' ' + (i.category || '')).toLowerCase().includes(w))).slice(0, 15);
    list.innerHTML = hits.length ? hits.map(i => `<div class="opt" data-id="${i.id}"><span>${esc(i.name)} <small>${esc(i.code || '')}${i.unit ? ' · ' + esc(i.unit) : ''}</small></span><small class="money">cost ${money(i.cost || 0)}</small></div>`).join('') : '<div class="opt"><small>No product matches.</small></div>';
    list.hidden = false;
    list.querySelectorAll('[data-id]').forEach(o => o.onmousedown = e => { e.preventDefault(); onPick(items.find(x => x.id === +o.dataset.id)); input.value = ''; list.hidden = true; });
  });
  input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
}
function stockTabs(tab) {
  const T = [['stock', 'Stock'], ['orders', 'Purchase orders'], ['grn', 'Goods received'], ['suppliers', 'Suppliers'], ['purchases', 'Purchase report']];
  return `<nav class="tabs">${T.map(([k, l]) => `<a href="#/stock?tab=${k}" class="${k === tab ? 'on' : ''}" style="text-decoration:none">${l}</a>`).join('')}</nav>`;
}
async function viewStock(tab, q) {
  if (tab === 'orders') return viewPOList(q.get('s') || 'open');
  if (tab === 'grn') return viewGRNList();
  if (tab === 'suppliers') return viewSuppliers();
  if (tab === 'purchases') return viewPurchaseReport(q.get('m'));
  const { items, alerts } = await api('/clinic/stock');
  const d60 = addDays(today(), 60);
  let f = q.get('f') || 'all', s = '';
  MAIN.innerHTML = `<div class="head"><div><h1>Stock</h1><p>${items.filter(i => i.on_hand > 0).length} products in stock · value ${money(items.reduce((a, i) => a + i.value, 0))}</p></div>
      <div class="acts" style="display:flex;gap:8px"><a class="btn ghost" href="#/grn/new">${icon('package', 18)}Receive goods</a><a class="btn gold" href="#/po/new">${icon('plus', 18)}New order</a></div></div>${stockTabs('stock')}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px"><input class="in" data-q placeholder="Search product or code" style="max-width:300px">
      <div class="seg">${[['all', 'All'], ['low', `Low / out (${alerts.low})`], ['exp', `Expiring ≤ 60 days (${alerts.expiring})`], ['neg', 'Below zero']].map(([k, l]) => `<button data-f="${k}" class="${k === f ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <section class="panel flush" data-list></section>`;
  const draw = () => {
    const ws = s.toLowerCase().split(/\s+/).filter(Boolean);
    const list = items.filter(i => ws.every(w => (i.name + ' ' + (i.code || '')).toLowerCase().includes(w)))
      .filter(i => f === 'low' ? i.track_stock && (i.on_hand <= 0 || (i.reorder_level > 0 && i.on_hand <= i.reorder_level)) : f === 'exp' ? i.next_expiry && i.next_expiry <= d60 : f === 'neg' ? i.on_hand < 0 : true).slice(0, 400);
    MAIN.querySelector('[data-list]').innerHTML = list.length ? `<table class="t"><thead><tr><th>Product</th><th class="n">On hand</th><th class="n">Reorder at</th><th>Next expiry</th><th class="n">Value</th><th>Supplier</th></tr></thead><tbody>
      ${list.map(i => `<tr data-id="${i.id}" style="cursor:pointer"><td><b>${esc(i.name)}</b><div class="small muted">${esc(i.code || '')}${i.sellable ? '' : ' · internal use'}</div></td>
        <td class="n" style="font-weight:700;${i.on_hand <= 0 || (i.reorder_level > 0 && i.on_hand <= i.reorder_level) ? 'color:var(--alert)' : ''}">${qtyf(i.on_hand)} <small class="muted" style="font-weight:400">${esc((i.unit || '').slice(0, 10))}</small></td>
        <td class="n">${i.reorder_level ? qtyf(i.reorder_level) : '—'}</td><td class="small"${i.next_expiry && i.next_expiry <= d60 ? ' style="color:var(--alert);font-weight:600"' : ''}>${i.next_expiry ? esc(fDate(i.next_expiry)) : '—'}</td>
        <td class="n money">${money(i.value)}</td><td class="small">${esc(i.supplier_name || '')}</td></tr>`).join('')}</tbody></table>`
      : emptyState('package', items.length ? 'Nothing matches.' : 'No stock yet. Receive goods to start.');
    MAIN.querySelectorAll('[data-id]').forEach(r => r.onclick = () => stockItemModal(+r.dataset.id, () => route()));
  };
  MAIN.querySelector('[data-q]').oninput = e => { s = e.target.value; draw(); };
  MAIN.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { f = b.dataset.f; MAIN.querySelectorAll('[data-f]').forEach(x => x.classList.toggle('on', x === b)); draw(); });
  draw();
}
async function stockItemModal(id, after) {
  const d = await api('/clinic/stock/' + id), it = d.item;
  const sups = await suppliersList();
  const KIND = { opening: 'Opening stock', grn: 'Received', sale: 'Sold', sale_cancel: 'Sale cancelled', use: 'Used in treatment', adjust: 'Adjustment' };
  modal({ title: it.name, wide: true, body: `<div class="kpis" style="margin-bottom:14px"><div class="kpi"><div class="l">On hand</div><div class="v">${qtyf(it.on_hand)}</div><div class="s">${esc(it.unit || '')}</div></div><div class="kpi"><div class="l">Average cost</div><div class="v money" style="font-size:20px">${money(it.avg_cost ?? it.cost ?? 0)}</div><div class="s">last purchase ${money(it.cost || 0)}</div></div><div class="kpi"><div class="l">Selling price</div><div class="v money" style="font-size:20px">${it.sellable ? money(it.price) : '—'}</div><div class="s">${it.sellable ? `+ ${it.gst_rate}% GST` : 'internal use'}</div></div></div>
      ${d.batches.length ? `<h4 style="margin:6px 0 8px">Batches</h4><table class="t" style="margin-bottom:14px"><thead><tr><th>Batch</th><th>Expiry</th><th class="n">Left</th></tr></thead><tbody>${d.batches.map(b => `<tr><td>${esc(b.batch_no || '—')}</td><td${b.expiry && b.expiry <= addDays(today(), 60) ? ' style="color:var(--alert);font-weight:600"' : ''}>${b.expiry ? esc(fDate(b.expiry)) : '—'}</td><td class="n">${qtyf(b.qty_left)}</td></tr>`).join('')}</tbody></table>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px"><button class="btn sm ghost" data-use>${icon('stethoscope', 15)}Use in treatment</button>${canMgr() ? `<button class="btn sm ghost" data-adj>${icon('pencil', 15)}Adjust stock</button><button class="btn sm quiet" data-set>${icon('settings', 15)}Stock settings</button>` : ''}</div>
      <div data-form></div>
      <h4 style="margin:10px 0 8px">Movements</h4>${d.moves.length ? `<table class="t"><thead><tr><th>Date</th><th>What</th><th class="n">Qty</th><th>Batch</th><th>By</th></tr></thead><tbody>${d.moves.map(m => `<tr><td class="small">${esc(fDate(m.created_at.slice(0, 10)))}</td><td class="small">${esc(KIND[m.kind] || m.kind)}${m.ref_no ? ' · ' + esc(m.ref_no) : ''}${m.reason ? `<div class="muted">${esc(m.reason)}</div>` : ''}</td><td class="n" style="font-weight:700;color:${m.qty < 0 ? 'var(--alert)' : 'var(--teal-ink)'}">${m.qty > 0 ? '+' : ''}${qtyf(m.qty)}</td><td class="small">${esc(m.batch_no || '')}</td><td class="small">${esc(m.staff_name || '')}</td></tr>`).join('')}</tbody></table>` : '<p class="small muted">No movements yet.</p>'}`,
    actions: '<button class="btn ghost" data-close>Close</button>',
    onMount(el, close) {
      const form = el.querySelector('[data-form]');
      const bsel = d.batches.length ? field('Batch', sel('batch_id', [['', 'First to expire (automatic)'], ...d.batches.map(b => [b.id, `${b.batch_no || 'no batch'}${b.expiry ? ' · exp ' + fDate(b.expiry) : ''} · ${qtyf(b.qty_left)} left`])], '')) : '';
      const submit = (btn, body) => busy(btn, () => api('/clinic/stock/move', { method: 'POST', body: { item_id: id, ...body } }), true).then(() => { close(); toast('Stock updated'); after && after(); }).catch(e => toast(e.message, true));
      el.querySelector('[data-use]').onclick = () => {
        form.innerHTML = `<section class="panel" style="margin-bottom:12px"><form data-f class="stack" style="gap:10px"><div class="grid2">${field('Quantity used', inp('qty', '1', 'type="number" min="0" step="any"'))}${bsel || '<span></span>'}</div>${field('For (patient / treatment)', inp('reason', '', 'maxlength="200" placeholder="e.g. HW-000049 GFC session"'))}</form><button class="btn sm" data-go style="margin-top:10px">Record use</button></section>`;
        form.querySelector('[data-go]').onclick = e => { const v = formData(form.querySelector('[data-f]')); submit(e.target, { kind: 'use', qty: -Math.abs(Number(v.qty)), batch_id: v.batch_id, reason: v.reason }); };
      };
      if (canMgr()) {
        el.querySelector('[data-adj]').onclick = () => {
          form.innerHTML = `<section class="panel" style="margin-bottom:12px"><form data-f class="stack" style="gap:10px"><div class="grid2">${field('Change', sel('dir', [['-', 'Remove stock'], ['+', 'Add stock']], '-'))}${field('Quantity', inp('qty', '', 'type="number" min="0" step="any"'))}</div>${bsel}
            ${field('Reason', sel('why', [['Physical count correction', 'Physical count correction'], ['Damaged', 'Damaged'], ['Expired', 'Expired'], ['Sample / free issue', 'Sample / free issue'], ['Other', 'Other']], 'Physical count correction'))}${field('Note', inp('note', '', 'maxlength="150"'))}</form><button class="btn sm" data-go style="margin-top:10px">Save adjustment</button></section>`;
          form.querySelector('[data-go]').onclick = e => { const v = formData(form.querySelector('[data-f]')); const qn = Math.abs(Number(v.qty)); submit(e.target, { kind: 'adjust', qty: v.dir === '-' ? -qn : qn, batch_id: v.batch_id, reason: [v.why, v.note].filter(Boolean).join(' — ') }); };
        };
        el.querySelector('[data-set]').onclick = () => {
          form.innerHTML = `<section class="panel" style="margin-bottom:12px"><form data-f class="stack" style="gap:10px"><div class="chips"><label class="chip"><input type="checkbox" name="track_stock" ${it.track_stock ? 'checked' : ''}>Keep stock</label><label class="chip"><input type="checkbox" name="track_batch" ${it.track_batch ? 'checked' : ''}>Batch &amp; expiry on receipt</label></div>
            <div class="grid3">${field('Reorder at', inp('reorder_level', it.reorder_level ?? '', 'type="number" min="0" step="any"'))}${field('Order quantity', inp('reorder_qty', it.reorder_qty ?? '', 'type="number" min="0" step="any"'))}${field('Usual supplier', sel('supplier_id', [['', '—'], ...sups.filter(x => x.active).map(x => [x.id, x.name])], it.supplier_id || ''))}</div></form><button class="btn sm" data-go style="margin-top:10px">Save</button></section>`;
          form.querySelector('[data-go]').onclick = e => { const f = form.querySelector('[data-f]'); const v = formData(f); busy(e.target, () => api(`/clinic/stock/${id}/settings`, { method: 'PUT', body: { ...v, track_stock: f.track_stock.checked, track_batch: f.track_batch.checked } }), true).then(() => { close(); toast('Saved'); after && after(); }).catch(er => toast(er.message, true)); };
        };
      }
    } });
}

/* Purchase orders */
async function viewPOList(s) {
  const { pos } = await api('/clinic/pos?status=' + encodeURIComponent(s));
  MAIN.innerHTML = `<div class="head"><div><h1>Purchase orders</h1></div><div class="acts"><a class="btn gold" href="#/po/new">${icon('plus', 18)}New order</a></div></div>${stockTabs('orders')}
    <div class="seg" style="margin-bottom:14px">${[['open', 'Open'], ['received', 'Received'], ['all', 'All']].map(([k, l]) => `<button data-s="${k}" class="${k === s ? 'on' : ''}">${l}</button>`).join('')}</div>
    <section class="panel flush">${pos.length ? `<table class="t"><thead><tr><th>Order</th><th>Supplier</th><th>Date</th><th>Status</th><th class="n">Total</th></tr></thead><tbody>${pos.map(p => `<tr data-id="${p.id}" style="cursor:pointer"><td><b>${esc(p.po_no)}</b>${p.legacy ? '<div class="small muted">from previous system</div>' : ''}</td><td>${esc(p.supplier_name)}</td><td class="small">${esc(fDate(p.order_date))}</td><td>${pill(p.status, POST[p.status])}</td><td class="n money">${money(p.total)}</td></tr>`).join('')}</tbody></table>` : emptyState('package', 'No orders here.')}</section>`;
  MAIN.querySelectorAll('[data-s]').forEach(b => b.onclick = () => go('#/stock?tab=orders&s=' + b.dataset.s));
  MAIN.querySelectorAll('[data-id]').forEach(r => r.onclick = () => go('#/po/' + r.dataset.id));
}
async function viewPO(id) {
  const sups = (await suppliersList()).filter(x => x.active);
  const d = id ? await api('/clinic/pos/' + id) : { po: { status: 'draft', order_date: today(), supplier_id: '' }, lines: [], grns: [] };
  const po = d.po, draft = po.status === 'draft' && !po.legacy;
  let lines = d.lines.map(l => ({ item_id: l.item_id, name: l.name, qty: l.qty, unit_cost: l.unit_cost, gst_rate: l.gst_rate, qty_received: l.qty_received, unit: l.unit }));
  MAIN.innerHTML = `<a href="#/stock?tab=orders" class="crumb">${icon('arrow-left', 16)}Purchase orders</a>
    <div class="head"><div><h1>${id ? esc(po.po_no) : 'New purchase order'}</h1><p>${id ? `${esc(po.supplier_name)} · ${esc(fDate(po.order_date))} ${pill(po.status, POST[po.status])}${po.approved_by_name ? ' · approved by ' + esc(po.approved_by_name) : ''}` : 'Draft — save, then ask a manager to approve.'}</p></div>
      <div class="acts" style="display:flex;gap:8px;flex-wrap:wrap">${draft ? `${id ? `<button class="btn quiet" data-del>${icon('trash-2', 16)}Delete</button>` : ''}<button class="btn ghost" data-save>Save draft</button>${id && canMgr() ? `<button class="btn gold" data-approve>${icon('check', 18)}Approve</button>` : ''}` : ''}
        ${id && !po.legacy ? `<a class="btn ghost" href="${BASE}/api/clinic/pos/${id}/pdf" target="_blank" rel="noopener">${icon('printer', 18)}PDF</a>` : ''}
        ${['approved', 'part_received'].includes(po.status) && !po.legacy ? `<a class="btn gold" href="#/grn/new?po=${id}">${icon('package', 18)}Receive goods</a>` : ''}
        ${canMgr() && ['approved', 'part_received'].includes(po.status) ? `<button class="btn quiet" data-close>Close order</button>` : ''}${canMgr() && id && ['draft', 'approved'].includes(po.status) ? `<button class="btn quiet" data-cancel>Cancel order</button>` : ''}</div></div>
    ${po.legacy ? `<div class="notice">${icon('info', 18)}<span>Carried over from the previous system without its product lines. ${['approved', 'part_received', 'draft'].includes(po.status) ? 'If goods are still due, close this one and raise a new order with the products.' : ''}</span></div>` : ''}
    <section class="panel" style="margin-bottom:16px"><div class="grid3">${field('Supplier', sel('supplier_id', [['', 'Choose…'], ...sups.map(x => [x.id, x.name])], po.supplier_id, draft ? 'data-sup' : 'disabled'))}${field('Order date', inp('order_date', po.order_date, `type="date" data-od ${draft ? '' : 'disabled'}`))}${field('Deliver by', inp('expected_date', po.expected_date || '', `type="date" data-ed ${draft ? '' : 'disabled'}`))}</div>
      <div style="margin-top:10px">${field('Notes for supplier', inp('notes', po.notes || '', `maxlength="300" data-notes ${draft ? '' : 'disabled'}`))}</div></section>
    <section class="panel flush"><table class="t"><thead><tr><th>Product</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">GST</th><th class="n">Amount</th>${draft ? '<th></th>' : '<th class="n">Received</th>'}</tr></thead><tbody data-lines></tbody></table>
      ${draft ? '<div style="padding:14px 16px;border-top:1px solid var(--line-soft)" data-add></div>' : ''}
      <div style="padding:14px 20px;border-top:1px solid var(--line-soft);text-align:right" data-tot></div></section>
    ${d.grns.length ? `<section class="panel flush" style="margin-top:16px"><div class="panel-h" style="padding:16px 20px 0"><h3>Goods received</h3></div><div class="rows">${d.grns.map(g => `<a class="row" href="#/grn/${g.id}"><div class="grow"><b>${esc(g.grn_no)}</b><span>${esc(fDate(g.received_date))}${g.supplier_invoice_no ? ' · invoice ' + esc(g.supplier_invoice_no) : ''}</span></div><span class="money">${money(g.total)}</span></a>`).join('')}</div></section>` : ''}`;
  const tbody = MAIN.querySelector('[data-lines]');
  const draw = () => {
    tbody.innerHTML = lines.length ? lines.map((l, i) => draft ? `<tr><td><b>${esc(l.name)}</b></td><td class="n"><input class="in" data-k="qty" data-i="${i}" value="${l.qty}" type="number" min="0" step="any" style="width:80px;height:34px;text-align:right"></td>
        <td class="n"><input class="in" data-k="unit_cost" data-i="${i}" value="${l.unit_cost}" type="number" min="0" step="0.01" style="width:100px;height:34px;text-align:right"></td><td class="n">${sel('g' + i, GSTR.map(r => [r, r + '%']), l.gst_rate, `data-k="gst_rate" data-i="${i}" style="width:80px;height:34px"`)}</td>
        <td class="n money">${money(l.qty * l.unit_cost * (1 + l.gst_rate / 100))}</td><td><button class="btn sm quiet icon" data-rm="${i}" aria-label="Remove">${icon('x', 16)}</button></td></tr>`
      : `<tr><td><b>${esc(l.name)}</b></td><td class="n">${qtyf(l.qty)}</td><td class="n money">${money(l.unit_cost)}</td><td class="n">${l.gst_rate}%</td><td class="n money">${money(l.qty * l.unit_cost * (1 + l.gst_rate / 100))}</td><td class="n">${qtyf(l.qty_received || 0)}</td></tr>`).join('') : `<tr><td colspan="6" class="muted">${po.legacy ? 'Product lines were not carried over.' : 'Add products below.'}</td></tr>`;
    const sub = lines.reduce((s, l) => s + l.qty * l.unit_cost, 0), tax = lines.reduce((s, l) => s + l.qty * l.unit_cost * l.gst_rate / 100, 0);
    MAIN.querySelector('[data-tot]').innerHTML = po.legacy ? `<b>Order total ${money(po.total)}</b>` : `<span class="small muted">Value ${money(sub)} · GST ${money(tax)}</span><div style="font-size:20px;font-weight:700;margin-top:4px">${money(sub + tax)}</div>`;
    tbody.querySelectorAll('[data-k]').forEach(x => x.onchange = () => { lines[+x.dataset.i][x.dataset.k] = Number(x.value) || 0; draw(); });
    tbody.querySelectorAll('[data-rm]').forEach(x => x.onclick = () => { lines.splice(+x.dataset.rm, 1); draw(); });
  };
  draw();
  if (draft) {
    productPicker(MAIN.querySelector('[data-add]'), it => { lines.push({ item_id: it.id, name: it.name, qty: it.reorder_qty || 1, unit_cost: it.cost || 0, gst_rate: GSTR.includes(it.gst_rate) ? it.gst_rate : 0 }); draw(); });
    const body = () => ({ supplier_id: MAIN.querySelector('[data-sup]').value, order_date: MAIN.querySelector('[data-od]').value, expected_date: MAIN.querySelector('[data-ed]').value, notes: MAIN.querySelector('[data-notes]').value, lines });
    const save = () => api(id ? '/clinic/pos/' + id : '/clinic/pos', { method: id ? 'PUT' : 'POST', body: body() });
    MAIN.querySelector('[data-save]').onclick = e => busy(e.target, save).then(r => { toast('Saved'); if (!id) go('#/po/' + r.id); else route(); }).catch(() => {});
    const ap = MAIN.querySelector('[data-approve]'); if (ap) ap.onclick = e => busy(e.target, async () => { await save(); return api(`/clinic/pos/${id}/approve`, { method: 'POST', body: {} }); }).then(() => { toast('Order approved'); route(); }).catch(() => {});
    const del = MAIN.querySelector('[data-del]'); if (del) del.onclick = () => { if (confirm('Delete this draft order?')) api('/clinic/pos/' + id, { method: 'DELETE', body: {} }).then(() => go('#/stock?tab=orders')).catch(e => toast(e.message, true)); };
  }
  const act = (sel2, action, msg) => { const b = MAIN.querySelector(sel2); if (b) b.onclick = () => { const reason = prompt(msg); if (reason === null) return; api(`/clinic/pos/${id}/${action}`, { method: 'POST', body: { reason } }).then(() => { toast('Done'); route(); }).catch(e => toast(e.message, true)); }; };
  act('[data-close]', 'close', 'Close this order? No more goods will be received against it. Reason (optional):');
  act('[data-cancel]', 'cancel', 'Cancel this order? Reason:');
}

/* Goods received */
async function viewGRNList() {
  const { grns } = await api('/clinic/grns');
  MAIN.innerHTML = `<div class="head"><div><h1>Goods received</h1></div><div class="acts"><a class="btn gold" href="#/grn/new">${icon('package', 18)}Receive goods</a></div></div>${stockTabs('grn')}
    <section class="panel flush">${grns.length ? `<table class="t"><thead><tr><th>GRN</th><th>Supplier</th><th>Received</th><th>Supplier invoice</th><th class="n">Total</th></tr></thead><tbody>${grns.map(g => `<tr data-id="${g.id}" style="cursor:pointer"><td><b>${esc(g.grn_no)}</b><div class="small muted">${g.po_no ? esc(g.po_no) : 'no order'}${g.legacy ? ' · previous system' : ''}</div></td><td>${esc(g.supplier_name)}</td><td class="small">${esc(fDate(g.received_date))}</td><td class="small">${esc(g.supplier_invoice_no || '—')}</td><td class="n money">${money(g.total)}</td></tr>`).join('')}</tbody></table>` : emptyState('package', 'Nothing received yet.')}</section>`;
  MAIN.querySelectorAll('[data-id]').forEach(r => r.onclick = () => go('#/grn/' + r.dataset.id));
}
async function viewGRN(id) {
  const d = await api('/clinic/grns/' + id), g = d.grn;
  MAIN.innerHTML = `<a href="#/stock?tab=grn" class="crumb">${icon('arrow-left', 16)}Goods received</a>
    <div class="head"><div><h1>${esc(g.grn_no)}</h1><p>${esc(g.supplier_name)} · received ${esc(fDate(g.received_date))}${g.received_by_name ? ' by ' + esc(g.received_by_name) : ''}${g.po_no ? ` · <a href="#/po/${g.po_id}">${esc(g.po_no)}</a>` : ''}</p></div></div>
    ${g.legacy ? `<div class="notice">${icon('info', 18)}<span>Carried over from the previous system — product lines were not available.</span></div>` : ''}
    <section class="panel" style="margin-bottom:16px"><div class="grid3"><div><div class="small muted">Supplier invoice</div><b>${esc(g.supplier_invoice_no || '—')}</b>${g.supplier_invoice_date ? ' · ' + esc(fDate(g.supplier_invoice_date)) : ''}</div><div><div class="small muted">GST</div><b>${g.igst ? 'IGST ' + money(g.igst) : `CGST ${money(g.cgst)} · SGST ${money(g.sgst)}`}</b></div><div><div class="small muted">Total</div><b class="money" style="font-size:18px">${money(g.total)}</b></div></div>${g.notes ? `<p class="small muted" style="margin-top:10px">${esc(g.notes)}</p>` : ''}</section>
    ${d.lines.length ? `<section class="panel flush"><table class="t"><thead><tr><th>Product</th><th class="n">Qty</th><th class="n">Free</th><th class="n">Rate</th><th class="n">GST</th><th>Batch · expiry</th><th class="n">Amount</th></tr></thead><tbody>${d.lines.map(l => `<tr><td><b>${esc(l.name)}</b></td><td class="n">${qtyf(l.qty)}</td><td class="n">${l.free_qty ? qtyf(l.free_qty) : '—'}</td><td class="n money">${money(l.unit_cost)}</td><td class="n">${l.gst_rate}%</td><td class="small">${esc(l.batch_no || '—')}${l.expiry ? ' · ' + esc(fDate(l.expiry)) : ''}</td><td class="n money">${money(l.total)}</td></tr>`).join('')}</tbody></table></section>` : ''}`;
}
async function newGRN(poId) {
  const sups = (await suppliersList()).filter(x => x.active);
  const cat = await products();
  let po = null, lines = [];
  if (poId) {
    const d = await api('/clinic/pos/' + poId); po = d.po;
    lines = d.lines.filter(l => l.qty - (l.qty_received || 0) > 0).map(l => ({ po_line_id: l.id, item_id: l.item_id, name: l.name, ordered: l.qty - (l.qty_received || 0), qty: r2(l.qty - (l.qty_received || 0)), free_qty: 0, unit_cost: l.unit_cost, gst_rate: l.gst_rate, batch_no: '', expiry: '', track_batch: l.track_batch }));
  }
  MAIN.innerHTML = `<a href="${po ? '#/po/' + po.id : '#/stock?tab=grn'}" class="crumb">${icon('arrow-left', 16)}${po ? esc(po.po_no) : 'Goods received'}</a>
    <div class="head"><div><h1>Receive goods</h1><p>${po ? `Against ${esc(po.po_no)} · ${esc(po.supplier_name)}` : 'Without a purchase order'}. Check quantities, batch numbers and expiry dates against the supplier's invoice.</p></div></div>
    <section class="panel" style="margin-bottom:16px"><form data-h class="stack" style="gap:12px"><div class="grid3">${field('Supplier', sel('supplier_id', [['', 'Choose…'], ...sups.map(x => [x.id, x.name])], po ? po.supplier_id : '', po ? 'disabled' : ''))}${field('Received on', inp('received_date', today(), 'type="date"'))}${field('Round-off (₹)', inp('round_off', '0', 'type="number" step="0.01"'), 'to match the invoice total')}</div>
      <div class="grid3">${field('Supplier invoice no.', inp('supplier_invoice_no', '', 'maxlength="40"'))}${field('Invoice date', inp('supplier_invoice_date', '', 'type="date"'))}${field('Notes', inp('notes', '', 'maxlength="300"'))}</div></form></section>
    <section class="panel flush"><div style="overflow-x:auto"><table class="t"><thead><tr><th>Product</th><th class="n">Qty</th><th class="n">Free</th><th class="n">Rate</th><th class="n">GST</th><th>Batch no.</th><th>Expiry</th><th class="n">Amount</th><th></th></tr></thead><tbody data-lines></tbody></table></div>
      <div style="padding:14px 16px;border-top:1px solid var(--line-soft)" data-add></div>
      <div style="padding:14px 20px;border-top:1px solid var(--line-soft);display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><span class="small muted">Stock goes up as soon as you post. Free quantity adds to stock at no cost.</span><div style="text-align:right"><div data-tot></div><button class="btn gold" data-post style="margin-top:8px">${icon('check', 18)}Post goods received</button></div></div></section>`;
  const tbody = MAIN.querySelector('[data-lines]');
  const I = (k, i, v, a = '') => `<input class="in" data-k="${k}" data-i="${i}" value="${esc(v ?? '')}" ${a} style="height:34px">`;
  const draw = () => {
    tbody.innerHTML = lines.length ? lines.map((l, i) => `<tr><td><b>${esc(l.name)}</b>${l.ordered != null ? `<div class="small muted">due ${qtyf(l.ordered)}</div>` : ''}</td>
      <td class="n">${I('qty', i, l.qty, 'type="number" min="0" step="any" style="width:76px;height:34px;text-align:right"')}</td><td class="n">${I('free_qty', i, l.free_qty, 'type="number" min="0" step="any" style="width:64px;height:34px;text-align:right"')}</td>
      <td class="n">${I('unit_cost', i, l.unit_cost, 'type="number" min="0" step="0.01" style="width:92px;height:34px;text-align:right"')}</td><td class="n">${sel('g' + i, GSTR.map(r => [r, r + '%']), l.gst_rate, `data-k="gst_rate" data-i="${i}" style="width:76px;height:34px"`)}</td>
      <td>${I('batch_no', i, l.batch_no, `maxlength="40" style="width:110px;height:34px" ${l.track_batch ? 'placeholder="required"' : ''}`)}</td><td>${I('expiry', i, l.expiry, 'type="date" style="width:140px;height:34px"')}</td>
      <td class="n money">${money(l.qty * l.unit_cost * (1 + l.gst_rate / 100))}</td><td><button class="btn sm quiet icon" data-rm="${i}" aria-label="Remove">${icon('x', 16)}</button></td></tr>`).join('') : '<tr><td colspan="9" class="muted">Add the products received below.</td></tr>';
    const sub = lines.reduce((s, l) => s + l.qty * l.unit_cost, 0), tax = lines.reduce((s, l) => s + l.qty * l.unit_cost * l.gst_rate / 100, 0), ro = Number(MAIN.querySelector('[name=round_off]').value) || 0;
    MAIN.querySelector('[data-tot]').innerHTML = `<span class="small muted">Value ${money(sub)} · GST ${money(tax)}${ro ? ' · round-off ' + money(ro) : ''}</span><div style="font-size:20px;font-weight:700">${money(sub + tax + ro)}</div>`;
    tbody.querySelectorAll('[data-k]').forEach(x => x.onchange = () => { const l = lines[+x.dataset.i]; l[x.dataset.k] = ['batch_no', 'expiry'].includes(x.dataset.k) ? x.value : Number(x.value) || 0; draw(); });
    tbody.querySelectorAll('[data-rm]').forEach(x => x.onclick = () => { lines.splice(+x.dataset.rm, 1); draw(); });
  };
  MAIN.querySelector('[name=round_off]').onchange = draw;
  draw();
  productPicker(MAIN.querySelector('[data-add]'), it => { lines.push({ item_id: it.id, name: it.name, qty: 1, free_qty: 0, unit_cost: it.cost || 0, gst_rate: GSTR.includes(it.gst_rate) ? it.gst_rate : 0, batch_no: '', expiry: '', track_batch: it.track_batch }); draw(); });
  MAIN.querySelector('[data-post]').onclick = e => {
    const h = formData(MAIN.querySelector('[data-h]'));
    if (po) h.supplier_id = po.supplier_id;
    busy(e.target, () => api('/clinic/grns', { method: 'POST', body: { ...h, po_id: po ? po.id : null, lines } })).then(r => { toast(`${r.grn_no} posted — stock updated`); go('#/grn/' + r.id); }).catch(() => {});
  };
}

/* Suppliers */
async function viewSuppliers() {
  const sups = await suppliersList(true);
  MAIN.innerHTML = `<div class="head"><div><h1>Suppliers</h1><p>Balance = goods received minus payments made.</p></div>${canMgr() ? `<div class="acts"><button class="btn gold" data-add>${icon('plus', 18)}Add supplier</button></div>` : ''}</div>${stockTabs('suppliers')}
    <input class="in" data-q placeholder="Search supplier" style="max-width:300px;margin-bottom:14px"><section class="panel flush" data-list></section>`;
  const draw = q => { const list = sups.filter(s => !q || s.name.toLowerCase().includes(q.toLowerCase()));
    MAIN.querySelector('[data-list]').innerHTML = `<table class="t"><thead><tr><th>Supplier</th><th>GSTIN</th><th class="n">Open orders</th><th class="n">Balance</th></tr></thead><tbody>${list.map(s => `<tr data-id="${s.id}" style="cursor:pointer${s.active ? '' : ';opacity:.5'}"><td><b>${esc(s.name)}</b><div class="small muted">${esc([s.contact, s.phone, s.city].filter(Boolean).join(' · '))}</div></td><td class="small">${esc(s.gstin || '—')}</td><td class="n">${s.open_pos || ''}</td><td class="n money"${s.balance > 0 ? ' style="font-weight:700"' : ''}>${money(s.balance)}</td></tr>`).join('')}</tbody></table>`;
    MAIN.querySelectorAll('[data-id]').forEach(r => r.onclick = () => supplierModal(+r.dataset.id)); };
  MAIN.querySelector('[data-q]').oninput = e => draw(e.target.value);
  const add = MAIN.querySelector('[data-add]'); if (add) add.onclick = () => supplierForm(null);
  draw('');
}
function supplierForm(s) {
  s = s || {};
  modal({ title: s.id ? 'Edit supplier' : 'Add supplier', wide: true, body: `<form data-f class="stack" style="gap:12px"><div class="grid2">${field('Name', inp('name', s.name || '', 'maxlength="120"'))}${field('GSTIN', inp('gstin', s.gstin || '', 'maxlength="15" style="text-transform:uppercase"'))}</div>
      <div class="grid3">${field('Contact person', inp('contact', s.contact || ''))}${field('Phone', inp('phone', s.phone || ''))}${field('Email', inp('email', s.email || ''))}</div>
      ${field('Address', inp('address', s.address || '', 'maxlength="300"'))}<div class="grid3">${field('City', inp('city', s.city || ''))}${field('State', inp('state', s.state || 'Kerala'))}${field('Credit days', inp('terms_days', s.terms_days ?? 0, 'type="number" min="0"'))}</div>
      ${field('Notes', inp('notes', s.notes || '', 'maxlength="300"'))}${s.id ? `<label class="chip"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}>Active</label>` : ''}</form>`,
    actions: '<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Save</button>',
    onMount(el, close) { const b = el.querySelector('[data-save]'); b.onclick = () => { const f = el.querySelector('[data-f]'); busy(b, () => api(s.id ? '/clinic/suppliers/' + s.id : '/clinic/suppliers', { method: s.id ? 'PUT' : 'POST', body: { ...formData(f), active: f.active ? f.active.checked : true } }), true).then(() => { close(); toast('Saved'); SUP = null; route(); }).catch(e => toast(e.message, true)); }; } });
}
async function supplierModal(id) {
  const d = await api('/clinic/suppliers/' + id), s = d.supplier;
  modal({ title: s.name, wide: true, body: `<div class="kpis" style="margin-bottom:14px"><div class="kpi"><div class="l">Goods received</div><div class="v money" style="font-size:20px">${money(s.billed)}</div></div><div class="kpi"><div class="l">Paid</div><div class="v money" style="font-size:20px">${money(s.paid)}</div></div><div class="kpi"><div class="l">Balance</div><div class="v money" style="font-size:20px">${money(s.balance)}</div><div class="s">${s.terms_days ? s.terms_days + ' days credit' : ''}</div></div></div>
      <p class="small muted" style="margin-bottom:10px">${esc([s.gstin && 'GSTIN ' + s.gstin, s.contact, s.phone, s.email, s.city].filter(Boolean).join(' · '))}</p>
      ${canMgr() ? `<div style="display:flex;gap:8px;margin-bottom:12px"><button class="btn sm gold" data-pay>${icon('wallet', 15)}Record payment</button><button class="btn sm ghost" data-edit>${icon('pencil', 15)}Edit</button></div><div data-form></div>` : ''}
      <h4 style="margin:8px 0">Payments</h4>${d.payments.length ? `<table class="t"><tbody>${d.payments.map(p => `<tr${p.voided ? ' style="opacity:.5;text-decoration:line-through"' : ''}><td class="small">${esc(fDate(p.paid_on))}</td><td class="small">${esc(PAYM[p.mode] || p.mode)}${p.reference ? ' · ' + esc(p.reference) : ''}${p.notes ? `<div class="muted">${esc(p.notes)}</div>` : ''}</td><td class="n money">${money(p.amount)}</td><td>${!p.voided && canMgr() ? `<button class="btn sm quiet" data-void="${p.id}">Void</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="small muted">None yet.</p>'}
      <h4 style="margin:14px 0 8px">Goods received</h4>${d.grns.length ? `<table class="t"><tbody>${d.grns.map(g => `<tr><td><a href="#/grn/${g.id}">${esc(g.grn_no)}</a></td><td class="small">${esc(fDate(g.received_date))}</td><td class="small">${esc(g.supplier_invoice_no || '')}</td><td class="n money">${money(g.total)}</td></tr>`).join('')}</tbody></table>` : '<p class="small muted">None yet.</p>'}`,
    actions: '<button class="btn ghost" data-close>Close</button>',
    onMount(el, close) {
      el.querySelectorAll('a[href^="#/grn/"]').forEach(a => a.addEventListener('click', () => close()));
      if (!canMgr()) return;
      el.querySelector('[data-edit]').onclick = () => { close(); supplierForm(s); };
      el.querySelector('[data-pay]').onclick = () => {
        const form = el.querySelector('[data-form]');
        form.innerHTML = `<section class="panel" style="margin-bottom:12px"><form data-f class="stack" style="gap:10px"><div class="grid3">${field('Amount (₹)', inp('amount', s.balance > 0 ? s.balance : '', 'type="number" min="0" step="0.01"'))}${field('Paid on', inp('paid_on', today(), 'type="date"'))}${field('Mode', sel('mode', Object.entries(PAYM), 'bank'))}</div>
          <div class="grid2">${field('Reference (UTR / cheque no.)', inp('reference', '', 'maxlength="80"'))}${field('Against GRN', sel('grn_id', [['', '—'], ...d.grns.filter(g => !g.legacy).map(g => [g.id, `${g.grn_no} · ${money(g.total)}`])], ''))}</div>${field('Notes', inp('notes', '', 'maxlength="200"'))}</form><button class="btn sm" data-go style="margin-top:10px">Save payment</button></section>`;
        form.querySelector('[data-go]').onclick = e => busy(e.target, () => api('/clinic/supplier-payments', { method: 'POST', body: { supplier_id: id, ...formData(form.querySelector('[data-f]')) } }), true).then(() => { close(); toast('Payment recorded'); SUP = null; route(); }).catch(er => toast(er.message, true));
      };
      el.querySelectorAll('[data-void]').forEach(b => b.onclick = () => { const reason = prompt('Reason for voiding this payment:'); if (!reason) return; api(`/clinic/supplier-payments/${b.dataset.void}/void`, { method: 'POST', body: { reason } }).then(() => { close(); toast('Voided'); SUP = null; route(); }).catch(e => toast(e.message, true)); });
    } });
}

/* Purchase report */
async function viewPurchaseReport(m) {
  const r = await api('/clinic/reports/purchases' + (m ? '?month=' + m : ''));
  const sv = await api('/clinic/reports/stock-value');
  const t = r.gst.reduce((a, x) => ({ value: a.value + x.value, cgst: a.cgst + x.cgst, sgst: a.sgst + x.sgst, igst: a.igst + x.igst }), { value: 0, cgst: 0, sgst: 0, igst: 0 });
  MAIN.innerHTML = `<div class="head"><div><h1>Purchase report</h1><p>Input GST on goods received, for the GST return.</p></div><div class="acts"><button class="btn ghost" onclick="window.print()">${icon('printer', 18)}Print</button></div></div>${stockTabs('purchases')}
    <div style="margin-bottom:14px" class="noprint">${inp('m', r.month, 'type="month" style="width:auto" data-m')}</div>
    <div class="kpis"><div class="kpi"><div class="l">Purchases (taxable value)</div><div class="v money">${money(t.value)}</div><div class="s">${r.grns.length} goods received</div></div><div class="kpi"><div class="l">Input CGST + SGST</div><div class="v money" style="font-size:20px">${money(t.cgst + t.sgst)}</div></div><div class="kpi"><div class="l">Input IGST</div><div class="v money" style="font-size:20px">${money(t.igst)}</div></div><div class="kpi"><div class="l">Stock value today</div><div class="v money" style="font-size:20px">${money(sv.total)}</div><div class="s">${sv.items.length} products, at average cost</div></div></div>
    <section class="panel flush" style="margin-bottom:16px"><div class="panel-h" style="padding:16px 20px 0"><h3>By GST rate</h3></div><table class="t sumtable"><thead><tr><th>Rate</th><th class="n">Taxable value</th><th class="n">CGST</th><th class="n">SGST</th><th class="n">IGST</th></tr></thead><tbody>${r.gst.map(x => `<tr><td>${x.rate}%</td><td class="n money">${money(x.value)}</td><td class="n money">${money(x.cgst)}</td><td class="n money">${money(x.sgst)}</td><td class="n money">${money(x.igst)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No purchases this month.</td></tr>'}</tbody></table></section>
    <section class="panel flush"><div class="panel-h" style="padding:16px 20px 0"><h3>Supplier invoices</h3></div><table class="t"><thead><tr><th>Date</th><th>Supplier</th><th>GSTIN</th><th>Invoice</th><th class="n">Taxable</th><th class="n">GST</th><th class="n">Total</th></tr></thead><tbody>${r.grns.map(g => `<tr><td class="small">${esc(fDate(g.received_date))}</td><td>${esc(g.supplier_name)}</td><td class="small">${esc(g.supplier_gstin || '—')}</td><td class="small">${esc(g.supplier_invoice_no || '—')}${g.supplier_invoice_date ? ' · ' + esc(fDate(g.supplier_invoice_date)) : ''}</td><td class="n money">${money(g.taxable)}</td><td class="n money">${money(g.cgst + g.sgst + g.igst)}</td><td class="n money">${money(g.total)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">None.</td></tr>'}</tbody></table>
      ${r.grns.some(g => !g.supplier_invoice_no || !g.supplier_gstin) ? '<p class="small" style="padding:10px 16px;color:var(--alert)">Some entries have no supplier invoice number or GSTIN — input credit can only be claimed with both.</p>' : ''}</section>`;
  MAIN.querySelector('[data-m]').onchange = e => go('#/stock?tab=purchases&m=' + e.target.value);
}

/* ---------------- Care records (phase 2) ---------------- */
const COND = { caries: ['Caries', '#c0392b'], filled: ['Filled', '#2f6f8f'], rct: ['Root canal', '#6b4a8f'], crown: ['Crown', '#b08a2f'], bridge: ['Bridge', '#b08a2f'], implant: ['Implant', '#2c6b4f'],
  missing: ['Missing', '#8c9796'], extraction: ['Extraction', '#7a1f1f'], fractured: ['Fractured', '#d07a2f'], mobile: ['Mobile', '#d07a2f'], impacted: ['Impacted', '#8a6a2f'], veneer: ['Veneer', '#b0607a'],
  sensitivity: ['Sensitivity', '#5e6d6c'], stain: ['Stain', '#8a6a2f'], other: ['Other', '#5e6d6c'] };
const CSTAT = { existing: 'Existing', planned: 'Planned', done: 'Done' };
const PLST = { proposed: 'Proposed', accepted: 'Accepted', completed: 'Completed', cancelled: 'Cancelled' };
const PHT = { before: 'Before', after: 'After', progress: 'Progress', xray: 'X-ray', scan: 'Scan', other: 'Other' };
const ta = (n, v, a = '') => `<textarea class="in" name="${n}" ${a}>${esc(v || '')}</textarea>`;
async function careTab(tab, p, body, after) {
  const c = await api('/clinic/care/' + p.id);
  if (tab === 'notes') return notesTab(p, c, body, after);
  if (tab === 'dental') return dentalTab(p, c, body, after);
  if (tab === 'plans') return plansTab(p, c, body, after);
  if (tab === 'photos') return photosTab(p, c, body, after);
  return followupsTab(p, c, body, after);
}

/* Notes */
function notesTab(p, c, body, after) {
  const blk = (k, v) => v ? `<div style="margin-top:8px"><div class="small muted" style="font-weight:600">${k}</div><div style="white-space:pre-wrap">${esc(v)}</div></div>` : '';
  body.innerHTML = `<div style="display:flex;justify-content:flex-end;margin-bottom:12px"><button class="btn gold" data-new>${icon('plus', 18)}New note</button></div>
    ${c.notes.length ? c.notes.map(n => { const v = n.vitals || {}; const vs = [v.bp && 'BP ' + v.bp, v.pulse && 'Pulse ' + v.pulse, v.weight && 'Wt ' + v.weight + ' kg', v.spo2 && 'SpO₂ ' + v.spo2 + '%', v.temp && 'Temp ' + v.temp].filter(Boolean);
      return `<section class="panel" style="margin-bottom:14px"><div class="panel-h"><div><h3>${esc(fDate(n.visit_date))} ${n.dept_id ? deptTag(n.dept_id) : ''}</h3><p class="small muted">${esc(n.author_name || '')}${n.updated_at ? ' · edited' : ''}${n.editable ? ' · can be edited until 24 h after writing' : ''}</p></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${n.rx.length ? `<a class="btn sm ghost" href="${BASE}/api/clinic/notes/${n.id}/rx" target="_blank" rel="noopener">${icon('printer', 15)}Prescription</a>` : ''}${n.editable ? `<button class="btn sm ghost" data-edit="${n.id}">${icon('pencil', 15)}Edit</button>` : `<button class="btn sm quiet" data-add="${n.id}">Addendum</button>`}</div></div>
        ${vs.length ? `<p class="small" style="margin-top:4px">${esc(vs.join(' · '))}</p>` : ''}
        ${blk('Complaint', n.complaint)}${blk('History', n.history)}${blk('Findings', n.findings)}${blk('Diagnosis', n.diagnosis)}${blk('Treatment done', n.treatment)}
        ${n.rx.length ? `<div style="margin-top:8px"><div class="small muted" style="font-weight:600">Prescription</div>${n.rx.map((x, i) => `<div>${i + 1}. <b>${esc(x.name)}</b> ${esc([x.dose, x.freq, x.days && 'for ' + x.days].filter(Boolean).join(' · '))}${x.note ? ` <span class="muted">— ${esc(x.note)}</span>` : ''}</div>`).join('')}</div>` : ''}
        ${blk('Advice', n.advice)}${n.review_date ? `<p style="margin-top:8px;font-weight:600;color:var(--teal-ink)">${icon('bell', 14)} Review ${esc(fDate(n.review_date))}${n.review_note ? ' — ' + esc(n.review_note) : ''}</p>` : ''}
        ${n.addenda.length ? `<div style="margin-top:10px;border-top:1px solid var(--line-soft);padding-top:8px">${n.addenda.map(x => `<div class="small"><b>Addendum</b> · ${esc(x.by)} · ${esc(fDate(x.at.slice(0, 10)))}<div style="white-space:pre-wrap">${esc(x.text)}</div></div>`).join('')}</div>` : ''}</section>`; }).join('')
    : `<section class="panel">${emptyState('file-text', 'No notes yet.')}</section>`}`;
  body.querySelector('[data-new]').onclick = () => noteModal({ patient_id: p.id, patient_name: p.name }, after);
  body.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => noteModal({ ...c.notes.find(n => n.id === +b.dataset.edit), patient_name: p.name }, after));
  body.querySelectorAll('[data-add]').forEach(b => b.onclick = () => modal({ title: 'Addendum', body: `<form data-f>${field('Addendum', ta('text', '', 'maxlength="1500" rows="4"'))}</form><p class="small muted">Added below the original note with your name and the time. The original is not changed.</p>`,
    actions: '<button class="btn ghost" data-close>Cancel</button><button class="btn" data-ok>Add</button>',
    onMount(el, close) { const ok = el.querySelector('[data-ok]'); ok.onclick = () => busy(ok, () => api(`/clinic/notes/${b.dataset.add}/addendum`, { method: 'POST', body: formData(el.querySelector('[data-f]')) }), true).then(() => { close(); toast('Addendum added'); after(); }).catch(e => toast(e.message, true)); } }));
}
async function noteModal(n, after) {
  const meds = (await catalogue()).filter(i => i.kind === 'product' && (i.dept_id === 7 || /tab|cap|inj|syrup|gel|cream|lotion|serum|drops|sachet/i.test(i.name))).map(i => i.name);
  let rx = (n.rx || []).map(x => ({ ...x }));
  const v = n.vitals || {};
  const quick = [[7, '1 week'], [14, '2 weeks'], [30, '1 month'], [90, '3 months'], [180, '6 months']];
  modal({ title: `${n.id ? 'Edit note' : 'Visit note'} · ${n.patient_name || ''}`, wide: true, body: `<form data-f class="stack" style="gap:12px">
      ${field('Chief complaint', ta('complaint', n.complaint, 'maxlength="1000" rows="2"'))}
      ${field('History', ta('history', n.history, 'maxlength="2000" rows="2" placeholder="Relevant medical / dental history, medicines"'), 'optional')}
      <div class="grid3" style="grid-template-columns:repeat(5,minmax(0,1fr))">${field('BP', inp('bp', v.bp, 'maxlength="12" placeholder="120/80"'))}${field('Pulse', inp('pulse', v.pulse, 'maxlength="6"'))}${field('Weight (kg)', inp('weight', v.weight, 'maxlength="8"'))}${field('SpO₂ %', inp('spo2', v.spo2, 'maxlength="6"'))}${field('Temp', inp('temp', v.temp, 'maxlength="8"'))}</div>
      ${field('Examination findings', ta('findings', n.findings, 'maxlength="3000" rows="3"'))}
      ${field('Diagnosis', ta('diagnosis', n.diagnosis, 'maxlength="1000" rows="2"'))}
      ${field('Treatment done today', ta('treatment', n.treatment, 'maxlength="3000" rows="3"'))}
      <div><h4 style="margin:4px 0 8px">Prescription</h4><datalist id="medlist">${meds.map(m => `<option value="${esc(m)}">`).join('')}</datalist><div data-rx></div><button type="button" class="btn sm ghost" data-rxadd style="margin-top:6px">${icon('plus', 15)}Add medicine</button></div>
      ${field('Advice', ta('advice', n.advice, 'maxlength="1500" rows="2" placeholder="Care instructions for the patient"'))}
      <div class="grid2">${field('Review on', inp('review_date', n.review_date || '', 'type="date" data-rd'), 'creates a follow-up for the front desk')}${field('Review for', inp('review_note', n.review_note || '', 'maxlength="200" placeholder="e.g. Suture removal, PRP session 2"'))}</div>
      <div class="chips">${quick.map(([d, l]) => `<button type="button" class="chip" data-q="${d}">+${l}</button>`).join('')}</div></form>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn gold" data-save>${icon('check', 18)}Save note</button>`,
    onMount(el, close) {
      const box = el.querySelector('[data-rx]');
      const draw = () => {
        box.innerHTML = rx.map((x, i) => `<div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1.4fr auto;gap:6px;margin-bottom:6px">
          <input class="in" list="medlist" data-k="name" data-i="${i}" value="${esc(x.name || '')}" placeholder="Medicine" style="height:36px"><input class="in" data-k="dose" data-i="${i}" value="${esc(x.dose || '')}" placeholder="Dose (1 tab)" style="height:36px">
          <input class="in" data-k="freq" data-i="${i}" value="${esc(x.freq || '')}" placeholder="1-0-1" style="height:36px"><input class="in" data-k="days" data-i="${i}" value="${esc(x.days || '')}" placeholder="5 days" style="height:36px">
          <input class="in" data-k="note" data-i="${i}" value="${esc(x.note || '')}" placeholder="After food" style="height:36px"><button type="button" class="btn sm quiet icon" data-rm="${i}" aria-label="Remove">${icon('x', 16)}</button></div>`).join('') || '<p class="small muted">No medicines.</p>';
        box.querySelectorAll('[data-k]').forEach(x => x.oninput = () => { rx[+x.dataset.i][x.dataset.k] = x.value; });
        box.querySelectorAll('[data-rm]').forEach(x => x.onclick = () => { rx.splice(+x.dataset.rm, 1); draw(); });
      };
      draw();
      el.querySelector('[data-rxadd]').onclick = () => { rx.push({ name: '', dose: '', freq: '', days: '', note: '' }); draw(); };
      el.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { el.querySelector('[data-rd]').value = addDays(today(), +b.dataset.q); });
      const s = el.querySelector('[data-save]');
      s.onclick = () => { const f = formData(el.querySelector('[data-f]'));
        const bodyN = { ...f, vitals: { bp: f.bp, pulse: f.pulse, weight: f.weight, spo2: f.spo2, temp: f.temp }, rx: rx.filter(x => x.name && x.name.trim()), patient_id: n.patient_id, appointment_id: n.appointment_id, dept_id: n.dept_id };
        busy(s, () => api(n.id ? '/clinic/notes/' + n.id : '/clinic/notes', { method: n.id ? 'PUT' : 'POST', body: bodyN }), true).then(() => { close(); toast('Note saved'); after && after(); }).catch(e => toast(e.message, true)); };
    } });
}

/* Dental chart */
function dentalTab(p, c, body, after) {
  let kids = false, picked = new Set();
  const Q = a => kids ? a.kid : a.adult;
  const rows = [{ adult: [18, 17, 16, 15, 14, 13, 12, 11], kid: [55, 54, 53, 52, 51] }, { adult: [21, 22, 23, 24, 25, 26, 27, 28], kid: [61, 62, 63, 64, 65] }, { adult: [48, 47, 46, 45, 44, 43, 42, 41], kid: [85, 84, 83, 82, 81] }, { adult: [31, 32, 33, 34, 35, 36, 37, 38], kid: [71, 72, 73, 74, 75] }];
  const of = t => c.chart.filter(x => x.tooth === String(t));
  const tooth = t => { const es = of(t); const main = es.find(x => x.status !== 'done') || es[0]; const col = main ? COND[main.condition][1] : null;
    return `<button type="button" data-t="${t}" title="${es.map(x => COND[x.condition][0] + ' (' + CSTAT[x.status] + ')').join(', ')}" style="width:44px;height:52px;border-radius:10px;border:2px ${main && main.status === 'planned' ? 'dashed' : 'solid'} ${col || 'var(--line)'};background:${picked.has(String(t)) ? 'var(--gold-soft, #f4e8c8)' : col ? col + '1f' : 'var(--paper, #fff)'};cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font-weight:700;color:var(--ink)">${t}<span style="font-size:9px;font-weight:600;color:${col || 'var(--muted)'}">${main ? esc(COND[main.condition][0].slice(0, 7)) : ''}</span></button>`; };
  const draw = () => {
    body.innerHTML = `<section class="panel" style="margin-bottom:14px"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px"><div class="seg"><button data-k="0" class="${kids ? '' : 'on'}">Permanent</button><button data-k="1" class="${kids ? 'on' : ''}">Primary (milk) teeth</button></div>
        <div style="display:flex;gap:8px"><span class="small muted" style="align-self:center">${picked.size ? picked.size + ' selected' : 'Tap teeth to select'}</span><button class="btn gold" data-addf ${picked.size ? '' : 'disabled'}>${icon('plus', 16)}Record finding</button></div></div>
      <div style="overflow-x:auto"><div style="display:grid;grid-template-columns:auto auto;gap:10px 18px;justify-content:center;min-width:max-content">
        <div style="display:flex;gap:4px;justify-content:flex-end;padding-bottom:10px;border-bottom:2px solid var(--line);border-right:2px solid var(--line);padding-right:10px">${Q(rows[0]).map(tooth).join('')}</div>
        <div style="display:flex;gap:4px;padding-bottom:10px;border-bottom:2px solid var(--line)">${Q(rows[1]).map(tooth).join('')}</div>
        <div style="display:flex;gap:4px;justify-content:flex-end;border-right:2px solid var(--line);padding-right:10px">${Q(rows[2]).map(tooth).join('')}</div>
        <div style="display:flex;gap:4px">${Q(rows[3]).map(tooth).join('')}</div></div></div>
      <p class="small muted" style="margin-top:10px;text-align:center">Patient's right ← → left · FDI numbering · dashed = planned</p>
      <div class="chips" style="margin-top:8px;justify-content:center">${Object.entries(COND).filter(([k]) => c.chart.some(x => x.condition === k)).map(([k, [l, col]]) => `<span class="chip" style="border-color:${col};color:${col}">${esc(l)}</span>`).join('')}</div></section>
    <section class="panel flush">${c.chart.length ? `<table class="t"><thead><tr><th>Tooth</th><th>Finding</th><th>Status</th><th>Note</th><th>By</th><th></th></tr></thead><tbody>${c.chart.slice().sort((a, b) => a.tooth.localeCompare(b.tooth)).map(x => `<tr><td><b>${esc(x.tooth)}</b>${x.surfaces ? ` <small class="muted">${esc(x.surfaces)}</small>` : ''}</td><td><span style="color:${COND[x.condition][1]};font-weight:600">${esc(COND[x.condition][0])}</span></td>
      <td>${sel('s' + x.id, Object.entries(CSTAT), x.status, `data-st="${x.id}" style="width:auto;height:32px"`)}</td><td class="small">${esc(x.note || '')}</td><td class="small">${esc(x.recorded_by_name || '')} · ${esc(fDate(x.created_at.slice(0, 10)))}</td><td><button class="btn sm quiet icon" data-rm="${x.id}" aria-label="Remove">${icon('x', 15)}</button></td></tr>`).join('')}</tbody></table>` : emptyState('stethoscope', 'Nothing charted yet.')}</section>`;
    body.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { kids = b.dataset.k === '1'; picked.clear(); draw(); });
    body.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { const t = b.dataset.t; picked.has(t) ? picked.delete(t) : picked.add(t); draw(); });
    body.querySelector('[data-addf]').onclick = () => modal({ title: `Teeth ${[...picked].join(', ')}`, body: `<form data-f class="stack" style="gap:12px"><div class="grid2">${field('Finding', sel('condition', Object.entries(COND).map(([k, [l]]) => [k, l]), 'caries'))}${field('Status', sel('status', Object.entries(CSTAT), 'existing'))}</div>
        <div><div class="small" style="font-weight:600;margin-bottom:6px">Surfaces (optional)</div><div class="chips">${[['M', 'Mesial'], ['O', 'Occlusal'], ['D', 'Distal'], ['B', 'Buccal'], ['L', 'Lingual/Palatal'], ['I', 'Incisal']].map(([k, l]) => `<label class="chip"><input type="checkbox" name="sf.${k}">${l}</label>`).join('')}</div></div>${field('Note', inp('note', '', 'maxlength="200"'))}</form>`,
      actions: '<button class="btn ghost" data-close>Cancel</button><button class="btn" data-ok>Save</button>',
      onMount(el, close) { const ok = el.querySelector('[data-ok]'); ok.onclick = () => { const f = el.querySelector('[data-f]'), v = formData(f); const surfaces = [...f.querySelectorAll('[name^="sf."]:checked')].map(x => x.name.slice(3));
        busy(ok, () => api('/clinic/chart', { method: 'POST', body: { patient_id: p.id, teeth: [...picked], condition: v.condition, status: v.status, note: v.note, surfaces } }), true).then(() => { close(); toast('Charted'); after(); }).catch(e => toast(e.message, true)); }; } });
    body.querySelectorAll('[data-st]').forEach(x => x.onchange = () => api('/clinic/chart/' + x.dataset.st, { method: 'PUT', body: { status: x.value } }).then(() => { toast('Updated'); after(); }).catch(e => toast(e.message, true)));
    body.querySelectorAll('[data-rm]').forEach(x => x.onclick = () => confirm('Remove this entry from the chart?') && api('/clinic/chart/' + x.dataset.rm, { method: 'PUT', body: { remove: true } }).then(() => { toast('Removed'); after(); }).catch(e => toast(e.message, true)));
  };
  draw();
}

/* Treatment plans */
function plansTab(p, c, body, after) {
  body.innerHTML = `${isClin() ? `<div style="display:flex;justify-content:flex-end;margin-bottom:12px"><button class="btn gold" data-new>${icon('plus', 18)}New treatment plan</button></div>` : ''}
    ${c.plans.length ? c.plans.map(pl => `<section class="panel flush" style="margin-bottom:14px" data-plan="${pl.id}"><div class="panel-h" style="padding:16px 20px 0"><div><h3>${esc(pl.title)} ${pill(pl.status, PLST[pl.status])}</h3><p class="small muted">${pl.dept_id ? deptTag(pl.dept_id) + ' · ' : ''}${esc(pl.created_by_name || '')} · ${esc(fDate(pl.created_at.slice(0, 10)))} · total ${money(pl.total)} · billed ${money(pl.billed_total)}</p>${pl.notes ? `<p class="small" style="margin-top:4px">${esc(pl.notes)}</p>` : ''}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${['proposed', 'accepted'].includes(pl.status) && isClin() ? `<button class="btn sm ghost" data-edit="${pl.id}">${icon('pencil', 15)}Edit</button>` : ''}${pl.status === 'proposed' ? `<button class="btn sm gold" data-acc="${pl.id}">Patient accepted</button>` : ''}
        ${pl.status === 'accepted' ? `<button class="btn sm gold" data-bill="${pl.id}">${icon('receipt', 15)}Bill selected</button><button class="btn sm quiet" data-done="${pl.id}">Mark complete</button>` : ''}${['proposed', 'accepted'].includes(pl.status) ? `<button class="btn sm quiet" data-cx="${pl.id}">Cancel</button>` : ''}</div></div>
      <table class="t"><thead><tr>${pl.status === 'accepted' ? '<th></th>' : ''}<th>Stage</th><th>Treatment</th><th>Tooth / area</th><th class="n">Qty</th><th class="n">Amount</th><th>Status</th></tr></thead><tbody>${pl.items.map(x => `<tr>${pl.status === 'accepted' ? `<td>${x.billed ? '' : `<input type="checkbox" data-pick="${x.id}" checked>`}</td>` : ''}<td>${x.stage}</td><td><b>${esc(x.name)}</b>${x.note ? `<div class="small muted">${esc(x.note)}</div>` : ''}</td><td class="small">${esc(x.tooth || '')}</td><td class="n">${x.qty}</td>
        <td class="n money">${money(x.qty * x.unit_price - x.discount)}${x.discount ? `<div class="small muted">after ${money(x.discount)} off</div>` : ''}</td><td class="small">${x.billed ? `<a href="#/invoice/${x.invoice_id}">${esc(x.invoice_no || 'draft bill')}</a>` : 'Not billed'}${isClin() ? ` · <label style="white-space:nowrap"><input type="checkbox" data-dn="${x.id}" ${x.done ? 'checked' : ''}> done</label>` : x.done ? ' · done' : ''}</td></tr>`).join('')}</tbody></table></section>`).join('')
    : `<section class="panel">${emptyState('list-checks', 'No treatment plans yet.')}</section>`}`;
  const nw = body.querySelector('[data-new]'); if (nw) nw.onclick = () => planModal(p, null, after);
  body.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => planModal(p, c.plans.find(x => x.id === +b.dataset.edit), after));
  const st2 = (id, status, reason) => api(`/clinic/plans/${id}/status`, { method: 'POST', body: { status, reason } }).then(() => { toast('Updated'); after(); }).catch(e => toast(e.message, true));
  body.querySelectorAll('[data-acc]').forEach(b => b.onclick = () => st2(b.dataset.acc, 'accepted'));
  body.querySelectorAll('[data-done]').forEach(b => b.onclick = () => confirm('Mark this plan as complete?') && st2(b.dataset.done, 'completed'));
  body.querySelectorAll('[data-cx]').forEach(b => b.onclick = () => { const r = prompt('Why is this plan being cancelled?'); if (r) st2(b.dataset.cx, 'cancelled', r); });
  body.querySelectorAll('[data-dn]').forEach(x => x.onchange = () => api(`/clinic/plan-items/${x.dataset.dn}/done`, { method: 'POST', body: { done: x.checked } }).then(() => toast('Updated')).catch(e => toast(e.message, true)));
  body.querySelectorAll('[data-bill]').forEach(b => b.onclick = () => {
    const sec = body.querySelector(`[data-plan="${b.dataset.bill}"]`);
    const item_ids = [...sec.querySelectorAll('[data-pick]:checked')].map(x => +x.dataset.pick);
    if (!item_ids.length) return toast('Tick the treatments to bill.', true);
    const send = authoriser => api(`/clinic/plans/${b.dataset.bill}/bill`, { method: 'POST', body: { item_ids, authoriser } });
    busy(b, () => send().catch(e => {
      if (!(e.data && e.data.code === 'authorise')) throw e;
      return new Promise((resolve, reject) => modal({ title: 'Discount authorisation', body: `<p>${esc(e.message)}</p><form data-f class="stack" style="gap:12px">${field('Approver username', inp('username', '', 'autocapitalize="none"'))}${field('Their password', inp('password', '', 'type="password"'))}</form>`,
        actions: '<button class="btn ghost" data-close>Cancel</button><button class="btn" data-ok>Authorise</button>',
        onMount(el, close) { el.querySelector('[data-close]').addEventListener('click', () => reject(new Error('Not authorised.'))); const ok = el.querySelector('[data-ok]'); ok.onclick = () => busy(ok, () => send(formData(el.querySelector('[data-f]'))), true).then(r => { close(); resolve(r); }).catch(er => toast(er.message, true)); } }));
    })).then(r => { toast('Draft bill created'); go('#/invoice/' + r.invoice_id); }).catch(() => {});
  });
}
async function planModal(p, pl, after) {
  await catalogue();
  let items = pl ? pl.items.map(x => ({ ...x })) : [];
  modal({ title: pl ? 'Edit treatment plan' : 'New treatment plan', wide: true, body: `<form data-f class="stack" style="gap:12px"><div class="grid2">${field('Title', inp('title', pl ? pl.title : '', 'maxlength="120" placeholder="e.g. Upper arch rehabilitation"'))}${field('Department', sel('dept_id', [['', '—'], ...B.departments.map(d => [d.id, d.name])], pl ? pl.dept_id : ''))}</div>${field('Notes for the patient', inp('notes', pl ? pl.notes || '' : '', 'maxlength="500"'))}</form>
      <div style="margin-top:12px;overflow-x:auto"><table class="t"><thead><tr><th>Stage</th><th>Treatment</th><th>Tooth / area</th><th class="n">Qty</th><th class="n">Price</th><th class="n">Discount ₹</th><th></th></tr></thead><tbody data-l></tbody></table></div><div data-add style="margin-top:10px"></div><p class="small muted" data-tot style="margin-top:8px;text-align:right"></p>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn gold" data-save>Save plan</button>`,
    onMount(el, close) {
      const tb = el.querySelector('[data-l]');
      const draw = () => {
        tb.innerHTML = items.map((x, i) => { const lock = x.billed || x.done; return `<tr${lock ? ' style="opacity:.6"' : ''}><td><input class="in" data-k="stage" data-i="${i}" value="${x.stage || 1}" type="number" min="1" max="9" style="width:56px;height:34px" ${lock ? 'disabled' : ''}></td><td><b>${esc(x.name)}</b>${lock ? '<div class="small muted">billed / done — kept as is</div>' : ''}</td>
          <td><input class="in" data-k="tooth" data-i="${i}" value="${esc(x.tooth || '')}" placeholder="e.g. 16, 26" style="width:110px;height:34px" ${lock ? 'disabled' : ''}></td><td class="n"><input class="in" data-k="qty" data-i="${i}" value="${x.qty || 1}" type="number" min="1" style="width:60px;height:34px;text-align:right" ${lock ? 'disabled' : ''}></td>
          <td class="n"><input class="in" data-k="unit_price" data-i="${i}" value="${x.unit_price}" type="number" min="0" style="width:96px;height:34px;text-align:right" ${lock ? 'disabled' : ''}></td><td class="n"><input class="in" data-k="discount" data-i="${i}" value="${x.discount || 0}" type="number" min="0" style="width:90px;height:34px;text-align:right" ${lock ? 'disabled' : ''}></td>
          <td>${lock ? '' : `<button type="button" class="btn sm quiet icon" data-rm="${i}" aria-label="Remove">${icon('x', 15)}</button>`}</td></tr>`; }).join('') || '<tr><td colspan="7" class="muted">Add treatments below.</td></tr>';
        el.querySelector('[data-tot]').textContent = 'Plan total (before GST): ' + money(items.reduce((s, x) => s + (Number(x.qty) || 1) * (Number(x.unit_price) || 0) - (Number(x.discount) || 0), 0));
        tb.querySelectorAll('[data-k]').forEach(x => x.onchange = () => { items[+x.dataset.i][x.dataset.k] = x.dataset.k === 'tooth' ? x.value : Number(x.value) || 0; draw(); });
        tb.querySelectorAll('[data-rm]').forEach(x => x.onclick = () => { items.splice(+x.dataset.rm, 1); draw(); });
      };
      draw();
      itemPicker(el.querySelector('[data-add]'), it => { items.push({ item_id: it.id, name: it.name, qty: 1, unit_price: it.price, discount: 0, stage: items.length ? items[items.length - 1].stage || 1 : 1, tooth: '' }); draw(); }, { placeholder: 'Add a treatment — type a name or code' });
      const s = el.querySelector('[data-save]');
      s.onclick = () => busy(s, () => api(pl ? '/clinic/plans/' + pl.id : '/clinic/plans', { method: pl ? 'PUT' : 'POST', body: { ...formData(el.querySelector('[data-f]')), patient_id: p.id, items } }), true).then(() => { close(); toast('Plan saved'); after(); }).catch(e => toast(e.message, true));
    } });
}

/* Photos */
function photosTab(p, c, body, after) {
  const src = id => `${BASE}/api/clinic/photos/${id}`;
  body.innerHTML = `<section class="panel" style="margin-bottom:14px"><form data-f class="stack" style="gap:10px"><div class="grid3">${field('Photo', '<input class="in" type="file" name="file" accept="image/*" capture="environment" style="padding:8px">')}${field('Type', sel('tag', Object.entries(PHT), 'before'))}${field('Taken on', inp('taken_on', today(), 'type="date"'))}</div>
      <div class="grid2">${field('Area', inp('area', '', 'maxlength="60" placeholder="e.g. Face, Scalp crown, Upper arch"'))}${field('Caption', inp('caption', '', 'maxlength="200"'))}</div></form>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;gap:8px;flex-wrap:wrap"><span class="small muted">Photos are private to clinicians and are not shown to patients or front-desk staff. Ask for the patient's consent before taking them.</span><button class="btn gold" data-up>${icon('upload', 18)}Upload</button></div></section>
    ${c.photos.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px">${c.photos.map(x => `<figure class="panel" style="padding:8px;margin:0"><img src="${src(x.id)}" alt="" loading="lazy" data-big="${x.id}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;cursor:zoom-in"><figcaption class="small" style="margin-top:6px"><b>${esc(PHT[x.tag] || x.tag)}</b>${x.area ? ' · ' + esc(x.area) : ''}<div class="muted">${esc(fDate(x.taken_on || x.created_at.slice(0, 10)))} · ${esc(x.uploaded_by_name || '')}</div>${x.caption ? `<div>${esc(x.caption)}</div>` : ''}<button class="btn sm quiet" data-del="${x.id}" style="margin-top:4px">Delete</button></figcaption></figure>`).join('')}</div>`
    : `<section class="panel">${emptyState('eye', 'No photos yet.')}</section>`}`;
  body.querySelector('[data-up]').onclick = e => {
    const f = body.querySelector('[data-f]'), file = f.file.files[0], v = formData(f);
    if (!file) return toast('Choose a photo first.', true);
    busy(e.currentTarget, async () => {
      const blob = await shrink(file);
      const qs = new URLSearchParams({ patient_id: p.id, tag: v.tag, taken_on: v.taken_on, area: v.area, caption: v.caption });
      const res = await fetch(`${BASE}/api/clinic/photos?${qs}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': blob.type }, body: blob });
      const d = await res.json(); if (!d.ok) throw new Error(d.error || 'Upload failed.'); return d;
    }).then(() => { toast('Photo added'); after(); }).catch(er => toast(er.message, true));
  };
  body.querySelectorAll('[data-big]').forEach(im => im.onclick = () => modal({ title: 'Photo', wide: true, body: `<img src="${src(im.dataset.big)}" alt="" style="width:100%;border-radius:10px">`, actions: '<button class="btn ghost" data-close>Close</button>' }));
  body.querySelectorAll('[data-del]').forEach(b => b.onclick = () => confirm('Delete this photo permanently?') && api('/clinic/photos/' + b.dataset.del, { method: 'DELETE' }).then(() => { toast('Deleted'); after(); }).catch(er => toast(er.message, true)));
}
// Resize to at most 1600 px on the long side and re-encode as JPEG, so uploads stay small.
function shrink(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { const k = Math.min(1, 1600 / Math.max(img.width, img.height)); const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url); cv.toBlob(b => b ? resolve(b) : reject(new Error('Could not read the photo.')), 'image/jpeg', 0.85); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a photo this browser can read.')); };
    img.src = url;
  });
}

/* Follow-ups (recalls) */
function followupsTab(p, c, body, after) {
  const RST = { open: 'To call', booked: 'Booked', done: 'Done', dismissed: 'Dismissed' };
  body.innerHTML = `<section class="panel" style="margin-bottom:14px"><form data-f class="stack" style="gap:10px"><div class="grid3">${field('Call back on', inp('due_date', addDays(today(), 30), 'type="date"'))}${field('For', inp('reason', '', 'maxlength="200" placeholder="e.g. 6-month cleaning, PRP session 3"'))}${field('Department', sel('dept_id', [['', '—'], ...B.departments.map(d => [d.id, d.name])], ''))}</div></form><button class="btn gold" data-add style="margin-top:10px">${icon('plus', 18)}Add follow-up</button></section>
    <section class="panel flush">${c.recalls.length ? `<table class="t"><thead><tr><th>Due</th><th>For</th><th>Status</th><th>Outcome</th><th>Added by</th></tr></thead><tbody>${c.recalls.map(r => `<tr><td${r.status === 'open' && r.due_date <= today() ? ' style="color:var(--alert);font-weight:700"' : ''}>${esc(fDate(r.due_date))}</td><td>${esc(r.reason)}${r.dept_id ? ' ' + deptTag(r.dept_id) : ''}</td><td>${pill(r.status, RST[r.status])}</td><td class="small">${esc(r.outcome || '')}</td><td class="small">${esc(r.created_by_name || '')}</td></tr>`).join('')}</tbody></table>` : emptyState('bell', 'No follow-ups.')}</section>`;
  const b = body.querySelector('[data-add]');
  b.onclick = () => busy(b, () => api('/clinic/recalls', { method: 'POST', body: { ...formData(body.querySelector('[data-f]')), patient_id: p.id } })).then(() => { toast('Follow-up added'); after(); }).catch(() => {});
}
function recallRows(root, list, after, compact) {
  root.innerHTML = list.map(r => `<div class="row" style="flex-wrap:wrap"><div class="grow" style="min-width:220px"><b><a href="#/patient/${r.patient_id}?tab=followups">${esc(r.patient_name)}</a> <small class="muted">${esc(r.patient_no)}</small></b><span>${esc(r.reason)}${r.dept_name ? ' · ' + esc(r.dept_name) : ''} · due <b${r.due_date < today() ? ' style="color:var(--alert)"' : ''}>${esc(fDate(r.due_date))}</b>${r.next_appt ? ` · next visit ${esc(fDate(r.next_appt.slice(0, 10)))}` : ''}${r.outcome ? ` · ${esc(r.outcome)}` : ''}</span></div>
    <a class="btn sm ghost icon" href="tel:+91${esc(r.patient_phone)}" aria-label="Call">${icon('phone', 16)}</a><a class="btn sm ghost icon" href="${wa(r.patient_phone, `Hello ${first(r.patient_name)}, this is Hasta Wellness. It's time for your ${r.reason.toLowerCase()}. Shall we book a convenient time?`)}" target="_blank" rel="noopener" aria-label="WhatsApp">${icon('message-circle', 16)}</a>
    <button class="btn sm gold" data-rbook="${r.id}">${icon('calendar-plus', 15)}Book</button><button class="btn sm quiet" data-rlater="${r.id}">Later</button><button class="btn sm quiet" data-rdone="${r.id}">Close</button></div>`).join('');
  const find = id => list.find(r => r.id === +id);
  const upd = (id, body2) => api('/clinic/recalls/' + id, { method: 'PUT', body: body2 }).then(() => { toast('Updated'); after(); }).catch(e => toast(e.message, true));
  root.querySelectorAll('[data-rbook]').forEach(b => b.onclick = async () => { const r = find(b.dataset.rbook); const pt = (await api('/clinic/patients/' + r.patient_id)).patient; apptModal({ dept_id: r.dept_id, reason: r.reason }, () => upd(r.id, { status: 'booked', outcome: 'Booked' }), pt); });
  root.querySelectorAll('[data-rlater]').forEach(b => b.onclick = () => { const r = find(b.dataset.rlater); const note = prompt('What happened? (e.g. No answer, will call next week)'); if (note === null) return; upd(r.id, { due_date: addDays(today(), 7), outcome: note || 'Try again' }); });
  root.querySelectorAll('[data-rdone]').forEach(b => b.onclick = () => { const r = find(b.dataset.rdone); const note = prompt('Close this follow-up — outcome? (e.g. Not interested, already visited)'); if (note === null) return; upd(r.id, { status: 'dismissed', outcome: note || 'Closed' }); });
}
