-- Duty Watch: a disputed lapse can be upheld after review (status 'upheld', still counts).
ALTER TABLE cl_duty_lapses ADD COLUMN reviewed_by_name TEXT;
ALTER TABLE cl_duty_lapses ADD COLUMN review_note TEXT;
ALTER TABLE cl_duty_lapses ADD COLUMN reviewed_at TEXT;
