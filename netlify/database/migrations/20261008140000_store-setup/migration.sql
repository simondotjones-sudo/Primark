ALTER TABLE organisation_stores ADD COLUMN store_code text;
ALTER TABLE organisation_stores ADD COLUMN admin_learner_id text REFERENCES learners(id);
CREATE UNIQUE INDEX organisation_stores_code ON organisation_stores(lower(store_code)) WHERE store_code IS NOT NULL;
