-- Historic accounts may not yet have an email. Never generate replacement access codes.
ALTER TABLE learners ALTER COLUMN email DROP NOT NULL;
ALTER TABLE learners ADD COLUMN legacy_access_code TEXT;
CREATE UNIQUE INDEX learners_legacy_access_code_unique ON learners (upper(btrim(legacy_access_code))) WHERE NULLIF(btrim(legacy_access_code),'') IS NOT NULL;
CREATE UNIQUE INDEX learners_email_normalized_unique ON learners (lower(btrim(email))) WHERE NULLIF(btrim(email),'') IS NOT NULL;
-- A password-verified email-completion session cannot access any learning/admin API.
ALTER TABLE sessions ADD COLUMN email_pending BOOLEAN NOT NULL DEFAULT false;
