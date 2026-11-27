// Outreach booth: campaigns, the 3-minute body check at the booth, the visitor's results screen, and follow-up.
import { api, esc, icon, toast, modal, formData, busy, field, inp, sel, emptyState, today, addDays, dayDiff, fDay, fDate, fWhen, initials, first, prettyPhone, wa, pill, CLINIC_PHONE } from './core.js?v=14';
import { ACTIVITY, AIMS } from './body.js?v=1';

const HEAT = { hot: ['Hot', 'Wants a trial / consultation now'], warm: ['Warm', 'Interested later, or readings give a reason to follow up'], cold: ['Cold', 'Not interested now'] };
const heatPill = h => h ? `<span class="pill heat-${h}">${HEAT[h][0]}</span>` : '';
const ADDRESS = 'Hasta Wellness, 1st floor, Anjali Arcade, near Nippon Toyota, Technopark Phase 3, Kazhakkoottam';
const INTEREST = [['now', 'Yes — book a trial / consultation'], ['later', 'Maybe later'], ['no', 'Not now']];
const ENERGY = [[1, 'Drained'], [2, 'Low'], [3, 'OK'], [4, 'Good'], [5, 'Great']];
const lsGet = k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const n0 = v => Math.round(v || 0).toLocaleString('en-IN');

let CONCERNS = {};

export async function viewBooth(MAIN, ctx, parts, q) {
  if (parts[1]) return q.get('tab') === 'visitors' ? viewVisitors(MAIN, ctx, +parts[1], q) : viewCheck(MAIN, ctx, +parts[1]);
  const { campaigns, concerns } = await api('/staff/campaigns');
  CONCERNS = concerns;
  MAIN.innerHTML = `
    <div class="head"><div><h1>Outreach booth</h1><p>Campaign days (e.g. Technopark): measure visitors, show them their numbers, and turn them into leads with follow-up.</p></div>
      <div class="acts"><button class="btn gold" data-new>${icon('plus', 18)}New campaign</button></div></div>
    ${campaigns.length ? `<div class="booth-cards">${campaigns.map(c => card(c)).join('')}</div>` : `<section class="panel">${emptyState('flag', 'No campaigns yet. Create one for the booth day — name, place, date and the offer for visitors.')}</section>`}
    <p class="small muted" style="margin-top:12px">Readings of visitors who did not give consent are kept without name or number, only to count the day. Leads and their readings are removed after 90 days unless the person becomes a client — their booth reading then becomes their first measurement.</p>`;
  MAIN.querySelector('[data-new]').addEventListener('click', () => campaignModal(null, ctx));
  MAIN.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => campaignModal(campaigns.find(c => c.id === +b.dataset.edit), ctx)));
  MAIN.querySelectorAll('[data-close-c]').forEach(b => b.addEventListener('click', () => busy(b, () => api('/staff/campaigns/' + b.dataset.closeC, { method: 'PUT', body: { active: b.dataset.v === '1' } })).then(() => ctx.reload()).catch(() => {})));
}

function card(c) {
  const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '—';
  const live = c.active && today() >= c.start_day && today() <= (c.end_day || c.start_day);
  return `<section class="panel booth-card${c.active ? '' : ' muted-card'}">
    <div class="panel-h"><div class="t">${icon('flag', 20)}<div><h3>${esc(c.name)}</h3><p class="small muted">${esc(c.place || '')}${c.place ? ' · ' : ''}${esc(fDate(c.start_day))}${c.end_day && c.end_day !== c.start_day ? ' – ' + esc(fDate(c.end_day)) : ''}</p></div></div>
      ${live ? pill('good', 'Live today') : c.active ? '' : pill('closed', 'Closed')}</div>
    <div class="funnel">${[['Body checks', c.checks], ['Leads (consent)', c.leads, pct(c.leads, c.checks)], ['Hot', c.hot], ['Warm', c.warm], ['Booked', c.booked, pct(c.booked, c.leads)], ['Clients', c.clients, pct(c.clients, c.leads)]]
      .map(([l, v, s]) => `<div><b>${v || 0}</b><span>${l}</span>${s ? `<small>${s}</small>` : ''}</div>`).join('')}</div>
    ${c.offer ? `<p class="small" style="margin:10px 0 0">${icon('star', 14)} Offer: ${esc(c.offer)} <span class="faint">(${c.offer_days} days)</span></p>` : ''}
    <div class="booth-acts">${c.active ? `<a class="btn" href="#/booth/${c.id}">${icon('activity', 18)}Open booth</a>` : ''}
      <a class="btn ghost" href="#/booth/${c.id}?tab=visitors">${icon('users', 18)}Visitors & follow-up</a>
      <button class="btn quiet sm" data-edit="${c.id}">${icon('pencil', 16)}Edit</button>
      <button class="btn quiet sm" data-close-c="${c.id}" data-v="${c.active ? 0 : 1}">${c.active ? 'Close campaign' : 'Reopen'}</button></div>
  </section>`;
}

