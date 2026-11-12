-- One record, one money account: clinic patients <-> EMS clients.
--
-- 1. Link. cl_patients.ems_client_id holds the link. A link counts only once a member of staff has
--    confirmed it (ems_link_at set). Suggestions come from matching mobile numbers; nothing is linked
--    automatically, and a link drops back to "needs confirming" when either phone number changes.
-- 2. Money. An EMS package sold in the EMS app becomes a GST bill in the clinic app (one line, the
--    "EMS package" catalogue item, 18%). Payments are taken in the clinic app only, so they reach the
--    day book. ems_payments keeps the payments recorded before this change; each is either brought
--    across to the clinic (clinic_payment_id) or marked as already billed there (resolved_note).
-- 3. ems_receipts is the single list of money received for EMS packages, from either source.

ALTER TABLE cl_patients ADD COLUMN ems_link_by INTEGER;          -- staff id who confirmed (0 = system check)
ALTER TABLE cl_patients ADD COLUMN ems_link_at TEXT;             -- NULL = not confirmed yet

ALTER TABLE ems_client_packages ADD COLUMN invoice_id INTEGER;   -- clinic bill for this package
CREATE INDEX IF NOT EXISTS idx_ems_cp_invoice ON ems_client_packages(invoice_id);

ALTER TABLE ems_payments ADD COLUMN clinic_payment_id INTEGER;   -- brought across: the clinic payment it became
ALTER TABLE ems_payments ADD COLUMN resolved_note TEXT;          -- or: why it was not brought across (already billed in clinic)
ALTER TABLE ems_payments ADD COLUMN resolved_by TEXT;
ALTER TABLE ems_payments ADD COLUMN resolved_at TEXT;

INSERT OR IGNORE INTO cl_items (code, name, category, kind, price, gst_rate, hsn_sac, sellable, notes)
VALUES ('EMS-PKG', 'EMS package', 'EMS & Weight Management', 'service', 0, 18, '999723', 0,
        'Billed only from the EMS app when a package is sold. Price comes from the EMS package.');

INSERT OR IGNORE INTO cl_settings (key, value) VALUES ('ems_price_incl_gst', '1');
INSERT OR IGNORE INTO cl_settings (key, value) VALUES ('ems_calendar_units', '1');      -- EMS units whose bookings show in the clinic calendar
INSERT OR IGNORE INTO cl_settings (key, value) VALUES ('ems_billing_from', '2026-11-12'); -- packages sold from this date are billed in the clinic

DROP VIEW IF EXISTS ems_receipts;
CREATE VIEW ems_receipts AS
  SELECT 'ems' src, e.id, e.client_id, e.client_package_id, e.amount, e.method, e.paid_on, e.reference, IFNULL(e.unit_id, 1) unit_id, NULL invoice_no
    FROM ems_payments e WHERE e.clinic_payment_id IS NULL AND e.resolved_note IS NULL
  UNION ALL
  SELECT 'clinic', a.id, cp.client_id, cp.id,
         -- if the bill also has other items, only the EMS line's share of each payment counts
         ROUND(a.amount * MIN(1.0, IFNULL((SELECT SUM(l.total) FROM cl_invoice_lines l JOIN cl_items it ON it.id = l.item_id AND it.code = 'EMS-PKG' WHERE l.invoice_id = i.id), i.total) / NULLIF(i.total, 0)), 2),
         CASE p.mode WHEN 'upi' THEN 'UPI' WHEN 'cash' THEN 'Cash' WHEN 'card' THEN 'Card' WHEN 'bank' THEN 'Bank transfer' ELSE p.mode END,
         p.paid_on, p.reference, IFNULL(cp.unit_id, 1), i.invoice_no
    FROM ems_client_packages cp
    JOIN cl_invoices i ON i.id = cp.invoice_id AND i.status = 'final'
    JOIN cl_allocations a ON a.invoice_id = i.id
    JOIN cl_payments p ON p.id = a.payment_id AND p.voided = 0;
