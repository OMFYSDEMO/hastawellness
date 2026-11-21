import { icon } from './icons.js?v=2';
export { icon };

export const BASE = document.querySelector('meta[name="ems-base"]')?.content || '';
export const APP_URL = location.origin + BASE + '/';
export const CLINIC_PHONE = '+91 97784 58883';
export const CLINIC_TEL = '+919778458883';

/* ---------- API ---------- */
export async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
  if (opts.body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
  let res, data;
  try { res = await fetch(BASE + '/api' + path, init); data = await res.json(); }
  catch { throw new Error('Could not reach the server. Check your connection and try again.'); }
  if (res.status === 401 && !path.startsWith('/auth')) { location.hash = ''; location.reload(); }
  if (!data.ok) { const e = new Error(data.error || 'Something went wrong.'); e.data = data; throw e; }
  return data;
}

/* ---------- Formatting ---------- */
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const IST = 330 * 60000;
export const today = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
export const nowLocal = () => new Date(Date.now() + IST).toISOString().slice(0, 16);
export const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const dayDiff = (a, b) => Math.round((new Date(b.slice(0, 10) + 'T00:00:00Z') - new Date(a.slice(0, 10) + 'T00:00:00Z')) / 86400000);
const D = (d, o) => new Date(d.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-IN', { timeZone: 'UTC', ...o });
export const fDay = d => d ? D(d, { day: 'numeric', month: 'short' }) : '';
export const fDate = d => d ? D(d, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
export const fWeekday = d => D(d, { weekday: 'short' });
export const fLong = d => D(d, { weekday: 'long', day: 'numeric', month: 'long' });
export const fTime = s => { if (!s) return ''; const [h, m] = s.slice(-5).split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
export const fWhen = s => {
  if (!s) return '';
  const d = s.slice(0, 10), t = today();
  const lbl = d === t ? 'Today' : d === addDays(t, 1) ? 'Tomorrow' : d === addDays(t, -1) ? 'Yesterday' : D(d, { weekday: 'short', day: 'numeric', month: 'short' });
  return `${lbl}, ${fTime(s)}`;
};
export const inr = n => '₹' + Math.round(n || 0).toLocaleString('en-IN');
export const kg = v => v == null ? '—' : `${(+v).toFixed(1)}`;
export const initials = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
export const first = n => String(n || '').trim().split(/\s+/)[0];
export const ageFrom = y => y ? new Date().getFullYear() - y : null;
export const prettyPhone = p => { const d = String(p || '').replace(/\D/g, '').slice(-10); return d.length === 10 ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : p; };
export const wa = (phone, text) => { let d = String(phone || '').replace(/\D/g, ''); if (d.length === 10) d = '91' + d; return `https://wa.me/${d}?text=${encodeURIComponent(text)}`; };
export const STATUS_LABEL = { booked: 'Booked', attended: 'Attended', no_show: 'No-show', cancelled: 'Cancelled', active: 'Active', paused: 'Paused', completed: 'Completed', expired: 'Expired', closed: 'Closed', new: 'New', contacted: 'Contacted', 'not interested': 'Not interested' };
export const pill = (s, label) => `<span class="pill ${esc(String(s).replace(/\s/g, '-'))}">${esc(label || STATUS_LABEL[s] || s)}</span>`;
export const KIND_LABEL = { session: 'EMS session', trial: 'EMS trial / demo', consultation: 'Initial consultation', review: 'Progress review', wm_consult: 'Weight-management consultation' };
export function includesText(e, sessions) {
  if (!e) return '';
  const parts = [];
  const n = sessions ?? e.sessions;
  if (n) parts.push(`${n}${e.session_minutes ? ` × ${e.session_minutes}-min` : ''} EMS session${n > 1 ? 's' : ''}`);
  if (e.reviews) parts.push(e.legacy ? 'reviews' : `${e.reviews} progress review${e.reviews > 1 ? 's' : ''}`);
  if (e.wm_consults) parts.push(e.legacy ? 'weight-management consultations' : `${e.wm_consults} weight-management consultation${e.wm_consults > 1 ? 's' : ''}`);
  if (e.diet_plan) parts.push('diet and lifestyle plan');
  if (e.measurements) parts.push('progress measurements and charts');
  for (const t of e.treatments || []) parts.push(`${t.qty} × ${t.name}${t.used != null ? ` (${t.used} given)` : ''}`);
  return parts.join(', ');
}

/* ---------- UI primitives ---------- */
export function toast(msg, err = false) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.setAttribute('role', 'status');
  t.innerHTML = (err ? '' : icon('check-circle', 18)) + `<span>${esc(msg)}</span>`;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), err ? 5000 : 2800);
}

