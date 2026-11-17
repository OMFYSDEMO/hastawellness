// "Hasta Quest" — makes the EMS programme a game the client plays with their coach.
// Everything is worked out from what the client and team already record (sessions, daily check-ins, meal
// logs, measurements, packages), so it can't drift out of step and nothing extra is stored.
//   • XP and levels for the things that drive results: attending sessions, a steady rhythm of 2 a week,
//     logging the day, meals on plan, hitting water / steps / sleep, weighing in, renewing on time.
//   • Streaks: daily logging (days) and session rhythm (weeks with 2+ sessions).
//   • Weekly quests with progress bars, reset every Monday.
//   • Badges with the date earned.
//   • Goal board: Red / Amber / Green for each part of the goal, with what to do next.
const IST = 330 * 60000;
const today = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const days = (a, b) => Math.round((Date.parse(b.slice(0, 10) + 'T00:00:00Z') - Date.parse(a.slice(0, 10) + 'T00:00:00Z')) / 86400000);
const monday = d => { const t = new Date(d + 'T00:00:00Z'); const w = (t.getUTCDay() + 6) % 7; return addDays(d, -w); };
const r1 = v => Math.round(v * 10) / 10;

export const XP = { session: 30, rhythm_week: 20, checkin: 10, meal_log: 2, meal_on: 3, meal_partly: 1, water: 5, steps: 5, sleep: 5, perfect_day: 15, weigh_in: 15, clinic_measure: 25, renew_on_time: 50 };
export const LEVELS = [[0, 'Starter'], [200, 'Mover'], [500, 'Regular'], [1000, 'Committed'], [1800, 'Strong'], [3000, 'Champion'], [4500, 'Elite'], [6500, 'Legend']];
const BADGES = {
  first_session: ['First session', 'zap', 'Completed your first EMS session'],
  sessions_10: ['10 sessions', 'zap', '10 EMS sessions done'],
  sessions_25: ['25 sessions', 'trophy', '25 EMS sessions done'],
  sessions_50: ['50 sessions', 'trophy', '50 EMS sessions done'],
  rhythm_4: ['Rhythm keeper', 'calendar-check', '4 weeks in a row with 2+ sessions'],
  streak_7: ['7-day streak', 'flame', 'Logged your day 7 days in a row'],
  streak_30: ['30-day streak', 'flame', 'Logged your day 30 days in a row'],
  hydration_7: ['Hydration hero', 'droplet', 'Hit your water target 7 days in a row'],
  steps_7: ['Step master', 'footprints', 'Hit your step target 7 days in a row'],
  plan_week: ['On-plan week', 'salad', '7 days with 3+ meals on plan'],
  weigh_4: ['Regular weigh-ins', 'activity', '4 weekly weigh-ins in a row'],
  kg_1: ['First kilo', 'trending-down', '1 kg down from your start'],
  kg_5: ['5 kg down', 'trending-down', '5 kg down from your start'],
  waist_3: ['Inches off', 'ruler', '3 cm off your waist'],
  waist_8: ['Big change', 'ruler', '8 cm off your waist'],
  renewed: ['Never miss a beat', 'package', 'Renewed before your package ran out'],
  goal: ['Goal reached', 'trophy', 'Reached your target weight'],
};

