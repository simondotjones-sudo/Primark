CREATE TABLE password_resets (
  token_hash text PRIMARY KEY,
  account_type text NOT NULL CHECK (account_type IN ('learner','admin')),
  account_id text NOT NULL,
  credential_hash text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX password_resets_expiry ON password_resets(expires_at);

-- A changed hosting credential invalidates this override and restores bootstrap access.
-- These are separate from learner identities, even when both use the same email.
CREATE TABLE admin_passwords (
  email text PRIMARY KEY,
  bootstrap_hash text NOT NULL,
  password_hash text NOT NULL
);
