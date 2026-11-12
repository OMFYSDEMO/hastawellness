// Hasta Clinic — stock & purchasing (phase 3a).
// Suppliers, purchase orders (draft → approved → received), goods received notes with batch / expiry
// and free quantities, stock moves (in on GRN, out on billing, adjustments, use in treatment),
// supplier payments and the purchase GST summary.
// Stock on hand = SUM(cl_stock_moves.qty). Batches are used first-expiry-first-out when stock goes out.
import { PDFDocument, StandardFonts, rgb } from './vendor/pdf-lib.esm.min.js';
import { json, clean, nz } from './util.js';
import { settings, itemFields } from './clinic.js';

const IST = 330 * 60000;
const today = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString().slice(0, 19) + 'Z';
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const r2 = x => Math.round((Number(x) || 0) * 100) / 100;
const r3 = x => Math.round((Number(x) || 0) * 1000) / 1000;
const num = x => { const n = Number(x); return Number.isFinite(n) ? n : NaN; };
const HEADERS = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'x-content-type-options': 'nosniff' };
const api = (data, status = 200) => json(data, status, HEADERS);
const done = ([status, error, extra]) => status === 200 ? api({ ok: true, ...(extra || {}) }) : api({ ok: false, error, ...(extra || {}) }, status);
const R = (s, e, x) => [s, e, x];
const OK = x => [200, null, x];
const canManage = u => u.admin || u.role === 'manager';
const deny = () => api({ ok: false, error: 'Managers or admins only.' }, 403);
const GST_RATES = [0, 5, 12, 18, 28];
export const PAY_MODES = { bank: 'Bank transfer', upi: 'UPI', cash: 'Cash', cheque: 'Cheque', card: 'Card' };

async function audit(env, me, action, entity, id, detail) {
  await env.DB.prepare('INSERT INTO cl_audit (staff_id, staff_name, action, entity, entity_id, detail) VALUES (?,?,?,?,?,?)').bind(me.id, me.name, action, entity, id || null, detail ? String(detail).slice(0, 500) : null).run();
}
async function nextNo(env, table, col, prefix) {
  const y = today().slice(0, 4), pre = `${prefix}/${y}/`;
  const last = await env.DB.prepare(`SELECT ${col} n FROM ${table} WHERE ${col} LIKE ? ORDER BY length(${col}) DESC, ${col} DESC LIMIT 1`).bind(pre + '%').first();
  return pre + String((last ? parseInt(last.n.slice(pre.length), 10) || 0 : 0) + 1).padStart(5, '0');
}

/* ---------------- router ---------------- */
export async function stockRoute(request, env, me, p, m, b, q) {
  let r;
  if (p === '/suppliers' && m === 'GET') return api({ ok: true, suppliers: await suppliers(env) });
  if (p === '/suppliers' && m === 'POST') { if (!canManage(me)) return deny(); return done(await saveSupplier(env, me, null, b)); }
  if ((r = p.match(/^\/suppliers\/(\d+)$/)) && m === 'GET') { const d = await supplierDetail(env, +r[1]); return d ? api({ ok: true, ...d }) : api({ ok: false, error: 'Not found' }, 404); }
  if ((r = p.match(/^\/suppliers\/(\d+)$/)) && m === 'PUT') { if (!canManage(me)) return deny(); return done(await saveSupplier(env, me, +r[1], b)); }
  if (p === '/supplier-payments' && m === 'POST') { if (!canManage(me)) return deny(); return done(await addSupplierPayment(env, me, b)); }
  if ((r = p.match(/^\/supplier-payments\/(\d+)\/void$/)) && m === 'POST') { if (!canManage(me)) return deny(); return done(await voidSupplierPayment(env, me, +r[1], b)); }

  if (p === '/stock' && m === 'GET') { const [items, alerts] = await Promise.all([stockList(env), stockAlerts(env)]); return api({ ok: true, items, alerts }); }
  if ((r = p.match(/^\/stock\/(\d+)$/)) && m === 'GET') { const d = await itemStock(env, +r[1]); return d ? api({ ok: true, ...d }) : api({ ok: false, error: 'Not found' }, 404); }
  if ((r = p.match(/^\/stock\/(\d+)\/settings$/)) && m === 'PUT') { if (!canManage(me)) return deny(); return done(await saveStockSettings(env, me, +r[1], b)); }
  if (p === '/stock/products' && m === 'POST') { if (!canManage(me)) return deny(); return done(await newProduct(env, me, b)); }
  if ((r = p.match(/^\/stock\/(\d+)\/batches$/)) && m === 'POST') { if (!canManage(me)) return deny(); return done(await addBatches(env, me, +r[1], b)); }
  if (p === '/stock/move' && m === 'POST') { if (b.kind !== 'use' && !canManage(me)) return deny(); return done(await manualMove(env, me, b)); }

  if (p === '/pos' && m === 'GET') return api({ ok: true, pos: await listPOs(env, q('status')) });
  if (p === '/pos' && m === 'POST') return done(await savePO(env, me, null, b));
  if ((r = p.match(/^\/pos\/(\d+)$/)) && m === 'GET') { const d = await poDetail(env, +r[1]); return d ? api({ ok: true, ...d }) : api({ ok: false, error: 'Not found' }, 404); }
  if ((r = p.match(/^\/pos\/(\d+)$/)) && m === 'PUT') return done(await savePO(env, me, +r[1], b));
  if ((r = p.match(/^\/pos\/(\d+)$/)) && m === 'DELETE') return done(await deletePO(env, me, +r[1]));
  if ((r = p.match(/^\/pos\/(\d+)\/(approve|cancel|close)$/)) && m === 'POST') { if (!canManage(me)) return deny(); return done(await poAction(env, me, +r[1], r[2], b)); }
  if ((r = p.match(/^\/pos\/(\d+)\/pdf$/)) && m === 'GET') return poPdfResponse(env, request, +r[1]);

  if (p === '/grns' && m === 'GET') return api({ ok: true, grns: await listGRNs(env, q('from'), q('to')) });
  if (p === '/grns' && m === 'POST') return done(await postGRN(env, me, b));
  if ((r = p.match(/^\/grns\/(\d+)$/)) && m === 'GET') { const d = await grnDetail(env, +r[1]); return d ? api({ ok: true, ...d }) : api({ ok: false, error: 'Not found' }, 404); }

  if (p === '/reports/purchases' && m === 'GET') return api({ ok: true, ...(await purchaseSummary(env, q('month'))) });
  if (p === '/reports/stock-value' && m === 'GET') return api({ ok: true, ...(await stockValue(env)) });
  return null;
}