function campaignModal(c, ctx) {
  const d = c || { name: 'Technopark body check day', place: 'Technopark, Kazhakkoottam', start_day: today(), end_day: '', offer: 'Free EMS trial session and a full body-composition review with our doctor', offer_days: 14 };
  const { el, close } = modal({
    title: c ? 'Edit campaign' : 'New campaign',
    body: `<form class="grid2" data-f>
      ${field('Name', inp('name', d.name, 'required maxlength="80"'))}${field('Place', inp('place', d.place, 'maxlength="120"'))}
      ${field('First day', inp('start_day', d.start_day, 'type="date" required'))}${field('Last day', inp('end_day', d.end_day || '', 'type="date"'), 'leave empty for one day')}
      <div style="grid-column:1/-1">${field('Offer for visitors', `<textarea class="in" name="offer" rows="2" maxlength="300">${esc(d.offer || '')}</textarea>`, 'goes in the WhatsApp report — no prices online')}</div>
      ${field('Offer valid for (days)', inp('offer_days', d.offer_days, 'type="number" min="1" max="60"'))}
      ${ctx.units.length > 1 ? field('Unit', sel('unit_id', [['', 'Choose…'], ...ctx.units.map(u => [u.id, u.name])], d.unit_id || '')) : ''}
    </form>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>${c ? 'Save' : 'Create campaign'}</button>`,
  });
  el.querySelector('[data-save]').addEventListener('click', e => {
    const b = formData(el.querySelector('[data-f]'));
    if (!b.unit_id && ctx.units.length === 1) b.unit_id = ctx.units[0].id;
    busy(e.currentTarget, () => api('/staff/campaigns' + (c ? '/' + c.id : ''), { method: c ? 'PUT' : 'POST', body: b })).then(() => { close(); toast(c ? 'Campaign saved' : 'Campaign created'); ctx.reload(); }).catch(() => {});
  });
}

/* ---------- Booth check ---------- */

