-- This deployment has one client organisation; course requirements apply to that client.
ALTER TABLE courses ADD COLUMN assessor_required boolean NOT NULL DEFAULT false;
ALTER TABLE assignment_history ADD COLUMN assessor_required boolean NOT NULL DEFAULT false;
ALTER TABLE assignment_history ADD COLUMN theory_completed_at timestamptz;
ALTER TABLE assignment_history ADD COLUMN passed_assessment_id text;
ALTER TABLE certificates ADD COLUMN assessor_name text;
ALTER TABLE certificates ADD COLUMN assessed_at timestamptz;
CREATE TABLE assessor_accounts(learner_id text PRIMARY KEY REFERENCES learners(id),assessor_only boolean NOT NULL DEFAULT false);
CREATE TABLE assessor_grants(id text PRIMARY KEY,learner_id text NOT NULL REFERENCES learners(id),course_id text NOT NULL REFERENCES courses(id),site_id text NOT NULL DEFAULT '*',qualification text NOT NULL,expires_on date,active boolean NOT NULL DEFAULT true,assigned_by text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE assessor_audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,actor text NOT NULL,action text NOT NULL,details jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE practical_assessments(id text PRIMARY KEY,assignment_id text NOT NULL REFERENCES assignment_history(id),assessor_id text NOT NULL REFERENCES learners(id),assessor_name text NOT NULL,grant_snapshot jsonb NOT NULL,outcome text NOT NULL CHECK(outcome IN ('pass','not_yet_competent')),assessed_at timestamptz NOT NULL,declaration text NOT NULL,notes text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now(),revoked_at timestamptz,revoked_by text,revoke_reason text);
ALTER TABLE assignment_history ADD CONSTRAINT passed_assessment_fk FOREIGN KEY(passed_assessment_id) REFERENCES practical_assessments(id);
CREATE INDEX practical_assignment ON practical_assessments(assignment_id);
CREATE OR REPLACE FUNCTION snapshot_assignment_requirements() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c courses%ROWTYPE;
BEGIN
 SELECT * INTO c FROM courses WHERE id=NEW.course_id;
 NEW.quiz_json:=c.quiz_json; NEW.assessor_required:=c.assessor_required;
 IF c.deadline_days IS NOT NULL THEN NEW.due_at:=NEW.assigned_at+c.deadline_days*interval '24 hours'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION issue_course_certificate(person_id text,pack_id text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 UPDATE assignment_history h SET theory_completed_at=COALESCE(h.theory_completed_at,GREATEST(e.completed_at,q.passed_at)::timestamptz)
 FROM course_assignments a JOIN course_packages p ON p.id=pack_id
 CROSS JOIN LATERAL (SELECT max(s.completed_at) completed_at, count(s.sco_id) saved_count,
 bool_and(s.status IN ('passed','completed') AND s.completed_at IS NOT NULL) complete
 FROM jsonb_array_elements(p.scos_json::jsonb) item LEFT JOIN scorm_progress s ON s.learner_id=person_id AND s.package_id=p.id AND s.sco_id=item->>'id') e
 LEFT JOIN LATERAL (SELECT min(submitted_at)::text passed_at FROM course_quiz_attempts WHERE assignment_id=a.history_id AND passed) q ON true
 WHERE h.id=a.history_id AND a.learner_id=person_id AND a.course_id=p.course_id AND h.package_id=pack_id
 AND e.complete AND e.saved_count=jsonb_array_length(p.scos_json::jsonb) AND e.saved_count>0 AND (h.quiz_json IS NULL OR q.passed_at IS NOT NULL);
 INSERT INTO certificates(token,learner_id,course_id,package_id,course_revision,course_title,language_code,learner_name,store_id,country,completed_at,validity_months,expires_at,issued_at,assignment_id,assessor_name,assessed_at)
 SELECT replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),l.id,c.id,p.id,c.revision,c.title,c.language_code,l.name,l.store_id,l.country,
 COALESCE(to_char(pr.assessed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),GREATEST(evidence.completed_at,q.passed_at)),c.validity_months,CASE WHEN c.validity_months IS NOT NULL THEN to_char((COALESCE(to_char(pr.assessed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),GREATEST(evidence.completed_at,q.passed_at))::timestamptz AT TIME ZONE 'UTC')+make_interval(months=>c.validity_months),'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
 to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),a.history_id,pr.assessor_name,pr.assessed_at
 FROM learners l JOIN course_packages p ON p.id=pack_id AND p.status='ready' JOIN courses c ON c.id=p.course_id
 LEFT JOIN course_assignments a ON a.learner_id=l.id AND a.course_id=c.id
 LEFT JOIN assignment_history h ON h.id=a.history_id
 LEFT JOIN practical_assessments pr ON pr.id=h.passed_assessment_id AND pr.revoked_at IS NULL AND pr.outcome='pass'
 LEFT JOIN LATERAL (SELECT to_char(min(submitted_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS passed_at
   FROM course_quiz_attempts WHERE assignment_id=a.history_id AND passed) q ON true
 CROSS JOIN LATERAL (SELECT max(s.completed_at) AS completed_at,bool_and(s.status IN ('completed','passed') AND s.completed_at IS NOT NULL) AS complete,count(s.sco_id) AS saved_count
 FROM jsonb_array_elements(p.scos_json::jsonb) item LEFT JOIN scorm_progress s ON s.learner_id=l.id AND s.package_id=p.id AND s.sco_id=item->>'id') evidence
 WHERE (NOT COALESCE(h.assessor_required,false) OR pr.id IS NOT NULL) AND (h.id IS NULL OR (h.package_id=pack_id AND h.cancelled_at IS NULL)) AND (h.quiz_json IS NULL OR q.passed_at IS NOT NULL) AND l.id=person_id AND jsonb_array_length(p.scos_json::jsonb)>0 AND evidence.complete AND evidence.saved_count=jsonb_array_length(p.scos_json::jsonb) AND evidence.completed_at IS NOT NULL
 ON CONFLICT(learner_id,package_id) WHERE archived_at IS NULL DO NOTHING;
 UPDATE assignment_history h SET completed_at=COALESCE(h.completed_at,c.completed_at::timestamptz)
 FROM certificates c WHERE c.assignment_id=h.id AND c.learner_id=person_id AND c.package_id=pack_id AND c.archived_at IS NULL;
END $$;

CREATE FUNCTION record_practical_assessment(aid text,actor_id text,result text,assessment_date date,accepted boolean,assessment_notes text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE h assignment_history%ROWTYPE; person learners%ROWTYPE; assessor learners%ROWTYPE; g assessor_grants%ROWTYPE; rid text:=gen_random_uuid()::text;
BEGIN
 SELECT * INTO h FROM assignment_history WHERE id=aid FOR UPDATE;
 IF NOT FOUND OR NOT h.assessor_required OR h.cancelled_at IS NOT NULL OR h.superseded_at IS NOT NULL OR h.passed_assessment_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM course_assignments WHERE history_id=aid) THEN RAISE EXCEPTION 'This assignment is not awaiting assessment.'; END IF;
 SELECT * INTO person FROM learners WHERE id=h.learner_id;
 SELECT * INTO assessor FROM learners WHERE id=actor_id AND archived_at IS NULL FOR UPDATE;
 IF assessor.id IS NULL OR person.archived_at IS NOT NULL OR actor_id=h.learner_id THEN RAISE EXCEPTION 'Assessment is not permitted.'; END IF;
 SELECT * INTO g FROM assessor_grants WHERE learner_id=actor_id AND course_id=h.course_id AND active AND (site_id='*' OR site_id=person.store_id)
 AND (expires_on IS NULL OR expires_on>=CURRENT_DATE) ORDER BY updated_at DESC LIMIT 1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Your assessor authorisation is missing or expired.'; END IF;
 PERFORM issue_course_certificate(h.learner_id,h.package_id);
 SELECT * INTO h FROM assignment_history WHERE id=aid;
 IF h.theory_completed_at IS NULL THEN RAISE EXCEPTION 'Online theory must be completed first.'; END IF;
 IF assessment_date IS NULL OR assessment_date>CURRENT_DATE OR assessment_date<(h.theory_completed_at AT TIME ZONE 'UTC')::date OR (g.expires_on IS NOT NULL AND assessment_date>g.expires_on) THEN RAISE EXCEPTION 'Choose an assessment date between theory completion and today.'; END IF;
 IF result NOT IN ('pass','not_yet_competent') OR (result='pass' AND NOT COALESCE(accepted,false)) OR (result='not_yet_competent' AND length(trim(assessment_notes))=0) THEN RAISE EXCEPTION 'An outcome, declaration for a pass, and reason for an unsuccessful assessment are required.'; END IF;
 INSERT INTO practical_assessments(id,assignment_id,assessor_id,assessor_name,grant_snapshot,outcome,assessed_at,declaration,notes)
 VALUES(rid,aid,actor_id,assessor.name,to_jsonb(g),result,assessment_date::timestamp AT TIME ZONE 'UTC',CASE WHEN result='pass' THEN 'I confirm that I carried out the practical assessment for this learner and assessed them as competent against the course practical assessment criteria.' ELSE '' END,assessment_notes);
 IF result='pass' THEN UPDATE assignment_history SET passed_assessment_id=rid WHERE id=aid; PERFORM issue_course_certificate(h.learner_id,h.package_id); END IF;
 RETURN rid;
END $$;

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
  IF origin<>'refresher' AND EXISTS(SELECT 1 FROM course_refresher_rules WHERE source_course_id=cid AND country=person.country) THEN
   RAISE EXCEPTION 'A refresher course is configured for this country.';
  END IF;
  SELECT * INTO old FROM assignment_history WHERE id=current_row.history_id;
  SELECT * INTO cert FROM certificates WHERE learner_id=person_id AND course_id=cid AND assignment_id=old.id AND archived_at IS NULL AND cancelled_at IS NULL ORDER BY completed_at DESC LIMIT 1;
  IF old.id IS NULL OR cert.expires_at IS NULL OR cert.expires_at::timestamptz>at_time+interval '720 hours' THEN RAISE EXCEPTION 'Renewal is available from 30 days before certificate expiry.' USING ERRCODE='P0001'; END IF;
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
