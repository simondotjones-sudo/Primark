-- Historical sign-ins were not recorded; leave them unknown until the next successful sign-in.
ALTER TABLE learners ADD COLUMN last_login_at text;
