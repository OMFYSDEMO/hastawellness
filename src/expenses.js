// Clinic expenses (rent, utilities, petty cash, consultant fees …). Supplier bills stay in Stock → Suppliers.
// Cash expenses and cash supplier payments come out of the cash book (from the opening-balance date).
import { clean, nz } from './util.js';
import { audit } from './hr.js';

const R = (s, e, x) => [s, e, x];
const OK = x => [200, null, x];
const IST = 330 * 60000;
const today = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString().slice(0, 19) + 'Z';
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const r2 = x => Math.round((Number(x) || 0) * 100) / 100;
const parse = (s, f) => { try { return s ? JSON.parse(s) : f; } catch { return f; } };

export const EXP_CATS = ['Rent', 'Electricity & water', 'Internet & phone', 'Salaries & wages', 'Consultant fees', 'Lab & outsourced work', 'Clinic consumables',
  'Housekeeping & cleaning', 'Repairs & maintenance', 'Marketing & advertising', 'Printing & stationery', 'Travel & conveyance', 'Staff welfare & refreshments',
  'Professional fees', 'Bank charges', 'Taxes, licences & fees', 'Equipment', 'Miscellaneous'];
export const EXP_MODES = { cash: 'Cash', upi: 'UPI', card: 'Card', bank: 'Bank transfer / cheque' };
const isMgr = me => me.admin || me.role === 'manager';

export async function listExpenses(env, from, to) {
  const { results } = await env.DB.prepare('SELECT * FROM cl_expenses WHERE spent_on BETWEEN ? AND ? ORDER BY spent_on DESC, id DESC').bind(from, to).all();
  const rows = (results || []).map(x => ({ ...x, receipt: parse(x.receipt, null) ? { name: parse(x.receipt).name } : null }));
  const live = rows.filter(x => !x.voided);
  const by = (k) => Object.entries(live.reduce((a, x) => (a[x[k]] = r2((a[x[k]] || 0) + x.amount), a), {})).map(([key, total]) => ({ key, total })).sort((a, b) => b.total - a.total);
  const { results: sup } = await env.DB.prepare('SELECT p.paid_on, p.amount, p.mode, p.reference, s.name supplier FROM cl_supplier_payments p JOIN cl_suppliers s ON s.id=p.supplier_id WHERE p.voided=0 AND p.paid_on BETWEEN ? AND ? ORDER BY p.paid_on DESC').bind(from, to).all();
  return { from, to, expenses: rows, total: r2(live.reduce((s, x) => s + x.amount, 0)), gst: r2(live.reduce((s, x) => s + (x.gst_amount || 0), 0)), by_category: by('category'), by_mode: by('mode'),
    supplier_payments: sup || [], supplier_total: r2((sup || []).reduce((s, x) => s + x.amount, 0)), categories: EXP_CATS, modes: EXP_MODES };
}