export function game(d) {
  const t = today(), plan = d.plan || {};
  const wT = plan.water_target || 10, sT = plan.steps_target || 7000, slT = plan.sleep_target || 7;
  const attended = d.appointments.filter(a => a.kind === 'session' && a.status === 'attended').map(a => a.start_at.slice(0, 10)).sort();
  // A real check-in has at least one of water, steps, sleep or energy (a meal log alone also makes a row).
  const checks = d.checkins.filter(c => c.water != null || c.steps != null || c.sleep != null || c.energy != null).sort((a, b) => a.day < b.day ? -1 : 1);
  const meals = d.meal_logs || [];
  const meas = d.measurements || [];
  const earned = {}; const earn = (k, on) => { if (!earned[k] && on) earned[k] = on; };
  let xp = 0; const log = [];
  const addXp = (n, why, on) => { xp += n; log.push({ on, n, why }); };

  // Sessions and weekly rhythm.
  attended.forEach((s, i) => { addXp(XP.session, 'EMS session', s); if (i === 0) earn('first_session', s); if (i === 9) earn('sessions_10', s); if (i === 24) earn('sessions_25', s); if (i === 49) earn('sessions_50', s); });
  const perWeek = {}; for (const s of attended) perWeek[monday(s)] = (perWeek[monday(s)] || 0) + 1;
  const weeks = Object.keys(perWeek).sort();
  let run = 0, prevW = null;
  for (const w of weeks) {
    if (perWeek[w] >= 2) { addXp(XP.rhythm_week, '2+ sessions in the week', addDays(w, 6) < t ? addDays(w, 6) : t); run = prevW && addDays(prevW, 7) === w ? run + 1 : 1; prevW = w; if (run >= 4) earn('rhythm_4', addDays(w, 6)); }
    else { run = 0; prevW = null; }
  }
  // Current session streak (weeks with 2+, counting this week only if already reached).
  let sessStreak = 0; { let w = monday(t); if ((perWeek[w] || 0) < 2) w = addDays(w, -7); while ((perWeek[w] || 0) >= 2) { sessStreak++; w = addDays(w, -7); } }

  // Daily check-ins and habits.
  const mealsBy = {}; for (const m of meals) (mealsBy[m.day] ||= []).push(m);
  let streak = 0, best = 0, prev = null, wRun = 0, sRun = 0, pRun = 0;
  for (const c of checks) {
    addXp(XP.checkin, 'Daily check-in', c.day);
    const hitW = c.water != null && c.water >= wT, hitS = c.steps != null && c.steps >= sT, hitSl = c.sleep != null && c.sleep >= slT;
    if (hitW) addXp(XP.water, 'Water target', c.day); if (hitS) addXp(XP.steps, 'Step target', c.day); if (hitSl) addXp(XP.sleep, 'Sleep target', c.day);
    const ml = mealsBy[c.day] || [], on = ml.filter(m => m.status === 'on').length || (ml.length ? 0 : c.meals || 0);
    const cont = prev && addDays(prev, 1) === c.day;
    streak = cont ? streak + 1 : 1; best = Math.max(best, streak);
    if (streak >= 7) earn('streak_7', c.day); if (streak >= 30) earn('streak_30', c.day);
    wRun = hitW ? (cont ? wRun + 1 : 1) : 0; if (wRun >= 7) earn('hydration_7', c.day);
    sRun = hitS ? (cont ? sRun + 1 : 1) : 0; if (sRun >= 7) earn('steps_7', c.day);
    pRun = on >= 3 ? (cont ? pRun + 1 : 1) : 0; if (pRun >= 7) earn('plan_week', c.day);
    if (hitW && hitS && on >= 3) addXp(XP.perfect_day, 'Perfect day', c.day);
    prev = c.day;
  }
  const lastCheck = checks.length ? checks[checks.length - 1].day : null;
  const curStreak = lastCheck && days(lastCheck, t) <= 1 ? streak : 0;
  for (const m of meals) { addXp(XP.meal_log, 'Meal logged', m.day); if (m.status === 'on') addXp(XP.meal_on, 'Meal on plan', m.day); else if (m.status === 'partly') addXp(XP.meal_partly, 'Meal partly on plan', m.day); }

  // Measurements: weekly self weigh-ins and clinic checks.
  const selfWeeks = new Set(), clinic = [];
  for (const m of meas) { if (m.self) { const w = monday(m.measured_on); if (!selfWeeks.has(w) && m.weight != null) { selfWeeks.add(w); addXp(XP.weigh_in, 'Weekly weigh-in', m.measured_on); } } else clinic.push(m); }
  for (const m of clinic) addXp(XP.clinic_measure, 'Clinic measurement', m.measured_on);
  { const ws = [...selfWeeks].sort(); let r = 0, p = null; for (const w of ws) { r = p && addDays(p, 7) === w ? r + 1 : 1; p = w; if (r >= 4) earn('weigh_4', addDays(w, 6)); } }
  const firstW = meas.find(m => m.weight != null), firstWa = meas.find(m => m.waist != null);
  for (const m of meas) {
    if (firstW && m.weight != null) { if (firstW.weight - m.weight >= 1) earn('kg_1', m.measured_on); if (firstW.weight - m.weight >= 5) earn('kg_5', m.measured_on); if (d.client.target_weight && Math.abs(m.weight - d.client.target_weight) <= 0.5 && firstW.weight !== m.weight) earn('goal', m.measured_on); }
    if (firstWa && m.waist != null) { if (firstWa.waist - m.waist >= 3) earn('waist_3', m.measured_on); if (firstWa.waist - m.waist >= 8) earn('waist_8', m.measured_on); }
  }
  // Renewals: a new package started before the previous one ran out.
  const pk = [...d.packages].sort((a, b) => (a.start_date || '') < (b.start_date || '') ? -1 : 1);
  for (let i = 1; i < pk.length; i++) { const a = pk[i - 1], b = pk[i]; if (b.start_date && (!a.expiry_date || b.start_date <= a.expiry_date)) { addXp(XP.renew_on_time, 'Renewed on time', b.start_date); earn('renewed', b.start_date); } }

  // Level.
  let li = 0; for (let i = 0; i < LEVELS.length; i++) if (xp >= LEVELS[i][0]) li = i;
  const next = LEVELS[li + 1];
  const level = { n: li + 1, name: LEVELS[li][1], xp, from: LEVELS[li][0], to: next ? next[0] : null, next: next ? next[1] : null, pct: next ? Math.round((xp - LEVELS[li][0]) / (next[0] - LEVELS[li][0]) * 100) : 100 };

  // Weekly quests (Mon–Sun).
  const wk = monday(t), inWk = s => s >= wk && s <= t;
  const wkChecks = checks.filter(c => inWk(c.day)), wkMeals = meals.filter(m => inWk(m.day));
  const quests = [
    { key: 'sessions', label: 'Do 2 EMS sessions', icon: 'zap', have: attended.filter(inWk).length, need: 2, xp: XP.rhythm_week },
    { key: 'checkins', label: 'Log your day 5 times', icon: 'clipboard-check', have: wkChecks.length, need: 5, xp: 50 },
    { key: 'meals', label: 'Log 15 meals on plan', icon: 'salad', have: wkMeals.filter(m => m.status === 'on').length, need: 15, xp: 45, needs: 'diet_plan' },
    { key: 'water', label: 'Hit your water target 5 days', icon: 'droplet', have: wkChecks.filter(c => c.water != null && c.water >= wT).length, need: 5, xp: 25 },
    { key: 'weigh', label: 'Weigh in once', icon: 'activity', have: meas.some(m => inWk(m.measured_on) && m.weight != null) ? 1 : 0, need: 1, xp: XP.weigh_in },
  ].filter(q => !q.needs || (d.access && d.access[q.needs])).map(q => ({ ...q, done: q.have >= q.need, pct: Math.min(100, Math.round(q.have / q.need * 100)) }));

  const badges = Object.entries(BADGES).map(([k, [name, icon, text]]) => ({ key: k, name, icon, text, on: earned[k] || null })).sort((a, b) => (b.on ? 1 : 0) - (a.on ? 1 : 0) || (b.on || '').localeCompare(a.on || ''));
  const recent = log.filter(x => days(x.on, t) <= 7);
  return { level, xp, week_xp: recent.reduce((a, x) => a + x.n, 0), streak: curStreak, best_streak: best, session_streak: sessStreak, quests, badges, earned: Object.keys(earned).length, rag: goalBoard(d, { attended, checks, meals, meas }) };
}

