-- Country-specific substitutes for repeating an expiring course. A missing rule
-- means the learner may renew the original course during the last 30 days.
CREATE TABLE course_refresher_rules (
 source_course_id text NOT NULL REFERENCES courses(id),
 country text NOT NULL,
 refresher_course_id text NOT NULL REFERENCES courses(id),
 PRIMARY KEY(source_course_id,country),
 CHECK(source_course_id<>refresher_course_id)
);
CREATE TABLE course_refresher_assignments (
 certificate_token text PRIMARY KEY REFERENCES certificates(token),
 country text NOT NULL,
 refresher_course_id text NOT NULL REFERENCES courses(id),
 assignment_id text REFERENCES assignment_history(id),
 outcome text NOT NULL CHECK(outcome IN ('assigned','unavailable','no_credits','no_price','excluded')),
 attempted_at timestamptz NOT NULL
);
CREATE INDEX refresher_assignments_retry ON course_refresher_assignments(attempted_at) WHERE assignment_id IS NULL;
CREATE INDEX certificates_renewal_lookup ON certificates(learner_id,course_id) WHERE archived_at IS NULL AND cancelled_at IS NULL;

INSERT INTO course_refresher_rules(source_course_id,country,refresher_course_id)
 SELECT source.id,country.name,target.id FROM courses source CROSS JOIN courses target
 CROSS JOIN (VALUES ('United Kingdom'),('Ireland')) country(name)
 WHERE source.source_course_id='154' AND target.source_course_id='209'
 ON CONFLICT DO NOTHING;
-- Make the existing refresher discoverable in these two country libraries;
-- publishing still requires its validated SCORM package.
UPDATE courses SET catalogue_scope='countries',available_countries_json='["United Kingdom","Ireland"]',revision=revision+1,updated_at=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 WHERE source_course_id='209' AND catalogue_scope='unconfigured';

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

-- One durable event per expiring certificate, even if two requests or the
-- scheduler race. Never erase the source course or revive a cancelled refresher.
CREATE FUNCTION assign_course_refresher(cert_token text,at_time timestamptz DEFAULT now()) RETURNS text LANGUAGE plpgsql AS $$
DECLARE cert certificates%ROWTYPE; person learners%ROWTYPE; target_id text; target_assignment text;
 target_cert certificates%ROWTYPE; event course_refresher_assignments%ROWTYPE;
 outcome_value text:='assigned'; added boolean; needs_renewal boolean:=false;
BEGIN
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
