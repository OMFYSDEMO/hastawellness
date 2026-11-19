-- Front desk records that the patient arrived late (time = when it was marked), so a late arrival is not counted
-- as a late marking by the front desk.
ALTER TABLE cl_appointments ADD COLUMN late_arrival_at TEXT;
ALTER TABLE cl_appointments ADD COLUMN late_reason TEXT;