// Red / Amber / Green for each part of the goal.
export function goalBoard(d, { attended, checks, meals, meas }) {
  const t = today(), acc = d.access || {}, out = [];
  const add = (key, label, status, value, tip) => out.push({ key, label, status, value, tip });
  // 1. Weight / shape progress.
  const ws = meas.filter(m => m.weight != null && days(m.measured_on, t) <= 42);
  const rate = d.insights && d.insights.metrics ? d.insights.metrics.weeklyRate : null;
  const last = [...meas].reverse().find(m => m.weight != null);
  const wantLoss = d.client.target_weight && last ? d.client.target_weight < last.weight - 0.2 : true;
  const wantGain = d.client.target_weight && last ? d.client.target_weight > last.weight + 0.2 : false;
  if (rate == null || ws.length < 2) add('progress', 'Weight progress', 'grey', 'Not enough weigh-ins yet', 'Weigh in once a week so we can see your trend.');
  else if (wantGain) add('progress', 'Weight progress', rate >= 0.2 ? 'green' : rate >= 0 ? 'amber' : 'red', `${rate > 0 ? '+' : ''}${rate} kg a week`, rate >= 0.2 ? 'Gaining steadily — keep it up.' : 'Add a snack and protein at every meal.');
  else if (wantLoss) add('progress', 'Weight progress', rate <= -0.3 ? 'green' : rate <= 0.1 ? 'amber' : 'red', `${rate > 0 ? '+' : ''}${rate} kg a week`, rate <= -0.3 ? (rate < -1.1 ? 'Good, but faster than 1 kg a week — eat enough protein.' : 'On pace — 0.3 to 1 kg a week is ideal.') : rate <= 0.1 ? 'Slow week — check portions and evening snacks.' : 'Weight is going up — talk to your coach this week.');
  else add('progress', 'Weight progress', Math.abs(rate) <= 0.3 ? 'green' : 'amber', `${rate > 0 ? '+' : ''}${rate} kg a week`, 'Holding steady is the goal now.');
  // 2. EMS sessions in the last 14 days (2 a week is the target).
  const s14 = attended.filter(s => days(s, t) < 14).length;
  const next = d.appointments.some(a => a.status === 'booked' && a.start_at.slice(0, 10) >= t);
  const active = d.packages.filter(p => p.state === 'active'), left = active.reduce((a, p) => a + (p.available || 0), 0);
  add('sessions', 'EMS sessions', s14 >= 4 ? 'green' : s14 >= 2 ? 'amber' : 'red', `${s14} in the last 2 weeks`, s14 >= 4 ? (next ? 'Great rhythm — next session is booked.' : 'Great rhythm — book your next one.') : next ? 'Aim for 2 a week.' : left ? 'Book your next session now — aim for 2 a week.' : 'No sessions left — renew to keep going.');
  // 3. Package on track: sessions left vs time left.
  const p = active.sort((a, b) => (a.expiry_date || '9') < (b.expiry_date || '9') ? -1 : 1)[0];
  if (!p) add('package', 'Package', d.packages.length ? 'red' : 'grey', d.packages.length ? 'No active package' : 'No package yet', 'Renew before your last session so your routine doesn\'t break.');
  else {
    const rem = p.remaining != null ? p.remaining : p.available;
    const wl = p.expiry_date ? Math.max(0.5, days(t, p.expiry_date) / 7) : null;
    const need = wl ? rem / wl : 0, pace = attended.filter(s => days(s, t) < 28).length / 4;
    const st = rem <= 0 ? 'red' : rem <= 2 ? 'amber' : !wl || pace >= need ? 'green' : pace >= need * 0.7 ? 'amber' : 'red';
    add('package', 'Package', st, `${rem} left${p.expiry_date ? ` · ends ${new Date(p.expiry_date + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })}` : ''}`,
      rem <= 2 ? 'Nearly done — plan your renewal now.' : st === 'green' ? 'On track to use every session.' : `Book about ${Math.ceil(need)} a week to use them before they expire.`);
    if (p.balance > 0) out[out.length - 1].tip += ' A payment is pending.';
  }
  // 4. Diet: meals on plan, last 7 days.
  if (acc.diet_plan) {
    const ml = meals.filter(m => days(m.day, t) < 7 && m.status !== 'skipped');
    let pct = null;
    if (ml.length) pct = Math.round(ml.reduce((a, m) => a + (m.status === 'on' ? 1 : m.status === 'partly' ? 0.5 : 0), 0) / ml.length * 100);
    else { const c7 = checks.filter(c => days(c.day, t) < 7 && c.meals != null); if (c7.length) pct = Math.round(c7.reduce((a, c) => a + c.meals, 0) / (c7.length * 4) * 100); }
    add('diet', 'Meals on plan', pct == null ? 'red' : pct >= 75 ? 'green' : pct >= 50 ? 'amber' : 'red', pct == null ? 'Not logged this week' : `${pct}% this week`, pct == null ? 'Log your meals — tap On plan / Partly / Off after each one.' : pct >= 75 ? 'Excellent — your plate is doing the work.' : 'Pick one meal to get right every day this week.');
    // 5. Daily logging.
    const c7 = checks.filter(c => days(c.day, t) < 7).length;
    add('logging', 'Daily check-in', c7 >= 5 ? 'green' : c7 >= 3 ? 'amber' : 'red', `${c7} of 7 days`, c7 >= 5 ? 'Consistent — keep the streak alive.' : 'Log water, steps and sleep each evening — 20 seconds.');
  }
  // 6. Vitals up to date.
  if (acc.measurements) {
    const lw = [...meas].reverse().find(m => m.weight != null);
    const age = lw ? days(lw.measured_on, t) : null;
    add('vitals', 'Weigh-in', age == null ? 'red' : age <= 7 ? 'green' : age <= 14 ? 'amber' : 'red', age == null ? 'Never' : age === 0 ? 'Today' : `${age} days ago`, age != null && age <= 7 ? 'Up to date.' : 'Weigh in this week — same scale, morning, before breakfast.');
  }
  const reds = out.filter(x => x.status === 'red').length, ambers = out.filter(x => x.status === 'amber').length;
  return { overall: reds >= 2 ? 'red' : reds || ambers >= 2 ? 'amber' : 'green', items: out };
}
