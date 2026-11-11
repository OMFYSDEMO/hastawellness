-- Clinic app phase 2: care records — visit notes with prescription, dental chart, treatment plans,
-- recalls / follow-ups and clinical photos (images in R2 under clinic-photos/).

CREATE TABLE IF NOT EXISTS cl_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL, appointment_id INTEGER, dept_id INTEGER,
  visit_date TEXT NOT NULL,
  complaint TEXT, history TEXT, findings TEXT, diagnosis TEXT, treatment TEXT, advice TEXT,
  vitals TEXT,                                   -- JSON {bp, pulse, weight, spo2, temp}
  rx TEXT,                                       -- JSON [{name, dose, freq, days, note}]
  review_date TEXT, review_note TEXT,
  addenda TEXT,                                  -- JSON [{at, by, text}] added after the note is locked
  author_id INTEGER, author_name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cl_notes_patient ON cl_notes(patient_id, visit_date);

CREATE TABLE IF NOT EXISTS cl_dental_chart (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL, tooth TEXT NOT NULL, surfaces TEXT,
  condition TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'existing',   -- existing | planned | done
  note TEXT, active INTEGER NOT NULL DEFAULT 1,
  recorded_by INTEGER, recorded_by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cl_chart_patient ON cl_dental_chart(patient_id);

CREATE TABLE IF NOT EXISTS cl_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL, title TEXT NOT NULL, dept_id INTEGER,
  status TEXT NOT NULL DEFAULT 'proposed',       -- proposed | accepted | completed | cancelled
  notes TEXT, created_by INTEGER, created_by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), accepted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cl_plans_patient ON cl_plans(patient_id);
CREATE TABLE IF NOT EXISTS cl_plan_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL, item_id INTEGER NOT NULL, name TEXT NOT NULL, tooth TEXT,
  qty INTEGER NOT NULL DEFAULT 1, unit_price REAL NOT NULL DEFAULT 0, discount REAL NOT NULL DEFAULT 0,
  stage INTEGER NOT NULL DEFAULT 1, note TEXT,
  done INTEGER NOT NULL DEFAULT 0, done_at TEXT,
  invoice_id INTEGER, sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cl_plan_items ON cl_plan_items(plan_id);

CREATE TABLE IF NOT EXISTS cl_recalls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL, due_date TEXT NOT NULL, reason TEXT NOT NULL, dept_id INTEGER,
  status TEXT NOT NULL DEFAULT 'open',           -- open | booked | done | dismissed
  note_id INTEGER, appointment_id INTEGER, outcome TEXT,
  created_by INTEGER, created_by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cl_recalls_due ON cl_recalls(status, due_date);

CREATE TABLE IF NOT EXISTS cl_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL, note_id INTEGER,
  r2_key TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER,
  tag TEXT, area TEXT, caption TEXT, taken_on TEXT,
  uploaded_by INTEGER, uploaded_by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_cl_photos_patient ON cl_photos(patient_id);
