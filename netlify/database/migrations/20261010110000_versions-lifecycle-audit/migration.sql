-- Published versions and assignment snapshots are independent of edit revisions.
ALTER TABLE courses ADD COLUMN learning_version integer NOT NULL DEFAULT 1;
CREATE TABLE course_versions (
 course_id text NOT NULL REFERENCES courses(id), version integer NOT NULL,
 snapshot jsonb NOT NULL, published_at timestamptz NOT NULL DEFAULT now(),
 published_by text NOT NULL, reason text NOT NULL, retraining boolean NOT NULL DEFAULT false,
 PRIMARY KEY(course_id,version)
);
INSERT INTO course_versions(course_id,version,snapshot,published_by,reason)
 SELECT id,1,to_jsonb(c),'migration','Baseline captured at versioning rollout; earlier edits cannot be reconstructed.' FROM courses c WHERE status='published' OR EXISTS(SELECT 1 FROM assignment_history h WHERE h.course_id=c.id AND h.package_id IS NOT NULL);
ALTER TABLE assignment_history ADD COLUMN course_snapshot jsonb;
ALTER TABLE assignment_history ADD COLUMN learning_version integer;
-- Preserve known package/title/requirements for historic assignments; do not invent an earlier version.
UPDATE assignment_history h SET course_snapshot=to_jsonb(c)||jsonb_build_object('package_id',h.package_id,'title',h.course_title,'quiz_json',h.quiz_json,'assessor_required',h.assessor_required),
 learning_version=CASE WHEN h.package_id=c.package_id THEN 1 END FROM courses c WHERE c.id=h.course_id;
CREATE OR REPLACE FUNCTION snapshot_assignment_requirements() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c courses%ROWTYPE;
BEGIN
 SELECT * INTO c FROM courses WHERE id=NEW.course_id;
 NEW.course_snapshot:=to_jsonb(c); NEW.learning_version:=c.learning_version;
 NEW.quiz_json:=c.quiz_json; NEW.assessor_required:=c.assessor_required;
 IF c.deadline_days IS NOT NULL THEN NEW.due_at:=NEW.assigned_at+c.deadline_days*interval '24 hours'; END IF;
 RETURN NEW;
