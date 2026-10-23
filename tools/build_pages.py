# -*- coding: utf-8 -*-
"""Generate Hasta Wellness service pages and the privacy page.

Usage:  python3 tools/build_pages.py
Writes public/<slug>/index.html for each page in tools/pages.py,
public/privacy/index.html, and src/pages.js (list used for the sitemap).
"""
import html, json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from pages import PAGES, PHONE_DISPLAY, PHONE_TEL, WA

ROOT = os.path.join(os.path.dirname(__file__), '..')
PUB = os.path.join(ROOT, 'public')
BY_SLUG = {p['slug']: p for p in PAGES}
e = lambda s: html.escape(s, quote=True)
ADDRESS_LINES = ["1st floor, Anjali Arcade", "Near Nippon Toyota", "Technopark Phase 3 Service Road",
                 "Kazhakkoottam, Thiruvananthapuram", "Kerala 695583, India"]
MAP = "https://www.google.com/maps/search/?api=1&query=Hasta+Wellness+Anjali+Arcade+Nippon+Toyota+Technopark+Phase+3+Service+Road+Kazhakkoottam+695583"
IG_SVG = ('<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8">'
          '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.4" cy="6.6" r="1" fill="currentColor" stroke="none"/></svg>')


def head(title, desc, path, extra_ld):
    return f'''<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{e(title)}</title><meta name="description" content="{e(desc)}">
<link rel="canonical" href="{path}"><meta name="robots" content="index,follow,max-image-preview:large"><meta name="theme-color" content="#34595e">
<meta property="og:type" content="website"><meta property="og:site_name" content="Hasta Wellness"><meta property="og:title" content="{e(title)}"><meta property="og:description" content="{e(desc)}">
<meta property="og:url" content="{path}"><meta property="og:image" content="/img/og-hasta-wellness.jpg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:locale" content="en_IN"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.ico" sizes="48x48"><link rel="icon" type="image/png" sizes="96x96" href="/img/favicon-96.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="manifest" href="/site.webmanifest">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&amp;family=Manrope:wght@400;500;600;700&amp;display=swap">
<link rel="stylesheet" href="/assets/service.css">
{''.join(f'<script type="application/ld+json">{json.dumps(x, ensure_ascii=False)}</script>' for x in extra_ld)}
</head><body>
<div class="top">YOUR EVERYDAY WELLNESS, BEAUTIFULLY REIMAGINED · KAZHAKOOTTAM, TRIVANDRUM</div>
<header class="site"><nav class="wrap"><a class="logo" href="/" aria-label="Hasta Wellness home"><img src="/img/hasta-wellness-logo.webp" alt="Hasta Wellness" width="185" height="66"></a>
<div class="navlinks"><a href="/#care">Find your care</a><a href="/#programmes">All programmes</a><a href="/#approach">Why Hasta</a><a href="/#visit">Visit us</a></div>
<a class="btn" href="#enquire">Book a consultation <span>↗</span></a></nav></header>
<main>'''


def footer():
    links = ''.join(f'<a href="/{p["slug"]}/">{e(p["nav"])}</a>' for p in PAGES)
    return f'''</main>
<footer class="site"><div class="wrap"><div class="row">
<div><a href="/"><img src="/img/hasta-wellness-logo.webp" alt="Hasta Wellness" width="170" height="61" loading="lazy"></a>
<p>Dental · Skin · Hair | Kazhakkoottam, Trivandrum<br>Mon – Sat 10 am – 8 pm · Sun 10 am – 2 pm<br><a href="tel:{PHONE_TEL}">{PHONE_DISPLAY}</a></p>
<a class="social" href="https://www.instagram.com/hasta_wellness/" target="_blank" rel="noopener" aria-label="Hasta Wellness on Instagram (opens in a new tab)">{IG_SVG}<span>@hasta_wellness</span></a></div>
<nav aria-label="Treatments">{links}<a href="/">Home</a><a href="/privacy/">Privacy notice</a></nav></div>
<div class="fine"><span>© <span id="year">2026</span> Hasta Wellness. All rights reserved. A venture of HASWEL CARE Private Limited.</span><span>Individual assessment required. Outcomes vary. Images are illustrative.</span></div></div></footer>
<div class="mobilebar"><a href="tel:{PHONE_TEL}">Call clinic ↗</a><a class="primary" href="#enquire">Book / enquire ↗</a></div>
<script src="/assets/service.js" defer></script>
</body></html>
'''


