// Hasta EMS Academy — staff screens (framework v1.0).
import { api, esc, icon, toast, modal, formData, busy, field, inp, sel, emptyState, today, fDate, fDay, pill, BASE } from './core.js?v=8';

const TABS = [['overview', 'graduation-cap', 'Overview'], ['curriculum', 'book-open', 'Curriculum'], ['questions', 'list-checks', 'Question bank'],
  ['masters', 'stethoscope', 'Master Trainers'], ['trainees', 'users', 'Trainees'], ['certificates', 'award', 'Certificates']];
const fileUrl = key => `${BASE}/api/staff/academy/file?key=${encodeURIComponent(key)}`;
const pct = (a, b) => Math.min(100, Math.round((a / Math.max(1, b)) * 100));
const meter = (a, b) => `<div class="score" style="display:flex;align-items:center;gap:8px"><div class="meter"><i style="width:${pct(a, b)}%"></i></div><span style="font-size:13px;font-weight:700;white-space:nowrap">${a}/${b}</span></div>`;
const tick = (ok, text) => `<li class="${ok ? 'done' : ''}" style="display:flex;gap:8px;align-items:flex-start;padding:4px 0">${icon(ok ? 'check-circle' : 'clock', 18)}<span>${text}</span></li>`;
const CERT_STATUS = c => c.status === 'revoked' ? pill('closed', 'Revoked') : c.status === 'pending' ? pill('warn', 'Awaiting countersignature') : c.valid_until < today() ? pill('alert', 'Expired') : pill('good', 'Valid');

async function upload(file) {
  if (!file) return null;
  if (file.size > 8 * 1024 * 1024) throw new Error('Files must be under 8 MB.');
  const res = await fetch(BASE + '/api/staff/academy/upload', { method: 'POST', headers: { 'content-type': file.type || 'application/octet-stream' }, body: file, credentials: 'same-origin' });
  const d = await res.json().catch(() => ({}));
  if (!d.ok) throw new Error(d.error || 'Upload failed.');
  return { key: d.key, name: file.name };
}

export async function viewAcademy(MAIN, ME, MACHINES, tab = 'overview', go) {
  const ov = await api('/staff/academy');
  const me = ov.me, mName = id => (ov.machines.find(m => m.id === id) || {}).name || 'Machine';
  const approved = ov.curricula.find(c => c.status === 'approved');
  MAIN.innerHTML = `<div class="head"><div><h1>Hasta EMS Academy</h1><p>Training and certification for every trainer, on every machine. Framework v1.0.</p></div>
      <div class="acts">${me.medical_lead ? pill('good', 'Medical lead') : ''}${me.master_on.length ? pill('active', 'Master Trainer') : ''}</div></div>
    <nav class="tabs">${TABS.map(([k, ic, l]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${icon(ic, 17)}${l}</button>`).join('')}</nav><div data-body></div>`;
  MAIN.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => go(`#/academy?tab=${b.dataset.tab}`)));
  const body = MAIN.querySelector('[data-body]');
  const again = () => viewAcademy(MAIN, ME, MACHINES, tab, go);
  const ctx = { ov, me, mName, approved, again, go };
  await ({ overview: tOverview, curriculum: tCurriculum, questions: tQuestions, masters: tMasters, trainees: tTrainees, certificates: tCerts }[tab] || tOverview)(body, ctx);
}

/* ---------- Overview ---------- */
async function tOverview(el, { ov, me, mName, approved }) {
  const { records } = await api('/staff/academy/records?mine=1');
  const masters = ov.people.filter(p => p.master_on.length);
  const r = ov.rules;
  el.innerHTML = `<div class="grid2" style="align-items:start">
    <section class="panel"><div class="panel-h"><div class="t">${icon('clipboard-check', 20)}<h3>Is the Academy ready?</h3></div></div>
      <ul style="list-style:none;margin:0;padding:0">
        ${tick(!!approved, approved ? `Curriculum v${esc(approved.version)} approved by ${esc(approved.approver_name)}` : 'Curriculum awaiting approval by the medical lead')}
        ${tick(ov.test_ready, ov.test_ready ? 'Question bank approved in every area' : 'Question bank needs approval by the medical lead')}
        ${tick(masters.length > 0, masters.length ? `${masters.length} Master Trainer${masters.length === 1 ? '' : 's'}: ${esc(masters.map(p => p.name).join(', '))}` : 'No Master Trainers yet: needs a verified external qualification and the Master Trainer course')}
        ${tick(ov.people.some(p => p.skills.includes('medical_lead')), ov.people.some(p => p.skills.includes('medical_lead')) ? 'Medical lead account set up' : 'Give the medical lead\'s account the "Medical lead" skill (Settings → Team accounts)')}
      </ul></section>
    <section class="panel"><div class="panel-h"><div class="t">${icon('shield-check', 20)}<h3>The standard</h3></div></div>
      <ul class="small" style="margin:0;padding-left:18px;line-height:1.7">
        <li>Theory test: ${r.questions} questions, pass mark ${r.pass_mark}%, ${r.max_attempts} attempts then retraining</li>
        <li>${r.supervised} supervised sessions, including ${r.first_sessions} first sessions with new clients</li>
        <li>Practical assessment: all ${ov.checklist.length} checklist items must pass (${ov.checklist.filter(c => c.crit).length} are safety-critical)</li>
        <li>Certificates are per machine and last ${r.cert_months} months; Master Trainer course renews every ${r.master_months} months</li>
        <li>Nobody certifies, verifies, assesses or logs for themselves</li></ul></section></div>
    <section class="panel" style="margin-top:16px"><div class="panel-h"><div class="t">${icon('graduation-cap', 20)}<h3>My training</h3></div></div>
      ${records.length ? `<div class="rows">${records.map(x => recordRow(x, mName, true)).join('')}</div>` : `<p class="muted">You have no open training. ${me.skills.includes('trainer') ? 'A Master Trainer opens training for you on each machine.' : ''}</p>`}</section>`;
  el.querySelectorAll('[data-take]').forEach(b => b.addEventListener('click', () => takeTest(+b.dataset.take, () => tOverview(el, { ov, me, mName, approved }))));
}

