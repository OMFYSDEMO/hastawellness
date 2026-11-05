-- Hasta EMS Academy (framework v1.0): verified external qualifications for Master
-- Trainers, approved curriculum versions, materials, question bank, training
-- records (tests, supervised sessions, practical assessment) and verifiable certificates.
CREATE TABLE IF NOT EXISTS ems_external_quals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL,
  issuer TEXT NOT NULL, certificate_no TEXT NOT NULL, holder_name TEXT NOT NULL,
  issued_on TEXT NOT NULL, expires_on TEXT NOT NULL,
  machine_types TEXT NOT NULL,                 -- JSON array of machine type ids covered
  verify_link TEXT, file_key TEXT, file_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',      -- pending | verified | rejected
  verified_by INTEGER, verifier_name TEXT, verified_at TEXT, verify_method TEXT, verify_contact TEXT, verify_ref TEXT,
  reject_reason TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ems_xq_staff ON ems_external_quals(staff_id, status);
CREATE TABLE IF NOT EXISTS ems_curriculum (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL UNIQUE,
  modules TEXT NOT NULL,                       -- JSON [{no, title, content, hours, assessed}]
  status TEXT NOT NULL DEFAULT 'draft',        -- draft | approved | retired
  approved_by INTEGER, approver_name TEXT, approved_at TEXT, notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS ems_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  curriculum_id INTEGER NOT NULL, module_no INTEGER NOT NULL,
  title TEXT NOT NULL, kind TEXT NOT NULL,     -- file | link
  url TEXT, file_key TEXT, file_name TEXT, source TEXT,
  added_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS ems_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  area TEXT NOT NULL, question TEXT NOT NULL, options TEXT NOT NULL, answer INTEGER NOT NULL, explanation TEXT,
  status TEXT NOT NULL DEFAULT 'draft',        -- draft | approved | retired
  approved_by INTEGER, approver_name TEXT, approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS ems_training_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL, machine_type_id INTEGER NOT NULL, curriculum_id INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'initial',        -- initial | renewal
  status TEXT NOT NULL DEFAULT 'in_training',  -- in_training | retraining | certified | closed
  opened_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS ems_test_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL, question_ids TEXT NOT NULL, answers TEXT,
  score INTEGER, passed INTEGER,
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), submitted_at TEXT
);
CREATE TABLE IF NOT EXISTS ems_supervised_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL, session_date TEXT NOT NULL, first_session INTEGER NOT NULL DEFAULT 0,
  appointment_id INTEGER, notes TEXT, supervisor_id INTEGER NOT NULL, supervisor_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS ems_practicals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL, items TEXT NOT NULL, passed INTEGER NOT NULL, notes TEXT,
  assessor_id INTEGER NOT NULL, assessor_name TEXT NOT NULL,
  assessed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
ALTER TABLE ems_staff ADD COLUMN master_course_on TEXT;
ALTER TABLE ems_staff ADD COLUMN master_course_by TEXT;
ALTER TABLE ems_certifications ADD COLUMN code TEXT;
ALTER TABLE ems_certifications ADD COLUMN record_id INTEGER;
ALTER TABLE ems_certifications ADD COLUMN curriculum_version TEXT;
ALTER TABLE ems_certifications ADD COLUMN theory_score INTEGER;
ALTER TABLE ems_certifications ADD COLUMN sessions_logged INTEGER;
ALTER TABLE ems_certifications ADD COLUMN practical_on TEXT;
ALTER TABLE ems_certifications ADD COLUMN qual_id INTEGER;
ALTER TABLE ems_certifications ADD COLUMN countersigned_by INTEGER;
ALTER TABLE ems_certifications ADD COLUMN countersigner_name TEXT;
ALTER TABLE ems_certifications ADD COLUMN countersigned_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ems_cert_code ON ems_certifications(code);
