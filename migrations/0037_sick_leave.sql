-- Sick leave: 1 paid day earned each month (lapses 31 Dec); extra days from annual leave or unpaid.
-- Medical certificate required for 3+ working days in one application; approval blocked until uploaded.
ALTER TABLE cl_leave ADD COLUMN group_id INTEGER;
ALTER TABLE cl_leave ADD COLUMN cert_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cl_leave ADD COLUMN cert_key TEXT;
ALTER TABLE cl_leave ADD COLUMN cert_name TEXT;
ALTER TABLE cl_leave ADD COLUMN cert_type TEXT;
