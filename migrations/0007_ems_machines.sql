-- Machines catalogue, machine-linked packages and trainer certification.
CREATE TABLE IF NOT EXISTS ems_machine_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  brand TEXT,
  category TEXT NOT NULL,          -- e.g. Whole-body EMS suit, Wireless EMS suit, Pelvic-floor chair
  features TEXT,                   -- JSON array of short feature lines
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS ems_certifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL,             -- the trainer
  machine_type_id INTEGER NOT NULL,
  certified_by INTEGER NOT NULL,         -- coach or doctor who certified
  certifier_name TEXT NOT NULL,
  certifier_role TEXT NOT NULL,
  issued_on TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- active | revoked
  revoked_at TEXT, revoked_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ems_cert_staff ON ems_certifications(staff_id, machine_type_id);
ALTER TABLE ems_devices ADD COLUMN machine_type_id INTEGER;
ALTER TABLE ems_devices ADD COLUMN serial_no TEXT;
ALTER TABLE ems_packages ADD COLUMN machine_types TEXT;          -- JSON array of machine type ids; empty = any machine
ALTER TABLE ems_client_packages ADD COLUMN machine_types TEXT;

INSERT INTO ems_machine_types (name, category, features)
SELECT 'Standard EMS suit', 'Whole-body EMS suit', '["Whole-body muscle stimulation","Adjustable intensity per muscle group"]'
WHERE NOT EXISTS (SELECT 1 FROM ems_machine_types);
UPDATE ems_devices SET machine_type_id=(SELECT MIN(id) FROM ems_machine_types) WHERE machine_type_id IS NULL;
