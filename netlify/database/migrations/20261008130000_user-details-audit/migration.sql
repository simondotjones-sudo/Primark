ALTER TABLE user_access_audit DROP CONSTRAINT user_access_audit_action_check;
ALTER TABLE user_access_audit ADD CONSTRAINT user_access_audit_action_check
  CHECK (action IN ('access','archive','restore','details','password-reset'));
