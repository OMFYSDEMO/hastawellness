-- Outreach campaigns (e.g. a Technopark booth day) and the quick body check done at the booth.
-- A booth visitor becomes a lead (source 'booth', channel 'event'); their readings sit in lead_screenings.
-- Screenings are removed with their lead by the 90-day lead clean-up unless the person becomes a client
-- (their first reading is then copied into ems_measurements as the baseline).
CREATE TABLE IF NOT EXISTS ems_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  place TEXT,
  start_day TEXT NOT NULL,            -- YYYY-MM-DD
  end_day TEXT,                       -- YYYY-MM-DD, same as start for a one-day event
  offer TEXT,                         -- what booth visitors are offered (shown in the WhatsApp message)
  offer_days INTEGER NOT NULL DEFAULT 14,
  unit_id INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS lead_screenings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL,
  campaign_id INTEGER,
  gender TEXT, age INTEGER, height_cm REAL, weight REAL,
  body_fat REAL, muscle_mass REAL, visceral_fat REAL, water_pct REAL, metabolic_age REAL, waist REAL,
  bmi REAL, bmr INTEGER, bmr_source TEXT, tdee INTEGER, kcal_target INTEGER,
  activity TEXT, aim TEXT,
  concerns TEXT,                      -- JSON list: weight, belly, energy, sleep, stress, tone, diet, back
  sleep_hours REAL, energy INTEGER,   -- energy 1 (drained) – 5 (great)
  interest TEXT,                      -- now | later | no  (would they like a trial / consultation)
  heat TEXT,                          -- hot | warm | cold
  best_time TEXT,
  device TEXT,
  consent_contact INTEGER NOT NULL DEFAULT 0,
  wa_sent INTEGER NOT NULL DEFAULT 0,
  staff_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_lscr_lead ON lead_screenings(lead_id);
CREATE INDEX IF NOT EXISTS idx_lscr_campaign ON lead_screenings(campaign_id, created_at);
ALTER TABLE leads ADD COLUMN campaign_id INTEGER;
