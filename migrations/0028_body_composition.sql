-- EMS body composition: more tape measurements, body-composition analyser (BIA) readings, and nutrition targets.
ALTER TABLE ems_measurements ADD COLUMN neck REAL;
ALTER TABLE ems_measurements ADD COLUMN chest REAL;
ALTER TABLE ems_measurements ADD COLUMN arm REAL;
ALTER TABLE ems_measurements ADD COLUMN belly REAL;          -- at the navel
ALTER TABLE ems_measurements ADD COLUMN lower_belly REAL;    -- between waist and hips, ~5 cm below the navel
ALTER TABLE ems_measurements ADD COLUMN thigh REAL;
ALTER TABLE ems_measurements ADD COLUMN water_pct REAL;
ALTER TABLE ems_measurements ADD COLUMN protein_pct REAL;
ALTER TABLE ems_measurements ADD COLUMN bone_mass REAL;
ALTER TABLE ems_measurements ADD COLUMN visceral_fat REAL;
ALTER TABLE ems_measurements ADD COLUMN bmr REAL;
ALTER TABLE ems_measurements ADD COLUMN metabolic_age REAL;
ALTER TABLE ems_measurements ADD COLUMN device TEXT;         -- analyser used, so readings are compared like with like
ALTER TABLE ems_plans ADD COLUMN aim TEXT;                   -- lose | tone | maintain | gain
ALTER TABLE ems_plans ADD COLUMN activity TEXT;              -- sedentary | light | moderate | active
ALTER TABLE ems_plans ADD COLUMN food_pref TEXT;             -- nonveg | fish | egg | veg | vegan
ALTER TABLE ems_plans ADD COLUMN kcal_target INTEGER;
ALTER TABLE ems_plans ADD COLUMN protein_g INTEGER;
ALTER TABLE ems_plans ADD COLUMN carbs_g INTEGER;
ALTER TABLE ems_plans ADD COLUMN fat_g INTEGER;
ALTER TABLE ems_plans ADD COLUMN fibre_g INTEGER;
