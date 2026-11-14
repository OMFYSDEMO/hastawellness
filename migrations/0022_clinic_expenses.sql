-- Clinic expenses: every outgoing that is not a supplier bill (rent, utilities, petty cash, consultant fees …).
-- Cash expenses come out of the cash book; bank / UPI / card ones are recorded for the books.
CREATE TABLE IF NOT EXISTS cl_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  spent_on TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  payee TEXT,
  amount REAL NOT NULL,              -- total paid, incl. any GST
  gst_amount REAL,                   -- input GST on the bill, if any (for the accountant)
  mode TEXT NOT NULL,                -- cash | upi | card | bank
  reference TEXT,
  bill_no TEXT,
  receipt TEXT,                      -- JSON {key, name, type} in R2
  staff_id INTEGER, staff_name TEXT,
  voided INTEGER NOT NULL DEFAULT 0, void_reason TEXT, voided_by TEXT, voided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_cl_exp_date ON cl_expenses(spent_on);