export function modal({ title, body, actions = '', wide = false, onMount }) {
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-h"><h3>${esc(title)}</h3><button class="btn quiet sm icon" data-close aria-label="Close">${icon('x', 18)}</button></div>
    <div class="modal-b">${body}</div>${actions ? `<div class="modal-f">${actions}</div>` : ''}</div>`;
  const close = () => { scrim.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  scrim.addEventListener('click', e => { if (e.target === scrim || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(scrim);
  const el = scrim.querySelector('.modal');
  onMount && onMount(el, close);
  setTimeout(() => (el.querySelector('input:not([type=hidden]),select,textarea') || el.querySelector('button'))?.focus(), 30);
  return { el, close };
}

export function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') { if (el.name.includes('.')) { const [a, b] = el.name.split('.'); (o[a] ||= {})[b] = el.checked; } else o[el.name] = el.checked; }
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else o[el.name] = el.value.trim();
  }
  return o;
}

export async function busy(btn, fn, silent = false) {
  const label = btn.innerHTML;
  btn.disabled = true;
  try { return await fn(); } catch (e) { if (!silent && e.message !== 'cancelled') toast(e.message, true); throw e; }
  finally { btn.disabled = false; btn.innerHTML = label; }
}

export const field = (label, input, hint = '') => `<label class="f">${esc(label)}${hint ? ` <small>${esc(hint)}</small>` : ''}${input}</label>`;
export const inp = (name, value = '', attrs = '') => `<input class="in" name="${name}" value="${esc(value ?? '')}" ${attrs}>`;
export const sel = (name, options, value, attrs = '') => `<select class="in" name="${name}" ${attrs}>${options.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}"${String(v) === String(value ?? '') ? ' selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`;
export const emptyState = (ic, text, action = '') => `<div class="empty">${icon(ic, 30)}<p>${esc(text)}</p>${action}</div>`;

/* ---------- Slot picker ---------- */
export function slotPicker(el, { staff = false, onPick, days = 14, startDate, query = () => '' } = {}) {
  let chosenDay = startDate || today(), chosen = null;
  const dayList = [];
  for (let i = 0; i < days; i++) dayList.push(addDays(today(), i));
  el.innerHTML = `<div class="days" role="listbox" aria-label="Day">${dayList.map(d => `<button type="button" class="day${d === chosenDay ? ' on' : ''}" data-d="${d}"><small>${d === today() ? 'Today' : fWeekday(d)}</small><b>${+d.slice(8)}</b></button>`).join('')}</div>
    <div class="slots" style="margin-top:12px"></div>`;
  const slotsEl = el.querySelector('.slots');
  async function load() {
    slotsEl.innerHTML = '<p class="muted small">Loading times…</p>';
    try {
      const { slots } = await api('/slots?date=' + chosenDay + query());
      slotsEl.innerHTML = slots.some(s => s.left) || (staff && slots.length) ? slots.map(s => `<button type="button" class="slot" data-t="${s.time}" ${s.left ? '' : (staff ? 'data-full="1"' : 'disabled')} title="${s.left ? s.left + ' place' + (s.left > 1 ? 's' : '') + ' left' : 'Full'}">${fTime(s.time)}</button>`).join('')
        : `<p class="muted small">${slots.length ? 'Fully booked on this day.' : 'Closed, or no staff rostered on this day.'}</p>`;
    } catch (e) { slotsEl.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  }
  el.addEventListener('click', e => {
    const d = e.target.closest('.day');
    if (d) { chosenDay = d.dataset.d; el.querySelectorAll('.day').forEach(x => x.classList.toggle('on', x === d)); chosen = null; onPick && onPick(null); load(); }
    const s = e.target.closest('.slot');
    if (s && !s.disabled) { el.querySelectorAll('.slot').forEach(x => x.classList.toggle('on', x === s)); chosen = `${chosenDay}T${s.dataset.t}`; onPick && onPick(chosen, !!s.dataset.full); }
  });
  load();
  return { value: () => chosen, reload: () => { chosen = null; onPick && onPick(null); load(); } };
}

/* ---------- Charts (SVG, no dependencies) ---------- */
// Draw at the container's real width so labels stay legible on phones.
const widthOf = el => Math.max(300, Math.min(900, Math.round(el.clientWidth || 640)));
export function lineChart(el, { series, height = 220, unit = '', target = null, targetLabel = 'Target', decimals = 1 }) {
  const W = widthOf(el);
  const pts = series.flatMap(s => s.points);
  if (pts.length < 1) { el.innerHTML = emptyState('line-chart', 'No measurements yet.'); return; }
  const H = height, pad = { l: 44, r: 16, t: 14, b: 28 };
  const xs = pts.map(p => new Date(p.x + 'T00:00:00Z').getTime());
  let x0 = Math.min(...xs), x1 = Math.max(...xs);
  if (x0 === x1) { x0 -= 3 * 864e5; x1 += 3 * 864e5; }
  const ys = pts.map(p => p.y).concat(target != null ? [target] : []);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  const span = Math.max(y1 - y0, 1); y0 -= span * 0.15; y1 += span * 0.15;
  const X = t => pad.l + (t - x0) / (x1 - x0) * (W - pad.l - pad.r);
  const Y = v => pad.t + (1 - (v - y0) / (y1 - y0)) * (H - pad.t - pad.b);
  const grid = [0, 1, 2, 3].map(i => { const v = y0 + (y1 - y0) * i / 3; return `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="#e6ecea"/><text x="${pad.l - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="#8a9796">${v.toFixed(v > 100 ? 0 : decimals > 0 && span < 10 ? 1 : 0)}</text>`; }).join('');
  const xl = [x0, (x0 + x1) / 2, x1].map((t, i) => `<text x="${X(t)}" y="${H - 8}" text-anchor="${['start', 'middle', 'end'][i]}" font-size="11" fill="#8a9796">${fDay(new Date(t).toISOString())}</text>`).join('');
  const id = 'g' + Math.random().toString(36).slice(2, 8);
  const paths = series.map((s, si) => {
    const p = s.points.map(q => [X(new Date(q.x + 'T00:00:00Z').getTime()), Y(q.y)]);
    if (!p.length) return '';
    const d = p.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ');
    const area = si === 0 && p.length > 1 ? `<path d="${d} L${p[p.length - 1][0]} ${H - pad.b} L${p[0][0]} ${H - pad.b} Z" fill="url(#${id})"/>` : '';
    return area + `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>` +
      p.map(q => `<circle cx="${q[0]}" cy="${q[1]}" r="3.5" fill="#fff" stroke="${s.color}" stroke-width="2"/>`).join('');
  }).join('');
  const tl = target != null ? `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(target)}" y2="${Y(target)}" stroke="#c4a45b" stroke-dasharray="5 5" stroke-width="1.5"/><text x="${W - pad.r}" y="${Y(target) - 6}" text-anchor="end" font-size="11" font-weight="600" fill="#7d6326">${esc(targetLabel)} ${target}${unit}</text>` : '';
  el.innerHTML = `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map(s => s.name).join(', '))} chart">
    <defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${series[0].color}" stop-opacity=".18"/><stop offset="1" stop-color="${series[0].color}" stop-opacity="0"/></linearGradient></defs>
    ${grid}${xl}${tl}${paths}<rect class="hit" x="${pad.l}" y="0" width="${W - pad.l - pad.r}" height="${H}" fill="transparent"/></svg><div class="tip"></div></div>
    ${series.length > 1 ? `<div class="legend">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>` : ''}`;
  const svg = el.querySelector('svg'), tip = el.querySelector('.tip');
  const all = series.flatMap(s => s.points.map(p => ({ ...p, s: s.name, t: new Date(p.x + 'T00:00:00Z').getTime() })));
  const move = e => {
    const r = svg.getBoundingClientRect();
    const cx = ((e.touches ? e.touches[0].clientX : e.clientX) - r.left) / r.width * W;
    let best = null;
    for (const p of all) { const dx = Math.abs(X(p.t) - cx); if (!best || dx < best.dx) best = { ...p, dx }; }
    if (!best) return;
    const same = all.filter(p => p.x === best.x);
    tip.innerHTML = `<b>${fDay(best.x)}</b> · ${same.map(p => `${series.length > 1 ? esc(p.s) + ' ' : ''}${p.y}${unit}`).join(' · ')}`;
    tip.style.left = (X(best.t) / W * 100) + '%';
    tip.style.top = (Y(best.y) / H * 100) + '%';
    tip.classList.add('on');
  };
  svg.addEventListener('mousemove', move); svg.addEventListener('touchstart', move, { passive: true });
  svg.addEventListener('mouseleave', () => tip.classList.remove('on'));
}

export function barChart(el, { data, height = 180, format = v => v, color = '#34595e', highlightLast = true }) {
  const W = widthOf(el);
  const H = height, pad = { l: 8, r: 8, t: 22, b: 26 };
  const max = Math.max(1, ...data.map(d => d.value));
  const bw = (W - pad.l - pad.r) / data.length;
  el.innerHTML = `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img">${data.map((d, i) => {
    const h = (d.value / max) * (H - pad.t - pad.b), x = pad.l + i * bw + bw * 0.2, y = H - pad.b - h;
    const last = highlightLast && i === data.length - 1;
    return `<rect x="${x}" y="${y}" width="${bw * 0.6}" height="${Math.max(h, 2)}" rx="6" fill="${last ? '#c4a45b' : color}" opacity="${last ? 1 : .85}"/>
      <text x="${x + bw * 0.3}" y="${y - 6}" text-anchor="middle" font-size="11.5" font-weight="700" fill="#1d3437">${d.value ? esc(format(d.value)) : ''}</text>
      <text x="${x + bw * 0.3}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#8a9796">${esc(d.label)}</text>`;
  }).join('')}</svg></div>`;
}

export function ring(used, total, booked = 0) {
  const r = 56, c = 2 * Math.PI * r;
  const u = total ? Math.min(1, used / total) : 0, b = total ? Math.min(1 - u, booked / total) : 0;
  return `<div class="ring"><svg viewBox="0 0 132 132"><circle cx="66" cy="66" r="${r}" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="12"/>
    <circle cx="66" cy="66" r="${r}" fill="none" stroke="rgba(196,164,91,.45)" stroke-width="12" stroke-dasharray="${c * (u + b)} ${c}" stroke-linecap="round"/>
    <circle cx="66" cy="66" r="${r}" fill="none" stroke="#c4a45b" stroke-width="12" stroke-dasharray="${c * u} ${c}" stroke-linecap="round"/></svg>
    <div class="c"><b>${Math.max(0, total - used)}</b><span>of ${total} left</span></div></div>`;
}

export function insightList(items, limit = 99) {
  if (!items.length) return emptyState('sparkles', 'Nothing to flag right now.');
  return `<div class="insights">${items.slice(0, limit).map(i => `<div class="ins ${i.level}">${icon(i.icon, 20)}<div><b>${esc(i.title)}</b><p>${esc(i.text)}</p></div></div>`).join('')}</div>`;
}

// Lengths are stored in cm; shown in both cm and inches.
export const toIn = cm => Math.round((cm / 2.54) * 10) / 10;
export const toCm = inch => Math.round(inch * 2.54 * 10) / 10;
export const cmIn = cm => cm == null ? '—' : `${+cm} cm <span class="faint">(${toIn(cm)} in)</span>`;
export const ftIn = cm => { const t = Math.round(cm / 2.54); return `${Math.floor(t / 12)} ft ${t % 12} in`; };
export const signed = (v, u) => `${v > 0 ? '+' : ''}${v}${u}`;
// A length field with a cm / in switch; the value is converted to cm before saving.
export function lenField(label, name, value, hint) {
  return `<div class="f"><span style="display:flex;justify-content:space-between;align-items:center;gap:8px">${label}<span class="unitsw" data-unit-for="${name}"><button type="button" class="on" data-u="cm">cm</button><button type="button" data-u="in">in</button></span></span>
    <input class="in" name="${name}" value="${value ?? ''}" type="number" step="0.1" inputmode="decimal" data-len>${hint ? `<small class="faint">${hint}</small>` : ''}<small class="faint" data-conv="${name}"></small></div>`;
}
export function wireLen(root) {
  root.querySelectorAll('[data-unit-for]').forEach(sw => {
    const name = sw.dataset.unitFor, input = root.querySelector(`[name="${name}"]`), conv = root.querySelector(`[data-conv="${name}"]`);
    const unit = () => sw.querySelector('.on').dataset.u;
    const show = () => { const v = parseFloat(input.value); conv.textContent = isNaN(v) ? '' : unit() === 'cm' ? `= ${toIn(v)} in` : `= ${toCm(v)} cm`; };
    sw.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      if (b.classList.contains('on')) return;
      const v = parseFloat(input.value);
      if (!isNaN(v)) input.value = b.dataset.u === 'in' ? toIn(v) : toCm(v);
      sw.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); show();
    }));
    input.addEventListener('input', show); show();
  });
}
// Converts any inch entries back to cm (call on the formData object before saving).
export function lenToCm(root, data) {
  root.querySelectorAll('[data-unit-for]').forEach(sw => {
    const n = sw.dataset.unitFor;
    if (sw.querySelector('.on').dataset.u === 'in' && data[n] !== '' && data[n] != null && !isNaN(parseFloat(data[n]))) data[n] = toCm(parseFloat(data[n]));
  });
  return data;
}

