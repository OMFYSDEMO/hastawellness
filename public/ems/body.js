// Body composition and nutrition targets for the EMS app.
//
// Body fat can come from two places:
//  1. A body-composition analyser (bioelectrical impedance, BIA) — entered as read from the machine.
//  2. Tape-measure formulas — estimated here from sex, age, height, weight, neck, waist, belly and hips:
//     • US Navy circumference method (Hodgdon & Beckett, 1984) — neck, waist/belly, hips, height
//     • Relative fat mass, RFM (Woolcott & Bergman, 2018) — height and waist
//     • CUN-BAE (Gómez-Ambrosi et al., 2012) — age, sex and BMI
//     • Deurenberg (1991) — age, sex and BMI
// From body fat %: fat mass, fat-free (lean) mass, and estimated body water (≈73% of lean mass) and protein
// (lean mass − water − minerals; minerals ≈ 6.8% of lean mass), as body-composition analysers do.
// Energy: BMR by Katch-McArdle when lean mass is known, otherwise Mifflin-St Jeor; × activity = daily energy.
// These are estimates for coaching, not a diagnosis.
const r1 = n => Math.round(n * 10) / 10;
const ok = n => typeof n === 'number' && isFinite(n) && n > 0;
const num = v => (v === '' || v == null || isNaN(+v)) ? null : +v;

export const ACTIVITY = { sedentary: ['Mostly sitting (desk job, little exercise)', 1.2], light: ['Light (walks, 1–3 EMS / workouts a week)', 1.375], moderate: ['Moderate (exercise 3–5 days a week)', 1.55], active: ['Very active (hard exercise 6–7 days)', 1.725] };
export const AIMS = { lose: 'Lose fat', tone: 'Tone up (lose fat, keep muscle)', maintain: 'Maintain', gain: 'Gain weight / muscle' };
export const FOOD_PREF = { nonveg: 'Non-vegetarian', fish: 'Fish, no meat', egg: 'Vegetarian + egg', veg: 'Vegetarian', vegan: 'Vegan (no dairy)' };

// Where to measure (shown in the form).
export const TAPE = [
  ['neck', 'Neck', 'just below the Adam\'s apple, tape sloping slightly down to the front'],
  ['chest', 'Chest', 'at nipple level, after a normal breath out'],
  ['arm', 'Upper arm', 'relaxed arm, midway between shoulder and elbow'],
  ['waist', 'Waist', 'narrowest point, midway between the lowest rib and the top of the hip bone'],
  ['belly', 'Belly (at navel)', 'around the abdomen at the level of the navel, relaxed'],
  ['lower_belly', 'Lower belly', 'between waist and hips — about 5 cm (2 in) below the navel'],
  ['hips', 'Hips', 'widest point of the buttocks, feet together'],
  ['thigh', 'Thigh', 'about 15 cm (6 in) above the knee cap, standing'],
];
// Readings from a body-composition analyser (BIA scale).
export const BIA = [
  ['body_fat', 'Body fat', '%', 3, 70], ['muscle_mass', 'Muscle mass', 'kg', 5, 150], ['water_pct', 'Body water', '%', 25, 80],
  ['protein_pct', 'Protein', '%', 5, 30], ['bone_mass', 'Bone mass', 'kg', 0.5, 8], ['visceral_fat', 'Visceral fat level', '', 1, 59],
  ['bmr', 'BMR', 'kcal', 600, 4000], ['metabolic_age', 'Metabolic age', 'yrs', 10, 100],
];

export const bodyFatBands = sex => sex === 'male'
  ? [[0, 6, 'Essential fat', 'warn'], [6, 14, 'Athletic', 'good'], [14, 18, 'Fit', 'good'], [18, 25, 'Average', 'neutral'], [25, 99, 'High', 'warn']]
  : [[0, 14, 'Essential fat', 'warn'], [14, 21, 'Athletic', 'good'], [21, 25, 'Fit', 'good'], [25, 32, 'Average', 'neutral'], [32, 99, 'High', 'warn']];
const bandOf = (v, bands) => { const b = bands.find(([lo, hi]) => v >= lo && v < hi) || bands[bands.length - 1]; return { label: b[2], tone: b[3] }; };