async function viewCheck(MAIN, ctx, id) {
  const { campaign: c, visitors } = await api('/staff/campaigns/' + id);
  if (!Object.keys(CONCERNS).length) CONCERNS = (await api('/staff/campaigns')).concerns;
  const todays = visitors.filter(v => (v.created_at || '').slice(0, 10) === new Date().toISOString().slice(0, 10));
  const chips = (name, opts, type = 'radio', val) => `<div class="chips">${opts.map(([v, l]) => `<label class="chip"><input type="${type}" name="${name}" value="${esc(v)}"${String(v) === String(val) ? ' checked' : ''}>${esc(l)}</label>`).join('')}</div>`;
  MAIN.innerHTML = `
    <a href="#/booth" class="crumb">${icon('arrow-left', 16)}Outreach booth</a>
    <div class="head"><div><h1>${esc(c.name)}</h1><p>${esc(c.place || '')} — body check in about 3 minutes. Today: <b>${todays.length}</b> checks · <b>${todays.filter(v => v.lead_id).length}</b> leads · <b>${todays.filter(v => v.heat === 'hot' && v.lead_id).length}</b> hot.</p></div>
      <div class="acts"><a class="btn ghost" href="#/booth/${c.id}?tab=visitors">${icon('users', 18)}Visitors</a></div></div>
    <form data-f class="booth-form" autocomplete="off">
      <section class="panel"><div class="panel-h"><div class="t"><span class="stepno">1</span><h3>About the visitor</h3></div></div>
        <div class="grid2">${field('Name', inp('name', '', 'maxlength="80"'))}${field('Mobile', inp('phone', '', 'type="tel" inputmode="tel"'))}</div>
        <div class="grid3">${field('Sex', sel('gender', [['', 'Choose…'], ['female', 'Female'], ['male', 'Male']], ''))}${field('Age', inp('age', '', 'type="number" inputmode="numeric" min="16" max="90"'))}${field('Height (cm)', inp('height_cm', '', 'type="number" inputmode="decimal" step="0.5" min="120" max="220" placeholder="5′6″ = 168"'))}</div>
        ${field('Daily activity', chips('activity', Object.entries(ACTIVITY).map(([k, [l]]) => [k, l]), 'radio', 'sedentary'))}
        ${field('What would they like to change?', chips('concerns', Object.entries(CONCERNS), 'checkbox'), 'tick all that apply')}
        <div class="grid2">${field('Sleep most nights (hours)', inp('sleep_hours', '', 'type="number" inputmode="decimal" step="0.5" min="2" max="14"'))}${field('Energy in the afternoon', chips('energy', ENERGY, 'radio', ''))}</div>
      </section>
      <section class="panel"><div class="panel-h"><div class="t"><span class="stepno">2</span><h3>Readings from the analyser</h3></div></div>
        <div class="grid3">${field('Weight (kg)', inp('weight', '', 'type="number" inputmode="decimal" step="0.1" min="30" max="250"'))}${field('Body fat (%)', inp('body_fat', '', 'type="number" inputmode="decimal" step="0.1" min="3" max="70"'))}${field('Muscle mass (kg)', inp('muscle_mass', '', 'type="number" inputmode="decimal" step="0.1"'))}
          ${field('Visceral fat level', inp('visceral_fat', '', 'type="number" inputmode="decimal" step="0.5" min="1" max="59"'))}${field('Body water (%)', inp('water_pct', '', 'type="number" inputmode="decimal" step="0.1"'))}${field('Metabolic age', inp('metabolic_age', '', 'type="number" inputmode="numeric"'))}
          ${field('BMR on analyser (kcal)', inp('bmr', '', 'type="number" inputmode="numeric"'), 'optional')}${field('Waist (cm)', inp('waist', '', 'type="number" inputmode="decimal" step="0.5"'), 'optional, at the navel')}${field('Analyser', inp('device', lsGet('booth_device'), 'maxlength="60" placeholder="e.g. Omron HBF-375"'))}</div>
        <p class="small muted">Only weight is required — the app estimates body fat and BMR from sex, age, height and weight if the analyser has no reading. Do not use the analyser for anyone with a pacemaker or other implant, or who is pregnant: weight and tape only.</p>
      </section>
      <section class="panel"><div class="panel-h"><div class="t"><span class="stepno">3</span><h3>Next step and consent</h3></div></div>
        ${field('Would they like a free trial / consultation?', chips('interest', INTEREST, 'radio', 'later'))}
        ${field('Best time to call', inp('best_time', '', 'maxlength="60" placeholder="e.g. after 6 pm, weekends"'))}
        <label class="consent"><input type="checkbox" name="consent"> <span><b>The visitor agrees</b> to Hasta Wellness keeping their name, mobile and these readings, and contacting them by phone or WhatsApp about this check and the offer. They can ask us to delete it at any time. <span class="muted">Untick to show the results without saving who they are.</span></span></label>
      </section>
      <div class="booth-go"><button class="btn gold lg" type="submit">${icon('sparkles', 20)}Show results</button></div>
    </form>`;
  const form = MAIN.querySelector('[data-f]');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const b = formData(form);
    b.concerns = [...form.querySelectorAll('[name=concerns]:checked')].map(x => x.value);
    b.campaign_id = c.id;
    if (b.device) lsSet('booth_device', b.device);
    const btn = form.querySelector('[type=submit]');
    busy(btn, () => api('/staff/booth', { method: 'POST', body: b })).then(r => results(MAIN, ctx, c, b, r)).catch(() => {});
  });
}

