-- One client organisation per deployment; preserve all current settings and records.
ALTER TABLE organisation_settings ADD COLUMN features jsonb NOT NULL DEFAULT '{}';
UPDATE organisation_settings SET features=jsonb_build_object(
 'pathways',jsonb_build_object('policy','optional','enabled',pathways_enabled),
 'pathway_rules',jsonb_build_object('policy','optional','enabled',true),
 'renewals',jsonb_build_object('policy','optional','enabled',true),
 'refreshers',jsonb_build_object('policy','optional','enabled',true),
 'quizzes',jsonb_build_object('policy','optional','enabled',true),
 'assessor',jsonb_build_object('policy','optional','enabled',true),
 'assessment_evidence',jsonb_build_object('policy','optional','enabled',true),
 'pathway_certificates',jsonb_build_object('policy','optional','enabled',true),
 'bulk_import',jsonb_build_object('policy','optional','enabled',true),
 'lifecycle',jsonb_build_object('policy','optional','enabled',true),
 'auto_archive',jsonb_build_object('policy','optional','enabled',auto_archive_enabled),
 'email_notifications',jsonb_build_object('policy','optional','enabled',true),
 'assignment_emails',jsonb_build_object('policy','optional','enabled',true),
 'registration_reminders',jsonb_build_object('policy','optional','enabled',true),
 'expiry_reminders',jsonb_build_object('policy','optional','enabled',true),
 'learning_time',jsonb_build_object('policy','optional','enabled',true),
 'site_matrix',jsonb_build_object('policy','optional','enabled',true),
 'credit_reporting',jsonb_build_object('policy','optional','enabled',true),
 'credits',jsonb_build_object('policy','optional','enabled',credits_enabled),
 'exclude_within_deadline',jsonb_build_object('policy','optional','enabled',exclude_within_deadline));
CREATE FUNCTION feature_enabled(key text) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE s organisation_settings%ROWTYPE; f jsonb; enabled boolean; parent text;
BEGIN
 SELECT * INTO s FROM organisation_settings WHERE id=1;
 f:=s.features->key;
 IF f IS NULL OR f->>'policy'='disabled' THEN RETURN false; END IF;
 enabled:=CASE key WHEN 'pathways' THEN s.pathways_enabled WHEN 'auto_archive' THEN s.auto_archive_enabled
 WHEN 'credits' THEN s.credits_enabled WHEN 'exclude_within_deadline' THEN s.exclude_within_deadline ELSE (f->>'enabled')::boolean END;
 parent:=CASE WHEN key IN ('pathway_rules','pathway_certificates') THEN 'pathways'
 WHEN key IN ('assignment_emails','registration_reminders','expiry_reminders') THEN 'email_notifications' END;
 RETURN (f->>'policy'='required' OR COALESCE(enabled,false)) AND (parent IS NULL OR feature_enabled(parent));
END $$;
-- Keep the established SQL billing, archive and compliance switches authoritative.
CREATE FUNCTION sync_feature_settings() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.features IS DISTINCT FROM OLD.features THEN
 NEW.pathways_enabled:=NEW.features->'pathways'->>'policy'='required' OR (NEW.features->'pathways'->>'policy'='optional' AND (NEW.features->'pathways'->>'enabled')::boolean);
 NEW.credits_enabled:=NEW.features->'credits'->>'policy'='required' OR (NEW.features->'credits'->>'policy'='optional' AND (NEW.features->'credits'->>'enabled')::boolean);
 NEW.auto_archive_enabled:=NEW.features->'auto_archive'->>'policy'='required' OR (NEW.features->'auto_archive'->>'policy'='optional' AND (NEW.features->'auto_archive'->>'enabled')::boolean);
 NEW.exclude_within_deadline:=NEW.features->'exclude_within_deadline'->>'policy'='required' OR (NEW.features->'exclude_within_deadline'->>'policy'='optional' AND (NEW.features->'exclude_within_deadline'->>'enabled')::boolean);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sync_feature_settings BEFORE UPDATE ON organisation_settings FOR EACH ROW EXECUTE FUNCTION sync_feature_settings();
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
CREATE OR REPLACE FUNCTION assign_course_refresher(cert_token text,at_time timestamptz DEFAULT now()) RETURNS text LANGUAGE plpgsql AS $$
DECLARE cert certificates%ROWTYPE; person learners%ROWTYPE; target_id text; target_assignment text;
 target_cert certificates%ROWTYPE; event course_refresher_assignments%ROWTYPE;
 outcome_value text:='assigned'; added boolean; needs_renewal boolean:=false;
