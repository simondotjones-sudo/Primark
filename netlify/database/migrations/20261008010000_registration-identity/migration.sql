-- Additive only: existing accounts, passwords and learning records stay intact.
ALTER TABLE learners ADD COLUMN first_name text;
ALTER TABLE learners ADD COLUMN surname text;
ALTER TABLE learners ADD COLUMN workday_id text UNIQUE
  CHECK (workday_id IS NULL OR workday_id ~ '^[A-Z0-9][A-Z0-9._-]{0,49}$');
