CREATE TABLE reporting_access (
  learner_id text PRIMARY KEY REFERENCES learners(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('organisation', 'country', 'site')),
  country text,
  site_id text,
  assigned_by text NOT NULL,
  updated_at text NOT NULL,
  CHECK (
    (scope = 'organisation' AND country IS NULL AND site_id IS NULL) OR
    (scope = 'country' AND country IS NOT NULL AND site_id IS NULL) OR
    (scope = 'site' AND country IS NOT NULL AND site_id IS NOT NULL)
  )
);
