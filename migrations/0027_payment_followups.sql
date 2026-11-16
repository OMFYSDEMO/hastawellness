-- Balance follow-up calls: who called, what was said, and when to call back. While a call-back date is in the
-- future the balance stays off the front-desk alert bar; on that date it comes back.
CREATE TABLE IF NOT EXISTS cl_pay_followups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL, patient_id INTEGER NOT NULL,
  outcome TEXT NOT NULL,            -- promised | will_visit | no_answer | call_later | dispute | other
  note TEXT NOT NULL,
  callback_on TEXT NOT NULL,        -- YYYY-MM-DD
  by_id INTEGER, by_name TEXT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_pay_followups_inv ON cl_pay_followups(invoice_id, id);
