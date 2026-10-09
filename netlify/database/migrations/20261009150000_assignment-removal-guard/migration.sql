-- Recheck training activity under the learner lock before changing assignments or credits.
CREATE OR REPLACE FUNCTION cancel_credit_assignment(aid text,actor text,reason text,at_time timestamptz DEFAULT now()) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE a assignment_history%ROWTYPE; previous assignment_history%ROWTYPE; evidence jsonb; refund boolean;
BEGIN
 SELECT * INTO a FROM assignment_history WHERE id=aid;
 IF NOT FOUND THEN RAISE EXCEPTION 'Assignment not found.'; END IF;
 PERFORM 1 FROM learners WHERE id=a.learner_id FOR UPDATE;
 SELECT * INTO a FROM assignment_history WHERE id=aid FOR UPDATE;
 IF a.cancelled_at IS NOT NULL THEN RETURN jsonb_build_object('removed',true,'refunded',a.refunded,'alreadyRemoved',true); END IF;
 IF NOT EXISTS(SELECT 1 FROM course_assignments WHERE history_id=aid) THEN RAISE EXCEPTION 'This assignment has changed. Refresh and try again.'; END IF;
 IF at_time<a.assigned_at OR at_time>=a.assigned_at+INTERVAL '336 hours' THEN RAISE EXCEPTION 'Assignments can be removed only within 14 days of assignment.'; END IF;
 IF length(trim(reason))<3 OR length(reason)>500 THEN RAISE EXCEPTION 'Enter a removal reason between 3 and 500 characters.'; END IF;
 SELECT COALESCE(jsonb_agg(to_jsonb(s)),'[]') INTO evidence FROM scorm_progress s JOIN course_packages p ON p.id=s.package_id WHERE s.learner_id=a.learner_id AND p.course_id=a.course_id;
 -- Presence of any progress/launch is evidence of a start, including a zero-second launch.
 IF a.started_at IS NULL AND (jsonb_array_length(evidence)>0 OR EXISTS(SELECT 1 FROM scorm_launches WHERE learner_id=a.learner_id AND course_id=a.course_id)) THEN a.started_at:=at_time; END IF;
 IF a.started_at IS NOT NULL OR a.completed_at IS NOT NULL THEN RAISE EXCEPTION 'Started or completed assignments cannot be removed.'; END IF;
 refund:=a.billed;
 UPDATE assignment_history SET cancelled_at=at_time,cancelled_by=actor,cancellation_reason=trim(reason),started_at=a.started_at,refunded=refund,progress_snapshot=evidence WHERE id=aid;
 DELETE FROM scorm_launches WHERE learner_id=a.learner_id AND course_id=a.course_id;
 DELETE FROM course_assignments WHERE history_id=aid;
 UPDATE certificates SET archived_at=at_time,cancelled_at=at_time WHERE assignment_id=aid AND archived_at IS NULL;
 INSERT INTO assignment_exclusions VALUES(a.learner_id,a.course_id) ON CONFLICT DO NOTHING;
 IF a.previous_id IS NOT NULL THEN
  SELECT * INTO previous FROM assignment_history WHERE id=a.previous_id;
  DELETE FROM scorm_progress WHERE learner_id=a.learner_id AND package_id IN (SELECT id FROM course_packages WHERE course_id=a.course_id);
  INSERT INTO scorm_progress SELECT r.* FROM jsonb_populate_recordset(NULL::scorm_progress,previous.progress_snapshot) r;
  UPDATE scorm_progress SET active_launch=NULL WHERE learner_id=a.learner_id AND package_id IN (SELECT id FROM course_packages WHERE course_id=a.course_id);
  UPDATE certificates SET archived_at=NULL WHERE assignment_id=previous.id AND cancelled_at IS NULL;
  UPDATE assignment_history SET superseded_at=NULL WHERE id=previous.id;
  INSERT INTO course_assignments(learner_id,course_id,assigned_by,assigned_at,history_id)
   VALUES(a.learner_id,a.course_id,previous.assigned_by,to_char(previous.assigned_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),previous.id);
  DELETE FROM assignment_exclusions WHERE learner_id=a.learner_id AND course_id=a.course_id;
 ELSE
  -- Evidence stays in history. Current progress must not resurrect a removed requirement.
  DELETE FROM scorm_progress WHERE learner_id=a.learner_id AND package_id IN (SELECT id FROM course_packages WHERE course_id=a.course_id);
 END IF;
 IF refund THEN
  UPDATE store_credit_accounts SET balance=balance+1 WHERE store_id=a.store_id;
  INSERT INTO credit_ledger(id,store_id,kind,credits,value_cents,assignment_id,recorded_at,actor,note)
   VALUES(gen_random_uuid()::text,a.store_id,'refund',1,-a.unit_cents,aid,at_time,actor,trim(reason));
 END IF;
 RETURN jsonb_build_object('removed',true,'refunded',refund,'restoredPrevious',a.previous_id IS NOT NULL);
END $$;
