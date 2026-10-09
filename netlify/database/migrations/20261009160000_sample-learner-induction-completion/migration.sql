-- Simon requested completion of the induction assigned to the sample account.
-- This is sample data, not evidence that a learner completed real training.
-- Fail closed if the named account or its assigned induction is not unambiguous.
DO $$
DECLARE
 person_id text; induction_id text; matches integer; target record;
 completed_time text := to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 sample_note text := 'Sample completion set at Simon''s request on 9 October 2026; not evidence of actual training.';
BEGIN
 -- Fresh installations have no sample data to update.
 IF NOT EXISTS(SELECT 1 FROM learners) THEN RETURN; END IF;
 SELECT count(*),min(id) INTO matches,person_id FROM learners WHERE lower(trim(email))='learner@primark.com';
 IF matches<>1 THEN RAISE EXCEPTION 'Expected exactly one sample learner: learner@primark.com'; END IF;
 PERFORM 1 FROM learners l WHERE l.id=person_id AND l.archived_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM platform_admins WHERE learner_id=l.id)
  AND NOT EXISTS(SELECT 1 FROM reporting_access WHERE learner_id=l.id)
  AND NOT EXISTS(SELECT 1 FROM store_managers WHERE learner_id=l.id) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'The sample learner must be an active learner account.'; END IF;

 SELECT count(*),min(c.id) INTO matches,induction_id
 FROM course_assignments a JOIN courses c ON c.id=a.course_id
 WHERE a.learner_id=person_id AND (
  lower(trim(c.category))='induction' OR lower(trim(c.title))='primark employee induction'
  OR EXISTS(SELECT 1 FROM learner_inductions i WHERE i.learner_id=person_id AND i.course_id=c.id));
 IF matches<>1 THEN RAISE EXCEPTION 'Expected exactly one assigned induction for the sample learner.'; END IF;
 SELECT a.history_id,c.package_id,p.scos_json,h.package_id AS assigned_package,h.cancelled_at,h.superseded_at
 INTO target FROM course_assignments a JOIN courses c ON c.id=a.course_id
 JOIN course_packages p ON p.id=c.package_id JOIN assignment_history h ON h.id=a.history_id
 WHERE a.learner_id=person_id AND a.course_id=induction_id AND c.status='published' AND p.status='ready'
 FOR UPDATE OF h;
 IF NOT FOUND OR target.cancelled_at IS NOT NULL OR target.superseded_at IS NOT NULL OR target.assigned_package IS DISTINCT FROM target.package_id
 THEN RAISE EXCEPTION 'The sample induction must have an active assignment and its original ready package.'; END IF;
 IF jsonb_array_length(target.scos_json::jsonb)=0 OR EXISTS(
  SELECT 1 FROM jsonb_array_elements(target.scos_json::jsonb) sco GROUP BY sco->>'id' HAVING sco->>'id' IS NULL OR count(*)>1)
 THEN RAISE EXCEPTION 'The sample induction package must contain uniquely identified lessons.'; END IF;

 -- Complete each lesson without inventing assessment scores or study time.
 -- Retain existing resume data, scores and genuine completion timestamps.
 INSERT INTO scorm_progress(learner_id,package_id,sco_id,data_json,status,completed_at,updated_at)
 SELECT person_id,target.package_id,sco->>'id',jsonb_build_object('cmi.core.lesson_status','completed','cmi.comments',sample_note)::text,
 'completed',completed_time,completed_time FROM jsonb_array_elements(target.scos_json::jsonb) sco
 ON CONFLICT(learner_id,package_id,sco_id) DO UPDATE SET
  status=CASE WHEN scorm_progress.status='passed' THEN 'passed' ELSE 'completed' END,
  data_json=(scorm_progress.data_json::jsonb||jsonb_build_object(
   'cmi.core.lesson_status',CASE WHEN scorm_progress.status='passed' THEN 'passed' ELSE 'completed' END,
   'cmi.comments',CASE WHEN strpos(COALESCE(scorm_progress.data_json::jsonb->>'cmi.comments',''),sample_note)>0
     THEN scorm_progress.data_json::jsonb->>'cmi.comments'
     ELSE concat_ws(E'\n',NULLIF(scorm_progress.data_json::jsonb->>'cmi.comments',''),sample_note) END))::text,
  completed_at=COALESCE(scorm_progress.completed_at,EXCLUDED.completed_at),
  updated_at=CASE WHEN scorm_progress.status IN ('completed','passed') AND scorm_progress.completed_at IS NOT NULL THEN scorm_progress.updated_at ELSE EXCLUDED.updated_at END,
  active_launch=NULL;
 -- Prevent an already-open sample course from overwriting this requested completion.
 DELETE FROM scorm_launches WHERE learner_id=person_id AND course_id=induction_id;
 UPDATE assignment_history SET started_at=COALESCE(started_at,(
  SELECT min(s.completed_at::timestamptz) FROM scorm_progress s JOIN jsonb_array_elements(target.scos_json::jsonb) sco ON sco->>'id'=s.sco_id
  WHERE s.learner_id=person_id AND s.package_id=target.package_id)) WHERE id=target.history_id;
 PERFORM issue_course_certificate(person_id,target.package_id);
 IF NOT EXISTS(SELECT 1 FROM assignment_history WHERE id=target.history_id AND completed_at IS NOT NULL)
  OR NOT EXISTS(SELECT 1 FROM certificates WHERE assignment_id=target.history_id AND archived_at IS NULL AND cancelled_at IS NULL)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(target.scos_json::jsonb) sco LEFT JOIN scorm_progress s
    ON s.learner_id=person_id AND s.package_id=target.package_id AND s.sco_id=sco->>'id'
    WHERE s.status IS NULL OR s.status NOT IN ('completed','passed') OR s.completed_at IS NULL)
 THEN RAISE EXCEPTION 'Sample induction completion verification failed.'; END IF;
 RAISE NOTICE 'Sample learner induction completed: learner %, course %, assignment %',person_id,induction_id,target.history_id;
END $$;
