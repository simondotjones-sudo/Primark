CREATE TABLE organisation_stores (
  id text PRIMARY KEY,
  name text NOT NULL,
  country text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  updated_by text NOT NULL,
  updated_at text NOT NULL
);
CREATE TABLE organisation_store_audit (
  id text PRIMARY KEY,
  store_id text NOT NULL,
  actor text NOT NULL,
  action text NOT NULL,
  recorded_at text NOT NULL
);
CREATE UNIQUE INDEX organisation_stores_name_country ON organisation_stores(lower(country),lower(name));
