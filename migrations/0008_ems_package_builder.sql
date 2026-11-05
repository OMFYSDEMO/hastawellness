-- Package builder: each package lists exactly what it includes (entitlements),
-- priced from a central price list. Client packages keep a snapshot.
CREATE TABLE IF NOT EXISTS ems_price_list (
  item TEXT PRIMARY KEY,              -- ems_session | review | wm_consult | diet_plan | measurements
  label TEXT NOT NULL,
  unit TEXT NOT NULL,                 -- per session | per review | per consultation | per package
  price INTEGER NOT NULL DEFAULT 0,   -- list price, rupees
  cost INTEGER NOT NULL DEFAULT 0,    -- internal cost, rupees
  sort INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO ems_price_list (item, label, unit, sort) VALUES
  ('ems_session', 'EMS session', 'per session', 1),
  ('review', 'Progress review (with measurements)', 'per review', 2),
  ('wm_consult', 'Weight-management consultation', 'per consultation', 3),
  ('diet_plan', 'Diet and lifestyle plan with daily check-ins', 'per package', 4),
  ('measurements', 'Progress measurements and charts', 'per package', 5);
ALTER TABLE ems_packages ADD COLUMN entitlements TEXT;      -- JSON {sessions, reviews, wm_consults, diet_plan, measurements}
ALTER TABLE ems_packages ADD COLUMN cost INTEGER;
ALTER TABLE ems_packages ADD COLUMN max_discount INTEGER NOT NULL DEFAULT 0;   -- % staff may discount at sale
ALTER TABLE ems_client_packages ADD COLUMN entitlements TEXT;
UPDATE ems_packages SET entitlements='{"sessions":10,"reviews":0,"wm_consults":0,"diet_plan":false,"measurements":false}' WHERE entitlements IS NULL AND name='EMS Starter';
UPDATE ems_packages SET entitlements='{"sessions":20,"reviews":4,"wm_consults":0,"diet_plan":false,"measurements":true}' WHERE entitlements IS NULL AND name='EMS Signature';
UPDATE ems_packages SET entitlements='{"sessions":20,"reviews":4,"wm_consults":4,"diet_plan":true,"measurements":true}' WHERE entitlements IS NULL AND name LIKE '%Weight%';
