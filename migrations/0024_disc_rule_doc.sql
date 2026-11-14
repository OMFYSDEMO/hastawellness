-- Discipline: link a case to the signed policy / memo it relies on (so letters can cite the employee's acknowledgement).
ALTER TABLE cl_disc_cases ADD COLUMN rule_doc_id INTEGER;