// c = client {gender, birth_year, height_cm}; m = a measurement row (or form values). Missing fields are skipped.
export function bodyComp(c, m, onDate) {
  const sex = c.gender === 'male' ? 'male' : c.gender === 'female' ? 'female' : null;
  const year = +(onDate || new Date().toISOString()).slice(0, 4);
  const age = c.birth_year ? year - c.birth_year : null;
  const h = num(c.height_cm), w = num(m.weight), neck = num(m.neck), waist = num(m.waist), belly = num(m.belly), hips = num(m.hips);
  const out = { sex, age, height: h, weight: w, estimates: [], ratios: {}, missing: [] };
  if (!sex) out.missing.push('gender (male / female)');
  if (!age) out.missing.push('year of birth');
  if (!h) out.missing.push('height');
  if (!w) out.missing.push('weight');
  const bmi = h && w ? w / ((h / 100) ** 2) : null;
  if (bmi) out.ratios.bmi = { value: r1(bmi), ...(bmi < 18.5 ? { label: 'Underweight', tone: 'warn' } : bmi < 23 ? { label: 'Healthy (South Asian range)', tone: 'good' } : bmi < 25 ? { label: 'Overweight', tone: 'neutral' } : { label: 'Obese range', tone: 'warn' }) };
  if (waist && hips) { const v = Math.round(waist / hips * 100) / 100, lim = sex === 'male' ? 0.9 : 0.85; out.ratios.whr = { value: Math.round(v * 100) / 100, label: v <= lim ? 'Healthy' : `High — aim for ${lim} or less`, tone: v <= lim ? 'good' : 'warn' }; }
  if (waist && h) { const v = Math.round(waist / h * 100) / 100; out.ratios.whtr = { value: Math.round(v * 100) / 100, label: v < 0.5 ? 'Healthy — waist under half your height' : v < 0.6 ? 'Increased — aim for under 0.5' : 'High — aim for under 0.5', tone: v < 0.5 ? 'good' : 'warn' }; }
  if (sex && h) {
    // US Navy. Men: abdomen at the navel (belly) − neck; women: waist + hips − neck.
    const abd = belly || waist;
    if (neck && sex === 'male' && abd && abd > neck) out.estimates.push({ key: 'navy', label: 'US Navy (tape)', uses: 'height, neck, belly', value: 495 / (1.0324 - 0.19077 * Math.log10(abd - neck) + 0.15456 * Math.log10(h)) - 450 });
    if (neck && sex === 'female' && waist && hips && waist + hips > neck) out.estimates.push({ key: 'navy', label: 'US Navy (tape)', uses: 'height, neck, waist, hips', value: 495 / (1.29579 - 0.35004 * Math.log10(waist + hips - neck) + 0.22100 * Math.log10(h)) - 450 });
    if (waist) out.estimates.push({ key: 'rfm', label: 'Relative fat mass (RFM)', uses: 'height, waist', value: 64 - 20 * (h / waist) + (sex === 'female' ? 12 : 0) });
  }
  if (sex && age && bmi) {
    const f = sex === 'female' ? 1 : 0;
    out.estimates.push({ key: 'cunbae', label: 'CUN-BAE (BMI)', uses: 'age, sex, height, weight', value: -44.988 + 0.503 * age + 10.689 * f + 3.172 * bmi - 0.026 * bmi * bmi + 0.181 * bmi * f - 0.02 * bmi * age - 0.005 * bmi * bmi * f + 0.00021 * bmi * bmi * age });
    out.estimates.push({ key: 'deurenberg', label: 'Deurenberg (BMI)', uses: 'age, sex, height, weight', value: 1.2 * bmi + 0.23 * age - 10.8 * (1 - f) - 5.4 });
  }
  out.estimates = out.estimates.filter(e => isFinite(e.value)).map(e => ({ ...e, value: r1(Math.min(65, Math.max(3, e.value))) }));
  // Which body fat figure to use: the analyser reading, else the Navy tape method, else the average of the others.
  const bia = num(m.body_fat);
  const navy = out.estimates.find(e => e.key === 'navy');
  const avg = out.estimates.length ? r1(out.estimates.reduce((a, e) => a + e.value, 0) / out.estimates.length) : null;
  out.bf = bia != null ? { value: bia, source: 'Analyser (BIA)' } : navy ? { value: navy.value, source: 'US Navy tape method' } : avg != null ? { value: avg, source: 'Average of BMI-based estimates' } : null;
  out.est_avg = avg;
  if (out.bf && sex) out.bf.band = bandOf(out.bf.value, bodyFatBands(sex));
  if (out.bf && w) {
    const fat = w * out.bf.value / 100, ffm = w - fat;
    const water = num(m.water_pct) != null ? w * num(m.water_pct) / 100 : ffm * 0.73;
    const mineral = num(m.bone_mass) != null ? num(m.bone_mass) : ffm * 0.068;
    const protein = num(m.protein_pct) != null ? w * num(m.protein_pct) / 100 : Math.max(0, ffm - water - mineral);
    out.mass = { fat: r1(fat), lean: r1(ffm), water: r1(water), protein: r1(protein), mineral: r1(mineral), muscle: num(m.muscle_mass) != null ? num(m.muscle_mass) : null,
      water_pct: r1(water / w * 100), protein_pct: r1(protein / w * 100), water_src: num(m.water_pct) != null ? 'analyser' : 'estimate', protein_src: num(m.protein_pct) != null ? 'analyser' : 'estimate' };
    if (h) out.ratios.ffmi = { value: r1(ffm / ((h / 100) ** 2)), label: 'Lean mass index (kg/m²)', tone: 'neutral' };
  }
  // Basal metabolic rate.
  if (num(m.bmr)) out.bmr = { value: Math.round(num(m.bmr)), source: 'Analyser' };
  else if (out.mass) out.bmr = { value: Math.round(370 + 21.6 * out.mass.lean), source: 'Katch-McArdle (lean mass)' };
  else if (sex && age && h && w) out.bmr = { value: Math.round(10 * w + 6.25 * h - 5 * age + (sex === 'male' ? 5 : -161)), source: 'Mifflin-St Jeor' };
  if (num(m.visceral_fat) != null) out.visceral = { value: num(m.visceral_fat), label: num(m.visceral_fat) < 10 ? 'Healthy (under 10)' : num(m.visceral_fat) < 15 ? 'High (10–14)' : 'Very high (15+)', tone: num(m.visceral_fat) < 10 ? 'good' : 'warn' };
  return out;
}

