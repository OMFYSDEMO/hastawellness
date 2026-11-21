-- EMS sold as structured programmes (tracks), private progress photos with separate marketing consent,
-- and weekly accountability contacts.
ALTER TABLE ems_packages ADD COLUMN track TEXT;              -- transformation | bridal | groom | women | sports
ALTER TABLE ems_clients ADD COLUMN photo_marketing INTEGER NOT NULL DEFAULT 0;   -- client allows anonymised before/after use
ALTER TABLE ems_clients ADD COLUMN photo_marketing_at TEXT;
CREATE TABLE IF NOT EXISTS ems_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  taken_on TEXT NOT NULL,
  pose TEXT NOT NULL,            -- front | side | back
  r2_key TEXT NOT NULL,
  mime TEXT NOT NULL,
  uploaded_by INTEGER,
  uploaded_by_name TEXT,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ems_photos_client ON ems_photos(client_id, taken_on);
CREATE TABLE IF NOT EXISTS ems_weekly_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  week TEXT NOT NULL,            -- Monday of the week (YYYY-MM-DD)
  staff_id INTEGER,
  staff_name TEXT,
  channel TEXT,                  -- whatsapp | call | in_person
  note TEXT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ems_weekly_client ON ems_weekly_contacts(client_id, week);
