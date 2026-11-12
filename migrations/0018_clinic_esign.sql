-- Paperless staff documents: everything staff are asked to sign is signed in the app.
--  * Issuer e-signature: the manager issuing a document signs it too (typed name, time, IP).
--  * Warning letters and payslips are generated as PDFs, kept in R2 and sent to the staff
--    member's documents to acknowledge. Warnings and payslips can be acknowledged "with a dispute".
--  * Fillable forms (joining, bank & ID, confidentiality, uniform/equipment, phone handover, exit):
--    the issuer may fill some fields; the staff member fills the rest and signs. Templates live in
--    src/forms.js; the exact form issued is kept with the document (form_def).
--  * A manager can record that a staff member refused to sign.

ALTER TABLE cl_docs ADD COLUMN source TEXT;                 -- warning | payroll (generated documents)
ALTER TABLE cl_docs ADD COLUMN source_id INTEGER;
ALTER TABLE cl_docs ADD COLUMN form_key TEXT;
ALTER TABLE cl_docs ADD COLUMN form_def TEXT;               -- JSON snapshot of the form as issued
ALTER TABLE cl_docs ADD COLUMN form_prefill TEXT;           -- JSON values filled in by the issuer
ALTER TABLE cl_docs ADD COLUMN issuer_sig_name TEXT;        -- issuer e-signature (typed name)
ALTER TABLE cl_docs ADD COLUMN issuer_sig_title TEXT;
ALTER TABLE cl_docs ADD COLUMN issuer_sig_at TEXT;
ALTER TABLE cl_docs ADD COLUMN issuer_sig_ip TEXT;

ALTER TABLE cl_doc_recipients ADD COLUMN response TEXT;     -- accepted | disputed
ALTER TABLE cl_doc_recipients ADD COLUMN form_data TEXT;    -- JSON answers to a form
ALTER TABLE cl_doc_recipients ADD COLUMN form_sha256 TEXT;  -- fingerprint of the answers signed
ALTER TABLE cl_doc_recipients ADD COLUMN refused_at TEXT;   -- recorded by a manager
ALTER TABLE cl_doc_recipients ADD COLUMN refused_note TEXT;
ALTER TABLE cl_doc_recipients ADD COLUMN refused_by_name TEXT;

ALTER TABLE cl_staff_pay ADD COLUMN designation TEXT;       -- job title, shown with e-signatures
ALTER TABLE cl_warnings ADD COLUMN doc_id INTEGER;          -- the warning as a signed document
CREATE INDEX IF NOT EXISTS idx_cl_docs_source ON cl_docs(source, source_id);
