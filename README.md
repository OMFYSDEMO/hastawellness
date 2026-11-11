# Hasta Wellness — website

Static website for Hasta Wellness, Kazhakkoottam, Thiruvananthapuram.
Deployed to the Cloudflare Worker `hasta-wellness-clinic` via Workers Builds.

- `public/index.html` — the complete site (logo and hair portrait embedded)
- `public/_headers` — security and caching headers
- `wrangler.jsonc` — deploy target (existing Worker, static assets only)

Every push to `main` deploys automatically once the repo is connected in
Cloudflare (Worker → Settings → Builds). Manual deploy: `npx wrangler deploy`.

Booking/enquiry requests are prepared in the browser and sent by the visitor
over WhatsApp to +91 97784 58883. Consented leads are stored in the D1
database `hasta-wellness-leads` and shown at /admin (password: ADMIN_PASSWORD
secret, username `hasta`); they are deleted automatically after 90 days.

## EMS Progress Studio (ems.hastawellnessclinic.com)

Client and staff platform for EMS / weight-management programmes, served by the
same Worker (`src/ems.js`, front end in `public/ems/`). On the `ems.` subdomain
the app runs at `/`; on any other host it is available at `/ems/`.

- **Staff** sign in with a team account, or `hasta` + the ADMIN_PASSWORD secret (admin).
- **Clients** sign in with their mobile number and a 6-digit PIN issued from their profile.
- Tracks packages (sessions used / booked / left), bookings and attendance,
  measurements with charts, payments and balances, lifestyle and diet plans,
  daily check-ins, guidance (rule-based insights) and follow-up reminders.
- Website enquiries (`leads` table) appear under **Website leads** and can be
  booked as consultations or turned into clients.
- Tables: `migrations/0003_ems.sql` (prefix `ems_`). Settings: `EMS_SLOT_CAPACITY`,
  `EMS_ORIGIN` in `wrangler.jsonc`. A morning digest email goes to ALERT_EMAILS.
- Icons: Lucide (ISC), see `public/ems/LICENSE-lucide.txt`.

### Admission and consent (`src/admission.js`)
Every client goes through admission before any enrolment: (1) health screening
(yes/no to every question, in the client app or with staff), (2) wellness coach
or doctor assessment with vitals, decision, precautions and a drawn signature,
(3) client consent signed in the app or on the clinic device, (4) admitted for
12 months. Packages can't be assigned, and EMS sessions can't be booked, without
a valid admission covering the package's programme. Signed letters are kept as
text snapshots with signatures and download as PDF (pdf-lib, MIT — see
`src/vendor/LICENSE-pdf-lib.md`). Consent text version: `CONSENT_VERSION`.

### Satellite units (`src/units.js`)
Each unit has its own hours, up to 3 EMS devices, team members (with skills:
EMS trainer, wellness coach, doctor, front desk) and a weekly rota with leave.
A session slot is offered only when a device and a rostered trainer are free;
each trainer supervises one client at a time. Consultations need a free coach
or doctor (in person at the unit, or by video from any unit's video shift).
Bookings get a device and staff member assigned automatically. Clients can
book at any unit. Units are company-owned or franchise; sessions delivered for
another unit's package appear in the cross-unit settlement on Payments.
Roles: admin (all units), unit manager (rota and leave), team.

### Machines and trainer certification
Settings → Machines holds machine models (type and features). Each unit device
is one of these machines, and packages can be limited to specific machines.
A trainer is allocated only to a device whose machine they hold a valid
Hasta EMS Academy certificate for (see below). Certificates are no longer issued
directly from Settings.

### Hasta EMS Academy (`src/academy.js`, `public/ems/academy.js`)
Enforces the Academy framework v1.0 agreed with the equipment supplier and
medical lead. Staff menu → Academy.
- **Curriculum and question bank** — v1.0 (9 modules) and 44 starter questions
  are seeded as drafts on first use. Only a team member with the *Medical lead*
  skill can approve the curriculum and questions; any edit returns a question
  to draft. Materials (links or uploads to R2 under `academy/`) are added by an
  admin or the medical lead.
- **Master Trainers** — a coach or doctor with an external qualification on the
  machine, checked with the issuer by a head-office admin or the medical lead
  (never the holder or submitter; method, contact and reference are recorded),
  plus the Master Trainer course recorded by someone else within 24 months.
- **Training records** (per trainee and machine): theory test of 40 questions
  drawn by area and shuffled, pass mark 80%, 3 attempts then retraining;
  10 supervised sessions including 3 first sessions, signed by a Master Trainer;
  the 16-point practical checklist, all items passed. Renewal with 20+ attended
  sessions on that machine in 12 months needs the test, practical and 1 session.
- **Certificates** — 12 months, per machine, ID `HEA-YYYY-XXXXXXXX`, PDF with QR
  code. A unit manager certifying someone at their own unit needs a second
  Master Trainer to countersign; until then the certificate does not allow
  bookings. Public check: `https://hastawellnessclinic.com/verify/<ID>`.
- Clients see "Hasta certified trainer ✓" with a verify link on upcoming sessions.

### Package builder (`src/packages.js`)
Settings → Price list sets the list price and cost of each item (EMS session,
progress review, weight-management consultation, diet plan, measurements).
The package builder defines exactly what a package includes and shows list
value, cost, margin and the price after the maximum staff discount. Staff can
only sell catalogue packages at the set price within that discount; custom
packages and session changes are admin-only. Reviews, weight-management
consultations, diet plans, check-ins and measurements are blocked unless the
client's active package includes them.

## Hasta Clinic app (clinicapp.hastawellnessclinic.com) — phase 1
`src/clinic.js`, `public/clinic/`. Same Worker, database and staff accounts as the EMS app
(`ems_staff.apps` decides who can use which app; admins can use both). Served on the
`clinicapp.*` host, or at `/clinicapp` on any host for local testing.
- Patients (linked to website leads and EMS clients by mobile number), appointments by
  clinician / room with clash checks and a department capability matrix.
- Catalogue: services, products and partner (pass-through) charges; prices exclude GST.
  Items marked not-for-sale (internal consumables, equipment) are never billable.
  Settings → Catalogue → Import reads .xlsx/.csv with column matching.
- Billing: draft → final invoices (HW/YY-YY/0001 per financial year), CGST/SGST per line,
  dental exempt, pass-through excluded from revenue, package GST split by contents,
  discounts over the limit authorised by a doctor/admin password, PDF invoice.
- Payments with mode and reference (UPI/card/bank/finance), advances auto-applied,
  voids by managers, cash in hand and bank deposits.
- Every completed visit must be billed, taken from a package or marked no-charge.
- Reports: day book, monthly GST by rate, department revenue, collections, discounts.
