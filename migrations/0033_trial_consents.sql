-- Trial / demo EMS sessions: short health screening and signed consent (client + staff) before the machine is switched on.
CREATE TABLE IF NOT EXISTS ems_trial_consents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id INTEGER NOT NULL,
  client_id INTEGER,
  lead_id INTEGER,
  name TEXT NOT NULL,
  phone TEXT,
  answers TEXT NOT NULL,
  any_yes INTEGER NOT NULL DEFAULT 0,
  bp TEXT,
  medicines TEXT,
  other TEXT,
  outcome TEXT NOT NULL,            -- cleared | refer
  typed_name TEXT,
  client_sig TEXT,
  staff_sig TEXT,
  staff_id INTEGER,
  staff_name TEXT,
  version TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_trial_consents_appt ON ems_trial_consents(appointment_id);
