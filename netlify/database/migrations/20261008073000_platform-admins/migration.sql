-- Explicit grants for registered accounts. The hosting-configured admin is unchanged.
CREATE TABLE platform_admins (
  learner_id text PRIMARY KEY REFERENCES learners(id) ON DELETE CASCADE,
  assigned_by text NOT NULL,
  updated_at text NOT NULL
);
