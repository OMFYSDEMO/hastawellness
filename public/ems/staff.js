import {
  api, esc, icon, toast, modal, formData, busy, field, inp, sel, emptyState, slotPicker, lineChart, barChart, insightList, deltaTag,
  measureSeries, dietView, DIETS, SCREENING, today, nowLocal, addDays, dayDiff, fDay, fDate, fWeekday, fLong, fTime, fWhen, inr, kg, initials, first,
  ageFrom, prettyPhone, wa, pill, KIND_LABEL, APP_URL, BASE,
  includesText, PROGRAMME_LABEL, ADM_LABEL, admState, admPill, admSteps, letterBox, screeningForm, readScreening, sigPad,
  toIn, cmIn, ftIn, lenField, wireLen, lenToCm } from './core.js?v=8';
import { viewAcademy } from './academy.js?v=8';

let ME, APP, MAIN, BADGES = {}, TEAM = null, UNITS = [], ALL_UNITS = [], UNIT = null, SKILLS = {}, MACHINES = [], CATEGORIES = [];
const machineName = id => (MACHINES.find(m => m.id === id) || {}).name || 'Unknown machine';
const machineList = json => { try { const v = typeof json === 'string' ? JSON.parse(json || '[]') : (json || []); return Array.isArray(v) ? v.map(Number) : []; } catch { return []; } };
const multi = () => UNITS.length > 1;
const U = (path) => UNIT ? path + (path.includes('?') ? '&' : '?') + 'unit=' + UNIT : path;
const unitName = id => (ALL_UNITS.find(u => u.id === id) || {}).name || '';
const unitOpts = (list = UNITS) => list.map(u => [u.id, u.name]);
async function team(fresh = false) { if (!TEAM || fresh) TEAM = (await api('/staff/team')).team; return TEAM; }
const coachOptions = (list, value) => [['', 'Not allocated']].concat(list.map(t => [t.id, t.name + (t.role === 'admin' ? ' (admin)' : '')]));
const NAV = [
  ['', 'layout-dashboard', 'Dashboard'], ['schedule', 'calendar-days', 'Schedule'], ['clients', 'users', 'Clients'],
  ['rota', 'clock', 'Rota'], ['leads', 'inbox', 'Website leads', 'new_leads'], ['reminders', 'bell', 'Follow-ups', 'reminders'], ['payments', 'wallet', 'Payments'], ['academy', 'graduation-cap', 'Academy'],
];

export function mount(app, me) {
  ME = me; APP = app;
  app.innerHTML = `<div class="shell"><aside class="side">
    <div class="brand"><img src="/img/hasta-emblem.webp" alt="" width="34" height="34"><div><b>Hasta EMS</b><span>Progress Studio</span></div></div>
    <nav class="nav" aria-label="Main">${NAV.map(([k, ic, l, b]) => `<a href="#/${k}" data-k="${k}">${icon(ic, 20)}<span>${l}</span>${b ? `<i class="badge" data-b="${b}" hidden></i>` : ''}</a>`).join('')}
      <div class="nav-sep"></div><a href="#/settings" data-k="settings">${icon('settings', 20)}<span>Settings</span></a></nav>
    <div class="me"><span class="avatar">${esc(initials(me.name))}</span><div><b>${esc(me.name)}</b><span>${me.role === 'admin' ? 'Admin' : 'Team'}</span></div>
      <button data-logout aria-label="Sign out" title="Sign out">${icon('log-out', 18)}</button></div>
  </aside><div class="mainwrap"><div class="unitbar" hidden><span>${icon('home', 16)}</span><select class="in" data-unit aria-label="Unit"></select></div><main class="main" id="main"></main></div></div>`;
  MAIN = app.querySelector('#main');
  app.querySelector('[data-logout]').addEventListener('click', async () => { await api('/auth/logout', { method: 'POST', body: {} }); location.hash = ''; location.reload(); });
  window.addEventListener('hashchange', route);
  loadUnits().then(() => { route(); refreshBadges(); });
}

async function loadUnits() {
  const [r, mr] = await Promise.all([api('/staff/units'), api('/staff/machines')]);
  UNITS = r.units; ALL_UNITS = r.all_units; SKILLS = r.skills; MACHINES = mr.machines; CATEGORIES = mr.categories;
  let saved = null;
  try { saved = parseInt(localStorage.getItem('ems_unit'), 10); } catch {}
  UNIT = UNITS.some(u => u.id === saved) ? saved : (UNITS.length === 1 ? UNITS[0].id : null);
  const bar = APP.querySelector('.unitbar'), sel = bar.querySelector('select');
  bar.hidden = UNITS.length < 2;
  sel.innerHTML = `<option value="">All my units (${UNITS.length})</option>` + UNITS.map(u => `<option value="${u.id}"${u.id === UNIT ? ' selected' : ''}>${esc(u.name)}${u.ownership === 'franchise' ? ' — franchise' : ''}</option>`).join('');
  sel.onchange = () => { UNIT = parseInt(sel.value, 10) || null; try { localStorage.setItem('ems_unit', UNIT || ''); } catch {} refreshBadges(); route(); };
}

async function refreshBadges(counts) {
  try { if (!counts) counts = (await api(U('/staff/dashboard'))).counts; } catch { return; }
  BADGES = counts;
  APP.querySelectorAll('[data-b]').forEach(b => { const n = counts[b.dataset.b] || 0; b.hidden = !n; b.textContent = n > 99 ? '99+' : n; });
}

function parseHash() {
  const [p, q] = location.hash.replace(/^#\/?/, '').split('?');
  return { parts: p.split('/').filter(Boolean), q: new URLSearchParams(q || '') };
}

async function route() {
  const { parts, q } = parseHash();
  const top = parts[0] || '';
  APP.querySelectorAll('.nav a').forEach(a => a.classList.toggle('on', a.dataset.k === top));
  MAIN.innerHTML = '<div class="boot" style="min-height:50vh"><img src="/img/hasta-emblem.webp" alt="" width="44" height="44"></div>';
  window.scrollTo(0, 0);
  try {
    if (!top) await viewDashboard();
    else if (top === 'schedule') await viewSchedule(q.get('d') || today());
    else if (top === 'clients' && parts[1]) await viewClient(+parts[1], q.get('tab'));
    else if (top === 'clients') await viewClients(q);
    else if (top === 'leads') await viewLeads(q);
    else if (top === 'reminders') await viewReminders();
    else if (top === 'payments') await viewPayments(q);
    else if (top === 'rota') await viewRota();
    else if (top === 'settings') await viewSettings();
    else if (top === 'academy') await viewAcademy(MAIN, ME, MACHINES, q.get('tab') || 'overview', go);
    else MAIN.innerHTML = emptyState('info', 'Page not found.');
  } catch (e) { MAIN.innerHTML = `<div class="panel"><p class="err">${esc(e.message)}</p></div>`; }
}
const reload = () => route();
const go = h => { if (location.hash === h) route(); else location.hash = h; };

/* ================= Shared bits ================= */

function apptRow(a, { showDate = false, link = true, own = false } = {}) {
  const name = a.client_name || a.guest_name || 'Client';
  const phone = a.client_phone || a.guest_phone;
  const when = showDate ? fWhen(a.start_at) : fTime(a.start_at);
  const sub = [own ? null : KIND_LABEL[a.kind], a.mode === 'video' ? 'Video call' : null, multi() || own ? a.unit_name : null, a.trainer_name ? (a.kind === 'session' ? 'Trainer ' : 'With ') + first(a.trainer_name) : null, a.device_name, a.notes].filter(Boolean).map(esc).join(' — ');
  const acts = a.status === 'booked' ? `
      <button class="btn sm ghost" data-act="attended" data-id="${a.id}" title="Mark attended">${icon('check', 16)}<span class="hide-m">Attended</span></button>
      <button class="btn sm quiet icon" data-act="more" data-id="${a.id}" aria-label="More actions">${icon('more-horizontal', 18)}</button>` : '';
  return `<div class="row" data-appt="${a.id}">
    <span class="time${showDate ? ' wide' : ''}">${esc(when)}</span>
    <div class="grow">${own ? `<b>${esc(KIND_LABEL[a.kind])}</b>` : link && a.client_id ? `<a href="#/clients/${a.client_id}" style="text-decoration:none"><b>${esc(name)}</b></a>` : `<b>${esc(name)}</b>`}<span>${sub}</span></div>
    <div class="end">${pill(a.status)}${phone && a.status === 'booked' ? `<a class="btn sm quiet icon" href="${esc(wa(phone, reminderText('tomorrow', { name, start_at: a.start_at, kind: a.kind })))}" target="_blank" rel="noopener" aria-label="WhatsApp ${esc(name)}">${icon('message-circle', 18)}</a>` : ''}${acts}</div>
  </div>`;
}

function bindApptActions(root, list, after) {
  root.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]');
    if (!b || !b.dataset.id) return;
    const a = list.find(x => x.id === +b.dataset.id);
    if (!a) return;
    if (b.dataset.act === 'attended') {
      await busy(b, () => api('/staff/appointments/' + a.id, { method: 'PUT', body: { status: 'attended' } })).catch(() => null) && (toast('Marked as attended'), after());
    } else if (b.dataset.act === 'more') apptMenu(a, after);
  });
}

function apptMenu(a, after) {
  const name = a.client_name || a.guest_name;
  const m = modal({
    title: `${KIND_LABEL[a.kind]} · ${name}`,
    body: `<p class="muted">${esc(fLong(a.start_at))} at ${esc(fTime(a.start_at))}</p>
      <div class="grid2">
        <button class="btn ghost" data-s="attended">${icon('calendar-check', 18)}Attended</button>
        <button class="btn ghost" data-s="no_show">${icon('calendar-x', 18)}No-show</button>
        <button class="btn ghost" data-s="move">${icon('refresh-cw', 18)}Reschedule</button>
        <button class="btn danger" data-s="cancelled">${icon('x', 18)}Cancel booking</button>
      </div>
      ${field('Note', `<textarea class="in" name="notes" maxlength="300" placeholder="Visible to the team only">${esc(a.notes || '')}</textarea>`)}`,
    actions: `<button class="btn" data-s="note">Save note</button>`,
    onMount(el, close) {
      el.addEventListener('click', async e => {
        const b = e.target.closest('[data-s]'); if (!b) return;
        const notes = el.querySelector('[name=notes]').value;
        if (b.dataset.s === 'move') { close(); return rescheduleModal(a, after); }
        const body = b.dataset.s === 'note' ? { notes } : { status: b.dataset.s, notes };
        await busy(b, () => api('/staff/appointments/' + a.id, { method: 'PUT', body })).then(() => { close(); toast('Booking updated'); after(); }).catch(() => {});
      });
    },
  });
  return m;
}

function rescheduleModal(a, after) {
  let pick = null, full = false;
  modal({
    title: 'Reschedule', wide: true,
    body: `<p class="muted">Currently ${esc(fWhen(a.start_at))}${a.unit_name ? ' at ' + esc(a.unit_name) : ''}</p>${multi() && a.mode !== 'video' ? field('Unit', sel('unit_id', unitOpts(), a.unit_id)) : ''}<div data-slots></div><label class="check" hidden data-over><input type="checkbox" name="force"> Overbook this slot</label>`,
    actions: `<button class="btn ghost" data-close>Keep current time</button><button class="btn" data-save disabled>Move booking</button>`,
    onMount(el, close) {
      const save = el.querySelector('[data-save]');
      const uSel = el.querySelector('[name=unit_id]');
      const unitNow = () => (uSel ? +uSel.value : a.unit_id) || 1;
      const sp = slotPicker(el.querySelector('[data-slots]'), { staff: true, days: 30, query: () => `&unit=${unitNow()}&kind=${a.kind}&mode=${a.mode || 'in_person'}${a.client_id ? '&client=' + a.client_id : ''}`, onPick: (v, f) => { pick = v; full = f; save.disabled = !v; el.querySelector('[data-over]').hidden = !f; } });
      uSel && uSel.addEventListener('change', () => sp.reload());
      save.addEventListener('click', () => busy(save, () => api('/staff/appointments/' + a.id, { method: 'PUT', body: { start_at: pick, unit_id: unitNow(), force: el.querySelector('[name=force]').checked } }))
        .then(() => { close(); toast('Booking moved to ' + fWhen(pick)); after(); }).catch(() => {}));
    },
  });
}

async function findClient(q) { return (await api('/staff/clients?status=all&q=' + encodeURIComponent(q))).clients; }

