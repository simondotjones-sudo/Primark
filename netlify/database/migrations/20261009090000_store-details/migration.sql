-- Store contact override is separate from login credentials and access grants.
-- NULL preserves the linked manager email; an empty value explicitly clears it.
ALTER TABLE organisation_stores ADD COLUMN admin_email text;
