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