export function deltaTag(diff, unit, goodWhenDown = true) {
  if (diff == null) return '';
  if (Math.abs(diff) < 0.05) return `<span class="delta flat">no change</span>`;
  const down = diff < 0, good = down === goodWhenDown;
  return `<span class="delta ${good ? 'down' : 'up'}">${icon(down ? 'trending-down' : 'trending-up', 14)}${diff > 0 ? '+' : ''}${diff}${unit}${unit === ' cm' ? ` (${diff > 0 ? '+' : ''}${toIn(diff)} in)` : ''}</span>`;
}

export function measureSeries(meas, key) {
  return meas.filter(m => m[key] != null).map(m => ({ x: m.measured_on, y: +m[key] }));
}

/* ---------- Lifestyle & diet plans ---------- */
export const DIETS = {
  'kerala-balanced': {
    name: 'Kerala balanced plate', icon: 'salad',
    intro: 'Everyday Kerala food, rebalanced: more vegetables and protein, smaller rice portions, less fried food and sugar.',
    plate: ['Half the plate: vegetables — thoran, avial, mezhukkupuratti, salad', 'A quarter: protein — fish curry, egg, chicken, kadala, cherupayar, dal', 'A quarter: carbs — about 1 cup cooked matta rice or 2 chapatis'],
    day: [
      ['sun', 'Breakfast', '2 idli or 2 appam with sambar, egg curry or kadala curry. Tea or coffee without sugar.'],
      ['apple', 'Mid-morning', 'A fruit (guava, papaya, orange) or a glass of sambharam.'],
      ['utensils', 'Lunch', '1 cup matta rice, fish curry or chicken curry, a big serving of thoran and a salad.'],
      ['coffee', 'Evening', 'Black tea with roasted kadala, sprouts or a handful of nuts — instead of bakery snacks.'],
      ['soup', 'Dinner (by 8 pm)', '2 chapatis or ragi dosa with a vegetable or protein curry. Keep it lighter than lunch.'],
    ],
    swaps: ['Fried fish → fish curry or pollichathu', 'Pazham pori, banana chips → roasted kadala or fruit', 'Sugar in tea → none, or reduce by half each week', 'Second helping of rice → extra thoran', 'Coconut oil: about 3 teaspoons a day in total'],
  },
  vegetarian: {
    name: 'Vegetarian balance', icon: 'salad',
    intro: 'A vegetarian plan built around enough protein at every meal, so EMS sessions build tone while weight comes down.',
    plate: ['Half the plate: vegetables and greens', 'A quarter: protein — kadala, cherupayar, rajma, paneer, curd, tofu, soya chunks', 'A quarter: carbs — matta rice, chapati, ragi or oats'],
    day: [
      ['sun', 'Breakfast', 'Puttu (small portion) with kadala curry, or oats upma with vegetables and a bowl of curd.'],
      ['apple', 'Mid-morning', 'A fruit or a glass of sambharam.'],
      ['utensils', 'Lunch', '1 cup matta rice, dal or sambar, a thoran, and paneer or soya curry 3–4 days a week.'],
      ['coffee', 'Evening', 'Sprouts chaat or roasted makhana with black tea.'],
      ['soup', 'Dinner (by 8 pm)', '2 chapatis with paneer bhurji or a dal, and a vegetable side.'],
    ],
    swaps: ['Potato curry → mixed vegetable or greens', 'Sweet lassi → plain curd or buttermilk', 'Biscuits with tea → a handful of nuts', 'Maida parotta → wheat chapati or ragi dosa'],
  },
  'high-protein': {
    name: 'High-protein tone plan', icon: 'dumbbell',
    intro: 'For toning and muscle with EMS: protein in every meal, and a protein snack within an hour after each session.',
    plate: ['Protein first: eggs, fish, chicken breast, paneer, curd, dal or soya at every meal', 'Plenty of vegetables for fibre', 'Moderate carbs, mostly earlier in the day'],
    day: [
      ['sun', 'Breakfast', '2–3 egg omelette with vegetables and 1 chapati, or ragi dosa with egg curry.'],
      ['apple', 'Mid-morning', 'Thick curd with fruit, or a glass of buttermilk with a boiled egg.'],
      ['utensils', 'Lunch', '¾ cup matta rice, a generous fish or chicken curry, thoran and salad.'],
      ['zap', 'After your EMS session', 'Within an hour: buttermilk with a boiled egg, sprouts, or a small paneer sandwich.'],
      ['soup', 'Dinner (by 8 pm)', 'Grilled fish or chicken, or a paneer and vegetable stir-fry, with a bowl of soup.'],
    ],
    swaps: ['Fried chicken → grilled or curry with less oil', 'Fruit juice → whole fruit', 'Late-night snacks → a glass of warm milk if hungry'],
  },
  'low-gi': {
    name: 'Steady sugar (low GI)', icon: 'heart-pulse',
    intro: 'For clients whose doctor has asked them to watch blood sugar. Always follow your doctor\'s advice first.',
    plate: ['Half the plate: non-starchy vegetables', 'A quarter: protein with every carb', 'A quarter: slow carbs — ragi, oats, broken wheat, a small portion of matta rice'],
    day: [
      ['sun', 'Breakfast', 'Ragi or oats dosa with sambar, or broken-wheat upma with vegetables. No sugar in tea.'],
      ['apple', 'Mid-morning', 'Guava, apple or a handful of nuts — not juice.'],
      ['utensils', 'Lunch', '½–¾ cup matta rice with plenty of thoran, a protein curry and salad. Eat vegetables first.'],
      ['coffee', 'Evening', 'Sprouts or roasted kadala with black tea.'],
      ['soup', 'Dinner (by 8 pm)', 'Chapati with dal and vegetables, or grilled fish with soup.'],
    ],
    swaps: ['White rice → smaller portion of matta rice or broken wheat', 'Banana, mango, jackfruit → small portions, with a meal', 'Sweets → keep for occasions, and share'],
  },
  'calorie-smart': {
    name: 'Calorie-smart Kerala plate', icon: 'scale',
    intro: 'Portion-controlled Kerala food for steady fat loss — the same meals you know, measured, with the evening kept light.',
    plate: ['Half the plate: vegetables — thoran, salad, clear soups', 'A palm-sized protein at every meal — fish, egg whites, chicken, dal, kadala', 'Carbs measured: ½–¾ cup matta rice, or 1–2 chapatis, never both'],
    day: [
      ['sun', 'Breakfast', '2 idli or 1 dosa with sambar and an egg or a small bowl of kadala. No sugar in tea.'],
      ['apple', 'Mid-morning', 'Guava, papaya or an orange — whole fruit, not juice.'],
      ['utensils', 'Lunch', '½–¾ cup matta rice, fish curry (not fried), a big bowl of thoran and salad. Eat the vegetables first.'],
      ['coffee', 'Evening', 'Buttermilk, cucumber or a small handful of roasted kadala — skip bakery snacks completely.'],
      ['soup', 'Dinner (by 7:30 pm)', 'Vegetable soup with grilled fish, egg or paneer, or 1 chapati with dal. Nothing after dinner except water.'],
    ],
    swaps: ['Rice refill → extra thoran', 'Coconut in every curry → once a day', 'Tea with sugar and biscuits → black tea or sugar-free', 'Weekend biriyani → half portion with raita and salad', 'Coconut oil: about 2–3 teaspoons a day in total'],
  },
  'fish-forward': {
    name: 'Fish-forward (pescatarian)', icon: 'fish',
    intro: 'Kerala\'s best protein — fish — at lunch and dinner, with no red meat and little fried food. Good for heart health and fat loss.',
    plate: ['Half the plate: vegetables and greens', 'A quarter: fish (mathi, ayala, choora, karimeen) curried, steamed or as pollichathu', 'A quarter: matta rice, kappa (small portion) or chapati'],
    day: [
      ['sun', 'Breakfast', 'Puttu (small) with kadala, or appam with egg curry, or oats with milk.'],
      ['apple', 'Mid-morning', 'A fruit or a glass of sambharam.'],
      ['utensils', 'Lunch', '¾ cup matta rice, meen curry (sardine or mackerel 3–4 times a week), thoran and moru curry.'],
      ['coffee', 'Evening', 'Black tea with sprouts or a few nuts.'],
      ['soup', 'Dinner (by 8 pm)', 'Steamed or grilled fish with vegetables, or fish curry with 1–2 chapatis.'],
    ],
    swaps: ['Fish fry → curry, pollichathu or steamed', 'Kappa with fish curry → small kappa, more fish and salad', 'Prawn/crab fry → occasional, curried', 'Pickles and papadam → once a week'],
  },
  eggetarian: {
    name: 'Vegetarian + egg', icon: 'egg',
    intro: 'Vegetarian food with eggs for easy, cheap protein — two eggs a day covers a good part of the protein target.',
    plate: ['Half the plate: vegetables', 'A quarter: eggs, dal, kadala, paneer or curd', 'A quarter: matta rice, chapati, ragi or oats'],
    day: [
      ['sun', 'Breakfast', '2-egg omelette with vegetables and 1 chapati, or appam with egg curry.'],
      ['apple', 'Mid-morning', 'Curd with fruit, or buttermilk.'],
      ['utensils', 'Lunch', '¾ cup matta rice, sambar or dal, thoran and an egg roast (less oil) or paneer.'],
      ['coffee', 'Evening', 'Boiled egg or sprouts with black tea.'],
      ['soup', 'Dinner (by 8 pm)', 'Chapati with dal and vegetables, or egg bhurji with a salad.'],
    ],
    swaps: ['Egg puffs → boiled eggs', 'Fried egg in a lot of oil → boiled, poached or a non-stick omelette', 'Sweet curd → plain curd with fruit'],
  },
  'veg-high-protein': {
    name: 'Vegetarian high-protein', icon: 'dumbbell',
    intro: 'For vegetarians toning with EMS: a protein food at every meal — dal, legumes, paneer, curd, soya, tofu — and a protein snack after each session.',
    plate: ['Protein first: paneer, tofu, soya chunks, curd, dal, kadala, cherupayar, rajma', 'Plenty of vegetables', 'Moderate carbs — matta rice, chapati, ragi or oats'],
    day: [
      ['sun', 'Breakfast', 'Moong dal chilla or besan dosa with curd, or oats cooked in milk with nuts.'],
      ['apple', 'Mid-morning', 'Thick curd or a glass of milk with a fruit.'],
      ['utensils', 'Lunch', '¾ cup matta rice, dal, a paneer or soya curry and thoran.'],
      ['zap', 'After your EMS session', 'Within an hour: sprouts chaat, roasted chana, or a paneer sandwich with buttermilk.'],
      ['soup', 'Dinner (by 8 pm)', 'Chapati with tofu or paneer bhurji and a vegetable, or a big bowl of dal with salad.'],
    ],
    swaps: ['Potato sabzi → paneer, soya or dal', 'Biscuits → roasted chana or makhana', 'Rice with only sambar → add curd or a legume side'],
  },
  vegan: {
    name: 'Plant-based (no dairy)', icon: 'leaf',
    intro: 'A fully plant-based plan with enough protein from legumes, soya and nuts. Ask about vitamin B12 — it is not found in plant foods.',
    plate: ['Half the plate: vegetables and greens', 'A quarter: legumes, tofu, soya chunks, peanuts', 'A quarter: matta rice, ragi, oats or chapati'],
    day: [
      ['sun', 'Breakfast', 'Puttu with kadala curry, or ragi dosa with peanut chutney and sambar.'],
      ['apple', 'Mid-morning', 'A fruit with a few almonds or walnuts.'],
      ['utensils', 'Lunch', '¾ cup matta rice, dal or rajma, soya or tofu curry, thoran.'],
      ['coffee', 'Evening', 'Sprouts, roasted chana or a small handful of peanuts with black tea.'],
      ['soup', 'Dinner (by 8 pm)', 'Chapati with chana or tofu masala and vegetables.'],
    ],
    swaps: ['Coconut milk curries → lighter, tomato- or dal-based', 'Packaged snacks → roasted legumes or fruit', 'Tea with milk → black tea, or a small amount of soya milk'],
  },
  'healthy-gain': {
    name: 'Healthy weight gain', icon: 'trending-up',
    intro: 'For clients who are underweight or building muscle: more meals, more protein and good fats — not junk food.',
    plate: ['Three meals and two to three snacks a day', 'Protein at every meal — eggs, fish, chicken, paneer, curd, dal', 'Generous carbs — rice, chapati, banana, oats — and nuts, seeds and ghee in small amounts'],
    day: [
      ['sun', 'Breakfast', 'Puttu with kadala and a banana, or 3 idli with sambar and 2 eggs. Milk or coffee.'],
      ['apple', 'Mid-morning', 'Banana or nendran banana with a handful of nuts, or a milkshake (no added sugar).'],
      ['utensils', 'Lunch', '1½ cups rice, fish or chicken curry, dal, thoran and curd.'],
      ['zap', 'After your EMS session', 'Within an hour: milk with banana, or curd rice with egg.'],
      ['soup', 'Dinner (by 8:30 pm)', '3 chapatis with paneer or chicken curry and vegetables. A glass of milk before bed.'],
    ],
    swaps: ['Skipping breakfast → never; eat within an hour of waking', 'Chips and bakery → nuts, banana, peanut chikki', 'Tea only → milk, buttermilk or a smoothie'],
  },
  'fat-loss-5': {
    name: 'Fat-loss 5-meal plan (Kerala)', icon: 'flame',
    intro: 'Five smaller meals a day keep hunger down while you eat a little less overall. Rice is kept, just smaller; protein comes at every meal so EMS keeps your muscle as fat comes off.',
    plate: ['Half the plate: vegetables — thoran, avial, cabbage or beans mezhukkupuratti, salad', 'A quarter: protein — fish curry, egg whites, chicken (not fried), kadala, cherupayar', 'A quarter: carbs — ¾ cup cooked matta rice or 2 small chapatis'],
    day: [
      ['sun', '7:30 · Breakfast', '2 idli or 1 dosa with sambar and 2 boiled egg whites, or oats upma with vegetables. Tea or coffee without sugar.'],
      ['apple', '10:30 · Mid-morning', 'Guava, papaya or orange, or a glass of sambharam.'],
      ['utensils', '1:00 · Lunch', '¾ cup matta rice, fish curry (not fried), a big thoran and a salad of cucumber and carrot.'],
      ['coffee', '4:30 · Evening', 'Black tea with sprouts salad or a small cup of roasted kadala.'],
      ['soup', '7:30 · Dinner', '2 chapatis or ragi dosa with chicken or egg curry and a vegetable side. Finish dinner by 8 pm.'],
    ],
    swaps: ['Fried fish → pollichathu or fish curry', 'Pazham pori, banana chips, bakery snacks → roasted kadala or a fruit', 'Sugar in tea → none (cut by half each week if needed)', 'Second helping of rice → more thoran or salad', 'Coconut oil: about 3 teaspoons a day in total'],
    grocery: ['Matta rice, wheat atta, ragi, oats', 'Eggs, fish (mathi, ayala, choora), chicken breast', 'Kadala, cherupayar, dal, sprouts', 'Cabbage, beans, carrot, beetroot, cucumber, drumstick, spinach', 'Guava, papaya, orange, apple', 'Curd / buttermilk, a small amount of coconut oil'],
    water: ['On waking: 1 glass', 'With each meal: 1 glass', 'Between meals: 1 glass every 1–2 hours', 'Before and after EMS: 1 glass each', 'Aim: about 10 glasses (2.5 L) a day, unless your doctor advises otherwise'],
  },
  'tone-5': {
    name: 'Muscle-toning 5-meal plan (Kerala)', icon: 'dumbbell',
    intro: 'For firming and toning with EMS: enough protein at every meal and steady carbohydrates around your sessions, so your muscles have what they need to respond.',
    plate: ['A third: protein — egg, fish, chicken, paneer, soya, kadala, curd', 'A third: vegetables', 'A third: carbs — matta rice, chapati, puttu, oats'],
    day: [
      ['sun', '7:30 · Breakfast', 'Puttu (small) with kadala curry and 2 boiled eggs, or 2 appam with egg curry.'],
      ['apple', '10:30 · Mid-morning', 'A banana with a handful of peanuts, or curd with fruit.'],
      ['utensils', '1:00 · Lunch', '1 cup matta rice, fish or chicken curry, dal and a thoran.'],
      ['coffee', '4:30 · Before / after EMS', 'Sprouts or a boiled egg with black coffee; after the session, a glass of milk or buttermilk.'],
      ['soup', '7:30 · Dinner', '2 chapatis with paneer, soya or chicken and vegetables.'],
    ],
    swaps: ['Biscuits with tea → boiled egg or nuts', 'Sweetened juice → whole fruit', 'Parotta → chapati or ragi dosa', 'Skipped breakfast → never on session days'],
    grocery: ['Eggs, fish, chicken, paneer, soya chunks', 'Kadala, cherupayar, dal, peanuts, roasted chana', 'Matta rice, wheat atta, puttu podi, oats', 'Bananas and seasonal fruit', 'Milk, curd, buttermilk', 'Vegetables for thoran and curry'],
    water: ['On waking: 1 glass', 'With each meal: 1 glass', '2 glasses in the hour before EMS and 2 after', 'Aim: about 10–12 glasses (2.5–3 L) a day, unless your doctor advises otherwise'],
  },
  'hormone-support': {
    name: 'PCOS & thyroid support meal guide', icon: 'heart-pulse',
    intro: 'A steady-sugar Kerala meal pattern that supports women with PCOS or thyroid-related weight gain. It works alongside — never instead of — your doctor\'s treatment and medicines.',
    plate: ['Half the plate: vegetables and greens (cooked well if you have thyroid issues)', 'A quarter: protein — fish, egg, chicken, dal, kadala, curd', 'A quarter: slow carbs — matta rice (¾ cup), ragi, oats, millets'],
    day: [
      ['sun', '7:30 · Breakfast', 'Ragi dosa or oats with an egg or dal; or 2 idli with sambar and a boiled egg. If you take thyroid tablets, keep the gap your doctor advised before eating.'],
      ['apple', '10:30 · Mid-morning', 'A guava, apple or orange with a few almonds.'],
      ['utensils', '1:00 · Lunch', '¾ cup matta rice or millet, fish curry, a green thoran and a salad.'],
      ['coffee', '4:30 · Evening', 'Sprouts or roasted chana with unsweetened tea.'],
      ['soup', '7:30 · Dinner', '2 chapatis or a millet roti with a protein curry and vegetables. Finish by 8 pm.'],
    ],
    swaps: ['White rice in large portions → ¾ cup matta rice or millets', 'Sweets and bakery items → fruit with a few nuts', 'Sugary drinks → buttermilk or water', 'Late-night snacking → herbal tea and an early dinner'],
    grocery: ['Matta rice, millets (ragi, varagu), oats', 'Fish, eggs, chicken, dal, kadala, cherupayar', 'Leafy greens, beans, carrot, cucumber, bottle gourd', 'Guava, apple, orange, berries when available', 'Almonds, walnuts, flax seeds', 'Curd, buttermilk'],
    water: ['On waking: 1 glass (after your thyroid tablet, if you take one)', 'With each meal: 1 glass', 'Between meals: 1 glass every 1–2 hours', 'Aim: about 10 glasses (2.5 L) a day, unless your doctor advises otherwise'],
  },
};
export const DIET_NOTE = 'General lifestyle guidance from the Hasta team, not a medical diet. If you have a medical condition, are pregnant or take regular medicines, follow your doctor\'s advice first.';