// Latest value of each field across measurements (so a tape-only visit still uses the last weight).
export function latestMerged(measurements) {
  const o = {}; let date = null;
  for (const m of measurements) for (const [k, v] of Object.entries(m)) if (v != null && v !== '') { o[k] = v; if (k !== 'id') date = m.measured_on; }
  return { m: o, date };
}

// Daily targets from body composition, activity and aim.
export function nutritionTargets(comp, plan, client) {
  if (!comp.bmr) return null;
  const act = ACTIVITY[plan.activity] || ACTIVITY.light;
  const tdee = comp.bmr.value * act[1];
  const aim = plan.aim || defaultAim(comp, client);
  const adj = { lose: -0.2, tone: -0.1, maintain: 0, gain: 0.1 }[aim];
  let kcal = tdee * (1 + adj);
  if (aim === 'lose') kcal = Math.max(kcal, tdee - 750);
  const floor = Math.max(comp.bmr.value, comp.sex === 'male' ? 1500 : 1200);
  if (aim !== 'gain') kcal = Math.max(kcal, floor);
  kcal = Math.round(kcal / 50) * 50;
  const w = comp.weight, lean = comp.mass ? comp.mass.lean : w * 0.7;
  // Protein: about 1.8–2.2 g per kg of lean mass while losing fat (protects muscle), 1.6 otherwise; capped at 2 g/kg body weight.
  let protein = lean * ({ lose: 2.0, tone: 2.0, maintain: 1.6, gain: 1.8 }[aim]);
  protein = Math.round(Math.min(protein, w * 2, 160) / 5) * 5;
  const fat = Math.round(kcal * 0.28 / 9 / 5) * 5;
  const carbs = Math.max(50, Math.round((kcal - protein * 4 - fat * 9) / 4 / 5) * 5);
  const water = Math.round(w * 35 / 250); // glasses of 250 ml
  return { aim, activity: plan.activity || 'light', tdee: Math.round(tdee), kcal, protein, carbs, fat, fibre: comp.sex === 'male' ? 30 : 25, water_glasses: Math.min(16, Math.max(8, water)),
    protein_per_meal: Math.round(protein / 4), note: aim === 'lose' && kcal === floor ? 'Calories held at the safe minimum — increase activity rather than eating less.' : null };
}
export function defaultAim(comp, client) {
  if (comp.ratios.bmi && comp.ratios.bmi.value < 18.5) return 'gain';
  if (client && client.target_weight && comp.weight) { if (client.target_weight < comp.weight - 1) return 'lose'; if (client.target_weight > comp.weight + 1) return 'gain'; }
  if (comp.bf && comp.bf.band && comp.bf.band.label === 'High') return 'lose';
  return 'tone';
}

