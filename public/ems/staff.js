import {
  api, esc, icon, toast, modal, formData, busy, field, inp, sel, emptyState, slotPicker, lineChart, barChart, insightList, deltaTag,
  measureSeries, dietView, DIETS, SCREENING, today, nowLocal, addDays, dayDiff, fDay, fDate, fWeekday, fLong, fTime, fWhen, inr, kg, initials, first,
  ageFrom, prettyPhone, wa, pill, KIND_LABEL, APP_URL, BASE,
} from './core.js';

let ME, APP, MAIN, BADGES = {}, TEAM = null;
async function team(fresh = false) { if (!TEAM || fresh) TEAM = (await api('/staff/team')).team; return TEAM; }
const coachOptions = (list, value) => [['', 'Not allocated']].concat(list.map(t => [t.id, t.name + (t.role === 'admin' ? ' (admin)' : '')]));
const NAV = [
  ['', 'layout-dashboard', 'Dashboard'], ['schedule', 'calendar-days', 'Schedule'], ['clients', 'users', 'Clients'],
  ['leads', 'inbox', 'Website leads', 'new_leads'], ['reminders', 'bell', 'Follow-ups', 'reminders'], ['payments', 'wallet', 'Payments'],
];

export function mount(app, me) {
  ME = me; APP = app;
  app.innerHTML = `<div class="shell"><aside class="side">
    <div class="brand"><img src="/img/hasta-emblem.webp" alt="" width="34" height="34"><div><b>Hasta EMS</b><span>Progress Studio</span></div></div>
    <nav class="nav" aria-label="Main">${NAV.map(([k, ic, l, b]) => `<a href="#/${k}" data-k="${k}">${icon(ic, 20)}<span>${l}</span>${b ? `<i class="badge" data-b="${b}" hidden></i>` : ''}</a>`).join('')}
      <div class="nav-sep"></div><a href="#/settings" data-k="settings">${icon('settings', 20)}<span>Settings</span></a></nav>
    <div class="me"><span class="avatar">${esc(initials(me.name))}</span><div><b>${esc(me.name)}</b><span>${me.role === 'admin' ? 'Admin' : 'Team'}</span></div>
      <button data-logout aria-label="Sign out" title="Sign out">${icon('log-out', 18)}</button></div>
  </aside><main class="main" id="main"></main></div>`;
  MAIN = app.querySelector('#main');
  app.querySelector('[data-logout]').addEventListener('click', async () => { await api('/auth/logout', { method: 'POST', body: {} }); location.hash = ''; location.reload(); });
  window.addEventListener('hashchange', route);
  route();
  refreshBadges();
}

async function refreshBadges(counts) {
  try { if (!counts) counts = (await api('/staff/dashboard')).counts; } catch { return; }
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
    else if (top === 'clients' && parts[1]) await viewClient(+parts[1], q.get('tab') || 'overview');
    else if (top === 'clients') await viewClients(q);
    else if (top === 'leads') await viewLeads(q);
    else if (top === 'reminders') await viewReminders();
    else if (top === 'payments') await viewPayments(q);
    else if (top === 'settings') await viewSettings();
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
  const sub = [own ? null : KIND_LABEL[a.kind], a.package_name, !own && a.coach_name ? 'Coach ' + first(a.coach_name) : null, a.notes].filter(Boolean).map(esc).join(' — ');
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
    body: `<p class="muted">Currently ${esc(fWhen(a.start_at))}</p><div data-slots></div><label class="check" hidden data-over><input type="checkbox" name="force"> Overbook this slot</label>`,
    actions: `<button class="btn ghost" data-close>Keep current time</button><button class="btn" data-save disabled>Move booking</button>`,
    onMount(el, close) {
      const save = el.querySelector('[data-save]');
      slotPicker(el.querySelector('[data-slots]'), { staff: true, days: 30, onPick: (v, f) => { pick = v; full = f; save.disabled = !v; el.querySelector('[data-over]').hidden = !f; } });
      save.addEventListener('click', () => busy(save, () => api('/staff/appointments/' + a.id, { method: 'PUT', body: { start_at: pick, force: el.querySelector('[name=force]').checked } }))
        .then(() => { close(); toast('Booking moved to ' + fWhen(pick)); after(); }).catch(() => {}));
    },
  });
}

async function findClient(q) { return (await api('/staff/clients?status=all&q=' + encodeURIComponent(q))).clients; }

