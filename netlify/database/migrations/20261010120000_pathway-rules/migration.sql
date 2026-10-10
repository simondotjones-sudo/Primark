ALTER TABLE learning_pathways ADD COLUMN assignment_rule jsonb NOT NULL DEFAULT '{"enabled":false,"scope":"all","countries":[],"sites":[],"startedFrom":null,"startedTo":null}';
CREATE TABLE pathway_assignment_failures (
 pathway_id text NOT NULL REFERENCES learning_pathways(id), learner_id text NOT NULL REFERENCES learners(id),
 reason text NOT NULL, attempted_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(pathway_id,learner_id)
);
-- Use the same learner locks and assignment pipeline as normal course assignment.
CREATE FUNCTION sync_pathway_assignments(person_id text DEFAULT NULL, only_pathway text DEFAULT NULL,bill_new boolean DEFAULT true) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE person learners%ROWTYPE; p learning_pathways%ROWTYPE; item jsonb; c courses%ROWTYPE; h assignment_history%ROWTYPE;
 eid text; expired boolean; position_value integer; n integer:=0; failure text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM organisation_settings WHERE id=1 AND pathways_enabled) THEN RETURN 0; END IF;
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
ALTER FUNCTION sync_credit_assignments(text,boolean) RENAME TO sync_course_credit_assignments;
CREATE FUNCTION sync_credit_assignments(person_id text DEFAULT NULL,bill_new boolean DEFAULT true) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
 n:=sync_course_credit_assignments(person_id,bill_new);
 RETURN n+sync_pathway_assignments(person_id,NULL,bill_new);
END $$;
-- Extend the existing audit allowlist without changing old evidence.
ALTER FUNCTION audit_safe_state(jsonb) RENAME TO audit_safe_state_before_pathway_rules;
CREATE FUNCTION audit_safe_state(value jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT audit_safe_state_before_pathway_rules(value)||CASE WHEN value ? 'assignment_rule' THEN jsonb_build_object('assignment_rule',value->'assignment_rule') ELSE '{}'::jsonb END;
$$;
-- Retain store references until an administrator removes them from the rule.
ALTER FUNCTION store_can_delete(text) RENAME TO store_can_delete_before_pathway_rules;
CREATE FUNCTION store_can_delete(sid text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT store_can_delete_before_pathway_rules(sid) AND NOT EXISTS(
 SELECT 1 FROM learning_pathways WHERE jsonb_exists(assignment_rule->'sites',sid));
$$;
CREATE FUNCTION guard_pathway_rule_stores() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sid text;
BEGIN
 FOR sid IN SELECT value FROM jsonb_array_elements_text(NEW.assignment_rule->'sites') ORDER BY value LOOP
  PERFORM assert_store_not_deleted(sid);
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER pathway_rule_store_not_deleted BEFORE INSERT OR UPDATE OF assignment_rule ON learning_pathways
 FOR EACH ROW EXECUTE FUNCTION guard_pathway_rule_stores();
