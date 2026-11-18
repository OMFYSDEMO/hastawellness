// Package builder: what each package includes, how it is priced, and the checks
// that stop staff giving services a client's package does not include.

import { clean, nz } from './util.js';

export const ITEMS = ['ems_session', 'review', 'wm_consult', 'diet_plan', 'measurements'];
const parse = (s, f) => { try { return s ? JSON.parse(s) : f; } catch { return f; } };

// Normalised entitlements. Client packages made before the builder existed keep full access.
export function entOf(row, legacyFull = true) {
  const e = parse(row && row.entitlements, null);
  if (!e) return legacyFull
    ? { sessions: row ? row.sessions_total ?? row.sessions ?? 0 : 0, reviews: 99, wm_consults: 99, diet_plan: true, measurements: true, legacy: true }
    : { sessions: row ? row.sessions ?? 0 : 0, reviews: 0, wm_consults: 0, diet_plan: false, measurements: false };
  return { sessions: Math.max(0, parseInt(e.sessions, 10) || 0), reviews: Math.max(0, parseInt(e.reviews, 10) || 0), wm_consults: Math.max(0, parseInt(e.wm_consults, 10) || 0), diet_plan: !!e.diet_plan, measurements: !!e.measurements,
    treatments: Array.isArray(e.treatments) ? e.treatments.filter(t => t && t.item_id && t.qty > 0) : [] };
}

export async function priceList(env) {
  const { results } = await env.DB.prepare('SELECT * FROM ems_price_list ORDER BY sort').all();
  return results || [];
}
export async function savePriceList(env, rows) {
  if (!Array.isArray(rows)) return [400, 'Nothing to save.'];
  for (const r of rows) {
    if (!ITEMS.includes(r.item)) continue;
    const price = parseInt(r.price, 10), cost = parseInt(r.cost, 10);
    if (!(price >= 0 && price <= 1000000) || !(cost >= 0 && cost <= 1000000)) return [400, 'Prices and costs must be between ₹0 and ₹10,00,000.'];
    await env.DB.prepare('UPDATE ems_price_list SET price=?, cost=? WHERE item=?').bind(price, cost, r.item).run();
  }
  return [200];
}

// List value and cost of a set of entitlements at current price-list rates.
export function valuation(ent, list) {
  const p = Object.fromEntries(list.map(r => [r.item, r]));
  const lines = [
    ['ems_session', ent.sessions], ['review', ent.reviews], ['wm_consult', ent.wm_consults],
    ['diet_plan', ent.diet_plan ? 1 : 0], ['measurements', ent.measurements ? 1 : 0],
  ].filter(([, q]) => q > 0).map(([k, q]) => ({ item: k, label: p[k] ? p[k].label : k, qty: q, price: (p[k] ? p[k].price : 0) * q, cost: (p[k] ? p[k].cost : 0) * q }));
  // Clinic treatments added to the package (prices incl. GST, as EMS prices are).
  for (const t of ent.treatments || []) lines.push({ item: 'clinic:' + t.item_id, label: t.name, qty: t.qty, price: Math.round((t.price || 0) * t.qty), cost: Math.round((t.cost || 0) * t.qty) });
  return { lines, list: lines.reduce((a, l) => a + l.price, 0), cost: lines.reduce((a, l) => a + l.cost, 0) };
}

export function readEntitlements(b) {
  const n = (v, max) => { const x = parseInt(v, 10); return x >= 0 && x <= max ? x : null; };
  const e = { sessions: n(b.sessions, 200), reviews: n(b.reviews, 52), wm_consults: n(b.wm_consults, 52), diet_plan: !!b.diet_plan, measurements: !!b.measurements };
  if ([e.sessions, e.reviews, e.wm_consults].some(x => x === null)) return null;
  e.treatments = (Array.isArray(b.treatments) ? b.treatments : []).map(t => ({ item_id: parseInt(t.item_id, 10), qty: parseInt(t.qty, 10) })).filter(t => t.item_id > 0 && t.qty >= 1 && t.qty <= 50);
  return e;
}

// Clinic treatments that can go into an EMS package: active, sellable Skin / Hair services taxed at 18% like the
// EMS package itself (GST-exempt dental services can't be bundled into a taxable package).
export async function clinicTreatments(env) {
  const { results } = await env.DB.prepare(`SELECT i.id, i.code, i.name, i.price, i.gst_rate, i.cost, d.name dept FROM cl_items i LEFT JOIN cl_departments d ON d.id=i.dept_id
    WHERE i.kind='service' AND i.active=1 AND i.sellable=1 AND i.gst_rate=18 AND IFNULL(i.code,'') NOT LIKE 'EMS%' AND IFNULL(d.name,'') NOT LIKE '%Dental%' ORDER BY d.name, i.name`).all();
  return (results || []).map(i => ({ id: i.id, code: i.code, name: i.name, dept: i.dept, price: Math.round(i.price * (1 + i.gst_rate / 100)), cost: Math.round((i.cost || 0) * (1 + 0)) }));
}
// Fill in names and prices for the chosen treatments; refuses anything not on the allowed list.
export async function resolveTreatments(env, list) {
  if (!list || !list.length) return { ok: true, treatments: [] };
  const allowed = new Map((await clinicTreatments(env)).map(i => [i.id, i]));
  const out = [];
  for (const t of list) {
    const i = allowed.get(t.item_id);
    if (!i) return { ok: false, error: 'One of the treatments can\'t be added to an EMS package (only active Skin & Hair services with 18% GST).' };
    const ex = out.find(x => x.item_id === t.item_id);
    if (ex) ex.qty += t.qty; else out.push({ item_id: i.id, name: i.name, qty: t.qty, price: i.price, cost: i.cost });
  }
  return { ok: true, treatments: out };
}

// Usage of reviews and weight-management consultations against each client package.
export async function usage(env, cpIds) {
  if (!cpIds.length) return {};
  const { results } = await env.DB.prepare(`SELECT client_package_id id, kind, COUNT(*) n FROM ems_appointments WHERE client_package_id IN (${cpIds.map(Number).join(',')})
    AND kind IN ('review','wm_consult') AND status IN ('booked','attended') GROUP BY client_package_id, kind`).all();
  const out = {};
  for (const r of results || []) (out[r.id] ||= {})[r.kind] = r.n;
  return out;
}

// What the client can currently receive, across their active packages.
export function access(packages) {
  const act = packages.filter(p => p.state === 'active');
  return {
    diet_plan: act.some(p => p.ent.diet_plan),
    measurements: act.some(p => p.ent.measurements),
    reviews_left: act.reduce((a, p) => a + p.reviews_left, 0),
    wm_left: act.reduce((a, p) => a + p.wm_left, 0),
    has_package: act.length > 0,
  };
}

export const NOT_INCLUDED = {
  diet_plan: 'The diet and lifestyle plan is not included in this client\'s package. Upgrade the package to include it.',
  measurements: 'Progress measurements are not included in this client\'s package. Upgrade the package to include them.',
  review: 'No progress reviews left on this client\'s package. Reviews are only given when the package includes them.',
  wm_consult: 'No weight-management consultations left on this client\'s package. They are only given when the package includes them.',
};