export async function saveExpense(env, me, id, b) {
  const amount = r2(b.amount), gst = b.gst_amount === '' || b.gst_amount == null ? null : r2(b.gst_amount);
  const category = EXP_CATS.includes(b.category) ? b.category : null, mode = EXP_MODES[b.mode] ? b.mode : null;
  const description = clean(b.description, 200), ref = clean(b.reference, 80);
  if (!category) return R(400, 'Choose the category.');
  if (description.length < 3) return R(400, 'Say what it was for.');
  if (!(amount > 0 && amount < 10000000)) return R(400, 'Enter the amount paid.');
  if (gst !== null && !(gst >= 0 && gst < amount)) return R(400, 'GST must be less than the amount paid.');
  if (!mode) return R(400, 'Choose how it was paid.');
  if (mode !== 'cash' && ref.length < 3) return R(400, mode === 'upi' ? 'Enter the UPI reference (UTR).' : 'Enter the payment reference.');
  const on = isDate(b.spent_on) && b.spent_on <= today() ? b.spent_on : null;
  if (!on) return R(400, 'Choose the date paid (not in the future).');
  if (mode === 'cash') {
    const o = await env.DB.prepare("SELECT value FROM cl_settings WHERE key='cash_opening_date'").first();
    if (o && on < o.value) return R(400, `The cash book starts on ${o.value}. Cash spent before that belongs to the previous books.`);
  }
  const receipt = b.receipt && typeof b.receipt === 'object' && /^expenses\//.test(b.receipt.key || '') ? JSON.stringify({ key: b.receipt.key, name: clean(b.receipt.name, 100), type: clean(b.receipt.type, 40) }) : null;
  const vals = [on, category, description, nz(clean(b.payee, 100)), amount, gst, mode, nz(ref), nz(clean(b.bill_no, 60))];
  if (id) {
    if (!isMgr(me)) return R(403, 'Only managers or admins can change an expense.');
    const old = await env.DB.prepare('SELECT * FROM cl_expenses WHERE id=? AND voided=0').bind(id).first();
    if (!old) return R(404, 'Expense not found.');
    await env.DB.prepare(`UPDATE cl_expenses SET spent_on=?, category=?, description=?, payee=?, amount=?, gst_amount=?, mode=?, reference=?, bill_no=?${receipt ? ', receipt=?' : ''} WHERE id=?`).bind(...vals, ...(receipt ? [receipt] : []), id).run();
    await audit(env, me, 'expense.edit', 'expense', id, `${old.amount} → ${amount} ${category} ${description}`);
  } else {
    id = (await env.DB.prepare('INSERT INTO cl_expenses (spent_on, category, description, payee, amount, gst_amount, mode, reference, bill_no, receipt, staff_id, staff_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(...vals, receipt, me.id, me.name).run()).meta.last_row_id;
    await audit(env, me, 'expense.add', 'expense', id, `₹${amount} ${mode} ${category}: ${description}`);
  }
  return OK({ id });
}

export async function voidExpense(env, me, id, b) {
  if (!isMgr(me)) return R(403, 'Only managers or admins can void an expense.');
  const reason = clean(b.reason, 200); if (reason.length < 5) return R(400, 'Give the reason.');
  const x = await env.DB.prepare('SELECT * FROM cl_expenses WHERE id=? AND voided=0').bind(id).first();
  if (!x) return R(404, 'Expense not found.');
  await env.DB.prepare('UPDATE cl_expenses SET voided=1, void_reason=?, voided_by=?, voided_at=? WHERE id=?').bind(reason, me.name, nowIso(), id).run();
  await audit(env, me, 'expense.void', 'expense', id, `₹${x.amount} ${x.category}: ${reason}`);
  return OK();
}

const SIGS = { pdf: [[0x25, 0x50, 0x44, 0x46], 'application/pdf'], jpg: [[0xff, 0xd8, 0xff], 'image/jpeg'], png: [[0x89, 0x50, 0x4e, 0x47], 'image/png'], webp: [[0x52, 0x49, 0x46, 0x46], 'image/webp'] };
export async function uploadReceipt(request, env) {
  const buf = new Uint8Array(await request.arrayBuffer());
  if (!buf.length || buf.length > 8 * 1024 * 1024) return R(400, 'Receipts can be up to 8 MB.');
  const ext = Object.keys(SIGS).find(e => SIGS[e][0].every((x, i) => buf[i] === x));
  if (!ext) return R(400, 'Upload a photo (JPG, PNG) or a PDF.');
  const key = `expenses/${today().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
  await env.CVS.put(key, buf, { httpMetadata: { contentType: SIGS[ext][1] } });
  return OK({ file: { key, name: clean(decodeURIComponent(request.headers.get('x-file-name') || `receipt.${ext}`), 100), type: SIGS[ext][1] } });
}
export async function receiptFile(env, id) {
  const x = await env.DB.prepare('SELECT receipt FROM cl_expenses WHERE id=?').bind(id).first();
  const r = x && parse(x.receipt, null);
  if (!r || !/^expenses\//.test(r.key)) return null;
  const obj = await env.CVS.get(r.key);
  return obj ? { obj, r } : null;
}
