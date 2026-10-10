-- One client organisation per deployment. Defaults retain existing behaviour.
CREATE TABLE organisation_settings (
 id integer PRIMARY KEY CHECK(id=1), credits_enabled boolean NOT NULL DEFAULT true,
 auto_archive_enabled boolean NOT NULL DEFAULT false,
 exclude_within_deadline boolean NOT NULL DEFAULT true,
 revision integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(), updated_by text
);
INSERT INTO organisation_settings(id) VALUES(1);
CREATE TABLE organisation_settings_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor text NOT NULL,
 previous_state jsonb NOT NULL, next_state jsonb NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE courses ADD COLUMN deadline_days integer CHECK(deadline_days BETWEEN 1 AND 3650);
ALTER TABLE courses ADD COLUMN quiz_json jsonb;
ALTER TABLE assignment_history ADD COLUMN due_at timestamptz;
ALTER TABLE assignment_history ADD COLUMN quiz_json jsonb;
-- Unknown historic logins cannot safely be treated as never having logged in.
ALTER TABLE learners ADD COLUMN inactivity_tracking_since timestamptz NOT NULL DEFAULT now();
CREATE TABLE course_quiz_attempts (
 id text PRIMARY KEY, assignment_id text NOT NULL REFERENCES assignment_history(id),
 answers jsonb NOT NULL, correct_count integer NOT NULL, question_count integer NOT NULL,
 pass_percent integer NOT NULL, passed boolean NOT NULL, submitted_at timestamptz NOT NULL DEFAULT now(),
 CHECK(question_count>0 AND correct_count BETWEEN 0 AND question_count AND pass_percent BETWEEN 1 AND 100)
);
CREATE INDEX course_quiz_attempts_assignment ON course_quiz_attempts(assignment_id,passed);
-- Snapshot requirements: later edits do not move a learner's deadline or revoke a pass.
CREATE FUNCTION snapshot_assignment_requirements() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c courses%ROWTYPE;
BEGIN
 SELECT * INTO c FROM courses WHERE id=NEW.course_id;
 NEW.quiz_json:=c.quiz_json;
 IF c.deadline_days IS NOT NULL THEN NEW.due_at:=NEW.assigned_at+c.deadline_days*interval '24 hours'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER assignment_requirements BEFORE INSERT ON assignment_history
 FOR EACH ROW EXECUTE FUNCTION snapshot_assignment_requirements();

