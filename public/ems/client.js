import {
  api, esc, icon, toast, modal, formData, busy, field, inp, emptyState, slotPicker, lineChart, ring, insightList, deltaTag, measureSeries,
  dietView, today, nowLocal, dayDiff, fDay, fDate, fLong, fTime, fWhen, inr, kg, first, prettyPhone, pill, KIND_LABEL, CLINIC_PHONE, CLINIC_TEL,
} from './core.js';

let ME, APP, BODY, DATA;
const TABS = [['', 'home', 'Home'], ['progress', 'line-chart', 'Progress'], ['book', 'calendar-plus', 'Book', true], ['plan', 'salad', 'My plan'], ['account', 'user', 'Account']];

export function mount(app, me) {
  ME = me; APP = app;
  app.innerHTML = `<div class="capp">
    <header class="ctop"><div class="brand"><img src="/img/hasta-emblem.webp" alt="" width="32" height="32"><b>Hasta EMS</b></div>
      <a class="btn sm ghost" href="https://wa.me/919778458883" target="_blank" rel="noopener">${icon('message-circle', 16)}Ask the clinic</a></header>
    <main class="cbody" id="cbody"></main></div>
    <div class="tabbar"><nav aria-label="Main">${TABS.map(([k, ic, l, cta]) => `<a href="#/${k}" data-k="${k}" class="${cta ? 'cta' : ''}">${icon(ic, 22)}${l}</a>`).join('')}</nav></div>`;
  BODY = app.querySelector('#cbody');
  window.addEventListener('hashchange', route);
  route();
}

async function load() { DATA = await api('/client/overview'); return DATA; }