/* ---------------- suppliers ---------------- */
async function suppliers(env) {
  const { results } = await env.DB.prepare(`SELECT s.*,
      (SELECT COALESCE(SUM(total),0) FROM cl_grns g WHERE g.supplier_id=s.id) billed,
      (SELECT COALESCE(SUM(amount),0) FROM cl_supplier_payments sp WHERE sp.supplier_id=s.id AND sp.voided=0) paid,
      (SELECT COUNT(*) FROM cl_pos p WHERE p.supplier_id=s.id AND p.status IN ('approved','part_received')) open_pos
    FROM cl_suppliers s ORDER BY s.active DESC, s.name`).all();
  return (results || []).map(s => ({ ...s, balance: r2(s.billed - s.paid) }));
}
async function supplierDetail(env, id) {
  const s = (await suppliers(env)).find(x => x.id === id);
  if (!s) return null;
  const [grns, pays, pos] = await Promise.all([
    env.DB.prepare('SELECT id, grn_no, received_date, supplier_invoice_no, total, legacy FROM cl_grns WHERE supplier_id=? ORDER BY received_date DESC, id DESC LIMIT 100').bind(id).all(),
    env.DB.prepare('SELECT p.*, st.name staff_name FROM cl_supplier_payments p LEFT JOIN ems_staff st ON st.id=p.staff_id WHERE p.supplier_id=? ORDER BY p.paid_on DESC, p.id DESC LIMIT 100').bind(id).all(),
    env.DB.prepare('SELECT id, po_no, order_date, status, total FROM cl_pos WHERE supplier_id=? ORDER BY id DESC LIMIT 50').bind(id).all(),
  ]);
  return { supplier: s, grns: grns.results || [], payments: pays.results || [], pos: pos.results || [] };
}
async function saveSupplier(env, me, id, b) {
  const name = clean(b.name, 120);
  if (name.length < 2) return R(400, 'Enter the supplier name.');
  const gstin = clean(b.gstin, 15).toUpperCase();
  if (gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) return R(400, 'That GSTIN does not look right (15 characters, e.g. 32ABCDE1234F1Z5).');
  const f = [name, nz(clean(b.contact, 80)), nz(clean(b.phone, 20)), nz(clean(b.email, 120)), nz(gstin), nz(clean(b.address, 300)), nz(clean(b.city, 60)), nz(clean(b.state, 40)), Math.max(0, parseInt(b.terms_days, 10) || 0), nz(clean(b.notes, 300))];
  if (id) await env.DB.prepare('UPDATE cl_suppliers SET name=?, contact=?, phone=?, email=?, gstin=?, address=?, city=?, state=?, terms_days=?, notes=?, active=? WHERE id=?').bind(...f, b.active === false ? 0 : 1, id).run();
  else id = (await env.DB.prepare('INSERT INTO cl_suppliers (name, contact, phone, email, gstin, address, city, state, terms_days, notes) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(...f).run()).meta.last_row_id;
  await audit(env, me, 'supplier.save', 'supplier', id, name);
  return OK({ id });
}
async function addSupplierPayment(env, me, b) {
  const sid = parseInt(b.supplier_id, 10), amount = r2(b.amount), mode = PAY_MODES[b.mode] ? b.mode : null;
  if (!(await env.DB.prepare('SELECT 1 FROM cl_suppliers WHERE id=?').bind(sid).first())) return R(400, 'Choose the supplier.');
  if (!(amount > 0)) return R(400, 'Enter the amount paid.');
  if (!mode) return R(400, 'Choose how it was paid.');
  const ref = clean(b.reference, 80);
  if (mode !== 'cash' && ref.length < 3) return R(400, 'Enter the payment reference (UTR / cheque no.).');
  const paidOn = isDate(b.paid_on) && b.paid_on <= today() ? b.paid_on : today();
  const res = await env.DB.prepare('INSERT INTO cl_supplier_payments (supplier_id, grn_id, po_id, amount, paid_on, mode, reference, notes, staff_id) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(sid, parseInt(b.grn_id, 10) || null, parseInt(b.po_id, 10) || null, amount, paidOn, mode, nz(ref), nz(clean(b.notes, 200)), me.id).run();
  await audit(env, me, 'supplier.pay', 'supplier', sid, `₹${amount} ${mode} ${ref}`);
  return OK({ id: res.meta.last_row_id });
}
async function voidSupplierPayment(env, me, id, b) {
  const reason = clean(b.reason, 200); if (reason.length < 5) return R(400, 'Give the reason.');
  const p = await env.DB.prepare('SELECT * FROM cl_supplier_payments WHERE id=? AND voided=0').bind(id).first();
  if (!p) return R(404, 'Not found.');
  await env.DB.prepare('UPDATE cl_supplier_payments SET voided=1, notes=? WHERE id=?').bind(`${p.notes ? p.notes + ' · ' : ''}Voided: ${reason}`, id).run();
  await audit(env, me, 'supplier.pay_void', 'supplier', p.supplier_id, reason);
  return OK();
}

/* ---------------- stock ---------------- */
const ONHAND = '(SELECT COALESCE(SUM(qty),0) FROM cl_stock_moves m WHERE m.item_id=i.id)';
async function stockList(env) {
  const { results } = await env.DB.prepare(`SELECT i.id, i.code, i.name, i.dept_id, i.category, i.unit, i.price, i.mrp, i.cost, i.avg_cost, i.sellable, i.active,
      i.track_stock, i.track_batch, i.reorder_level, i.reorder_qty, i.supplier_id, s.name supplier_name, ${ONHAND} on_hand,
      (SELECT MIN(expiry) FROM cl_batches bt WHERE bt.item_id=i.id AND bt.qty_left > 0 AND bt.expiry IS NOT NULL) next_expiry
    FROM cl_items i LEFT JOIN cl_suppliers s ON s.id=i.supplier_id
    WHERE i.kind='product' AND (i.track_stock=1 OR EXISTS (SELECT 1 FROM cl_stock_moves m WHERE m.item_id=i.id))
    ORDER BY i.name`).all();
  return (results || []).map(x => ({ ...x, on_hand: r3(x.on_hand), value: r2(Math.max(0, x.on_hand) * (x.avg_cost ?? x.cost ?? 0)) }));
}
export function stockAlertStmts(env) {
  const d60 = new Date(Date.now() + IST + 60 * 864e5).toISOString().slice(0, 10);
  return [
    env.DB.prepare(`SELECT COUNT(*) n FROM cl_items i WHERE i.kind='product' AND i.track_stock=1 AND i.active=1 AND i.reorder_level > 0 AND ${ONHAND} <= i.reorder_level`),
    env.DB.prepare('SELECT COUNT(*) n FROM cl_batches WHERE qty_left > 0 AND expiry IS NOT NULL AND expiry <= ?').bind(d60),
    env.DB.prepare("SELECT COUNT(*) n FROM cl_pos WHERE status IN ('approved','part_received') AND legacy=0"),
    env.DB.prepare("SELECT COUNT(*) n FROM cl_pos WHERE status='draft'"),
  ];
}
export function stockAlertsFrom([low, exp, pend, drafts]) {
  return { low: low.results[0].n, expiring: exp.results[0].n, open_pos: pend.results[0].n, draft_pos: drafts.results[0].n };
}
export async function stockAlerts(env) { return stockAlertsFrom(await env.DB.batch(stockAlertStmts(env))); }
async function itemStock(env, id) {
  const item = await env.DB.prepare(`SELECT i.*, s.name supplier_name, ${ONHAND} on_hand FROM cl_items i LEFT JOIN cl_suppliers s ON s.id=i.supplier_id WHERE i.id=?`).bind(id).first();
  if (!item) return null;
  const [batches, moves] = await Promise.all([
    env.DB.prepare('SELECT * FROM cl_batches WHERE item_id=? AND qty_left > 0 ORDER BY CASE WHEN expiry IS NULL THEN 1 ELSE 0 END, expiry, id').bind(id).all(),
    env.DB.prepare(`SELECT m.*, b.batch_no, b.expiry,
        CASE m.ref_type WHEN 'invoice' THEN (SELECT invoice_no FROM cl_invoices WHERE id=m.ref_id) WHEN 'grn' THEN (SELECT grn_no FROM cl_grns WHERE id=m.ref_id) END ref_no
      FROM cl_stock_moves m LEFT JOIN cl_batches b ON b.id=m.batch_id WHERE m.item_id=? ORDER BY m.id DESC LIMIT 100`).bind(id).all(),
  ]);
  return { item: { ...item, on_hand: r3(item.on_hand) }, batches: batches.results || [], moves: moves.results || [] };
}
async function saveStockSettings(env, me, id, b) {
  const lvl = b.reorder_level === '' || b.reorder_level == null ? null : num(b.reorder_level);
  const rq = b.reorder_qty === '' || b.reorder_qty == null ? null : num(b.reorder_qty);
  if ((lvl != null && !(lvl >= 0)) || (rq != null && !(rq >= 0))) return R(400, 'Reorder level and quantity must be 0 or more.');
  await env.DB.prepare('UPDATE cl_items SET track_stock=?, track_batch=?, reorder_level=?, reorder_qty=?, supplier_id=? WHERE id=?')
    .bind(b.track_stock === false ? 0 : 1, b.track_batch ? 1 : 0, lvl, rq, parseInt(b.supplier_id, 10) || null, id).run();
  await audit(env, me, 'stock.settings', 'item', id);
  return OK();
}
// Take stock out first-expiry-first-out. Anything beyond the batches on hand goes out unbatched (stock can go negative).
async function takeOut(env, me, itemId, qty, kind, refType, refId, reason, batchId) {
  const item = await env.DB.prepare('SELECT avg_cost, cost FROM cl_items WHERE id=?').bind(itemId).first();
  const cost = item ? (item.avg_cost ?? item.cost ?? null) : null;
  let left = qty;
  const { results: bs } = batchId
    ? await env.DB.prepare('SELECT id, qty_left FROM cl_batches WHERE id=? AND item_id=?').bind(batchId, itemId).all()
    : await env.DB.prepare('SELECT id, qty_left FROM cl_batches WHERE item_id=? AND qty_left > 0 ORDER BY CASE WHEN expiry IS NULL THEN 1 ELSE 0 END, expiry, id').bind(itemId).all();
  for (const bt of bs || []) {
    if (left <= 1e-9) break;
    const take = Math.min(left, bt.qty_left);
    if (take <= 0) continue;
    await env.DB.prepare('UPDATE cl_batches SET qty_left=qty_left-? WHERE id=?').bind(take, bt.id).run();
    await env.DB.prepare('INSERT INTO cl_stock_moves (item_id, batch_id, qty, unit_cost, kind, ref_type, ref_id, reason, staff_id, staff_name) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(itemId, bt.id, -take, cost, kind, refType, refId, reason, me.id, me.name).run();
    left = r3(left - take);
  }
  if (left > 1e-9) await env.DB.prepare('INSERT INTO cl_stock_moves (item_id, batch_id, qty, unit_cost, kind, ref_type, ref_id, reason, staff_id, staff_name) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(itemId, null, -left, cost, kind, refType, refId, reason, me.id, me.name).run();
}
async function putIn(env, me, itemId, qty, unitCost, kind, refType, refId, reason, batch) {
  // Moving average cost.
  const it = await env.DB.prepare(`SELECT avg_cost, cost, ${ONHAND} on_hand FROM cl_items i WHERE id=?`).bind(itemId).first();
  const base = Math.max(0, it.on_hand), prev = it.avg_cost ?? it.cost ?? unitCost;
  const avg = base + qty > 0 && unitCost != null ? (base * (prev || 0) + qty * unitCost) / (base + qty) : prev;
  let batchId = null;
  if (batch && (batch.batch_no || batch.expiry)) {
    const ex = await env.DB.prepare('SELECT id FROM cl_batches WHERE item_id=? AND IFNULL(batch_no,\'\')=? AND IFNULL(expiry,\'\')=?').bind(itemId, batch.batch_no || '', batch.expiry || '').first();
    if (ex) { batchId = ex.id; await env.DB.prepare('UPDATE cl_batches SET qty_left=qty_left+? WHERE id=?').bind(qty, batchId).run(); }
    else batchId = (await env.DB.prepare('INSERT INTO cl_batches (item_id, batch_no, expiry, unit_cost, qty_left) VALUES (?,?,?,?,?)').bind(itemId, nz(batch.batch_no), nz(batch.expiry), unitCost, qty).run()).meta.last_row_id;
  }
  await env.DB.prepare('INSERT INTO cl_stock_moves (item_id, batch_id, qty, unit_cost, kind, ref_type, ref_id, reason, staff_id, staff_name) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(itemId, batchId, qty, unitCost, kind, refType, refId, reason, me.id, me.name).run();
  await env.DB.prepare('UPDATE cl_items SET avg_cost=?, track_stock=1 WHERE id=?').bind(avg == null ? null : Math.round(avg * 10000) / 10000, itemId).run();
  return batchId;
}
// Batch rows from the UI: [{batch_no, expiry, qty, unit_cost}]. Products that track batches need a batch number
// and expiry on every row; an expired batch is refused (it should not go into saleable stock).
function readBatches(rows, needBatch) {
  const list = (Array.isArray(rows) ? rows : []).slice(0, 30).map(x => ({ batch_no: clean(x.batch_no, 40).toUpperCase(), expiry: isDate(x.expiry) ? x.expiry : null, qty: r3(x.qty), unit_cost: x.unit_cost === '' || x.unit_cost == null ? null : r2(x.unit_cost) }))
    .filter(x => x.batch_no || x.expiry || x.qty);
  for (const [i, x] of list.entries()) {
    const n = list.length > 1 ? ` (row ${i + 1})` : '';
    if (!(x.qty > 0)) return [`Enter the quantity${n}.`];
    if (needBatch && !x.batch_no) return [`Enter the batch number${n} — it is printed on the pack.`];
    if (needBatch && !x.expiry) return [`Enter the expiry date${n}.`];
    if (x.expiry && x.expiry < today()) return [`Batch ${x.batch_no || ''}${n} has already expired (${x.expiry}). Do not add expired stock.`];
    if (x.unit_cost != null && !(x.unit_cost >= 0)) return [`Check the cost${n}.`];
  }
  return [null, list];
}

// A new product with its stock settings and opening batches, in one step.
async function newProduct(env, me, b) {
  const [f, err] = itemFields({ ...b, kind: 'product', active: 1 });
  if (err) return R(400, err);
  if (f.code && await env.DB.prepare('SELECT 1 FROM cl_items WHERE code=?').bind(f.code).first()) return R(400, 'Another item already uses that code.');
  const dup = await env.DB.prepare("SELECT code FROM cl_items WHERE lower(name)=lower(?) AND kind='product' AND active=1").bind(f.name).first();
  if (dup && !b.allow_same_name) return R(409, `A product called "${f.name}" already exists${dup.code ? ` (${dup.code})` : ''}. Add stock to it from the Stock list instead.`, { code: 'same_name' });
  const trackBatch = b.track_batch === false ? 0 : 1, trackStock = b.track_stock === false ? 0 : 1;
  const [berr, batches] = readBatches(b.batches, trackBatch && trackStock);
  if (berr) return R(400, berr);
  const lvl = b.reorder_level === '' || b.reorder_level == null ? null : num(b.reorder_level), rq = b.reorder_qty === '' || b.reorder_qty == null ? null : num(b.reorder_qty);
  if ((lvl != null && !(lvl >= 0)) || (rq != null && !(rq >= 0))) return R(400, 'Reorder level and quantity must be 0 or more.');
  const res = await env.DB.prepare(`INSERT INTO cl_items (code, name, dept_id, category, kind, price, gst_rate, hsn_sac, cost, active, notes, sellable, unit, mrp, track_stock, track_batch, reorder_level, reorder_qty, supplier_id)
      VALUES (?,?,?,?, 'product', ?,?,?,?,1,?,?,?,?,?,?,?,?,?)`)
    .bind(f.code, f.name, f.dept_id, f.category, f.price, f.gst_rate, f.hsn_sac, f.cost, f.notes, f.sellable, f.unit, f.mrp, trackStock, trackBatch, lvl, rq, parseInt(b.supplier_id, 10) || null).run();
  const id = res.meta.last_row_id;
  for (const x of batches) await putIn(env, me, id, x.qty, x.unit_cost ?? f.cost ?? null, 'opening', null, null, 'Opening stock (new product)', x);
  await audit(env, me, 'item.add', 'item', id, `${f.name} (product) ₹${f.price} GST ${f.gst_rate}%${batches.length ? ` · opening ${batches.reduce((n, x) => n + x.qty, 0)} in ${batches.length} batch(es)` : ''}`);
  return OK({ id });
}

// Stock coming in outside a purchase (opening stock, found in a count, free samples): one or more batches.
async function addBatches(env, me, itemId, b) {
  const item = await env.DB.prepare("SELECT id, name, kind, track_batch, cost, avg_cost FROM cl_items WHERE id=?").bind(itemId).first();
  if (!item || item.kind !== 'product') return R(404, 'Product not found.');
  const [berr, batches] = readBatches(b.batches, !!item.track_batch);
  if (berr) return R(400, berr);
  if (!batches.length) return R(400, 'Add at least one batch with a quantity.');
  const why = ['opening', 'count', 'sample', 'return', 'other'].includes(b.why) ? b.why : 'other';
  const label = { opening: 'Opening stock', count: 'Found in physical count', sample: 'Free sample / bonus received', return: 'Returned by patient (unopened)', other: 'Other' }[why];
  const reason = [label, clean(b.note, 150)].filter(Boolean).join(' — ');
  if (why === 'other' && clean(b.note, 150).length < 4) return R(400, 'Say where this stock came from.');
  for (const x of batches) await putIn(env, me, itemId, x.qty, x.unit_cost ?? item.avg_cost ?? item.cost ?? null, why === 'opening' ? 'opening' : 'adjust', null, null, reason, x);
  await audit(env, me, 'stock.add', 'item', itemId, `${batches.reduce((n, x) => n + x.qty, 0)} in ${batches.length} batch(es) · ${reason}`);
  return OK();
}

async function manualMove(env, me, b) {
  const itemId = parseInt(b.item_id, 10), qty = r3(b.qty), kind = b.kind === 'use' ? 'use' : 'adjust';
  const item = await env.DB.prepare("SELECT id, name, kind FROM cl_items WHERE id=?").bind(itemId).first();
  if (!item || item.kind !== 'product') return R(400, 'Choose the product.');
  if (!qty) return R(400, 'Enter the quantity.');
  if (kind === 'use' && qty > 0) return R(400, 'Use in treatment takes stock out — enter the quantity used.');
  const reason = clean(b.reason, 200);
  if (kind === 'adjust' && reason.length < 4) return R(400, 'Give the reason for the adjustment (e.g. physical count, damaged, expired).');
  const batchId = parseInt(b.batch_id, 10) || null;
  if (qty < 0) await takeOut(env, me, itemId, -qty, kind, null, null, reason || 'Used in treatment', batchId);
  else if (batchId) {
    await env.DB.prepare('UPDATE cl_batches SET qty_left=qty_left+? WHERE id=? AND item_id=?').bind(qty, batchId, itemId).run();
    await env.DB.prepare('INSERT INTO cl_stock_moves (item_id, batch_id, qty, kind, reason, staff_id, staff_name) VALUES (?,?,?,?,?,?,?)').bind(itemId, batchId, qty, kind, reason, me.id, me.name).run();
  } else await putIn(env, me, itemId, qty, num(b.unit_cost) >= 0 ? num(b.unit_cost) : null, kind, null, null, reason, { batch_no: clean(b.batch_no, 40), expiry: isDate(b.expiry) ? b.expiry : null });
  await audit(env, me, `stock.${kind}`, 'item', itemId, `${qty} · ${reason}`);
  return OK();
}

// Hooks used by billing: products on a finalised invoice go out of stock; a cancelled invoice puts them back.
export async function stockOutForInvoice(env, me, invoiceId) {
  const { results } = await env.DB.prepare("SELECT l.item_id, SUM(l.qty) qty FROM cl_invoice_lines l JOIN cl_items i ON i.id=l.item_id WHERE l.invoice_id=? AND l.kind='product' AND i.track_stock=1 GROUP BY l.item_id").bind(invoiceId).all();
  for (const l of results || []) if (l.qty > 0) await takeOut(env, me, l.item_id, l.qty, 'sale', 'invoice', invoiceId, null, null);
}
export async function stockBackForInvoice(env, me, invoiceId) {
  const { results } = await env.DB.prepare("SELECT * FROM cl_stock_moves WHERE ref_type='invoice' AND ref_id=? AND kind='sale'").bind(invoiceId).all();
  for (const mv of results || []) {
    if (mv.batch_id) await env.DB.prepare('UPDATE cl_batches SET qty_left=qty_left+? WHERE id=?').bind(-mv.qty, mv.batch_id).run();
    await env.DB.prepare('INSERT INTO cl_stock_moves (item_id, batch_id, qty, unit_cost, kind, ref_type, ref_id, reason, staff_id, staff_name) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(mv.item_id, mv.batch_id, -mv.qty, mv.unit_cost, 'sale_cancel', 'invoice', invoiceId, 'Invoice cancelled', me.id, me.name).run();
  }
}

/* ---------------- purchase orders ---------------- */
async function listPOs(env, status) {
  const where = status === 'open' ? "WHERE p.status IN ('draft','approved','part_received')" : status && status !== 'all' ? 'WHERE p.status=?' : '';
  const { results } = await env.DB.prepare(`SELECT p.*, s.name supplier_name FROM cl_pos p JOIN cl_suppliers s ON s.id=p.supplier_id ${where} ORDER BY p.id DESC LIMIT 300`)
    .bind(...(where.includes('?') ? [status] : [])).all();
  return results || [];
}
async function poDetail(env, id) {
  const po = await env.DB.prepare('SELECT p.*, s.name supplier_name, s.gstin supplier_gstin, s.address supplier_address, s.city supplier_city, s.phone supplier_phone, s.email supplier_email, a.name approved_by_name, c.name created_by_name FROM cl_pos p JOIN cl_suppliers s ON s.id=p.supplier_id LEFT JOIN ems_staff a ON a.id=p.approved_by LEFT JOIN ems_staff c ON c.id=p.created_by WHERE p.id=?').bind(id).first();
  if (!po) return null;
  const { results: lines } = await env.DB.prepare(`SELECT l.*, i.code, i.unit, i.track_batch FROM cl_po_lines l LEFT JOIN cl_items i ON i.id=l.item_id WHERE l.po_id=? ORDER BY l.id`).bind(id).all();
  const { results: grns } = await env.DB.prepare('SELECT id, grn_no, received_date, supplier_invoice_no, total FROM cl_grns WHERE po_id=? ORDER BY id').bind(id).all();
  return { po, lines: lines || [], grns: grns || [] };
}
async function priceLines(env, raw) {
  const lines = [];
  for (const l of Array.isArray(raw) ? raw : []) {
    const itemId = parseInt(l.item_id, 10), qty = r3(l.qty), cost = r2(l.unit_cost), rate = Number(l.gst_rate);
    if (!itemId && !qty) continue;
    const it = await env.DB.prepare('SELECT id, name, kind FROM cl_items WHERE id=?').bind(itemId).first();
    if (!it || it.kind !== 'product') return [null, 'One of the lines is not a product in the catalogue.'];
    if (!(qty > 0)) return [null, `Enter the quantity for ${it.name}.`];
    if (!(cost >= 0)) return [null, `Enter the cost for ${it.name}.`];
    if (!GST_RATES.includes(rate)) return [null, `Choose the GST rate for ${it.name}.`];
    const tax = r2(qty * cost * rate / 100);
    lines.push({ item_id: itemId, name: it.name, qty, unit_cost: cost, gst_rate: rate, tax, total: r2(qty * cost + tax) });
  }
  return [lines];
}
async function savePO(env, me, id, b) {
  const sid = parseInt(b.supplier_id, 10);
  if (!(await env.DB.prepare('SELECT 1 FROM cl_suppliers WHERE id=? AND active=1').bind(sid).first())) return R(400, 'Choose the supplier.');
  if (id) { const ex = await env.DB.prepare('SELECT status FROM cl_pos WHERE id=?').bind(id).first(); if (!ex) return R(404, 'Not found.'); if (ex.status !== 'draft') return R(400, 'Only draft orders can be changed.'); }
  const [lines, err] = await priceLines(env, b.lines);
  if (err) return R(400, err);
  if (!lines.length) return R(400, 'Add at least one product.');
  const sub = r2(lines.reduce((s, l) => s + l.qty * l.unit_cost, 0)), tax = r2(lines.reduce((s, l) => s + l.tax, 0));
  const od = isDate(b.order_date) ? b.order_date : today(), ed = isDate(b.expected_date) ? b.expected_date : null;
  if (id) {
    await env.DB.prepare('UPDATE cl_pos SET supplier_id=?, order_date=?, expected_date=?, subtotal=?, tax=?, total=?, notes=? WHERE id=?').bind(sid, od, ed, sub, tax, r2(sub + tax), nz(clean(b.notes, 300)), id).run();
    await env.DB.prepare('DELETE FROM cl_po_lines WHERE po_id=?').bind(id).run();
  } else {
    for (let a = 0; a < 5 && !id; a++) {
      const no = await nextNo(env, 'cl_pos', 'po_no', 'PO');
      try { id = (await env.DB.prepare('INSERT INTO cl_pos (po_no, supplier_id, order_date, expected_date, subtotal, tax, total, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?)').bind(no, sid, od, ed, sub, tax, r2(sub + tax), nz(clean(b.notes, 300)), me.id).run()).meta.last_row_id; }
      catch (e) { if (!/UNIQUE/i.test(String(e))) throw e; }
    }
  }
  for (const l of lines) await env.DB.prepare('INSERT INTO cl_po_lines (po_id, item_id, name, qty, unit_cost, gst_rate, tax, total) VALUES (?,?,?,?,?,?,?,?)').bind(id, l.item_id, l.name, l.qty, l.unit_cost, l.gst_rate, l.tax, l.total).run();
  await audit(env, me, 'po.save', 'po', id);
  return OK({ id });
}
async function deletePO(env, me, id) {
  const po = await env.DB.prepare('SELECT status FROM cl_pos WHERE id=?').bind(id).first();
  if (!po || po.status !== 'draft') return R(400, 'Only draft orders can be deleted.');
  await env.DB.prepare('DELETE FROM cl_po_lines WHERE po_id=?').bind(id).run();
  await env.DB.prepare('DELETE FROM cl_pos WHERE id=?').bind(id).run();
  await audit(env, me, 'po.delete', 'po', id);
  return OK();
}
async function poAction(env, me, id, action, b) {
  const po = await env.DB.prepare('SELECT * FROM cl_pos WHERE id=?').bind(id).first();
  if (!po) return R(404, 'Not found.');
  if (action === 'approve') {
    if (po.status !== 'draft') return R(400, 'Only draft orders can be approved.');
    await env.DB.prepare("UPDATE cl_pos SET status='approved', approved_by=?, approved_at=? WHERE id=?").bind(me.id, nowIso(), id).run();
  } else if (action === 'cancel') {
    if (!['draft', 'approved'].includes(po.status)) return R(400, 'Orders with goods received cannot be cancelled — close them instead.');
    await env.DB.prepare("UPDATE cl_pos SET status='cancelled', notes=? WHERE id=?").bind([po.notes, clean(b.reason, 200) && 'Cancelled: ' + clean(b.reason, 200)].filter(Boolean).join(' · ') || null, id).run();
  } else {
    if (!['approved', 'part_received'].includes(po.status)) return R(400, 'Only open orders can be closed.');
    await env.DB.prepare("UPDATE cl_pos SET status='closed', notes=? WHERE id=?").bind([po.notes, clean(b.reason, 200) && 'Closed: ' + clean(b.reason, 200)].filter(Boolean).join(' · ') || null, id).run();
  }
  await audit(env, me, 'po.' + action, 'po', id, po.po_no);
  return OK();
}

/* ---------------- goods received ---------------- */
async function listGRNs(env, from, to) {
  const f = isDate(from) ? from : '0000-01-01', t = isDate(to) ? to : '9999-12-31';
  const { results } = await env.DB.prepare(`SELECT g.*, s.name supplier_name, p.po_no, u.name received_by_name FROM cl_grns g JOIN cl_suppliers s ON s.id=g.supplier_id LEFT JOIN cl_pos p ON p.id=g.po_id LEFT JOIN ems_staff u ON u.id=g.received_by
    WHERE g.received_date BETWEEN ? AND ? ORDER BY g.received_date DESC, g.id DESC LIMIT 300`).bind(f, t).all();
  return results || [];
}
async function grnDetail(env, id) {
  const grn = await env.DB.prepare('SELECT g.*, s.name supplier_name, s.gstin supplier_gstin, p.po_no, u.name received_by_name FROM cl_grns g JOIN cl_suppliers s ON s.id=g.supplier_id LEFT JOIN cl_pos p ON p.id=g.po_id LEFT JOIN ems_staff u ON u.id=g.received_by WHERE g.id=?').bind(id).first();
  if (!grn) return null;
  const { results } = await env.DB.prepare('SELECT l.*, i.code, i.unit FROM cl_grn_lines l LEFT JOIN cl_items i ON i.id=l.item_id WHERE l.grn_id=? ORDER BY l.id').bind(id).all();
  return { grn, lines: results || [] };
}
const stateOf = g => /^\d{2}/.test(g || '') ? g.slice(0, 2) : null;
async function postGRN(env, me, b) {
  const sid = parseInt(b.supplier_id, 10);
  const sup = await env.DB.prepare('SELECT * FROM cl_suppliers WHERE id=?').bind(sid).first();
  if (!sup) return R(400, 'Choose the supplier.');
  const poId = parseInt(b.po_id, 10) || null;
  let poLines = [];
  if (poId) {
    const po = await env.DB.prepare('SELECT * FROM cl_pos WHERE id=?').bind(poId).first();
    if (!po || po.supplier_id !== sid) return R(400, 'That order is not for this supplier.');
    if (!['approved', 'part_received'].includes(po.status)) return R(400, po.status === 'draft' ? 'The order must be approved before goods are received against it.' : 'That order is no longer open.');
    poLines = (await env.DB.prepare('SELECT * FROM cl_po_lines WHERE po_id=?').bind(poId).all()).results || [];
  }
  const rd = isDate(b.received_date) && b.received_date <= today() ? b.received_date : today();
  const invNo = clean(b.supplier_invoice_no, 40), invDate = isDate(b.supplier_invoice_date) ? b.supplier_invoice_date : null;
  if (invNo) {
    const dup = await env.DB.prepare('SELECT grn_no FROM cl_grns WHERE supplier_id=? AND supplier_invoice_no=?').bind(sid, invNo).first();
    if (dup) return R(400, `Supplier invoice ${invNo} is already entered on ${dup.grn_no}.`);
  }
  const lines = [];
  for (const l of Array.isArray(b.lines) ? b.lines : []) {
    const qty = r3(l.qty), free = r3(l.free_qty || 0);
    if (!(qty > 0) && !(free > 0)) continue;
    const it = await env.DB.prepare('SELECT id, name, kind, track_batch FROM cl_items WHERE id=?').bind(parseInt(l.item_id, 10)).first();
    if (!it || it.kind !== 'product') return R(400, 'One of the lines is not a product in the catalogue.');
    if (qty < 0 || free < 0) return R(400, `Quantities for ${it.name} cannot be negative.`);
    const cost = r2(l.unit_cost), rate = Number(l.gst_rate);
    if (!(cost >= 0)) return R(400, `Enter the cost for ${it.name}.`);
    if (!GST_RATES.includes(rate)) return R(400, `Choose the GST rate for ${it.name}.`);
    const batchNo = clean(l.batch_no, 40), expiry = isDate(l.expiry) ? l.expiry : null;
    if (it.track_batch && (!batchNo || !expiry)) return R(400, `${it.name} needs a batch number and expiry date.`);
    if (expiry && expiry < rd) return R(400, `${it.name}: the expiry date has already passed.`);
    const pl = parseInt(l.po_line_id, 10) || null;
    if (pl && !poLines.some(x => x.id === pl && x.item_id === it.id)) return R(400, `${it.name} is not on that order.`);
    const tax = r2(qty * cost * rate / 100);
    lines.push({ po_line_id: pl, item_id: it.id, name: it.name, qty, free_qty: free, unit_cost: cost, gst_rate: rate, tax, total: r2(qty * cost + tax), batch_no: batchNo, expiry });
  }
  if (!lines.length) return R(400, 'Enter the quantity received for at least one product.');
  const s = await settings(env);
  const inter = stateOf(sup.gstin) && stateOf(s.gstin || '32') && stateOf(sup.gstin) !== stateOf(s.gstin || '32');
  const taxable = r2(lines.reduce((a, l) => a + l.qty * l.unit_cost, 0)), tax = r2(lines.reduce((a, l) => a + l.tax, 0));
  const cgst = inter ? 0 : r2(tax / 2), sgst = inter ? 0 : r2(tax - r2(tax / 2)), igst = inter ? tax : 0;
  const adj = r2(Number(b.round_off) || 0);
  if (Math.abs(adj) > 5) return R(400, 'Round-off can be at most ₹5.');
  let id = null, no = null;
  for (let a = 0; a < 5 && !id; a++) {
    no = await nextNo(env, 'cl_grns', 'grn_no', 'GRN');
    try {
      id = (await env.DB.prepare('INSERT INTO cl_grns (grn_no, po_id, supplier_id, received_date, supplier_invoice_no, supplier_invoice_date, taxable, cgst, sgst, igst, total, notes, received_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(no, poId, sid, rd, nz(invNo), invDate, taxable, cgst, sgst, igst, r2(taxable + tax + adj), nz(clean(b.notes, 300)), me.id).run()).meta.last_row_id;
    } catch (e) { if (!/UNIQUE/i.test(String(e))) throw e; }
  }
  for (const l of lines) {
    const inQty = r3(l.qty + l.free_qty), eff = inQty > 0 ? (l.qty * l.unit_cost) / inQty : l.unit_cost;
    const batchId = await putIn(env, me, l.item_id, inQty, eff, 'grn', 'grn', id, l.free_qty ? `incl. ${l.free_qty} free` : null, { batch_no: l.batch_no, expiry: l.expiry });
    await env.DB.prepare('INSERT INTO cl_grn_lines (grn_id, po_line_id, item_id, name, qty, free_qty, unit_cost, gst_rate, tax, total, batch_no, expiry, batch_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, l.po_line_id, l.item_id, l.name, l.qty, l.free_qty, l.unit_cost, l.gst_rate, l.tax, l.total, nz(l.batch_no), l.expiry, batchId).run();
    if (l.unit_cost > 0) await env.DB.prepare('UPDATE cl_items SET cost=? WHERE id=?').bind(l.unit_cost, l.item_id).run();
    if (l.po_line_id) await env.DB.prepare('UPDATE cl_po_lines SET qty_received=qty_received+? WHERE id=?').bind(l.qty + l.free_qty, l.po_line_id).run();
  }
  if (poId) {
    const open = await env.DB.prepare('SELECT COUNT(*) n FROM cl_po_lines WHERE po_id=? AND qty_received < qty - 1e-9').bind(poId).first();
    await env.DB.prepare('UPDATE cl_pos SET status=? WHERE id=?').bind(open.n ? 'part_received' : 'received', poId).run();
  }
  await audit(env, me, 'grn.post', 'grn', id, `${no} · ${sup.name} · ₹${r2(taxable + tax + adj)}`);
  return OK({ id, grn_no: no });
}

/* ---------------- reports ---------------- */
async function purchaseSummary(env, month) {
  const mth = /^\d{4}-\d{2}$/.test(month || '') ? month : today().slice(0, 7);
  const from = mth + '-01', to = mth + '-31';
  const { results: grns } = await env.DB.prepare(`SELECT g.*, s.name supplier_name, s.gstin supplier_gstin FROM cl_grns g JOIN cl_suppliers s ON s.id=g.supplier_id WHERE g.legacy=0 AND g.received_date BETWEEN ? AND ? ORDER BY g.received_date, g.id`).bind(from, to).all();
  const { results: lines } = await env.DB.prepare(`SELECT l.gst_rate rate, SUM(l.qty * l.unit_cost) value, SUM(l.tax) tax, g.igst > 0 inter FROM cl_grn_lines l JOIN cl_grns g ON g.id=l.grn_id WHERE g.legacy=0 AND g.received_date BETWEEN ? AND ? GROUP BY 1, 4`).bind(from, to).all();
  const byRate = {};
  for (const l of lines || []) {
    const k = String(l.rate); byRate[k] = byRate[k] || { rate: l.rate, value: 0, cgst: 0, sgst: 0, igst: 0 };
    byRate[k].value = r2(byRate[k].value + l.value);
    if (l.inter) byRate[k].igst = r2(byRate[k].igst + l.tax); else { byRate[k].cgst = r2(byRate[k].cgst + l.tax / 2); byRate[k].sgst = r2(byRate[k].sgst + l.tax / 2); }
  }
  return { month: mth, grns: grns || [], gst: Object.values(byRate).sort((a, b) => a.rate - b.rate) };
}
async function stockValue(env) {
  const items = (await stockList(env)).filter(x => x.on_hand > 0);
  return { items, total: r2(items.reduce((s, x) => s + x.value, 0)) };
}

/* ---------------- PO PDF ---------------- */
const WIN = /[^\x20-\x7E\xA0-\xFF–—‘’“”•…]/g;
const safe = s => String(s == null ? '' : s).replace(/₹/g, 'Rs.').replace(WIN, '?');
const money = n => (Math.round((n || 0) * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = d => d ? d.split('-').reverse().join('-') : '';
async function poPdfResponse(env, request, id) {
  const d = await poDetail(env, id);
  if (!d) return api({ ok: false, error: 'Not found' }, 404);
  const s = await settings(env);
  const { po, lines } = d;
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Purchase order ${po.po_no}`);
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.12, 0.19, 0.2), muted = rgb(0.37, 0.43, 0.42), teal = rgb(0.204, 0.349, 0.369), line = rgb(0.85, 0.88, 0.87), mist = rgb(0.93, 0.95, 0.95);
  const W = 595.28, H = 841.89, L = 40, Rx = W - 40;
  let page = pdf.addPage([W, H]), y = H - 40;
  const text = (t, x, yy, size = 9, font = reg, color = ink) => page.drawText(safe(t), { x, y: yy, size, font, color });
  const right = (t, x, yy, size = 9, font = reg, color = ink) => page.drawText(safe(t), { x: x - font.widthOfTextAtSize(safe(t), size), y: yy, size, font, color });
  try {
    const res = await env.ASSETS.fetch(new Request(new URL('/img/hasta-wellness-logo.jpg', request.url)));
    if (res.ok) { const img = await pdf.embedJpg(new Uint8Array(await res.arrayBuffer())); const sc = 42 / img.height; page.drawImage(img, { x: L, y: y - 42, width: img.width * sc, height: 42 }); }
  } catch { /* optional */ }
  right(po.status === 'draft' ? 'DRAFT PURCHASE ORDER' : po.status === 'cancelled' ? 'CANCELLED PURCHASE ORDER' : 'PURCHASE ORDER', Rx, y - 12, 13, bold, po.status === 'draft' || po.status === 'cancelled' ? rgb(0.64, 0.23, 0.17) : teal);
  right(s.legal_name, Rx, y - 28, 9, bold); right(`Trading as ${s.trade_name}`, Rx, y - 40, 8, reg, muted);
  y -= 58; right(s.address.slice(0, 90), Rx, y, 8, reg, muted); y -= 10;
  right(`${s.gstin ? 'GSTIN ' + s.gstin + ' · ' : ''}${s.phone} · ${s.email}`, Rx, y, 8, reg, muted); y -= 18;
  page.drawLine({ start: { x: L, y }, end: { x: Rx, y }, thickness: 0.8, color: line }); y -= 16;
  text('Supplier', L, y, 8, bold, muted); text('Order', 360, y, 8, bold, muted); y -= 13;
  text(po.supplier_name, L, y, 10.5, bold); text(`No. ${po.po_no}`, 360, y, 9.5, bold); y -= 12;
  text([po.supplier_city, po.supplier_gstin && 'GSTIN ' + po.supplier_gstin].filter(Boolean).join(' · '), L, y, 8.5, reg, muted); text(`Date ${dmy(po.order_date)}`, 360, y, 8.5, reg, muted); y -= 11;
  text([po.supplier_phone, po.supplier_email].filter(Boolean).join(' · '), L, y, 8.5, reg, muted); if (po.expected_date) text(`Deliver by ${dmy(po.expected_date)}`, 360, y, 8.5, reg, muted); y -= 20;
  const head = () => { page.drawRectangle({ x: L, y: y - 5, width: Rx - L, height: 18, color: mist }); text('Product', L + 4, y, 8, bold, muted); right('Qty', 330, y, 8, bold, muted); right('Rate', 400, y, 8, bold, muted); right('GST', 450, y, 8, bold, muted); right('Amount', Rx - 4, y, 8, bold, muted); y -= 20; };
  head();
  for (const l of lines) {
    if (y < 140) { page = pdf.addPage([W, H]); y = H - 50; head(); }
    text(safe(l.name).slice(0, 52), L + 4, y, 8.5); right(`${l.qty}${l.unit ? ' ' + l.unit.slice(0, 8) : ''}`, 330, y, 8.5); right(money(l.unit_cost), 400, y, 8.5); right(`${l.gst_rate}%`, 450, y, 8, reg, muted); right(money(l.total), Rx - 4, y, 8.5, bold);
    y -= 6; page.drawLine({ start: { x: L, y }, end: { x: Rx, y }, thickness: 0.4, color: line }); y -= 12;
  }
  y -= 4;
  text('Value', 380, y, 8.5, reg, muted); right(money(po.subtotal), Rx - 4, y, 8.5); y -= 13;
  text('GST', 380, y, 8.5, reg, muted); right(money(po.tax), Rx - 4, y, 8.5); y -= 18;
  page.drawRectangle({ x: 375, y: y - 6, width: Rx - 375, height: 20, color: mist });
  text('Order total', 380, y, 10, bold); right('Rs. ' + money(po.total), Rx - 4, y, 10, bold); y -= 26;
  if (po.notes) { text('Notes: ' + safe(po.notes).slice(0, 110), L, y, 8.5, reg, muted); y -= 14; }
  text('Please quote this order number on your invoice and delivery note. Supply batch numbers and expiry dates for medicines and consumables.', L, Math.min(y, 120), 8, reg, muted);
  page.drawLine({ start: { x: L, y: 92 }, end: { x: Rx, y: 92 }, thickness: 0.6, color: line });
  text(po.approved_by_name ? `Approved by ${po.approved_by_name}` : 'Not yet approved', L, 74, 8.5, reg, muted);
  right('Authorised signatory', Rx, 74, 8, reg, muted);
  const bytes = await pdf.save();
  return new Response(bytes, { headers: { ...HEADERS, 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${po.po_no.replace(/[^A-Za-z0-9-]+/g, '-')}.pdf"` } });
}
