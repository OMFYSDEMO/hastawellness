-- Staff document repository: personal records, and memos / notices / policies / training records
-- issued to staff, each read and acknowledged (typed-name e-signature) by every recipient.
-- Files live in R2 (binding CVS) under staff-docs/. Issued documents are never edited — only withdrawn.
CREATE TABLE IF NOT EXISTS cl_docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref_no TEXT NOT NULL UNIQUE,                  -- e.g. MEMO/2026/0001
  kind TEXT NOT NULL,                           -- memo | notice | policy | training | record
  title TEXT NOT NULL,
  body TEXT,
  file_key TEXT, file_name TEXT, file_type TEXT, file_size INTEGER,
  sha256 TEXT NOT NULL,                         -- fingerprint of title + body + file, recorded with every signature
  requires_ack INTEGER NOT NULL DEFAULT 1,
  due_date TEXT,
  training_date TEXT, trainer TEXT, training_hours REAL,
  staff_id INTEGER,                             -- personal record: whose file it belongs to
  record_type TEXT,                             -- personal record: contract, id_proof, certificate, ...
  status TEXT NOT NULL DEFAULT 'issued',        -- issued | withdrawn
  issued_by INTEGER, issued_by_name TEXT,
  issued_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  withdrawn_by_name TEXT, withdrawn_at TEXT, withdraw_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_cl_docs_staff ON cl_docs(staff_id);
CREATE INDEX IF NOT EXISTS idx_cl_docs_kind ON cl_docs(kind, issued_at);

CREATE TABLE IF NOT EXISTS cl_doc_recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id INTEGER NOT NULL,
  staff_id INTEGER NOT NULL,
  viewed_at TEXT,
  ack_at TEXT,
  ack_name TEXT,                                -- full name typed by the staff member
  ack_comment TEXT,
  ack_ip TEXT, ack_agent TEXT,
  ack_sha256 TEXT,                              -- document fingerprint at the moment of signing
  UNIQUE (doc_id, staff_id)
);
CREATE INDEX IF NOT EXISTS idx_cl_docrec_staff ON cl_doc_recipients(staff_id);
