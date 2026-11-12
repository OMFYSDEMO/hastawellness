import { api, esc, icon, toast, formData, busy, field, inp, today, CLINIC_PHONE, CLINIC_TEL } from './core.js?v=8';

const app = document.getElementById('app');

async function start() {
  let me = null;
  try { ({ me } = await api('/me')); } catch (e) { app.innerHTML = `<div class="boot"><p class="err">${esc(e.message)}</p></div>`; return; }
  if (!me) return login();
  if (me.kind === 'staff') (await import('./staff.js?v=9')).mount(app, me);
  else (await import('./client.js?v=8')).mount(app, me);
}

function login() {
  const mode = location.hash === '#/staff' ? 'staff' : location.hash === '#/consult' ? 'consult' : 'client';
  app.innerHTML = `<div class="auth">
    <section class="auth-art">
      <div class="brand"><img src="/img/hasta-emblem.webp" alt="" width="44" height="44"><div><b style="font-family:Manrope;font-size:16px">Hasta Wellness</b><div style="font-size:13px;color:#9fb8b4">EMS Progress Studio</div></div></div>
      <div><h1>See every session add up.</h1>
      <p class="lede">Your sessions, measurements and plan in one place, with guidance from the Hasta team at Technopark, Kazhakkoottam.</p></div>
      <ul>
        <li>${icon('calendar-check', 20)}Book and manage your EMS sessions</li>
        <li>${icon('line-chart', 20)}Watch weight, waist and body fat change over time</li>
        <li>${icon('salad', 20)}Follow a Kerala-friendly food and lifestyle plan</li>
      </ul>
    </section>
    <section class="auth-panel"><div class="auth-box" id="box"></div></section></div>`;
  const box = app.querySelector('#box');
  const seg = m => `<div class="seg" role="tablist" style="width:100%"><button type="button" data-m="client" class="${m === 'client' ? 'on' : ''}" style="flex:1">I'm a client</button><button type="button" data-m="staff" class="${m === 'staff' ? 'on' : ''}" style="flex:1">Clinic team</button></div>`;
  const render = m => {
    history.replaceState(null, '', m === 'client' ? location.pathname : '#/' + m);
    if (m === 'consult') {
      box.innerHTML = `<a href="#" class="crumb" data-m="client">${icon('arrow-left', 16)}Back to sign in</a>
        <div><h2>Book a consultation</h2><p class="muted" style="margin-top:6px">New to EMS at Hasta? Leave your details and the team will call or WhatsApp you to fix a time.</p></div>
        <form class="stack" style="gap:14px" novalidate>
          ${field('Your name', inp('name', '', 'autocomplete="name" required'))}
          ${field('Mobile number', inp('phone', '', 'type="tel" inputmode="tel" autocomplete="tel" placeholder="98xxx xxxxx" required'))}
          ${field('What would you like to work on?', inp('goal', '', 'placeholder="e.g. lose 6 kg, tone after pregnancy"'), 'optional')}
          <div class="grid2">${field('Your area PIN code', inp('pincode', '', 'inputmode="numeric" maxlength="6" placeholder="695582"'), 'finds your nearest centre')}${field('Consultation', '<select class="in" name="mode"><option value="in_person">At the centre</option><option value="video">Video call</option></select>')}</div>
          <div class="grid2">${field('Preferred date', inp('preferred_date', '', `type="date" min="${today()}"`))}${field('Best time', `<select class="in" name="timing"><option value="">Any time</option><option>Morning</option><option>Lunch break</option><option>Evening</option><option>Weekend</option></select>`)}</div>
          <input name="company" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
          <label class="check"><input type="checkbox" name="consent"> <span>I agree to Hasta Wellness contacting me about this request. Please don't include medical details here.</span></label>
          <div class="msg"></div>
          <button class="btn gold" style="height:46px">${icon('calendar-plus', 18)}Send request</button>
        </form>
        <p class="auth-foot">Prefer to talk? Call <a href="tel:${CLINIC_TEL}">${CLINIC_PHONE}</a></p>`;
      const f = box.querySelector('form');
      f.addEventListener('submit', e => {
        e.preventDefault();
        busy(f.querySelector('button.btn'), async () => {
          await api('/consult', { method: 'POST', body: formData(f) });
          box.innerHTML = `<div class="empty" style="padding:10px 0">${icon('check-circle', 40)}<h2>Request sent</h2><p>Thank you. The Hasta team will contact you shortly to confirm your consultation.</p><a href="#" class="btn ghost" data-m="client">Back to sign in</a></div>`;
        }).catch(() => {});
      });
      return;
    }
    const staff = m === 'staff';
    box.innerHTML = `${seg(m)}
      <div><h2>${staff ? 'Team sign in' : 'Welcome back'}</h2><p class="muted" style="margin-top:6px">${staff ? 'Use the username and password the clinic gave you.' : 'Sign in with your mobile number and the 6-digit PIN from the clinic.'}</p></div>
      <form class="stack" style="gap:14px" novalidate>
        ${staff ? field('Username', inp('username', '', 'autocomplete="username" autocapitalize="none" required'))
          : field('Mobile number', inp('phone', '', 'type="tel" inputmode="tel" autocomplete="tel" placeholder="98xxx xxxxx" required'))}
        ${staff ? field('Password', `<div style="position:relative">${inp('password', '', 'type="password" autocomplete="current-password" required')}<button type="button" class="btn quiet sm icon" data-eye style="position:absolute;right:5px;top:5px" aria-label="Show password">${icon('eye', 18)}</button></div>`)
          : field('PIN', inp('pin', '', 'class="in pin" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required'))}
        <div class="msg"></div>
        <button class="btn" style="height:46px">${icon('lock', 18)}Sign in</button>
      </form>
      ${staff ? '' : `<div class="panel" style="background:var(--gold-soft);border-color:transparent;display:flex;gap:12px;align-items:center;padding:14px 16px">${icon('sparkles', 22)}<div style="flex:1"><b style="font-size:14px">New to EMS?</b><p class="small muted">Book a consultation with our team.</p></div><a href="#/consult" class="btn sm gold" data-m="consult">Book</a></div>
      <p class="auth-foot">Forgotten your PIN? WhatsApp <a href="https://wa.me/919778458883">${CLINIC_PHONE}</a> and we'll reset it.</p>`}`;
    const f = box.querySelector('form');
    if (!staff) f.querySelector('[name=pin]').className = 'in pin';
    box.querySelector('[data-eye]')?.addEventListener('click', e => { const i = f.querySelector('[name=password]'); i.type = i.type === 'password' ? 'text' : 'password'; });
    f.addEventListener('submit', e => {
      e.preventDefault();
      const msg = f.querySelector('.msg');
      msg.innerHTML = '';
      busy(f.querySelector('button.btn'), async () => {
        await api(staff ? '/auth/staff' : '/auth/client', { method: 'POST', body: formData(f) });
        history.replaceState(null, '', location.pathname);
        start();
      }, true).catch(err => { msg.innerHTML = `<p class="err">${esc(err.message)}</p>`; });
    });
  };
  box.addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (b) { e.preventDefault(); render(b.dataset.m); } });
  render(mode);
}

start();