function recordRow(x, mName, mine) {
  const q = x.req;
  const st = x.status === 'certified' ? pill('good', 'Certified') : x.status === 'retraining' ? pill('alert', 'Retraining needed') : x.status === 'closed' ? pill('closed', 'Closed') : q.ready ? pill('good', 'Ready to certify') : pill('warn', 'In training');
  return `<div class="row" style="align-items:flex-start;flex-wrap:wrap;gap:12px"><div class="grow" style="min-width:220px"><b>${mine ? esc(x.machine_name) : esc(x.trainee_name) + ' · ' + esc(x.machine_name)}</b>
      <span>${x.kind === 'renewal' ? 'Renewal' : 'Initial'} · curriculum v${esc(x.curriculum_version)} · opened ${fDate(x.created_at)}${q.renewal ? ` · ${q.renewal.activity} session${q.renewal.activity === 1 ? '' : 's'} on this machine in 12 months${q.renewal.reduced ? ' (reduced renewal)' : ' (full requirements apply)'}` : ''}</span></div>
    <div style="min-width:150px"><div class="small muted">Theory test</div>${q.test.done ? pill('good', `Passed ${q.test.score}%`) : q.test.attempts ? pill('alert', `Last ${q.test.score}% · ${q.test.left} left`) : pill('closed', 'Not taken')}</div>
    <div style="min-width:150px"><div class="small muted">Supervised (${q.logs.first}/${q.logs.need_first} first)</div>${meter(q.logs.count, q.logs.need)}</div>
    <div style="min-width:120px"><div class="small muted">Practical</div>${q.practical.done ? pill('good', 'Passed') : q.practical.last ? pill('alert', 'Not passed') : pill('closed', 'Not done')}</div>
    <div>${st}${mine && x.status === 'in_training' && !q.test.done && q.test.left ? `<div style="margin-top:6px"><button class="btn sm gold" data-take="${x.id}">${icon('pencil', 15)}Take the test</button></div>` : ''}</div></div>`;
}

async function takeTest(recordId, after) {
  let t;
  try { t = await api(`/staff/academy/records/${recordId}/test`, { method: 'POST', body: {} }); } catch (e) { return toast(e.message, true); }
  modal({
    title: `Theory test · ${t.questions.length} questions · pass mark ${t.pass_mark}%`, wide: true,
    body: `<p class="small muted">Answer every question. You can close this window and come back; the same questions stay open until you submit.</p><form data-f class="stack" style="gap:14px">
      ${t.questions.map((q, i) => `<fieldset style="border:1px solid var(--line-soft);border-radius:12px;padding:12px 14px;margin:0"><legend class="small muted">${i + 1} of ${t.questions.length}</legend><b>${esc(q.question)}</b>
        <div class="stack" style="gap:6px;margin-top:8px">${q.options.map((o, j) => `<label class="check"><input type="radio" name="q${q.id}" value="${j}"><span>${esc(o)}</span></label>`).join('')}</div></fieldset>`).join('')}</form>`,
    actions: `<button class="btn ghost" data-close>Close</button><button class="btn gold" data-save>Submit answers</button>`,
    onMount(m, close) {
      const b = m.querySelector('[data-save]');
      b.addEventListener('click', () => {
        const f = formData(m.querySelector('[data-f]')), answers = {};
        t.questions.forEach(q => { if (f['q' + q.id] !== undefined) answers[q.id] = +f['q' + q.id]; });
        if (Object.keys(answers).length < t.questions.length) return toast(`Answer all ${t.questions.length} questions first (${t.questions.length - Object.keys(answers).length} left).`, true);
        busy(b, () => api(`/staff/academy/attempts/${t.attempt_id}`, { method: 'POST', body: { answers } })).then(r => {
          close();
          modal({ title: r.passed ? 'Passed' : 'Not passed', body: `<p style="font-size:18px"><b>${r.score}%</b> (${r.correct} of ${r.total} correct)</p><p class="muted">${r.passed ? 'Well done. Your Master Trainer will now complete your supervised sessions and practical assessment.' : `The pass mark is ${t.pass_mark}%. Talk to your Master Trainer about the areas to revise before your next attempt.`}</p>`, actions: '<button class="btn" data-close>Done</button>' });
          after();
        }).catch(() => {});
      });
    },
  });
}

