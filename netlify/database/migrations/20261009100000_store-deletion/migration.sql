-- Keep a tombstone for imported stores so baseline data cannot resurrect them.
ALTER TABLE organisation_stores ADD COLUMN deleted_at text;
ALTER TABLE organisation_stores ADD COLUMN deleted_by text;
ALTER TABLE organisation_stores ADD CONSTRAINT deleted_store_inactive CHECK(deleted_at IS NULL OR NOT active);
DROP INDEX organisation_stores_code;
CREATE UNIQUE INDEX organisation_stores_code ON organisation_stores(lower(store_code)) WHERE store_code IS NOT NULL AND deleted_at IS NULL;
DROP INDEX organisation_stores_name_country;
CREATE UNIQUE INDEX organisation_stores_name_country ON organisation_stores(lower(country),lower(name),COALESCE(store_code,'')) WHERE deleted_at IS NULL;

CREATE FUNCTION store_can_delete(sid text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM organisation_stores s WHERE s.id=sid AND NOT s.active AND s.deleted_at IS NULL AND s.admin_learner_id IS NULL)
 AND NOT EXISTS(SELECT 1 FROM learners l WHERE l.store_id=sid)
 AND NOT EXISTS(SELECT 1 FROM reporting_access r WHERE r.site_id=sid)
 AND NOT EXISTS(SELECT 1 FROM store_managers m WHERE m.store_id=sid)
 AND NOT EXISTS(SELECT 1 FROM legacy_completions h WHERE h.store_id=sid)
 AND NOT EXISTS(SELECT 1 FROM certificates h WHERE h.store_id=sid)
 AND NOT EXISTS(SELECT 1 FROM assignment_history h WHERE h.store_id=sid)
 AND NOT EXISTS(SELECT 1 FROM credit_ledger h WHERE h.store_id=sid AND h.kind NOT IN ('opening','period_topup'))
 AND NOT EXISTS(SELECT 1 FROM courses c WHERE jsonb_exists(c.audience_json::jsonb->'sites',sid));
$$;

-- New references and deletion serialize on the same store row. A request that
-- loaded the directory before deletion cannot attach records afterwards.
CREATE FUNCTION assert_store_not_deleted(sid text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE removed text;
BEGIN
 SELECT deleted_at INTO removed FROM organisation_stores WHERE id=sid FOR SHARE;
 IF removed IS NOT NULL THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='This store has been deleted.',CONSTRAINT='store_not_deleted';
 END IF;
END $$;
CREATE FUNCTION guard_deleted_store_reference() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM assert_store_not_deleted(to_jsonb(NEW)->>TG_ARGV[0]);
 RETURN NEW;
END $$;
CREATE TRIGGER learners_store_not_deleted BEFORE INSERT OR UPDATE OF store_id ON learners FOR EACH ROW EXECUTE FUNCTION guard_deleted_store_reference('store_id');
CREATE TRIGGER reporting_store_not_deleted BEFORE INSERT OR UPDATE OF site_id ON reporting_access FOR EACH ROW EXECUTE FUNCTION guard_deleted_store_reference('site_id');
CREATE TRIGGER managers_store_not_deleted BEFORE INSERT OR UPDATE OF store_id ON store_managers FOR EACH ROW EXECUTE FUNCTION guard_deleted_store_reference('store_id');
CREATE TRIGGER legacy_store_not_deleted BEFORE INSERT OR UPDATE OF store_id ON legacy_completions FOR EACH ROW EXECUTE FUNCTION guard_deleted_store_reference('store_id');
CREATE TRIGGER certificates_store_not_deleted BEFORE INSERT OR UPDATE OF store_id ON certificates FOR EACH ROW EXECUTE FUNCTION guard_deleted_store_reference('store_id');
CREATE TRIGGER history_store_not_deleted BEFORE INSERT OR UPDATE OF store_id ON assignment_history FOR EACH ROW EXECUTE FUNCTION guard_deleted_store_reference('store_id');
CREATE TRIGGER ledger_store_not_deleted BEFORE INSERT OR UPDATE OF store_id ON credit_ledger FOR EACH ROW EXECUTE FUNCTION guard_deleted_store_reference('store_id');
CREATE FUNCTION guard_deleted_store_audience() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sid text;
BEGIN
 FOR sid IN SELECT value FROM jsonb_array_elements_text(COALESCE(NEW.audience_json::jsonb->'sites','[]'::jsonb)) ORDER BY value LOOP
  PERFORM assert_store_not_deleted(sid);
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER audience_store_not_deleted BEFORE INSERT OR UPDATE OF audience_json ON courses FOR EACH ROW EXECUTE FUNCTION guard_deleted_store_audience();