async function route(refetch = true) {
  const k = location.hash.replace(/^#\/?/, '').split('?')[0];
  APP.querySelectorAll('.tabbar a').forEach(a => a.classList.toggle('on', a.dataset.k === k));
  if (refetch || !DATA) { BODY.innerHTML = '<div class="boot" style="min-height:50vh"><img src="/img/hasta-emblem.webp" alt="" width="44" height="44"></div>'; }
  window.scrollTo(0, 0);
  try {
    if (refetch || !DATA) await load();
    ({ '': home, progress, book, plan, account }[k] || home)();
  } catch (e) { BODY.innerHTML = `<div class="panel"><p class="err">${esc(e.message)}</p></div>`; }
}
const refresh = () => route(true);

const current = () => DATA.packages.filter(p => p.state === 'active').slice(-1)[0] || DATA.packages.slice(-1)[0] || null;
const upcoming = () => DATA.appointments.filter(a => a.status === 'booked' && a.start_at >= nowLocal()).sort((a, b) => a.start_at < b.start_at ? -1 : 1);
const attendedCount = () => DATA.appointments.filter(a => a.kind === 'session' && a.status === 'attended').length;

/* ---------- Home ---------- */
function home() {
  const M = DATA.insights.metrics, p = current(), next = upcoming()[0];
  const w = M.change.weight, wa = M.change.waist;
  const hr = new Date(Date.now() + 330 * 60000).getUTCHours();
  const checkedToday = DATA.checkins.some(c => c.day === today());
  BODY.innerHTML = `
    <section class="hero">
      <p class="hi">${hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening'}</p><h1>${esc(first(ME.name))}</h1>
      <div class="hero-grid">${p ? ring(p.used, p.sessions_total, p.booked) : ring(0, 0)}
        <div class="hero-stats">
          <div>${icon('zap', 20)}<p><b>${attendedCount()}</b><span>sessions completed</span></p></div>
          <div>${icon('trending-down', 20)}<p><b>${w ? (w.diff > 0 ? '+' : '') + w.diff + ' kg' : '—'}</b><span>${w ? 'weight since ' + fDay(w.since) : 'weight change'}</span></p></div>
          <div>${icon('ruler', 20)}<p><b>${wa ? (wa.diff > 0 ? '+' : '') + wa.diff + ' cm' : '—'}</b><span>waist change</span></p></div>
        </div></div>
      <div class="next">${next ? `<div><b>${esc(fWhen(next.start_at))}</b><span>Your next ${next.kind === 'session' ? 'EMS session' : esc(KIND_LABEL[next.kind].toLowerCase())}</span></div><a class="btn sm gold" href="#/book">Manage</a>`
        : `<div><b>No session booked</b><span>${p && p.available ? `${p.available} session${p.available > 1 ? 's' : ''} ready to book` : 'Ask the clinic about your next package'}</span></div>${p && p.available ? '<a class="btn sm gold" href="#/book">Book now</a>' : `<a class="btn sm gold" href="tel:${CLINIC_TEL}">Call</a>`}`}</div>
    </section>
    ${!checkedToday ? `<a href="#/plan" class="panel" style="display:flex;gap:14px;align-items:center;text-decoration:none;background:var(--gold-soft);border-color:transparent">${icon('clipboard-check', 24)}<div style="flex:1"><b>Log today's check-in</b><p class="small muted">Water, steps, sleep and meals — 20 seconds.</p></div>${icon('chevron-right', 20)}</a>` : ''}
    <section class="panel"><div class="panel-h"><div class="t">${icon('flame', 20)}<h3>Your momentum</h3></div></div>
      <div class="score"><b>${M.score}</b><div class="meter"><i style="width:${M.score}%"></i></div></div>
      <p class="small muted" style="margin-top:8px">Based on your sessions, daily habits and progress over the last few weeks.${M.target && M.target.eta ? ` At this pace you could reach ${M.target.value} kg around ${fDate(M.target.eta)}.` : ''}</p></section>
    <section class="panel"><div class="panel-h"><div class="t">${icon('sparkles', 20)}<h3>Guidance for you</h3></div></div>${insightList(DATA.insights.items, 5)}</section>
    ${DATA.measurements.filter(m => m.weight != null).length > 1 ? `<section class="panel"><div class="panel-h"><div class="t">${icon('line-chart', 20)}<h3>Weight trend</h3></div><a class="btn sm quiet" href="#/progress">All progress</a></div><div data-w></div></section>` : ''}`;
  const wEl = BODY.querySelector('[data-w]');
  wEl && lineChart(wEl, { series: [{ name: 'Weight', color: '#34595e', points: measureSeries(DATA.measurements, 'weight') }], unit: ' kg', target: DATA.client.target_weight, height: 200 });
}

/* ---------- Book ---------- */
function book() {
  const up = upcoming(), p = DATA.packages.filter(x => x.state === 'active');
  const avail = p.reduce((a, x) => a + x.available, 0);
  let pick = null;
  BODY.innerHTML = `<div class="head" style="margin:4px 4px 0"><div><h1>Bookings</h1><p>${avail} session${avail === 1 ? '' : 's'} available to book</p></div></div>
    ${up.length ? `<section class="panel flush"><div class="panel-h" style="padding:16px 16px 0"><div class="t">${icon('calendar-check', 20)}<h3>Coming up</h3></div></div><div class="rows" style="margin-top:6px">
      ${up.map(a => `<div class="row"><div class="grow"><b>${esc(fWhen(a.start_at))}</b><span>${esc(KIND_LABEL[a.kind])}</span></div>${a.kind === 'session' ? `<button class="btn sm ghost" data-cancel="${a.id}">Cancel</button>` : pill('booked')}</div>`).join('')}</div></section>` : ''}
    ${!DATA.client.cleared ? `<section class="panel"><div class="ins warn">${icon('shield-alert', 20)}<div><b>Suitability check first</b><p>Before your first EMS session the clinic team will go through a short health check with you. Call or WhatsApp to book it.</p></div></div><div style="display:flex;gap:8px;margin-top:12px"><a class="btn" href="tel:${CLINIC_TEL}">${icon('phone', 18)}Call</a><a class="btn wa" href="https://wa.me/919778458883" target="_blank" rel="noopener">${icon('message-circle', 18)}WhatsApp</a></div></section>`
      : avail ? `<section class="panel"><div class="panel-h"><div class="t">${icon('calendar-plus', 20)}<h3>Book a session</h3></div></div>
        <div data-slots></div>
        <p class="note" style="margin-top:14px">${icon('battery-charging', 16, '')} Leave about 48 hours between EMS sessions so your muscles can recover. Twice a week works well for most people.</p>
        <button class="btn gold" data-confirm disabled style="width:100%;height:46px;margin-top:14px">Choose a time</button></section>`
      : `<section class="panel">${emptyState('package', 'You have no sessions left to book.', `<a class="btn" href="https://wa.me/919778458883?text=${encodeURIComponent('Hi, I would like to renew my EMS package.')}" target="_blank" rel="noopener">Ask about renewing</a>`)}</section>`}
    <p class="small muted" style="text-align:center;padding:0 12px">Need a time that isn't shown, or a change within 3 hours? Call <a href="tel:${CLINIC_TEL}">${CLINIC_PHONE}</a></p>`;
  const slotsEl = BODY.querySelector('[data-slots]'), btn = BODY.querySelector('[data-confirm]');
  slotsEl && slotPicker(slotsEl, { onPick: v => { pick = v; btn.disabled = !v; btn.textContent = v ? `Book ${fWhen(v)}` : 'Choose a time'; } });
  btn && btn.addEventListener('click', () => busy(btn, () => api('/client/appointments', { method: 'POST', body: { start_at: pick } }))
    .then(() => { toast('Booked for ' + fWhen(pick)); refresh(); }).catch(() => {}));
  BODY.querySelectorAll('[data-cancel]').forEach(b => b.addEventListener('click', () => {
    const a = up.find(x => x.id === +b.dataset.cancel);
    modal({ title: 'Cancel this session?', body: `<p>${esc(fLong(a.start_at))} at ${esc(fTime(a.start_at))}. The session goes back into your package.</p>`,
      actions: `<button class="btn ghost" data-close>Keep it</button><button class="btn danger" data-yes>Cancel session</button>`,
      onMount(el, close) { const y = el.querySelector('[data-yes]'); y.addEventListener('click', () => busy(y, () => api(`/client/appointments/${a.id}/cancel`, { method: 'POST', body: {} })).then(() => { close(); toast('Session cancelled'); refresh(); }).catch(() => {})); } });
  }));
}

/* ---------- Progress ---------- */
function progress() {
  const M = DATA.insights.metrics, ch = M.change;
  const last = k => { for (let i = DATA.measurements.length - 1; i >= 0; i--) if (DATA.measurements[i][k] != null) return DATA.measurements[i][k]; return null; };
  const tile = (l, k, u) => `<div class="metric"><div class="l">${l}</div><div class="v">${last(k) != null ? kg(last(k)) : '—'}<small>${last(k) != null ? u : ''}</small></div>${ch[k] ? deltaTag(ch[k].diff, u === '%' ? '%' : ' ' + u, k !== 'muscle_mass') : '<span class="small faint">—</span>'}</div>`;
  BODY.innerHTML = `<div class="head" style="margin:4px 4px 0"><div><h1>Your progress</h1><p>${DATA.measurements.length ? `Last measured ${fDate(DATA.measurements[DATA.measurements.length - 1].measured_on)}` : 'Measurements are taken at the clinic'}</p></div></div>
    <section class="panel" style="padding:0;overflow:hidden"><div class="metrics" style="border:0;border-radius:0">${tile('Weight', 'weight', 'kg')}${tile('Waist', 'waist', 'cm')}${tile('Hips', 'hips', 'cm')}${tile('Body fat', 'body_fat', '%')}</div></section>
    ${M.bmi || M.whr ? `<section class="panel"><div class="grid2" style="grid-template-columns:1fr 1fr">${M.bmi ? `<div><p class="small muted">BMI</p><p class="num" style="font-size:22px;font-weight:700">${M.bmi.value}</p><p class="small">${esc(M.bmi.band)}</p></div>` : ''}${M.whr ? `<div><p class="small muted">Waist-to-hip ratio</p><p class="num" style="font-size:22px;font-weight:700">${M.whr.value}</p><p class="small">${M.whr.ok ? 'In the healthy range' : `Aim for ${M.whr.limit} or less`}</p></div>` : ''}</div>
      <p class="small faint" style="margin-top:10px">BMI uses the ranges recommended for South Asian adults. These numbers are a guide, not a diagnosis.</p></section>` : ''}
    <section class="panel"><div class="panel-h"><div class="t">${icon('line-chart', 20)}<h3>Weight</h3></div></div><div data-w></div></section>
    <section class="panel"><div class="panel-h"><div class="t">${icon('ruler', 20)}<h3>Waist and hips</h3></div></div><div data-wh></div></section>
    <section class="panel"><div class="panel-h"><div class="t">${icon('activity', 20)}<h3>Body fat</h3></div></div><div data-bf></div></section>
    <section class="panel flush"><div class="panel-h" style="padding:16px 16px 0"><div class="t">${icon('clipboard-check', 20)}<h3>History</h3></div></div>
      ${DATA.measurements.length ? `<table class="t" style="margin-top:6px"><thead><tr><th>Date</th><th class="n">Weight</th><th class="n">Waist</th><th class="n">Hips</th></tr></thead><tbody>${DATA.measurements.slice().reverse().map(m => `<tr><td>${esc(fDay(m.measured_on))}</td><td class="n">${m.weight != null ? kg(m.weight) : '—'}</td><td class="n">${m.waist ?? '—'}</td><td class="n">${m.hips ?? '—'}</td></tr>`).join('')}</tbody></table>`
        : emptyState('ruler', 'Your first measurements will appear here after your assessment.')}</section>`;
  lineChart(BODY.querySelector('[data-w]'), { series: [{ name: 'Weight', color: '#34595e', points: measureSeries(DATA.measurements, 'weight') }], unit: ' kg', target: DATA.client.target_weight, targetLabel: 'Goal', height: 210 });
  lineChart(BODY.querySelector('[data-wh]'), { series: [{ name: 'Waist', color: '#34595e', points: measureSeries(DATA.measurements, 'waist') }, { name: 'Hips', color: '#c4a45b', points: measureSeries(DATA.measurements, 'hips') }], unit: ' cm', height: 210 });
  lineChart(BODY.querySelector('[data-bf]'), { series: [{ name: 'Body fat', color: '#a8642c', points: measureSeries(DATA.measurements, 'body_fat') }], unit: '%', height: 200 });
}

/* ---------- Plan & check-in ---------- */
function plan() {
  const P = DATA.plan;
  const c = DATA.checkins.find(x => x.day === today()) || {};
  const v = { water: c.water ?? 0, sleep: c.sleep ?? 7, meals: c.meals ?? 0, energy: c.energy ?? 0 };
  const week = DATA.checkins.filter(x => dayDiff(x.day, today()) < 7);
  BODY.innerHTML = `<div class="head" style="margin:4px 4px 0"><div><h1>My plan</h1><p>Daily habits and food guidance from your coach</p></div></div>
    ${P.focus ? `<section class="panel" style="background:var(--teal-deep);border-color:transparent;color:#fff"><div style="display:flex;gap:12px">${icon('message-circle', 22)}<div><b style="font-family:Manrope">From your coach</b><p style="color:#d8e6e3;margin-top:4px">${esc(P.focus)}</p></div></div></section>` : ''}
    <section class="panel"><div class="panel-h"><div class="t">${icon('clipboard-check', 20)}<h3>Today's check-in</h3></div>${c.day ? pill('good', 'Saved') : ''}</div>
      <form data-f>
        <div class="habit"><span class="hic">${icon('droplet', 20)}</span><div><b>Water</b><div class="small muted">Target ${P.water_target} glasses</div></div><div class="stepper" data-k="water" data-step="1" data-min="0" data-max="30"><button type="button" data-d="-1" aria-label="Less">−</button><output>${v.water}</output><button type="button" data-d="1" aria-label="More">+</button></div></div>
        <div class="habit"><span class="hic">${icon('footprints', 20)}</span><div><b>Steps</b><div class="small muted">Target ${P.steps_target.toLocaleString('en-IN')}</div></div><input class="in" name="steps" type="number" inputmode="numeric" min="0" max="60000" step="100" value="${c.steps ?? ''}" placeholder="0" style="width:110px;text-align:right"></div>
        <div class="habit"><span class="hic">${icon('moon', 20)}</span><div><b>Sleep last night</b><div class="small muted">Target ${P.sleep_target} hours</div></div><div class="stepper" data-k="sleep" data-step="0.5" data-min="0" data-max="16"><button type="button" data-d="-1" aria-label="Less">−</button><output>${v.sleep}</output><button type="button" data-d="1" aria-label="More">+</button></div></div>
        <div class="habit"><span class="hic">${icon('utensils', 20)}</span><div><b>Meals on plan</b><div class="small muted">Out of 4 today</div></div><div class="stepper" data-k="meals" data-step="1" data-min="0" data-max="4"><button type="button" data-d="-1" aria-label="Less">−</button><output>${v.meals}</output><button type="button" data-d="1" aria-label="More">+</button></div></div>
        <div class="habit" style="grid-template-columns:auto minmax(0,1fr)"><span class="hic">${icon('battery-charging', 20)}</span><div><b>Energy today</b><div class="energy" style="margin-top:8px">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-e="${n}" class="${v.energy === n ? 'on' : ''}" aria-label="Energy ${n} of 5">${n}</button>`).join('')}</div></div></div>
        <div style="margin-top:12px">${field('Anything to tell your coach?', inp('note', c.note || '', 'maxlength="300" placeholder="Optional"'))}</div>
        <button class="btn" data-save style="width:100%;height:46px;margin-top:14px">${icon('check', 18)}Save check-in</button></form></section>
    ${week.length ? `<section class="panel"><div class="panel-h"><div class="t">${icon('activity', 20)}<h3>This week</h3></div><span class="small muted">${week.length} of 7 days logged</span></div>
      <div class="metrics">${[['Water', 'water', ' gl'], ['Steps', 'steps', ''], ['Sleep', 'sleep', ' h'], ['Meals', 'meals', '/4']].map(([l, k, u]) => { const a = DATA.insights.metrics.habits[k]; return `<div class="metric"><div class="l">${l}</div><div class="v">${a == null ? '—' : k === 'steps' ? Math.round(a).toLocaleString('en-IN') : Math.round(a * 10) / 10}<small>${a == null ? '' : u}</small></div><span class="small faint">daily average</span></div>`; }).join('')}</div></section>` : ''}
    <section class="panel">${dietView(P.diet)}</section>`;
  const f = BODY.querySelector('[data-f]');
  f.addEventListener('click', e => {
    const b = e.target.closest('[data-d]');
    if (b) { const s = b.parentElement, k = s.dataset.k, st = +s.dataset.step; v[k] = Math.min(+s.dataset.max, Math.max(+s.dataset.min, Math.round((v[k] + st * +b.dataset.d) * 10) / 10)); s.querySelector('output').textContent = v[k]; }
    const en = e.target.closest('[data-e]');
    if (en) { v.energy = +en.dataset.e; f.querySelectorAll('[data-e]').forEach(x => x.classList.toggle('on', x === en)); }
  });
  f.addEventListener('submit', e => e.preventDefault());
  const save = f.querySelector('[data-save]');
  save.addEventListener('click', () => busy(save, () => api('/client/checkins', { method: 'POST', body: { day: today(), water: v.water, sleep: v.sleep, meals: v.meals, energy: v.energy || null, steps: f.steps.value, note: f.note.value } }))
    .then(() => { toast('Check-in saved'); refresh(); }).catch(() => {}));
}

/* ---------- Account ---------- */
function account() {
  const C = DATA.client;
  BODY.innerHTML = `<div class="head" style="margin:4px 4px 0"><div><h1>${esc(C.name)}</h1><p>${esc(prettyPhone(C.phone))}</p></div></div>
    <section class="panel flush"><div class="panel-h" style="padding:16px 16px 4px"><div class="t">${icon('package', 20)}<h3>My packages</h3></div></div>
      ${DATA.packages.length ? DATA.packages.slice().reverse().map(p => `<div class="pkg" style="grid-template-columns:1fr"><div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>${esc(p.name)}</b>${pill(p.state)}</div>
        <div class="bar" style="margin:8px 0 6px"><i style="width:${p.used / p.sessions_total * 100}%"></i><i class="b" style="width:${p.booked / p.sessions_total * 100}%"></i></div>
        <span class="small muted">${p.used} done, ${p.booked} booked, ${p.remaining} left of ${p.sessions_total}${p.expiry_date ? ` · use by ${fDate(p.expiry_date)}` : ''}</span>
        <p class="small" style="margin-top:4px">${inr(p.due)} · paid ${inr(p.paid)}${p.balance > 0 ? ` · <b style="color:var(--warn)">${inr(p.balance)} due</b>` : ''}</p></div></div>`).join('') : emptyState('package', 'No package yet.')}</section>
    ${DATA.payments.length ? `<section class="panel flush"><div class="panel-h" style="padding:16px 16px 0"><div class="t">${icon('receipt', 20)}<h3>Payments</h3></div></div><div class="rows" style="margin-top:6px">${DATA.payments.map(p => `<div class="row"><div class="grow"><b>${inr(p.amount)}</b><span>${esc(fDate(p.paid_on))} · ${esc(p.method)}</span></div><span class="small muted">${esc(p.package_name || '')}</span></div>`).join('')}</div></section>` : ''}
    <section class="panel"><div class="panel-h"><div class="t">${icon('key-round', 20)}<h3>Change PIN</h3></div></div>
      <form class="grid2" data-pin style="align-items:end">${field('Current PIN', inp('current', '', 'type="password" inputmode="numeric" maxlength="6" autocomplete="current-password"'))}${field('New 6-digit PIN', inp('next', '', 'type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"'))}<button class="btn">Update PIN</button></form></section>
    <section class="panel stack" style="gap:10px"><div class="t" style="display:flex;gap:10px;align-items:center">${icon('phone', 20)}<h3>Hasta Wellness</h3></div>
      <p class="small muted">1st floor, Anjali Arcade, near Nippon Toyota, Technopark Phase 3 Service Road, Kazhakkoottam. Open Mon–Sat 10 am–8 pm, Sun 10 am–2 pm.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn ghost" href="tel:${CLINIC_TEL}">${icon('phone', 18)}${CLINIC_PHONE}</a><a class="btn wa" href="https://wa.me/919778458883" target="_blank" rel="noopener">${icon('message-circle', 18)}WhatsApp</a></div>
      <p class="small faint">Your records are kept by HASWEL CARE Private Limited for your programme. To get a copy or ask for them to be deleted, contact the clinic. <a href="https://hastawellnessclinic.com/privacy/">Privacy notice</a></p></section>
    <button class="btn ghost" data-out style="height:46px">${icon('log-out', 18)}Sign out</button>`;
  const pf = BODY.querySelector('[data-pin]');
  pf.addEventListener('submit', e => { e.preventDefault(); busy(pf.querySelector('button'), () => api('/me/secret', { method: 'POST', body: formData(pf) })).then(() => { toast('PIN updated'); pf.reset(); }).catch(() => {}); });
  BODY.querySelector('[data-out]').addEventListener('click', async () => { await api('/auth/logout', { method: 'POST', body: {} }); location.hash = ''; location.reload(); });
}