export function dietView(key, t) {
  const d = DIETS[key] || DIETS['kerala-balanced'];
  const tg = t && t.kcal ? `<div class="targets"><h4 style="margin-bottom:8px">Your daily targets</h4><div class="tgrid">${[['Energy', t.kcal.toLocaleString('en-IN'), 'kcal'], ['Protein', t.protein, 'g'], ['Carbs', t.carbs, 'g'], ['Fat', t.fat, 'g'], ['Fibre', t.fibre, 'g']].map(([l, v, u]) => `<div><span>${l}</span><b>${v}<small> ${u}</small></b></div>`).join('')}</div>
    <p class="small muted" style="margin-top:6px">About ${t.protein_per_meal} g protein at each of 4 meals${t.protein_per_meal ? ` — e.g. 2 eggs ≈ 12 g, a fish piece (100 g) ≈ 20 g, 1 cup dal ≈ 9 g, 100 g paneer ≈ 18 g, 1 cup curd ≈ 8 g` : ''}.</p></div>` : '';
  return `<div class="stack" style="gap:14px">
    <div><h3>${esc(d.name)}</h3><p class="muted" style="margin-top:4px">${esc(d.intro)}</p></div>${tg}
    <div><h4 style="margin-bottom:8px">Build your plate</h4><ul class="dots">${d.plate.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>
    <div><h4 style="margin-bottom:4px">A day on this plan</h4>${d.day.map(([ic, t, x]) => `<div class="meal"><span class="hic">${icon(ic, 18)}</span><div><b>${esc(t)}</b><p>${esc(x)}</p></div></div>`).join('')}</div>
    <div><h4 style="margin-bottom:8px">Easy swaps</h4><ul class="dots">${d.swaps.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>
    ${d.water ? `<div><h4 style="margin-bottom:8px">Water schedule</h4><ul class="dots">${d.water.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}
    ${d.grocery ? `<div><h4 style="margin-bottom:8px">Grocery list</h4><ul class="dots">${d.grocery.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}
    <p class="note">${esc(DIET_NOTE)}</p></div>`;
}

export const SCREENING = [
  ['pacemaker', 'Pacemaker or implanted electronic device'], ['pregnancy', 'Pregnant or could be pregnant'], ['epilepsy', 'Epilepsy or seizures'],
  ['heart', 'Heart condition or circulation problems'], ['surgery', 'Surgery in the last 6 months'], ['implants', 'Metal implants or pins'],
  ['cancer', 'Cancer or current treatment'], ['diabetes', 'Diabetes'], ['bp', 'High or low blood pressure'], ['skin', 'Skin wounds or rashes where pads go'],
];

/* ---------- Admission helpers ---------- */
export const PROGRAMME_LABEL = { ems: 'EMS programme', weight: 'Weight management', combined: 'EMS + weight management' };
export const ADM_LABEL = { screening: 'Screening', assessment: 'Clinician assessment', client_consent: 'Awaiting client signature', admitted: 'Admitted', not_suitable: 'Not suitable', withdrawn: 'Withdrawn', expired: 'Admission expired' };
export function admState(a) { if (!a) return 'none'; if (a.status === 'admitted' && (a.expired || (a.valid_until && a.valid_until < today()))) return 'expired'; return a.status; }
export function admPill(a) {
  const s = admState(a);
  if (s === 'none') return pill('alert', 'Admission not started');
  if (s === 'admitted') return pill('good', 'Admitted to ' + fDay(a.valid_until));
  if (['not_suitable', 'withdrawn', 'expired'].includes(s)) return pill('alert', ADM_LABEL[s]);
  return pill('warn', 'Admission: ' + ADM_LABEL[s].toLowerCase());
}
export function admSteps(a) {
  const s = admState(a);
  const order = ['screening', 'assessment', 'client_consent', 'admitted'];
  const idx = order.indexOf(s);
  const labels = ['Health screening', 'Clinician assessment', 'Client consent', 'Admitted'];
  return `<ol class="steps">${labels.map((l, i) => { const st = s === 'admitted' || idx > i ? 'done' : idx === i ? 'now' : ''; return `<li class="${st}"><span>${st === 'done' ? icon('check', 14) : i + 1}</span>${esc(l)}</li>`; }).join('')}</ol>`;
}
export function letterBox(title, text, foot) {
  return `<div class="letter"><h4>${esc(title)}</h4>${String(text || '').split('\n').filter(Boolean).map(p => `<p>${esc(p)}</p>`).join('')}${foot ? `<p class="sig">${foot}</p>` : ''}</div>`;
}
export function yesNo(name, value) {
  return `<span class="yn" role="radiogroup"><label><input type="radio" name="${name}" value="yes"${value === true ? ' checked' : ''}><span>Yes</span></label><label><input type="radio" name="${name}" value="no"${value === false ? ' checked' : ''}><span>No</span></label></span>`;
}
export function screeningForm(questions, s = null) {
  const ans = (s && s.answers) || {};
  return `<div class="qs">${questions.map(([k, q]) => `<div class="q"><p>${esc(q)}</p>${yesNo('q_' + k, ans[k])}</div>`).join('')}</div>
    ${field('Medicines you take regularly', inp('medicines', s && s.medicines, 'maxlength="300" placeholder="Name and what for, or None"'))}
    ${field('Anything else the clinician should know', `<textarea class="in" name="other" maxlength="500" placeholder="Allergies, recent illness, injuries, past reactions…">${esc((s && s.other) || '')}</textarea>`)}`;
}
export function readScreening(form, questions) {
  const answers = {};
  for (const [k] of questions) { const r = form.querySelector(`[name="q_${k}"]:checked`); answers[k] = r ? r.value === 'yes' : null; }
  return { answers, medicines: form.medicines.value.trim(), other: form.other.value.trim() };
}
export function sigPad(el) {
  el.innerHTML = `<div class="sigpad"><canvas aria-label="Signature area — sign with your finger or mouse"></canvas><span class="hint">Sign here</span><button type="button" class="btn sm quiet" data-clear>Clear</button></div>`;
  const cv = el.querySelector('canvas'), hint = el.querySelector('.hint');
  const ctx = cv.getContext('2d');
  let drawing = false, dirty = false, last = null;
  const size = () => { const r = cv.getBoundingClientRect(); cv.width = Math.round(r.width); cv.height = Math.round(r.height); ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1d3437'; };
  requestAnimationFrame(size);
  const pt = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); drawing = true; last = pt(e); hint.hidden = true; });
  cv.addEventListener('pointermove', e => { if (!drawing) return; const p = pt(e); ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke(); last = p; dirty = true; });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => cv.addEventListener(t, () => { drawing = false; }));
  el.querySelector('[data-clear]').addEventListener('click', () => { ctx.clearRect(0, 0, cv.width, cv.height); dirty = false; hint.hidden = false; });
  return { value: () => dirty ? cv.toDataURL('image/png') : null };
}

