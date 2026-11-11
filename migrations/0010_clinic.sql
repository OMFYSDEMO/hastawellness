-- Hasta Clinic App (clinicapp.hastawellnessclinic.com) — phase 1:
-- patients, appointments, catalogue, GST billing, payments, packages.
-- Shares staff accounts (ems_staff), sessions and website leads with the EMS platform.

ALTER TABLE ems_staff ADD COLUMN apps TEXT NOT NULL DEFAULT '["ems"]';   -- which apps the account may use: ems, clinic

CREATE TABLE IF NOT EXISTS cl_settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS cl_departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  colour TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

-- Which departments each clinician may work in (doctor capability matrix).
CREATE TABLE IF NOT EXISTS cl_staff_depts (
  staff_id INTEGER NOT NULL, dept_id INTEGER NOT NULL,
  PRIMARY KEY (staff_id, dept_id)
);

CREATE TABLE IF NOT EXISTS cl_rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, dept_id INTEGER, active INTEGER NOT NULL DEFAULT 1
);

-- Catalogue: services, products and pass-through items. Prices exclude GST.
CREATE TABLE IF NOT EXISTS cl_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  dept_id INTEGER,
  category TEXT,
  kind TEXT NOT NULL DEFAULT 'service',        -- service | product | passthrough
  price REAL NOT NULL DEFAULT 0,               -- GST-exclusive
  gst_rate REAL NOT NULL DEFAULT 18,           -- 0, 5, 12, 18 (dental services 0 = exempt)
  hsn_sac TEXT,
  chair_minutes INTEGER,
  cost REAL,                                   -- standard cost (phase 3 costing sheet refines this)
  partner TEXT,                                -- pass-through: whose money it is (e.g. imaging partner)
  notes TEXT,                                  -- internal notes / review flags / previous name
  sellable INTEGER NOT NULL DEFAULT 1,         -- 0 = internal use / equipment: never billed
  unit TEXT, mrp REAL,
  meta TEXT,                                   -- JSON from the item master: accounts, supplier, stock settings (used by later phases)
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cl_items_dept ON cl_items(dept_id, active);

CREATE TABLE IF NOT EXISTS cl_patients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_no TEXT UNIQUE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,                          -- last 10 digits
  alt_phone TEXT, email TEXT, gender TEXT, dob TEXT, address TEXT,
  medical_alert TEXT,                           -- allergies / conditions staff must see
  source TEXT, lead_id INTEGER, ems_client_id INTEGER,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active',        -- active | deleted
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_cl_patients_phone ON cl_patients(phone);

CREATE TABLE IF NOT EXISTS cl_appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  dept_id INTEGER,
  doctor_id INTEGER, assistant_id INTEGER, room_id INTEGER,
  start_at TEXT NOT NULL,                       -- local IST 'YYYY-MM-DDTHH:MM'
  minutes INTEGER NOT NULL DEFAULT 30,
  status TEXT NOT NULL DEFAULT 'booked',        -- booked | arrived | in_treatment | completed | no_show | cancelled
  reason TEXT, notes TEXT,
  planned_items TEXT,                           -- JSON [{item_id, qty}]
  closure TEXT,                                 -- billed | package | no_charge (required once completed)
  closure_note TEXT, invoice_id INTEGER,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cl_appt_day ON cl_appointments(start_at);
CREATE INDEX IF NOT EXISTS idx_cl_appt_patient ON cl_appointments(patient_id);