def page(p):
    path = f'/{p["slug"]}/'
    faq_ld = {"@context": "https://schema.org", "@type": "FAQPage",
              "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in p['faqs']]}
    crumbs_ld = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Hasta Wellness", "item": "/"},
        {"@type": "ListItem", "position": 2, "name": p['nav'], "item": path}]}
    page_ld = {"@context": "https://schema.org", "@type": "MedicalWebPage", "name": p['title'], "description": p['description'],
               "url": path, "specialty": p['specialty'], "inLanguage": "en-IN",
               "about": {"@type": "MedicalClinic", "name": "Hasta Wellness", "telephone": PHONE_DISPLAY,
                         "address": {"@type": "PostalAddress", "streetAddress": "1st floor, Anjali Arcade, Near Nippon Toyota, Technopark Phase 3 Service Road",
                                     "addressLocality": "Kazhakkoottam, Thiruvananthapuram", "addressRegion": "Kerala", "postalCode": "695583", "addressCountry": "IN"}}}
    out = [head(p['title'], p['description'], path, [page_ld, faq_ld, crumbs_ld])]
    # hero
    if p['image']:
        art = (f'<div class="hero-art"><img src="{e(p["image"])}" alt="{e(p["image_alt"])}" fetchpriority="high" decoding="async">'
               f'<div class="tag">Every plan starts with a conversation. Images are illustrative.</div></div>')
    else:
        art = ('<div class="hero-art emblem"><img src="/img/icon-512.png" alt="" width="512" height="512">'
               '<div class="tag">Every plan starts with a conversation.</div></div>')
    intro = ''.join(f'<p>{e(t)}</p>' for t in p['intro'])
    out.append(f'''<div class="wrap"><p class="crumbs"><a href="/">Home</a> / {e(p["nav"])}</p>
<div class="hero"><div><div class="eyebrow">{e(p["eyebrow"])}</div><h1>{p["h1"]}</h1>{intro}
<div class="actions"><a class="btn" href="#enquire">Book a consultation <span>↗</span></a><a class="btn light" href="tel:{PHONE_TEL}">Call {PHONE_DISPLAY} <span>↗</span></a></div></div>{art}</div>
<div class="facts"><span>Near Technopark Phase 3</span><span>Open 7 days</span><span>Consultation before any treatment</span><span>Written costs before you commit</span></div></div>''')
    # services
    cards = ''
    for i, (t, d, bullets) in enumerate(p['services']):
        interest = p['interests'][min(i, len(p['interests']) - 1)]
        cards += (f'<article class="card"><h3>{e(t)}</h3><p>{e(d)}</p><ul>{"".join(f"<li>{e(b)}</li>" for b in bullets)}</ul>'
                  f'<a class="btn light" href="#enquire" data-pick="{e(interest)}">Ask about {e(t.lower() if not t.startswith("The ") else t)} <span>↗</span></a></article>')
    out.append(f'<section class="block"><div class="wrap"><div class="eyebrow">WHAT WE CAN HELP WITH</div><h2>{e(p["services_title"])}</h2><div class="cards">{cards}</div></div></section>')
    # steps
    out.append('''<section class="block"><div class="wrap"><div class="eyebrow">YOUR FIRST VISIT</div><h2>Three simple steps. <em>No pressure.</em></h2><div class="steps">
<div class="step"><span>01</span><h3>Tell us what’s on your mind</h3><p>Send a WhatsApp request or call. Share the concern you’d like to discuss — no medical history needed in the form.</p></div>
<div class="step"><span>02</span><h3>Have a real conversation</h3><p>Your clinician listens, assesses and explains suitable options, including the option to do nothing for now.</p></div>
<div class="step"><span>03</span><h3>Choose your next step</h3><p>Take home a written plan with sessions and costs. Decide in your own time.</p></div></div></div></section>''')
    # note
    out.append(f'<section class="block"><div class="wrap note"><div><div class="eyebrow">BEFORE YOU DECIDE</div><h2>{e(p["note_title"])}</h2></div><div>{"".join(f"<p>{e(t)}</p>" for t in p["note"])}</div></div></section>')
    # faq
    faqs = ''.join(f'<details><summary>{e(q)}</summary><p>{e(a)}</p></details>' for q, a in p['faqs'])
    out.append(f'<section class="block faq"><div class="wrap"><div class="eyebrow">QUESTIONS</div><h2>Good questions to ask.</h2>{faqs}<p class="disclaimer">{e(p["disclaimer"])}</p></div></section>')
    # enquiry
    opts = ''.join(f'<option>{e(i)}</option>' for i in p['interests']) + '<option>Not sure yet</option>'
    timings = ''.join(f'<option>{t}</option>' for t in ['As soon as possible', 'This week', 'Next week or later', 'Just exploring for now'])
    out.append(f'''<section class="block" id="enquire"><div class="wrap enquire"><div class="side"><div class="eyebrow">START WITH A CONVERSATION</div>
<h2>Book a consultation in <em>Kazhakkoottam.</em></h2><p>Leave your name and number and the team will get back to you, or send your request straight to WhatsApp. Nothing is booked until the clinic confirms.</p>
<div class="hours"><strong>Hasta Wellness</strong>{"<br>".join(ADDRESS_LINES)}<br><br><strong>Opening hours</strong>Monday – Saturday · 10 am – 8 pm<br>Sunday · 10 am – 2 pm<br><br>
<a href="tel:{PHONE_TEL}">{PHONE_DISPLAY}</a> · <a href="{MAP}" target="_blank" rel="noopener">Get directions ↗</a></div></div>
<form class="lead" novalidate>
<label>What would you like to discuss?<select name="interest">{opts}</select></label>
<label>When would you like to come in?<select name="timing">{timings}</select></label>
<label>Your name<input type="text" name="name" autocomplete="name" required maxlength="80"></label>
<label>Mobile number<input type="tel" name="phone" autocomplete="tel" inputmode="tel" required pattern="[0-9+ \\(\\)\\-]{{10,20}}" placeholder="e.g. 98765 43210"></label>
<label class="hp" aria-hidden="true">Company<input type="text" name="company" tabindex="-1" autocomplete="off"></label>
<label class="consent"><input type="checkbox" required><span>I agree that Hasta Wellness may store these details to contact me about this request, and to share them via WhatsApp when I send my message. <a href="/privacy/">Privacy notice</a></span></label>
<button class="btn" type="submit">Send my request on WhatsApp <span>↗</span></button>
<small style="color:var(--muted);font-size:12px">Please don’t share medical history, photos or ID documents here.</small></form></div></section>''')
    # related
    rel = ''.join(f'<a href="/{s}/"><small>ALSO AT HASTA</small><b>{e(BY_SLUG[s]["nav"])}</b></a>' for s in p['related'])
    out.append(f'<section class="block"><div class="wrap"><div class="eyebrow">EXPLORE MORE CARE</div><h2>Other ways we can help.</h2><div class="related">{rel}</div></div></section>')
    out.append('<script>document.querySelectorAll("[data-pick]").forEach(function(a){a.addEventListener("click",function(){var s=document.querySelector("form.lead select[name=interest]");if(s)s.value=a.dataset.pick})})</script>')
    out.append(footer())
    return ''.join(out)


