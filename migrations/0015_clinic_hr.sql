-- Staff attendance (QR clock-in on the clinic desktop, geofenced), leave, unauthorised absences
-- with warning letters, and monthly pay worked out from contract hours.

-- Pay profile per staff member. Only admins / managers can see or change it.
CREATE TABLE IF NOT EXISTS cl_staff_pay (
  staff_id INTEGER PRIMARY KEY,
  monthly_salary REAL NOT NULL DEFAULT 0,
  daily_hours REAL NOT NULL DEFAULT 8,          -- contract hours per working day
  weekly_off INTEGER NOT NULL DEFAULT 0,        -- 0 = Sunday … 6 = Saturday
  shift_start TEXT NOT NULL DEFAULT '09:30',    -- for late arrival
  joined_on TEXT,                               -- no attendance expected before this
  leave_opening REAL NOT NULL DEFAULT 0,        -- annual leave balance carried in
  leave_from TEXT,                              -- month (YYYY-MM-01) the monthly accrual starts
  attendance_required INTEGER NOT NULL DEFAULT 1,
  left_on TEXT,
  updated_at TEXT
);

-- One row per clock-in → clock-out. Several per day are allowed (e.g. split shift).
CREATE TABLE IF NOT EXISTS cl_attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  in_at TEXT NOT NULL,                          -- local (IST) YYYY-MM-DDTHH:MM:SS
  out_at TEXT,
  in_geo TEXT, out_geo TEXT,                    -- JSON {acc,dist}: distance from the clinic only
  source TEXT NOT NULL DEFAULT 'qr',            -- qr | manual
  note TEXT,
  edited_by INTEGER, edited_by_name TEXT, edited_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_cl_att_staff_day ON cl_attendance(staff_id, day);
CREATE INDEX IF NOT EXISTS idx_cl_att_day ON cl_attendance(day);

CREATE TABLE IF NOT EXISTS cl_leave (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL,
  from_date TEXT NOT NULL, to_date TEXT NOT NULL,
  days REAL NOT NULL,                           -- working days covered
  kind TEXT NOT NULL DEFAULT 'annual',          -- annual (paid) | sick | casual | unpaid
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',       -- pending | approved | rejected | cancelled
  applied_by INTEGER, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  decided_by INTEGER, decided_by_name TEXT, decided_at TEXT, decision_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_cl_leave_staff ON cl_leave(staff_id, from_date);

CREATE TABLE IF NOT EXISTS cl_holidays (day TEXT PRIMARY KEY, name TEXT NOT NULL);

-- A working day with no attendance and no approved leave is an unauthorised absence.
-- Managers confirm it (warning letter issued) — or add the attendance if the person was at work.
CREATE TABLE IF NOT EXISTS cl_absences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  letter_id INTEGER,
  confirmed_by INTEGER, confirmed_by_name TEXT, confirmed_at TEXT, note TEXT,
  UNIQUE (staff_id, day)
);
CREATE TABLE IF NOT EXISTS cl_warnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  letter_no TEXT NOT NULL UNIQUE,
  staff_id INTEGER NOT NULL,
  days TEXT NOT NULL,                           -- JSON array of dates
  body TEXT,
  issued_by INTEGER, issued_by_name TEXT, issued_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_cl_warn_staff ON cl_warnings(staff_id);

-- Finalised monthly pay (a snapshot; the live calculation can change until finalised).
CREATE TABLE IF NOT EXISTS cl_payroll (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month TEXT NOT NULL,                          -- YYYY-MM
  staff_id INTEGER NOT NULL,
  data TEXT NOT NULL,
  net REAL NOT NULL,
  finalised_by INTEGER, finalised_by_name TEXT,
  finalised_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (month, staff_id)
);

-- Clinic desktop(s) allowed to show the attendance QR.
CREATE TABLE IF NOT EXISTS cl_kiosks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_by INTEGER, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  last_seen TEXT, active INTEGER NOT NULL DEFAULT 1
);

-- A staff member's phone, remembered after their first signed-in scan, so daily scans don't need a sign-in.
CREATE TABLE IF NOT EXISTS cl_att_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  agent TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  last_used TEXT, active INTEGER NOT NULL DEFAULT 1
);
