ALTER TABLE learners ADD COLUMN archived_at text;
CREATE TABLE user_access_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  learner_id text NOT NULL REFERENCES learners(id),
  actor_email text NOT NULL,
  action text NOT NULL CHECK (action IN ('access','archive','restore')),
  previous_state jsonb NOT NULL,
  next_state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_access_audit_learner ON user_access_audit(learner_id,created_at DESC);
