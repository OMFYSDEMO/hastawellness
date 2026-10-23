/* Hasta Wellness service pages: enquiry form → lead capture + WhatsApp */
(function () {
  var WA = '919778458883';
  var y = document.getElementById('year'); if (y) y.textContent = new Date().getFullYear();
  document.querySelectorAll('form.lead').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!f.checkValidity()) { f.reportValidity(); return; }
      var v = function (n) { var el = f.elements.namedItem(n); return el ? String(el.value || '').trim() : ''; };
      if (v('company')) return;
      var name = v('name'), phone = v('phone'), interest = v('interest'), timing = v('timing');
      var type = timing === 'Just exploring for now' ? 'Programme enquiry' : 'Appointment request';
      try {
        fetch('/api/lead', {
          method: 'POST', keepalive: true, credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ consent: true, source: 'service page', page: location.pathname.replace(/\//g, '') || 'home',
            request_type: type, name: name, phone: phone, interest: interest, timing: timing })
        }).catch(function () {});
      } catch (err) {}
      var msg = 'Hasta Wellness — ' + type + '\n\nName: ' + name + '\nMobile: ' + phone + '\nInterested in: ' + interest +
        '\nTiming: ' + timing + '\n\nRequest only. Please confirm availability. No appointment has been booked yet.';
      var url = 'https://wa.me/' + WA + '?text=' + encodeURIComponent(msg);
      var w = window.open(url, '_blank'); try { if (w) w.opener = null; } catch (err) {}
      var done = document.createElement('div'); done.className = 'done'; done.setAttribute('role', 'status');
      done.innerHTML = '<p><strong>Thanks, ' + name.split(' ')[0].replace(/[<>&"]/g, '') + '.</strong> Your details are with the team. ' +
        (w ? 'WhatsApp is opening with your message — just press send.' : 'Tap below to open WhatsApp and press send.') +
        ' Your appointment is confirmed only when the clinic replies.</p>';
      var a = document.createElement('a'); a.className = 'btn'; a.href = url; a.target = '_blank'; a.rel = 'noopener';
      a.innerHTML = (w ? 'Open WhatsApp again' : 'Open WhatsApp') + ' <span>↗</span>';
      done.appendChild(a);
      f.replaceWith(done);
    });
  });
})();