def privacy():
    p = '/privacy/'
    body = f'''<div class="wrap" style="max-width:820px;padding:30px 0 80px"><p class="crumbs"><a href="/">Home</a> / Privacy notice</p>
<div class="eyebrow" style="margin-top:20px">PRIVACY NOTICE</div><h1 style="font-size:44px;margin:16px 0 30px">How we use your details</h1>
<p><strong>Who we are.</strong> Hasta Wellness is a venture of HASWEL CARE Private Limited, 1st floor, Anjali Arcade, Technopark Phase 3 Service Road, Kazhakkoottam, Thiruvananthapuram, Kerala 695583.</p>
<p><strong>What we collect.</strong> When you use the care guide or an enquiry form and tick the consent box, we store your name, mobile number, the area of care you chose, your preferred timing or date, and which form you used. We do not ask for medical history, photographs, identity documents or payment details on this website — please don’t share them.</p>
<p><strong>Why.</strong> Only to contact you about your request: to confirm availability, answer questions and arrange a consultation if you wish. We do not sell your details or use them for unrelated marketing.</p>
<p><strong>Where and how long.</strong> Details are stored securely with our website host, Cloudflare, and are deleted automatically after 90 days unless you become a client of the clinic. Messages you send on WhatsApp are also handled under WhatsApp’s own terms.</p>
<p><strong>Your choices.</strong> You can ask us to see, correct or delete your details, or withdraw consent, at any time by calling or messaging <a href="tel:{PHONE_TEL}">{PHONE_DISPLAY}</a>.</p></div>'''
    h = head('Privacy notice | Hasta Wellness', 'How Hasta Wellness, a venture of HASWEL CARE Private Limited, uses the details you share through this website.', p, [])
    return h.replace('<a class="btn" href="#enquire">', '<a class="btn" href="/#visit">') + body + footer().replace('href="#enquire">Book / enquire', 'href="/#visit">Book / enquire')


def main():
    for p in PAGES:
        d = os.path.join(PUB, p['slug']); os.makedirs(d, exist_ok=True)
        open(os.path.join(d, 'index.html'), 'w', encoding='utf-8').write(page(p))
    os.makedirs(os.path.join(PUB, 'privacy'), exist_ok=True)
    open(os.path.join(PUB, 'privacy', 'index.html'), 'w', encoding='utf-8').write(privacy())
    paths = ['/'] + [f'/{p["slug"]}/' for p in PAGES] + ['/privacy/']
    open(os.path.join(ROOT, 'src', 'pages.js'), 'w').write(
        '// Generated by tools/build_pages.py — list of pages for the sitemap.\nexport const PAGES = ' + json.dumps(paths, indent=2) + ';\n')
    print('Built', len(PAGES), 'service pages + privacy')


if __name__ == '__main__':
    main()