export const unitLabel = (units, id) => { const u = (units || []).find(x => x.id === id); return u ? u.name : ''; };

/* ---------- Programme journey, progress photos and progress card (shared by staff and client) ---------- */
export function journeyPanel(j) {
  if (!j) return '';
  const pct = Math.round(Math.min(1, (j.day - 1) / (j.weeks * 7)) * 100);
  return `<section class="panel journey"><div class="panel-h"><div class="t">${icon('flag', 20)}<h3>${esc(j.name)}</h3></div><span class="small muted">Week ${j.week} of ${j.weeks}</span></div>
    <p class="muted" style="margin:0 0 10px">${esc(j.tagline)}</p>
    <div class="bar" style="margin-bottom:8px"><i style="width:${pct}%"></i></div>
    <div class="jchecks">${j.checkpoints.map(c => `<span class="${c.date <= today() ? 'done' : ''}">${icon(c.date <= today() ? 'check-circle' : 'clipboard-check', 15)}${c.week === 0 ? 'Start' : 'Week ' + c.week} assessment · ${esc(fDate(c.date))}</span>`).join('')}</div>
    ${j.next_check ? `<p class="small" style="margin:10px 0 0"><b>Next body-composition check:</b> ${esc(fDate(j.next_check))}</p>` : ''}
    <ul class="dots" style="margin-top:10px">${j.focus.map(f => `<li>${esc(f)}</li>`).join('')}</ul></section>`;
}