// What the visitor sees.
function results(MAIN, ctx, c, b, r) {
  const { comp, nt } = r;
  const tone = t => t === 'good' ? 'good' : t === 'warn' ? 'warn' : 'neutral';
  const tiles = [];
  if (comp.ratios.bmi) tiles.push(['BMI', comp.ratios.bmi.value, '', comp.ratios.bmi.label, comp.ratios.bmi.tone, 'Indian cut-offs: healthy 18.5–22.9']);
  if (comp.bf) tiles.push(['Body fat', comp.bf.value, '%', comp.bf.band ? comp.bf.band.label : '', comp.bf.band && comp.bf.band.tone, comp.bf.source]);
  if (comp.visceral) tiles.push(['Visceral fat', comp.visceral.value, '', comp.visceral.label, comp.visceral.tone, 'fat around the organs']);
  if (comp.mass) tiles.push(['Lean mass', comp.mass.lean, 'kg', `Fat mass ${comp.mass.fat} kg`, 'neutral', comp.mass.muscle ? `Muscle ${comp.mass.muscle} kg (analyser)` : 'everything that isn\'t fat']);
  if (comp.bmr) tiles.push(['BMR', n0(comp.bmr.value), 'kcal', 'burned at complete rest', 'neutral', comp.bmr.source]);
  if (nt) tiles.push(['Daily energy', n0(nt.tdee), 'kcal', 'with your usual activity', 'neutral', ACTIVITY[nt.activity][0]]);
  const notes = insights(comp, nt, b);
  const name = first(b.name) || 'Your';
  MAIN.innerHTML = `
    <div class="result-head"><img src="/img/hasta-emblem.webp" alt="" width="40" height="40"><div><span class="faint small">HASTA EMS PROGRESS STUDIO · BODY CHECK</span><h1>${b.name ? esc(name) + '\'s numbers' : 'Your numbers'}</h1></div>${r.lead_id ? heatPill(r.heat) : ''}</div>
    <div class="result-tiles">${tiles.map(([l, v, u, s, t, f]) => `<div class="rt ${tone(t)}"><span class="l">${esc(l)}</span><span class="v">${esc(v)}<small>${esc(u)}</small></span><span class="s">${esc(s)}</span><span class="f">${esc(f)}</span></div>`).join('')}</div>
    ${nt ? `<section class="panel target"><div><span class="l">${icon('utensils', 18)}Suggested daily food target — ${esc(AIMS[nt.aim])}</span><b>${n0(nt.kcal)} kcal</b><span>protein ${nt.protein} g · about ${nt.protein_per_meal} g a meal · ${nt.water_glasses} glasses of water</span>${nt.note ? `<span class="small">${esc(nt.note)}</span>` : ''}</div></section>` : ''}
    ${notes.length ? `<section class="panel"><div class="ins-list">${notes.map(([t, ic, x]) => `<div class="ins ${t}">${icon(ic, 18)}<span>${esc(x)}</span></div>`).join('')}</div></section>` : ''}
    <section class="panel ems-why">${icon('zap', 22)}<div><b>How the Progress Studio helps</b><p>20-minute EMS sessions, supervised by a coach, work the major muscle groups at once — alongside a food plan built from these numbers and a body check every few weeks so you can see the change.</p></div></section>
    <p class="small muted">These are screening estimates from a body-composition scale and standard formulas — not a medical diagnosis. ${esc(ADDRESS)} · ${esc(CLINIC_PHONE)}</p>
    <div class="booth-go">${r.lead_id ? `<a class="btn wa" data-wa href="${esc(wa(b.phone, reportText(c, b, r)))}" target="_blank" rel="noopener">${icon('message-circle', 18)}Send report on WhatsApp</a>
      <button class="btn" data-book>${icon('calendar-plus', 18)}Book consultation / trial</button>` : '<span class="small muted">Not saved — no consent given.</span>'}
      <button class="btn gold" data-next>${icon('user-plus', 18)}Next visitor</button></div>
    ${r.reused ? '<p class="small muted">This mobile already had a recent enquiry — the check was added to that lead.</p>' : ''}`;
  MAIN.querySelector('[data-next]').addEventListener('click', () => ctx.reload());
  MAIN.querySelector('[data-wa]')?.addEventListener('click', () => {
    api('/staff/booth/' + r.id, { method: 'PUT', body: { wa_sent: true } }).catch(() => {});
    api('/staff/reminders/log', { method: 'POST', body: { kind: 'booth', ref: `${r.id}:d0`, lead_id: r.lead_id } }).catch(() => {});
  });
  MAIN.querySelector('[data-book]')?.addEventListener('click', () => ctx.bookModal({ lead: { id: r.lead_id, name: b.name, phone: b.phone }, kind: 'consultation', after: () => toast('Booked — the lead is marked as booked') }));
  window.scrollTo(0, 0);
}

