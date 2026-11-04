-- Admission workflow: health screening -> clinician assessment and signed
-- recommendation -> client signed consent -> admitted (valid 12 months).
-- No package can be assigned and no EMS session booked without it.
CREATE TABLE IF NOT EXISTS ems_admissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  programmes TEXT NOT NULL,                 -- JSON array: "ems", "weight"
  status TEXT NOT NULL DEFAULT 'screening', -- screening | assessment | client_consent | admitted | not_suitable | withdrawn
  consent_version TEXT NOT NULL,
  screening TEXT,                           -- JSON {answers:{key:bool}, medicines, other}
  screened_at TEXT, screened_by TEXT,
  bp TEXT, heart_rate INTEGER, assess_weight REAL,
  findings TEXT, precautions TEXT, decision TEXT,
  clinician_id INTEGER, clinician_name TEXT, clinician_role TEXT, clinician_reg TEXT,
  clinician_sig TEXT, clinician_signed_at TEXT, clinician_letter TEXT,
  client_typed_name TEXT, client_sig TEXT, client_signed_at TEXT, client_sign_where TEXT, client_ip TEXT, client_letter TEXT,
  valid_until TEXT,
  withdrawn_at TEXT, withdrawn_reason TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ems_adm_client ON ems_admissions(client_id, id);
ALTER TABLE ems_packages ADD COLUMN programme TEXT NOT NULL DEFAULT 'ems';
ALTER TABLE ems_client_packages ADD COLUMN programme TEXT NOT NULL DEFAULT 'ems';
UPDATE ems_packages SET programme='combined' WHERE name LIKE '%Weight%';