// base: '/staff/clients/<id>' or '/client'
export function photoPanel(photos, base, opts = {}) {
  const POSE = { front: 'Front', side: 'Side', back: 'Back' };
  const byDate = {};
  for (const p of photos) (byDate[p.taken_on] ||= []).push(p);
  const dates = Object.keys(byDate).sort();
  const firstD = dates[0], lastD = dates[dates.length - 1];
  const img = p => `<figure class="ph"><img loading="lazy" src="${BASE}/api${base}/photos/${p.id}" alt="${esc(POSE[p.pose])} photo, ${esc(fDate(p.taken_on))}"><figcaption>${esc(POSE[p.pose])}${opts.canDelete ? ` <button type="button" class="linkish" data-phdel="${p.id}">Remove</button>` : ''}</figcaption></figure>`;
  const compare = dates.length > 1 ? `<div class="phcmp">${['front', 'side', 'back'].map(pose => {
      const a = byDate[firstD].find(p => p.pose === pose), b = byDate[lastD].find(p => p.pose === pose);
      return a && b ? `<div><h4>${POSE[pose]}</h4><div class="pair">${img(a)}${img(b)}</div><p class="small muted">${esc(fDate(firstD))} → ${esc(fDate(lastD))}</p></div>` : '';
    }).join('')}</div>` : '';
  return `<section class="panel"><div class="panel-h"><div class="t">${icon('camera', 20)}<h3>Progress photos</h3></div>
      <div class="acts"><button class="btn sm ghost" data-phadd>${icon('plus', 16)}Add photo</button></div></div>
    <p class="small muted" style="margin-top:0">Private: seen only by ${opts.client ? 'you and your coach and clinician' : 'the client, their coach and clinician'}. Same pose, same place and light each time.</p>
    ${photos.length ? (compare ? `<h4 style="margin:6px 0">Before and now</h4>${compare}` : '') + `<details${compare ? '' : ' open'}><summary class="small">All photos (${photos.length})</summary>${dates.slice().reverse().map(d => `<div class="phday"><b class="small">${esc(fDate(d))}</b><div class="phrow">${byDate[d].map(img).join('')}</div></div>`).join('')}</details>` : `<p class="muted">No photos yet. Take front, side and back photos at the start and at each assessment.</p>`}
    ${opts.consent !== undefined ? `<label class="check" style="margin-top:12px"><input type="checkbox" data-phconsent ${opts.consent ? 'checked' : ''}> ${opts.client ? 'I allow Hasta Wellness to use my before-and-after photos in its marketing, with my face hidden and without my name. I can withdraw this at any time.' : 'Client has given consent to use before-and-after photos in marketing (face hidden, no name). Only tick this with the client\'s signed or in-app consent.'}</label>` : ''}
  </section>`;
}

