-- Balances carried over from the previous clinic system at switch-over.
-- legacy=1 invoices hold only the unpaid balance of an old invoice (no GST, not revenue);
-- legacy=1 payments hold an advance brought forward. Both stay out of GST, revenue and collection reports.
ALTER TABLE cl_invoices ADD COLUMN legacy INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cl_payments ADD COLUMN legacy INTEGER NOT NULL DEFAULT 0;
