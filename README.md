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

### Stock & purchasing (clinic app, phase 3a)
- `src/stock.js` — suppliers, purchase orders (draft → approved → part received / received / closed), goods received notes with batch, expiry and free quantity, stock moves, supplier payments, purchase GST summary and the PO PDF. Migration `0013_clinic_stock.sql`.
- Stock on hand = `SUM(cl_stock_moves.qty)`; batches go out first-expiry-first. A finalised invoice takes its product lines out of stock; cancelling it puts them back.
- Managers approve orders, pay suppliers and adjust stock; any clinic user can raise a draft order, receive goods and record use in treatment.
- Data from the previous system (opening stock, suppliers, order and GRN headers) is loaded with `legacy=1` where lines were not available.

### Clinic app: speed notes
- Every D1 query is a network round trip, so the clinic API groups reads with `env.DB.batch()` (boot, dashboard, cash book, stock alerts, package prices) and reads the session, staff record and departments in one query.
- Files under `/clinic/` and `/ems/` requested with `?v=N` are cached by browsers for a year. **Bump the `?v=` number whenever you change `public/clinic/app.js`, `clinic.css`, `public/ems/core.js` or `app.css`** (in `src/clinic.js` → `shell()` and the import line at the top of `app.js`).

### Clinic app: staff attendance, leave & pay (`src/hr.js`, migration 0015)
- **Clock in/out:** a manager registers the clinic desktop (Staff → Setup → *Make this computer the attendance screen*); it then shows `/kiosk`, a QR code that changes every 30 s. Staff scan it with their phone camera. The scan is accepted only if the code is current (≤ 90 s old) and the phone's GPS is inside the clinic geofence (Staff → Setup → clinic location, default 150 m). The first scan needs a sign-in; the phone is then remembered for attendance only.
- **Leave:** applied for in *My attendance* before the day; only the leave approver(s) (`leave_approvers`, Dr Akshara) can approve. 1 paid annual leave day accrues per month; sick / casual allowances per year are configurable (0 by default).
- **Absences:** a working day (not weekly off / holiday) with no attendance and no approved leave is an unauthorised absence. A manager or the approver either adds the attendance ("was at work") or confirms it, which issues a numbered warning letter PDF (`WL/YYYY/0001`).
- **Pay:** rate = monthly salary ÷ (working days × daily hours). Paid hours = worked + paid leave, capped at contract hours less absent / unpaid-leave days. No overtime. Months are finalised (locked) by a manager once ended; payslips then appear for staff. PF / ESI / TDS are not included.
- Staff without the clinic app (e.g. support staff) can sign in and see only *My attendance*.

### Clinic app: staff documents (`src/docs.js`, migration 0016)
- Managers issue memos, notices, policies and training records (text and/or a PDF / image up to 10 MB, stored in R2 under `staff-docs/`) to all staff or chosen staff, optionally with a sign-by date.
- Each recipient sees it in *My documents* (a banner reminds them until signed), opens it, ticks "I have read and understood" and types their full name. The signature is stored with time, IP, device and the document's SHA-256 fingerprint (title + text + file hash). Issued documents cannot be edited — only withdrawn.
- Staff → Documents shows signing progress; each document has an acknowledgement-record PDF, and every signer a signed copy (original PDF + acknowledgement page).
- Staff → Staff files keeps each person's records (appointment letter, ID proof, certificates, registration…), the documents issued to them and their warning letters. Staff see their own records.