/* ---------- Curriculum & materials ---------- */
async function tCurriculum(el, ctx) {
  const { ov, me, again } = ctx;
  const { materials } = await api('/staff/academy/materials');
  const canEdit = ME_canManage(me);
  el.innerHTML = `${ov.curricula.map(c => `<section class="panel flush" style="margin-bottom:16px"><div class="panel-h" style="padding:18px 20px 4px"><div class="t">${icon('book-open', 20)}<div><h3>Hasta EMS Trainer Programme v${esc(c.version)}</h3>
        <p class="small muted">${c.status === 'approved' ? `Approved by ${esc(c.approver_name)} on ${fDate(c.approved_at)}` : c.status === 'draft' ? 'Draft: training cannot start until the medical lead approves it' : 'Retired'}${c.notes ? ' · ' + esc(c.notes) : ''}</p></div></div>
        <div class="acts" style="display:flex;gap:8px">${pill(c.status === 'approved' ? 'good' : c.status === 'draft' ? 'warn' : 'closed', c.status === 'approved' ? 'Approved' : c.status === 'draft' ? 'Draft' : 'Retired')}
        ${c.status === 'draft' && me.medical_lead ? `<button class="btn sm gold" data-approve="${c.id}">${icon('check', 16)}Approve v${esc(c.version)}</button>` : ''}
        ${c.status !== 'retired' && canEdit ? `<button class="btn sm ghost" data-mat="${c.id}">${icon('plus', 16)}Add material</button>` : ''}</div></div>
      <table class="t"><thead><tr><th>#</th><th>Module</th><th>Content</th><th>Hours</th><th>Assessed by</th><th>Materials</th></tr></thead><tbody>
      ${c.modules.map(m => { const mats = materials.filter(x => x.curriculum_id === c.id && x.module_no === m.no); return `<tr><td>${m.no}</td><td><b>${esc(m.title)}</b></td><td class="small">${esc(m.content)}</td><td class="small">${esc(m.hours)}</td><td class="small">${esc(m.assessed)}</td>
        <td class="small">${mats.map(x => `<div><a href="${esc(x.kind === 'file' ? fileUrl(x.file_key) : x.url)}" target="_blank" rel="noopener">${icon(x.kind === 'file' ? 'file-text' : 'external-link', 14)} ${esc(x.title)}</a>${x.source ? ` <span class="muted">(${esc(x.source)})</span>` : ''}</div>`).join('') || '<span class="muted">None yet</span>'}</td></tr>`; }).join('')}</tbody></table></section>`).join('')}
    ${canEdit && !ov.curricula.some(c => c.status === 'draft') ? `<button class="btn ghost" data-newver>${icon('plus', 16)}Start a new curriculum version</button>` : ''}
    ${!me.medical_lead ? '<p class="small muted" style="margin-top:10px">Only the medical lead can approve a curriculum. Admins and the medical lead can add materials.</p>' : ''}`;
  el.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', () => {
    if (!confirm('Approve this curriculum? Training records opened from now on use this version, and any previous version is retired.')) return;
    busy(b, () => api(`/staff/academy/curriculum/${b.dataset.approve}/approve`, { method: 'POST', body: {} })).then(() => { toast('Curriculum approved'); again(); }).catch(() => {});
  }));
  el.querySelector('[data-newver]')?.addEventListener('click', () => modal({
    title: 'New curriculum version', body: `<form data-f class="stack" style="gap:12px">${field('Version', inp('version', '', 'placeholder="1.1"'))}${field('What changed', `<textarea class="in" name="notes" maxlength="300"></textarea>`)}<p class="small muted">The new version starts as a copy of the latest modules. It must be approved by the medical lead before use.</p></form>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Create draft</button>`,
    onMount(m, close) { const b = m.querySelector('[data-save]'); b.addEventListener('click', () => busy(b, () => api('/staff/academy/curriculum', { method: 'POST', body: formData(m.querySelector('[data-f]')) })).then(() => { close(); again(); }).catch(() => {})); },
  }));
  el.querySelectorAll('[data-mat]').forEach(b => b.addEventListener('click', () => {
    const c = ov.curricula.find(x => x.id === +b.dataset.mat);
    modal({
      title: `Add material · v${c.version}`, body: `<form data-f class="stack" style="gap:12px">${field('Module', sel('module_no', c.modules.map(m => [m.no, `${m.no}. ${m.title}`])))}${field('Title', inp('title', '', 'maxlength="120" placeholder="e.g. Supplier operator course manual"'))}
        ${field('Source', inp('source', '', 'maxlength="80" placeholder="e.g. Equipment supplier, medical lead"'))}${field('Link', inp('url', '', 'placeholder="https://…"'), 'or upload a file')}${field('File', '<input class="in" type="file" name="file" accept=".pdf,image/*">', 'PDF or image, under 8 MB')}</form>`,
      actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Add</button>`,
      onMount(m, close) {
        const s = m.querySelector('[data-save]');
        s.addEventListener('click', () => busy(s, async () => { const f = formData(m.querySelector('[data-f]')); delete f.file; const up = await upload(m.querySelector('[name=file]').files[0]); if (up) { f.file_key = up.key; f.file_name = up.name; } f.curriculum_id = c.id; return api('/staff/academy/materials', { method: 'POST', body: f }); }).then(() => { close(); toast('Material added'); again(); }).catch(() => {}));
      },
    });
  }));
}
const ME_canManage = me => me.role === 'admin' || me.medical_lead;

/* ---------- Question bank ---------- */
async function tQuestions(el, ctx) {
  const { ov, me, again } = ctx;
  const { questions } = await api('/staff/academy/questions');
  const canEdit = ME_canManage(me);
  const count = (a, s) => questions.filter(q => q.area === a && (!s || q.status === s)).length;
  el.innerHTML = `<section class="panel flush"><div class="panel-h" style="padding:18px 20px 4px"><div class="t">${icon('list-checks', 20)}<div><h3>Question bank</h3><p class="small muted">Each test draws ${ov.rules.questions} approved questions by area. Any edit returns a question to draft for re-approval.</p></div></div>
      <div class="acts" style="display:flex;gap:8px">${canEdit ? `<button class="btn sm ghost" data-newq>${icon('plus', 16)}New question</button>` : ''}${me.medical_lead ? `<button class="btn sm gold" data-approve-sel>${icon('check', 16)}Approve selected</button><button class="btn sm ghost" data-retire-sel>Retire selected</button>` : ''}</div></div>
    <table class="t"><thead><tr><th>Area</th><th class="n">Per test</th><th class="n">Approved</th><th class="n">Draft</th><th>Ready</th></tr></thead><tbody>
      ${Object.entries(ov.blueprint).map(([a, n]) => `<tr><td>${esc(ov.areas[a])}</td><td class="n">${n}</td><td class="n">${count(a, 'approved')}</td><td class="n">${count(a, 'draft')}</td><td>${count(a, 'approved') >= n ? pill('good', 'Ready') : pill('warn', `Needs ${n - count(a, 'approved')}`)}</td></tr>`).join('')}</tbody></table></section>
    <section class="panel flush" style="margin-top:16px">${me.medical_lead ? `<div style="padding:12px 20px 0"><label class="check"><input type="checkbox" data-all> <span>Select all drafts</span></label></div>` : ''}
      <div class="rows">${questions.map(q => `<div class="row" style="align-items:flex-start">${me.medical_lead ? `<input type="checkbox" data-q="${q.id}" data-st="${q.status}" style="width:18px;height:18px;margin-top:3px;accent-color:var(--teal)">` : ''}
        <div class="grow"><b>${esc(q.question)}</b><span class="small">${q.options.map((o, i) => i === q.answer ? `<b style="color:var(--good)">✓ ${esc(o)}</b>` : esc(o)).join(' · ')}</span><span class="small muted">${esc(ov.areas[q.area])}${q.approver_name ? ` · approved by ${esc(q.approver_name)}` : ''}</span></div>
        ${pill(q.status === 'approved' ? 'good' : q.status === 'draft' ? 'warn' : 'closed', q.status[0].toUpperCase() + q.status.slice(1))}${canEdit ? `<button class="btn sm quiet icon" data-edit="${q.id}" aria-label="Edit">${icon('pencil', 16)}</button>` : ''}</div>`).join('')}</div></section>`;
  const picked = () => [...el.querySelectorAll('[data-q]:checked')].map(x => +x.dataset.q);
  el.querySelector('[data-all]')?.addEventListener('change', e => el.querySelectorAll('[data-q][data-st=draft]').forEach(x => { x.checked = e.target.checked; }));
  const bulk = (b, status) => { const ids = picked(); if (!ids.length) return toast('Select questions first.', true); busy(b, () => api('/staff/academy/questions/approve', { method: 'POST', body: { ids, status } })).then(r => { toast(`${r.count} question${r.count === 1 ? '' : 's'} ${status === 'retired' ? 'retired' : 'approved'}`); again(); }).catch(() => {}); };
  el.querySelector('[data-approve-sel]')?.addEventListener('click', e => bulk(e.currentTarget, 'approved'));
  el.querySelector('[data-retire-sel]')?.addEventListener('click', e => bulk(e.currentTarget, 'retired'));
  const edit = q => modal({
    title: q ? 'Edit question' : 'New question', wide: true,
    body: `<form data-f class="stack" style="gap:12px">${field('Area', sel('area', Object.entries(ov.areas), q && q.area))}${field('Question', `<textarea class="in" name="question" maxlength="300">${esc(q ? q.question : '')}</textarea>`)}
      ${[0, 1, 2, 3].map(i => `<div style="display:flex;gap:10px;align-items:center"><label class="check" style="flex:none"><input type="radio" name="answer" value="${i}"${q && q.answer === i ? ' checked' : ''}><span class="small">Correct</span></label>${inp('o' + i, q ? q.options[i] || '' : '', `placeholder="Option ${i + 1}${i === 3 ? ' (optional)' : ''}" maxlength="200" style="flex:1"`)}</div>`).join('')}
      ${field('Explanation (shown to Master Trainers)', inp('explanation', q ? q.explanation || '' : '', 'maxlength="300"'))}</form>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Save as draft</button>`,
    onMount(m, close) {
      const b = m.querySelector('[data-save]');
      b.addEventListener('click', () => { const f = formData(m.querySelector('[data-f]')); const opts = [f.o0, f.o1, f.o2, f.o3]; const body = { area: f.area, question: f.question, answer: f.answer, explanation: f.explanation, options: opts.filter(Boolean) };
        if (f.answer !== undefined && !opts[+f.answer]) return toast('The correct answer must have text.', true);
        busy(b, () => api(q ? `/staff/academy/questions/${q.id}` : '/staff/academy/questions', { method: q ? 'PUT' : 'POST', body })).then(() => { close(); toast('Saved as draft'); again(); }).catch(() => {}); });
    },
  });
  el.querySelector('[data-newq]')?.addEventListener('click', () => edit(null));
  el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => edit(questions.find(q => q.id === +b.dataset.edit))));
}

/* ---------- Master Trainers ---------- */
async function tMasters(el, ctx) {
  const { ov, me, mName, again } = ctx;
  const { quals } = await api('/staff/academy/quals');
  const eligible = ov.people.filter(p => p.skills.includes('coach') || p.skills.includes('doctor'));
  const courseOk = p => p.master_course_on && p.master_course_on >= new Date(Date.now() - 730 * 864e5).toISOString().slice(0, 10);
  el.innerHTML = `<section class="panel"><p class="small muted" style="margin:0">A Master Trainer is a Hasta wellness coach or doctor with (1) an external Level A qualification on the machine, checked with the issuer by a head-office admin or the medical lead, and (2) the Hasta Master Trainer course, recorded by someone else and renewed every ${ov.rules.master_months} months.</p></section>
    ${eligible.length ? eligible.map(p => { const mine = quals.filter(q => q.staff_id === p.id); return `<section class="panel flush" style="margin-top:16px"><div class="panel-h" style="padding:18px 20px 4px"><div class="t"><span class="avatar">${esc(p.name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase())}</span><div><h3>${esc(p.name)}</h3>
        <p class="small muted">${esc(p.skills.filter(k => k === 'coach' || k === 'doctor').map(k => k === 'coach' ? 'Wellness coach' : 'Doctor').join(', '))}${p.reg_no ? ' · Reg. ' + esc(p.reg_no) : ''}${p.skills.includes('medical_lead') ? ' · Medical lead' : ''}</p></div></div>
        <div class="acts" style="display:flex;gap:8px;flex-wrap:wrap">${p.master_on.length ? pill('good', 'Master Trainer: ' + p.master_on.map(mName).join(', ')) : pill('closed', 'Not yet a Master Trainer')}
        ${p.id === me.id || me.role === 'admin' ? `<button class="btn sm ghost" data-qual="${p.id}">${icon('upload', 16)}Add qualification</button>` : ''}
        ${me.can_verify && p.id !== me.id ? `<button class="btn sm ghost" data-course="${p.id}">${icon('graduation-cap', 16)}Record course</button>` : ''}</div></div>
      <div style="padding:0 20px 12px;display:flex;gap:6px;align-items:center" class="small">${courseOk(p) ? `${icon('check-circle', 15)} Master Trainer course ${fDate(p.master_course_on)}, recorded by ${esc(p.master_course_by)}` : p.master_course_on ? `${icon('alert-triangle', 15)} Master Trainer course ${fDate(p.master_course_on)} is over ${ov.rules.master_months} months old: renew it` : `${icon('clock', 15)} Master Trainer course not yet recorded`}</div>
      ${mine.length ? `<table class="t"><thead><tr><th>Qualification</th><th>Covers</th><th>Valid</th><th>Check with issuer</th><th></th></tr></thead><tbody>${mine.map(q => `<tr><td><b>${esc(q.issuer)}</b><div class="small muted">No. ${esc(q.certificate_no)} · ${esc(q.holder_name)}${q.file_key ? ` · <a href="${fileUrl(q.file_key)}" target="_blank" rel="noopener">view copy</a>` : ''}${q.verify_link ? ` · <a href="${esc(q.verify_link)}" target="_blank" rel="noopener">issuer's check</a>` : ''}</div></td>
        <td class="small">${esc(q.machine_types.map(mName).join(', '))}</td><td class="small">${fDate(q.issued_on)} to ${fDate(q.expires_on)}${q.expires_on < today() ? ' ' + pill('alert', 'Expired') : ''}</td>
        <td class="small">${q.status === 'verified' ? `${pill('good', 'Verified')}<div class="muted">by ${esc(q.verifier_name)}, ${fDay(q.verified_at)} · ${esc(q.verify_method)} with ${esc(q.verify_contact)}${q.verify_ref ? ' · ref ' + esc(q.verify_ref) : ''}</div>` : q.status === 'rejected' ? `${pill('alert', 'Rejected')}<div class="muted">${esc(q.reject_reason)} (${esc(q.verifier_name)})</div>` : pill('warn', 'Awaiting check')}</td>
        <td>${q.status === 'pending' && me.can_verify && q.staff_id !== me.id && q.created_by !== me.id ? `<button class="btn sm gold" data-verify="${q.id}">Check</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="small muted" style="padding:0 20px 16px">No external qualifications added yet.</p>'}</section>`; }).join('')
    : emptyState('stethoscope', 'No team members have the Wellness coach or Doctor skill yet.')}`;
  el.querySelectorAll('[data-qual]').forEach(b => b.addEventListener('click', () => modal({
    title: 'Add an external qualification', wide: true,
    body: `<form data-f class="stack" style="gap:12px"><div class="grid2">${field('Issuer', inp('issuer', '', 'maxlength="120" placeholder="Equipment supplier or institute"'))}${field('Certificate number', inp('certificate_no', '', 'maxlength="80"'))}</div>
      ${field('Name as printed on the certificate', inp('holder_name', ov.people.find(p => p.id === +b.dataset.qual).name, 'maxlength="120"'))}
      <div class="grid2">${field('Issued on', inp('issued_on', '', 'type="date"'))}${field('Expires on', inp('expires_on', '', 'type="date"'))}</div>
      <div class="f">Machines this qualification covers<div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:6px">${ov.machines.map(m => `<label class="check"><input type="checkbox" name="mt.${m.id}"><span>${esc(m.name)}</span></label>`).join('')}</div></div>
      ${field("Issuer's online check (if any)", inp('verify_link', '', 'placeholder="https://…"'))}${field('Copy of the certificate', '<input class="in" type="file" name="file" accept=".pdf,image/*">', 'PDF or photo, under 8 MB')}
      <p class="small muted">A head-office admin or the medical lead will check this directly with the issuer before it counts. You cannot check your own.</p></form>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>${icon('upload', 16)}Submit for checking</button>`,
    onMount(m, close) {
      const s = m.querySelector('[data-save]');
      s.addEventListener('click', () => busy(s, async () => { const f = formData(m.querySelector('[data-f]')); const up = await upload(m.querySelector('[name=file]').files[0]); if (!up) throw new Error('Upload a copy of the certificate.');
        const body = { ...f, staff_id: +b.dataset.qual, machine_types: Object.entries(f.mt || {}).filter(([, v]) => v).map(([k]) => +k), file_key: up.key, file_name: up.name }; delete body.mt; delete body.file;
        return api('/staff/academy/quals', { method: 'POST', body }); }).then(() => { close(); toast('Submitted for checking'); again(); }).catch(() => {}));
    },
  })));
  el.querySelectorAll('[data-verify]').forEach(b => b.addEventListener('click', () => { const q = quals.find(x => x.id === +b.dataset.verify); modal({
    title: 'Check a qualification with the issuer',
    body: `<p><b>${esc(q.issuer)}</b> · No. ${esc(q.certificate_no)} · ${esc(q.holder_name)} · ${fDate(q.issued_on)} to ${fDate(q.expires_on)}</p>${q.file_key ? `<p><a href="${fileUrl(q.file_key)}" target="_blank" rel="noopener">${icon('file-text', 15)} Open the copy</a></p>` : ''}
      <form data-f class="stack" style="gap:12px">${field('How you confirmed it', sel('method', [['online', "Issuer's online check"], ['email', 'Email from the issuer'], ['phone', 'Phone call to the issuer']]))}
      ${field('Who you contacted / where you checked', inp('contact', '', 'maxlength="160" placeholder="e.g. Training manager, supplier India office"'))}${field('Reference', inp('ref', '', 'maxlength="160" placeholder="Email date, page link or call note"'))}
      <label class="check"><input type="checkbox" name="confirm"><span>The issuer confirmed the holder's name, certificate number, dates and machines.</span></label>
      ${field('Or reject it — reason', inp('reason', '', 'maxlength="300"'))}</form>`,
    actions: `<button class="btn ghost" data-reject>Reject</button><button class="btn gold" data-save>${icon('shield-check', 16)}Mark verified</button>`,
    onMount(m, close) {
      const f = () => formData(m.querySelector('[data-f]'));
      const s = m.querySelector('[data-save]'), r = m.querySelector('[data-reject]');
      s.addEventListener('click', () => busy(s, () => api(`/staff/academy/quals/${q.id}/verify`, { method: 'POST', body: f() })).then(() => { close(); toast('Qualification verified'); again(); }).catch(() => {}));
      r.addEventListener('click', () => busy(r, () => api(`/staff/academy/quals/${q.id}/reject`, { method: 'POST', body: f() })).then(() => { close(); toast('Qualification rejected'); again(); }).catch(() => {}));
    },
  }); }));
  el.querySelectorAll('[data-course]').forEach(b => b.addEventListener('click', () => modal({
    title: 'Record the Master Trainer course', body: `<form data-f>${field('Completed on', inp('day', today(), `type="date" max="${today()}"`))}</form><p class="small muted">Recorded in your name. The course must be renewed every ${ov.rules.master_months} months.</p>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Save</button>`,
    onMount(m, close) { const s = m.querySelector('[data-save]'); s.addEventListener('click', () => busy(s, () => api(`/staff/academy/master-course/${b.dataset.course}`, { method: 'POST', body: formData(m.querySelector('[data-f]')) })).then(() => { close(); toast('Course recorded'); again(); }).catch(() => {})); },
  })));
}

/* ---------- Trainees ---------- */
async function tTrainees(el, ctx) {
  const { ov, me, mName, approved, again } = ctx;
  const { records } = await api('/staff/academy/records');
  const isMaster = me.master_on.length > 0;
  const trainees = ov.people.filter(p => p.skills.includes('trainer') && p.id !== me.id);
  const open = records.filter(r => r.status === 'in_training' || r.status === 'retraining');
  el.innerHTML = `<div class="head" style="margin-bottom:12px"><div><p class="muted" style="margin:0">${isMaster ? `You are a Master Trainer for ${esc(me.master_on.map(mName).join(', '))}.` : 'Only Master Trainers can open training, sign sessions, assess and certify.'}</p></div>
      <div class="acts">${isMaster ? `<button class="btn gold" data-open ${approved ? '' : 'disabled title="The curriculum must be approved first"'}>${icon('plus', 16)}Open training</button>` : ''}</div></div>
    <section class="panel flush"><div class="rows">${open.length ? open.map(r => recordRow(r, mName, false) + (isMaster && me.master_on.includes(r.machine_type_id) && r.staff_id !== me.id ? `<div class="row" style="padding-top:0;gap:8px;flex-wrap:wrap;justify-content:flex-end">
        ${r.status === 'in_training' ? `<button class="btn sm ghost" data-log="${r.id}">${icon('calendar-check', 15)}Log supervised session</button><button class="btn sm ghost" data-prac="${r.id}">${icon('clipboard-check', 15)}Practical assessment</button>
        <button class="btn sm gold" data-cert="${r.id}" ${r.req.ready ? '' : 'disabled'}>${icon('award', 15)}Issue certificate</button>` : `<button class="btn sm gold" data-retrain="${r.id}">${icon('refresh-cw', 15)}Record retraining</button>`}</div>` : '')).join('') : `<div class="row">${emptyState('users', 'No open training.')}</div>`}</div></section>
    ${records.some(r => r.status === 'certified' || r.status === 'closed') ? `<h3 style="margin:22px 0 10px">Completed</h3><section class="panel flush"><div class="rows">${records.filter(r => r.status === 'certified' || r.status === 'closed').map(r => recordRow(r, mName, false)).join('')}</div></section>` : ''}`;
  el.querySelector('[data-open]')?.addEventListener('click', () => modal({
    title: 'Open training', body: `<form data-f class="stack" style="gap:12px">${field('Trainee', sel('staff_id', trainees.map(t => [t.id, t.name])))}${field('Machine', sel('machine_type_id', me.master_on.map(id => [id, mName(id)])))}${field('Type', sel('kind', [['initial', 'Initial certification'], ['renewal', 'Renewal']]))}
      <p class="small muted">Uses the approved curriculum v${esc(approved && approved.version)}.</p></form>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Open</button>`,
    onMount(m, close) { const s = m.querySelector('[data-save]'); s.addEventListener('click', () => busy(s, () => api('/staff/academy/records', { method: 'POST', body: formData(m.querySelector('[data-f]')) })).then(() => { close(); toast('Training opened'); again(); }).catch(() => {})); },
  }));
  el.querySelectorAll('[data-log]').forEach(b => b.addEventListener('click', () => modal({
    title: 'Log a supervised session', body: `<form data-f class="stack" style="gap:12px">${field('Session date', inp('session_date', today(), `type="date" max="${today()}"`))}${field('Booking ID', inp('appointment_id', '', 'inputmode="numeric" placeholder="Optional"'), 'links the log to an attended booking')}
      <label class="check"><input type="checkbox" name="first_session"><span>This was the client's first EMS session</span></label>${field('Notes', `<textarea class="in" name="notes" maxlength="300"></textarea>`)}
      <p class="small muted">You confirm you directly supervised this session. Signed in your name.</p></form>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Sign session</button>`,
    onMount(m, close) { const s = m.querySelector('[data-save]'); s.addEventListener('click', () => busy(s, () => api(`/staff/academy/records/${b.dataset.log}/logs`, { method: 'POST', body: formData(m.querySelector('[data-f]')) })).then(() => { close(); toast('Session logged'); again(); }).catch(() => {})); },
  })));
  el.querySelectorAll('[data-prac]').forEach(b => b.addEventListener('click', () => modal({
    title: 'Practical assessment', wide: true,
    body: `<p class="small muted">Tick each item the trainee did correctly. Every item must pass; items marked <b style="color:var(--alert)">Safety</b> are safety-critical.</p><form data-f class="stack" style="gap:8px">
      ${ov.checklist.map((c, i) => `<label class="check"><input type="checkbox" name="items.${c.k}"><span>${i + 1}. ${esc(c.t)}${c.crit ? ' <b style="color:var(--alert)">Safety</b>' : ''}</span></label>`).join('')}
      ${field('Notes', `<textarea class="in" name="notes" maxlength="500"></textarea>`)}</form>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Record assessment</button>`,
    onMount(m, close) { const s = m.querySelector('[data-save]'); s.addEventListener('click', () => busy(s, () => api(`/staff/academy/records/${b.dataset.prac}/practical`, { method: 'POST', body: formData(m.querySelector('[data-f]')) })).then(r => { close(); toast(r.passed ? 'Practical passed' : 'Recorded: not passed. Reassess when ready.', !r.passed); again(); }).catch(() => {})); },
  })));
  el.querySelectorAll('[data-retrain]').forEach(b => b.addEventListener('click', () => modal({
    title: 'Record retraining', body: `<form data-f>${field('Retraining given', `<textarea class="in" name="notes" maxlength="300" placeholder="Areas covered and how"></textarea>`)}</form><p class="small muted">This closes the current record and opens a new one with three fresh test attempts. History is kept.</p>`,
    actions: `<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Save</button>`,
    onMount(m, close) { const s = m.querySelector('[data-save]'); s.addEventListener('click', () => busy(s, () => api(`/staff/academy/records/${b.dataset.retrain}/retrain`, { method: 'POST', body: formData(m.querySelector('[data-f]')) })).then(() => { close(); toast('Retraining recorded'); again(); }).catch(() => {})); },
  })));
  el.querySelectorAll('[data-cert]').forEach(b => b.addEventListener('click', () => {
    if (!confirm('Issue the certificate? It will be signed in your name, valid for 12 months on this machine.')) return;
    busy(b, () => api(`/staff/academy/records/${b.dataset.cert}/certify`, { method: 'POST', body: {} })).then(r => { toast(r.pending ? `Certificate ${r.code} issued — needs a countersignature from another Master Trainer` : `Certificate ${r.code} issued`); ctx.go('#/academy?tab=certificates'); }).catch(() => {});
  }));
}

/* ---------- Certificates ---------- */
async function tCerts(el, ctx) {
  const { me, again } = ctx;
  const { certifications } = await api('/staff/certifications');
  const site = location.origin.replace('//ems.', '//');
  el.innerHTML = `<section class="panel flush"><div class="panel-h" style="padding:18px 20px 4px"><div class="t">${icon('award', 20)}<div><h3>Certificates</h3><p class="small muted">Anyone can check a certificate at <a href="${site}/verify" target="_blank" rel="noopener">${site.replace(/^https?:\/\//, '')}/verify</a>. Only valid certificates allow bookings.</p></div></div></div>
    <table class="t"><thead><tr><th>Trainer</th><th>Machine</th><th>Certificate</th><th>Certified by</th><th>Valid</th><th>Status</th><th></th></tr></thead><tbody>
    ${certifications.map(c => `<tr><td><b>${esc(c.trainer_name)}</b></td><td>${esc(c.machine_name)}</td><td class="small">${c.code ? `<a href="${site}/verify/${esc(c.code)}" target="_blank" rel="noopener">${esc(c.code)}</a><div class="muted">v${esc(c.curriculum_version)} · theory ${c.theory_score}% · ${c.sessions_logged} sessions</div>` : '<span class="muted">Pre-Academy</span>'}</td>
      <td class="small">${esc(c.certifier_name)}<div class="muted">${esc(c.certifier_role)}${c.countersigner_name ? ' · countersigned by ' + esc(c.countersigner_name) : ''}</div></td><td class="small">${fDate(c.issued_on)} to ${fDate(c.valid_until)}</td><td>${CERT_STATUS(c)}</td>
      <td style="white-space:nowrap">${c.code ? `<a class="btn sm quiet" href="${BASE}/api/staff/academy/certificates/${c.id}/pdf">${icon('printer', 15)}PDF</a>` : ''}${c.status === 'pending' && me.master_on.includes(c.machine_type_id) && c.certified_by !== me.id && c.staff_id !== me.id ? `<button class="btn sm gold" data-cs="${c.id}">Countersign</button>` : ''}
        ${c.status !== 'revoked' && (me.role === 'admin' || me.master_on.length) ? `<button class="btn sm quiet" data-revoke="${c.id}">Revoke</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="7">${emptyState('award', 'No certificates yet.')}</td></tr>`}</tbody></table></section>`;
  el.querySelectorAll('[data-cs]').forEach(b => b.addEventListener('click', () => { if (!confirm('Countersign this certificate? You confirm the training record meets the Academy standard.')) return; busy(b, () => api(`/staff/academy/certificates/${b.dataset.cs}/countersign`, { method: 'POST', body: {} })).then(() => { toast('Countersigned — certificate is now valid'); again(); }).catch(() => {}); }));
  el.querySelectorAll('[data-revoke]').forEach(b => b.addEventListener('click', () => { const reason = prompt('Reason for revoking this certificate?'); if (reason === null) return; busy(b, () => api(`/staff/certifications/${b.dataset.revoke}/revoke`, { method: 'POST', body: { reason } })).then(() => { toast('Certificate revoked'); again(); }).catch(() => {}); }));
}