function bookModal({ client = null, kind = 'session', lead = null, after = reload } = {}) {
  let chosen = client, pick = null;
  const m = modal({
    title: lead ? `Book consultation · ${lead.name}` : 'New booking', wide: true,
    body: `${lead ? '' : `<div class="seg" data-kind>${['session', 'consultation', 'review'].map(k => `<button type="button" data-k="${k}" class="${k === kind ? 'on' : ''}">${KIND_LABEL[k]}</button>`).join('')}</div>`}
      ${lead ? `<p class="muted">${esc(prettyPhone(lead.phone))}${lead.concern ? ' — ' + esc(lead.concern) : ''}</p>` : `<div data-who></div>`}
      <div><h4 style="margin-bottom:10px">Date and time</h4><div data-slots></div></div>
      <label class="check" hidden data-over><input type="checkbox" name="force"> Overbook — this slot is already full</label>
      ${field('Note', inp('notes', '', 'maxlength="300" placeholder="Optional"'))}
      <div data-warn></div>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save disabled>${icon('calendar-plus', 18)}Book</button>`,
    onMount(el, close) {
      const save = el.querySelector('[data-save]');
      const ready = () => { save.disabled = !pick || (!lead && kind === 'session' && !chosen) || (!lead && !chosen && !guestOk()); };
      const guestOk = () => { const n = el.querySelector('[name=guest_name]'), p = el.querySelector('[name=guest_phone]'); return n && p && n.value.trim().length > 1 && p.value.replace(/\D/g, '').length >= 10; };
      const who = el.querySelector('[data-who]');
      const drawWho = () => {
        if (!who) return;
        if (chosen) { who.innerHTML = `<div class="row" style="border:1px solid var(--line);border-radius:12px"><span class="avatar">${esc(initials(chosen.name))}</span><div class="grow"><b>${esc(chosen.name)}</b><span>${esc(prettyPhone(chosen.phone))}</span></div>${client ? '' : `<button type="button" class="btn sm quiet" data-change>Change</button>`}</div>`; ready(); return; }
        who.innerHTML = `${field('Client', `<div class="search" style="max-width:none">${icon('search', 18)}<input class="in" data-q placeholder="Search by name or mobile" autocomplete="off"></div>`)}<div class="rows" data-res style="margin-top:6px"></div>
          ${kind !== 'session' ? `<details style="margin-top:6px"><summary class="small" style="cursor:pointer;color:var(--teal)">Someone new? Enter their details</summary><div class="grid2" style="margin-top:10px">${field('Name', inp('guest_name'))}${field('Mobile', inp('guest_phone', '', 'type="tel"'))}</div></details>` : ''}`;
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
      el.querySelector('[data-kind]')?.addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (!b) return; kind = b.dataset.k; el.querySelectorAll('[data-kind] button').forEach(x => x.classList.toggle('on', x === b)); if (!client) drawWho(); ready(); });
      slotPicker(el.querySelector('[data-slots]'), { staff: true, days: 30, startDate: lead && lead.preferred_date >= today() && lead.preferred_date <= addDays(today(), 29) ? lead.preferred_date : undefined, onPick: (v, full) => { pick = v; el.querySelector('[data-over]').hidden = !full; ready(); } });
      save.addEventListener('click', () => busy(save, async () => {
        const notes = el.querySelector('[name=notes]').value, force = el.querySelector('[name=force]').checked;
        let r;
        if (lead) r = await api(`/staff/leads/${lead.id}/convert`, { method: 'POST', body: { start_at: pick, notes, force } });
        else r = await api('/staff/appointments', { method: 'POST', body: { kind, start_at: pick, notes, force, client_id: chosen && chosen.id, guest_name: el.querySelector('[name=guest_name]')?.value, guest_phone: el.querySelector('[name=guest_phone]')?.value } });
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
    case 'lead': return `Hi ${n}, thank you for your enquiry about EMS and weight management at Hasta Wellness, Kazhakkoottam. When would be a good time for a consultation with our team?`;
    case 'pin': return `Hi ${n}, welcome to Hasta EMS! Track your sessions, progress and plan at ${APP_URL}\nSign in with this mobile number and your PIN: ${r.pin}\nYou can change the PIN after signing in.`;
    default: return `Hi ${n}, this is Hasta Wellness.`;
  }
}

/* ================= Dashboard ================= */

async function viewDashboard() {
  const d = await api('/staff/dashboard');
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
  const { appointments } = await api(`/staff/appointments?from=${mon}&to=${sun}`);
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
  const [{ clients }, tm] = await Promise.all([api(`/staff/clients?status=${status}&q=${encodeURIComponent(search)}&coach=${coach}`), team()]);
  MAIN.innerHTML = `
    <div class="head"><div><h1>Clients</h1><p>${clients.length} ${status === 'all' ? '' : status} client${clients.length === 1 ? '' : 's'}</p></div>
      <div class="acts"><button class="btn gold" data-add>${icon('user-plus', 18)}Add client</button></div></div>
    <div class="toolbar"><form class="search" data-search>${icon('search', 18)}<input class="in" name="q" value="${esc(search)}" placeholder="Search name or mobile"></form>
      <div class="seg">${['active', 'paused', 'completed', 'all'].map(s => `<button data-s="${s}" class="${s === status ? 'on' : ''}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div>
      <select class="in" data-coach style="width:auto;min-width:190px" aria-label="Coach">${[['', 'All coaches']].concat(tm.some(t => t.id === ME.id) ? [[String(ME.id), 'My clients']] : [], [['none', 'Not allocated']], tm.map(t => [String(t.id), t.name])).map(([v, l]) => `<option value="${v}"${v === coach ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
    <section class="panel flush">${clients.length ? `<table class="t"><thead><tr><th>Client</th><th>Coach</th><th>Sessions</th><th>Weight</th><th>Last visit</th><th>Next visit</th><th>Suitability</th></tr></thead><tbody>
      ${clients.map(c => { const diff = c.first_weight != null && c.last_weight != null ? Math.round((c.last_weight - c.first_weight) * 10) / 10 : null;
        return `<tr class="click" data-id="${c.id}"><td><div style="display:flex;gap:12px;align-items:center"><span class="avatar">${esc(initials(c.name))}</span><div><b>${esc(c.name)}</b><div class="small muted">${esc(prettyPhone(c.phone))}</div></div></div></td>
        <td>${c.coach_name ? esc(c.coach_name) : '<span style="color:var(--warn)">Not allocated</span>'}</td>
        <td class="num">${c.attended}${c.sessions_total ? ` <span class="muted">/ ${c.sessions_total}</span>` : ''}</td>
        <td>${c.last_weight != null ? `<span class="num">${kg(c.last_weight)} kg</span> ${deltaTag(diff, ' kg')}` : '<span class="faint">—</span>'}</td>
        <td>${c.last_visit ? esc(fDay(c.last_visit)) : '<span class="faint">—</span>'}</td>
        <td>${c.next_visit ? esc(fWhen(c.next_visit)) : '<span class="faint">Not booked</span>'}</td>
        <td>${c.cleared ? pill('cleared', 'Cleared') : pill('not-cleared', 'Check needed')}</td></tr>`; }).join('')}</tbody></table>`
      : emptyState('users', search ? 'No clients match your search.' : 'No clients yet. Add your first client to start tracking.', '<button class="btn sm gold" data-add>Add client</button>')}</section>`;
  const setQ = (k, v) => { const p = new URLSearchParams(q); p.set(k, v); location.hash = '#/clients?' + p; };
  MAIN.querySelector('[data-search]').addEventListener('submit', e => { e.preventDefault(); setQ('q', e.target.q.value.trim()); });
  MAIN.querySelectorAll('[data-s]').forEach(b => b.addEventListener('click', () => setQ('status', b.dataset.s)));
  MAIN.querySelector('[data-coach]').addEventListener('change', e => setQ('coach', e.target.value));
  MAIN.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => clientModal()));
  MAIN.querySelectorAll('tr[data-id]').forEach(r => r.addEventListener('click', () => go('#/clients/' + r.dataset.id)));
}

function clientForm(c = {}, isNew = true, tm = []) {
  return `${field('Coach', sel('coach_id', coachOptions(tm), c.coach_id ?? (isNew && tm.some(t => t.id === ME.id) ? ME.id : '')), 'team member responsible for this client')}
    <div class="grid2">${field('Full name', inp('name', c.name, 'required autocomplete="off"'))}${field('Mobile number', inp('phone', c.phone, 'type="tel" required'), 'used to sign in')}</div>
    <div class="grid3">${field('Gender', sel('gender', [['', 'Select'], ['female', 'Female'], ['male', 'Male'], ['other', 'Other']], c.gender))}${field('Year of birth', inp('birth_year', c.birth_year, 'type="number" inputmode="numeric" placeholder="1990"'))}${field('Height (cm)', inp('height_cm', c.height_cm, 'type="number" step="0.5" inputmode="decimal"'))}</div>
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
      save.addEventListener('click', () => busy(save, async () => {
        const body = { ...formData(f), lead_id: prefill.lead_id };
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

const TABS = [['overview', 'layout-dashboard', 'Overview'], ['sessions', 'calendar-days', 'Sessions & packages'], ['progress', 'line-chart', 'Progress'], ['payments', 'wallet', 'Payments'], ['plan', 'salad', 'Lifestyle plan'], ['profile', 'user', 'Profile & suitability']];

async function viewClient(id, tab) {
  const [d, tm] = await Promise.all([api('/staff/clients/' + id), team()]);
  d.team = tm;
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
        ${c.height_cm ? `<span>${icon('ruler', 15)}${c.height_cm} cm</span>` : ''}
        <span>${icon('package', 15)}${left} session${left === 1 ? '' : 's'} available</span>
        <button type="button" class="btn sm ghost" data-coach style="height:28px">${icon('users', 15)}${c.coach_name ? 'Coach: ' + esc(c.coach_name) : '<span style="color:var(--warn)">Allocate a coach</span>'}</button></div></div>
      <div class="acts" style="display:flex;gap:8px;flex-wrap:wrap">${pill(c.status)}${c.cleared ? pill('cleared', 'Cleared for EMS') : pill('not-cleared', 'Suitability check needed')}</div>
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
  MAIN.querySelector('[data-measure]').addEventListener('click', () => measureModal(c, after));
  MAIN.querySelector('[data-pay]').addEventListener('click', () => payModal(c, d.packages, after));
  const body = MAIN.querySelector('[data-body]');
  ({ overview: tabOverview, sessions: tabSessions, progress: tabProgress, payments: tabPayments, plan: tabPlan, profile: tabProfile }[tab] || tabOverview)(body, d, after);
}

function metricStrip(d) {
  const ch = d.insights.metrics.change, last = k => { for (let i = d.measurements.length - 1; i >= 0; i--) if (d.measurements[i][k] != null) return d.measurements[i][k]; return null; };
  const m = (l, k, u) => `<div class="metric"><div class="l">${l}</div><div class="v">${last(k) != null ? kg(last(k)) : '—'}<small>${last(k) != null ? u : ''}</small></div>${ch[k] ? deltaTag(ch[k].diff, u === '%' ? '%' : ' ' + u, k !== 'muscle_mass') + `<span class="small faint"> since ${fDay(ch[k].since)}</span>` : '<span class="small faint">No data</span>'}</div>`;
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
      <span class="small muted">${p.used} used, ${p.booked} booked, ${p.remaining} left of ${p.sessions_total} · ${fDay(p.start_date)} to ${p.expiry_date ? fDate(p.expiry_date) : 'no expiry'}${staff ? ` · ${inr(p.due)}${p.balance > 0 ? `, <b style="color:var(--warn)">${inr(p.balance)} due</b>` : ', paid'}` : ''}</span></div>
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
  const { packages } = await api('/staff/packages');
  const defs = packages.filter(p => p.active);
  modal({
    title: 'Add package · ' + c.name,
    body: `<form class="stack" style="gap:14px" data-f>
      ${field('Package', sel('package_id', defs.map(p => [p.id, `${p.name} — ${p.sessions} sessions${p.price ? ', ' + inr(p.price) : ''}`]).concat([['', 'Custom package']]), defs[0] && defs[0].id))}
      <div class="grid3">${field('Sessions', inp('sessions_total', defs[0] && defs[0].sessions, 'type="number" min="1"'))}${field('Price (₹)', inp('price', defs[0] && defs[0].price, 'type="number" min="0" inputmode="numeric"'))}${field('Discount (₹)', inp('discount', 0, 'type="number" min="0" inputmode="numeric"'))}</div>
      <div class="grid2">${field('Start date', inp('start_date', today(), 'type="date"'))}${field('Name', inp('name', defs[0] && defs[0].name, 'maxlength="80"'), 'shown to client')}</div>
      <p class="small muted" data-exp></p></form>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Add package</button>`,
    onMount(el, close) {
      const f = el.querySelector('[data-f]');
      const sync = () => { const p = defs.find(x => x.id === +f.package_id.value); if (p) { f.sessions_total.value = p.sessions; f.price.value = p.price ?? ''; f.name.value = p.name; } el.querySelector('[data-exp]').textContent = p ? `Valid for ${p.validity_days} days from the start date.` : 'Custom packages are valid for 90 days.'; };
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
      <form class="stack" style="gap:14px" data-f><div class="grid2">${field('Total sessions', inp('sessions_total', p.sessions_total, 'type="number" min="1"'), 'add bonus sessions here')}${field('Expiry date', inp('expiry_date', p.expiry_date, 'type="date"'))}</div>
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
      <div class="grid3">${field('Waist (cm)', inp('waist', '', 'type="number" step="0.5" inputmode="decimal"'))}${field('Hips (cm)', inp('hips', '', 'type="number" step="0.5" inputmode="decimal"'))}${field('Muscle mass (kg)', inp('muscle_mass', '', 'type="number" step="0.1" inputmode="decimal"'), 'optional')}</div>
      ${field('Note', inp('notes', '', 'maxlength="300" placeholder="e.g. measured before session, same scale"'))}</form>
      <p class="small muted">Measure at the same time of day, on the same scale, for comparable results.</p>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Save measurements</button>`,
    onMount(el, close) {
      const save = el.querySelector('[data-save]');
      save.addEventListener('click', () => busy(save, () => api('/staff/measurements', { method: 'POST', body: { ...formData(el.querySelector('[data-f]')), client_id: c.id } })).then(() => { close(); toast('Measurements saved'); after(); }).catch(() => {}));
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
      ${ms.map(m => `<tr><td>${esc(fDate(m.measured_on))}${m.notes ? `<div class="small muted">${esc(m.notes)}</div>` : ''}</td><td class="n">${m.weight != null ? kg(m.weight) + ' kg' : '—'}</td><td class="n">${m.waist ?? '—'}</td><td class="n">${m.hips ?? '—'}</td><td class="n">${m.body_fat != null ? m.body_fat + '%' : '—'}</td><td class="n">${m.muscle_mass ?? '—'}</td>
        <td class="n"><button class="btn sm quiet icon" data-del="${m.id}" aria-label="Delete">${icon('trash-2', 16)}</button></td></tr>`).join('')}</tbody></table>` : emptyState('ruler', 'No measurements yet. Record a baseline before the first session.')}</section></div>`;
  lineChart(el.querySelector('[data-w]'), { series: [{ name: 'Weight', color: '#34595e', points: measureSeries(d.measurements, 'weight') }], unit: ' kg', target: d.client.target_weight, height: 200 });
  lineChart(el.querySelector('[data-wh]'), { series: [{ name: 'Waist', color: '#34595e', points: measureSeries(d.measurements, 'waist') }, { name: 'Hips', color: '#c4a45b', points: measureSeries(d.measurements, 'hips') }], unit: ' cm', height: 200 });
  lineChart(el.querySelector('[data-bf]'), { series: [{ name: 'Body fat', color: '#a8642c', points: measureSeries(d.measurements, 'body_fat') }], unit: '%', height: 200 });
  lineChart(el.querySelector('[data-mm]'), { series: [{ name: 'Muscle', color: '#2f7d58', points: measureSeries(d.measurements, 'muscle_mass') }], unit: ' kg', height: 200 });
  el.querySelector('[data-add]').addEventListener('click', () => measureModal(d.client, after));
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
    <div class="stack"><section class="panel"><form class="stack" style="gap:12px" data-s>
      <div class="panel-h" style="margin:0"><div class="t">${icon('shield-check', 20)}<h3>Suitability check</h3></div></div>
      <p class="small muted">Tick anything the client reports. Any tick needs clinician review before EMS.</p>
      ${SCREENING.map(([k, l]) => `<label class="check"><input type="checkbox" name="screening.${k}" ${c.screening && c.screening[k] ? 'checked' : ''}> ${esc(l)}</label>`).join('')}
      <div style="border-top:1px solid var(--line-soft);padding-top:12px"><label class="check"><input type="checkbox" name="cleared" ${c.cleared ? 'checked' : ''}> <b>Cleared for EMS by a clinician</b></label></div>
      <div><button class="btn" data-save-s>Save suitability</button></div></form></section>
    <section class="panel stack" style="gap:12px"><div class="t" style="display:flex;gap:10px;align-items:center">${icon('key-round', 20)}<h3>Client app access</h3></div>
      <p class="small muted">The client signs in at ${esc(APP_URL)} with their mobile number and a 6-digit PIN.</p>
      <div><button class="btn ghost" data-pin>${icon('refresh-cw', 18)}Create new PIN</button></div>
      ${ME.role === 'admin' ? `<div style="border-top:1px solid var(--line-soft);padding-top:12px"><button class="btn danger" data-del>${icon('trash-2', 18)}Delete client and all records</button><p class="small muted" style="margin-top:6px">Use when a client asks for their data to be erased.</p></div>` : ''}</section></div></div>`;
  const f = el.querySelector('[data-f]'), s = el.querySelector('[data-s]');
  [f, s].forEach(x => x.addEventListener('submit', e => e.preventDefault()));
  const saveF = el.querySelector('[data-save]');
  saveF.addEventListener('click', () => busy(saveF, () => api('/staff/clients/' + c.id, { method: 'PUT', body: formData(f) })).then(() => { toast('Details saved'); after(); }).catch(() => {}));
  const saveS = el.querySelector('[data-save-s]');
  saveS.addEventListener('click', () => { const b = formData(s); if (b.cleared && Object.values(b.screening || {}).some(Boolean) && !confirm('Some items are ticked. Confirm a clinician has reviewed them and cleared this client?')) return;
    busy(saveS, () => api('/staff/clients/' + c.id, { method: 'PUT', body: { screening: b.screening || {}, cleared: b.cleared } })).then(() => { toast('Suitability saved'); after(); }).catch(() => {}); });
  const pinB = el.querySelector('[data-pin]');
  pinB.addEventListener('click', () => { if (confirm('Create a new PIN? The current one will stop working.')) busy(pinB, () => api(`/staff/clients/${c.id}/pin`, { method: 'POST', body: {} })).then(r => showPin({ ...c, pin: r.pin, isNew: false })).catch(() => {}); });
  el.querySelector('[data-del]')?.addEventListener('click', e => { if (prompt(`Type DELETE to erase ${c.name} and every record for them. This cannot be undone.`) === 'DELETE') busy(e.currentTarget, () => api('/staff/clients/' + c.id, { method: 'DELETE', body: {} })).then(() => { toast('Client deleted'); go('#/clients'); }).catch(() => {}); });
}

/* ================= Leads ================= */

async function viewLeads(q) {
  const scope = q.get('scope') || 'ems', status = q.get('status') || 'open';
  const { leads } = await api(`/staff/leads?scope=${scope}&status=${encodeURIComponent(status)}`);
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
        <select class="in" style="height:32px;width:auto;font-size:13px" data-st="${l.id}" aria-label="Status">${['new', 'contacted', 'booked', 'not interested'].map(s => `<option value="${s}"${s === l.status ? ' selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select>
      </div></div>`).join('') : emptyState('inbox', 'No leads in this view.')}</div></section>
    <p class="small muted" style="margin-top:10px">Website leads are kept for 90 days. Once someone becomes a client, their record here stays with them.</p>`;
  const setQ = (k, v) => { const p = new URLSearchParams(q); p.set(k, v); location.hash = '#/leads?' + p; };
  MAIN.querySelectorAll('[data-scope]').forEach(b => b.addEventListener('click', () => setQ('scope', b.dataset.scope)));
  MAIN.querySelectorAll('[data-status]').forEach(b => b.addEventListener('click', () => setQ('status', b.dataset.status)));
  const L = id => leads.find(l => l.id === +id);
  MAIN.querySelectorAll('[data-consult]').forEach(b => b.addEventListener('click', () => bookModal({ lead: L(b.dataset.consult), kind: 'consultation', after: () => { refreshBadges(); reload(); } })));
  MAIN.querySelectorAll('[data-client]').forEach(b => b.addEventListener('click', () => { const l = L(b.dataset.client); clientModal({ name: l.name, phone: l.phone, goal: l.concern, lead_id: l.id }, () => { refreshBadges(); }); }));
  MAIN.querySelectorAll('[data-st]').forEach(s => s.addEventListener('change', () => api('/staff/leads/' + s.dataset.st, { method: 'PUT', body: { status: s.value } }).then(() => { toast('Lead updated'); refreshBadges(); }).catch(e => toast(e.message, true))));
  MAIN.querySelectorAll('[data-wa-lead]').forEach(a => a.addEventListener('click', () => { const l = L(a.dataset.waLead); if (l.status === 'new') api('/staff/reminders/log', { method: 'POST', body: { kind: 'lead', ref: String(l.id), lead_id: l.id } }).then(() => refreshBadges()).catch(() => {}); }));
}

/* ================= Follow-ups ================= */

const REM_GROUPS = [
  ['tomorrow', 'calendar-check', 'Appointments tomorrow', 'Send a reminder the evening before to cut no-shows.'],
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
  const { reminders } = await api('/staff/reminders');
  MAIN.innerHTML = `<div class="head"><div><h1>Follow-ups</h1><p>Everything that needs a message today. Sending on WhatsApp marks it done for three days.</p></div></div>
    ${reminders.length ? `<div class="stack">${REM_GROUPS.map(([k, ic, t, sub]) => { const items = reminders.filter(r => r.kind === k); if (!items.length) return '';
      return `<section class="panel flush"><div class="panel-h" style="padding:18px 20px 0"><div class="t">${icon(ic, 20)}<div><h3>${t} <span class="muted" style="font-weight:600">${items.length}</span></h3><p class="small muted">${sub}</p></div></div></div>
        <div class="rows" style="margin-top:8px">${items.map(remRow).join('')}</div></section>`; }).join('')}</div>`
      : `<section class="panel">${emptyState('check-circle', 'All caught up — no follow-ups waiting.')}</section>`}`;
  bindRemActions(MAIN, reminders);
}

/* ================= Payments ================= */

async function viewPayments(q) {
  const from = q.get('from') || today().slice(0, 8) + '01', to = q.get('to') || today();
  const r = await api(`/staff/payments?from=${from}&to=${to}`);
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
      ${r.payments.map(p => `<tr class="click" data-c="${p.client_id}"><td>${esc(fDate(p.paid_on))}</td><td><b>${esc(p.client_name || '')}</b></td><td>${esc(p.package_name || '')}</td><td>${esc(p.method)}${p.reference ? `<div class="small muted">${esc(p.reference)}</div>` : ''}</td><td class="n"><b>${inr(p.amount)}</b></td></tr>`).join('')}</tbody></table>`
      : emptyState('receipt', 'No payments in this period.')}</section>`;
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
  const [{ packages }, users, tm] = await Promise.all([api('/staff/packages'), admin ? api('/staff/users').then(r => r.users) : Promise.resolve([]), team(true)]);
  const clientsOf = id => (tm.find(t => t.id === id) || {}).clients || 0;
  MAIN.innerHTML = `<div class="head"><div><h1>Settings</h1><p>Packages, team access and your account.</p></div></div>
    <div class="stack">
      <section class="panel flush"><div class="panel-h" style="padding:18px 20px 4px"><div class="t">${icon('package', 20)}<h3>Package catalogue</h3></div>${admin ? `<button class="btn sm gold" data-new-pkg>${icon('plus', 16)}New package</button>` : ''}</div>
        <table class="t"><thead><tr><th>Package</th><th class="n">Sessions</th><th class="n">Price</th><th class="n">Valid for</th><th>Status</th></tr></thead><tbody>
        ${packages.map(p => `<tr class="${admin ? 'click' : ''}" data-pkg="${p.id}"><td><b>${esc(p.name)}</b><div class="small muted">${esc(p.description || '')}</div></td><td class="n">${p.sessions}</td><td class="n">${p.price != null ? inr(p.price) : '<span style="color:var(--warn)">Set price</span>'}</td><td class="n">${p.validity_days} days</td><td>${p.active ? pill('active') : pill('closed', 'Hidden')}</td></tr>`).join('')}</tbody></table></section>
      ${admin ? `<section class="panel flush"><div class="panel-h" style="padding:18px 20px 4px"><div class="t">${icon('users', 20)}<h3>Team accounts</h3></div><button class="btn sm gold" data-new-user>${icon('user-plus', 16)}Add team member</button></div>
        <div class="rows">${users.some(u => u.username === 'hasta') ? '' : `<div class="row"><span class="avatar">CA</span><div class="grow"><b>Clinic admin</b><span>Username "hasta" — password is the website admin password</span></div>${pill('active', 'Admin')}</div>`}
        ${users.map(u => `<div class="row click" data-user="${u.id}"><span class="avatar">${esc(initials(u.name))}</span><div class="grow"><b>${esc(u.name)}</b><span>${esc(u.username)}</span></div><a class="btn sm quiet" href="#/clients?coach=${u.id}" onclick="event.stopPropagation()">${clientsOf(u.id)} active client${clientsOf(u.id) === 1 ? '' : 's'}</a>${pill(u.active ? 'active' : 'closed', u.active ? (u.role === 'admin' ? 'Admin' : 'Team') : 'Disabled')}</div>`).join('')}</div></section>` : ''}
      <section class="panel"><div class="panel-h"><div class="t">${icon('key-round', 20)}<h3>Your account</h3></div></div>
        ${ME.id === 0 ? '<p class="muted">You are signed in with the clinic admin account. Its password is the ADMIN_PASSWORD secret in Cloudflare. Add personal team accounts above so each person signs in as themselves.</p>'
          : `<form class="grid3" data-pw style="align-items:end">${field('Current password', inp('current', '', 'type="password" autocomplete="current-password"'))}${field('New password', inp('next', '', 'type="password" autocomplete="new-password" minlength="8"'))}<div><button class="btn">Change password</button></div></form>`}</section>
      <section class="panel"><div class="panel-h"><div class="t">${icon('phone', 20)}<h3>Client app</h3></div></div>
        <p class="muted">Clients sign in at <b>${esc(APP_URL)}</b> with their mobile number and PIN. Each slot takes up to ${esc(String((await api('/staff/appointments?from=' + today())).capacity))} clients; sessions are 30 minutes within clinic hours (Mon–Sat 10 am–8 pm, Sun 10 am–2 pm).</p></section>
    </div>`;
  if (admin) {
    MAIN.querySelector('[data-new-pkg]').addEventListener('click', () => pkgDefModal(null));
    MAIN.querySelectorAll('[data-pkg]').forEach(r => r.addEventListener('click', () => pkgDefModal(packages.find(p => p.id === +r.dataset.pkg))));
    MAIN.querySelector('[data-new-user]').addEventListener('click', () => userModal(null));
    MAIN.querySelectorAll('[data-user]').forEach(r => r.addEventListener('click', () => userModal(users.find(u => u.id === +r.dataset.user))));
  }
  const pw = MAIN.querySelector('[data-pw]');
  pw && pw.addEventListener('submit', e => { e.preventDefault(); busy(pw.querySelector('button'), () => api('/me/secret', { method: 'POST', body: formData(pw) })).then(() => { toast('Password changed'); pw.reset(); }).catch(() => {}); });
}

function pkgDefModal(p) {
  p = p || { name: '', sessions: 10, price: '', validity_days: 90, description: '', active: 1 };
  modal({
    title: p.id ? 'Edit package' : 'New package',
    body: `<form class="stack" style="gap:14px" data-f>${field('Name', inp('name', p.name, 'maxlength="80"'))}
      <div class="grid3">${field('Sessions', inp('sessions', p.sessions, 'type="number" min="1"'))}${field('Price (₹)', inp('price', p.price, 'type="number" min="0"'))}${field('Valid for (days)', inp('validity_days', p.validity_days, 'type="number" min="7"'))}</div>
      ${field('Description', inp('description', p.description, 'maxlength="200"'))}
      <label class="check"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> Available to assign</label></form>
      <p class="small muted">Changing a package here doesn't change packages already given to clients.</p>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Save package</button>`,
    onMount(el, close) {
      const save = el.querySelector('[data-save]');
      save.addEventListener('click', () => busy(save, () => api('/staff/packages' + (p.id ? '/' + p.id : ''), { method: p.id ? 'PUT' : 'POST', body: formData(el.querySelector('[data-f]')) })).then(() => { close(); toast('Package saved'); reload(); }).catch(() => {}));
    },
  });
}

function userModal(u) {
  u = u || { name: '', username: '', role: 'staff', active: 1 };
  modal({
    title: u.id ? 'Edit team member' : 'Add team member',
    body: `<form class="stack" style="gap:14px" data-f><div class="grid2">${field('Name', inp('name', u.name))}${field('Username', inp('username', u.username, 'autocapitalize="none"'))}</div>
      <div class="grid2">${field('Role', sel('role', [['staff', 'Team — clients, bookings, payments'], ['admin', 'Admin — also packages and team']], u.role))}${field(u.id ? 'New password' : 'Password', inp('password', '', 'type="password" autocomplete="new-password"'), u.id ? 'leave blank to keep' : 'at least 8 characters')}</div>
      ${u.id ? `<label class="check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Account active</label>` : ''}</form>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Save</button>`,
    onMount(el, close) {
      const save = el.querySelector('[data-save]');
      save.addEventListener('click', () => busy(save, () => { const b = formData(el.querySelector('[data-f]')); if (!u.id) b.active = true; return api('/staff/users' + (u.id ? '/' + u.id : ''), { method: u.id ? 'PUT' : 'POST', body: b }); }).then(() => { close(); toast('Team member saved'); team(true); reload(); }).catch(() => {}));
    },
  });
}