export function wirePhotoPanel(root, base, after) {
  const add = root.querySelector('[data-phadd]');
  if (add) add.addEventListener('click', () => modal({
    title: 'Add a progress photo',
    body: `<form data-f class="stack">${field('Pose', sel('pose', [['front', 'Front'], ['side', 'Side'], ['back', 'Back']]))}${field('Date taken', inp('taken_on', today(), 'type="date"'))}
      <input type="file" name="photo" accept="image/jpeg,image/png,image/webp" capture="environment"><p class="small muted">JPG, PNG or WebP, up to 6 MB. Plain background, fitted clothing, arms slightly away from the body.</p></form>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>${icon('upload', 18)}Upload</button>`,
    onMount(el, close) {
      const b = el.querySelector('[data-save]'), f = el.querySelector('[data-f]');
      b.addEventListener('click', () => {
        if (!f.photo.files[0]) return toast('Choose a photo.', true);
        const fd = new FormData(f);
        busy(b, async () => {
          const res = await fetch(BASE + '/api' + base + '/photos', { method: 'POST', body: fd, credentials: 'same-origin' });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.ok) throw new Error(data.error || 'Upload failed.');
        }).then(() => { close(); toast('Photo saved'); after(); }).catch(() => {});
      });
    },
  }));
  root.querySelectorAll('[data-phdel]').forEach(b => b.addEventListener('click', () => {
    if (!confirm('Remove this photo permanently?')) return;
    api(`${base}/photos/${b.dataset.phdel}`, { method: 'DELETE' }).then(() => { toast('Photo removed'); after(); }).catch(e => toast(e.message, true));
  }));
  const cb = root.querySelector('[data-phconsent]');
  if (cb) cb.addEventListener('change', () => api(`${base}/photo-consent`, { method: 'PUT', body: { on: cb.checked } }).then(() => toast(cb.checked ? 'Consent recorded' : 'Consent withdrawn')).catch(e => { cb.checked = !cb.checked; toast(e.message, true); }));
}

export function progressCardLinks(base) {
  return `<div class="acts" style="display:flex;gap:8px;flex-wrap:wrap">${[30, 60, 90].map(n => `<a class="btn sm ghost" href="${BASE}/api${base}/progress-card?days=${n}" target="_blank" rel="noopener">${icon('download', 16)}${n}-day progress card</a>`).join('')}</div>`;
}
