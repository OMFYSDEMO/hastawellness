-- Packages paid for in the previous system, entered so the remaining sessions can be redeemed here (no bill, no revenue).
ALTER TABLE cl_patient_packages ADD COLUMN legacy_ref TEXT;
ALTER TABLE cl_patient_packages ADD COLUMN legacy_paid REAL;
ALTER TABLE cl_patient_packages ADD COLUMN legacy_note TEXT;
ALTER TABLE cl_patient_packages ADD COLUMN created_by INTEGER;
ALTER TABLE cl_redemptions ADD COLUMN legacy INTEGER NOT NULL DEFAULT 0;