function insights(comp, nt, b) {
  const out = [];
  const age = +b.age, met = +b.metabolic_age;
  if (met && age && met > age + 2) out.push(['warn', 'activity', `Metabolic age ${met}: your body is working like someone ${met - age} years older. Building muscle and moving more brings this down.`]);
  else if (met && age && met < age - 2) out.push(['good', 'activity', `Metabolic age ${met} — younger than your age. Keep it up.`]);
  if (comp.ratios.ffmi && comp.ratios.ffmi.value < (comp.sex === 'male' ? 17 : 14)) out.push(['warn', 'dumbbell', 'Lean (muscle) mass is on the low side for your height. More muscle raises the calories you burn at rest.']);
  if (comp.bf && comp.bf.band && comp.bf.band.label === 'High') out.push(['warn', 'flame', `Body fat ${comp.bf.value}% is in the high range. Losing fat while keeping muscle is the aim — not just a lower number on the scale.`]);
  if (comp.visceral && comp.visceral.tone === 'warn') out.push(['warn', 'heart-pulse', 'Visceral fat is high. This is the fat around the organs linked to blood sugar and blood pressure — worth a talk with our doctor.']);
  const sl = +b.sleep_hours;
  if (sl && sl < 7) out.push(['warn', 'moon', `About ${sl} hours of sleep. Under 7 hours makes hunger and cravings harder to control and the afternoon slump worse.`]);
  if (b.energy && +b.energy <= 2) out.push(['warn', 'battery-low', 'Low afternoon energy: protein at breakfast and lunch, water, and a short walk after lunch usually help.']);
  if (b.activity === 'sedentary') out.push(['neutral', 'clock', 'Mostly sitting: standing or walking for 5 minutes every hour adds up across a working day.']);
  if (!out.length) out.push(['good', 'check-circle', 'Your numbers are in a good range. A check every few months keeps it that way.']);
  return out.slice(0, 4);
}

function reportText(c, b, r) {
  const { comp, nt } = r, n = first(b.name) || 'there';
  const lines = [`Hi ${n}, thank you for visiting the Hasta EMS Progress Studio at ${c.place || c.name} today. Your body check:`];
  if (comp.weight) lines.push(`• Weight ${comp.weight} kg${comp.ratios.bmi ? ` · BMI ${comp.ratios.bmi.value} (${comp.ratios.bmi.label.toLowerCase()})` : ''}`);
  if (comp.bf) lines.push(`• Body fat ${comp.bf.value}%${comp.bf.band ? ` (${comp.bf.band.label.toLowerCase()})` : ''}${comp.visceral ? ` · visceral fat ${comp.visceral.value}` : ''}`);
  if (comp.bmr && nt) lines.push(`• You burn about ${n0(comp.bmr.value)} kcal a day at rest (BMR) and about ${n0(nt.tdee)} kcal with your usual activity`);
  if (nt) lines.push(`• Suggested target (${AIMS[nt.aim].toLowerCase()}): about ${n0(nt.kcal)} kcal a day with ${nt.protein} g protein`);
  if (c.offer) lines.push('', `Your booth offer: ${c.offer} — valid until ${fDate(addDays(today(), c.offer_days || 14))}.`);
  lines.push('', `Reply here with a day and time to book, or call ${CLINIC_PHONE}.`, ADDRESS, '', 'These are screening estimates, not a medical diagnosis.');
  return lines.join('\n');
}

/* ---------- Visitors and follow-up ---------- */

const STEPS = [
  ['d0', 0, 'Send body-check report', 'whatsapp'],
  ['d1', 1, 'Call to book', 'call'],
  ['d3', 3, 'Send a tip + trial invite', 'whatsapp'],
  ['d7', 7, 'Offer reminder', 'whatsapp'],
  ['d14', 14, 'Last message', 'whatsapp'],
];
function nextStep(v) {
  if (!v.lead_id) return null;
  if (v.client_id) return { done: 'Client' };
  if (v.booked_at) return { done: v.attended ? 'Attended' : 'Booked ' + fWhen(v.booked_at) };
  if (v.lead_status === 'not interested') return { done: 'Not interested' };
  const done = new Set(String(v.done_refs || '').split(',').map(x => x.split(':')[1]).filter(Boolean));
  if (v.wa_sent) done.add('d0');
  const age = dayDiff((v.created_at || '').slice(0, 10), today());
  const steps = STEPS.filter(([k]) => !(k === 'd1' && v.heat === 'cold'));
  const s = steps.find(([k]) => !done.has(k));
  if (!s) return { done: 'Sequence finished' };
  return { key: s[0], label: s[2], how: s[3], due: addDays((v.created_at || '').slice(0, 10), s[1]), overdue: age > s[1], today: age === s[1] };
}