-- Archive learner accounts only, retain all evidence, and revoke active sessions.
-- Null historic login dates start a fresh observation window at migration time.
CREATE FUNCTION auto_archive_inactive_users(at_time timestamptz DEFAULT now()) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE person learners%ROWTYPE; stamp text; total integer:=0;
BEGIN
 IF NOT (SELECT auto_archive_enabled FROM organisation_settings WHERE id=1) THEN RETURN 0; END IF;
 stamp:=to_char(at_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 FOR person IN SELECT l.* FROM learners l WHERE l.archived_at IS NULL
   AND GREATEST(COALESCE(l.last_login_at::timestamptz,l.inactivity_tracking_since),(SELECT max(created_at) FROM user_access_audit WHERE learner_id=l.id AND action='restore'))<=at_time-interval '3 years'
   AND NOT EXISTS(SELECT 1 FROM platform_admins WHERE learner_id=l.id)
   AND NOT EXISTS(SELECT 1 FROM reporting_access WHERE learner_id=l.id)
   AND NOT EXISTS(SELECT 1 FROM store_managers WHERE learner_id=l.id)
   ORDER BY l.id FOR UPDATE OF l SKIP LOCKED LIMIT 500 LOOP
  -- Recheck grants after taking the same learner lock as administrative changes.
  IF EXISTS(SELECT 1 FROM platform_admins WHERE learner_id=person.id)
   OR EXISTS(SELECT 1 FROM reporting_access WHERE learner_id=person.id)
   OR EXISTS(SELECT 1 FROM store_managers WHERE learner_id=person.id) THEN CONTINUE; END IF;
  UPDATE learners SET archived_at=stamp WHERE id=person.id;
  DELETE FROM sessions WHERE learner_id=person.id;
  DELETE FROM scorm_launches WHERE learner_id=person.id;
  INSERT INTO user_access_audit(learner_id,actor_email,action,previous_state,next_state,created_at)
   VALUES(person.id,'automatic inactivity rule','archive',jsonb_build_object('archived_at',NULL,'last_login_at',person.last_login_at),
    jsonb_build_object('archived_at',stamp,'reason','No recorded login for three years'),at_time);
  total:=total+1;
 END LOOP;
 RETURN total;
END $$;

CREATE OR REPLACE FUNCTION assign_credit_course(person_id text,cid text,actor text,at_time timestamptz DEFAULT now(),renew boolean DEFAULT false,bill_new boolean DEFAULT true,origin text DEFAULT 'manual') RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE person learners%ROWTYPE; c courses%ROWTYPE; current_row course_assignments%ROWTYPE;
 old assignment_history%ROWTYPE; aid text:=gen_random_uuid()::text; amount integer; assignment_date timestamptz:=at_time;
 charging boolean:=bill_new; cert certificates%ROWTYPE; evidence jsonb; stamp text;
BEGIN
 SELECT * INTO person FROM learners WHERE id=person_id FOR UPDATE;
 IF NOT FOUND OR person.archived_at IS NOT NULL OR EXISTS(SELECT 1 FROM platform_admins WHERE learner_id=person_id)
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


CREATE OR REPLACE FUNCTION topup_store_credits(sid text,at_time timestamptz DEFAULT now()) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE account store_credit_accounts%ROWTYPE; p accounting_periods%ROWTYPE; amount integer; total integer:=0;
BEGIN
 IF NOT (SELECT credits_enabled FROM organisation_settings WHERE id=1) THEN RETURN 0; END IF;
 SELECT * INTO account FROM store_credit_accounts WHERE store_id=sid FOR UPDATE;
 IF NOT FOUND OR NOT account.active THEN RETURN 0; END IF;
 -- Retry-safe, date-based catch-up. Week 53 belongs to P13; no extra top-up.
 FOR p IN SELECT * FROM accounting_periods WHERE starts_on <= (at_time AT TIME ZONE 'Europe/London')::date
  AND starts_on::timestamp AT TIME ZONE 'Europe/London' > account.created_at
  ORDER BY starts_on LOOP
  IF NOT EXISTS(SELECT 1 FROM credit_ledger WHERE store_id=sid AND period_id=p.id AND kind='period_topup') THEN
   amount:=greatest(0,account.target-account.balance);
   INSERT INTO credit_ledger(id,store_id,kind,credits,period_id,recorded_at,actor)
    VALUES(gen_random_uuid()::text,sid,'period_topup',amount,p.id,p.starts_on::timestamp AT TIME ZONE 'Europe/London','scheduled top-up');
   account.balance:=account.balance+amount;
   UPDATE store_credit_accounts SET balance=account.balance WHERE store_id=sid;
   total:=total+amount;
  END IF;
 END LOOP;
 RETURN total;
END $$;


CREATE OR REPLACE FUNCTION issue_course_certificate(person_id text,pack_id text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO certificates(token,learner_id,course_id,package_id,course_revision,course_title,language_code,learner_name,store_id,country,completed_at,validity_months,expires_at,issued_at,assignment_id)
 SELECT replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),l.id,c.id,p.id,c.revision,c.title,c.language_code,l.name,l.store_id,l.country,
 GREATEST(evidence.completed_at,q.passed_at),c.validity_months,CASE WHEN c.validity_months IS NOT NULL THEN to_char((GREATEST(evidence.completed_at,q.passed_at)::timestamptz AT TIME ZONE 'UTC')+make_interval(months=>c.validity_months),'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
 to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),a.history_id
 FROM learners l JOIN course_packages p ON p.id=pack_id AND p.status='ready' JOIN courses c ON c.id=p.course_id
 LEFT JOIN course_assignments a ON a.learner_id=l.id AND a.course_id=c.id
 LEFT JOIN assignment_history h ON h.id=a.history_id
 LEFT JOIN LATERAL (SELECT to_char(min(submitted_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS passed_at
   FROM course_quiz_attempts WHERE assignment_id=a.history_id AND passed) q ON true
 CROSS JOIN LATERAL (SELECT max(s.completed_at) AS completed_at,bool_and(s.status IN ('completed','passed') AND s.completed_at IS NOT NULL) AS complete,count(s.sco_id) AS saved_count
 FROM jsonb_array_elements(p.scos_json::jsonb) item LEFT JOIN scorm_progress s ON s.learner_id=l.id AND s.package_id=p.id AND s.sco_id=item->>'id') evidence
 WHERE (h.quiz_json IS NULL OR q.passed_at IS NOT NULL) AND l.id=person_id AND jsonb_array_length(p.scos_json::jsonb)>0 AND evidence.complete AND evidence.saved_count=jsonb_array_length(p.scos_json::jsonb) AND evidence.completed_at IS NOT NULL
 ON CONFLICT(learner_id,package_id) WHERE archived_at IS NULL DO NOTHING;
 UPDATE assignment_history h SET completed_at=COALESCE(h.completed_at,c.completed_at::timestamptz)
 FROM certificates c WHERE c.assignment_id=h.id AND c.learner_id=person_id AND c.package_id=pack_id AND c.archived_at IS NULL;
END $$;
