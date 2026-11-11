// Hasta Clinic — staff app (clinicapp.hastawellnessclinic.com)
import {
  api, esc, icon, toast, modal, formData, busy, field, inp, sel, emptyState, today, nowLocal, addDays, fDay, fDate, fLong, fTime, fWhen,
  inr, initials, first, prettyPhone, wa, pill, BASE, CLINIC_PHONE,
} from '../ems/core.js?v=8';

const app = document.getElementById('app');
let ME, B, MAIN, CAT = null;
const NAV = [['', 'layout-dashboard', 'Today'], ['appointments', 'calendar-days', 'Appointments'], ['patients', 'users', 'Patients'], ['billing', 'receipt', 'Billing'],
  ['payments', 'wallet', 'Payments'], ['leads', 'inbox', 'Leads'], ['reports', 'line-chart', 'Reports']];
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
const canManage = () => ME.admin || ME.role === 'manager';
const TIMES = (() => { const o = []; for (let h = 8; h < 22; h++) for (const m of [0, 15, 30, 45]) o.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`); return o; })();

/* ---------------- start & login ---------------- */
async function start() {
  let me = null;
  try { ({ me } = await api('/me')); } catch (e) { app.innerHTML = `<div class="boot"><p class="err">${esc(e.message)}</p></div>`; return; }
  if (!me || me.kind !== 'staff') return login();
  try { B = await api('/clinic/boot'); ME = B.me; }
  catch (e) {
    app.innerHTML = `<div class="auth"><section class="auth-panel" style="grid-column:1/-1"><div class="auth-box">${emptyState('lock', e.message)}<button class="btn ghost" data-out>${icon('log-out', 18)}Sign out</button></div></section></div>`;
    app.querySelector('[data-out]').onclick = signOut; return;
  }
  mount();
}
async function signOut() { await api('/auth/logout', { method: 'POST', body: {} }).catch(() => {}); location.hash = ''; location.reload(); }
function login() {
  app.innerHTML = `<div class="auth"><section class="auth-art">
      <div class="brand"><img src="/img/hasta-emblem.webp" alt="" width="44" height="44"><div><b style="font-family:Manrope;font-size:16px">Hasta Wellness</b><div style="font-size:13px;color:#9fb8b4">Clinic</div></div></div>
      <div><h1>Every visit, bill and payment in one place.</h1><p class="lede">Dental, skin, hair and wellness — appointments, GST billing, packages and collections for the Hasta team.</p></div>
      <ul><li>${icon('calendar-days', 20)}Appointments by clinician and room</li><li>${icon('receipt', 20)}GST invoices with packages and discounts</li><li>${icon('wallet', 20)}Payments, advances and cash deposits</li></ul></section>
    <section class="auth-panel"><div class="auth-box"><div><h2>Team sign in</h2><p class="muted" style="margin-top:6px">Use the same username and password as the EMS app.</p></div>
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
    <nav class="nav" aria-label="Main">${NAV.map(([k, ic, l]) => `<a href="#/${k}" data-k="${k}">${icon(ic, 20)}<span>${l}</span>${k === 'leads' ? '<i class="badge" data-b hidden></i>' : ''}</a>`).join('')}
      <div class="nav-sep"></div><a href="#/settings" data-k="settings">${icon('settings', 20)}<span>Settings</span></a></nav>
    <div class="me"><span class="avatar">${esc(initials(ME.name))}</span><div><b>${esc(ME.name)}</b><span>${ME.admin ? 'Admin' : ME.role === 'manager' ? 'Manager' : 'Team'}</span></div>
      <button data-logout aria-label="Sign out" title="Sign out">${icon('log-out', 18)}</button></div>
  </aside><div class="mainwrap"><main class="main" id="main"></main></div></div>`;
  MAIN = app.querySelector('#main');
  app.querySelector('[data-logout]').onclick = signOut;
  window.addEventListener('hashchange', route);
  route();
}
const go = h => { if (location.hash === h) route(); else location.hash = h; };
function parseHash() { const [p, q] = location.hash.replace(/^#\/?/, '').split('?'); return { parts: p.split('/').filter(Boolean), q: new URLSearchParams(q || '') }; }
async function refreshBoot() { B = await api('/clinic/boot'); ME = B.me; CAT = null; }
async function route() {
  const { parts, q } = parseHash(), top = parts[0] || '';
  app.querySelectorAll('.nav a').forEach(a => a.classList.toggle('on', a.dataset.k === top || (top === 'invoice' && a.dataset.k === 'billing') || (top === 'patient' && a.dataset.k === 'patients')));
  MAIN.innerHTML = '<div class="boot" style="min-height:50vh"><img src="/img/hasta-emblem.webp" alt="" width="44" height="44"></div>';
  window.scrollTo(0, 0);
  try {
    if (!top) await viewToday();
    else if (top === 'appointments') await viewAppointments(q.get('d') || today(), q.get('dept'));
    else if (top === 'patients') await viewPatients(q.get('q') || '');
    else if (top === 'patient') await viewPatient(+parts[1], q.get('tab') || 'visits');
    else if (top === 'invoice') await viewInvoice(+parts[1]);
    else if (top === 'billing') await viewBilling(q.get('f') || 'today');
    else if (top === 'payments') await viewPayments(q.get('from') || today(), q.get('to') || today());
    else if (top === 'leads') await viewLeads(q.get('s') || 'open');
    else if (top === 'reports') await viewReports(q.get('tab') || 'day', q.get('d'), q.get('m'));
    else if (top === 'settings') await viewSettings(q.get('tab') || (isAdmin() ? 'clinic' : 'account'));
    else MAIN.innerHTML = emptyState('info', 'Page not found.');
  } catch (e) { MAIN.innerHTML = `<section class="panel">${emptyState('alert-triangle', e.message)}</section>`; }
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

/* ---------------- Today ---------------- */
async function viewToday() {
  const d = await api('/clinic/dashboard');
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
    ${d.unclosed.length ? `<section class="panel flush" style="margin-bottom:18px;border-color:#e6c3bc"><div class="panel-h" style="padding:16px 20px 0"><div class="t">${icon('alert-triangle', 20)}<div><h3>Visits to close</h3><p class="small muted">Completed visits must be billed, covered by a package, or marked no charge.</p></div></div></div>
      <div class="rows">${d.unclosed.map(a => closeRow(a)).join('')}</div></section>` : ''}
    <section class="panel flush"><div class="panel-h" style="padding:16px 20px 0"><div class="t">${icon('calendar-days', 20)}<h3>Today's appointments</h3></div><a class="btn quiet sm" href="#/appointments">Calendar ${icon('chevron-right', 16)}</a></div>
      <div class="rows">${d.appointments.length ? d.appointments.map(a => apptRow(a)).join('') : emptyState('calendar-days', 'No appointments today.')}</div></section>`;
  MAIN.querySelector('[data-newp]').onclick = () => patientModal({}, p => go('#/patient/' + p.id));
  MAIN.querySelector('[data-newa]').onclick = () => apptModal({}, () => route());
  wireApptRows(MAIN, d.appointments.concat(d.unclosed), () => route());
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
async function viewAppointments(d, deptFilter) {
  const deptId = parseInt(deptFilter, 10) || null;
  const { appointments } = await api(`/clinic/appointments?from=${d}&to=${d}`);
  const dow = new Date(d + 'T00:00:00Z').getUTCDay(), [open, close] = B.hours[dow];
  const startH = Math.min(+open.slice(0, 2), ...appointments.map(a => +a.start_at.slice(11, 13))), endH = Math.max(+close.slice(0, 2), ...appointments.map(a => Math.ceil((+a.start_at.slice(11, 13) * 60 + +a.start_at.slice(14, 16) + a.minutes) / 60)));
  let cols = clinicians(deptId);
  const extra = [...new Set(appointments.map(a => a.doctor_id).filter(id => id && !cols.some(c => c.id === id)))].map(id => B.team.find(t => t.id === id)).filter(Boolean);
  cols = cols.concat(extra).map(c => ({ id: c.id, name: c.name, sub: c.depts.map(x => (dept(x) || {}).name).filter(Boolean).join(', ') }));
  cols.push({ id: 0, name: 'No clinician', sub: 'unassigned' });
  const shown = appointments.filter(a => !deptId || a.dept_id === deptId);
  const slotsPerH = 4, px = 22, rows = (endH - startH) * slotsPerH;
  const top = s => ((+s.slice(11, 13) - startH) * 60 + +s.slice(14, 16)) / 15 * px;
  MAIN.innerHTML = `<div class="head"><div><h1>Appointments</h1><p>${esc(fLong(d))}</p></div>
      <div class="acts" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <select class="in" data-dept style="width:auto">${[['', 'All departments'], ...B.departments.filter(x => x.active).map(x => [x.id, x.name])].map(([v, l]) => `<option value="${v}"${String(v) === String(deptId || '') ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
        <button class="btn ghost icon" data-prev aria-label="Previous day">${icon('chevron-left', 18)}</button><input class="in" type="date" value="${d}" data-date style="width:auto"><button class="btn ghost icon" data-nextd aria-label="Next day">${icon('chevron-right', 18)}</button>
        <button class="btn ghost" data-today>Today</button><button class="btn gold" data-new>${icon('calendar-plus', 18)}New</button></div></div>
    <div class="cal" style="grid-template-columns:58px repeat(${cols.length}, minmax(150px,1fr))">
      <div class="cal-h time"></div>${cols.map(c => `<div class="cal-h">${esc(c.name)}<small>${esc(c.sub)}</small></div>`).join('')}
      <div class="cal-t">${Array.from({ length: rows }, (_, i) => `<div style="height:${px}px;${i % 4 ? '' : 'transform:translateY(-6px)'}">${i % 4 ? '' : esc(fTime(`${String(startH + i / 4).padStart(2, '0')}:00`))}</div>`).join('')}</div>
      ${cols.map(c => `<div class="cal-col" data-col="${c.id}">${Array.from({ length: rows }, (_, i) => { const t = `${String(startH + Math.floor(i / 4)).padStart(2, '0')}:${String(i % 4 * 15).padStart(2, '0')}`; return `<div class="cal-slot${i % 4 ? '' : ' hr'}${t < open || t >= close ? ' closed' : ''}" data-t="${t}"></div>`; }).join('')}
        ${shown.filter(a => (a.doctor_id || 0) === c.id || (c.id === 0 && a.doctor_id && !cols.some(x => x.id === a.doctor_id))).map(a => `<div class="appt st-${a.status}" data-open="${a.id}" style="--c:${esc(a.dept_colour || '#34595e')};top:${top(a.start_at)}px;height:${Math.max(px - 2, a.minutes / 15 * px - 3)}px">
          <b>${esc(fTime(a.start_at))} ${esc(a.patient_name)}</b><span>${esc(a.reason || a.dept_name || '')}${a.room_name ? ' · ' + esc(a.room_name) : ''}</span><span>${esc(ST[a.status])}${a.closure ? ' · ' + esc(ST[a.closure]) : ''}</span></div>`).join('')}</div>`).join('')}
    </div><p class="small muted" style="margin-top:10px">Click an empty slot to book with that clinician. Clinicians appear here once they are given departments in Settings → Team.</p>`;
  const nav = (dd, dp = deptId) => go(`#/appointments?d=${dd}${dp ? '&dept=' + dp : ''}`);
  MAIN.querySelector('[data-prev]').onclick = () => nav(addDays(d, -1));
  MAIN.querySelector('[data-nextd]').onclick = () => nav(addDays(d, 1));
  MAIN.querySelector('[data-today]').onclick = () => nav(today());
  MAIN.querySelector('[data-date]').onchange = e => e.target.value && nav(e.target.value);
  MAIN.querySelector('[data-dept]').onchange = e => nav(d, e.target.value);
  MAIN.querySelector('[data-new]').onclick = () => apptModal({ start_at: d + 'T10:00', dept_id: deptId }, () => route());
  MAIN.querySelectorAll('.cal-slot:not(.closed)').forEach(s => s.onclick = () => { const col = +s.parentElement.dataset.col; const docDepts = col ? (B.team.find(t => t.id === col) || {}).depts || [] : []; apptModal({ start_at: `${d}T${s.dataset.t}`, doctor_id: col || null, dept_id: deptId || (docDepts.length === 1 ? docDepts[0] : null) }, () => route()); });
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
    actions: `${!closed || canManage() ? `<button class="btn quiet" data-edit>${icon('pencil', 16)}Edit / reschedule</button>` : ''}
      ${!closed ? '<button class="btn quiet" data-ns>No-show</button><button class="btn quiet" data-cx>Cancel</button>' : ''}
      ${a.status === 'completed' && !a.closure ? `<button class="btn ghost" data-pkg>${icon('package', 16)}Use package</button><button class="btn gold" data-bill>${icon('receipt', 16)}Bill</button>` : ''}
      ${next ? `<button class="btn" data-next="${next[0]}">${next[1]}</button>` : ''}`,
    onMount(el, close) {
      const set = (s, msg) => api(`/clinic/appointments/${a.id}/status`, { method: 'POST', body: { status: s } }).then(() => { close(); toast(msg); s === 'completed' ? closeVisitModal(a, after) : after(); }).catch(e => toast(e.message, true));
      el.querySelector('[data-edit]') && (el.querySelector('[data-edit]').onclick = () => { close(); apptModal(a, after); });
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
  const TABS = [['visits', 'calendar-days', 'Visits'], ['invoices', 'receipt', 'Invoices'], ['payments', 'wallet', 'Payments'], ['packages', 'package', 'Packages'], ['details', 'user', 'Details']];
  const age = p.dob ? Math.floor((Date.now() - new Date(p.dob)) / 31557600000) : null;
  MAIN.innerHTML = `<a href="#/patients" class="crumb">${icon('arrow-left', 16)}Patients</a>
    <div class="head"><div style="display:flex;gap:16px;align-items:center"><span class="avatar" style="width:56px;height:56px;font-size:20px">${esc(initials(p.name))}</span><div><h1>${esc(p.name)}</h1>
      <p>${esc(p.patient_no)} · <a href="tel:+91${esc(p.phone)}">${esc(prettyPhone(p.phone))}</a>${age != null ? ` · ${age} yrs` : ''}${p.gender ? ', ' + esc(p.gender) : ''}${d.ems_client ? ` · <span class="pill active">EMS client</span>` : ''}${d.lead ? ` · from website (${esc(d.lead.interest || '')})` : ''}</p></div></div>
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
    body.innerHTML = `<section class="panel flush"><div class="rows">${d.appointments.length ? d.appointments.map(a => apptRow(a)).join('') : emptyState('calendar-days', 'No visits yet.')}</div></section>`;
    await catalogue(); wireApptRows(body, d.appointments, after);
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
  let lines = d.lines.map(l => ({ item_id: l.item_id, package_def_id: l.package_def_id, qty: l.qty, unit_price: l.unit_price, discount: l.discount, discount_reason: l.discount_reason || '', doctor_id: l.doctor_id, name: l.name, _saved: l }));
  const limit = Number(B.settings.discount_limit_pct) || 0;
  const docs = B.team.filter(t => t.active && t.depts.length);
  MAIN.innerHTML = `<a href="#/patient/${inv.patient_id}?tab=invoices" class="crumb">${icon('arrow-left', 16)}${esc(inv.patient_name)}</a>
    <div class="head"><div><h1>${draft ? 'Draft bill' : esc(inv.invoice_no)}</h1><p>${esc(inv.patient_name)} · ${esc(inv.patient_no)} · ${esc(fDate(inv.invoice_date))} ${st(inv.status)}</p></div>
      <div class="acts" style="display:flex;gap:8px;flex-wrap:wrap">${draft ? `<button class="btn quiet" data-del>${icon('trash-2', 16)}Delete draft</button><button class="btn ghost" data-save>Save draft</button><button class="btn gold" data-final>${icon('check', 18)}Finalise invoice</button>`
        : `${inv.legacy ? '<span class="small muted" style="align-self:center">Brought forward from the previous system</span>' : `<a class="btn ghost" href="${BASE}/api/clinic/invoices/${id}/pdf" target="_blank" rel="noopener">${icon('printer', 18)}PDF</a>`}${inv.status === 'final' && canManage() ? '<button class="btn quiet" data-cancel>Cancel invoice</button>' : ''}${inv.status === 'final' && inv.balance > 0 && d.advance > 0 ? `<button class="btn ghost" data-adv>Apply advance (${money(d.advance)})</button>` : ''}${inv.status === 'final' && inv.balance > 0 ? `<button class="btn gold" data-pay>${icon('wallet', 18)}Take payment</button>` : ''}`}</div></div>
    ${inv.status === 'cancelled' ? `<div class="alertline" style="margin-bottom:14px">Cancelled: ${esc(inv.cancel_reason || '')}</div>` : ''}
    <section class="panel flush"><table class="t inv-lines"><thead><tr><th>Item</th><th>Clinician</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">Discount (₹)</th><th class="n">GST</th><th class="n">Amount</th>${draft ? '<th></th>' : ''}</tr></thead><tbody data-lines></tbody></table>
      ${draft ? `<div style="padding:14px 16px;border-top:1px solid var(--line-soft);display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:10px"><div data-add></div>${sel('addpkg', [['', '+ Add a package'], ...B.packages.filter(x => x.active).map(x => [x.id, `${x.name} — ${money(x.price)}`])])}</div>` : ''}
      <div style="padding:16px 20px;border-top:1px solid var(--line-soft);display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px;align-items:end">
        <div>${draft ? field('Note on invoice', inp('notes', inv.notes || '', 'maxlength="300" data-notes')) : inv.notes ? `<p class="small muted">${esc(inv.notes)}</p>` : ''}${draft ? `<p class="small muted" style="margin-top:8px">Discounts above ${limit}% need a doctor or admin to authorise. Prices exclude GST.</p>` : ''}</div>
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
      const variable = it && !(it.price > 0);
      return `<tr data-i="${i}"><td><b>${esc(pk ? pk.name : it ? it.name : l.name)}</b><div class="small muted">${pk ? 'Package' : esc(it?.dept_name || '')}${it?.kind === 'passthrough' ? ' · partner charge' : ''}</div>
          ${c.disc > 0 ? `<input class="in" data-k="discount_reason" value="${esc(l.discount_reason)}" placeholder="Reason for discount" maxlength="120" style="margin-top:6px;height:32px">${c.pct > limit + 1e-9 ? `<div class="small" style="color:var(--gold-ink);margin-top:4px">${c.pct.toFixed(0)}% — ${l._saved && l._saved.discount_by_name && l._saved.discount >= c.disc ? 'authorised by ' + esc(l._saved.discount_by_name) : 'needs a doctor or admin to authorise'}</div>` : ''}` : ''}</td>
        <td>${pk ? '' : `<select class="in" data-k="doctor_id" style="min-width:130px"><option value="">—</option>${docs.map(t => `<option value="${t.id}"${t.id === l.doctor_id ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`}</td>
        <td class="n"><input class="in qty" type="number" min="1" max="999" data-k="qty" value="${l.qty}"></td>
        <td class="n">${variable ? `<input class="in amt" type="number" min="0" step="0.01" data-k="unit_price" value="${l.unit_price || ''}" placeholder="price">` : `<span class="money">${money(c.unit)}</span>`}</td>
        <td class="n"><input class="in amt" type="number" min="0" step="0.01" data-k="discount" value="${l.discount || ''}" placeholder="0"></td>
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
      return new Promise((resolve, reject) => modal({ title: 'Discount authorisation', body: `<p>${esc(e.message)}</p><form data-f class="stack" style="gap:12px">${field('Doctor or admin username', inp('username', '', 'autocapitalize="none"'))}${field('Their password', inp('password', '', 'type="password"'))}</form><p class="small muted">Their name is recorded on the invoice line.</p>`,
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
async function viewLeads(s) {
  const { leads } = await api('/clinic/leads?status=' + encodeURIComponent(s));
  const F = [['open', 'To follow up'], ['booked', 'Booked'], ['not interested', 'Not interested'], ['all', 'All']];
  MAIN.innerHTML = `<div class="head"><div><h1>Leads</h1><p>Enquiries from hastawellnessclinic.com for every service. EMS enquiries are also in the EMS app.</p></div></div>
    <div class="seg" style="margin-bottom:14px">${F.map(([k, l]) => `<button data-s="${esc(k)}" class="${k === s ? 'on' : ''}">${l}</button>`).join('')}</div>
    <section class="panel flush"><div class="rows">${leads.length ? leads.map(l => `<div class="row" style="flex-wrap:wrap"><span class="avatar">${esc(initials(l.name))}</span><div class="grow" style="min-width:220px"><b>${esc(l.name)} ${l.status === 'new' ? pill('new', 'New') : ''}</b>
        <span>${esc(l.interest || 'Not specified')}${l.concern ? ' — ' + esc(l.concern) : ''}</span><span class="small muted">${esc(l.created_at ? fWhen(new Date(new Date(l.created_at).getTime() + 330 * 60000).toISOString().slice(0, 16)) : '')} · ${esc(l.source || '')}${l.preferred_date ? ' · prefers ' + esc(l.preferred_date) : ''}${l.timing ? ' · ' + esc(l.timing) : ''}</span></div>
      <a class="btn sm ghost icon" href="tel:${esc(l.phone)}" aria-label="Call">${icon('phone', 16)}</a><a class="btn sm ghost icon" href="${wa(l.phone, `Hello ${first(l.name)}, this is Hasta Wellness about your enquiry.`)}" target="_blank" rel="noopener" aria-label="WhatsApp">${icon('message-circle', 16)}</a>
      ${l.patient_id ? `<a class="btn sm ghost" href="#/patient/${l.patient_id}">Open patient</a>` : `<button class="btn sm gold" data-conv="${l.id}">${icon('user-plus', 15)}Add as patient</button>`}
      <select class="in" data-st="${l.id}" style="width:auto;height:32px">${['new', 'contacted', 'booked', 'not interested'].map(x => `<option${x === l.status ? ' selected' : ''}>${x}</option>`).join('')}</select></div>`).join('') : emptyState('inbox', 'No leads here.')}</div></section>`;
  MAIN.querySelectorAll('[data-s]').forEach(b => b.onclick = () => go('#/leads?s=' + encodeURIComponent(b.dataset.s)));
  MAIN.querySelectorAll('[data-st]').forEach(x => x.onchange = () => api('/clinic/leads/' + x.dataset.st, { method: 'PUT', body: { status: x.value } }).then(() => toast('Updated')).catch(e => toast(e.message, true)));
  MAIN.querySelectorAll('[data-conv]').forEach(b => b.onclick = () => { const l = leads.find(x => x.id === +b.dataset.conv); patientModal({ name: l.name, phone: String(l.phone || '').replace(/\D/g, '').slice(-10), lead_id: l.id }, p => go('#/patient/' + p.id)); });
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
      <div class="grid3">${field('Phone', inp('phone', v.phone))}${field('Email', inp('email', v.email))}${field('Discount without authorisation (%)', inp('discount_limit_pct', v.discount_limit_pct, 'type="number" min="0" max="100"'), 'higher needs a doctor or admin')}</div>
      ${field('Invoice footer', inp('invoice_footer', v.invoice_footer, 'maxlength="300"'))}</form><button class="btn" data-save style="margin-top:14px">Save</button></section>`;
    const s = body.querySelector('[data-save]'); s.onclick = () => busy(s, () => api('/clinic/settings', { method: 'PUT', body: formData(body.querySelector('[data-f]')) })).then(() => { toast('Saved'); reload(); }).catch(() => {});
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