const TIPS = {
  energy: 'Afternoon slump? Have protein at breakfast (eggs, sprouts, curd), keep lunch rice to one cup, and walk 10 minutes after lunch.',
  sleep: 'For better sleep: no screens 30 minutes before bed, caffeine before 3 pm only, and the same wake-up time every day — even weekends.',
  belly: 'Belly fat responds to fewer sugary drinks and refined carbs, protein at every meal, and building muscle — not crunches alone.',
  weight: 'Steady fat loss beats crash diets: eat about the target we gave you, add protein to each meal, and aim for 7,000+ steps.',
  diet: 'Easy swap at the food court: half rice, double sabzi or fish curry, skip the fried side, and buttermilk instead of soft drinks.',
  back: 'Desk back pain: stand up every 45 minutes, keep the screen at eye level, and strengthen your core — EMS works the deep back and core muscles.',
  tone: 'To tone up, you need muscle, not just weight loss — protein at every meal and resistance training two or three times a week.',
  stress: 'Stress raises cravings. Five minutes of slow breathing, a short walk outside and a regular bedtime make a real difference.',
};
function stepText(step, v, c) {
  const n = first(v.name) || 'there', until = fDate(addDays((v.created_at || '').slice(0, 10), c.offer_days || 14));
  const top = (v.concerns || []).find(k => TIPS[k]) || 'weight';
  if (step === 'd3') return `Hi ${n}, Hasta Wellness here — a quick tip after your body check: ${TIPS[top]}\n\nWould you like to feel what a 20-minute EMS session is like? ${c.offer ? 'Your booth offer is still open. ' : ''}Reply with a day and time that suits you.`;
  if (step === 'd7') return `Hi ${n}, a reminder that your Hasta booth offer${c.offer ? ` (${c.offer})` : ''} ends on ${until}. Shall we book your slot this week? We're open till 8:30 pm on weekdays — handy after work. ${CLINIC_PHONE}`;
  if (step === 'd14') return `Hi ${n}, this is our last message about your body check. Whenever you're ready to start, reply here or call ${CLINIC_PHONE} — we'll repeat your body check free so you can see where you stand. Take care!`;
  return `Hi ${n}, thank you for visiting the Hasta EMS Progress Studio. When would be a good time to talk about your results?`;
}