function bookModal({ client = null, kind = 'session', lead = null, after = reload } = {}) {
  let chosen = client, pick = null, mode = 'in_person', sp = null;
  const startUnit = (client && client.home_unit_id) || (lead && lead.unit_id) || UNIT || (UNITS[0] && UNITS[0].id);
  const m = modal({
    title: lead ? `Book consultation · ${lead.name}` : 'New booking', wide: true,
    body: `${lead ? '' : `<div class="seg" data-kind style="flex-wrap:wrap">${[['session', 'EMS session'], ['review', 'Progress review'], ['wm_consult', 'Weight-mgmt consultation'], ['consultation', 'Initial consultation']].map(([k, l]) => `<button type="button" data-k="${k}" class="${k === kind ? 'on' : ''}">${l}</button>`).join('')}</div>
      <p class="small muted" style="margin-top:-6px">Reviews and weight-management consultations are only bookable when the client's package includes them. Initial consultations are for new or returning clients before admission.</p>`}
      ${lead ? `<p class="muted">${esc(prettyPhone(lead.phone))}${lead.concern ? ' — ' + esc(lead.concern) : ''}</p>` : `<div data-who></div>`}
      <div class="grid2">${field('Unit', sel('unit_id', unitOpts(), startUnit), 'clients can book at any unit')}<div data-mode ${kind === 'session' ? 'hidden' : ''}>${field('How', `<div class="seg" style="width:100%"><button type="button" data-m="in_person" class="on" style="flex:1">${icon('home', 15)} In person</button><button type="button" data-m="video" style="flex:1">${icon('phone', 15)} Video call</button></div>`)}</div></div>
      <div><h4 style="margin-bottom:10px">Date and time</h4><div data-slots></div><p class="small muted" style="margin-top:8px">Times shown have a free device and a rostered trainer (one client per trainer), or a free coach/doctor for consultations. A device and staff member are assigned automatically.</p></div>
      <label class="check" hidden data-over><input type="checkbox" name="force"> Overbook — this slot is already full</label>
      ${field('Note', inp('notes', '', 'maxlength="300" placeholder="Optional"'))}
      <div data-warn></div>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save disabled>${icon('calendar-plus', 18)}Book</button>`,
    onMount(el, close) {
      const save = el.querySelector('[data-save]');
      const ready = () => { save.disabled = !pick || (!lead && kind !== 'consultation' && !chosen) || (!lead && !chosen && !guestOk()); };
      const guestOk = () => { const n = el.querySelector('[name=guest_name]'), p = el.querySelector('[name=guest_phone]'); return n && p && n.value.trim().length > 1 && p.value.replace(/\D/g, '').length >= 10; };
      const who = el.querySelector('[data-who]');
      const drawWho = () => {
        if (!who) return;
 if (chosen && sp) setTimeout(() => sp.reload(), 0);
        if (chosen) { who.innerHTML = `<div class="row" style="border:1px solid var(--line);border-radius:12px"><span class="avatar">${esc(initials(chosen.name))}</span><div class="grow"><b>${esc(chosen.name)}</b><span>${esc(prettyPhone(chosen.phone))}</span></div>${client ? '' : `<button type="button" class="btn sm quiet" data-change>Change</button>`}</div>`; ready(); return; }
        who.innerHTML = `${field('Client', `<div class="search" style="max-width:none">${icon('search', 18)}<input class="in" data-q placeholder="Search by name or mobile" autocomplete="off"></div>`)}<div class="rows" data-res style="margin-top:6px"></div>
          ${kind === 'consultation' ? `<details style="margin-top:6px"><summary class="small" style="cursor:pointer;color:var(--teal)">Someone new? Enter their details</summary><div class="grid2" style="margin-top:10px">${field('Name', inp('guest_name'))}${field('Mobile', inp('guest_phone', '', 'type="tel"'))}</div></details>` : ''}`;
        const qi = who.querySelector('[data-q]'), res = who.querySelector('[data-res]');
        let tmr;
        qi.addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(async () => {
          const v = qi.value.trim(); if (v.length < 2) { res.innerHTML = ''; return; }
          const list = await findClient(v);
          res.innerHTML = list.slice(0, 6).map(c => `<div class="row click" data-pick="${c.id}"><span class="avatar">${esc(initials(c.name))}</span><div class="grow"><b>${esc(c.name)}</b><span>${esc(prettyPhone(c.phone))}</span></div>${pill(c.status)}</div>`).join('') || '<p class="muted small">No matching client.</p>';
          res.onclick = e => { const r = e.target.closest('[data-pick]'); if (r) { chosen = list.find(c => c.id === +r.dataset.pick); drawWho(); } };
        }, 200); });
        who.addEventListener('input', ready);
      };
      who && who.addEventListener('click', e => { if (e.target.closest('[data-change]')) { chosen = null; drawWho(); ready(); } });
      drawWho();
      const uSel = el.querySelector('[name=unit_id]');
      el.querySelector('[data-kind]')?.addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (!b) return; kind = b.dataset.k; el.querySelectorAll('[data-kind] button').forEach(x => x.classList.toggle('on', x === b)); el.querySelector('[data-mode]').hidden = kind === 'session'; if (kind === 'session') mode = 'in_person'; if (!client) drawWho(); sp.reload(); ready(); });
      el.querySelector('[data-mode]').addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (!b) return; mode = b.dataset.m; el.querySelectorAll('[data-mode] button').forEach(x => x.classList.toggle('on', x === b)); sp.reload(); });
      uSel.addEventListener('change', () => sp.reload());
      sp = slotPicker(el.querySelector('[data-slots]'), { staff: true, days: 30, query: () => `&unit=${uSel.value}&kind=${lead ? 'consultation' : kind}&mode=${mode}${chosen ? '&client=' + chosen.id : ''}`, startDate: lead && lead.preferred_date >= today() && lead.preferred_date <= addDays(today(), 29) ? lead.preferred_date : undefined, onPick: (v, full) => { pick = v; el.querySelector('[data-over]').hidden = !full; ready(); } });
      save.addEventListener('click', () => busy(save, async () => {
        const notes = el.querySelector('[name=notes]').value, force = el.querySelector('[name=force]').checked;
        let r;
        if (lead) r = await api(`/staff/leads/${lead.id}/convert`, { method: 'POST', body: { start_at: pick, notes, force, unit_id: uSel.value, mode } });
        else r = await api('/staff/appointments', { method: 'POST', body: { kind, mode, unit_id: uSel.value, start_at: pick, notes, force, client_id: chosen && chosen.id, guest_name: el.querySelector('[name=guest_name]')?.value, guest_phone: el.querySelector('[name=guest_phone]')?.value } });
        close();
        toast('Booked for ' + fWhen(pick) + (r.warnings && r.warnings.length ? ' — ' + r.warnings.join(' ') : ''));
        after();
      }).catch(() => {}));
    },
  });
  return m;
}

function reminderText(kind, r) {
  const n = first(r.name) || 'there';
  const t = r.start_at ? fTime(r.start_at) : '';
  switch (kind) {
    case 'tomorrow': return r.kind === 'consultation'
      ? `Hi ${n}, this is Hasta Wellness confirming your consultation tomorrow at ${t}. We're on the 1st floor, Anjali Arcade, near Nippon Toyota, Technopark Phase 3. Reply here if you need to change the time.`
      : `Hi ${n}, a reminder of your EMS session at Hasta Wellness ${r.start_at && r.start_at.slice(0, 10) === today() ? 'today' : 'tomorrow'} at ${t}. Please wear comfortable clothes and drink a glass of water before you come. Reply here if you need to change it.`;
    case 'rebook': return `Hi ${n}, it's Hasta Wellness. You have ${r.sessions_left || 'some'} EMS session${r.sessions_left === 1 ? '' : 's'} left — shall we book your next one? Reply with a day and time, or book in the app: ${APP_URL}`;
    case 'renew': return `Hi ${n}, great work on your EMS programme! You're nearly at the end of your package. Would you like us to set up your next one so your routine continues?`;
    case 'expiry': return `Hi ${n}, a friendly note from Hasta Wellness: your EMS package expires soon and you still have sessions left. Reply with times that suit you and we'll book them in.`;
    case 'balance': return `Hi ${n}, this is Hasta Wellness. A balance of ${inr(r.amount)} is due on your EMS package. You can pay by UPI or at the clinic on your next visit. Thank you!`;
    case 'measure': return `Hi ${n}, it's time for your progress check at Hasta Wellness — we'll take your measurements at your next session so you can see how far you've come.`;
    case 'admission': return r.step === 'sign'
      ? `Hi ${n}, your clinician at Hasta Wellness has completed your assessment. Please open the Hasta EMS app, read your programme consent and sign it so we can start your sessions: ${APP_URL}#/admission`
      : r.step === 'renew' ? `Hi ${n}, your Hasta Wellness programme consent is due for its yearly renewal. Please update your health questionnaire in the app (${APP_URL}#/admission) and we'll arrange a quick review at your next visit.`
      : `Hi ${n}, welcome to Hasta Wellness! Before your programme starts, please fill in the short health questionnaire in the Hasta EMS app: ${APP_URL}#/admission`;
    case 'lead': return `Hi ${n}, thank you for your enquiry about EMS and weight management at Hasta Wellness, Kazhakkoottam. When would be a good time for a consultation with our team?`;
    case 'pin': return `Hi ${n}, welcome to Hasta EMS! Track your sessions, progress and plan at ${APP_URL}\nSign in with this mobile number and your PIN: ${r.pin}\nYou can change the PIN after signing in.`;
    default: return `Hi ${n}, this is Hasta Wellness.`;
  }
}

/* ================= Dashboard ================= */

async function viewDashboard() {
  const d = await api(U('/staff/dashboard'));
  refreshBadges(d.counts);
  const c = d.counts;
  const hr = new Date(Date.now() + 330 * 60000).getUTCHours();
  const greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  const done = d.today.filter(a => a.status === 'attended').length;
  const showRate = c.month_closed ? Math.round((1 - c.month_noshow / c.month_closed) * 100) : null;
  MAIN.innerHTML = `
    <div class="head"><div><h1>${greet}${ME.id === 0 ? '' : ', ' + esc(first(ME.name))}</h1><p>${esc(fLong(today()))}</p></div>
      <div class="acts"><button class="btn ghost" data-add-client>${icon('user-plus', 18)}Add client</button><button class="btn gold" data-book>${icon('calendar-plus', 18)}New booking</button></div></div>
    <section class="kpis">
      <div class="kpi"><span class="l">${icon('calendar-days', 16)}Today</span><span class="v">${d.today.length}</span><span class="s">${done} attended</span></div>
      <div class="kpi"><span class="l">${icon('users', 16)}Active clients</span><span class="v">${c.active_clients}</span><span class="s">${c.upcoming} sessions booked ahead</span></div>
      <div class="kpi"><span class="l">${icon('zap', 16)}Sessions this week</span><span class="v">${c.week_sessions}</span><span class="s">${showRate != null ? showRate + '% attendance this month' : 'Since Monday'}</span></div>
      <div class="kpi"><span class="l">${icon('badge-indian-rupee', 16)}Received this month</span><span class="v">${inr(c.month_revenue)}</span><span class="s">All payment methods</span></div>
      <div class="kpi"><span class="l">${icon('wallet', 16)}Outstanding</span><span class="v">${inr(c.outstanding)}</span><span class="s"><a href="#/payments">View payments</a></span></div>
    </section>
    <div class="cols">
      <div class="stack">
        <section class="panel flush"><div class="panel-h" style="padding:18px 20px 0"><div class="t">${icon('calendar-check', 20)}<h3>Today's schedule</h3></div><a class="btn sm quiet" href="#/schedule">Full schedule</a></div>
          <div class="rows" data-today style="margin-top:8px">${d.today.length ? d.today.map(a => apptRow(a)).join('') : emptyState('calendar-days', 'No appointments today.', '<button class="btn sm ghost" data-book>Book a session</button>')}</div></section>
        ${d.units.length > 1 || ME.role === 'admin' ? `<section class="panel flush"><div class="panel-h" style="padding:18px 20px 4px"><div class="t">${icon('home', 20)}<h3>Units this week</h3></div>${ME.role === 'admin' ? '<a class="btn sm quiet" href="#/settings">Manage units</a>' : ''}</div>
          <table class="t"><thead><tr><th>Unit</th><th class="n">Devices</th><th class="n">Booked / capacity</th><th class="n">Utilisation</th><th class="n">Clients</th><th class="n">Received (month)</th></tr></thead><tbody>
          ${d.units.map(u => `<tr><td><b>${esc(u.name)}</b>${u.ownership === 'franchise' ? ' <span class="pill warn">Franchise</span>' : ''}</td><td class="n">${u.devices}</td><td class="n">${u.week_booked} / ${u.capacity}</td><td class="n"><div style="display:flex;gap:8px;align-items:center;justify-content:flex-end"><div class="bar" style="width:70px"><i style="width:${Math.min(100, u.utilisation)}%"></i></div><b>${u.utilisation}%</b></div></td><td class="n">${u.clients}</td><td class="n">${inr(u.revenue)}</td></tr>`).join('')}</tbody></table></section>` : ''}
        <section class="panel"><div class="panel-h"><div class="t">${icon('activity', 20)}<h3>Sessions attended per week</h3></div></div><div data-weeks></div></section>
      </div>
      <div class="stack">
        <section class="panel flush"><div class="panel-h" style="padding:18px 20px 0"><div class="t">${icon('bell', 20)}<h3>Follow-ups</h3></div><a class="btn sm quiet" href="#/reminders">See all ${c.reminders ? `(${c.reminders})` : ''}</a></div>
          <div class="rows" style="margin-top:8px">${d.reminders.length ? d.reminders.map(remRow).join('') : emptyState('check-circle', 'All caught up.')}</div></section>
        ${c.new_leads ? `<a href="#/leads" class="panel" style="display:flex;gap:14px;align-items:center;text-decoration:none;background:var(--gold-soft);border-color:transparent">${icon('inbox', 24)}<div style="flex:1"><b>${c.new_leads} new website enquir${c.new_leads > 1 ? 'ies' : 'y'}</b><p class="small muted">EMS and weight management leads waiting for a call</p></div>${icon('chevron-right', 20)}</a>` : ''}
        <section class="panel"><div class="panel-h"><div class="t">${icon('badge-indian-rupee', 20)}<h3>Payments received</h3></div></div><div data-months></div></section>
      </div>
    </div>`;
  barChart(MAIN.querySelector('[data-weeks]'), { data: d.weeks.map(w => ({ label: fDay(w.label), value: w.value })) });
  barChart(MAIN.querySelector('[data-months]'), { data: d.months.map(m => ({ label: new Date(m.label + '-01T00:00:00Z').toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' }), value: m.value })), format: v => v >= 100000 ? (v / 100000).toFixed(1) + 'L' : v >= 1000 ? Math.round(v / 1000) + 'k' : v, color: '#5b7f82' });
  MAIN.querySelectorAll('[data-book]').forEach(b => b.addEventListener('click', () => bookModal()));
  MAIN.querySelector('[data-add-client]').addEventListener('click', () => clientModal());
  bindApptActions(MAIN.querySelector('[data-today]'), d.today, reload);
  bindRemActions(MAIN, d.reminders);
}

/* ================= Schedule ================= */

async function viewSchedule(day) {
  const mon = addDays(day, -((new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7));
  const sun = addDays(mon, 6);
  const { appointments } = await api(U(`/staff/appointments?from=${mon}&to=${sun}`));
  const list = appointments.filter(a => a.start_at.slice(0, 10) === day);
  const active = list.filter(a => a.status !== 'cancelled'), cancelled = list.filter(a => a.status === 'cancelled');
  MAIN.innerHTML = `
    <div class="head"><div><h1>Schedule</h1><p>${esc(fLong(day))}</p></div>
      <div class="acts"><a class="btn ghost icon" href="#/schedule?d=${addDays(mon, -7)}" aria-label="Previous week">${icon('chevron-left', 18)}</a>
      <a class="btn ghost" href="#/schedule?d=${today()}">Today</a>
      <a class="btn ghost icon" href="#/schedule?d=${addDays(mon, 7)}" aria-label="Next week">${icon('chevron-right', 18)}</a>
      <button class="btn gold" data-book>${icon('calendar-plus', 18)}New booking</button></div></div>
    <div class="week">${[0, 1, 2, 3, 4, 5, 6].map(i => { const d = addDays(mon, i); const n = appointments.filter(a => a.start_at.startsWith(d) && a.status !== 'cancelled').length;
      return `<a class="wd${d === day ? ' on' : ''}${d === today() ? ' today' : ''}" href="#/schedule?d=${d}" style="text-decoration:none"><small>${fWeekday(d)}</small><b>${+d.slice(8)}</b><div class="dots">${'<i></i>'.repeat(Math.min(n, 12))}</div></a>`; }).join('')}</div>
    <section class="panel flush"><div class="panel-h" style="padding:18px 20px 0"><div class="t">${icon('calendar-days', 20)}<h3>${active.length} appointment${active.length === 1 ? '' : 's'}</h3></div>
      <span class="small muted">${active.filter(a => a.status === 'attended').length} attended · ${active.filter(a => a.status === 'no_show').length} no-show</span></div>
      <div class="rows" data-list style="margin-top:8px">${active.length ? active.map(a => apptRow(a)).join('') : emptyState('calendar-days', 'Nothing booked on this day.')}</div>
      ${cancelled.length ? `<details style="padding:0 20px 16px"><summary class="small muted" style="cursor:pointer">${cancelled.length} cancelled</summary><div class="rows">${cancelled.map(a => apptRow(a)).join('')}</div></details>` : ''}</section>`;
  MAIN.querySelector('[data-book]').addEventListener('click', () => bookModal());
  bindApptActions(MAIN.querySelector('[data-list]'), list, reload);
}

/* ================= Clients ================= */

async function viewClients(q) {
  const status = q.get('status') || 'active';
  const search = q.get('q') || '';
  const coach = q.get('coach') || '';
  const [{ clients }, tm] = await Promise.all([api(U(`/staff/clients?status=${status}&q=${encodeURIComponent(search)}&coach=${coach}`)), team()]);
  MAIN.innerHTML = `
    <div class="head"><div><h1>Clients</h1><p>${clients.length} ${status === 'all' ? '' : status} client${clients.length === 1 ? '' : 's'}</p></div>
      <div class="acts"><button class="btn gold" data-add>${icon('user-plus', 18)}Add client</button></div></div>
    <div class="toolbar"><form class="search" data-search>${icon('search', 18)}<input class="in" name="q" value="${esc(search)}" placeholder="Search name or mobile"></form>
      <div class="seg">${['active', 'paused', 'completed', 'all'].map(s => `<button data-s="${s}" class="${s === status ? 'on' : ''}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div>
      <select class="in" data-coach style="width:auto;min-width:190px" aria-label="Coach">${[['', 'All coaches']].concat(tm.some(t => t.id === ME.id) ? [[String(ME.id), 'My clients']] : [], [['none', 'Not allocated']], tm.map(t => [String(t.id), t.name])).map(([v, l]) => `<option value="${v}"${v === coach ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
    <section class="panel flush">${clients.length ? `<table class="t"><thead><tr><th>Client</th><th>${multi() && !UNIT ? 'Unit / coach' : 'Coach'}</th><th>Sessions</th><th>Weight</th><th>Last visit</th><th>Next visit</th><th>Admission</th></tr></thead><tbody>
      ${clients.map(c => { const diff = c.first_weight != null && c.last_weight != null ? Math.round((c.last_weight - c.first_weight) * 10) / 10 : null;
        return `<tr class="click" data-id="${c.id}"><td><div style="display:flex;gap:12px;align-items:center"><span class="avatar">${esc(initials(c.name))}</span><div><b>${esc(c.name)}</b><div class="small muted">${esc(prettyPhone(c.phone))}</div></div></div></td>
        <td>${multi() && !UNIT ? `<div class="small muted">${esc(c.unit_name || '')}</div>` : ''}${c.coach_name ? esc(c.coach_name) : '<span style="color:var(--warn)">Not allocated</span>'}</td>
        <td class="num">${c.attended}${c.sessions_total ? ` <span class="muted">/ ${c.sessions_total}</span>` : ''}</td>
        <td>${c.last_weight != null ? `<span class="num">${kg(c.last_weight)} kg</span> ${deltaTag(diff, ' kg')}` : '<span class="faint">—</span>'}</td>
        <td>${c.last_visit ? esc(fDay(c.last_visit)) : '<span class="faint">—</span>'}</td>
        <td>${c.next_visit ? esc(fWhen(c.next_visit)) : '<span class="faint">Not booked</span>'}</td>
        <td>${admPill(c.adm_status ? { status: c.adm_status, valid_until: c.adm_valid } : null)}</td></tr>`; }).join('')}</tbody></table>`
      : emptyState('users', search ? 'No clients match your search.' : 'No clients yet. Add your first client to start tracking.', '<button class="btn sm gold" data-add>Add client</button>')}</section>`;
  const setQ = (k, v) => { const p = new URLSearchParams(q); p.set(k, v); location.hash = '#/clients?' + p; };
  MAIN.querySelector('[data-search]').addEventListener('submit', e => { e.preventDefault(); setQ('q', e.target.q.value.trim()); });
  MAIN.querySelectorAll('[data-s]').forEach(b => b.addEventListener('click', () => setQ('status', b.dataset.s)));
  MAIN.querySelector('[data-coach]').addEventListener('change', e => setQ('coach', e.target.value));
  MAIN.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => clientModal()));
  MAIN.querySelectorAll('tr[data-id]').forEach(r => r.addEventListener('click', () => go('#/clients/' + r.dataset.id)));
}

function clientForm(c = {}, isNew = true, tm = []) {
  return `<div class="grid2">${field('Home unit', sel('home_unit_id', unitOpts(), c.home_unit_id ?? UNIT ?? (UNITS[0] && UNITS[0].id)))}${field('Coach', sel('coach_id', coachOptions(tm), c.coach_id ?? (isNew && tm.some(t => t.id === ME.id) ? ME.id : '')), 'team member responsible')}</div>
    <div class="grid2">${field('Full name', inp('name', c.name, 'required autocomplete="off"'))}${field('Mobile number', inp('phone', c.phone, 'type="tel" required'), 'used to sign in')}</div>
    <div class="grid3">${field('Gender', sel('gender', [['', 'Select'], ['female', 'Female'], ['male', 'Male'], ['other', 'Other']], c.gender))}${field('Year of birth', inp('birth_year', c.birth_year, 'type="number" inputmode="numeric" placeholder="1990"'))}${lenField('Height', 'height_cm', c.height_cm)}</div>
    <div class="grid2">${field('Target weight (kg)', inp('target_weight', c.target_weight, 'type="number" step="0.1" inputmode="decimal"'), 'optional')}${field('Email', inp('email', c.email, 'type="email"'), 'optional')}</div>
    ${field('Goal', inp('goal', c.goal, 'maxlength="200" placeholder="e.g. Lose 6 kg before wedding, tone core after pregnancy"'))}
    ${isNew ? `<label class="check"><input type="checkbox" name="consent"> <span>The client has agreed to Hasta Wellness keeping their details, measurements and progress records for their programme.</span></label>` : ''}`;
}

async function clientModal(prefill = {}, after) {
  const tm = await team().catch(() => []);
  modal({
    title: 'Add client', wide: true,
    body: `<form class="stack" style="gap:14px" data-f>${clientForm(prefill, true, tm)}</form>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>${icon('user-plus', 18)}Add client</button>`,
    onMount(el, close) {
      const f = el.querySelector('[data-f]'), save = el.querySelector('[data-save]');
      wireLen(f);
      save.addEventListener('click', () => busy(save, async () => {
        const body = { ...lenToCm(f, formData(f)), lead_id: prefill.lead_id };
        const r = await api('/staff/clients', { method: 'POST', body });
        close();
        showPin({ id: r.id, name: body.name, phone: body.phone, pin: r.pin, isNew: true });
        after && after();
      }).catch(e => { if (e.data && e.data.id) { close(); go('#/clients/' + e.data.id); } }));
    },
  });
}

function showPin({ id, name, phone, pin, isNew }) {
  modal({
    title: isNew ? 'Client added' : 'New PIN created',
    body: `<p>${isNew ? `${esc(first(name))} can now sign in to the client app.` : 'The old PIN no longer works.'} Share this PIN with them — it won't be shown again.</p>
      <div class="secret">${esc(pin)}</div>
      <p class="small muted">Sign in at <b>${esc(APP_URL)}</b> with mobile ${esc(prettyPhone(phone))}.</p>`,
    actions: `<a class="btn wa" href="${esc(wa(phone, reminderText('pin', { name, pin })))}" target="_blank" rel="noopener">${icon('message-circle', 18)}Send on WhatsApp</a>${isNew ? `<a class="btn" href="#/clients/${id}?tab=sessions" data-close>Open profile</a>` : '<button class="btn" data-close>Done</button>'}`,
  });
}

/* ---------- Client profile ---------- */

const TABS = [['overview', 'layout-dashboard', 'Overview'], ['admission', 'shield-check', 'Admission'], ['sessions', 'calendar-days', 'Sessions & packages'], ['progress', 'line-chart', 'Progress'], ['payments', 'wallet', 'Payments'], ['plan', 'salad', 'Lifestyle plan'], ['profile', 'user', 'Profile']];

async function viewClient(id, tab) {
  const [d, tm] = await Promise.all([api('/staff/clients/' + id), team()]);
  d.team = tm;
  if (!tab) tab = admState(d.admission) === 'admitted' ? 'overview' : 'admission';
  const c = d.client;
  const age = ageFrom(c.birth_year);
  const act = d.packages.filter(p => p.state === 'active');
  const left = act.reduce((a, p) => a + p.available, 0);
  MAIN.innerHTML = `
    <a href="#/clients" class="crumb">${icon('arrow-left', 16)}Clients</a>
    <div class="prof"><span class="avatar">${esc(initials(c.name))}</span>
      <div class="who"><h1>${esc(c.name)}</h1><div class="meta">
        <span>${icon('phone', 15)}<a href="tel:${esc(c.phone)}">${esc(prettyPhone(c.phone))}</a></span>
        ${age ? `<span>${icon('user', 15)}${age} yrs${c.gender ? ', ' + esc(c.gender) : ''}</span>` : ''}
        ${c.height_cm ? `<span>${icon('ruler', 15)}${c.height_cm} cm (${ftIn(c.height_cm)})</span>` : ''}
        ${c.unit_name ? `<span>${icon('home', 15)}${esc(c.unit_name)}</span>` : ''}
        <span>${icon('package', 15)}${left} session${left === 1 ? '' : 's'} available</span>
        <button type="button" class="btn sm ghost" data-coach style="height:28px">${icon('users', 15)}${c.coach_name ? 'Coach: ' + esc(c.coach_name) : '<span style="color:var(--warn)">Allocate a coach</span>'}</button></div></div>
      <div class="acts" style="display:flex;gap:8px;flex-wrap:wrap">${pill(c.status)}<a href="#/clients/${c.id}?tab=admission" style="text-decoration:none">${admPill(d.admissions.find(x => x.status === 'admitted' && admState(x) === 'admitted') || d.admission)}</a></div>
    </div>
    <div class="head" style="margin-bottom:14px"><div></div><div class="acts">
      <a class="btn ghost" href="${esc(wa(c.phone, `Hi ${first(c.name)}, this is Hasta Wellness.`))}" target="_blank" rel="noopener">${icon('message-circle', 18)}WhatsApp</a>
      <button class="btn ghost" data-measure>${icon('ruler', 18)}Add measurements</button>
      <button class="btn ghost" data-pay>${icon('receipt', 18)}Record payment</button>
      <button class="btn gold" data-book>${icon('calendar-plus', 18)}Book session</button></div></div>
    <nav class="tabs">${TABS.map(([k, ic, l]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${icon(ic, 17)}${l}</button>`).join('')}</nav>
    <div data-body></div>`;
  const after = () => viewClient(id, tab);
  MAIN.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => history.replaceState(null, '', `#/clients/${id}?tab=${b.dataset.tab}`) || viewClient(id, b.dataset.tab)));
  MAIN.querySelector('[data-book]').addEventListener('click', () => bookModal({ client: c, after }));
  MAIN.querySelector('[data-coach]').addEventListener('click', () => modal({
    title: 'Allocate coach · ' + c.name,
    body: `<form data-f>${field('Coach', sel('coach_id', coachOptions(tm), c.coach_id))}</form><p class="small muted">The coach sees this client under "My clients", and their name shows on the client's bookings and in the client's app.</p>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Save</button>`,
    onMount(el, close) { const b = el.querySelector('[data-save]'); b.addEventListener('click', () => busy(b, () => api('/staff/clients/' + c.id, { method: 'PUT', body: { coach_id: el.querySelector('[name=coach_id]').value } })).then(() => { close(); toast('Coach allocated'); team(true); after(); }).catch(() => {})); },
  }));
  MAIN.querySelector('[data-measure]').addEventListener('click', () => d.access.measurements ? measureModal(c, after) : toast('Progress measurements are not included in this client\'s package.', true));
  MAIN.querySelector('[data-pay]').addEventListener('click', () => payModal(c, d.packages, after));
  const body = MAIN.querySelector('[data-body]');
  ({ overview: tabOverview, admission: tabAdmission, sessions: tabSessions, progress: tabProgress, payments: tabPayments, plan: tabPlan, profile: tabProfile }[tab] || tabOverview)(body, d, after);
}

function metricStrip(d) {
  const ch = d.insights.metrics.change, last = k => { for (let i = d.measurements.length - 1; i >= 0; i--) if (d.measurements[i][k] != null) return d.measurements[i][k]; return null; };
  const m = (l, k, u) => `<div class="metric"><div class="l">${l}</div><div class="v">${last(k) != null ? kg(last(k)) : '—'}<small>${last(k) != null ? u : ''}</small>${u === 'cm' && last(k) != null ? `<span class="alt">${toIn(last(k))} in</span>` : ''}</div>${ch[k] ? deltaTag(ch[k].diff, u === '%' ? '%' : ' ' + u, k !== 'muscle_mass') + `<span class="small faint"> since ${fDay(ch[k].since)}</span>` : '<span class="small faint">No data</span>'}</div>`;
  return `<div class="metrics">${m('Weight', 'weight', 'kg')}${m('Waist', 'waist', 'cm')}${m('Hips', 'hips', 'cm')}${m('Body fat', 'body_fat', '%')}</div>`;
}

function tabOverview(el, d, after) {
  const M = d.insights.metrics;
  const upcoming = d.appointments.filter(a => a.status === 'booked' && a.start_at >= nowLocal()).reverse();
  el.innerHTML = `<div class="cols"><div class="stack">
      <section class="panel">${metricStrip(d)}
        <div class="panel-h" style="margin-top:18px"><div class="t">${icon('line-chart', 20)}<h3>Weight</h3></div>${M.weeklyRate != null ? `<span class="small muted">${M.weeklyRate > 0 ? '+' : ''}${M.weeklyRate} kg / week lately</span>` : ''}</div><div data-w></div>
        <div class="panel-h" style="margin-top:18px"><div class="t">${icon('ruler', 20)}<h3>Waist and hips</h3></div>${M.whr ? `<span class="small ${M.whr.ok ? 'muted' : ''}" style="${M.whr.ok ? '' : 'color:var(--warn)'}">Waist-to-hip ${M.whr.value} (aim ≤ ${M.whr.limit})</span>` : ''}</div><div data-wh></div></section>
    </div><div class="stack">
      <section class="panel"><div class="panel-h"><div class="t">${icon('flame', 20)}<h3>Momentum score</h3></div></div>
        <div class="score"><b>${M.score}</b><div class="meter"><i style="width:${M.score}%"></i></div></div>
        <p class="small muted" style="margin-top:8px">${M.attendance.last28} sessions in 4 weeks${M.habits.days ? `, ${M.habits.days} check-ins this week` : ', no check-ins this week'}${M.bmi ? `. BMI ${M.bmi.value} (${M.bmi.band.toLowerCase()}, Asian bands)` : ''}${M.target && M.target.eta ? `. On this trend, ${M.target.value} kg around ${fDate(M.target.eta)}` : ''}.</p></section>
      <section class="panel"><div class="panel-h"><div class="t">${icon('sparkles', 20)}<h3>Guidance</h3></div></div>${insightList(d.insights.items, 8)}</section>
      <section class="panel flush"><div class="panel-h" style="padding:18px 20px 0"><div class="t">${icon('calendar-check', 20)}<h3>Coming up</h3></div></div><div class="rows" data-up style="margin-top:8px">${upcoming.length ? upcoming.slice(0, 5).map(a => apptRow({ ...a, client_name: d.client.name, client_phone: d.client.phone }, { showDate: true, link: false, own: true })).join('') : emptyState('calendar-plus', 'No upcoming bookings.')}</div></section>
      ${d.client.goal ? `<section class="panel"><div class="panel-h"><div class="t">${icon('trophy', 20)}<h3>Goal</h3></div></div><p>${esc(d.client.goal)}</p>${d.client.target_weight ? `<p class="small muted" style="margin-top:6px">Target weight ${d.client.target_weight} kg</p>` : ''}</section>` : ''}
    </div></div>`;
  lineChart(el.querySelector('[data-w]'), { series: [{ name: 'Weight', color: '#34595e', points: measureSeries(d.measurements, 'weight') }], unit: ' kg', target: d.client.target_weight });
  lineChart(el.querySelector('[data-wh]'), { series: [{ name: 'Waist', color: '#34595e', points: measureSeries(d.measurements, 'waist') }, { name: 'Hips', color: '#c4a45b', points: measureSeries(d.measurements, 'hips') }], unit: ' cm', height: 200 });
  bindApptActions(el.querySelector('[data-up]'), upcoming, after);
}

function pkgRow(p, staff = true) {
  const u = p.sessions_total ? p.used / p.sessions_total * 100 : 0, b = p.sessions_total ? p.booked / p.sessions_total * 100 : 0;
  return `<div class="pkg"><span class="hic" style="width:42px;height:42px;border-radius:12px;display:grid;place-items:center;background:var(--teal-mist);color:var(--teal)">${icon('package', 20)}</span>
    <div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>${esc(p.name)}</b>${pill(p.state)}</div>
      <div class="bar" style="margin:8px 0 6px"><i style="width:${u}%"></i><i class="b" style="width:${b}%"></i></div>
      <span class="small muted">${p.sessions_total ? `${p.used} used, ${p.booked} booked, ${p.remaining} left of ${p.sessions_total} EMS sessions · ` : ''}${p.ent && !p.ent.legacy && p.ent.reviews ? `reviews ${p.reviews_used}/${p.ent.reviews} · ` : ''}${p.ent && !p.ent.legacy && p.ent.wm_consults ? `WM consultations ${p.wm_used}/${p.ent.wm_consults} · ` : ''}${p.ent && p.ent.diet_plan ? 'diet plan · ' : ''}${p.ent && p.ent.measurements ? 'measurements · ' : ''}${fDay(p.start_date)} to ${p.expiry_date ? fDate(p.expiry_date) : 'no expiry'}${staff ? ` · ${inr(p.due)}${p.balance > 0 ? `, <b style="color:var(--warn)">${inr(p.balance)} due</b>` : ', paid'}` : ''}</span></div>
    ${staff ? `<div><button class="btn sm ghost" data-pkg="${p.id}">${icon('pencil', 15)}Manage</button></div>` : ''}</div>`;
}

function tabSessions(el, d, after) {
  const appts = d.appointments.map(a => ({ ...a, client_name: d.client.name, client_phone: d.client.phone }));
  el.innerHTML = `<div class="stack">
    <section class="panel flush"><div class="panel-h" style="padding:18px 20px 4px"><div class="t">${icon('package', 20)}<h3>Packages</h3></div><button class="btn sm gold" data-add-pkg>${icon('plus', 16)}Add package</button></div>
      ${d.packages.length ? d.packages.slice().reverse().map(p => pkgRow(p)).join('') : emptyState('package', 'No package yet. Add one to start booking sessions.')}</section>
    <section class="panel flush"><div class="panel-h" style="padding:18px 20px 0"><div class="t">${icon('calendar-days', 20)}<h3>Bookings and attendance</h3></div>
      <span class="small muted">${appts.filter(a => a.status === 'attended').length} attended · ${appts.filter(a => a.status === 'no_show').length} no-show · ${appts.filter(a => a.status === 'cancelled').length} cancelled</span></div>
      <div class="rows" data-list style="margin-top:8px">${appts.length ? appts.map(a => apptRow(a, { showDate: true, link: false, own: true })).join('') : emptyState('calendar-days', 'No bookings yet.')}</div></section></div>`;
  el.querySelector('[data-add-pkg]').addEventListener('click', () => packageModal(d.client, after));
  el.querySelectorAll('[data-pkg]').forEach(b => b.addEventListener('click', () => managePackage(d.packages.find(p => p.id === +b.dataset.pkg), after)));
  bindApptActions(el.querySelector('[data-list]'), appts, after);
}

async function packageModal(c, after) {
  if (!c.cleared) { toast('Complete the admission first — both the clinician and the client must sign before enrolment.', true); return go(`#/clients/${c.id}?tab=admission`); }
  const { packages } = await api('/staff/packages');
  const defs = packages.filter(p => p.active && p.price != null);
  const admin = ME.role === 'admin';
  if (!defs.length && !admin) return toast('No priced packages in the catalogue yet. Ask an admin to build one.', true);
  modal({
    title: 'Add package · ' + c.name, wide: true,
    body: `<form class="stack" style="gap:14px" data-f>
      ${field('Package', sel('package_id', defs.map(p => [p.id, `${p.name} — ${inr(p.price)}`]).concat(admin ? [['', 'Custom package (admin only)']] : []), defs[0] && defs[0].id))}
      <div class="note" data-inc></div>
      <div data-custom hidden class="stack" style="gap:12px">
        <div class="grid2">${field('Name', inp('name', '', 'maxlength="80"'))}${field('Programme', sel('programme', [['ems', 'EMS programme'], ['weight', 'Weight management'], ['combined', 'EMS + weight management']], 'ems'))}</div>
        <div class="grid3">${field('EMS sessions', inp('sessions', 10, 'type="number" min="0"'))}${field('Progress reviews', inp('reviews', 0, 'type="number" min="0"'))}${field('WM consultations', inp('wm_consults', 0, 'type="number" min="0"'))}</div>
        <div class="chips"><label class="chip"><input type="checkbox" name="diet_plan">Diet and lifestyle plan</label><label class="chip"><input type="checkbox" name="measurements">Measurements and charts</label></div>
        <div class="grid2">${field('Price (₹)', inp('price', '', 'type="number" min="0"'))}${field('Valid for (days)', inp('validity_days', 90, 'type="number" min="7"'))}</div></div>
      <div class="grid3">${field('Discount (₹)', inp('discount', 0, 'type="number" min="0" inputmode="numeric"'), '')}${field('Start date', inp('start_date', today(), 'type="date"'))}${multi() ? field('Sold by unit', sel('unit_id', unitOpts(), c.home_unit_id)) : '<div></div>'}</div>
      <p class="small muted" data-disc></p></form>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Add package</button>`,
    onMount(el, close) {
      const f = el.querySelector('[data-f]');
      const sync = () => {
        const p = defs.find(x => x.id === +f.package_id.value);
        el.querySelector('[data-custom]').hidden = !!p;
        el.querySelector('[data-inc]').hidden = !p;
        if (p) {
          el.querySelector('[data-inc]').innerHTML = `<b>Includes:</b> ${esc(includesText(p.ent, p.sessions))}. ${machineList(p.machine_types).length ? 'Machines: ' + esc(machineList(p.machine_types).map(machineName).join(', ')) + '. ' : ''}Valid ${p.validity_days} days. Price ${inr(p.price)}.`;
          const lim = Math.floor(p.price * (p.max_discount || 0) / 100);
          el.querySelector('[data-disc]').textContent = admin ? `Staff can discount up to ${p.max_discount || 0}% (${inr(lim)}). As an admin you can give more.` : p.max_discount ? `You can discount up to ${p.max_discount}% (${inr(lim)}).` : 'No discount is allowed on this package.';
          f.discount.max = admin ? p.price : lim; if (!admin && !p.max_discount) { f.discount.value = 0; f.discount.disabled = true; } else f.discount.disabled = false;
        } else el.querySelector('[data-disc]').textContent = 'Custom packages are for exceptions. Prefer building a catalogue package in Settings.';
      };
      f.package_id.addEventListener('change', sync); sync();
      const save = el.querySelector('[data-save]');
      save.addEventListener('click', () => busy(save, () => api(`/staff/clients/${c.id}/packages`, { method: 'POST', body: formData(f) })).then(() => { close(); toast('Package added'); after(); }).catch(() => {}));
    },
  });
}

function managePackage(p, after) {
  modal({
    title: p.name,
    body: `<p class="muted">${p.used} used, ${p.booked} booked, ${p.remaining} left of ${p.sessions_total}.</p>
      <form class="stack" style="gap:14px" data-f><div class="grid2">${ME.role === 'admin' ? field('Total EMS sessions', inp('sessions_total', p.sessions_total, 'type="number" min="1"'), 'admins only') : `<div><p class="small muted">Includes: ${esc(includesText(p.ent, p.sessions_total))}</p></div>`}${field('Expiry date', inp('expiry_date', p.expiry_date, 'type="date"'))}</div>
      ${field('Status', sel('status', [['active', 'Active'], ['paused', 'Paused (no new bookings)'], ['closed', 'Closed']], p.status))}</form>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Save</button>`,
    onMount(el, close) {
      const save = el.querySelector('[data-save]');
      save.addEventListener('click', () => busy(save, () => api('/staff/client-packages/' + p.id, { method: 'PUT', body: formData(el.querySelector('[data-f]')) })).then(() => { close(); toast('Package updated'); after(); }).catch(() => {}));
    },
  });
}

function measureModal(c, after) {
  modal({
    title: 'Add measurements · ' + c.name,
    body: `<form class="stack" style="gap:14px" data-f>${field('Date', inp('measured_on', today(), `type="date" max="${today()}"`))}
      <div class="grid2">${field('Weight (kg)', inp('weight', '', 'type="number" step="0.1" inputmode="decimal"'))}${field('Body fat (%)', inp('body_fat', '', 'type="number" step="0.1" inputmode="decimal"'))}</div>
      <div class="grid3">${lenField('Waist', 'waist', '')}${lenField('Hips', 'hips', '')}${field('Muscle mass (kg)', inp('muscle_mass', '', 'type="number" step="0.1" inputmode="decimal"'), 'optional')}</div>
      ${field('Note', inp('notes', '', 'maxlength="300" placeholder="e.g. measured before session, same scale"'))}</form>
      <p class="small muted">Measure at the same time of day, on the same scale, for comparable results.</p>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Save measurements</button>`,
    onMount(el, close) {
      const save = el.querySelector('[data-save]');
      wireLen(el);
      save.addEventListener('click', () => busy(save, () => api('/staff/measurements', { method: 'POST', body: { ...lenToCm(el, formData(el.querySelector('[data-f]'))), client_id: c.id } })).then(() => { close(); toast('Measurements saved'); after(); }).catch(() => {}));
    },
  });
}

function payModal(c, packages, after) {
  const open = packages.filter(p => p.state !== 'closed');
  if (!open.length) return toast('Add a package first, then record payments against it.', true);
  const def = open.find(p => p.balance > 0) || open[open.length - 1];
  modal({
    title: 'Record payment · ' + c.name,
    body: `<form class="stack" style="gap:14px" data-f>
      ${field('Package', sel('client_package_id', open.map(p => [p.id, `${p.name} (${fDay(p.start_date)}) — ${p.balance > 0 ? inr(p.balance) + ' due' : 'paid'}`]), def.id))}
      <div class="grid2">${field('Amount (₹)', inp('amount', def.balance > 0 ? def.balance : '', 'type="number" min="1" inputmode="numeric"'))}${field('Method', sel('method', ['UPI', 'Cash', 'Card', 'Bank transfer'], 'UPI'))}</div>
      <div class="grid2">${field('Date', inp('paid_on', today(), `type="date" max="${today()}"`))}${field('Reference', inp('reference', '', 'maxlength="80" placeholder="UPI ref / receipt no."'), 'optional')}</div></form>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>${icon('receipt', 18)}Record payment</button>`,
    onMount(el, close) {
      const f = el.querySelector('[data-f]');
      f.client_package_id.addEventListener('change', () => { const p = open.find(x => x.id === +f.client_package_id.value); f.amount.value = p && p.balance > 0 ? p.balance : ''; });
      const save = el.querySelector('[data-save]');
      save.addEventListener('click', () => busy(save, async () => {
        const body = formData(f);
        await api('/staff/payments', { method: 'POST', body });
        const p = open.find(x => x.id === +body.client_package_id);
        const bal = p ? p.balance - +body.amount : 0;
        close();
        modal({ title: 'Payment recorded', body: `<p>${inr(body.amount)} by ${esc(body.method)} for ${esc(p ? p.name : 'package')}.${bal > 0 ? ` Balance now ${inr(bal)}.` : ' Package fully paid.'}</p>`,
          actions: `<a class="btn wa" target="_blank" rel="noopener" href="${esc(wa(c.phone, `Hi ${first(c.name)}, thank you for your payment of ${inr(body.amount)} (${body.method}) on ${fDate(body.paid_on)} for ${p ? p.name : 'your EMS package'} at Hasta Wellness.${bal > 0 ? ` Balance remaining: ${inr(bal)}.` : ' Your package is fully paid.'}`))}">${icon('message-circle', 18)}Send receipt on WhatsApp</a><button class="btn" data-close>Done</button>` });
        after();
      }).catch(() => {}));
    },
  });
}

function tabProgress(el, d, after) {
  const ms = d.measurements.slice().reverse();
  el.innerHTML = `<div class="stack">
    <section class="panel">${metricStrip(d)}</section>
    <div class="grid2" style="gap:18px">
      <section class="panel"><div class="panel-h"><div class="t">${icon('line-chart', 20)}<h3>Weight</h3></div></div><div data-w></div></section>
      <section class="panel"><div class="panel-h"><div class="t">${icon('ruler', 20)}<h3>Waist and hips</h3></div></div><div data-wh></div></section>
      <section class="panel"><div class="panel-h"><div class="t">${icon('activity', 20)}<h3>Body fat</h3></div></div><div data-bf></div></section>
      <section class="panel"><div class="panel-h"><div class="t">${icon('dumbbell', 20)}<h3>Muscle mass</h3></div></div><div data-mm></div></section>
    </div>
    <section class="panel flush"><div class="panel-h" style="padding:18px 20px 4px"><div class="t">${icon('clipboard-check', 20)}<h3>All measurements</h3></div><button class="btn sm gold" data-add>${icon('plus', 16)}Add</button></div>
      ${ms.length ? `<table class="t"><thead><tr><th>Date</th><th class="n">Weight</th><th class="n">Waist</th><th class="n">Hips</th><th class="n">Body fat</th><th class="n">Muscle</th><th></th></tr></thead><tbody>
      ${ms.map(m => `<tr><td>${esc(fDate(m.measured_on))}${m.notes ? `<div class="small muted">${esc(m.notes)}</div>` : ''}</td><td class="n">${m.weight != null ? kg(m.weight) + ' kg' : '—'}</td><td class="n">${cmIn(m.waist)}</td><td class="n">${cmIn(m.hips)}</td><td class="n">${m.body_fat != null ? m.body_fat + '%' : '—'}</td><td class="n">${m.muscle_mass ?? '—'}</td>
        <td class="n"><button class="btn sm quiet icon" data-del="${m.id}" aria-label="Delete">${icon('trash-2', 16)}</button></td></tr>`).join('')}</tbody></table>` : emptyState('ruler', 'No measurements yet. Record a baseline before the first session.')}</section></div>`;
  lineChart(el.querySelector('[data-w]'), { series: [{ name: 'Weight', color: '#34595e', points: measureSeries(d.measurements, 'weight') }], unit: ' kg', target: d.client.target_weight, height: 200 });
  lineChart(el.querySelector('[data-wh]'), { series: [{ name: 'Waist', color: '#34595e', points: measureSeries(d.measurements, 'waist') }, { name: 'Hips', color: '#c4a45b', points: measureSeries(d.measurements, 'hips') }], unit: ' cm', height: 200 });
  lineChart(el.querySelector('[data-bf]'), { series: [{ name: 'Body fat', color: '#a8642c', points: measureSeries(d.measurements, 'body_fat') }], unit: '%', height: 200 });
  lineChart(el.querySelector('[data-mm]'), { series: [{ name: 'Muscle', color: '#2f7d58', points: measureSeries(d.measurements, 'muscle_mass') }], unit: ' kg', height: 200 });
  el.querySelector('[data-add]').addEventListener('click', () => d.access.measurements ? measureModal(d.client, after) : toast('Progress measurements are not included in this client\'s package.', true));
  el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { if (confirm('Delete this measurement?')) busy(b, () => api('/staff/measurements/' + b.dataset.del, { method: 'DELETE', body: {} })).then(() => { toast('Deleted'); after(); }).catch(() => {}); }));
}

function tabPayments(el, d, after) {
  const due = d.packages.reduce((a, p) => a + p.due, 0), paid = d.packages.reduce((a, p) => a + p.paid, 0);
  el.innerHTML = `<div class="stack">
    <section class="kpis" style="grid-template-columns:repeat(3,minmax(0,1fr));margin:0">
      <div class="kpi"><span class="l">${icon('package', 16)}Package value</span><span class="v">${inr(due)}</span></div>
      <div class="kpi"><span class="l">${icon('check-circle', 16)}Paid</span><span class="v">${inr(paid)}</span></div>
      <div class="kpi"><span class="l">${icon('wallet', 16)}Balance</span><span class="v" style="${due - paid > 0 ? 'color:var(--warn)' : ''}">${inr(due - paid)}</span></div></section>
    <section class="panel flush"><div class="panel-h" style="padding:18px 20px 4px"><div class="t">${icon('package', 20)}<h3>By package</h3></div><button class="btn sm gold" data-pay>${icon('receipt', 16)}Record payment</button></div>
      ${d.packages.length ? `<table class="t"><thead><tr><th>Package</th><th class="n">Price</th><th class="n">Discount</th><th class="n">Paid</th><th class="n">Balance</th></tr></thead><tbody>${d.packages.slice().reverse().map(p => `<tr><td><b>${esc(p.name)}</b><div class="small muted">from ${fDate(p.start_date)}</div></td><td class="n">${inr(p.price)}</td><td class="n">${p.discount ? inr(p.discount) : '—'}</td><td class="n">${inr(p.paid)}</td><td class="n">${p.balance > 0 ? `<b style="color:var(--warn)">${inr(p.balance)}</b>` : pill('good', 'Paid')}</td></tr>`).join('')}</tbody></table>` : emptyState('package', 'No packages yet.')}</section>
    <section class="panel flush"><div class="panel-h" style="padding:18px 20px 4px"><div class="t">${icon('receipt', 20)}<h3>Payments received</h3></div></div>
      ${d.payments.length ? `<table class="t"><thead><tr><th>Date</th><th>Package</th><th>Method</th><th class="n">Amount</th>${ME.role === 'admin' ? '<th></th>' : ''}</tr></thead><tbody>${d.payments.map(p => `<tr><td>${esc(fDate(p.paid_on))}</td><td>${esc(p.package_name || '')}</td><td>${esc(p.method)}${p.reference ? `<div class="small muted">${esc(p.reference)}</div>` : ''}</td><td class="n"><b>${inr(p.amount)}</b></td>${ME.role === 'admin' ? `<td class="n"><button class="btn sm quiet icon" data-del="${p.id}" aria-label="Remove payment">${icon('trash-2', 16)}</button></td>` : ''}</tr>`).join('')}</tbody></table>` : emptyState('receipt', 'No payments recorded yet.')}</section></div>`;
  el.querySelector('[data-pay]').addEventListener('click', () => payModal(d.client, d.packages, after));
  el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { if (confirm('Remove this payment? Only do this to correct a mistake.')) busy(b, () => api('/staff/payments/' + b.dataset.del, { method: 'DELETE', body: {} })).then(() => { toast('Payment removed'); after(); }).catch(() => {}); }));
}

function tabPlan(el, d, after) {
  if (!d.access.diet_plan) {
    el.innerHTML = `<section class="panel">${emptyState('lock', 'The diet and lifestyle plan is not included in this client\'s package, so it can\'t be set up. Add a package that includes it.', `<a class="btn sm ghost" href="#/clients/${d.client.id}?tab=sessions">Packages</a>`)}</section>`;
    return;
  }
  const p = d.plan;
  const ck = d.checkins.slice(0, 14);
  el.innerHTML = `<div class="cols"><div class="stack">
      <section class="panel"><div class="panel-h"><div class="t">${icon('salad', 20)}<h3>Plan the client sees</h3></div></div>
        <form class="stack" style="gap:14px" data-f>
          ${field('Food plan', sel('diet', Object.entries(DIETS).map(([k, v]) => [k, v.name]), p.diet))}
          <div class="grid3">${field('Water (glasses/day)', inp('water_target', p.water_target, 'type="number" min="4" max="20"'))}${field('Steps/day', inp('steps_target', p.steps_target, 'type="number" min="1000" step="500"'))}${field('Sleep (hours)', inp('sleep_target', p.sleep_target, 'type="number" min="5" max="10" step="0.5"'))}</div>
          ${field('Note from your coach', `<textarea class="in" name="focus" maxlength="600" placeholder="e.g. This month: dinner by 8 pm, no sugar in tea, walk after lunch at Technopark.">${esc(p.focus || '')}</textarea>`, 'shown on the client\'s plan')}
          <div><button class="btn" data-save>Save plan</button></div></form></section>
      <section class="panel flush"><div class="panel-h" style="padding:18px 20px 4px"><div class="t">${icon('clipboard-check', 20)}<h3>Daily check-ins</h3></div><span class="small muted">last 14 entries</span></div>
        ${ck.length ? `<table class="t"><thead><tr><th>Day</th><th class="n">Water</th><th class="n">Steps</th><th class="n">Sleep</th><th class="n">Meals on plan</th><th class="n">Energy</th></tr></thead><tbody>${ck.map(x => `<tr><td>${esc(fWeekday(x.day))} ${esc(fDay(x.day))}${x.note ? `<div class="small muted">${esc(x.note)}</div>` : ''}</td><td class="n">${x.water ?? '—'}</td><td class="n">${x.steps != null ? x.steps.toLocaleString('en-IN') : '—'}</td><td class="n">${x.sleep ?? '—'}</td><td class="n">${x.meals ?? '—'}/4</td><td class="n">${x.energy ?? '—'}/5</td></tr>`).join('')}</tbody></table>` : emptyState('clipboard-check', 'The client hasn\'t logged a check-in yet.')}</section>
    </div><section class="panel" data-preview>${dietView(p.diet)}</section></div>`;
  const f = el.querySelector('[data-f]');
  f.diet.addEventListener('change', () => { el.querySelector('[data-preview]').innerHTML = dietView(f.diet.value); });
  f.addEventListener('submit', e => e.preventDefault());
  const save = el.querySelector('[data-save]');
  save.addEventListener('click', () => busy(save, () => api(`/staff/clients/${d.client.id}/plan`, { method: 'PUT', body: formData(f) })).then(() => { toast('Plan saved — the client will see it in their app'); after(); }).catch(() => {}));
}

function tabProfile(el, d, after) {
  const c = d.client;
  el.innerHTML = `<div class="cols"><section class="panel"><form class="stack" style="gap:14px" data-f>
      <h3>Details</h3>${clientForm(c, false, d.team || [])}
      ${field('Programme status', sel('status', [['active', 'Active'], ['paused', 'Paused'], ['completed', 'Completed']], c.status))}
      ${field('Team notes', `<textarea class="in" name="staff_notes" maxlength="2000" placeholder="Visible to the team only">${esc(c.staff_notes || '')}</textarea>`)}
      <div><button class="btn" data-save>Save details</button></div></form></section>
    <div class="stack"><section class="panel stack" style="gap:10px"><div class="t" style="display:flex;gap:10px;align-items:center">${icon('shield-check', 20)}<h3>Suitability and consent</h3></div>
      <p class="small muted">Health screening, the clinician's assessment and both signed consents are handled in the Admission tab.</p>
      <div>${admPill(d.admission)} <a class="btn sm ghost" href="#/clients/${c.id}?tab=admission" style="margin-left:6px">Open admission</a></div></section>
    <section class="panel stack" style="gap:12px"><div class="t" style="display:flex;gap:10px;align-items:center">${icon('key-round', 20)}<h3>Client app access</h3></div>
      <p class="small muted">The client signs in at ${esc(APP_URL)} with their mobile number and a 6-digit PIN.</p>
      <div><button class="btn ghost" data-pin>${icon('refresh-cw', 18)}Create new PIN</button></div>
      ${ME.role === 'admin' ? `<div style="border-top:1px solid var(--line-soft);padding-top:12px"><button class="btn danger" data-del>${icon('trash-2', 18)}Delete client and all records</button><p class="small muted" style="margin-top:6px">Use when a client asks for their data to be erased.</p></div>` : ''}</section></div></div>`;
  const f = el.querySelector('[data-f]');
  f.addEventListener('submit', e => e.preventDefault());
  wireLen(f);
  const saveF = el.querySelector('[data-save]');
  saveF.addEventListener('click', () => busy(saveF, () => api('/staff/clients/' + c.id, { method: 'PUT', body: lenToCm(f, formData(f)) })).then(() => { toast('Details saved'); after(); }).catch(() => {}));
  const pinB = el.querySelector('[data-pin]');
  pinB.addEventListener('click', () => { if (confirm('Create a new PIN? The current one will stop working.')) busy(pinB, () => api(`/staff/clients/${c.id}/pin`, { method: 'POST', body: {} })).then(r => showPin({ ...c, pin: r.pin, isNew: false })).catch(() => {}); });
  el.querySelector('[data-del]')?.addEventListener('click', e => { if (prompt(`Type DELETE to erase ${c.name} and every record for them. This cannot be undone.`) === 'DELETE') busy(e.currentTarget, () => api('/staff/clients/' + c.id, { method: 'DELETE', body: {} })).then(() => { toast('Client deleted'); go('#/clients'); }).catch(() => {}); });
}

/* ================= Leads ================= */

async function viewLeads(q) {
  const scope = q.get('scope') || 'ems', status = q.get('status') || 'open';
  const { leads } = await api(U(`/staff/leads?scope=${scope}&status=${encodeURIComponent(status)}`));
  MAIN.innerHTML = `
    <div class="head"><div><h1>Website leads</h1><p>Enquiries from hastawellnessclinic.com and the EMS sign-in page. Book a consultation or add them as a client.</p></div></div>
    <div class="toolbar"><div class="seg">${[['ems', 'EMS & weight'], ['all', 'All services']].map(([k, l]) => `<button data-scope="${k}" class="${k === scope ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="seg">${[['open', 'To follow up'], ['booked', 'Booked'], ['not interested', 'Not interested'], ['all', 'All']].map(([k, l]) => `<button data-status="${k}" class="${k === status ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <section class="panel flush"><div class="rows">${leads.length ? leads.map(l => `<div class="row" style="align-items:flex-start;flex-wrap:wrap">
      <span class="avatar">${esc(initials(l.name))}</span>
      <div class="grow" style="min-width:220px"><b>${esc(l.name)} ${pill(l.status)}</b>
        <span>${esc(l.interest || 'Not specified')}${l.concern ? ' — ' + esc(l.concern) : ''}</span>
        <div class="small faint" style="margin-top:2px">${esc(fWhen(new Date(new Date(l.created_at).getTime() + 330 * 60000).toISOString().slice(0, 16)))} · ${esc(l.source)}${l.preferred_date ? ' · prefers ' + esc(fDay(l.preferred_date)) : ''}${l.timing ? ', ' + esc(l.timing) : ''}${l.booked_at ? ' · consultation ' + esc(fWhen(l.booked_at)) : ''}</div></div>
      <div class="end">
        <a class="btn sm ghost icon" href="tel:${esc(l.phone)}" aria-label="Call">${icon('phone', 16)}</a>
        <a class="btn sm ghost icon" href="${esc(wa(l.phone, reminderText('lead', l)))}" target="_blank" rel="noopener" data-wa-lead="${l.id}" aria-label="WhatsApp">${icon('message-circle', 16)}</a>
        ${l.client_id ? `<a class="btn sm ghost" href="#/clients/${l.client_id}">${icon('user', 16)}Profile</a>` : `<button class="btn sm ghost" data-client="${l.id}">${icon('user-plus', 16)}Add client</button>`}
        <button class="btn sm" data-consult="${l.id}">${icon('calendar-plus', 16)}Book consultation</button>
        ${ALL_UNITS.length > 1 ? `<select class="in" style="height:32px;width:auto;font-size:13px" data-lu="${l.id}" aria-label="Unit"><option value="">Unassigned</option>${ALL_UNITS.filter(u => u.active).map(u => `<option value="${u.id}"${u.id === l.unit_id ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}</select>` : ''}
        <select class="in" style="height:32px;width:auto;font-size:13px" data-st="${l.id}" aria-label="Status">${['new', 'contacted', 'booked', 'not interested'].map(s => `<option value="${s}"${s === l.status ? ' selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select>
      </div></div>`).join('') : emptyState('inbox', 'No leads in this view.')}</div></section>
    <p class="small muted" style="margin-top:10px">Website leads are kept for 90 days. Once someone becomes a client, their record here stays with them.</p>`;
  const setQ = (k, v) => { const p = new URLSearchParams(q); p.set(k, v); location.hash = '#/leads?' + p; };
  MAIN.querySelectorAll('[data-scope]').forEach(b => b.addEventListener('click', () => setQ('scope', b.dataset.scope)));
  MAIN.querySelectorAll('[data-status]').forEach(b => b.addEventListener('click', () => setQ('status', b.dataset.status)));
  const L = id => leads.find(l => l.id === +id);
  MAIN.querySelectorAll('[data-consult]').forEach(b => b.addEventListener('click', () => bookModal({ lead: L(b.dataset.consult), kind: 'consultation', after: () => { refreshBadges(); reload(); } })));
  MAIN.querySelectorAll('[data-client]').forEach(b => b.addEventListener('click', () => { const l = L(b.dataset.client); clientModal({ name: l.name, phone: l.phone, goal: l.concern, lead_id: l.id }, () => { refreshBadges(); }); }));
  MAIN.querySelectorAll('[data-lu]').forEach(s => s.addEventListener('change', () => api('/staff/leads/' + s.dataset.lu, { method: 'PUT', body: { unit_id: s.value } }).then(() => toast(s.value ? 'Lead assigned to ' + unitName(+s.value) : 'Lead unassigned')).catch(e => toast(e.message, true))));
  MAIN.querySelectorAll('[data-st]').forEach(s => s.addEventListener('change', () => api('/staff/leads/' + s.dataset.st, { method: 'PUT', body: { status: s.value } }).then(() => { toast('Lead updated'); refreshBadges(); }).catch(e => toast(e.message, true))));
  MAIN.querySelectorAll('[data-wa-lead]').forEach(a => a.addEventListener('click', () => { const l = L(a.dataset.waLead); if (l.status === 'new') api('/staff/reminders/log', { method: 'POST', body: { kind: 'lead', ref: String(l.id), lead_id: l.id } }).then(() => refreshBadges()).catch(() => {}); }));
}

/* ================= Follow-ups ================= */

const REM_GROUPS = [
  ['tomorrow', 'calendar-check', 'Appointments tomorrow', 'Send a reminder the evening before to cut no-shows.'],
  ['admission', 'shield-check', 'Admission and consent', 'Questionnaires to fill in, consents waiting for a signature, and admissions due for renewal.'],
  ['lead', 'inbox', 'New enquiries', 'Website leads not yet contacted.'],
  ['rebook', 'calendar-plus', 'Needs a next booking', 'Clients with sessions left and nothing booked.'],
  ['expiry', 'clock', 'Packages expiring', 'Unused sessions on packages ending within 14 days.'],
  ['renew', 'package', 'Ready to renew', 'Two sessions or fewer left.'],
  ['balance', 'wallet', 'Payments due', 'Outstanding balances on packages.'],
  ['measure', 'ruler', 'Measurements due', 'No progress check in the last two weeks.'],
];

function remRow(r) {
  const g = REM_GROUPS.find(x => x[0] === r.kind) || REM_GROUPS[0];
  return `<div class="row" data-rem="${esc(r.kind + '|' + r.ref)}">
    <span class="hic" style="width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:var(--teal-mist);color:var(--teal);flex:none">${icon(g[1], 18)}</span>
    <div class="grow">${r.client_id ? `<a href="#/clients/${r.client_id}" style="text-decoration:none"><b>${esc(r.name)}</b></a>` : `<b>${esc(r.name)}</b>`}<span>${esc(r.title)}</span></div>
    <div class="end"><a class="btn sm wa" href="${esc(wa(r.phone, reminderText(r.kind, r)))}" target="_blank" rel="noopener" data-send>${icon('message-circle', 16)}<span class="hide-m">WhatsApp</span></a>
      <button class="btn sm quiet icon" data-done aria-label="Mark done" title="Mark done">${icon('check', 16)}</button></div></div>`;
}

function bindRemActions(root, list) {
  root.addEventListener('click', e => {
    const row = e.target.closest('[data-rem]');
    if (!row || !(e.target.closest('[data-send]') || e.target.closest('[data-done]'))) return;
    const [kind, ref] = row.dataset.rem.split('|');
    const r = list.find(x => x.kind === kind && x.ref === ref);
    api('/staff/reminders/log', { method: 'POST', body: { kind, ref, client_id: r && r.client_id, lead_id: r && r.lead_id } })
      .then(() => { row.style.opacity = '.45'; row.querySelector('[data-done]')?.remove(); refreshBadges(); if (e.target.closest('[data-done]')) toast('Marked as done'); })
      .catch(err => toast(err.message, true));
  });
}

async function viewReminders() {
  const { reminders } = await api(U('/staff/reminders'));
  MAIN.innerHTML = `<div class="head"><div><h1>Follow-ups</h1><p>Everything that needs a message today. Sending on WhatsApp marks it done for three days.</p></div></div>
    ${reminders.length ? `<div class="stack">${REM_GROUPS.map(([k, ic, t, sub]) => { const items = reminders.filter(r => r.kind === k); if (!items.length) return '';
      return `<section class="panel flush"><div class="panel-h" style="padding:18px 20px 0"><div class="t">${icon(ic, 20)}<div><h3>${t} <span class="muted" style="font-weight:600">${items.length}</span></h3><p class="small muted">${sub}</p></div></div></div>
        <div class="rows" style="margin-top:8px">${items.map(remRow).join('')}</div></section>`; }).join('')}</div>`
      : `<section class="panel">${emptyState('check-circle', 'All caught up — no follow-ups waiting.')}</section>`}`;
  bindRemActions(MAIN, reminders);
}

/* ================= Payments ================= */

async function viewPayments(q) {
  if (!ALL_UNITS.length) await loadUnits();
  const from = q.get('from') || today().slice(0, 8) + '01', to = q.get('to') || today();
  const r = await api(U(`/staff/payments?from=${from}&to=${to}`));
  const total = r.payments.reduce((a, p) => a + p.amount, 0);
  const byMethod = {};
  r.payments.forEach(p => { byMethod[p.method] = (byMethod[p.method] || 0) + p.amount; });
  MAIN.innerHTML = `<div class="head"><div><h1>Payments</h1><p>${esc(fDate(from))} to ${esc(fDate(to))}</p></div>
      <div class="acts"><form class="toolbar" style="margin:0" data-range><input class="in" type="date" name="from" value="${from}" style="width:auto"><input class="in" type="date" name="to" value="${to}" style="width:auto"><button class="btn ghost">${icon('filter', 16)}Show</button></form>
      <button class="btn ghost" data-csv>${icon('copy', 16)}Download CSV</button></div></div>
    <section class="kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))">
      <div class="kpi"><span class="l">${icon('badge-indian-rupee', 16)}Received</span><span class="v">${inr(total)}</span><span class="s">${r.payments.length} payment${r.payments.length === 1 ? '' : 's'}</span></div>
      <div class="kpi"><span class="l">${icon('circle-dollar-sign', 16)}By method</span><span class="v" style="font-size:16px;line-height:1.6">${Object.entries(byMethod).map(([k, v]) => `${esc(k)} ${inr(v)}`).join('<br>') || '—'}</span></div>
      <div class="kpi"><span class="l">${icon('wallet', 16)}Outstanding (all clients)</span><span class="v">${inr(r.outstanding)}</span><span class="s"><a href="#/reminders">Payment follow-ups</a></span></div></section>
    <section class="panel flush">${r.payments.length ? `<table class="t"><thead><tr><th>Date</th><th>Client</th><th>Package</th><th>Method</th><th class="n">Amount</th></tr></thead><tbody>
      ${r.payments.map(p => `<tr class="click" data-c="${p.client_id}"><td>${esc(fDate(p.paid_on))}</td><td><b>${esc(p.client_name || '')}</b></td><td>${esc(p.package_name || '')}${multi() ? `<div class="small muted">${esc(p.unit_name || '')}</div>` : ''}</td><td>${esc(p.method)}${p.reference ? `<div class="small muted">${esc(p.reference)}</div>` : ''}</td><td class="n"><b>${inr(p.amount)}</b></td></tr>`).join('')}</tbody></table>`
      : emptyState('receipt', 'No payments in this period.')}</section>`;
  if (ME.role === 'admin' && ALL_UNITS.length > 1) {
    const st = await api(`/staff/reports/settlement?from=${from}&to=${to}`);
    MAIN.insertAdjacentHTML('beforeend', `<section class="panel flush" style="margin-top:18px"><div class="panel-h" style="padding:18px 20px 4px"><div class="t">${icon('refresh-cw', 20)}<div><h3>Cross-unit sessions</h3><p class="small muted">Sessions delivered at one unit from a package sold by another, for the same dates. "Payable" uses the delivering unit's revenue share.</p></div></div></div>
      ${st.rows.length ? `<table class="t"><thead><tr><th>Delivered by</th><th>Package sold by</th><th class="n">Sessions</th><th class="n">Session value</th><th class="n">Payable to delivering unit</th></tr></thead><tbody>${st.rows.map(r => `<tr><td><b>${esc(r.delivered_name)}</b>${r.franchise ? ' <span class="pill warn">Franchise</span>' : ''}</td><td>${esc(r.sold_name)}</td><td class="n">${r.sessions}</td><td class="n">${inr(r.value)}</td><td class="n"><b>${inr(r.payable)}</b> <span class="small muted">(${r.share}%)</span></td></tr>`).join('')}</tbody></table>` : emptyState('refresh-cw', 'No cross-unit sessions in this period.')}</section>`);
  }
  MAIN.querySelector('[data-range]').addEventListener('submit', e => { e.preventDefault(); location.hash = `#/payments?from=${e.target.from.value}&to=${e.target.to.value}`; });
  MAIN.querySelectorAll('tr[data-c]').forEach(t => t.addEventListener('click', () => go(`#/clients/${t.dataset.c}?tab=payments`)));
  MAIN.querySelector('[data-csv]').addEventListener('click', () => {
    const q = v => '"' + String(v ?? '').replace(/"/g, '""').replace(/^([=+\-@])/, "'$1") + '"';
    const csv = ['Date,Client,Package,Method,Reference,Amount'].concat(r.payments.map(p => [p.paid_on, p.client_name, p.package_name, p.method, p.reference, p.amount].map(q).join(','))).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = `hasta-ems-payments-${from}-to-${to}.csv`; a.click();
  });
}

/* ================= Settings ================= */

async function viewSettings() {
  const admin = ME.role === 'admin';
  await loadUnits();
  const [{ packages }, users, tm] = await Promise.all([api('/staff/packages'), admin ? api('/staff/users').then(r => r.users) : Promise.resolve([]), team(true)]);
  const clientsOf = id => (tm.find(t => t.id === id) || {}).clients || 0;
  MAIN.innerHTML = `<div class="head"><div><h1>Settings</h1><p>Packages, team access and your account.</p></div></div>
    <div class="stack">
      <section class="panel flush"><div class="panel-h" style="padding:18px 20px 4px"><div class="t">${icon('home', 20)}<h3>Units</h3></div>${admin ? `<button class="btn sm gold" data-new-unit>${icon('plus', 16)}New unit</button>` : ''}</div>
        <table class="t"><thead><tr><th>Unit</th><th>Ownership</th><th class="n">Devices</th><th>Hours</th><th>Status</th></tr></thead><tbody>
        ${UNITS.map(u => `<tr class="${admin ? 'click' : ''}" data-unit-row="${u.id}"><td><b>${esc(u.name)}</b><div class="small muted">${esc(u.code)}${u.district ? ' — ' + esc(u.district) : ''}</div></td><td>${u.ownership === 'franchise' ? `Franchise<div class="small muted">${esc(u.franchise_name || '')} · ${u.revenue_share}% share</div>` : 'Company-owned'}</td><td class="n">${u.devices}</td><td class="small">${hoursText(u.hours)}</td><td>${u.active ? pill('active') : pill('closed', 'Closed')}</td></tr>`).join('')}</tbody></table></section>
      <section class="panel flush"><div class="panel-h" style="padding:18px 20px 4px"><div class="t">${icon('zap', 20)}<h3>Machines</h3></div>${admin ? `<button class="btn sm gold" data-new-machine>${icon('plus', 16)}New machine</button>` : ''}</div>
        <table class="t"><thead><tr><th>Machine</th><th>Type</th><th>Features</th><th class="n">Devices</th><th class="n">Certified trainers</th></tr></thead><tbody>
        ${MACHINES.map(m => `<tr class="${admin ? 'click' : ''}" data-machine="${m.id}"><td><b>${esc(m.name)}</b><div class="small muted">${esc(m.brand || '')}${m.active ? '' : ' (hidden)'}</div></td><td>${esc(m.category)}</td><td class="small">${esc((m.features || []).join(' · '))}</td><td class="n">${m.devices}</td><td class="n">${m.trainers ? m.trainers : '<span style="color:var(--warn)">0</span>'}</td></tr>`).join('') || `<tr><td colspan="5">${emptyState('zap', 'No machines yet.')}</td></tr>`}</tbody></table></section>
      <section class="panel flush" data-certs></section>
      <section class="panel flush"><div class="panel-h" style="padding:18px 20px 4px"><div class="t">${icon('package', 20)}<h3>Package catalogue</h3></div>${admin ? `<button class="btn sm gold" data-new-pkg>${icon('plus', 16)}New package</button>` : ''}</div>
        <table class="t"><thead><tr><th>Package</th><th>Includes</th><th class="n">Price</th><th class="n">Cost</th><th class="n">Margin</th><th class="n">Max discount</th><th>Status</th></tr></thead><tbody>
        ${packages.map(p => { const cost = p.valuation.cost, m = p.price ? Math.round((p.price - cost) / p.price * 100) : null; return `<tr class="${admin ? 'click' : ''}" data-pkg="${p.id}"><td><b>${esc(p.name)}</b><div class="small muted">${esc(PROGRAMME_LABEL[p.programme] || 'EMS programme')} — ${machineList(p.machine_types).length ? esc(machineList(p.machine_types).map(machineName).join(', ')) : 'any machine'} — ${p.validity_days} days</div></td><td class="small">${esc(includesText(p.ent, p.sessions))}</td><td class="n">${p.price != null ? inr(p.price) : '<span style="color:var(--warn)">Set price</span>'}</td><td class="n">${inr(cost)}</td><td class="n">${m == null ? '—' : `<b style="color:${m < 20 ? 'var(--alert)' : m < 40 ? 'var(--warn)' : 'var(--good)'}">${m}%</b>`}</td><td class="n">${p.max_discount || 0}%</td><td>${p.active ? pill('active') : pill('closed', 'Hidden')}</td></tr>`; }).join('')}</tbody></table></section>
      <section class="panel flush" data-prices></section>
      ${admin ? `<section class="panel flush"><div class="panel-h" style="padding:18px 20px 4px"><div class="t">${icon('users', 20)}<h3>Team accounts</h3></div><button class="btn sm gold" data-new-user>${icon('user-plus', 16)}Add team member</button></div>
        <div class="rows">${users.some(u => u.username === 'hasta') ? '' : `<div class="row"><span class="avatar">CA</span><div class="grow"><b>Clinic admin</b><span>Username "hasta" — password is the website admin password</span></div>${pill('active', 'Admin')}</div>`}
        ${users.map(u => `<div class="row click" data-user="${u.id}"><span class="avatar">${esc(initials(u.name))}</span><div class="grow"><b>${esc(u.name)}</b><span>${esc(u.username)} — ${esc((u.skills || []).map(k => SKILLS[k]).join(', ') || 'no skills set')}${ALL_UNITS.length > 1 ? ' — ' + esc(u.role === 'admin' ? 'all units' : (u.units || []).map(unitName).join(', ')) : ''}</span></div><a class="btn sm quiet" href="#/clients?coach=${u.id}" onclick="event.stopPropagation()">${clientsOf(u.id)} active client${clientsOf(u.id) === 1 ? '' : 's'}</a>${pill(u.active ? 'active' : 'closed', u.active ? ({ admin: 'Admin', manager: 'Unit manager' }[u.role] || 'Team') : 'Disabled')}</div>`).join('')}</div></section>` : ''}
      <section class="panel"><div class="panel-h"><div class="t">${icon('key-round', 20)}<h3>Your account</h3></div></div>
        ${ME.id === 0 ? '<p class="muted">You are signed in with the clinic admin account. Its password is the ADMIN_PASSWORD secret in Cloudflare. Add personal team accounts above so each person signs in as themselves.</p>'
          : `<form class="grid3" data-pw style="align-items:end">${field('Current password', inp('current', '', 'type="password" autocomplete="current-password"'))}${field('New password', inp('next', '', 'type="password" autocomplete="new-password" minlength="8"'))}<div><button class="btn">Change password</button></div></form>`}</section>
      <section class="panel"><div class="panel-h"><div class="t">${icon('phone', 20)}<h3>Client app</h3></div></div>
        <p class="muted">Clients sign in at <b>${esc(APP_URL)}</b> with their mobile number and PIN, and can book at any unit with a free device and trainer. Each trainer supervises one client at a time.</p></section>
    </div>`;
  renderCerts(MAIN.querySelector('[data-certs]'), tm);
  renderPrices(MAIN.querySelector('[data-prices]'), admin);
  PRICE_CACHE = null;
  if (admin) {
    MAIN.querySelector('[data-new-machine]').addEventListener('click', () => machineModal(null));
    MAIN.querySelectorAll('[data-machine]').forEach(r => r.addEventListener('click', () => machineModal(MACHINES.find(m => m.id === +r.dataset.machine))));
    MAIN.querySelector('[data-new-unit]').addEventListener('click', () => unitModal(null));
    MAIN.querySelectorAll('[data-unit-row]').forEach(r => r.addEventListener('click', async () => unitModal((await api('/staff/units/' + r.dataset.unitRow)))));
    MAIN.querySelector('[data-new-pkg]').addEventListener('click', () => pkgDefModal(null));
    MAIN.querySelectorAll('[data-pkg]').forEach(r => r.addEventListener('click', () => pkgDefModal(packages.find(p => p.id === +r.dataset.pkg))));
    MAIN.querySelector('[data-new-user]').addEventListener('click', () => userModal(null));
    MAIN.querySelectorAll('[data-user]').forEach(r => r.addEventListener('click', () => userModal(users.find(u => u.id === +r.dataset.user))));
  }
  const pw = MAIN.querySelector('[data-pw]');
  pw && pw.addEventListener('submit', e => { e.preventDefault(); busy(pw.querySelector('button'), () => api('/me/secret', { method: 'POST', body: formData(pw) })).then(() => { toast('Password changed'); pw.reset(); }).catch(() => {}); });
}

let PRICE_CACHE = null;
async function prices() { if (!PRICE_CACHE) PRICE_CACHE = (await api('/staff/price-list')).items; return PRICE_CACHE; }

async function renderPrices(el, admin) {
  const items = await prices();
  el.innerHTML = `<div class="panel-h" style="padding:18px 20px 4px"><div class="t">${icon('badge-indian-rupee', 20)}<div><h3>Price list</h3><p class="small muted">List price and internal cost of each item. The package builder uses these to show value, cost and margin.</p></div></div>${admin ? '<button class="btn sm" data-save-prices>Save prices</button>' : ''}</div>
    <table class="t"><thead><tr><th>Item</th><th>Unit</th><th class="n">List price (₹)</th><th class="n">Cost to deliver (₹)</th></tr></thead><tbody>
    ${items.map(i => `<tr><td><b>${esc(i.label)}</b></td><td class="small muted">${esc(i.unit)}</td><td class="n">${admin ? `<input class="in" style="width:120px;text-align:right" type="number" min="0" data-pp="${i.item}" value="${i.price}">` : inr(i.price)}</td><td class="n">${admin ? `<input class="in" style="width:120px;text-align:right" type="number" min="0" data-pc="${i.item}" value="${i.cost}">` : inr(i.cost)}</td></tr>`).join('')}</tbody></table>
    ${items.every(i => !i.price) ? '<p class="small" style="padding:0 20px 16px;color:var(--warn)">Prices are not set yet. Enter them so the builder can calculate package value and margin.</p>' : ''}`;
  el.querySelector('[data-save-prices]')?.addEventListener('click', e => busy(e.currentTarget, () => api('/staff/price-list', { method: 'PUT', body: { items: items.map(i => ({ item: i.item, price: el.querySelector(`[data-pp="${i.item}"]`).value, cost: el.querySelector(`[data-pc="${i.item}"]`).value })) } })).then(() => { PRICE_CACHE = null; toast('Prices saved'); reload(); }).catch(() => {}));
}

async function pkgDefModal(p) {
  const items = await prices();
  const P = Object.fromEntries(items.map(i => [i.item, i]));
  p = p || { name: '', programme: 'ems', sessions: 10, price: '', validity_days: 60, description: '', active: 1, max_discount: 0, ent: { reviews: 0, wm_consults: 0, diet_plan: false, measurements: false } };
  const e = p.ent || {};
  modal({
    title: p.id ? 'Package builder · ' + p.name : 'Package builder', wide: true,
    body: `<form class="stack" style="gap:14px" data-f>
      <div class="grid3">${field('Package name', inp('name', p.name, 'maxlength="80" placeholder="e.g. EMS Starter"'))}${field('Programme', sel('programme', [['ems', 'EMS programme'], ['weight', 'Weight management only'], ['combined', 'EMS + weight management']], p.programme || 'ems'), 'admission must cover this')}${field('Valid for (days)', inp('validity_days', p.validity_days, 'type="number" min="7"'))}</div>
      <div><h4 style="margin-bottom:8px">What's included</h4><div class="qs">
        <div class="q"><p><b>EMS sessions</b><br><span class="small muted">${inr(P.ems_session.price)} each · cost ${inr(P.ems_session.cost)}</span></p><input class="in" name="sessions" type="number" min="0" max="200" value="${p.sessions ?? 0}" style="width:100px;text-align:right"></div>
        <div class="q"><p><b>Progress reviews</b> <span class="small muted">(monthly review with measurements)</span><br><span class="small muted">${inr(P.review.price)} each · cost ${inr(P.review.cost)}</span></p><input class="in" name="reviews" type="number" min="0" max="52" value="${e.reviews || 0}" style="width:100px;text-align:right"></div>
        <div class="q"><p><b>Weight-management consultations</b><br><span class="small muted">${inr(P.wm_consult.price)} each · cost ${inr(P.wm_consult.cost)}</span></p><input class="in" name="wm_consults" type="number" min="0" max="52" value="${e.wm_consults || 0}" style="width:100px;text-align:right"></div>
        <div class="q"><p><b>Diet and lifestyle plan</b> <span class="small muted">with daily check-ins</span><br><span class="small muted">${inr(P.diet_plan.price)} · cost ${inr(P.diet_plan.cost)}</span></p><label class="check"><input type="checkbox" name="diet_plan" ${e.diet_plan ? 'checked' : ''}> Included</label></div>
        <div class="q"><p><b>Progress measurements and charts</b><br><span class="small muted">${inr(P.measurements.price)} · cost ${inr(P.measurements.cost)}</span></p><label class="check"><input type="checkbox" name="measurements" ${e.measurements ? 'checked' : ''}> Included</label></div>
      </div></div>
      <div><h4 style="margin-bottom:8px">Machines this package uses</h4><div class="chips">${MACHINES.filter(m => m.active).map(m => `<label class="chip"><input type="checkbox" name="mt_${m.id}" ${machineList(p.machine_types).includes(m.id) ? 'checked' : ''}>${esc(m.name)}</label>`).join('') || '<span class="muted small">Add machines first.</span>'}</div><p class="small muted" style="margin-top:6px">Leave all unticked to allow any machine.</p></div>
      <div class="metrics" data-calc></div>
      <div class="grid3">${field('Selling price (₹)', inp('price', p.price ?? '', 'type="number" min="0"'))}${field('Max staff discount', sel('max_discount', [0, 5, 10, 15, 20, 25].map(x => [x, x ? x + '%' : 'No discount']), p.max_discount || 0), 'at the point of sale')}${field('Status', sel('active', [['1', 'Available to sell'], ['0', 'Hidden']], p.active ? '1' : '0'))}</div>
      ${field('Description', inp('description', p.description || '', 'maxlength="200"'))}
      <label class="check" data-bc hidden><input type="checkbox" name="below_cost"> Allow a selling price below cost</label></form>
      <p class="small muted">Staff can only sell what's included here. Bookings, plans and measurements outside the package are blocked. Changing a package doesn't change packages already sold.</p>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Save package</button>`,
    onMount(el, close) {
      const f = el.querySelector('[data-f]');
      const calc = () => {
        const n = k => Math.max(0, parseInt(f[k].value, 10) || 0);
        const list = n('sessions') * P.ems_session.price + n('reviews') * P.review.price + n('wm_consults') * P.wm_consult.price + (f.diet_plan.checked ? P.diet_plan.price : 0) + (f.measurements.checked ? P.measurements.price : 0);
        const cost = n('sessions') * P.ems_session.cost + n('reviews') * P.review.cost + n('wm_consults') * P.wm_consult.cost + (f.diet_plan.checked ? P.diet_plan.cost : 0) + (f.measurements.checked ? P.measurements.cost : 0);
        const price = parseInt(f.price.value, 10);
        const has = Number.isFinite(price);
        const margin = has && price ? Math.round((price - cost) / price * 100) : null;
        const worst = has ? price - Math.floor(price * (+f.max_discount.value) / 100) : null;
        el.querySelector('[data-calc]').innerHTML = `<div class="metric"><div class="l">List value</div><div class="v">${inr(list)}</div></div><div class="metric"><div class="l">Cost to deliver</div><div class="v">${inr(cost)}</div></div>
          <div class="metric"><div class="l">Margin at selling price</div><div class="v" style="color:${margin == null ? 'inherit' : margin < 20 ? 'var(--alert)' : margin < 40 ? 'var(--warn)' : 'var(--good)'}">${margin == null ? '—' : margin + '%'}</div>${has && list ? `<span class="small faint">${price <= list ? Math.round((1 - price / list) * 100) + '% off list' : 'above list'}</span>` : ''}</div>
          <div class="metric"><div class="l">After max discount</div><div class="v">${worst == null ? '—' : inr(worst)}</div>${worst != null && worst < cost ? '<span class="small" style="color:var(--alert)">below cost</span>' : ''}</div>`;
        el.querySelector('[data-bc]').hidden = !(has && price < cost);
        if (!f.price.value && list) f.price.placeholder = String(list);
      };
      f.addEventListener('input', calc); f.addEventListener('change', calc); calc();
      const save = el.querySelector('[data-save]');
      save.addEventListener('click', () => busy(save, () => { const b = formData(f); b.active = b.active === '1'; b.machine_types = MACHINES.filter(m => b['mt_' + m.id]).map(m => m.id); return api('/staff/packages' + (p.id ? '/' + p.id : ''), { method: p.id ? 'PUT' : 'POST', body: b }); }).then(() => { close(); toast('Package saved'); reload(); }).catch(() => {}));
    },
  });
}

function userModal(u) {
  u = u || { name: '', username: '', role: 'staff', active: 1, skills: ['trainer'], units: UNIT ? [UNIT] : ALL_UNITS.slice(0, 1).map(x => x.id) };
  modal({
    title: u.id ? 'Edit team member' : 'Add team member',
    body: `<form class="stack" style="gap:14px" data-f><div class="grid2">${field('Name', inp('name', u.name))}${field('Username', inp('username', u.username, 'autocapitalize="none"'))}</div>
      <div><h4 style="margin-bottom:8px">Skills</h4><div class="chips">${Object.entries(SKILLS).map(([k, l]) => `<label class="chip"><input type="checkbox" name="sk_${k}" ${(u.skills || []).includes(k) ? 'checked' : ''}>${esc(l)}</label>`).join('')}</div><p class="small muted" style="margin-top:6px">EMS trainers run sessions. Coaches and doctors do consultations and admission assessments.</p></div>
      ${field('Registration no.', inp('reg_no', u.reg_no || ''), 'doctors only')}
      <div><h4 style="margin-bottom:8px">Works at</h4><div class="chips">${ALL_UNITS.filter(x => x.active).map(x => `<label class="chip"><input type="checkbox" name="un_${x.id}" ${(u.units || []).includes(x.id) ? 'checked' : ''}>${esc(x.name)}</label>`).join('')}</div></div>
      <div class="grid2">${field('Role', sel('role', [['staff', 'Team — clients, bookings, payments'], ['manager', 'Unit manager — also rota and leave'], ['admin', 'Admin — all units, packages, team']], u.role))}${field(u.id ? 'New password' : 'Password', inp('password', '', 'type="password" autocomplete="new-password"'), u.id ? 'leave blank to keep' : 'at least 8 characters')}</div>
      ${u.id ? `<label class="check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Account active</label>` : ''}</form>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Save</button>`,
    onMount(el, close) {
      const save = el.querySelector('[data-save]');
      save.addEventListener('click', () => busy(save, () => { const b = formData(el.querySelector('[data-f]')); if (!u.id) b.active = true;
        b.skills = Object.keys(SKILLS).filter(k => b['sk_' + k]); b.units = ALL_UNITS.filter(x => b['un_' + x.id]).map(x => x.id); return api('/staff/users' + (u.id ? '/' + u.id : ''), { method: u.id ? 'PUT' : 'POST', body: b }); }).then(() => { close(); toast('Team member saved'); team(true); reload(); }).catch(() => {}));
    },
  });
}

/* ================= Admission ================= */

function tabAdmission(el, d, after) {
  const c = d.client, a = d.admission, st = admState(a), Q = d.screen_questions;
  const pdf = x => `${BASE}/api/staff/admissions/${x.id}/pdf`;
  const history = d.admissions.length ? `<section class="panel flush"><div class="panel-h" style="padding:18px 20px 4px"><div class="t">${icon('clipboard-check', 20)}<h3>Admission records</h3></div></div>
    <table class="t"><thead><tr><th>Started</th><th>Programme</th><th>Status</th><th>Clinician</th><th>Client signed</th><th></th></tr></thead><tbody>${d.admissions.map(x => `<tr><td>${esc(fDate(x.created_at))}</td><td>${x.programmes.map(p => esc(PROGRAMME_LABEL[p])).join(', ')}</td><td>${admPill(x)}</td><td>${x.clinician_name ? esc(x.clinician_name) + `<div class="small muted">${esc(x.clinician_role)}</div>` : '—'}</td><td>${x.client_signed_at ? esc(fDate(x.client_signed_at)) + `<div class="small muted">${x.client_sign_where === 'app' ? 'in app' : 'at clinic'}</div>` : '—'}</td>
    <td class="n"><a class="btn sm ghost" href="${pdf(x)}" download>${icon('printer', 15)}PDF</a></td></tr>`).join('')}</tbody></table></section>` : '';
  const withdrawBtn = a && ['screening', 'assessment', 'client_consent', 'admitted'].includes(a.status) && st !== 'expired' ? `<button class="btn danger sm" data-withdraw>${icon('x', 15)}${a.status === 'admitted' ? 'Withdraw consent' : 'Cancel admission'}</button>` : '';
  let body = '';

  if (['none', 'not_suitable', 'withdrawn', 'expired'].includes(st)) {
    body = `<section class="panel stack" style="gap:14px">
      ${st === 'not_suitable' ? `<div class="ins alert">${icon('shield-alert', 20)}<div><b>Assessed as not suitable on ${esc(fDate(a.clinician_signed_at))}</b><p>${esc(a.findings || '')} — ${esc(a.clinician_name)}, ${esc(a.clinician_role)}</p></div></div>` : ''}
      ${st === 'withdrawn' ? `<div class="ins warn">${icon('info', 20)}<div><b>Consent withdrawn ${esc(fDate(a.withdrawn_at))}</b><p>${esc(a.withdrawn_reason || '')}</p></div></div>` : ''}
      ${st === 'expired' ? `<div class="ins warn">${icon('clock', 20)}<div><b>Admission expired on ${esc(fDate(a.valid_until))}</b><p>Admissions last 12 months. Repeat the screening, assessment and consent to continue.</p></div></div>` : ''}
      <div class="panel-h" style="margin:0"><div class="t">${icon('shield-check', 20)}<h3>${st === 'none' ? 'Start admission' : 'Start a new admission'}</h3></div></div>
      <p class="muted">No package can be assigned and no EMS session booked until all three steps are done: the client's health screening, the coach or doctor's assessment with their signed recommendation, and the client's signed consent.</p>
      <form data-start class="stack" style="gap:12px"><div><h4 style="margin-bottom:8px">Programmes this admission covers</h4><div class="chips">
        <label class="chip"><input type="checkbox" name="ems" checked>${icon('zap', 15)}EMS programme</label>
        <label class="chip"><input type="checkbox" name="weight">${icon('salad', 15)}Weight management</label></div></div>
        ${c.birth_year ? '' : `<p class="note">${icon('info', 15)} Add the client's year of birth in Profile first — programmes are for adults aged 18+.</p>`}
        <div><button class="btn gold">${icon('shield-check', 18)}Start admission</button></div></form></section>`;
  } else if (st === 'screening') {
    body = `<section class="panel stack" style="gap:14px"><div class="panel-h" style="margin:0"><div class="t">${icon('clipboard-check', 20)}<h3>Step 1 — Health screening</h3></div>
        <a class="btn sm wa" target="_blank" rel="noopener" href="${esc(wa(c.phone, reminderText('admission', { name: c.name, step: 'screening' })))}">${icon('message-circle', 15)}Ask client to fill it in the app</a></div>
      <p class="muted">Go through each question with the client, or let them answer in their app. Every question needs a Yes or No.</p>
      <form data-scr class="stack" style="gap:14px">${screeningForm(Q, a.screening)}<div><button class="btn">${icon('check', 18)}Save screening</button></div></form></section>`;
  } else if (st === 'assessment') {
    const yes = Q.filter(([k]) => a.screening.answers[k]);
    body = `<div class="cols"><section class="panel stack" style="gap:14px"><div class="panel-h" style="margin:0"><div class="t">${icon('stethoscope', 20)}<h3>Step 2 — Clinician assessment</h3></div></div>
      <form data-asm class="stack" style="gap:14px">
        <div><h4 style="margin-bottom:8px">Assessment</h4><div class="chips"><label class="chip"><input type="radio" name="assess_mode" value="in_person" checked>${icon('home', 15)}In person</label><label class="chip"><input type="radio" name="assess_mode" value="video">${icon('phone', 15)}By video call</label></div></div>
        <div class="grid3">${field('Blood pressure', inp('bp', '', 'placeholder="120/80" inputmode="numeric"'), 'mmHg')}${field('Resting heart rate', inp('heart_rate', '', 'type="number" inputmode="numeric"'), 'bpm')}${field('Weight', inp('assess_weight', '', 'type="number" step="0.1" inputmode="decimal"'), 'kg')}</div>
        ${field('Findings', `<textarea class="in" name="findings" maxlength="1000" placeholder="${yes.length ? 'Required: comment on each Yes answer' : 'e.g. No contraindications found'}"></textarea>`)}
        <div><h4 style="margin-bottom:8px">Decision</h4><div class="chips">
          <label class="chip"><input type="radio" name="decision" value="suitable">Suitable</label>
          <label class="chip"><input type="radio" name="decision" value="conditions">Suitable with precautions</label>
          <label class="chip"><input type="radio" name="decision" value="not_suitable">Not suitable now</label></div></div>
        ${field('Precautions the client must follow', `<textarea class="in" name="precautions" maxlength="600" placeholder="e.g. Low intensity for first 4 sessions; avoid abdominal pads; check BP before each session"></textarea>`, 'required for "with precautions"')}
        <div class="grid3">${field('Clinician name', inp('clinician_name', ME.id ? ME.name : ''))}${field('Role', sel('clinician_role', ['Wellness coach', 'Doctor', 'Physiotherapist', 'Dietitian', 'Nurse'], 'Wellness coach'))}${field('Registration no.', inp('clinician_reg', ''), 'required for doctors')}</div>
        <div><h4 style="margin-bottom:8px">Clinician signature</h4><div data-sig></div></div>
        <label class="check"><input type="checkbox" name="confirm"> <span>I have assessed this client in person and the recommendation is my professional judgement. I sign it on behalf of Hasta Wellness.</span></label>
        <div><button class="btn gold">${icon('pencil', 18)}Sign recommendation</button></div></form></section>
      <section class="panel stack" style="gap:12px"><div class="t" style="display:flex;gap:10px;align-items:center">${icon('clipboard-check', 20)}<h3>Screening answers</h3></div>
        <p class="small muted">Completed ${esc(fDate(a.screened_at))} by ${esc(a.screened_by)}</p>
        ${yes.length ? `<div class="yes-list">${yes.map(([, q]) => `<div>${icon('alert-triangle', 16)}<span>Yes — ${esc(q)}</span></div>`).join('')}</div>` : `<div class="ins good">${icon('check-circle', 20)}<div><b>No to every question</b><p>No contraindications reported.</p></div></div>`}
        <dl class="kv"><dt>Medicines</dt><dd>${esc(a.screening.medicines || 'None stated')}</dd><dt>Other</dt><dd>${esc(a.screening.other || 'None stated')}</dd></dl>
        <button class="btn sm ghost" data-redo-scr>${icon('pencil', 15)}Edit screening</button></section></div>`;
  } else if (st === 'client_consent') {
    body = `<div class="cols"><section class="panel stack" style="gap:14px"><div class="panel-h" style="margin:0"><div class="t">${icon('pencil', 20)}<h3>Step 3 — Client consent</h3></div></div>
      <p class="muted">The client reads both letters and signs. They can do it in their app, or here on this device at the clinic.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn gold" data-sign-now>${icon('pencil', 18)}Sign now at the clinic</button>
        <a class="btn wa" target="_blank" rel="noopener" href="${esc(wa(c.phone, reminderText('admission', { name: c.name, step: 'sign' })))}">${icon('message-circle', 18)}Send to the client's app</a></div>
      ${letterBox('Client consent (to be signed)', a.client_letter)}</section>
      <section class="panel stack" style="gap:12px">${letterBox('Clinician recommendation — signed', a.clinician_letter, `Signed by ${esc(a.clinician_name)}, ${esc(a.clinician_role)}${a.clinician_reg ? ' · Reg. ' + esc(a.clinician_reg) : ''} · ${esc(fWhen(new Date(new Date(a.clinician_signed_at).getTime() + 330 * 60000).toISOString().slice(0, 16)))}`)}</section></div>`;
  } else if (st === 'admitted') {
    body = `<section class="panel stack" style="gap:14px"><div class="ins good">${icon('shield-check', 22)}<div><b>Admitted to the ${a.programmes.map(p => esc(PROGRAMME_LABEL[p])).join(' and ')} until ${esc(fDate(a.valid_until))}</b>
        <p>Recommended by ${esc(a.clinician_name)} (${esc(a.clinician_role)}) on ${esc(fDate(a.clinician_signed_at))}. Consent signed by ${esc(a.client_typed_name)} ${a.client_sign_where === 'app' ? 'in the app' : 'at the clinic'} on ${esc(fDate(a.client_signed_at))}.</p></div></div>
      ${a.precautions ? `<div class="ins warn">${icon('alert-triangle', 20)}<div><b>Precautions</b><p>${esc(a.precautions)}</p></div></div>` : ''}
      <div style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn" href="${pdf(a)}" download>${icon('printer', 18)}Download signed PDF</a><a class="btn ghost" href="#/clients/${c.id}?tab=sessions">${icon('package', 18)}Add a package</a>${a.valid_until <= addDays(today(), 30) ? `<button class="btn gold" data-renew>${icon('refresh-cw', 18)}Start renewal</button>` : ''}</div></section>`;
  }

  el.innerHTML = `${admSteps(a && st !== 'none' && !['not_suitable', 'withdrawn', 'expired'].includes(st) ? a : null)}<div class="stack">${body}${history}${withdrawBtn ? `<div>${withdrawBtn}</div>` : ''}</div>`;

  el.querySelector('[data-renew]')?.addEventListener('click', e => busy(e.currentTarget, () => api(`/staff/clients/${c.id}/admissions`, { method: 'POST', body: { programmes: a.programmes } })).then(() => { toast('Renewal started — the current admission stays valid until it expires'); after(); }).catch(() => {}));
  el.querySelector('[data-start]')?.addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target, programmes = ['ems', 'weight'].filter(k => f[k].checked);
    busy(f.querySelector('button'), () => api(`/staff/clients/${c.id}/admissions`, { method: 'POST', body: { programmes } })).then(() => { toast('Admission started'); after(); }).catch(() => {});
  });
  const scr = el.querySelector('[data-scr]');
  scr && scr.addEventListener('submit', e => {
    e.preventDefault();
    const v = readScreening(scr, Q);
    scr.querySelectorAll('.q').forEach((q, i) => q.classList.toggle('missing', v.answers[Q[i][0]] === null));
    if (Object.values(v.answers).some(x => x === null)) return toast('Answer every question with Yes or No.', true);
    busy(scr.querySelector('button.btn'), () => api(`/staff/admissions/${a.id}/screening`, { method: 'PUT', body: v })).then(() => { toast('Screening saved — next, the clinician assessment'); after(); }).catch(() => {});
  });
  el.querySelector('[data-redo-scr]')?.addEventListener('click', () => modal({
    title: 'Edit health screening', wide: true, body: `<form data-f class="stack" style="gap:14px">${screeningForm(Q, a.screening)}</form>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Save screening</button>`,
    onMount(m, close) { const b = m.querySelector('[data-save]'); b.addEventListener('click', () => { const v = readScreening(m.querySelector('[data-f]'), Q); if (Object.values(v.answers).some(x => x === null)) return toast('Answer every question.', true); busy(b, () => api(`/staff/admissions/${a.id}/screening`, { method: 'PUT', body: v })).then(() => { close(); toast('Screening updated'); after(); }).catch(() => {}); }); },
  }));
  const asm = el.querySelector('[data-asm]');
  if (asm) {
    const pad = sigPad(asm.querySelector('[data-sig]'));
    asm.addEventListener('submit', e => {
      e.preventDefault();
      const b = formData(asm);
      b.signature = pad.value(); b.confirm = asm.confirm.checked;
      if (!b.decision) return toast('Choose the decision.', true);
      if (!b.signature) return toast('Please sign in the signature box.', true);
      busy(asm.querySelector('button.btn.gold'), () => api(`/staff/admissions/${a.id}/assess`, { method: 'POST', body: b })).then(r => { toast(r.status === 'not_suitable' ? 'Recorded as not suitable' : 'Recommendation signed — now the client signs'); after(); }).catch(() => {});
    });
  }
  el.querySelector('[data-sign-now]')?.addEventListener('click', () => modal({
    title: 'Client consent — hand the device to the client', wide: true,
    body: `${letterBox('Recommendation from ' + a.clinician_name, a.clinician_letter)}${letterBox('Your consent', a.client_letter)}
      <form data-f class="stack" style="gap:14px">${field('Type your full name', inp('typed_name', '', `autocomplete="off" placeholder="${esc(c.name)}"`))}
      <div><h4 style="margin-bottom:8px">Your signature</h4><div data-sig></div></div>
      <label class="check"><input type="checkbox" name="agree"> <span>I have read the recommendation and this consent, my questions have been answered, and I agree to join the programme.</span></label></form>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn gold" data-save>${icon('pencil', 18)}Sign consent</button>`,
    onMount(m, close) {
      const pad = sigPad(m.querySelector('[data-sig]')), f = m.querySelector('[data-f]'), b = m.querySelector('[data-save]');
      b.addEventListener('click', () => { const sig = pad.value(); if (!sig) return toast('Please sign in the box.', true);
        busy(b, () => api(`/staff/admissions/${a.id}/client-sign`, { method: 'POST', body: { typed_name: f.typed_name.value, signature: sig, agree: f.agree.checked } })).then(() => { close(); toast('Consent signed — client admitted'); after(); }).catch(() => {}); });
    },
  }));
  el.querySelector('[data-withdraw]')?.addEventListener('click', () => modal({
    title: a.status === 'admitted' ? 'Withdraw consent' : 'Cancel admission',
    body: `<p>${a.status === 'admitted' ? 'The client will be blocked from new packages and bookings, and their upcoming EMS sessions will be cancelled.' : 'This admission will be closed. You can start a new one later.'}</p>${field('Reason', inp('reason', '', 'maxlength="300" placeholder="e.g. Client request, health change"'))}`,
    actions: `<button class="btn ghost" data-close>Keep</button><button class="btn danger" data-save>Confirm</button>`,
    onMount(m, close) { const b = m.querySelector('[data-save]'); b.addEventListener('click', () => busy(b, () => api(`/staff/admissions/${a.id}/withdraw`, { method: 'POST', body: { reason: m.querySelector('[name=reason]').value } })).then(r => { close(); toast('Recorded' + (r.cancelled ? ` — ${r.cancelled} upcoming session${r.cancelled > 1 ? 's' : ''} cancelled` : '')); after(); }).catch(() => {})); },
  }));
}

/* ================= Units & rota ================= */

const DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function hoursText(h) {
  const parts = [];
  [1, 2, 3, 4, 5, 6, 0].forEach(d => { const v = h && h[d]; const txt = v ? `${fTime(v[0])}–${fTime(v[1])}` : 'closed'; const last = parts[parts.length - 1]; if (last && last.txt === txt) last.to = d; else parts.push({ from: d, to: d, txt }); });
  return parts.map(p => `${DAYN[p.from]}${p.to !== p.from ? '–' + DAYN[p.to] : ''} ${p.txt}`).join(', ');
}

function unitModal(d) {
  const u = d ? d.unit : { name: '', code: '', ownership: 'owned', revenue_share: 100, hours: { 0: ['10:00', '14:00'], 1: ['10:00', '20:00'], 2: ['10:00', '20:00'], 3: ['10:00', '20:00'], 4: ['10:00', '20:00'], 5: ['10:00', '20:00'], 6: ['10:00', '20:00'] }, slot_minutes: 30, active: 1 };
  const devices = d ? d.devices.slice() : [{ name: 'EMS device 1', status: 'active', machine_type_id: MACHINES[0] && MACHINES[0].id }];
  const devRow = (x, i) => `<div data-dev="${i}" style="border:1px solid var(--line-soft);border-radius:12px;padding:12px;display:grid;gap:10px">
    <div class="grid3" style="align-items:end">${field('Device name', `<input class="in" data-dn value="${esc(x.name)}">`)}${field('Machine', `<select class="in" data-dm><option value="">Choose machine</option>${MACHINES.filter(m => m.active || m.id === x.machine_type_id).map(m => `<option value="${m.id}"${m.id === x.machine_type_id ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}</select>`)}${field('Status', `<select class="in" data-ds>${[['active', 'Active'], ['maintenance', 'Under maintenance'], ['retired', 'Retired']].map(([v, l]) => `<option value="${v}"${x.status === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`)}</div>
    <div class="grid2">${field('Serial no.', `<input class="in" data-dsn value="${esc(x.serial_no || '')}">`)}${field('Notes', `<input class="in" data-dno value="${esc(x.notes || '')}">`)}</div></div>`;
  modal({
    title: d ? 'Edit unit · ' + u.name : 'New unit', wide: true,
    body: `<form data-f class="stack" style="gap:14px">
      <div class="grid3">${field('Unit name', inp('name', u.name, 'placeholder="e.g. Kochi — Kakkanad"'))}${field('Short code', inp('code', u.code, 'maxlength="8" placeholder="KCH"'))}${field('Status', sel('active', [['1', 'Open'], ['0', 'Closed']], u.active ? '1' : '0'))}</div>
      <div class="grid3">${field('Ownership', sel('ownership', [['owned', 'Company-owned'], ['franchise', 'Franchise']], u.ownership))}${field('Franchisee legal name', inp('franchise_name', u.franchise_name || ''), 'franchise only')}${field('Revenue share for cross-unit sessions', inp('revenue_share', u.revenue_share, 'type="number" min="0" max="100"'), '% paid to this unit')}</div>
      ${field('Address', inp('address', u.address || ''))}
      <div class="grid3">${field('District', inp('district', u.district || ''))}${field('PIN codes served', inp('pincodes', u.pincodes || '', 'placeholder="682030, 682021"'), 'routes website leads')}${field('Phone', inp('phone', u.phone || ''))}</div>
      <div class="grid2">${field('UPI ID for payments', inp('upi', u.upi || ''), 'optional')}${field('Session length', sel('slot_minutes', [['20', '20 minutes'], ['30', '30 minutes'], ['40', '40 minutes'], ['45', '45 minutes'], ['60', '60 minutes']], u.slot_minutes))}</div>
      <div><h4 style="margin-bottom:8px">Opening hours</h4><div class="qs">${[1, 2, 3, 4, 5, 6, 0].map(dn => { const h = u.hours[dn]; return `<div class="q"><label class="check" style="min-width:90px"><input type="checkbox" name="open_${dn}" ${h ? 'checked' : ''}> ${DAYN[dn]}</label><span style="display:flex;gap:8px"><input class="in" type="time" name="from_${dn}" value="${h ? h[0] : '10:00'}" style="width:130px"><input class="in" type="time" name="to_${dn}" value="${h ? h[1] : '20:00'}" style="width:130px"></span></div>`; }).join('')}</div></div>
      <div><h4 style="margin-bottom:8px">EMS devices <span class="muted" style="font-weight:500">(maximum 3)</span></h4><div class="stack" style="gap:10px" data-devs>${devices.map(devRow).join('')}</div>
        <button type="button" class="btn sm ghost" data-add-dev style="margin-top:10px" ${devices.filter(x => x.status !== 'retired').length >= 3 ? 'disabled' : ''}>${icon('plus', 15)}Add device</button></div>
      <p class="small muted">Each trainer supervises one client at a time, so a slot is bookable only when a device and a rostered trainer certified for that machine are both free. Add machine models under Settings → Machines.</p></form>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Save unit</button>`,
    onMount(el, close) {
      el.querySelector('[data-add-dev]').addEventListener('click', e => { devices.push({ name: `EMS device ${devices.length + 1}`, status: 'active', machine_type_id: MACHINES[0] && MACHINES[0].id }); el.querySelector('[data-devs]').insertAdjacentHTML('beforeend', devRow(devices[devices.length - 1], devices.length - 1)); if (devices.filter(x => x.status !== 'retired').length >= 3) e.currentTarget.disabled = true; });
      const save = el.querySelector('[data-save]');
      save.addEventListener('click', () => busy(save, () => {
        const f = el.querySelector('[data-f]'), b = formData(f);
        b.active = b.active === '1';
        b.hours = {}; [0, 1, 2, 3, 4, 5, 6].forEach(dn => { b.hours[dn] = { open: f['open_' + dn].checked, from: f['from_' + dn].value, to: f['to_' + dn].value }; });
        b.devices = [...el.querySelectorAll('[data-dev]')].map(r => ({ id: devices[+r.dataset.dev].id, name: r.querySelector('[data-dn]').value, machine_type_id: r.querySelector('[data-dm]').value, serial_no: r.querySelector('[data-dsn]').value, status: r.querySelector('[data-ds]').value, notes: r.querySelector('[data-dno]').value }));
        return api('/staff/units' + (d ? '/' + u.id : ''), { method: d ? 'PUT' : 'POST', body: b });
      }).then(() => { close(); toast('Unit saved'); team(true); loadUnits().then(reload); }).catch(() => {}));
    },
  });
}

async function viewRota() {
  const unitId = UNIT || (UNITS[0] && UNITS[0].id);
  if (!unitId) { MAIN.innerHTML = emptyState('home', 'You are not assigned to a unit yet.'); return; }
  const d = await api('/staff/units/' + unitId);
  const canEdit = ['admin', 'manager'].includes(ME.role);
  const byStaff = d.staff.map(st => ({ ...st, shifts: d.rota.filter(r => r.staff_id === st.id) }));
  MAIN.innerHTML = `<div class="head"><div><h1>Rota — ${esc(d.unit.name)}</h1><p>${esc(hoursText(d.unit.hours))} · ${d.devices.filter(x => x.status === 'active').length} active device${d.devices.filter(x => x.status === 'active').length === 1 ? '' : 's'}${multi() && !UNIT ? ' · choose a unit at the top to switch' : ''}</p></div>
      ${canEdit ? `<div class="acts"><button class="btn ghost" data-leave>${icon('calendar-x', 18)}Record leave</button><button class="btn gold" data-shift>${icon('plus', 18)}Add shift</button></div>` : ''}</div>
    <section class="panel flush" style="overflow-x:auto"><table class="t"><thead><tr><th>Team member</th>${[1, 2, 3, 4, 5, 6, 0].map(dn => `<th>${DAYN[dn]}${d.unit.hours[dn] ? '' : ' <span class="faint">(closed)</span>'}</th>`).join('')}</tr></thead><tbody>
      ${byStaff.length ? byStaff.map(st => `<tr><td><b>${esc(st.name)}</b><div class="small muted">${esc(st.skills.map(k => SKILLS[k]).join(', '))}</div>${st.skills.includes('trainer') ? (st.certs.length ? `<div class="small" style="color:var(--good)">${icon('shield-check', 12)} ${esc(st.certs.map(c => c.machine_name).join(', '))}</div>` : `<div class="small" style="color:var(--warn)">Not certified — won't be allocated</div>`) : ''}</td>${[1, 2, 3, 4, 5, 6, 0].map(dn => `<td>${st.shifts.filter(r => r.weekday === dn).map(r => `<div class="pill ${r.video ? 'good' : ''}" style="margin:2px 0;height:auto;padding:4px 8px;display:flex;gap:6px">${fTime(r.start_time)}–${fTime(r.end_time)}${r.video ? ' ' + icon('phone', 12) : ''}${canEdit ? `<button class="btn sm quiet icon" data-del-shift="${r.id}" style="width:18px;height:18px" aria-label="Remove shift">${icon('x', 12)}</button>` : ''}</div>`).join('') || '<span class="faint">—</span>'}</td>`).join('')}</tr>`).join('')
        : `<tr><td colspan="8">${emptyState('users', 'No team members at this unit yet. Add them under Settings → Team accounts.')}</td></tr>`}</tbody></table></section>
    <p class="small muted" style="margin-top:8px">${icon('phone', 12)} marks shifts that also take video consultations. Bookings are only offered when a device and a rostered trainer are free; each trainer supervises one client at a time.</p>
    <section class="panel flush" style="margin-top:18px"><div class="panel-h" style="padding:18px 20px 4px"><div class="t">${icon('calendar-x', 20)}<h3>Upcoming leave</h3></div></div>
      <div class="rows">${d.leave.length ? d.leave.map(l => `<div class="row"><div class="grow"><b>${esc(l.name)}</b><span>${esc(fLong(l.day))}${l.note ? ' — ' + esc(l.note) : ''}</span></div>${canEdit ? `<button class="btn sm quiet" data-del-leave="${l.id}">Remove</button>` : ''}</div>`).join('') : emptyState('calendar-check', 'No leave recorded.')}</div></section>`;
  MAIN.querySelectorAll('[data-del-shift]').forEach(b => b.addEventListener('click', () => busy(b, () => api('/staff/rota/' + b.dataset.delShift, { method: 'DELETE', body: {} })).then(() => { toast('Shift removed'); reload(); }).catch(() => {})));
  MAIN.querySelectorAll('[data-del-leave]').forEach(b => b.addEventListener('click', () => busy(b, () => api('/staff/leave/' + b.dataset.delLeave, { method: 'DELETE', body: {} })).then(() => { toast('Leave removed'); reload(); }).catch(() => {})));
  MAIN.querySelector('[data-shift]')?.addEventListener('click', () => modal({
    title: 'Add shift · ' + d.unit.name,
    body: `<form data-f class="stack" style="gap:14px">${field('Team member', sel('staff_id', d.staff.map(st => [st.id, st.name])))}
      <div><h4 style="margin-bottom:8px">Days</h4><div class="chips">${[1, 2, 3, 4, 5, 6, 0].map(dn => `<label class="chip"><input type="checkbox" name="wd_${dn}" ${d.unit.hours[dn] && dn !== 0 ? 'checked' : ''}>${DAYN[dn]}</label>`).join('')}</div></div>
      <div class="grid2">${field('Start', '<input class="in" type="time" name="start_time" value="10:00">')}${field('End', '<input class="in" type="time" name="end_time" value="18:00">')}</div>
      <label class="check"><input type="checkbox" name="video"> Also available for video consultations in this shift</label></form>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Add shift</button>`,
    onMount(el, close) { const b = el.querySelector('[data-save]'); b.addEventListener('click', () => busy(b, () => { const f = formData(el.querySelector('[data-f]')); return api('/staff/rota', { method: 'POST', body: { staff_id: f.staff_id, unit_id: unitId, start_time: f.start_time, end_time: f.end_time, video: f.video, weekdays: [0, 1, 2, 3, 4, 5, 6].filter(dn => f['wd_' + dn]) } }); }).then(() => { close(); toast('Shift added'); reload(); }).catch(() => {})); },
  }));
  MAIN.querySelector('[data-leave]')?.addEventListener('click', () => modal({
    title: 'Record leave',
    body: `<form data-f class="stack" style="gap:14px">${field('Team member', sel('staff_id', d.staff.map(st => [st.id, st.name])))}<div class="grid2">${field('Day', inp('day', today(), `type="date" min="${today()}"`))}${field('Note', inp('note', '', 'maxlength="120"'))}</div></form>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Save leave</button>`,
    onMount(el, close) { const b = el.querySelector('[data-save]'); b.addEventListener('click', () => busy(b, () => api('/staff/leave', { method: 'POST', body: formData(el.querySelector('[data-f]')) })).then(r => { close(); if (r.affected && r.affected.length) modal({ title: 'Bookings to reassign', body: `<p>This person has ${r.affected.length} booking${r.affected.length > 1 ? 's' : ''} that day. Open each one in the Schedule and reschedule it so a free trainer is assigned:</p><ul class="dots">${r.affected.map(a => `<li>${esc(fTime(a.start_at))} — ${esc(a.name)}</li>`).join('')}</ul>`, actions: '<a class="btn" href="#/schedule" data-close>Open schedule</a>' }); else toast('Leave recorded'); reload(); }).catch(() => {})); },
  }));
}

/* ================= Machines & trainer certification ================= */

function machineModal(m) {
  m = m || { name: '', brand: '', category: CATEGORIES[0], features: [], notes: '', active: 1 };
  modal({
    title: m.id ? 'Edit machine' : 'New machine', wide: true,
    body: `<form data-f class="stack" style="gap:14px"><div class="grid3">${field('Machine name / model', inp('name', m.name, 'placeholder="e.g. Miha Bodytec II"'))}${field('Brand', inp('brand', m.brand || ''))}${field('Type', sel('category', CATEGORIES, m.category))}</div>
      ${field('Features', `<textarea class="in" name="features" placeholder="One per line, e.g.&#10;Wireless suit&#10;20 muscle groups&#10;Pre-set programmes: strength, cardio, lymph drainage">${esc((m.features || []).join('\n'))}</textarea>`, 'one per line')}
      ${field('Notes', inp('notes', m.notes || '', 'maxlength="400" placeholder="Supplier, service contract, safety notes"'))}
      <label class="check"><input type="checkbox" name="active" ${m.active ? 'checked' : ''}> Available for new devices and packages</label></form>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Save machine</button>`,
    onMount(el, close) { const b = el.querySelector('[data-save]'); b.addEventListener('click', () => busy(b, () => api('/staff/machines' + (m.id ? '/' + m.id : ''), { method: m.id ? 'PUT' : 'POST', body: formData(el.querySelector('[data-f]')) })).then(() => { close(); toast('Machine saved'); loadUnits().then(reload); }).catch(() => {})); },
  });
}

async function renderCerts(el, tm) {
  const { certifications } = await api('/staff/certifications');
  const me = tm.find(t => t.id === ME.id);
  const canCertify = false; // Certificates are issued through the Hasta EMS Academy.
  const trainers = tm.filter(t => (t.skills || []).includes('trainer'));
  const active = MACHINES.filter(x => x.active);
  const cert = (sid, mid) => certifications.find(c => c.staff_id === sid && c.machine_type_id === mid && (c.status === 'active' || c.status === 'pending'));
  const soon = addDays(today(), 30);
  el.innerHTML = `<div class="panel-h" style="padding:18px 20px 4px"><div class="t">${icon('shield-check', 20)}<div><h3>Trainer certification</h3><p class="small muted">A trainer is only allocated to a machine they hold a valid Hasta EMS Academy certificate for.</p></div></div>
      <a class="btn sm gold" href="#/academy?tab=trainees">${icon('graduation-cap', 16)}Open the Academy</a></div>
    ${trainers.length && active.length ? `<div style="overflow-x:auto"><table class="t"><thead><tr><th>Trainer</th>${active.map(x => `<th>${esc(x.name)}</th>`).join('')}</tr></thead><tbody>
      ${trainers.map(t => `<tr><td><b>${esc(t.name)}</b></td>${active.map(x => { const c = cert(t.id, x.id); if (!c) return '<td><span class="pill alert">Not certified</span></td>'; const exp = c.valid_until < today();
        return `<td>${c.status === 'pending' ? pill('warn', 'Awaiting countersignature') : exp ? pill('alert', 'Expired ' + fDay(c.valid_until)) : c.valid_until <= soon ? pill('warn', 'Renew by ' + fDay(c.valid_until)) : pill('good', 'Until ' + fDate(c.valid_until))}<div class="small muted" style="margin-top:4px">by ${esc(c.certifier_name)}, ${esc(c.certifier_role)}</div>${canCertify || ME.role === 'admin' ? `<button class="btn sm quiet" data-revoke="${c.id}" style="height:24px;padding:0 6px;margin-top:2px">Revoke</button>` : ''}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`
      : emptyState('shield-check', trainers.length ? 'Add a machine first.' : 'No team members have the EMS trainer skill yet.')}
`;
  el.querySelector('[data-certify]')?.addEventListener('click', () => modal({
    title: 'Certify a trainer',
    body: `<form data-f class="stack" style="gap:14px"><div class="grid2">${field('Trainer', sel('staff_id', trainers.filter(t => t.id !== ME.id).map(t => [t.id, t.name])))}${field('Machine', sel('machine_type_id', active.map(x => [x.id, x.name])))}</div>
      ${field('Valid for', sel('months', [['6', '6 months'], ['12', '12 months'], ['24', '24 months']], '12'))}
      ${field('What you assessed', `<textarea class="in" name="notes" maxlength="500" placeholder="e.g. Suit fitting and pad placement, intensity control per muscle group, contraindication checks before each session, hydration advice, emergency stop and first aid"></textarea>`)}
      <label class="check"><input type="checkbox" name="confirm"> <span>I have personally assessed this trainer on this machine and confirm they can run sessions safely. Certified by ${esc(ME.name)} for Hasta Wellness.</span></label></form>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn gold" data-save>${icon('shield-check', 18)}Issue certificate</button>`,
    onMount(m, close) { const b = m.querySelector('[data-save]'); b.addEventListener('click', () => busy(b, () => api('/staff/certifications', { method: 'POST', body: formData(m.querySelector('[data-f]')) })).then(() => { close(); toast('Certificate issued'); renderCerts(el, tm); }).catch(() => {})); },
  }));
  el.querySelectorAll('[data-revoke]').forEach(b => b.addEventListener('click', () => { const reason = prompt('Reason for revoking this certificate?'); if (reason === null) return; busy(b, () => api(`/staff/certifications/${b.dataset.revoke}/revoke`, { method: 'POST', body: { reason } })).then(() => { toast('Certificate revoked'); renderCerts(el, tm); }).catch(() => {}); }));
}
