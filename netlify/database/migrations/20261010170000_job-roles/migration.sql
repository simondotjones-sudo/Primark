-- This installation uses one organisation (organisation_settings.id=1).
-- Job roles describe employment, never login permissions.
CREATE TABLE job_roles (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
 organisation_id integer NOT NULL DEFAULT 1 REFERENCES organisation_settings(id) CHECK (organisation_id=1),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
 external_code text CHECK (external_code IS NULL OR length(btrim(external_code)) BETWEEN 1 AND 100),
 archived boolean NOT NULL DEFAULT false, revision integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX job_roles_name_unique ON job_roles(organisation_id,lower(btrim(name)));
CREATE UNIQUE INDEX job_roles_code_unique ON job_roles(organisation_id,lower(btrim(external_code))) WHERE external_code IS NOT NULL;
ALTER TABLE learners ADD COLUMN job_role_id text REFERENCES job_roles(id);
CREATE INDEX learners_job_role ON learners(job_role_id);
-- Existing users deliberately remain unassigned.
INSERT INTO job_roles(name) VALUES ('Staff'),('Supervisor'),('Manager'),('Night Worker');
ALTER FUNCTION audit_safe_state(jsonb) RENAME TO audit_safe_state_before_job_roles;
CREATE FUNCTION audit_safe_state(value jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT audit_safe_state_before_job_roles(value) || COALESCE((SELECT jsonb_object_agg(key,val) FROM jsonb_each(value) e(key,val)
 WHERE key=ANY(ARRAY['job_role_id','job_role_name','external_code','organisation_id'])),'{}'::jsonb);
$$;
CREATE TRIGGER lms_audit AFTER INSERT OR UPDATE OR DELETE ON job_roles FOR EACH ROW EXECUTE FUNCTION capture_lms_audit();
-- Lock the role while assigning it, so archiving cannot race with a new selection.
CREATE FUNCTION guard_learner_job_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.job_role_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.job_role_id IS DISTINCT FROM OLD.job_role_id) THEN
  PERFORM 1 FROM job_roles WHERE id=NEW.job_role_id AND NOT archived FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active job role.'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER learner_job_role_active BEFORE INSERT OR UPDATE OF job_role_id ON learners FOR EACH ROW EXECUTE FUNCTION guard_learner_job_role();
CREATE OR REPLACE FUNCTION sync_pathway_assignments(person_id text DEFAULT NULL, only_pathway text DEFAULT NULL,bill_new boolean DEFAULT true) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE person learners%ROWTYPE; p learning_pathways%ROWTYPE; item jsonb; c courses%ROWTYPE; h assignment_history%ROWTYPE;
 eid text; expired boolean; position_value integer; n integer:=0; failure text;
BEGIN
 IF NOT feature_enabled('pathway_rules') THEN RETURN 0; END IF;
 FOR person IN SELECT l.* FROM learners l WHERE (person_id IS NULL OR l.id=person_id) AND l.archived_at IS NULL
 AND l.employment_ended_on IS NULL AND (l.employment_started_on IS NULL OR l.employment_started_on<=CURRENT_DATE)
 AND NOT EXISTS(SELECT 1 FROM platform_admins WHERE learner_id=l.id)
 AND NOT EXISTS(SELECT 1 FROM reporting_access WHERE learner_id=l.id)
 AND NOT EXISTS(SELECT 1 FROM store_managers WHERE learner_id=l.id)
 AND NOT EXISTS(SELECT 1 FROM assessor_accounts WHERE learner_id=l.id AND assessor_only)
 ORDER BY l.id FOR UPDATE LOOP
 DELETE FROM pathway_assignment_failures WHERE learner_id=person.id AND (only_pathway IS NULL OR pathway_id=only_pathway);
 FOR p IN SELECT * FROM learning_pathways WHERE (only_pathway IS NULL OR id=only_pathway) AND NOT archived
 AND assignment_rule->>'enabled'='true'
 AND (assignment_rule->>'scope'='all' OR assignment_rule->>'scope'='countries' AND jsonb_exists(assignment_rule->'countries',person.country)
 OR assignment_rule->>'scope'='sites' AND jsonb_exists(assignment_rule->'sites',person.store_id))
 AND (COALESCE(assignment_rule->'jobRoles','[]'::jsonb)='[]'::jsonb OR jsonb_exists(assignment_rule->'jobRoles',person.job_role_id))
 AND (NULLIF(assignment_rule->>'startedFrom','') IS NULL OR person.employment_started_on>=(assignment_rule->>'startedFrom')::date)
 AND (NULLIF(assignment_rule->>'startedTo','') IS NULL OR person.employment_started_on<=(assignment_rule->>'startedTo')::date)
 ORDER BY id LOOP
 IF EXISTS(SELECT 1 FROM pathway_enrolments WHERE pathway_id=p.id AND learner_id=person.id) THEN
  DELETE FROM pathway_assignment_failures WHERE pathway_id=p.id AND learner_id=person.id; CONTINUE;
 END IF;
 BEGIN
  eid:=gen_random_uuid()::text;
  INSERT INTO pathway_enrolments(id,pathway_id,learner_id,pathway_revision,name,description,learner_name,award_certificate,assigned_by,due_at)
  VALUES(eid,p.id,person.id,p.revision,p.name,p.description,person.name,p.award_certificate,'automatic pathway assignment',now()+p.deadline_days*interval '24 hours');
  position_value:=0;
  FOR item IN SELECT value FROM jsonb_array_elements(p.items) LOOP
   SELECT courses.* INTO c FROM courses JOIN course_packages pack ON pack.id=courses.package_id
   WHERE courses.id=item->>'courseId' AND courses.status='published' AND pack.status='ready' FOR SHARE OF courses;
   IF NOT FOUND OR NOT (c.catalogue_scope='global' OR c.catalogue_scope='countries' AND jsonb_exists(c.available_countries_json::jsonb,person.country)) THEN
    RAISE EXCEPTION 'Every pathway course must be available in the learner’s country.';
   END IF;
   SELECT hist.* INTO h FROM course_assignments a JOIN assignment_history hist ON hist.id=a.history_id WHERE a.learner_id=person.id AND a.course_id=c.id;
   expired:=EXISTS(SELECT 1 FROM certificates cert WHERE cert.assignment_id=h.id AND cert.cancelled_at IS NULL AND cert.archived_at IS NULL AND cert.expires_at::timestamptz<=now());
   IF h.id IS NULL OR expired THEN
    PERFORM assign_credit_course(person.id,c.id,'automatic pathway assignment',now(),expired,bill_new,'pathway');
    SELECT hist.* INTO h FROM course_assignments a JOIN assignment_history hist ON hist.id=a.history_id WHERE a.learner_id=person.id AND a.course_id=c.id;
   END IF;
   IF h.id IS NULL THEN RAISE EXCEPTION 'This course could not be assigned.'; END IF;
   INSERT INTO pathway_enrolment_courses(enrolment_id,course_id,assignment_id,title,stage,position,completed_at)
   VALUES(eid,c.id,h.id,c.title,(item->>'stage')::integer,position_value,h.completed_at);
   UPDATE assignment_history SET due_at=LEAST(due_at,(SELECT due_at FROM pathway_enrolments WHERE id=eid)) WHERE id=h.id AND completed_at IS NULL;
   position_value:=position_value+1;
  END LOOP;
  IF EXISTS(WITH RECURSIVE edges AS (
   SELECT DISTINCT i.course_id child,prior.course_id parent FROM pathway_enrolments e JOIN pathway_enrolment_courses i ON i.enrolment_id=e.id
   JOIN pathway_enrolment_courses prior ON prior.enrolment_id=e.id AND prior.stage<i.stage
   WHERE e.learner_id=person.id AND e.completed_at IS NULL AND i.completed_at IS NULL AND prior.completed_at IS NULL),
   reach(child,parent) AS (SELECT child,parent FROM edges UNION SELECT r.child,e.parent FROM reach r JOIN edges e ON e.child=r.parent)
   SELECT 1 FROM reach WHERE child=parent) THEN RAISE EXCEPTION 'These pathways would create conflicting course orders for a learner. Adjust the stages first.'; END IF;
  PERFORM finish_learning_pathway(eid);
  DELETE FROM pathway_assignment_failures WHERE pathway_id=p.id AND learner_id=person.id;
  INSERT INTO pathway_audit(actor,action,details) VALUES('system','automatic-assign',jsonb_build_object('pathwayId',p.id,'learnerId',person.id,'rule',p.assignment_rule));
  n:=n+1;
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS failure=MESSAGE_TEXT;
  INSERT INTO pathway_assignment_failures(pathway_id,learner_id,reason) VALUES(p.id,person.id,failure)
  ON CONFLICT(pathway_id,learner_id) DO UPDATE SET reason=excluded.reason,attempted_at=now();
 END;
 END LOOP;
 END LOOP;
 RETURN n;
END $$;