async function viewVisitors(MAIN, ctx, id, q) {
  const { campaign: c, visitors } = await api('/staff/campaigns/' + id);
  const anon = visitors.filter(v => !v.lead_id).length;
  const heat = q.get('heat') || 'all', show = q.get('show') || 'todo';
  let list = visitors.filter(v => v.lead_id);
  const seen = new Set(); list = list.filter(v => !seen.has(v.lead_id) && seen.add(v.lead_id));
  list.forEach(v => { v.next = nextStep(v); });
  const counts = { all: list.length, hot: list.filter(v => v.heat === 'hot').length, warm: list.filter(v => v.heat === 'warm').length, cold: list.filter(v => v.heat === 'cold').length };
  if (heat !== 'all') list = list.filter(v => v.heat === heat);
  if (show === 'todo') list = list.filter(v => v.next && !v.next.done && (v.next.overdue || v.next.today));
  const rank = { hot: 0, warm: 1, cold: 2 };
  list.sort((a, b) => (rank[a.heat] - rank[b.heat]) || (b.id - a.id));
  const booked = visitors.filter(v => v.lead_id && (v.booked_at || v.client_id)).length;
  MAIN.innerHTML = `
    <a href="#/booth" class="crumb">${icon('arrow-left', 16)}Outreach booth</a>
    <div class="head"><div><h1>${esc(c.name)} — visitors</h1><p>${visitors.length} body checks (${anon} without consent) · ${counts.all} leads · ${booked} booked or clients.</p></div>
      <div class="acts">${c.active ? `<a class="btn" href="#/booth/${c.id}">${icon('activity', 18)}Open booth</a>` : ''}</div></div>
    <div class="toolbar"><div class="seg">${[['todo', 'Due now'], ['all', 'Everyone']].map(([k, l]) => `<button data-show="${k}" class="${k === show ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="seg">${['all', 'hot', 'warm', 'cold'].map(k => `<button data-heat="${k}" class="${k === heat ? 'on' : ''}">${k === 'all' ? 'All' : HEAT[k][0]} (${counts[k]})</button>`).join('')}</div></div>
    <section class="panel flush"><div class="rows">${list.length ? list.map(v => row(v, c)).join('') : emptyState('check-circle', show === 'todo' ? 'Nothing due — every follow-up is up to date.' : 'No visitors here yet.')}</div></section>
    <p class="small muted" style="margin-top:10px">Sequence: report on the day → call next day (hot and warm) → tip on day 3 → offer reminder on day 7 → last message on day 14. Booking, becoming a client or "not interested" ends it.</p>`;
  const setQ = (k, val) => { const p = new URLSearchParams(q); p.set(k, val); p.set('tab', 'visitors'); location.hash = `#/booth/${id}?` + p; };
  MAIN.querySelectorAll('[data-heat]').forEach(b => b.addEventListener('click', () => setQ('heat', b.dataset.heat)));
  MAIN.querySelectorAll('[data-show]').forEach(b => b.addEventListener('click', () => setQ('show', b.dataset.show)));
  const V = x => visitors.find(v => v.id === +x);
  const logStep = (v, k) => api('/staff/reminders/log', { method: 'POST', body: { kind: 'booth', ref: `${v.id}:${k}`, lead_id: v.lead_id } });
  MAIN.querySelectorAll('[data-step]').forEach(a => a.addEventListener('click', e => {
    const v = V(a.dataset.v), k = a.dataset.step;
    if (a.tagName === 'BUTTON') { e.preventDefault(); busy(a, () => logStep(v, k)).then(() => { toast('Marked done'); ctx.reload(); }).catch(() => {}); }
    else logStep(v, k).then(() => setTimeout(() => ctx.reload(), 400)).catch(() => {});
  }));
  MAIN.querySelectorAll('[data-book]').forEach(b => b.addEventListener('click', () => { const v = V(b.dataset.book); ctx.bookModal({ lead: { id: v.lead_id, name: v.name, phone: v.phone }, kind: 'consultation', after: () => ctx.reload() }); }));
  MAIN.querySelectorAll('[data-client]').forEach(b => b.addEventListener('click', () => { const v = V(b.dataset.client); ctx.clientModal({ name: v.name, phone: v.phone, goal: (v.concerns || []).map(k => CONCERNS[k] || k).join(', '), lead_id: v.lead_id }, () => ctx.reload()); }));
  MAIN.querySelectorAll('[data-ni]').forEach(b => b.addEventListener('click', () => busy(b, () => api('/staff/leads/' + b.dataset.ni, { method: 'PUT', body: { status: 'not interested' } })).then(() => { toast('Marked not interested'); ctx.reload(); }).catch(() => {})));
  MAIN.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => readingModal(V(b.dataset.view))));
}