BEGIN
 IF NOT feature_enabled('refreshers') THEN RETURN 'not_due'; END IF;
 SELECT * INTO cert FROM certificates WHERE token=cert_token;
 IF NOT FOUND THEN RETURN 'not_due'; END IF;
 SELECT * INTO person FROM learners WHERE id=cert.learner_id FOR UPDATE;
 IF NOT FOUND OR person.archived_at IS NOT NULL OR EXISTS(SELECT 1 FROM platform_admins WHERE learner_id=person.id)
  OR EXISTS(SELECT 1 FROM reporting_access WHERE learner_id=person.id) OR EXISTS(SELECT 1 FROM store_managers WHERE learner_id=person.id) THEN RETURN 'not_due'; END IF;
 -- Re-read after locking: a reset, removal, transfer or another worker may have won.
 SELECT * INTO cert FROM certificates WHERE token=cert_token AND archived_at IS NULL AND cancelled_at IS NULL;
 IF NOT FOUND OR cert.expires_at IS NULL OR cert.expires_at::timestamptz>at_time+interval '720 hours'
  OR NOT EXISTS(SELECT 1 FROM course_assignments WHERE history_id=cert.assignment_id) THEN RETURN 'not_due'; END IF;
 SELECT * INTO event FROM course_refresher_assignments WHERE certificate_token=cert_token;
 IF event.assignment_id IS NOT NULL THEN RETURN 'already_assigned'; END IF;
 SELECT refresher_course_id INTO target_id FROM course_refresher_rules WHERE source_course_id=cert.course_id AND country=person.country;
 IF target_id IS NULL THEN RETURN 'not_due'; END IF;
 IF EXISTS(SELECT 1 FROM assignment_exclusions WHERE learner_id=person.id AND course_id=target_id) THEN
  outcome_value:='excluded';
 ELSIF NOT EXISTS(SELECT 1 FROM courses c JOIN course_packages p ON p.id=c.package_id AND p.status='ready' WHERE c.id=target_id AND c.status='published') THEN
  outcome_value:='unavailable';
 ELSE
  SELECT history_id INTO target_assignment FROM course_assignments WHERE learner_id=person.id AND course_id=target_id;
  SELECT * INTO target_cert FROM certificates WHERE assignment_id=target_assignment AND archived_at IS NULL AND cancelled_at IS NULL ORDER BY completed_at DESC LIMIT 1;
  needs_renewal:=target_cert.expires_at IS NOT NULL AND target_cert.expires_at::timestamptz<=at_time+interval '720 hours';
  IF target_assignment IS NULL OR needs_renewal THEN
   -- A failed charge rolls back its entire assignment, while recording a retryable
   -- outcome outside this subtransaction. Successful learners still proceed.
   BEGIN
    added:=assign_credit_course(person.id,target_id,'automatic refresher',at_time,needs_renewal,true,'refresher');
    IF added THEN
     SELECT history_id INTO target_assignment FROM course_assignments WHERE learner_id=person.id AND course_id=target_id;
    ELSE outcome_value:='unavailable';target_assignment:=NULL;
    END IF;
   EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM='This store has no credits available. Contact a platform admin for a top-up.' THEN outcome_value:='no_credits';
    ELSIF SQLERRM='No credit price is configured for this date.' THEN outcome_value:='no_price';
    ELSE RAISE;
    END IF;
    target_assignment:=NULL;
   END;
  END IF;
 END IF;
 INSERT INTO course_refresher_assignments(certificate_token,country,refresher_course_id,assignment_id,outcome,attempted_at)
 VALUES(cert_token,person.country,target_id,target_assignment,outcome_value,at_time)
 ON CONFLICT(certificate_token) DO UPDATE SET country=EXCLUDED.country,refresher_course_id=EXCLUDED.refresher_course_id,
  assignment_id=EXCLUDED.assignment_id,outcome=EXCLUDED.outcome,attempted_at=EXCLUDED.attempted_at;
 IF target_assignment IS NOT NULL THEN
  UPDATE assignment_history SET progress_snapshot=(SELECT COALESCE(jsonb_agg(to_jsonb(s)),'[]') FROM scorm_progress s
   JOIN course_packages p ON p.id=s.package_id WHERE s.learner_id=person.id AND p.course_id=cert.course_id)
  WHERE id=cert.assignment_id;
 END IF;
 RETURN outcome_value;
