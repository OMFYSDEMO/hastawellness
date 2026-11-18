-- Doctor profiles on the website: shown only when switched on AND name, qualification and registration number are filled.
ALTER TABLE ems_staff ADD COLUMN reg_council TEXT;          -- e.g. Kerala Dental Council, TCMC, Kerala State Medical Councils (ISM)
ALTER TABLE ems_staff ADD COLUMN web_show INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ems_staff ADD COLUMN web_title TEXT;            -- e.g. Periodontist · Dental
ALTER TABLE ems_staff ADD COLUMN web_bio TEXT;
ALTER TABLE ems_staff ADD COLUMN web_order INTEGER NOT NULL DEFAULT 0;
