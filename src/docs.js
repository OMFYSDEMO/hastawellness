// Hasta Clinic — staff document repository.
//
// Managers issue memos, notices, policies and training records to all staff or chosen staff, with
// text and/or an attached file (PDF or image). Each recipient opens it in the app, ticks "I have read
// and understood" and types their full name — recorded with time, device and the document's SHA-256
// fingerprint, so the record proves exactly what was signed. Issued documents are never edited;
// a mistake is corrected by withdrawing and issuing a new one.
// Managers also keep each person's file: contracts, ID proofs, certificates, registrations (staff can
// see their own). Warning letters from attendance appear in the same file.
import { PDFDocument, rgb } from './vendor/pdf-lib.esm.min.js';
import { json, clean, nz, sha256 } from './util.js';
import { settings } from './clinic.js';
import { pdfKit, pdfResponse, audit } from './hr.js';
import { FORMS, FORM_LIST, readForm, drawForm } from './forms.js';

const IST = 330 * 60000;
const today = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString().slice(0, 19) + 'Z';
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const HEADERS = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'x-content-type-options': 'nosniff' };
const api = (data, status = 200) => json(data, status, HEADERS);
const canManage = u => u.admin || u.role === 'manager';
export const DOC_KINDS = { memo: 'Memo', notice: 'Notice', policy: 'Policy', training: 'Training record', form: 'Form', warning: 'Warning letter', payslip: 'Payslip', record: 'Staff record' };
const PREFIX = { memo: 'MEMO', notice: 'NOTICE', policy: 'POL', training: 'TRN', form: 'FORM', warning: 'WL', payslip: 'PAY', record: 'REC' };
// Warning letters and payslips can be acknowledged with a dispute ("received, but I do not agree").
const DISPUTABLE = ['warning', 'payslip'];
const safe = t => String(t == null ? '' : t).replace(/₹/g, 'Rs.').replace(/[^\x20-\x7E\xA0-\xFF–—‘’“”•…\n]/g, '?');
const parse = (t, d) => { try { return t ? JSON.parse(t) : d; } catch { return d; } };
export const RECORD_TYPES = { contract: 'Appointment letter / contract', id_proof: 'ID proof', certificate: 'Qualification certificate', registration: 'Professional registration', experience: 'Experience / relieving letter', bank: 'Bank / PF / ESI details', medical: 'Medical fitness', appraisal: 'Appraisal', other: 'Other' };
const FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE = 10 * 1024 * 1024;
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const shaBytes = async buf => hex(await crypto.subtle.digest('SHA-256', buf));
const ip = request => request.headers.get('cf-connecting-ip') || '';
const norm = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
const nameMatches = (typed, real) => { const want = norm(real).replace(/^(dr|mr|mrs|ms)/, ''), got = norm(typed).replace(/^(dr|mr|mrs|ms)/, ''); return got.length >= 3 && (got.includes(want) || want.includes(got)); };

// The issuer's e-signature: they tick "I approve and sign" and type their own name.
export async function signerFor(env, me, request, sig) {
  const sg = sig || {};
  if (sg.agree !== true) return [400, 'Tick "I approve this document and sign it as the issuer".'];
  const who = await env.DB.prepare('SELECT s.name, s.role, p.designation FROM ems_staff s LEFT JOIN cl_staff_pay p ON p.staff_id=s.id WHERE s.id=?').bind(me.id).first();
  const real = (who && who.name) || me.name;
  if (!nameMatches(clean(sg.name, 80), real)) return [400, `Type your full name to sign as the issuer (${real}).`];
  const title = (who && who.designation) || (me.admin ? 'Administrator' : 'Manager');
  return [200, null, { name: clean(sg.name, 80), title, at: nowIso(), ip: request ? ip(request) : '' }];
}

