CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, department TEXT,
  employment_type TEXT NOT NULL DEFAULT 'FULL_TIME', location TEXT NOT NULL DEFAULT 'Kazhakkoottam, Thiruvananthapuram',
  experience TEXT, qualifications TEXT, summary TEXT, responsibilities TEXT, requirements TEXT, benefits TEXT,
  salary_text TEXT, salary_min INTEGER, salary_max INTEGER, openings INTEGER DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft', closing_date TEXT, published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER, job_title TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT, qualification TEXT, experience_years TEXT,
  current_location TEXT, notice_period TEXT, message TEXT, cv_key TEXT, cv_name TEXT, ip_hash TEXT,
  status TEXT NOT NULL DEFAULT 'new', notes TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_apps_job ON applications(job_id, created_at);
CREATE INDEX IF NOT EXISTS idx_apps_ip ON applications(ip_hash, created_at);
