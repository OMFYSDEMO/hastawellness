CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  source TEXT NOT NULL,
  request_type TEXT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  interest TEXT,
  concern TEXT,
  timing TEXT,
  preferred_date TEXT,
  page TEXT,
  ip_hash TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  notes TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_leads_ip ON leads(ip_hash, created_at);
