-- Hasta Quest: clients log their own meals and weekly weigh-ins (src/emsgame.js).
CREATE TABLE IF NOT EXISTS ems_meal_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL, day TEXT NOT NULL,
  meal TEXT NOT NULL,              -- breakfast | lunch | snack | dinner
  status TEXT NOT NULL,            -- on | partly | off | skipped
  protein INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (client_id, day, meal)
);
CREATE INDEX IF NOT EXISTS idx_meal_logs_client ON ems_meal_logs(client_id, day);
ALTER TABLE ems_measurements ADD COLUMN self INTEGER NOT NULL DEFAULT 0;   -- 1 = entered by the client at home
