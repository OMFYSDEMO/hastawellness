-- Satellite units across Kerala: each unit has its own hours, EMS devices (max 3),
-- staff rota and capacity. Clients, packages, payments, bookings and leads carry a unit.
CREATE TABLE IF NOT EXISTS ems_units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  ownership TEXT NOT NULL DEFAULT 'owned',      -- owned | franchise
  franchise_name TEXT,                          -- legal name of the franchisee
  revenue_share INTEGER NOT NULL DEFAULT 100,   -- % of a session's value paid to the unit that delivers it for another unit's client
  address TEXT, district TEXT, pincodes TEXT, phone TEXT, upi TEXT,
  hours TEXT NOT NULL,                          -- JSON {"0":["10:00","14:00"],"1":["10:00","20:00"],...}; missing day = closed
  slot_minutes INTEGER NOT NULL DEFAULT 30,
  clients_per_trainer INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS ems_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',        -- active | maintenance | retired
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_ems_devices_unit ON ems_devices(unit_id);
CREATE TABLE IF NOT EXISTS ems_staff_units (
  staff_id INTEGER NOT NULL,
  unit_id INTEGER NOT NULL,
  PRIMARY KEY (staff_id, unit_id)
);
CREATE TABLE IF NOT EXISTS ems_rota (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL,
  unit_id INTEGER NOT NULL,
  weekday INTEGER NOT NULL,                     -- 0 = Sunday
  start_time TEXT NOT NULL,                     -- HH:MM
  end_time TEXT NOT NULL,
  video INTEGER NOT NULL DEFAULT 0              -- also takes video consultations in this shift
);
CREATE INDEX IF NOT EXISTS idx_ems_rota_unit ON ems_rota(unit_id, weekday);
CREATE TABLE IF NOT EXISTS ems_leave (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  note TEXT,
  UNIQUE(staff_id, day)
);
ALTER TABLE ems_staff ADD COLUMN skills TEXT NOT NULL DEFAULT '["trainer","coach"]';
ALTER TABLE ems_staff ADD COLUMN reg_no TEXT;
ALTER TABLE ems_clients ADD COLUMN home_unit_id INTEGER;
ALTER TABLE ems_client_packages ADD COLUMN unit_id INTEGER;
ALTER TABLE ems_payments ADD COLUMN unit_id INTEGER;
ALTER TABLE ems_appointments ADD COLUMN unit_id INTEGER;
ALTER TABLE ems_appointments ADD COLUMN device_id INTEGER;
ALTER TABLE ems_appointments ADD COLUMN trainer_id INTEGER;
ALTER TABLE ems_appointments ADD COLUMN mode TEXT NOT NULL DEFAULT 'in_person';
ALTER TABLE ems_admissions ADD COLUMN assess_mode TEXT;
ALTER TABLE leads ADD COLUMN unit_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_ems_appt_unit ON ems_appointments(unit_id, start_at);
CREATE INDEX IF NOT EXISTS idx_ems_appt_trainer ON ems_appointments(trainer_id, start_at);

-- The existing clinic becomes unit 1 and owns all existing records.
INSERT INTO ems_units (code, name, ownership, address, district, pincodes, phone, hours, slot_minutes, clients_per_trainer)
SELECT 'KZK', 'Kazhakkoottam (HQ)', 'owned', '1st floor, Anjali Arcade, near Nippon Toyota, Technopark Phase 3 Service Road, Kazhakkoottam, Thiruvananthapuram 695582',
  'Thiruvananthapuram', '695582,695581,695583,695584,695585,695586,695587', '+91 97784 58883',
  '{"0":["10:00","14:00"],"1":["10:00","20:00"],"2":["10:00","20:00"],"3":["10:00","20:00"],"4":["10:00","20:00"],"5":["10:00","20:00"],"6":["10:00","20:00"]}', 30, 1
WHERE NOT EXISTS (SELECT 1 FROM ems_units);
INSERT INTO ems_devices (unit_id, name) SELECT 1, 'EMS device 1' WHERE NOT EXISTS (SELECT 1 FROM ems_devices);
INSERT INTO ems_devices (unit_id, name) SELECT 1, 'EMS device 2' WHERE (SELECT COUNT(*) FROM ems_devices) = 1;
INSERT OR IGNORE INTO ems_staff_units (staff_id, unit_id) SELECT id, 1 FROM ems_staff;
UPDATE ems_clients SET home_unit_id=1 WHERE home_unit_id IS NULL;
UPDATE ems_client_packages SET unit_id=1 WHERE unit_id IS NULL;
UPDATE ems_payments SET unit_id=1 WHERE unit_id IS NULL;
UPDATE ems_appointments SET unit_id=1 WHERE unit_id IS NULL;
-- Starter rota so booking keeps working: every current team member at HQ during opening hours.
-- Edit it under Rota.
INSERT INTO ems_rota (staff_id, unit_id, weekday, start_time, end_time, video) SELECT s.id, 1, 0, '10:00', '14:00', 1 FROM ems_staff s WHERE s.active=1 AND NOT EXISTS (SELECT 1 FROM ems_rota r WHERE r.staff_id=s.id AND r.weekday=0);
INSERT INTO ems_rota (staff_id, unit_id, weekday, start_time, end_time, video) SELECT s.id, 1, 1, '10:00', '20:00', 1 FROM ems_staff s WHERE s.active=1 AND NOT EXISTS (SELECT 1 FROM ems_rota r WHERE r.staff_id=s.id AND r.weekday=1);
INSERT INTO ems_rota (staff_id, unit_id, weekday, start_time, end_time, video) SELECT s.id, 1, 2, '10:00', '20:00', 1 FROM ems_staff s WHERE s.active=1 AND NOT EXISTS (SELECT 1 FROM ems_rota r WHERE r.staff_id=s.id AND r.weekday=2);
INSERT INTO ems_rota (staff_id, unit_id, weekday, start_time, end_time, video) SELECT s.id, 1, 3, '10:00', '20:00', 1 FROM ems_staff s WHERE s.active=1 AND NOT EXISTS (SELECT 1 FROM ems_rota r WHERE r.staff_id=s.id AND r.weekday=3);
INSERT INTO ems_rota (staff_id, unit_id, weekday, start_time, end_time, video) SELECT s.id, 1, 4, '10:00', '20:00', 1 FROM ems_staff s WHERE s.active=1 AND NOT EXISTS (SELECT 1 FROM ems_rota r WHERE r.staff_id=s.id AND r.weekday=4);
INSERT INTO ems_rota (staff_id, unit_id, weekday, start_time, end_time, video) SELECT s.id, 1, 5, '10:00', '20:00', 1 FROM ems_staff s WHERE s.active=1 AND NOT EXISTS (SELECT 1 FROM ems_rota r WHERE r.staff_id=s.id AND r.weekday=5);
INSERT INTO ems_rota (staff_id, unit_id, weekday, start_time, end_time, video) SELECT s.id, 1, 6, '10:00', '20:00', 1 FROM ems_staff s WHERE s.active=1 AND NOT EXISTS (SELECT 1 FROM ems_rota r WHERE r.staff_id=s.id AND r.weekday=6);
