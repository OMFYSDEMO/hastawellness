-- EMS tracker (ems.hastawellnessclinic.com): clients, packages, bookings,
-- measurements, payments, lifestyle plans and check-ins.

CREATE TABLE IF NOT EXISTS ems_staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'staff',           -- admin | staff
  pass_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS ems_clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  email TEXT,
  gender TEXT,                                  -- female | male | other
  birth_year INTEGER,
  height_cm REAL,
  goal TEXT,
  target_weight REAL,
  screening TEXT,                               -- JSON: suitability checklist answers
  cleared INTEGER NOT NULL DEFAULT 0,           -- 1 = cleared for EMS by clinician
  staff_notes TEXT,
  status TEXT NOT NULL DEFAULT 'active',        -- active | paused | completed
  pin_hash TEXT,
  consent_at TEXT,
  lead_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS ems_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sessions INTEGER NOT NULL,
  price INTEGER,                                -- rupees
  validity_days INTEGER NOT NULL DEFAULT 90,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ems_client_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  package_id INTEGER,
  name TEXT NOT NULL,
  sessions_total INTEGER NOT NULL,
  price INTEGER NOT NULL DEFAULT 0,
  discount INTEGER NOT NULL DEFAULT 0,
  start_date TEXT NOT NULL,
  expiry_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',        -- active | paused | closed
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ems_cp_client ON ems_client_packages(client_id);

CREATE TABLE IF NOT EXISTS ems_appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER,
  lead_id INTEGER,
  guest_name TEXT,
  guest_phone TEXT,
  kind TEXT NOT NULL DEFAULT 'session',         -- session | consultation | review
  start_at TEXT NOT NULL,                       -- IST local time, YYYY-MM-DDTHH:MM
  duration INTEGER NOT NULL DEFAULT 30,
  status TEXT NOT NULL DEFAULT 'booked',        -- booked | attended | no_show | cancelled
  client_package_id INTEGER,
  staff_id INTEGER,
  notes TEXT,
  created_by TEXT NOT NULL DEFAULT 'staff',     -- staff | client
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ems_appt_start ON ems_appointments(start_at);
CREATE INDEX IF NOT EXISTS idx_ems_appt_client ON ems_appointments(client_id, start_at);

CREATE TABLE IF NOT EXISTS ems_measurements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  measured_on TEXT NOT NULL,                    -- YYYY-MM-DD
  weight REAL, waist REAL, hips REAL, body_fat REAL, muscle_mass REAL,
  notes TEXT,
  staff_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ems_meas_client ON ems_measurements(client_id, measured_on);

CREATE TABLE IF NOT EXISTS ems_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  client_package_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  method TEXT NOT NULL DEFAULT 'UPI',           -- UPI | Cash | Card | Bank transfer
  paid_on TEXT NOT NULL,
  reference TEXT,
  staff_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ems_pay_client ON ems_payments(client_id);
CREATE INDEX IF NOT EXISTS idx_ems_pay_date ON ems_payments(paid_on);

CREATE TABLE IF NOT EXISTS ems_plans (
  client_id INTEGER PRIMARY KEY,
  diet TEXT NOT NULL DEFAULT 'kerala-balanced',
  water_target INTEGER NOT NULL DEFAULT 10,     -- glasses per day
  steps_target INTEGER NOT NULL DEFAULT 7000,
  sleep_target REAL NOT NULL DEFAULT 7,
  focus TEXT,                                   -- coach's personal note to the client
  updated_at TEXT,
  updated_by INTEGER
);

CREATE TABLE IF NOT EXISTS ems_checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  day TEXT NOT NULL,                            -- YYYY-MM-DD
  water INTEGER, steps INTEGER, sleep REAL,
  meals INTEGER,                                -- meals on plan today (0-4)
  energy INTEGER,                               -- 1-5
  note TEXT,
  UNIQUE(client_id, day)
);

CREATE TABLE IF NOT EXISTS ems_sessions (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                           -- staff | client
  subject_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ems_login_attempts (
  key TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ems_login ON ems_login_attempts(key, at);

CREATE TABLE IF NOT EXISTS ems_reminder_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER,
  lead_id INTEGER,
  kind TEXT NOT NULL,
  ref TEXT,
  staff_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ems_rem ON ems_reminder_log(kind, ref, created_at);

INSERT INTO ems_packages (name, sessions, price, validity_days, description)
SELECT 'EMS Starter', 10, NULL, 60, '10 guided EMS sessions'
WHERE NOT EXISTS (SELECT 1 FROM ems_packages);
INSERT INTO ems_packages (name, sessions, price, validity_days, description)
SELECT 'EMS Signature', 20, NULL, 120, '20 guided EMS sessions with monthly reviews'
WHERE (SELECT COUNT(*) FROM ems_packages) = 1;
INSERT INTO ems_packages (name, sessions, price, validity_days, description)
SELECT 'EMS + Weight Management', 20, NULL, 120, '20 EMS sessions with a lifestyle and diet plan'
WHERE (SELECT COUNT(*) FROM ems_packages) = 2;
