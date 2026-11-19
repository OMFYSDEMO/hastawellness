-- EMS package discounts follow the clinic rule: reason recorded, and who authorised a discount above the limit.
ALTER TABLE ems_client_packages ADD COLUMN discount_reason TEXT;
ALTER TABLE ems_client_packages ADD COLUMN discount_by_name TEXT;
