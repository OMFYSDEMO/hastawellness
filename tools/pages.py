# -*- coding: utf-8 -*-
"""Content for Hasta Wellness service pages.

Edit the copy here, then run:  python3 tools/build_pages.py
Rules: consultation-led language, no prices, no guaranteed outcomes,
no practitioner claims that the clinic has not confirmed.
"""

PHONE_DISPLAY = "+91 97784 58883"
PHONE_TEL = "+919778458883"
WA = "919778458883"

IMG_DENTAL = "https://images.unsplash.com/photo-1606811971618-4486d14f3f99?auto=format&fit=crop&w=900&q=80"
IMG_SKIN = "https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?auto=format&fit=crop&w=900&q=80"
IMG_HAIR = "/img/hair-wellness-portrait.webp"

PAGES = [
  # ------------------------------------------------------------------ DENTAL
  dict(
    slug="dental-clinic-kazhakkoottam",
    nav="Dental & smile",
    title="Dental Clinic in Kazhakkoottam near Technopark | Hasta Wellness",
    description="Dental check-ups, smile corrections, clear aligner assessments and EMI enquiries at Hasta Wellness, Technopark Phase 3, Kazhakkoottam. Book on WhatsApp.",
    eyebrow="HASTA SMILE FORWARD · DENTAL CARE IN KAZHAKKOOTTAM",
    h1="A dental clinic near Technopark that starts with <em>listening.</em>",
    intro=[
      "The introduction on your first day. A laugh with friends. A photo you want to be in. If you’ve been thinking about your teeth, your bite or how your smile looks, this can be the start of a conversation.",
      "Hasta Wellness is on Technopark Phase 3 Service Road in Kazhakkoottam, a short trip from Technopark, Kariavattom and Sreekaryam. Our dental team brings oral health, smile goals and practical planning together — and if you choose a change, we help you make it an informed one.",
    ],
    image=IMG_DENTAL, image_alt="Dental examination in a modern clinic (illustrative)",
    services_title="How we can help",
    services=[
      ("Dental check-up & oral health", "Start with your teeth and gums. Talk about discomfort, sensitivity, cleaning needs or anything you’ve been putting off.",
       ["Dental examination and discussion", "Cleaning needs reviewed", "Clear explanation of what we find", "Next steps only if you need them"]),
      ("Smile corrections", "Gaps, uneven edges, alignment or tooth-colour concerns you’ve been noticing. Explore what may be suitable while keeping tooth and gum health in focus.",
       ["Share the changes you’d like to discuss", "Conservative options explained first", "Benefits, limitations and alternatives", "An individual written proposal"]),
      ("Clear aligner assessment", "Curious about aligners for crowding, gaps or alignment? Find out whether removable aligners suit your teeth, bite and routine.",
       ["Dental and bite assessment", "Records or scans when needed", "Comparison with other options", "Wear, reviews and retainers explained"]),
      ("A complete smile plan", "Bring your oral-health priorities, smile goals and budget into one conversation, with a staged proposal before you choose.",
       ["Assessment-led treatment sequence", "Written inclusions and cost breakdown", "Review and retention arrangements", "Optional EMI eligibility enquiry"]),
    ],
    interests=["Dental — Smile Forward Consultation", "Dental — Smile Correction Consultation", "Dental — Clear Aligner Assessment", "Dental — Complete Smile Forward Plan", "Dental — Fibe Finance & EMI Enquiry"],
    note_title="Paying in instalments",
    note=[
      "Want to explore paying in instalments? Ask the clinic about Fibe healthcare finance for eligible dental treatment. First get your written dental quotation and confirm that your treatment is supported.",
      "Before you apply, compare the financed amount, down payment, repayment period, interest or APR, processing fees and total repayment with paying directly. Finance is optional and subject to clinic availability, provider eligibility and final terms — no approval, zero-interest offer or fixed EMI is promised. Please don’t share Aadhaar, PAN or bank details on this website.",
    ],
    faqs=[
      ("Where is your dental clinic?", "We’re on the first floor of Anjali Arcade, near Nippon Toyota, Technopark Phase 3 Service Road, Kazhakkoottam, Thiruvananthapuram 695583. We’re open Monday to Saturday 10 am – 8 pm and Sunday 10 am – 2 pm."),
      ("Do I have to start treatment at my first visit?", "No. Your first visit is a conversation and assessment. You’ll understand your options and costs, and you can take time to decide."),
      ("How much will my dental treatment cost?", "Costs depend on your assessment and proposed care. Ask for an itemised written estimate, including reviews and any retainers, before agreeing to treatment."),
      ("What should I know before smile correction?", "Discuss the benefits, risks, maintenance and alternatives — including choosing no cosmetic treatment. Some cosmetic procedures remove tooth structure; your clinician should explain any irreversible changes before you consent."),
    ],
    disclaimer="Adult programme for ages 18+. Suitability, treatments, timelines, fees and finance availability are confirmed individually after assessment. Results vary. Images are illustrative.",
    related=["clear-aligners-trivandrum", "acne-scar-treatment-kazhakkoottam", "hair-fall-treatment-trivandrum"],
    specialty="Dentistry",
  ),
  # ------------------------------------------------------------------ ALIGNERS
  dict(
    slug="clear-aligners-trivandrum",
    nav="Clear aligners",
    title="Clear Aligners in Trivandrum – Assessment | Hasta Wellness",
    description="Thinking about clear aligners in Trivandrum? Get a dental and bite assessment, honest suitability advice and EMI enquiry support near Technopark, Kazhakkoottam.",
    eyebrow="THE ALIGNER EDIT · KAZHAKKOOTTAM, TRIVANDRUM",
    h1="Clear aligners in Trivandrum, <em>with a plan you understand.</em>",
    intro=[
      "Crowded teeth, gaps or a bite that doesn’t feel quite right — clear aligners are one way to straighten teeth discreetly. But they aren’t right for everyone, and the best place to start is an honest assessment.",
      "At Hasta Wellness in Kazhakkoottam, near Technopark Phase 3, we check whether removable aligners suit your teeth, bite and daily routine, compare them with other options and explain what treatment would really involve before you decide.",
    ],
    image=IMG_DENTAL, image_alt="Dental examination (illustrative)",
    services_title="What your aligner assessment covers",
    services=[
      ("Dental and bite assessment", "We look at your teeth, gums and bite first. Oral health comes before any straightening plan.",
       ["Examination of teeth and gums", "Bite and alignment review", "Any treatment needed first, explained", "Records or scans when needed"]),
      ("Is it right for you?", "Aligners need to be worn consistently as prescribed. We’ll talk honestly about whether they fit your teeth and your routine.",
       ["Suitability for your concern", "Comparison with other options", "Daily wear and care explained", "Realistic treatment length"]),
      ("A clear written proposal", "If aligners are suitable and you’d like to go ahead, you receive a proposal you can take away and think about.",
       ["Proposed sequence and reviews", "Refinements and retainers explained", "Itemised costs in writing", "Optional EMI eligibility enquiry"]),
    ],
    interests=["Dental — Clear Aligner Assessment", "Dental — Complete Smile Forward Plan", "Dental — Fibe Finance & EMI Enquiry"],
    note_title="After aligners: keeping your result",
    note=[
      "Teeth can move back after treatment, so retainers are part of the plan. Ask how long you’ll need to wear them, how often they’re replaced and what that costs.",
      "Aligner treatment can involve temporary discomfort and needs good oral hygiene and regular reviews. Your clinician should explain the risks and alternatives before you consent.",
    ],
    faqs=[
      ("Are clear aligners right for everyone?", "No. A dental and orthodontic assessment is needed to decide suitability and compare alternatives. Aligners need consistent wear, good oral hygiene and follow-up, and retainers afterwards."),
      ("How long does aligner treatment take?", "It depends on your teeth and bite. An estimate follows your assessment — be wary of any fixed timeline given before you’ve been examined."),
      ("Can I pay for aligners in EMIs?", "You can ask the clinic about Fibe healthcare finance for eligible treatment. Get your written quotation first and compare the total repayment with paying directly. Approval is not guaranteed."),
      ("Where can I get an aligner assessment near Technopark?", "Hasta Wellness is on Technopark Phase 3 Service Road, Kazhakkoottam. Book on WhatsApp or call +91 97784 58883."),
    ],
    disclaimer="For adults aged 18+. Suitability, timelines, fees and finance availability are confirmed after assessment. Results vary. Images are illustrative.",
    related=["dental-clinic-kazhakkoottam", "bridal-skin-care-trivandrum", "laser-hair-reduction-trivandrum"],
    specialty="Dentistry",
  ),
  # ------------------------------------------------------------------ ACNE
  dict(
    slug="acne-scar-treatment-kazhakkoottam",
    nav="Acne, marks & scars",
    title="Acne & Acne Scar Treatment in Kazhakkoottam | Hasta Wellness",
    description="Recurring breakouts, acne marks, scars or a bump you’re unsure about? Consultation-led skin care, including laser where suitable, near Technopark, Trivandrum.",
    eyebrow="THE HASTA SKIN COMFORT EDIT · KAZHAKKOOTTAM",
    h1="Acne and acne scar care that starts <em>with you.</em>",
    intro=[
      "A pimple before a presentation. Marks that linger after a breakout. A small bump you keep noticing in the mirror. Sometimes a skin concern takes up more space in your day than you’d like.",
      "At Hasta Wellness in Kazhakkoottam, we start with your concern and what it means to you — then explore suitable care, including laser options where appropriate. A breakout, a scar and a wart need different approaches, so your assessment comes first.",
    ],
    image=IMG_SKIN, image_alt="Professional skin consultation (illustrative)",
    services_title="Different concerns, thoughtfully different care",
    services=[
      ("Acne & breakouts", "For recurring pimples, blackheads or inflamed breakouts. Discuss what you’ve tried, what irritates your skin and how acne is affecting you.",
       ["Assessment of active acne and routine", "A personalised treatment discussion", "Laser or light options only when appropriate", "Aftercare and a review plan"]),
      ("Acne marks & scars", "For lingering marks, uneven texture or scars. Start by understanding what you’re seeing and which options may suit your skin.",
       ["Colour changes vs scarring explained", "Active acne reviewed before scar procedures", "Suitable laser or other treatments discussed", "Recovery and realistic expectations"]),
      ("Warts & skin bumps", "Not sure whether a bump is a wart, skin tag or something else? Let a clinician identify it before considering removal.",
       ["Clinical identification comes first", "Options for confirmed warts", "Laser considered for selected cases", "Healing, recurrence and aftercare"]),
    ],
    interests=["Skin — Acne & Breakout Consultation", "Skin — Acne Marks & Scars Consultation", "Skin — Wart & Bump Assessment", "Skin — Personalised Skin Comfort Plan"],
    note_title="Before any laser session",
    note=[
      "Ask about the device, the practitioner’s experience with your skin tone, the expected benefit, alternatives, discomfort, recovery and aftercare. Risks can include pigment changes, burns or scarring, and several visits may be needed.",
      "If a spot is new and unusual, changing, bleeding or not healing, get a medical assessment before any cosmetic removal. Painful, deep or scarring acne also deserves timely clinical care.",
    ],
    faqs=[
      ("Can laser treat every pimple, scar or wart?", "No. Active acne, marks, scars and warts are different concerns. Acne often needs medical skin care first; laser or light treatment may be considered in selected cases after assessment."),
      ("How many sessions will I need for acne scars?", "It depends on the type of scarring, your skin and the treatment chosen. You’ll get a proposed plan with session numbers, recovery time and total cost before you commit."),
      ("Is laser safe for Indian skin tones?", "Suitability depends on the device, settings and your skin. Ask about the practitioner’s experience with your skin tone and whether a test area is appropriate."),
      ("Where is the clinic?", "First floor, Anjali Arcade, near Nippon Toyota, Technopark Phase 3 Service Road, Kazhakkoottam. Open Monday–Saturday 10 am–8 pm and Sunday 10 am–2 pm."),
    ],
    disclaimer="Consultation-led care for adults aged 18+. Treatment choice, availability, suitability and fees are confirmed after assessment. No flawless-skin or scar-free result is guaranteed. Images are illustrative, not treatment results.",
    related=["laser-hair-reduction-trivandrum", "bridal-skin-care-trivandrum", "hair-fall-treatment-trivandrum"],
    specialty="Dermatology",
  ),
  # ------------------------------------------------------------------ LASER
  dict(
    slug="laser-hair-reduction-trivandrum",
    nav="Laser hair reduction",
    title="Laser Hair Reduction in Trivandrum – Face & Body | Hasta Wellness",
    description="Laser hair reduction for face, underarms, legs and body in Kazhakkoottam, Trivandrum. Private consultation, suitability check and a clear written plan.",
    eyebrow="HASTA LASER EDIT · FACE & BODY HAIR REDUCTION",
    h1="Laser hair reduction in Trivandrum. <em>Your choice, your pace.</em>",
    intro=[
      "The last-minute threading appointment. The daily chin-hair check. Planning a dress around your next waxing session. If managing unwanted hair is taking more headspace than you’d like, let’s talk.",
      "Facial and body hair are normal; choosing to reduce them is personal. At Hasta Wellness near Technopark, Kazhakkoottam, your comfort and questions come first — with space to talk privately, understand your options and decide at your own pace.",
    ],
    image=None, image_alt="",
    services_title="Choose your area of care",
    services=[
      ("Face", "Upper lip, chin or other facial hair. Start with a private conversation about what bothers you, your hair type and whether laser is appropriate.",
       ["Assessment of the areas you want to discuss", "Skin tone, hair colour and texture review", "Honest expectations about facial regrowth", "Health review or referral where indicated"]),
      ("Underarms", "An alternative to the cycle of shaving and waxing. Discuss a course of laser hair reduction suited to your skin and hair.",
       ["Individual suitability assessment", "Sessions and spacing discussed", "Comfort and aftercare explained", "Written treatment and cost proposal"]),
      ("Legs & body", "Spend less time on hair-removal routines. Explore half-leg or full-leg treatment, or ask about other body areas.",
       ["Choose the areas you want assessed", "Half-leg or full-leg coverage", "Visits planned around work and events", "Personalised multi-area bundle"]),
    ],
    interests=["Laser — Face Edit Consultation", "Laser — Underarm Edit Consultation", "Laser — Legs & Body Consultation", "Laser — Personalised Multi-area Bundle", "Laser — Personal Consultation"],
    note_title="Facial hair and hormones",
    note=[
      "New or increasing facial hair can sometimes be linked to hormones, including PCOS. Mention changes in your periods, acne or other symptoms during your consultation. Laser reduces hair; it does not treat an underlying hormonal condition, and a clinician may recommend further assessment.",
      "Before committing, confirm exact coverage, proposed sessions, total cost, maintenance and package terms. No fixed session count, discount or permanent result is promised.",
    ],
    faqs=[
      ("Is laser hair removal permanent?", "Laser aims for longer-term hair reduction rather than guaranteed permanent removal. A series of sessions is usually needed, and maintenance may be needed — especially for hormone-influenced facial hair."),
      ("Is laser suitable for Indian skin and fine facial hair?", "It depends on the device, settings, skin tone and hair. Ask about the practitioner’s experience with your skin tone and whether a patch test is appropriate. Very fine, light, grey or white hair may respond poorly."),
      ("Does laser hair reduction hurt?", "Most people feel some warmth or snapping, and temporary redness is common. Burns, pigment changes and scarring are possible, which is why suitability, settings and aftercare matter."),
      ("How do I book laser hair reduction in Kazhakkoottam?", "Use the enquiry form on this page or WhatsApp +91 97784 58883. The clinic confirms your consultation time."),
    ],
    disclaimer="For adults aged 18+. Areas, technology, availability, suitability and fees are confirmed by the clinic. If coarse facial hair appears suddenly with a deepening voice or other marked changes, seek prompt medical assessment.",
    related=["acne-scar-treatment-kazhakkoottam", "bridal-skin-care-trivandrum", "ems-weight-management-kazhakkoottam"],
    specialty="Dermatology",
  ),
  # ------------------------------------------------------------------ HAIR
  dict(
    slug="hair-fall-treatment-trivandrum",
    nav="Hair fall & thinning",
    title="Hair Fall Treatment in Trivandrum – PRP & GFC | Hasta Wellness",
    description="Noticing more hair fall or thinning? Hasta Root & Reset starts with a hair and scalp assessment, then discusses PRP, GFC and wellbeing support. Kazhakkoottam.",
    eyebrow="HASTA ROOT & RESET · ADULT HAIR WELLNESS",
    h1="Hair fall treatment that looks <em>beyond the hairbrush.</em>",
    intro=[
      "Late-night deadlines. A changing routine. More hair in the shower than you’re used to. It can feel unsettling — especially when you’re just finding your stride.",
      "Hair loss has different causes: stress, recent illness, nutrition and inherited patterns can all play a part. At Hasta Wellness in Kazhakkoottam, Root & Reset starts with listening and a clinical assessment, before any procedure is discussed.",
    ],
    image=IMG_HAIR, image_alt="Illustrative portrait of a woman with long wavy hair",
    services_title="Three ways to explore care",
    services=[
      ("Foundation assessment", "A consultation-led starting point for adults noticing shedding or thinning.",
       ["Hair and scalp concerns reviewed", "Vitals, nutrition, sleep and stress discussed", "Targeted tests only if indicated", "Personal next steps and review plan"]),
      ("PRP pathway", "Explore whether platelet-rich plasma (PRP) is an appropriate option for your diagnosed hair-loss concern.",
       ["Suitability discussion after assessment", "Blood collection and scalp injections explained", "Individual session and review proposal", "Risks and alternatives covered"]),
      ("GFC pathway", "Ask about growth factor concentrate (GFC), how the clinic prepares it and whether it suits you.",
       ["Clinical assessment before deciding", "Evidence, risks and alternatives", "Clear explanation of the protocol", "Personalised follow-up and costs"]),
    ],
    interests=["Hair — Foundation Assessment", "Hair — Root & Reset Consultation", "Hair — PRP Pathway Consultation", "Hair — GFC Pathway Consultation", "Hair — Complete Root & Reset Bundle"],
    note_title="Looking at the whole picture",
    note=[
      "Your clinician may suggest targeted tests — such as a blood count, iron status, thyroid function or selected vitamins — when your history warrants them. Sleep, stress and routine are part of the conversation too; relaxation support helps wellbeing but is not a hair-regrowth treatment.",
      "Sudden, patchy or painful hair loss, or an inflamed scalp, needs prompt clinical assessment.",
    ],
    faqs=[
      ("Is PRP or GFC right for every type of hair loss?", "No. Diagnosis comes first. PRP may be considered for selected hair-loss conditions; GFC protocols and evidence vary. Neither guarantees regrowth, and procedures can involve pain, bruising, bleeding or infection."),
      ("Do I need blood tests for hair fall?", "Not automatically. Tests depend on your history and examination, and are recommended only when they’re likely to help."),
      ("How many PRP sessions are needed?", "There’s no fixed number. A session and review plan is proposed after assessment, with costs in writing before you book a course."),
      ("Where can I get a hair fall consultation near Technopark?", "Hasta Wellness, first floor, Anjali Arcade, Technopark Phase 3 Service Road, Kazhakkoottam. Book on WhatsApp +91 97784 58883."),
    ],
    disclaimer="For adults aged 18+. Programme components are subject to assessment and clinic confirmation. Results and timelines vary. Images are illustrative.",
    related=["acne-scar-treatment-kazhakkoottam", "laser-hair-reduction-trivandrum", "ems-weight-management-kazhakkoottam"],
    specialty="Dermatology",
  ),
  # ------------------------------------------------------------------ BRIDAL / SKIN EDITS
  dict(
    slug="bridal-skin-care-trivandrum",
    nav="Bridal & event skin care",
    title="Bridal Skin Care in Trivandrum – Pre-Wedding | Hasta Wellness",
    description="Pre-wedding skin plans for brides and grooms, skin care for shoots and appearances, and care for changing skin. Consultation-led, near Technopark, Kazhakkoottam.",
    eyebrow="HASTA SKIN EDITS · KAZHAKKOOTTAM",
    h1="Bridal and event skin care, <em>planned around your moment.</em>",
    intro=[
      "Wedding countdowns. Days in the spotlight. A little time for yourself. Explore a skin-care plan built around your dates — with the details personalised after a consultation.",
      "At Hasta Wellness near Technopark, Kazhakkoottam, we talk about your skin goals and timeline first, then suggest suitable in-clinic care and a home routine. The earlier you start, the more options you’ll have.",
    ],
    image=IMG_SKIN, image_alt="Skin treatment in a calm clinic setting (illustrative)",
    services_title="Choose your edit",
    services=[
      ("The Bridal Edit", "For brides, grooms and wedding celebrations across Trivandrum. Plan around your wedding date with a realistic preparation timeline.",
       ["Face, neck and other areas discussed", "Suitable in-clinic care and home routine", "Visits planned around your celebrations", "Recovery time considered before the day"]),
      ("The Spotlight Edit", "For performers, creators and public-facing professionals. Skin care with your shoots, appearances and busy calendar in mind.",
       ["Share your shoot or event schedule", "Makeup-related skin concerns", "Recovery time before appearances", "A plan that fits your week"]),
      ("The Timeless Edit", "For midlife and beyond. Explore changing skin needs — dryness, uneven tone, texture — without the pressure to turn back time.",
       ["How your skin is changing", "Care for your priorities", "A routine for everyday life", "Reviews at a pace that suits you"]),
    ],
    interests=["Skin — The Bridal Edit", "Skin — The Spotlight Edit", "Skin — The Timeless Edit", "Skin — Personalised Package & Bundle"],
    note_title="Before you book a package",
    note=[
      "Ask for a written breakdown of the proposed treatments, number of sessions, spacing, home-care recommendations, inclusions, exclusions and total price — plus any package validity or cancellation terms.",
      "Leave time before important events. Some treatments need recovery time, and a new treatment right before a wedding or shoot isn’t always wise.",
    ],
    faqs=[
      ("When should I start pre-bridal skin care?", "Ideally a few months before your wedding, so there’s time to assess your skin, plan visits and allow recovery. Shorter timelines are possible but limit the options."),
      ("Is bridal skin care only for brides?", "No — grooms and family members are welcome too. The plan is built around your skin and your dates."),
      ("What does a skin package cost?", "It depends on the treatments and sessions proposed after your consultation. You’ll receive the total cost in writing before you decide."),
      ("Where is Hasta Wellness?", "First floor, Anjali Arcade, near Nippon Toyota, Technopark Phase 3 Service Road, Kazhakkoottam, Thiruvananthapuram. Open 7 days."),
    ],
    disclaimer="These are consultation-led package themes for adults aged 18+. Specific treatments, availability and fees are confirmed after assessment. Suitability, recovery time and outcomes vary. Images are illustrative.",
    related=["acne-scar-treatment-kazhakkoottam", "laser-hair-reduction-trivandrum", "clear-aligners-trivandrum"],
    specialty="Dermatology",
  ),
  # ------------------------------------------------------------------ EMS / WEIGHT
  dict(
    slug="ems-weight-management-kazhakkoottam",
    nav="EMS & weight management",
    title="EMS & Weight Management in Kazhakkoottam | Hasta Wellness",
    description="Explore EMS (electrical muscle stimulation) sessions and a supported, assessment-led weight management programme near Technopark, Kazhakkoottam, Trivandrum.",
    eyebrow="THE HASTA SIGNATURE WELLNESS PROGRAMME",
    h1="EMS and weight management. <em>Less “one day”, more day one.</em>",
    intro=[
      "Your calendar is full. Your wellbeing deserves a place in it. At Hasta Wellness near Technopark, Kazhakkoottam, you can explore EMS and weight management with a first step that starts with you.",
      "Every programme begins with an assessment of your goals, routine and suitability, so what you’re offered fits your life — not a one-size-fits-all plan.",
    ],
    image=None, image_alt="",
    services_title="Two ways to start",
    services=[
      ("EMS wellness", "Electrical muscle stimulation (EMS) is a guided session format. Talk to the team about whether it fits your wellness goals.",
       ["An introduction to how EMS works", "Suitability check first", "Goals and session format discussed", "Availability and pricing confirmed by the clinic"]),
      ("Weight management", "A conversation about your weight, routine and what you want to change — then a programme you choose together.",
       ["Your personal goals", "Routine and lifestyle", "A considered, realistic start", "Programme details and fees in writing"]),
      ("Both together", "Curious about both? Tell us your goals and explore a combined signature programme in one consultation.",
       ["One coordinated plan", "EMS alongside a weight plan", "Reviews built in", "Change pace as life changes"]),
    ],
    interests=["EMS Wellness", "Weight Management", "Signature Wellness — EMS & Weight Management"],
    note_title="Good to know",
    note=[
      "EMS is not a substitute for a weight management plan, and it isn’t suitable for everyone. Share relevant health information — such as heart conditions, implants, pregnancy or recent surgery — directly with the clinical team during your assessment.",
      "Suitability and outcomes vary. We won’t promise a number on the scale; we’ll help you build habits you can keep.",
    ],
    faqs=[
      ("What is EMS?", "Electrical muscle stimulation uses gentle electrical impulses to make muscles contract during a guided session. The team will explain the format and check whether it’s suitable for you."),
      ("Can EMS help me lose weight?", "EMS is not a weight-loss treatment on its own. If weight is your goal, ask about the weight management programme, which can be combined with EMS."),
      ("Is EMS safe for everyone?", "No. It may not be suitable with certain heart conditions, implanted devices, pregnancy or some other health conditions. An assessment comes first."),
      ("How do I book?", "Use the enquiry form on this page or WhatsApp +91 97784 58883. We’re open Monday–Saturday 10 am–8 pm and Sunday 10 am–2 pm."),
    ],
    disclaimer="EMS and weight management require individual assessment and are for adults aged 18+. Session format, duration, availability and fees are confirmed by the clinic. Outcomes vary.",
    related=["hair-fall-treatment-trivandrum", "laser-hair-reduction-trivandrum", "dental-clinic-kazhakkoottam"],
    specialty="Nutrition",
  ),
]
