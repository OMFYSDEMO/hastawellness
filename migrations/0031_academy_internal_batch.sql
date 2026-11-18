-- Internal (staff-only) academy batches: not listed on the public website; applicants use the batch's private link.
ALTER TABLE ems_academy_batches ADD COLUMN internal INTEGER NOT NULL DEFAULT 0;