function row(v, c) {
  const s = v.next;
  const conc = (v.concerns || []).map(k => CONCERNS[k] || k).join(', ');
  const facts = [v.weight ? v.weight + ' kg' : null, v.bmi ? 'BMI ' + v.bmi : null, v.body_fat ? 'fat ' + v.body_fat + '%' : null, v.kcal_target ? n0(v.kcal_target) + ' kcal' : null].filter(Boolean).join(' · ');
  let act = '';
  if (s && !s.done) {
    const due = s.overdue ? `<span class="pill warn">Overdue · ${esc(fDay(s.due))}</span>` : s.today ? '<span class="pill good">Due today</span>' : `<span class="pill">From ${esc(fDay(s.due))}</span>`;
    act = s.how === 'call'
      ? `${due}<a class="btn sm" href="tel:${esc(v.phone)}">${icon('phone', 16)}Call</a><button class="btn sm ghost" data-step="${s.key}" data-v="${v.id}">${icon('check', 16)}Called</button>`
      : `${due}<a class="btn sm wa" data-step="${s.key}" data-v="${v.id}" href="${esc(wa(v.phone, s.key === 'd0' ? reportFromRow(v, c) : stepText(s.key, v, c)))}" target="_blank" rel="noopener">${icon('message-circle', 16)}${esc(s.label)}</a>`;
  }
  return `<div class="row" style="align-items:flex-start;flex-wrap:wrap">
    <span class="avatar">${esc(initials(v.name))}</span>
    <div class="grow" style="min-width:230px"><b>${esc(v.name || 'Visitor')} ${heatPill(v.heat)} ${s && s.done ? pill('good', s.done) : ''}</b>
      <span>${esc(prettyPhone(v.phone))}${conc ? ' — ' + esc(conc) : ''}</span>
      <div class="small faint" style="margin-top:2px">${esc(fWhen(new Date(new Date(v.created_at).getTime() + 330 * 60000).toISOString().slice(0, 16)))}${facts ? ' · ' + esc(facts) : ''}${v.best_time ? ' · call ' + esc(v.best_time) : ''}${v.staff_name ? ' · by ' + esc(first(v.staff_name)) : ''}</div>
</div>
    <div class="end">${act}
      <button class="btn sm quiet icon" data-view="${v.id}" aria-label="Readings" title="Readings">${icon('activity', 16)}</button>
      ${!v.booked_at && !v.client_id ? `<button class="btn sm ghost" data-book="${v.id}">${icon('calendar-plus', 16)}Book</button>` : ''}
      ${v.client_id ? `<a class="btn sm ghost" href="#/clients/${v.client_id}">${icon('user', 16)}Profile</a>` : `<button class="btn sm ghost" data-client="${v.id}">${icon('user-plus', 16)}Add client</button>`}
      ${!v.client_id && !v.booked_at && v.lead_status !== 'not interested' ? `<button class="btn sm quiet" data-ni="${v.lead_id}" title="Mark not interested">Not interested</button>` : ''}
    </div></div>`;
}

function reportFromRow(v, c) {
  const n = first(v.name) || 'there';
  const lines = [`Hi ${n}, thank you for visiting the Hasta EMS Progress Studio at ${c.place || c.name}. Your body check:`];
  if (v.weight) lines.push(`• Weight ${v.weight} kg${v.bmi ? ` · BMI ${v.bmi}` : ''}`);
  if (v.body_fat) lines.push(`• Body fat ${v.body_fat}%${v.visceral_fat ? ` · visceral fat ${v.visceral_fat}` : ''}`);
  if (v.bmr && v.tdee) lines.push(`• About ${n0(v.bmr)} kcal a day at rest (BMR), about ${n0(v.tdee)} kcal with your usual activity`);
  if (v.kcal_target) lines.push(`• Suggested daily target: about ${n0(v.kcal_target)} kcal`);
  if (c.offer) lines.push('', `Your booth offer: ${c.offer} — valid until ${fDate(addDays((v.created_at || '').slice(0, 10), c.offer_days || 14))}.`);
  lines.push('', `Reply here to book, or call ${CLINIC_PHONE}.`, ADDRESS, '', 'These are screening estimates, not a medical diagnosis.');
  return lines.join('\n');
}

function readingModal(v) {
  const R = [['Sex', v.gender], ['Age', v.age], ['Height', v.height_cm && v.height_cm + ' cm'], ['Weight', v.weight && v.weight + ' kg'], ['BMI', v.bmi], ['Body fat', v.body_fat && v.body_fat + '%'], ['Muscle mass', v.muscle_mass && v.muscle_mass + ' kg'],
    ['Visceral fat', v.visceral_fat], ['Body water', v.water_pct && v.water_pct + '%'], ['Metabolic age', v.metabolic_age], ['Waist', v.waist && v.waist + ' cm'], ['BMR', v.bmr && n0(v.bmr) + ' kcal (' + (v.bmr_source || '') + ')'],
    ['Daily energy', v.tdee && n0(v.tdee) + ' kcal'], ['Target', v.kcal_target && n0(v.kcal_target) + ' kcal (' + (AIMS[v.aim] || '') + ')'], ['Activity', ACTIVITY[v.activity] && ACTIVITY[v.activity][0]], ['Sleep', v.sleep_hours && v.sleep_hours + ' h'],
    ['Energy', v.energy && (ENERGY.find(e => e[0] === v.energy) || [])[1]], ['Wants trial', (INTEREST.find(i => i[0] === v.interest) || [])[1]], ['Analyser', v.device]].filter(x => x[1]);
  modal({ title: (v.name || 'Visitor') + ' — booth check', body: `<dl class="dl">${R.map(([k, x]) => `<dt>${esc(k)}</dt><dd>${esc(x)}</dd>`).join('')}</dl>`, actions: '<button class="btn" data-close>Close</button>' });
}