// Which food plans fit this client, best first, with the reason.
export function suggestDiets(comp, plan, client, screening) {
  const pref = plan.food_pref || 'nonveg', aim = plan.aim || defaultAim(comp, client);
  const s = {}; const add = (k, pts, why) => { (s[k] ||= { key: k, score: 0, why: [] }); s[k].score += pts; if (why) s[k].why.push(why); };
  const highFat = comp.bf && comp.bf.band && comp.bf.band.label === 'High';
  const belly = (comp.ratios.whtr && comp.ratios.whtr.tone === 'warn') || (comp.ratios.whr && comp.ratios.whr.tone === 'warn') || (comp.visceral && comp.visceral.tone === 'warn');
  const lowLean = comp.ratios.ffmi && comp.ratios.ffmi.value < (comp.sex === 'male' ? 17 : 14);
  const diabetic = screening && screening.diabetes;
  // Food preference decides the family.
  const fam = { nonveg: ['kerala-balanced', 'high-protein', 'calorie-smart', 'low-gi', 'fish-forward'], fish: ['fish-forward', 'calorie-smart', 'low-gi'], egg: ['eggetarian', 'veg-high-protein', 'calorie-smart', 'low-gi'], veg: ['vegetarian', 'veg-high-protein', 'calorie-smart', 'low-gi'], vegan: ['vegan', 'low-gi'] }[pref] || [];
  fam.forEach((k, i) => add(k, 5 - i));
  if (diabetic) add('low-gi', 10, 'diabetes ticked in screening — steady-sugar plan, with the doctor\'s advice');
  if (belly) { add('low-gi', 4, 'fat stored around the belly (waist ratio / visceral fat high)'); add('calorie-smart', 3, 'belly fat — portion control first'); }
  if (highFat && aim !== 'gain') { add('calorie-smart', 4, `body fat ${comp.bf.value}% is in the high range`); add('fish-forward', 1); }
  if (aim === 'tone' || lowLean) { for (const k of ['high-protein', 'veg-high-protein', 'eggetarian']) add(k, 4, lowLean ? 'lean mass is low — protein to build muscle with EMS' : 'toning: protein at every meal'); }
  if (aim === 'gain') add('healthy-gain', 12, comp.ratios.bmi && comp.ratios.bmi.value < 18.5 ? 'BMI under 18.5 — gain steadily' : 'aim is to gain weight');
  if (aim === 'maintain') add('kerala-balanced', 2, 'maintaining — balanced plate');
  const allowed = { veg: k => !['kerala-balanced', 'high-protein', 'fish-forward', 'eggetarian'].includes(k), vegan: k => ['vegan', 'low-gi', 'calorie-smart'].includes(k), egg: k => !['kerala-balanced', 'high-protein', 'fish-forward'].includes(k), fish: k => !['kerala-balanced', 'high-protein'].includes(k) }[pref] || (() => true);
  return Object.values(s).filter(x => allowed(x.key)).sort((a, b) => b.score - a.score).slice(0, 4);
}
