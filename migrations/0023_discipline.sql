-- Disciplinary procedure: verbal warning → first written warning → final written warning → dismissal,
-- with show-cause notice, written reply, hearing and appeal recorded for each case.
CREATE TABLE IF NOT EXISTS cl_disc_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_no TEXT NOT NULL UNIQUE,                  -- DC/2026/0001
  staff_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  gross TEXT,                                    -- gross-misconduct type, if alleged
  incident_date TEXT NOT NULL, incident_end TEXT,
  allegation TEXT NOT NULL, rule_breached TEXT NOT NULL, evidence TEXT,
  attachments TEXT,                              -- JSON [{key,name,type}] in R2 (staff-docs/)
  status TEXT NOT NULL DEFAULT 'open',           -- open | closed
  outcome TEXT,
  raised_by INTEGER, raised_by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  closed_at TEXT, closed_by_name TEXT
);
CREATE INDEX IF NOT EXISTS idx_disc_cases_staff ON cl_disc_cases(staff_id);
CREATE TABLE IF NOT EXISTS cl_disc_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL, staff_id INTEGER NOT NULL,
  stage TEXT NOT NULL,                           -- verbal | show_cause | hearing | written | final | dismissal | no_action | appeal
  details TEXT,                                  -- JSON: what was said, findings, reasons, consideration of the reply …
  doc_id INTEGER,                                -- the signed letter sent to the employee (cl_docs)
  reply_due TEXT,                                -- show-cause: reply by
  valid_until TEXT,                              -- warnings: lapse date
  status TEXT NOT NULL DEFAULT 'active',         -- active | reduced | overturned (after appeal)
  by_id INTEGER, by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_disc_actions_staff ON cl_disc_actions(staff_id, stage);
CREATE INDEX IF NOT EXISTS idx_disc_actions_case ON cl_disc_actions(case_id);
