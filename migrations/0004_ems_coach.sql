-- Team member (coach) allocated to each EMS client.
ALTER TABLE ems_clients ADD COLUMN coach_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_ems_clients_coach ON ems_clients(coach_id);
