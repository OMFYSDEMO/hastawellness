-- External (visiting) consultants: clinicians who are not employees. They can be booked, named on
-- bill lines and paid a share; they are kept out of payroll, attendance and all-staff documents.
-- A login is optional (only needed if they write notes or prescriptions themselves).
ALTER TABLE ems_staff ADD COLUMN external INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ems_staff ADD COLUMN qualification TEXT;     -- e.g. MDS (Prosthodontics)
ALTER TABLE ems_staff ADD COLUMN speciality TEXT;
ALTER TABLE ems_staff ADD COLUMN phone TEXT;
ALTER TABLE ems_staff ADD COLUMN email TEXT;
ALTER TABLE ems_staff ADD COLUMN payout_pct REAL;         -- share of net (excl. GST) billed under them
ALTER TABLE ems_staff ADD COLUMN payout_per_visit REAL;   -- or a fixed amount per patient visit (bill)
ALTER TABLE ems_staff ADD COLUMN payout_note TEXT;        -- e.g. "materials and lab charges deducted"
