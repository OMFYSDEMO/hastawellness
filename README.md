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