END $$;
ALTER TABLE certificates ADD COLUMN learning_version integer;
CREATE FUNCTION snapshot_certificate_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h assignment_history%ROWTYPE;
BEGIN
 SELECT * INTO h FROM assignment_history WHERE id=NEW.assignment_id;
 IF h.id IS NOT NULL THEN
  NEW.learning_version:=h.learning_version;
  NEW.course_revision:=COALESCE((h.course_snapshot->>'revision')::integer,NEW.course_revision);
  NEW.course_title:=h.course_title;
  NEW.language_code:=COALESCE(h.course_snapshot->>'language_code',NEW.language_code);
  NEW.validity_months:=(h.course_snapshot->>'validity_months')::integer;
  NEW.expires_at:=CASE WHEN NEW.validity_months IS NOT NULL THEN to_char((NEW.completed_at::timestamptz AT TIME ZONE 'UTC')+make_interval(months=>NEW.validity_months),'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER certificate_version BEFORE INSERT ON certificates FOR EACH ROW EXECUTE FUNCTION snapshot_certificate_version();
UPDATE certificates cert SET learning_version=h.learning_version FROM assignment_history h WHERE cert.assignment_id=h.id;

ALTER TABLE learners ADD COLUMN employment_started_on date;
ALTER TABLE learners ADD COLUMN employment_ended_on date;
ALTER TABLE learners ADD COLUMN lifecycle_reason text;
ALTER TABLE user_access_audit DROP CONSTRAINT user_access_audit_action_check;
ALTER TABLE user_access_audit ADD CONSTRAINT user_access_audit_action_check CHECK(action IN ('access','archive','restore','details','password-reset','transfer','rejoin','leave'));

CREATE TABLE audit_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), actor text NOT NULL,
 entity text NOT NULL, entity_id text NOT NULL, action text NOT NULL,
 learner_id text, store_id text, country text,
 previous_state jsonb, next_state jsonb, reason text
);
CREATE INDEX audit_events_date ON audit_events(recorded_at DESC,id DESC);
CREATE INDEX audit_events_learner ON audit_events(learner_id,recorded_at DESC);
CREATE INDEX audit_events_scope ON audit_events(country,store_id,recorded_at DESC);
-- Allowlist of operational fields: never capture passwords, session/access tokens,
-- SCORM suspend data, quiz answers or certificate verification tokens.
CREATE FUNCTION audit_safe_state(value jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT COALESCE(jsonb_object_agg(key,val),'{}'::jsonb) FROM jsonb_each(value) e(key,val)
 WHERE key=ANY(ARRAY['id','learner_id','name','email','workday_id','store_id','country','archived_at','employment_started_on','employment_ended_on','lifecycle_reason','course_id','course_title','title','status','package_id','revision','learning_version','version','assessor_required','deadline_days','validity_months','scope','site_id','active','assessor_only','assigned_at','assigned_by','source','started_at','completed_at','superseded_at','cancelled_at','cancelled_by','cancellation_reason','billed','refunded','previous_id','due_at','theory_completed_at','passed_assessment_id','assignment_id','assessor_id','assessor_name','outcome','assessed_at','revoked_at','revoked_by','revoke_reason','qualification','expires_on','expires_at','reason','retraining','credits_enabled','auto_archive_enabled','exclude_within_deadline','pathways_enabled','pathway_id','pathway_revision','archived']);
$$;
CREATE FUNCTION capture_lms_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_value jsonb; after_value jsonb; value jsonb; person learners%ROWTYPE; actor_value text;
BEGIN
 before_value:=CASE WHEN TG_OP<>'INSERT' THEN audit_safe_state(to_jsonb(OLD)) END;
 after_value:=CASE WHEN TG_OP<>'DELETE' THEN audit_safe_state(to_jsonb(NEW)) END;
 IF before_value IS NOT DISTINCT FROM after_value THEN RETURN NULL; END IF;
 value:=COALESCE(after_value,before_value);
 SELECT * INTO person FROM learners WHERE id=CASE WHEN TG_TABLE_NAME='learners' THEN value->>'id' ELSE value->>'learner_id' END;
 actor_value:=COALESCE(NULLIF(current_setting('app.audit_actor',true),''),value->>'cancelled_by',value->>'revoked_by',CASE WHEN TG_OP='INSERT' THEN value->>'assigned_by' END,'system');
 INSERT INTO audit_events(actor,entity,entity_id,action,learner_id,store_id,country,previous_state,next_state,reason)
 VALUES(actor_value,TG_TABLE_NAME,COALESCE(value->>'id',value->>'assignment_id',value->>'learner_id',value->>'course_id','record'),lower(TG_OP),person.id,COALESCE(person.store_id,value->>'store_id'),COALESCE(person.country,value->>'country'),before_value,after_value,NULLIF(current_setting('app.audit_reason',true),''));
 RETURN NULL;
END $$;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['learners','courses','course_versions','assignment_history','certificates','practical_assessments','assessor_grants','assessor_accounts','reporting_access','platform_admins','store_managers','learning_pathways','pathway_enrolments','organisation_settings'] LOOP
 EXECUTE format('CREATE TRIGGER lms_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION capture_lms_audit()',tab);
 END LOOP;
END $$;
-- Existing administrative history remains visible, with its original timestamp.
INSERT INTO audit_events(recorded_at,actor,entity,entity_id,action,learner_id,store_id,country,previous_state,next_state)
 SELECT a.created_at,a.actor_email,'learners',a.learner_id,a.action,a.learner_id,l.store_id,l.country,audit_safe_state(a.previous_state),audit_safe_state(a.next_state)
 FROM user_access_audit a LEFT JOIN learners l ON l.id=a.learner_id;
CREATE FUNCTION immutable_lms_evidence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Published versions and audit events cannot be changed or deleted.'; END $$;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION immutable_lms_evidence();
CREATE TRIGGER version_immutable BEFORE UPDATE OR DELETE ON course_versions FOR EACH ROW EXECUTE FUNCTION immutable_lms_evidence();

CREATE OR REPLACE FUNCTION assign_credit_course(person_id text,cid text,actor text,at_time timestamptz DEFAULT now(),renew boolean DEFAULT false,bill_new boolean DEFAULT true,origin text DEFAULT 'manual') RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE person learners%ROWTYPE; c courses%ROWTYPE; current_row course_assignments%ROWTYPE;
 old assignment_history%ROWTYPE; aid text:=gen_random_uuid()::text; amount integer; assignment_date timestamptz:=at_time;
 charging boolean:=bill_new; cert certificates%ROWTYPE; evidence jsonb; stamp text;
BEGIN
 SELECT * INTO person FROM learners WHERE id=person_id FOR UPDATE;
 IF NOT FOUND OR person.archived_at IS NOT NULL OR EXISTS(SELECT 1 FROM assessor_accounts WHERE learner_id=person_id AND assessor_only) OR EXISTS(SELECT 1 FROM platform_admins WHERE learner_id=person_id)
  OR EXISTS(SELECT 1 FROM reporting_access WHERE learner_id=person_id) OR EXISTS(SELECT 1 FROM store_managers WHERE learner_id=person_id) THEN RETURN false; END IF;
 SELECT * INTO c FROM courses WHERE id=cid;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO current_row FROM course_assignments WHERE learner_id=person_id AND course_id=cid;
 IF current_row.history_id IS NOT NULL AND NOT renew THEN RETURN false; END IF;
 IF renew THEN
  IF origin NOT IN ('refresher','version-update') AND EXISTS(SELECT 1 FROM course_refresher_rules WHERE source_course_id=cid AND country=person.country) THEN
   RAISE EXCEPTION 'A refresher course is configured for this country.';
  END IF;
  SELECT * INTO old FROM assignment_history WHERE id=current_row.history_id;
  SELECT * INTO cert FROM certificates WHERE learner_id=person_id AND course_id=cid AND assignment_id=old.id AND archived_at IS NULL AND cancelled_at IS NULL ORDER BY completed_at DESC LIMIT 1;
  IF old.id IS NULL OR (origin<>'version-update' AND (cert.expires_at IS NULL OR cert.expires_at::timestamptz>at_time+interval '720 hours')) THEN RAISE EXCEPTION 'Renewal is available from 30 days before certificate expiry.' USING ERRCODE='P0001'; END IF;
 END IF;
 IF current_row.learner_id IS NOT NULL AND current_row.history_id IS NULL THEN
  assignment_date:=current_row.assigned_at::timestamptz; charging:=false; actor:=current_row.assigned_by; origin:='manual';
 ELSIF NOT charging THEN
  SELECT i.assigned_at INTO stamp FROM learner_inductions i WHERE i.learner_id=person_id AND i.course_id=cid;
  IF stamp IS NOT NULL THEN assignment_date:=stamp::timestamptz; END IF;
 END IF;
 IF charging AND (c.status<>'published' OR NOT EXISTS(SELECT 1 FROM course_packages WHERE id=c.package_id AND status='ready')) THEN RETURN false; END IF;
 charging:=charging AND (SELECT credits_enabled FROM organisation_settings WHERE id=1);
 PERFORM ensure_store_credits(person.store_id,person.store_id,person.country);
 PERFORM topup_store_credits(person.store_id,at_time);
 PERFORM 1 FROM store_credit_accounts WHERE store_id=person.store_id FOR UPDATE;
 SELECT cents INTO amount FROM credit_rates WHERE effective_at<=at_time ORDER BY effective_at DESC LIMIT 1;
 IF charging AND amount IS NULL THEN RAISE EXCEPTION 'No credit price is configured for this date.'; END IF;
 IF charging AND (SELECT balance FROM store_credit_accounts WHERE store_id=person.store_id)<1 THEN
  RAISE EXCEPTION 'This store has no credits available. Contact a platform admin for a top-up.';
 END IF;
 stamp:=to_char(assignment_date AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 IF renew THEN
  SELECT COALESCE(jsonb_agg(to_jsonb(s)),'[]') INTO evidence FROM scorm_progress s JOIN course_packages p ON p.id=s.package_id WHERE s.learner_id=person_id AND p.course_id=cid;
  UPDATE assignment_history SET progress_snapshot=evidence,superseded_at=at_time WHERE id=old.id;
  UPDATE certificates SET archived_at=at_time WHERE learner_id=person_id AND course_id=cid AND archived_at IS NULL;
  DELETE FROM scorm_launches WHERE learner_id=person_id AND course_id=cid;
  DELETE FROM scorm_progress WHERE learner_id=person_id AND package_id IN (SELECT id FROM course_packages WHERE course_id=cid);
 END IF;
 INSERT INTO assignment_history(id,learner_id,course_id,package_id,course_title,learner_name,store_id,country,assigned_at,assigned_by,source,billed,unit_cents,previous_id)
 VALUES(aid,person_id,cid,c.package_id,c.title,person.name,person.store_id,person.country,assignment_date,actor,origin,charging,COALESCE(amount,0),old.id);
 IF NOT charging THEN
  UPDATE assignment_history SET started_at=(SELECT min(updated_at::timestamptz) FROM scorm_progress WHERE learner_id=person_id AND package_id=c.package_id),
   completed_at=(SELECT max(completed_at::timestamptz) FROM certificates WHERE learner_id=person_id AND course_id=cid AND archived_at IS NULL) WHERE id=aid;
 END IF;
 INSERT INTO course_assignments(learner_id,course_id,assigned_by,assigned_at,history_id) VALUES(person_id,cid,actor,stamp,aid)
 ON CONFLICT(learner_id,course_id) DO UPDATE SET history_id=excluded.history_id,assigned_by=excluded.assigned_by,assigned_at=excluded.assigned_at;
 DELETE FROM assignment_exclusions WHERE learner_id=person_id AND course_id=cid;
 UPDATE certificates SET assignment_id=aid WHERE learner_id=person_id AND course_id=cid AND assignment_id IS NULL AND archived_at IS NULL;
 IF charging THEN
  UPDATE store_credit_accounts SET balance=balance-1 WHERE store_id=person.store_id;
  INSERT INTO credit_ledger(id,store_id,kind,credits,value_cents,assignment_id,recorded_at,actor)
   VALUES(gen_random_uuid()::text,person.store_id,'assignment',-1,amount,aid,assignment_date,actor);
 END IF;
 RETURN true;
END $$;

CREATE FUNCTION audit_user_action() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO audit_events(actor,entity,entity_id,action,learner_id,store_id,country,previous_state,next_state,reason)
 SELECT NEW.actor_email,'learners',NEW.learner_id,NEW.action,NEW.learner_id,l.store_id,l.country,audit_safe_state(NEW.previous_state),audit_safe_state(NEW.next_state),NULLIF(current_setting('app.audit_reason',true),'') FROM learners l WHERE l.id=NEW.learner_id;
 RETURN NULL;
END $$;
CREATE TRIGGER user_action_event AFTER INSERT ON user_access_audit FOR EACH ROW EXECUTE FUNCTION audit_user_action();

CREATE FUNCTION protect_assignment_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.course_snapshot IS DISTINCT FROM OLD.course_snapshot OR NEW.learning_version IS DISTINCT FROM OLD.learning_version OR NEW.package_id IS DISTINCT FROM OLD.package_id OR NEW.course_title IS DISTINCT FROM OLD.course_title THEN
 RAISE EXCEPTION 'An assigned course version cannot be rewritten. Create a new assignment.';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER assignment_version_immutable BEFORE UPDATE ON assignment_history FOR EACH ROW EXECUTE FUNCTION protect_assignment_version();
