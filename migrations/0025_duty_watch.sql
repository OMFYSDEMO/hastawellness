-- Duty Watch: lapses found at day close, with points, notices and escalation (src/duty.js).
CREATE TABLE IF NOT EXISTS cl_duty_lapses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,                             -- the working day the lapse belongs to
  staff_id INTEGER NOT NULL,                     -- 0 = nobody identifiable on duty (a manager assigns it)
  code TEXT NOT NULL,                            -- no_arrival | late_mark | not_completed | not_billed | still_unbilled | unpaid | ems_unmarked | mgr_no_action | leave_pending | late | absent | no_clock_out | doc_overdue
  ref_type TEXT NOT NULL, ref_id INTEGER NOT NULL DEFAULT 0,
  detail TEXT, points INTEGER NOT NULL DEFAULT 1,
  how TEXT,                                      -- why this person was held responsible (signed on / at work …)
  status TEXT NOT NULL DEFAULT 'open',           -- open | excused
  excused_by INTEGER, excused_by_name TEXT, excused_reason TEXT, excused_at TEXT,
  notice_doc_id INTEGER,                         -- the duty lapse notice (cl_docs, kind duty)
  case_id INTEGER,                               -- disciplinary case it was escalated to
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (day, staff_id, code, ref_type, ref_id)
);
CREATE INDEX IF NOT EXISTS idx_duty_lapses_staff ON cl_duty_lapses(staff_id, day);
CREATE INDEX IF NOT EXISTS idx_duty_lapses_day ON cl_duty_lapses(day);
-- Who took the front desk / duty manager role on a day.
CREATE TABLE IF NOT EXISTS cl_duty_signons (
  day TEXT NOT NULL, role TEXT NOT NULL, staff_id INTEGER NOT NULL, on_at TEXT NOT NULL,
  PRIMARY KEY (day, role, staff_id)
);