END $$;
CREATE FUNCTION guard_course_features() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.quiz_json IS NOT NULL AND (TG_OP='INSERT' OR NEW.quiz_json IS DISTINCT FROM OLD.quiz_json) AND NOT feature_enabled('quizzes') THEN RAISE EXCEPTION 'This feature is switched off in Settings.'; END IF;
 IF NEW.assessor_required AND (TG_OP='INSERT' OR NOT OLD.assessor_required) AND NOT feature_enabled('assessor') THEN RAISE EXCEPTION 'This feature is switched off in Settings.'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_course_features BEFORE INSERT OR UPDATE ON courses FOR EACH ROW EXECUTE FUNCTION guard_course_features();
CREATE FUNCTION feature_pathway_certificate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.award_certificate:=NEW.award_certificate AND feature_enabled('pathway_certificates');
 RETURN NEW;
END $$;
CREATE TRIGGER feature_pathway_certificate BEFORE INSERT ON pathway_enrolments FOR EACH ROW EXECUTE FUNCTION feature_pathway_certificate();
ALTER FUNCTION learning_email_candidates(timestamptz) RENAME TO learning_email_candidates_unfiltered;
CREATE FUNCTION learning_email_candidates(at_time timestamptz DEFAULT now())
RETURNS TABLE(event_key text,kind text,recipient_id text,invitation_id text,email text,payload jsonb,occurred_at timestamptz,ends_at timestamptz)
LANGUAGE sql STABLE AS $$
 SELECT c.* FROM learning_email_candidates_unfiltered(at_time) c WHERE feature_enabled('email_notifications')
 AND (c.kind NOT IN ('course_assigned','pathway_assigned') OR feature_enabled('assignment_emails'))
 AND (c.kind NOT IN ('invitation_reminder','account_reminder') OR feature_enabled('registration_reminders'))
 AND (c.kind NOT IN ('expiry_reminder','expired') OR feature_enabled('expiry_reminders'));
$$;
-- Block alternate mutation paths as well as UI/API buttons.
CREATE FUNCTION guard_feature_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='learners' THEN
  IF (NEW.store_id IS DISTINCT FROM OLD.store_id OR NEW.employment_ended_on IS DISTINCT FROM OLD.employment_ended_on) AND NOT feature_enabled('lifecycle') THEN
   RAISE EXCEPTION 'This feature is switched off in Settings.';
  END IF;
 ELSIF TG_TABLE_NAME='assessment_evidence' THEN
  IF NOT feature_enabled('assessment_evidence') THEN RAISE EXCEPTION 'This feature is switched off in Settings.'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_lifecycle_feature BEFORE UPDATE OF store_id,employment_ended_on ON learners FOR EACH ROW EXECUTE FUNCTION guard_feature_mutation();
CREATE TRIGGER guard_evidence_feature BEFORE INSERT ON assessment_evidence FOR EACH ROW EXECUTE FUNCTION guard_feature_mutation();