### Clinic ↔ EMS: one record, one money account (`src/emslink.js`, migration 0017)
- **Link.** `cl_patients.ems_client_id`, counted only once staff confirm it (`ems_link_at`). Matching mobile numbers (main or alternative) are offered as suggestions on both sides (clinic patient → EMS tab; EMS client → Overview → Clinic record); nothing links itself, and shared family numbers are flagged. One EMS client ↔ one patient. Changing either phone so they no longer match drops the link back to "needs confirming". The EMS app can also create the clinic record from the client.
- **Money.** Selling an EMS package needs a confirmed link; it makes a draft clinic bill with one line on catalogue item `EMS-PKG` (18%, SAC 999723, not pickable in the clinic). With `ems_price_incl_gst=1` the EMS price is GST-inclusive, so the bill totals the EMS price (a paisa under when no exact split exists). Price, discount and name on that line can only come from the EMS app. Payments are taken only in the clinic app (day book, cash book, GST summary); the EMS app shows the bill and what is due. `ems_receipts` (view) is the single list of money received per EMS package — clinic allocations to the package bill (the EMS line's share if the bill has other items) plus any old EMS-app payments not yet dealt with.
- **Old EMS-app payments.** Billing (managers) lists them: *Bring across* makes the package bill and records the payment on its original date (refused if the same reference is already on a clinic payment, unless confirmed); *Already billed* records where the money is in the clinic records and stops the EMS row counting.
- **View.** EMS bookings at the units in `ems_calendar_units` (default 1, HQ) show in the clinic calendar (day: EMS column; week/month: purple chips), the patient's Visits and EMS tabs, and the front-desk alerts (sessions not marked attended/no-show after the session plus 15 min; EMS package bills from `ems_billing_from` not finalised or not fully paid). The front desk can mark attendance; bookings are still made in the EMS app.

### Clinic app: paperless signing (`src/docs.js`, `src/forms.js`, migration 0018)
- **Issuer e-signature.** Everything issued to staff (memos, notices, policies, training, forms, warning letters, payslips; staff records only when the person must sign) needs the issuer to tick "I approve … and sign it as the issuer" and type their own name. Stored on the document (name, designation from the pay profile, time, IP) and printed on the acknowledgement record.
- **Warning letters.** Confirming an absence (with the issuer signature) creates the WL letter PDF, keeps it in R2 and sends it to the staff member to acknowledge within 3 days. `/hr/warnings/:id/pdf` serves exactly the stored PDF.
- **Payslips.** Finalising a month (with the issuer signature) sends each person's payslip PDF for acknowledgement within 7 days.
- **Disputes and refusals.** Warning letters and payslips can be acknowledged "received but I disagree" (comment required). A manager can record that someone refused to sign. Overdue, disputed and refused show in Staff → Documents and on the acknowledgement record.
- **Forms.** Templates in `src/forms.js`: joining, bank/ID/statutory (Aadhaar last 4 digits only), confidentiality & patient privacy, uniform & equipment receipt, clinic phone handover, exit & clearance. The issuer fills the clinic's fields when sending; the staff member fills the rest and signs. The form as issued is stored with the document; the completed form PDF (answers + both signatures + acknowledgement page) is the signed copy.

## EMS Academy admissions (external candidates)

- **Website** `/academy/` — course, entry requirements, open batches (fee + 18% GST), apply form with documents (PDF/JPG/PNG ≤5 MB, checked by first bytes, stored privately in R2 under `academy-apply/`). `/academy/status` lets an applicant check progress with application number + mobile. Documents of applicants who never got a seat are deleted after 180 days (daily cron).
- **EMS app → Academy → Admissions** (managers, admins) — batches (dates, machine, seats, fee before GST, status draft/open/closed/completed/cancelled); applications with documents, eligibility checks, history. Interview → Offer (needs ID, qualification, background and interview checks; respects the seat limit; creates or reuses a clinic patient record and a draft bill on item `EMS-ACADEMY`, SAC 999293, 18%) → the desk finalises and takes payment in the clinic app → Enrol (only when the bill is fully paid; an admin may enrol earlier with a reason) creates a trainee login and opens the training record on the batch's machine.
- **Trainee accounts** (`ems_staff.role = 'trainee'`) see only *My course*: materials of the approved curriculum, their record, the theory test and their certificates. They are blocked from every other EMS route, the clinic app, team lists, rota, documents and payroll. Supervised sessions for trainees need the client's agreement ticked by the Master Trainer.
- Migration `0019_academy_admissions.sql`. Course page requirements and fee/refund terms are settings (`academy_requirements`, `academy_terms`), edited by admins in Admissions → Course page text.