// --- file upload (raw body, like clinical photos) ---
export async function uploadDocFile(request, env, me) {
  if (!canManage(me)) return api({ ok: false, error: 'Managers or admins only.' }, 403);
  if (!env.CVS) return api({ ok: false, error: 'File storage is not set up.' }, 500);
  const type = (request.headers.get('content-type') || '').split(';')[0].trim();
  if (!FILE_TYPES.includes(type)) return api({ ok: false, error: 'Upload a PDF or an image (JPG, PNG).' }, 400);
  const buf = await request.arrayBuffer();
  if (!buf.byteLength) return api({ ok: false, error: 'The file is empty.' }, 400);
  if (buf.byteLength > MAX_FILE) return api({ ok: false, error: 'Files can be up to 10 MB.' }, 400);
  const name = clean(decodeURIComponent(request.headers.get('x-file-name') || 'document'), 120) || 'document';
  const key = `staff-docs/${crypto.randomUUID()}`;
  await env.CVS.put(key, buf, { httpMetadata: { contentType: type } });
  return api({ ok: true, file: { key, name, type, size: buf.byteLength, sha256: await shaBytes(buf) } });
}

async function nextRef(env, kind) {
  const pre = `${PREFIX[kind]}/${today().slice(0, 4)}/`;
  const last = await env.DB.prepare('SELECT ref_no FROM cl_docs WHERE ref_no LIKE ? ORDER BY id DESC LIMIT 1').bind(pre + '%').first();
  return pre + String((last ? parseInt(last.ref_no.slice(pre.length), 10) : 0) + 1).padStart(4, '0');
}

