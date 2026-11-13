-- EMS Academy admissions: external candidates apply on the website, are reviewed, pay the course fee
-- through the clinic app (GST bill, day book), are enrolled with a trainee login (Academy only) and
-- follow the same training record, test, supervised practice and certification as staff.

CREATE TABLE IF NOT EXISTS ems_academy_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,                       -- e.g. EMSA-2026-12
  title TEXT NOT NULL,
  machine_type_id INTEGER,                         -- machine the batch trains on
  start_date TEXT NOT NULL, end_date TEXT,
  schedule TEXT,                                   -- e.g. "Mon–Fri, 10 am – 4 pm; supervised practice over the next 4 weeks"
  seats INTEGER NOT NULL DEFAULT 6,
  fee REAL NOT NULL DEFAULT 0,                     -- course fee before GST (18% added on the bill)
  apply_by TEXT,
  status TEXT NOT NULL DEFAULT 'draft',            -- draft | open | closed | completed | cancelled
  notes TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS ems_academy_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_no TEXT NOT NULL UNIQUE,                     -- EMSA/2026/0001
  batch_id INTEGER NOT NULL,
  name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT, dob TEXT, gender TEXT,
  address TEXT, city TEXT,
  qualification TEXT NOT NULL, qualification_body TEXT, registration_no TEXT,
  experience TEXT, employer TEXT,
  bls TEXT,                                        -- valid | expired | none
  bls_expiry TEXT,
  statement TEXT,                                  -- why they want to train
  how_heard TEXT,
  docs TEXT,                                       -- JSON {id_proof:{key,name,type}, qualification:{…}, bls:{…}, photo:{…}}
  consent_at TEXT, consent_ip_hash TEXT,
  status TEXT NOT NULL DEFAULT 'submitted',        -- submitted | interview | offered | enrolled | completed | waitlisted | rejected | withdrawn
  checks TEXT,                                     -- JSON eligibility checks ticked by the reviewer
  interview_at TEXT,
  reject_reason TEXT,
  offer_expires TEXT,
  fee_waived_reason TEXT,
  patient_id INTEGER,                              -- clinic record used for the course-fee bill
  invoice_id INTEGER,                              -- clinic bill for the course fee
  staff_id INTEGER,                                -- trainee login created on enrolment
  record_id INTEGER,                               -- training record
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_acad_apps_batch ON ems_academy_applications(batch_id, status);
CREATE INDEX IF NOT EXISTS idx_acad_apps_phone ON ems_academy_applications(phone);

CREATE TABLE IF NOT EXISTS ems_academy_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL,
  action TEXT NOT NULL, note TEXT,
  by_name TEXT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_acad_events_app ON ems_academy_events(application_id);

-- Supervised sessions with Hasta clients: the client agreed to a trainee working with them.
ALTER TABLE ems_supervised_logs ADD COLUMN client_consent INTEGER NOT NULL DEFAULT 0;

-- Course fee on the clinic bill (commercial training and coaching services, 18%).
INSERT OR IGNORE INTO cl_items (code, name, category, kind, price, gst_rate, hsn_sac, sellable, notes)
VALUES ('EMS-ACADEMY', 'EMS Trainer Programme — course fee', 'EMS Academy', 'service', 0, 18, '999293', 0,
        'Billed only from EMS Academy admissions. Fee comes from the batch.');

INSERT OR IGNORE INTO cl_settings (key, value) VALUES ('academy_terms',
'The course fee is payable in full before the course starts. If you withdraw at least 7 days before the start date, the fee is refunded in full; after that it can be moved once to a later batch. Hasta may cancel or reschedule a batch with too few candidates, in which case the fee is refunded in full. Certification depends on passing every assessment; it is not guaranteed by paying the fee.');