-- Packages: bundles of catalogue items. Price = list value − package discount.
CREATE TABLE IF NOT EXISTS cl_package_defs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, dept_id INTEGER,
  items TEXT NOT NULL,                          -- JSON [{item_id, qty}]
  discount_pct REAL NOT NULL DEFAULT 0,
  validity_days INTEGER NOT NULL DEFAULT 365,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS cl_patient_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL, def_id INTEGER NOT NULL,
  name TEXT NOT NULL, items TEXT NOT NULL,      -- snapshot at sale: [{item_id, name, qty}]
  invoice_id INTEGER, line_id INTEGER,
  start_date TEXT NOT NULL, expiry_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',        -- active | closed | cancelled
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS cl_redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_package_id INTEGER NOT NULL, item_id INTEGER NOT NULL, qty INTEGER NOT NULL DEFAULT 1,
  appointment_id INTEGER, redeemed_on TEXT NOT NULL, staff_id INTEGER, voided INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS cl_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT UNIQUE,                       -- set when finalised
  patient_id INTEGER NOT NULL,
  appointment_id INTEGER,
  invoice_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',         -- draft | final | cancelled
  gross REAL NOT NULL DEFAULT 0,                -- before discounts, excl GST, excl pass-through
  discount REAL NOT NULL DEFAULT 0,
  taxable REAL NOT NULL DEFAULT 0,              -- value of taxable supplies after discount
  exempt REAL NOT NULL DEFAULT 0,               -- value of exempt / nil-rated supplies after discount
  cgst REAL NOT NULL DEFAULT 0, sgst REAL NOT NULL DEFAULT 0,
  passthrough REAL NOT NULL DEFAULT 0,          -- collected for partners, not clinic revenue
  total REAL NOT NULL DEFAULT 0,                -- amount payable by the patient
  notes TEXT,
  created_by INTEGER, finalised_by INTEGER, finalised_at TEXT,
  cancelled_by INTEGER, cancelled_at TEXT, cancel_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_cl_inv_patient ON cl_invoices(patient_id);
CREATE INDEX IF NOT EXISTS idx_cl_inv_date ON cl_invoices(invoice_date);

CREATE TABLE IF NOT EXISTS cl_invoice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  item_id INTEGER, package_def_id INTEGER,
  kind TEXT NOT NULL,                           -- service | product | passthrough | package
  name TEXT NOT NULL, hsn_sac TEXT,
  qty REAL NOT NULL DEFAULT 1, unit_price REAL NOT NULL,
  discount REAL NOT NULL DEFAULT 0, discount_reason TEXT, discount_by INTEGER, discount_by_name TEXT,
  gst_rate REAL NOT NULL DEFAULT 0,             -- for packages: blended, see tax_parts
  taxable REAL NOT NULL DEFAULT 0, exempt REAL NOT NULL DEFAULT 0,
  cgst REAL NOT NULL DEFAULT 0, sgst REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  tax_parts TEXT,                               -- packages: JSON [{rate, value}] split by contents
  doctor_id INTEGER, partner TEXT
);
CREATE INDEX IF NOT EXISTS idx_cl_lines_inv ON cl_invoice_lines(invoice_id);

CREATE TABLE IF NOT EXISTS cl_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  paid_on TEXT NOT NULL,
  amount REAL NOT NULL,
  mode TEXT NOT NULL,                           -- cash | upi | card | bank | finance
  reference TEXT, lender TEXT,
  received_by INTEGER, notes TEXT,
  voided INTEGER NOT NULL DEFAULT 0, voided_by INTEGER, void_reason TEXT,
  deposit_id INTEGER,                           -- cash: which bank deposit it went into
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_cl_pay_patient ON cl_payments(patient_id);
CREATE INDEX IF NOT EXISTS idx_cl_pay_day ON cl_payments(paid_on);

CREATE TABLE IF NOT EXISTS cl_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER NOT NULL, invoice_id INTEGER NOT NULL, amount REAL NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_cl_alloc_inv ON cl_allocations(invoice_id);
CREATE INDEX IF NOT EXISTS idx_cl_alloc_pay ON cl_allocations(payment_id);

CREATE TABLE IF NOT EXISTS cl_cash_deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deposited_on TEXT NOT NULL, amount REAL NOT NULL,
  bank TEXT, reference TEXT NOT NULL,
  staff_id INTEGER, staff_name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS cl_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER, staff_name TEXT, action TEXT NOT NULL, entity TEXT, entity_id INTEGER, detail TEXT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