async function issue(env, me, b, request) {
  const kind = DOC_KINDS[b.kind] && !['warning', 'payslip'].includes(b.kind) ? b.kind : null;
  if (!kind) return [400, 'Choose the type of document.'];
  let form = null, prefill = null;
  if (kind === 'form') {
    form = FORMS[b.form_key];
    if (!form) return [400, 'Choose the form.'];
    const [err, vals] = readForm(form, b.prefill, 'issuer');
    if (err) return [400, err];
    prefill = vals;
    if (!clean(b.title, 160)) b.title = form.title;
    if (!String(b.body || '').trim()) b.body = form.intro || form.title;
  }
  const title = clean(b.title, 160), body = String(b.body || '').trim().slice(0, 20000);
  if (title.length < 3) return [400, 'Give the document a title.'];
  const f = b.file || null;
  if (f && !(typeof f.key === 'string' && f.key.startsWith('staff-docs/') && FILE_TYPES.includes(f.type) && /^[a-f0-9]{64}$/.test(f.sha256 || ''))) return [400, 'The attached file is not valid — upload it again.'];
  if (!body && !f) return [400, 'Write the text or attach a file.'];
  if (b.due_date && !isDate(b.due_date)) return [400, 'Check the date to sign by.'];
  let staffIds = [];
  if (kind === 'record') {
    staffIds = [Number(b.staff_id)].filter(Boolean);
    if (!staffIds.length) return [400, 'Choose whose file this record belongs to.'];
  } else if (b.audience === 'all') {
    const { results } = await env.DB.prepare("SELECT id FROM ems_staff WHERE active=1 AND username <> 'hasta' AND role <> 'trainee'").all();
    staffIds = (results || []).map(r => r.id).filter(id => id !== me.id || b.include_me);
  } else staffIds = [...new Set((b.staff_ids || []).map(Number).filter(Boolean))];
  if (!staffIds.length) return [400, 'Choose who receives this document.'];
  if (kind === 'training' && !isDate(b.training_date)) return [400, 'Enter the training date.'];
  const requiresAck = kind === 'record' ? (b.requires_ack ? 1 : 0) : kind === 'form' ? 1 : (b.requires_ack === false ? 0 : 1);
  // Everything issued to staff carries the issuer's e-signature; a record put on file needs it only if the staff member is asked to sign.
  let sig = null;
  if (kind !== 'record' || requiresAck || (b.sign && b.sign.agree)) {
    const [st, err, sg] = await signerFor(env, me, request, b.sign);
    if (st !== 200) return [st, err];
    sig = sg;
  }
  const formDef = form ? JSON.stringify(form) : null, formPre = prefill ? JSON.stringify(prefill) : null;
  const fingerprint = await sha256(JSON.stringify({ title, body, file: f ? f.sha256 : null, ...(form ? { form: formDef, prefill: formPre } : {}) }));
  const ref = await nextRef(env, kind);
  const r = await env.DB.prepare(`INSERT INTO cl_docs (ref_no, kind, title, body, file_key, file_name, file_type, file_size, sha256, requires_ack, due_date, training_date, trainer, training_hours, staff_id, record_type, issued_by, issued_by_name,
      form_key, form_def, form_prefill, issuer_sig_name, issuer_sig_title, issuer_sig_at, issuer_sig_ip)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(ref, kind, title, nz(body), f ? f.key : null, f ? clean(f.name, 120) : null, f ? f.type : null, f ? Number(f.size) || null : null, fingerprint, requiresAck,
    nz(b.due_date), kind === 'training' ? b.training_date : null, kind === 'training' ? nz(clean(b.trainer, 80)) : null, kind === 'training' ? (Number(b.training_hours) || null) : null,
    kind === 'record' ? staffIds[0] : null, kind === 'record' ? (RECORD_TYPES[b.record_type] ? b.record_type : 'other') : null, me.id, me.name,
    form ? b.form_key : null, formDef, formPre, sig ? sig.name : null, sig ? sig.title : null, sig ? sig.at : null, sig ? sig.ip : null).run();
  const id = r.meta.last_row_id;
  await env.DB.batch(staffIds.map(s => env.DB.prepare('INSERT OR IGNORE INTO cl_doc_recipients (doc_id, staff_id) VALUES (?,?)').bind(id, s)));
  await audit(env, me, 'doc.issue', 'doc', id, `${ref} ${title} → ${staffIds.length} staff`);
  return [200, null, { id, ref_no: ref, recipients: staffIds.length }];
}

// A document generated by the app (warning letter, payslip): the PDF is kept in R2 as the document's
// file, signed by the issuer, and sent to the staff member to acknowledge.
export async function issueGenerated(env, me, { kind, ref_no, title, body, bytes, file_name, staff_ids, due_date, source, source_id, sig }) {
  if (!env.CVS) throw new Error('File storage (R2) is not set up.');
  const key = `staff-docs/${crypto.randomUUID()}`;
  await env.CVS.put(key, bytes, { httpMetadata: { contentType: 'application/pdf' } });
  const fileSha = await shaBytes(bytes);
  const fingerprint = await sha256(JSON.stringify({ title, body: body || '', file: fileSha }));
  const ref = ref_no || await nextRef(env, kind);
  const r = await env.DB.prepare(`INSERT INTO cl_docs (ref_no, kind, title, body, file_key, file_name, file_type, file_size, sha256, requires_ack, due_date, issued_by, issued_by_name, source, source_id,
      issuer_sig_name, issuer_sig_title, issuer_sig_at, issuer_sig_ip) VALUES (?,?,?,?,?,?,'application/pdf',?,?,1,?,?,?,?,?,?,?,?,?)`)
    .bind(ref, kind, title, nz(body), key, file_name, bytes.byteLength, fingerprint, nz(due_date), me.id, me.name, source, source_id, sig.name, sig.title, sig.at, sig.ip).run();
  const id = r.meta.last_row_id;
  await env.DB.batch(staff_ids.map(sid => env.DB.prepare('INSERT OR IGNORE INTO cl_doc_recipients (doc_id, staff_id) VALUES (?,?)').bind(id, sid)));
  await audit(env, me, 'doc.issue', 'doc', id, `${ref} ${title} → ${staff_ids.length} staff (generated)`);
  return { id, ref_no: ref };
}

async function docFor(env, me, id) {
  const d = await env.DB.prepare('SELECT * FROM cl_docs WHERE id=?').bind(id).first();
  if (!d) return null;
  const rec = await env.DB.prepare('SELECT * FROM cl_doc_recipients WHERE doc_id=? AND staff_id=?').bind(id, me.id).first();
  if (!canManage(me) && !rec) return null;
  if (!canManage(me) && d.status === 'withdrawn' && !rec.ack_at) return null;
  return { d, rec };
}
const pub = d => ({ id: d.id, ref_no: d.ref_no, kind: d.kind, kind_label: DOC_KINDS[d.kind], title: d.title, body: d.body, has_file: !!d.file_key, file_name: d.file_name, file_type: d.file_type, file_size: d.file_size, sha256: d.sha256,
  requires_ack: !!d.requires_ack, due_date: d.due_date, training_date: d.training_date, trainer: d.trainer, training_hours: d.training_hours, staff_id: d.staff_id, record_type: d.record_type, record_label: d.record_type ? RECORD_TYPES[d.record_type] : null,
  status: d.status, issued_by_name: d.issued_by_name, issued_at: d.issued_at, withdrawn_at: d.withdrawn_at, withdraw_reason: d.withdraw_reason,
  issuer_sig: d.issuer_sig_at ? { name: d.issuer_sig_name, title: d.issuer_sig_title, at: d.issuer_sig_at } : null, source: d.source, source_id: d.source_id,
  form_key: d.form_key, form: parse(d.form_def, null), prefill: parse(d.form_prefill, null), disputable: DISPUTABLE.includes(d.kind), overdue: !!(d.due_date && d.due_date < today()) });

// --- PDFs ---
const fdt = iso => iso ? new Date(Date.parse(iso) + IST).toISOString().replace('T', ' ').slice(0, 16) + ' IST' : '—';
async function ackRecordPdf(env, d, onlyStaff) {
  const s = await settings(env), k = await pdfKit(s);
  const { results } = await env.DB.prepare('SELECT r.*, s.name FROM cl_doc_recipients r JOIN ems_staff s ON s.id=r.staff_id WHERE r.doc_id=? ORDER BY s.name').bind(d.id).all();
  const rows = (results || []).filter(r => !onlyStaff || r.staff_id === onlyStaff);
  k.text(onlyStaff ? 'Acknowledgement' : 'Acknowledgement record', k.L, 15, k.bold); k.y -= 22;
  const kv = (a, b2) => { k.text(a, k.L, 9, k.reg, k.muted); k.wrap(String(b2 || '—'), 9.5, k.reg, k.L + 110, k.W - 110, 13); };
  kv('Reference', d.ref_no); kv('Type', DOC_KINDS[d.kind]); kv('Title', d.title);
  if (d.kind === 'training') kv('Training', `${d.training_date}${d.trainer ? ' · trainer ' + d.trainer : ''}${d.training_hours ? ' · ' + d.training_hours + ' h' : ''}`);
  kv('Issued', `${fdt(d.issued_at)} by ${d.issued_by_name}`);
  if (d.issuer_sig_at) kv('Issuer e-signature', `${d.issuer_sig_name}${d.issuer_sig_title ? ', ' + d.issuer_sig_title : ''} — signed ${fdt(d.issuer_sig_at)}${d.issuer_sig_ip ? ' · ' + d.issuer_sig_ip : ''}`);
  if (d.due_date) kv('To be signed by', d.due_date);
  if (d.file_name) kv('Attached file', d.file_name);
  kv('Fingerprint (SHA-256)', d.sha256);
  if (d.status === 'withdrawn') kv('Withdrawn', `${fdt(d.withdrawn_at)} by ${d.withdrawn_by_name}: ${d.withdraw_reason}`);
  k.y -= 10;
  if (onlyStaff && d.body && !d.form_def && !d.source) { k.text('Document text', k.L, 11, k.bold); k.y -= 16; for (const para of safe(d.body).split('\n')) { if (k.y < 90) k.newPage(); k.wrap(para || ' ', 9.5, k.reg, k.L, k.W, 13); } k.y -= 8; }
  if (k.y < 160) k.newPage();
  const cols = [['Staff member', k.L], ['Opened', k.L + 150], ['Signed', k.L + 260], ['Signed as (typed name)', k.L + 370]];
  for (const [t, x] of cols) k.text(t, x, 8.5, k.bold); k.y -= 14;
  for (const r of rows) {
    if (k.y < 70) k.newPage();
    const red = rgb(0.64, 0.2, 0.16);
    const notSigned = r.refused_at ? 'REFUSED TO SIGN' : d.requires_ack ? (d.due_date && d.due_date < today() ? 'NOT SIGNED (overdue)' : 'NOT SIGNED') : '—';
    k.text(safe(r.name).slice(0, 30), k.L, 9); k.text(r.viewed_at ? fdt(r.viewed_at) : 'not opened', k.L + 150, 8.5, k.reg, r.viewed_at ? k.ink : k.muted);
    k.text(r.ack_at ? fdt(r.ack_at) : notSigned, k.L + 260, 8.5, r.ack_at ? k.reg : k.bold, r.ack_at ? k.ink : red);
    k.text(r.ack_name ? safe(r.ack_name).slice(0, 30) : '', k.L + 370, 9, k.bold); k.y -= 12;
    if (r.ack_at && r.response === 'disputed') { k.text('Acknowledged receipt but DISPUTES the content (see comment)', k.L + 10, 8, k.bold, red); k.y -= 11; }
    if (r.ack_at) { k.text(`${r.ack_sha256 === d.sha256 ? 'Fingerprint matches' : 'FINGERPRINT DIFFERS'}${r.form_sha256 ? ' · answers fingerprint ' + r.form_sha256.slice(0, 16) + '…' : ''} · ${(r.ack_ip || '').slice(0, 40)} · ${safe(r.ack_agent || '').slice(0, 60)}`, k.L + 10, 7, k.reg, k.muted); k.y -= 10; }
    if (r.refused_at) { k.wrap(`Refusal recorded ${fdt(r.refused_at)} by ${safe(r.refused_by_name)}: ${safe(r.refused_note)}`, 8, k.reg, k.L + 10, k.W - 10, 11); }
    if (r.ack_comment) { k.wrap('Comment: ' + safe(r.ack_comment), 8, k.reg, k.L + 10, k.W - 10, 11); }
    k.y -= 4;
  }
  k.y -= 10; if (k.y < 80) k.newPage();
  k.wrap('Each acknowledgement was made in the Hasta Clinic app by the signed-in staff member, who ticked "I have read and understood this document" and typed their full name. The issuer signed in the same way when issuing it. The fingerprint identifies the exact text and file signed; any change to the document would change it.', 8, k.reg, k.L, k.W, 11);
  let pdf = k.pdf;
  // A completed form: the form with the staff member's answers, then the acknowledgement page.
  if (onlyStaff && d.form_def) {
    const rec = rows[0] || {};
    const fk = await pdfKit(await settings(env));
    drawForm(fk, parse(d.form_def, {}), parse(d.form_prefill, {}), parse(rec.form_data, {}), safe(d.title));
    fk.y -= 6; if (fk.y < 110) fk.newPage();
    fk.text('Signatures', fk.L, 11, fk.bold); fk.y -= 15;
    if (d.issuer_sig_at) { fk.wrap(`Issued and e-signed by ${safe(d.issuer_sig_name)}${d.issuer_sig_title ? ', ' + safe(d.issuer_sig_title) : ''} on ${fdt(d.issuer_sig_at)}`, 9, fk.reg, fk.L, fk.W, 12); }
    fk.wrap(rec.ack_at ? `Completed and e-signed by ${safe(rec.ack_name)} on ${fdt(rec.ack_at)}` : 'Not yet completed by the staff member.', 9, fk.bold, fk.L, fk.W, 12);
    const out = await PDFDocument.create();
    for (const part of [fk.pdf, k.pdf]) { const src = await PDFDocument.load(await part.save()); (await out.copyPages(src, src.getPageIndices())).forEach(pg => out.addPage(pg)); }
    pdf = out;
  }
  // A personal signed copy: original PDF pages first, then this acknowledgement page.
  if (onlyStaff && d.file_key && env.CVS) {
    const obj = await env.CVS.get(d.file_key);
    if (obj) {
      const bytes = await obj.arrayBuffer(), out = await PDFDocument.create();
      try {
        if (d.file_type === 'application/pdf') { const src = await PDFDocument.load(bytes, { ignoreEncryption: true }); (await out.copyPages(src, src.getPageIndices())).forEach(p => out.addPage(p)); }
        else { const img = d.file_type === 'image/png' ? await out.embedPng(bytes) : d.file_type === 'image/jpeg' ? await out.embedJpg(bytes) : null; if (img) { const pg = out.addPage([595, 842]); const sc = Math.min(515 / img.width, 762 / img.height, 1); pg.drawImage(img, { x: 40, y: 842 - 40 - img.height * sc, width: img.width * sc, height: img.height * sc }); } }
        const ack = await PDFDocument.load(await k.pdf.save()); (await out.copyPages(ack, ack.getPageIndices())).forEach(p => out.addPage(p));
        pdf = out;
      } catch { /* fall back to the acknowledgement page alone */ }
    }
  }
  return pdfResponse(await pdf.save(), `${d.ref_no.replace(/\//g, '-')}${onlyStaff ? '-signed' : '-record'}.pdf`);
}

// --- router (paths under /hr/docs, so staff with attendance-only access can use them) ---
export async function docsRoute(request, env, url, me, p, m, b, q) {
  if (!p.startsWith('/hr/docs') && !p.startsWith('/hr/staff-file')) return null;
  const mgr = canManage(me); let mm;
  if (p === '/hr/docs/pending' && m === 'GET') {
    const r = await env.DB.prepare("SELECT COUNT(*) n FROM cl_doc_recipients r JOIN cl_docs d ON d.id=r.doc_id WHERE r.staff_id=? AND r.ack_at IS NULL AND d.requires_ack=1 AND d.status='issued'").bind(me.id).first();
    return api({ ok: true, pending: r.n });
  }
  if (p === '/hr/docs/mine' && m === 'GET') {
    const [docs, warn] = await env.DB.batch([
      env.DB.prepare("SELECT d.*, r.viewed_at, r.ack_at, r.ack_name, r.response, r.refused_at FROM cl_doc_recipients r JOIN cl_docs d ON d.id=r.doc_id WHERE r.staff_id=? AND (d.status='issued' OR r.ack_at IS NOT NULL) ORDER BY (r.ack_at IS NULL AND d.requires_ack=1 AND d.status='issued') DESC, d.issued_at DESC").bind(me.id),
      env.DB.prepare('SELECT id, letter_no, days, issued_at, doc_id FROM cl_warnings WHERE staff_id=? ORDER BY id DESC').bind(me.id),
    ]);
    return api({ ok: true, docs: (docs.results || []).map(d => ({ ...pub(d), form: undefined, viewed_at: d.viewed_at, ack_at: d.ack_at, ack_name: d.ack_name, response: d.response, refused_at: d.refused_at })), warnings: warn.results || [] });
  }
  if ((mm = p.match(/^\/hr\/docs\/(\d+)$/)) && m === 'GET') {
    const x = await docFor(env, me, +mm[1]); if (!x) return api({ ok: false, error: 'Not found.' }, 404);
    if (x.rec && !x.rec.viewed_at) { await env.DB.prepare('UPDATE cl_doc_recipients SET viewed_at=? WHERE id=?').bind(nowIso(), x.rec.id).run(); x.rec.viewed_at = nowIso(); }
    let recipients = null;
    if (mgr) { const { results } = await env.DB.prepare('SELECT r.staff_id, s.name, r.viewed_at, r.ack_at, r.ack_name, r.ack_comment, r.ack_sha256, r.response, r.form_data, r.refused_at, r.refused_note, r.refused_by_name FROM cl_doc_recipients r JOIN ems_staff s ON s.id=r.staff_id WHERE r.doc_id=? ORDER BY r.ack_at IS NULL DESC, s.name').bind(x.d.id).all(); recipients = (results || []).map(r => ({ ...r, form_data: parse(r.form_data, null) })); }
    return api({ ok: true, doc: pub(x.d), mine: x.rec ? { viewed_at: x.rec.viewed_at, ack_at: x.rec.ack_at, ack_name: x.rec.ack_name, ack_comment: x.rec.ack_comment, response: x.rec.response, form_data: parse(x.rec.form_data, null), refused_at: x.rec.refused_at } : null, recipients });
  }
  if ((mm = p.match(/^\/hr\/docs\/(\d+)\/file$/)) && m === 'GET') {
    const x = await docFor(env, me, +mm[1]); if (!x || !x.d.file_key) return api({ ok: false, error: 'Not found.' }, 404);
    if (x.rec && !x.rec.viewed_at) await env.DB.prepare('UPDATE cl_doc_recipients SET viewed_at=? WHERE id=?').bind(nowIso(), x.rec.id).run();
    const obj = env.CVS && await env.CVS.get(x.d.file_key); if (!obj) return api({ ok: false, error: 'File not found.' }, 404);
    return new Response(obj.body, { headers: { ...HEADERS, 'content-type': x.d.file_type, 'content-disposition': `inline; filename="${(x.d.file_name || 'document').replace(/"/g, '')}"` } });
  }
  if ((mm = p.match(/^\/hr\/docs\/(\d+)\/ack$/)) && m === 'POST') {
    const x = await docFor(env, me, +mm[1]); if (!x || !x.rec) return api({ ok: false, error: 'Not found.' }, 404);
    if (x.d.status !== 'issued') return api({ ok: false, error: 'This document has been withdrawn.' }, 400);
    if (x.rec.ack_at) return api({ ok: false, error: 'You have already signed this document.' }, 400);
    if (!x.rec.viewed_at) return api({ ok: false, error: 'Open and read the document first.' }, 400);
    if (b.agree !== true) return api({ ok: false, error: 'Tick the box to confirm before signing.' }, 400);
    const response = DISPUTABLE.includes(x.d.kind) && b.response === 'disputed' ? 'disputed' : 'accepted';
    const comment = clean(b.comment, 500);
    if (response === 'disputed' && comment.length < 10) return api({ ok: false, error: 'Say briefly what you disagree with.' }, 400);
    let formData = null, formSha = null;
    if (x.d.form_def) {
      const [err, vals] = readForm(parse(x.d.form_def, {}), b.form, 'staff');
      if (err) return api({ ok: false, error: err }, 400);
      formData = JSON.stringify(vals); formSha = await sha256(formData);
    }
    const name = clean(b.name, 80);
    const who = await env.DB.prepare('SELECT name FROM ems_staff WHERE id=?').bind(me.id).first();
    if (!nameMatches(name, who && who.name)) return api({ ok: false, error: `Type your full name as it appears in the app (${who ? who.name : ''}).` }, 400);
    await env.DB.prepare('UPDATE cl_doc_recipients SET ack_at=?, ack_name=?, ack_comment=?, ack_ip=?, ack_agent=?, ack_sha256=?, response=?, form_data=?, form_sha256=? WHERE id=? AND ack_at IS NULL')
      .bind(nowIso(), name, nz(comment), ip(request), clean(request.headers.get('user-agent'), 200), x.d.sha256, response, formData, formSha, x.rec.id).run();
    await audit(env, me, 'doc.ack', 'doc', x.d.id, `${x.d.ref_no} signed as "${name}"${response === 'disputed' ? ' — DISPUTED' : ''}`);
    return api({ ok: true });
  }
  if ((mm = p.match(/^\/hr\/docs\/(\d+)\/signed\.pdf$/)) && m === 'GET') {
    const x = await docFor(env, me, +mm[1]); if (!x) return api({ ok: false, error: 'Not found.' }, 404);
    const staff = mgr && q('staff') ? +q('staff') : me.id;
    return ackRecordPdf(env, x.d, staff);
  }

  // --- managers ---
  if (!mgr) return api({ ok: false, error: 'Managers or admins only.' }, 403);
  if (p === '/hr/docs' && m === 'GET') {
    const kind = DOC_KINDS[q('kind')] && q('kind') !== 'record' ? q('kind') : null;
    const { results } = await env.DB.prepare(`SELECT d.*, COUNT(r.id) n, SUM(r.ack_at IS NOT NULL) signed, SUM(r.viewed_at IS NOT NULL) viewed, SUM(r.response='disputed') disputed, SUM(r.refused_at IS NOT NULL AND r.ack_at IS NULL) refused
      FROM cl_docs d LEFT JOIN cl_doc_recipients r ON r.doc_id=d.id
      WHERE d.kind <> 'record' ${kind ? 'AND d.kind=?' : ''} GROUP BY d.id ORDER BY d.issued_at DESC LIMIT 300`).bind(...(kind ? [kind] : [])).all();
    return api({ ok: true, docs: (results || []).map(d => ({ ...pub(d), form: undefined, prefill: undefined, recipients: d.n, signed: d.signed || 0, viewed: d.viewed || 0, disputed: d.disputed || 0, refused: d.refused || 0 })), kinds: DOC_KINDS, record_types: RECORD_TYPES, forms: FORM_LIST });
  }
  if (p === '/hr/docs' && m === 'POST') { const [st, err, extra] = await issue(env, me, b, request); return st === 200 ? api({ ok: true, ...extra }) : api({ ok: false, error: err }, st); }
  if (p === '/hr/docs/forms' && m === 'GET') return api({ ok: true, forms: Object.entries(FORMS).map(([key, f]) => ({ key, ...f })) });
  if ((mm = p.match(/^\/hr\/docs\/(\d+)\/refused$/)) && m === 'POST') {
    const note = clean(b.note, 300); if (note.length < 5) return api({ ok: false, error: 'Say what happened (e.g. refused to sign when asked on 12 Nov in front of Sherly).' }, 400);
    const rec = await env.DB.prepare('SELECT r.*, d.ref_no FROM cl_doc_recipients r JOIN cl_docs d ON d.id=r.doc_id WHERE r.doc_id=? AND r.staff_id=?').bind(+mm[1], Number(b.staff_id) || 0).first();
    if (!rec) return api({ ok: false, error: 'Not found.' }, 404);
    if (rec.ack_at) return api({ ok: false, error: 'This person has already signed.' }, 400);
    await env.DB.prepare('UPDATE cl_doc_recipients SET refused_at=?, refused_note=?, refused_by_name=? WHERE id=?').bind(nowIso(), note, me.name, rec.id).run();
    await audit(env, me, 'doc.refused', 'doc', +mm[1], `${rec.ref_no}: staff ${rec.staff_id} refused — ${note}`);
    return api({ ok: true });
  }
  if ((mm = p.match(/^\/hr\/docs\/(\d+)\/withdraw$/)) && m === 'POST') {
    const reason = clean(b.reason, 300); if (reason.length < 5) return api({ ok: false, error: 'Give the reason for withdrawing.' }, 400);
    const d = await env.DB.prepare('SELECT * FROM cl_docs WHERE id=?').bind(+mm[1]).first();
    if (!d || d.status !== 'issued') return api({ ok: false, error: 'Not found or already withdrawn.' }, 400);
    await env.DB.prepare("UPDATE cl_docs SET status='withdrawn', withdrawn_by_name=?, withdrawn_at=?, withdraw_reason=? WHERE id=?").bind(me.name, nowIso(), reason, d.id).run();
    await audit(env, me, 'doc.withdraw', 'doc', d.id, `${d.ref_no}: ${reason}`); return api({ ok: true });
  }
  if ((mm = p.match(/^\/hr\/docs\/(\d+)\/record\.pdf$/)) && m === 'GET') {
    const d = await env.DB.prepare('SELECT * FROM cl_docs WHERE id=?').bind(+mm[1]).first();
    return d ? ackRecordPdf(env, d, null) : api({ ok: false, error: 'Not found.' }, 404);
  }
  if ((mm = p.match(/^\/hr\/staff-file\/(\d+)$/)) && m === 'GET') {
    const sid = +mm[1];
    const [st, recs, issued, warn] = await env.DB.batch([
      env.DB.prepare('SELECT id, name, role, username, active FROM ems_staff WHERE id=?').bind(sid),
      env.DB.prepare("SELECT * FROM cl_docs WHERE kind='record' AND staff_id=? ORDER BY status='issued' DESC, issued_at DESC").bind(sid),
      env.DB.prepare("SELECT d.*, r.viewed_at, r.ack_at, r.ack_name, r.response, r.refused_at FROM cl_doc_recipients r JOIN cl_docs d ON d.id=r.doc_id WHERE r.staff_id=? AND d.kind <> 'record' ORDER BY d.issued_at DESC").bind(sid),
      env.DB.prepare('SELECT id, letter_no, days, issued_at, issued_by_name, doc_id FROM cl_warnings WHERE staff_id=? ORDER BY id DESC').bind(sid),
    ]);
    if (!st.results[0]) return api({ ok: false, error: 'Not found.' }, 404);
    return api({ ok: true, staff: st.results[0], records: (recs.results || []).map(pub), issued: (issued.results || []).map(d => ({ ...pub(d), form: undefined, viewed_at: d.viewed_at, ack_at: d.ack_at, ack_name: d.ack_name, response: d.response, refused_at: d.refused_at })), warnings: warn.results || [], record_types: RECORD_TYPES });
  }
  return null;
}
