-- Preserve existing photos and their original attribution; new uploads use admin identity.
ALTER TABLE shot_photos ALTER COLUMN uploaded_by DROP NOT NULL;
ALTER TABLE shot_photos ADD COLUMN uploaded_by_admin text;
ALTER TABLE shot_photos ADD CONSTRAINT shot_photo_actor CHECK (
  (uploaded_by IS NOT NULL) <> (uploaded_by_admin IS NOT NULL)
);
ALTER TABLE shot_states ALTER COLUMN updated_by DROP NOT NULL;
ALTER TABLE shot_states ADD COLUMN updated_by_admin text;
ALTER TABLE shot_states ADD CONSTRAINT shot_state_actor CHECK (
  (updated_by IS NOT NULL) <> (updated_by_admin IS NOT NULL)
);
