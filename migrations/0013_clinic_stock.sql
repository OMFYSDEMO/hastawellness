-- Clinic app phase 3a: suppliers, purchase orders, goods received (GRN), batches and stock.
-- Stock on hand for an item = SUM(cl_stock_moves.qty). Batches carry batch no. / expiry and what is left of each.

ALTER TABLE cl_items ADD COLUMN track_stock INTEGER NOT NULL DEFAULT 0;   -- 1 = keep stock for this item
ALTER TABLE cl_items ADD COLUMN track_batch INTEGER NOT NULL DEFAULT 0;   -- 1 = batch no. and expiry asked on receipt
ALTER TABLE cl_items ADD COLUMN reorder_level REAL;                       -- alert when stock falls to this
ALTER TABLE cl_items ADD COLUMN reorder_qty REAL;                         -- suggested order quantity
ALTER TABLE cl_items ADD COLUMN supplier_id INTEGER;                      -- usual supplier
ALTER TABLE cl_items ADD COLUMN avg_cost REAL;                            -- moving average cost (stock value)

CREATE TABLE IF NOT EXISTS cl_suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT, name TEXT NOT NULL, contact TEXT, phone TEXT, email TEXT, gstin TEXT,
  address TEXT, city TEXT, state TEXT, terms_days INTEGER NOT NULL DEFAULT 0, notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS cl_pos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_no TEXT UNIQUE, supplier_id INTEGER NOT NULL,
  order_date TEXT NOT NULL, expected_date TEXT,
  status TEXT NOT NULL DEFAULT 'draft',          -- draft | approved | part_received | received | closed | cancelled
  subtotal REAL NOT NULL DEFAULT 0, tax REAL NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0,
  notes TEXT, created_by INTEGER, approved_by INTEGER, approved_at TEXT,
  legacy INTEGER NOT NULL DEFAULT 0,             -- 1 = carried over from the previous system (no item lines)
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS cl_po_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id INTEGER NOT NULL, item_id INTEGER NOT NULL, name TEXT NOT NULL,
  qty REAL NOT NULL, unit_cost REAL NOT NULL, gst_rate REAL NOT NULL DEFAULT 0,
  tax REAL NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0,
  qty_received REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cl_po_lines ON cl_po_lines(po_id);

CREATE TABLE IF NOT EXISTS cl_grns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grn_no TEXT UNIQUE, po_id INTEGER, supplier_id INTEGER NOT NULL,
  received_date TEXT NOT NULL, supplier_invoice_no TEXT, supplier_invoice_date TEXT,
  taxable REAL NOT NULL DEFAULT 0, cgst REAL NOT NULL DEFAULT 0, sgst REAL NOT NULL DEFAULT 0, igst REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  notes TEXT, received_by INTEGER,
  legacy INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_cl_grns_date ON cl_grns(received_date);
CREATE TABLE IF NOT EXISTS cl_grn_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grn_id INTEGER NOT NULL, po_line_id INTEGER, item_id INTEGER NOT NULL, name TEXT NOT NULL,
  qty REAL NOT NULL, free_qty REAL NOT NULL DEFAULT 0,
  unit_cost REAL NOT NULL, gst_rate REAL NOT NULL DEFAULT 0, tax REAL NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0,
  batch_no TEXT, expiry TEXT, batch_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_cl_grn_lines ON cl_grn_lines(grn_id);

CREATE TABLE IF NOT EXISTS cl_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL, batch_no TEXT, expiry TEXT,
  unit_cost REAL, qty_left REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_cl_batches_item ON cl_batches(item_id, expiry);

CREATE TABLE IF NOT EXISTS cl_stock_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL, batch_id INTEGER,
  qty REAL NOT NULL,                              -- + in, − out
  unit_cost REAL,
  kind TEXT NOT NULL,                             -- opening | grn | sale | sale_cancel | use | adjust
  ref_type TEXT, ref_id INTEGER, reason TEXT,
  staff_id INTEGER, staff_name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_cl_moves_item ON cl_stock_moves(item_id);
CREATE INDEX IF NOT EXISTS idx_cl_moves_ref ON cl_stock_moves(ref_type, ref_id);

CREATE TABLE IF NOT EXISTS cl_supplier_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL, grn_id INTEGER, po_id INTEGER,
  amount REAL NOT NULL, paid_on TEXT NOT NULL, mode TEXT NOT NULL, reference TEXT, notes TEXT,
  staff_id INTEGER, voided INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_cl_sp_supplier ON cl_supplier_payments(supplier_id);
