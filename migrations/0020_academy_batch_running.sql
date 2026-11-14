-- EMS Academy: running a batch after admission — lead trainer, timetable, attendance, module sign-off,
-- BLS follow-up, close-out and course feedback.

ALTER TABLE ems_academy_batches ADD COLUMN lead_trainer_id INTEGER;
ALTER TABLE ems_academy_batches ADD COLUMN min_attendance INTEGER NOT NULL DEFAULT 90;   -- % of teaching days before the theory test
ALTER TABLE ems_academy_batches ADD COLUMN completed_at TEXT;
ALTER TABLE ems_academy_batches ADD COLUMN completed_by TEXT;
ALTER TABLE ems_academy_batches ADD COLUMN completion_note TEXT;

-- BLS certificate uploaded by the trainee, checked by the Academy.
ALTER TABLE ems_academy_applications ADD COLUMN bls_status TEXT;            -- NULL | pending | verified | rejected
ALTER TABLE ems_academy_applications ADD COLUMN bls_checked_by TEXT;
ALTER TABLE ems_academy_applications ADD COLUMN bls_checked_at TEXT;

-- Timetable: one row per teaching day.
CREATE TABLE IF NOT EXISTS ems_academy_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL,
  day_date TEXT NOT NULL,
  start_time TEXT, end_time TEXT,
  modules TEXT,                                    -- JSON array of module numbers taught
  trainer_id INTEGER,
  topic TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_acad_days_batch ON ems_academy_days(batch_id, day_date);

CREATE TABLE IF NOT EXISTS ems_academy_attendance (
  day_id INTEGER NOT NULL,
  application_id INTEGER NOT NULL,
  status TEXT NOT NULL,                            -- present | late | absent | excused
  marked_by TEXT,
  marked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (day_id, application_id)
);

-- Module sign-off per training record (modules 1–10; module 11 is the supervised-practice log).
CREATE TABLE IF NOT EXISTS ems_academy_module_signoffs (
  record_id INTEGER NOT NULL,
  module_no INTEGER NOT NULL,
  signed_by INTEGER, signed_name TEXT,
  signed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (record_id, module_no)
);

-- End-of-course feedback, one per trainee.
CREATE TABLE IF NOT EXISTS ems_academy_feedback (
  application_id INTEGER PRIMARY KEY,
  batch_id INTEGER NOT NULL,
  ratings TEXT NOT NULL,                           -- JSON {content, trainers, practice, materials, organisation, overall} 1–5
  recommend INTEGER,                               -- 0–10
  best TEXT, improve TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
