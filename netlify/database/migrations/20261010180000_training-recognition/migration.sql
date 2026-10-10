UPDATE organisation_settings SET features=features||'{"training_recognition":{"policy":"optional","enabled":false}}'::jsonb,revision=revision+1;
CREATE TABLE training_recognitions (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
 assignment_id text NOT NULL REFERENCES assignment_history(id),
 learner_id text NOT NULL REFERENCES learners(id),
 kind text NOT NULL CHECK(kind IN ('exempt','recognised','extension')),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 2000),
 evidence_ref text NOT NULL CHECK(length(evidence_ref) BETWEEN 3 AND 2000),
 qualification text CHECK(length(qualification)<=300),
 achieved_on date,
 valid_until timestamptz NOT NULL,
 approved_by text NOT NULL, approved_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,revoked_by text,revocation_reason text,
 CHECK(valid_until>approved_at),
 CHECK(kind<>'recognised' OR (achieved_on IS NOT NULL AND length(qualification)>0)),
 CHECK((revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND length(revocation_reason)>=3))
);
CREATE UNIQUE INDEX one_current_training_recognition ON training_recognitions(assignment_id) WHERE revoked_at IS NULL;
CREATE INDEX training_recognitions_learner ON training_recognitions(learner_id);
CREATE TRIGGER lms_audit AFTER INSERT OR UPDATE OR DELETE ON training_recognitions FOR EACH ROW EXECUTE FUNCTION capture_lms_audit();
CREATE FUNCTION protect_training_recognition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Training decisions cannot be deleted.'; END IF;
 IF OLD.revoked_at IS NOT NULL OR (to_jsonb(NEW)-ARRAY['revoked_at','revoked_by','revocation_reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['revoked_at','revoked_by','revocation_reason']) OR NEW.revoked_at IS NULL THEN
 RAISE EXCEPTION 'Revoke the existing decision before recording a replacement.'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_training_recognition BEFORE UPDATE OR DELETE ON training_recognitions FOR EACH ROW EXECUTE FUNCTION protect_training_recognition();

-- Revalidate queued notices against current recognition and the effective deadline.
CREATE OR REPLACE FUNCTION learning_email_candidates_unfiltered(at_time timestamptz DEFAULT now())
RETURNS TABLE(event_key text,kind text,recipient_id text,invitation_id text,email text,payload jsonb,occurred_at timestamptz,ends_at timestamptz)
LANGUAGE sql STABLE AS $$
WITH settings AS (SELECT * FROM email_settings WHERE id=1),
people AS (
 SELECT l.* FROM learners l WHERE l.archived_at IS NULL AND NULLIF(btrim(l.email),'') IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM platform_admins p WHERE p.learner_id=l.id)
 AND NOT EXISTS(SELECT 1 FROM reporting_access r WHERE r.learner_id=l.id)
 AND NOT EXISTS(SELECT 1 FROM store_managers m WHERE m.learner_id=l.id)
 AND NOT EXISTS(SELECT 1 FROM assessor_accounts a WHERE a.learner_id=l.id AND a.assessor_only)
 AND NOT EXISTS(SELECT 1 FROM organisation_stores s WHERE s.id=l.store_id AND NOT s.active)
),
training AS (
 SELECT h.id,h.learner_id,h.course_title AS title,h.assigned_at,CASE WHEN r.kind='extension' THEN r.valid_until ELSE h.due_at END AS due_at,h.theory_completed_at,h.assessor_required,'course' AS resource,
 '/?courses=1'::text AS path,r.id AS decision_id FROM assignment_history h JOIN course_assignments a ON a.history_id=h.id
 JOIN courses c ON c.id=h.course_id AND c.status='published' JOIN people l ON l.id=h.learner_id
 LEFT JOIN training_recognitions r ON r.assignment_id=h.id AND r.revoked_at IS NULL AND (r.valid_until>at_time OR r.kind='extension')
 WHERE h.cancelled_at IS NULL AND h.superseded_at IS NULL AND h.completed_at IS NULL AND (r.id IS NULL OR r.kind='extension')
 UNION ALL
 SELECT e.id,e.learner_id,e.name,e.assigned_at,e.due_at,NULL,false,'pathway','/?courses=1',NULL::text FROM pathway_enrolments e
 JOIN people l ON l.id=e.learner_id WHERE e.completed_at IS NULL
),
validity AS (
 SELECT c.*,l.name,l.email FROM certificates c JOIN people l ON l.id=c.learner_id
 WHERE c.expires_at IS NOT NULL AND c.cancelled_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM course_assignments a JOIN training_recognitions r ON r.assignment_id=a.history_id
 WHERE a.learner_id=c.learner_id AND a.course_id=c.course_id AND r.revoked_at IS NULL AND r.kind IN ('exempt','recognised') AND r.valid_until>at_time)
 AND NOT EXISTS(SELECT 1 FROM assignment_history h WHERE h.id=c.assignment_id AND h.cancelled_at IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM certificates newer WHERE newer.learner_id=c.learner_id AND newer.course_id IS NOT DISTINCT FROM c.course_id
   AND newer.cancelled_at IS NULL AND newer.completed_at::timestamptz>c.completed_at::timestamptz)
 AND NOT EXISTS(SELECT 1 FROM course_refresher_assignments r JOIN assignment_history h ON h.id=r.assignment_id
   WHERE r.certificate_token=c.token AND h.completed_at IS NOT NULL AND h.cancelled_at IS NULL AND EXISTS(
    SELECT 1 FROM certificates renewed WHERE renewed.assignment_id=h.id AND renewed.cancelled_at IS NULL
     AND (renewed.expires_at IS NULL OR renewed.expires_at::timestamptz>at_time)))
),
events AS (
 SELECT 'invite:'||i.id AS event_key,'invitation'::text AS kind,NULL::text AS recipient_id,i.id AS invitation_id,i.email,
 jsonb_build_object('name',i.name) AS payload,i.requested_at AS occurred_at,i.requested_at+interval '48 hours' AS ends_at
 FROM learning_invitations i WHERE i.cancelled_at IS NULL AND i.accepted_at IS NULL AND i.first_sent_at IS NULL AND i.requested_at IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM learners l WHERE lower(l.email)=lower(i.email))
 AND NOT EXISTS(SELECT 1 FROM organisation_stores s WHERE s.id=i.store_id AND NOT s.active)
 UNION ALL
 SELECT 'invite-reminder:'||i.id,'invitation_reminder',NULL,i.id,i.email,jsonb_build_object('name',i.name,'hours',s.invitation_hours),
 i.first_sent_at+make_interval(hours=>s.invitation_hours),i.first_sent_at+make_interval(hours=>s.invitation_hours+24)
 FROM learning_invitations i CROSS JOIN settings s WHERE i.cancelled_at IS NULL AND i.accepted_at IS NULL AND i.first_sent_at IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM learners l WHERE lower(l.email)=lower(i.email))
 AND NOT EXISTS(SELECT 1 FROM organisation_stores st WHERE st.id=i.store_id AND NOT st.active)
 UNION ALL
 SELECT 'account:'||l.id,'account_ready',l.id,NULL,l.email,jsonb_build_object('name',l.name,'path','/?login=1'),
 l.entered_at::timestamptz,l.entered_at::timestamptz+interval '48 hours' FROM people l WHERE l.last_login_at IS NULL
 UNION ALL
 SELECT 'account-reminder:'||l.id,'account_reminder',l.id,NULL,l.email,jsonb_build_object('name',l.name,'path','/?login=1','hours',s.invitation_hours),
 o.sent_at+make_interval(hours=>s.invitation_hours),o.sent_at+make_interval(hours=>s.invitation_hours+24)
 FROM people l JOIN email_outbox o ON o.event_key='account:'||l.id AND o.status='sent' CROSS JOIN settings s WHERE l.last_login_at IS NULL
 UNION ALL
 SELECT 'assigned:'||t.resource||':'||t.id,CASE WHEN t.resource='course' THEN 'course_assigned' ELSE 'pathway_assigned' END,l.id,NULL,l.email,
 jsonb_build_object('name',l.name,'title',t.title,'date',t.due_at,'path',t.path),t.assigned_at,t.assigned_at+interval '48 hours'
 FROM training t JOIN people l ON l.id=t.learner_id
 WHERE t.resource='pathway' OR NOT EXISTS(SELECT 1 FROM pathway_enrolment_courses p WHERE p.assignment_id=t.id)
 UNION ALL
 SELECT 'due:'||t.resource||':'||t.id||':'||d.value||COALESCE(':'||t.decision_id,''),'deadline_reminder',l.id,NULL,l.email,
 jsonb_build_object('name',l.name,'title',t.title,'date',t.due_at,'days',d.value::int,'path',t.path),
 t.due_at-make_interval(days=>d.value::int),LEAST(t.due_at,t.due_at-make_interval(days=>d.value::int)+interval '24 hours')
 FROM training t JOIN people l ON l.id=t.learner_id CROSS JOIN settings s CROSS JOIN jsonb_array_elements_text(s.deadline_days) d
 WHERE t.due_at IS NOT NULL AND (t.resource='pathway' OR NOT EXISTS(SELECT 1 FROM pathway_enrolment_courses p JOIN pathway_enrolments e ON e.id=p.enrolment_id WHERE p.assignment_id=t.id AND e.due_at=t.due_at AND e.completed_at IS NULL))
 UNION ALL
 SELECT 'overdue:'||t.resource||':'||t.id||COALESCE(':'||t.decision_id,''),'overdue',l.id,NULL,l.email,jsonb_build_object('name',l.name,'title',t.title,'date',t.due_at,'path',t.path),t.due_at,t.due_at+interval '24 hours'
 FROM training t JOIN people l ON l.id=t.learner_id WHERE t.due_at IS NOT NULL
 AND (t.resource='pathway' OR NOT EXISTS(SELECT 1 FROM pathway_enrolment_courses p JOIN pathway_enrolments e ON e.id=p.enrolment_id WHERE p.assignment_id=t.id AND e.due_at=t.due_at AND e.completed_at IS NULL))
 UNION ALL
 SELECT 'expiry:'||c.certificate_number||':'||d.value,'expiry_reminder',c.learner_id,NULL,c.email,
 jsonb_build_object('name',c.name,'title',c.course_title,'date',c.expires_at,'days',d.value::int,'path','/?courses=1'),
 c.expires_at::timestamptz-make_interval(days=>d.value::int),c.expires_at::timestamptz-make_interval(days=>d.value::int)+interval '24 hours'
 FROM validity c CROSS JOIN settings s CROSS JOIN jsonb_array_elements_text(s.expiry_days) d
 UNION ALL
 SELECT 'expired:'||c.certificate_number,'expired',c.learner_id,NULL,c.email,jsonb_build_object('name',c.name,'title',c.course_title,'date',c.expires_at,'path','/?courses=1'),
 c.expires_at::timestamptz,c.expires_at::timestamptz+interval '24 hours' FROM validity c
 UNION ALL
 SELECT 'certificate:'||c.certificate_number,'certificate_ready',l.id,NULL,l.email,
 jsonb_build_object('name',l.name,'title',c.course_title,'path','/certificates'),c.issued_at::timestamptz,c.issued_at::timestamptz+interval '48 hours'
 FROM certificates c JOIN people l ON l.id=c.learner_id WHERE c.cancelled_at IS NULL AND c.archived_at IS NULL
 UNION ALL
 SELECT 'pathway-certificate:'||e.id,'certificate_ready',l.id,NULL,l.email,jsonb_build_object('name',l.name,'title',e.name,'path','/?courses=1'),e.completed_at,e.completed_at+interval '48 hours'
 FROM pathway_enrolments e JOIN people l ON l.id=e.learner_id WHERE e.completed_at IS NOT NULL AND e.award_certificate AND e.certificate_token IS NOT NULL
 UNION ALL
 SELECT 'assessment:'||t.id,'assessment_pending',l.id,NULL,l.email,jsonb_build_object('name',l.name,'title',t.title,'path',t.path),t.theory_completed_at,t.theory_completed_at+interval '48 hours'
 FROM training t JOIN people l ON l.id=t.learner_id WHERE t.assessor_required AND t.theory_completed_at IS NOT NULL
 UNION ALL
 SELECT 'manager:'||m.learner_id||':'||to_char(at_time AT TIME ZONE 'Europe/London','IYYY-IW'),'manager_digest',m.learner_id,NULL,manager.email,
 jsonb_build_object('name',manager.name,'store',COALESCE(st.name,m.store_id),'path','/?view=report','overdue',
 (SELECT count(*) FROM training t JOIN people l ON l.id=t.learner_id WHERE l.store_id=m.store_id AND t.resource='course' AND t.due_at<at_time),
 'expiring',(SELECT count(*) FROM validity c JOIN people l ON l.id=c.learner_id WHERE l.store_id=m.store_id AND c.expires_at::timestamptz BETWEEN at_time AND at_time+interval '30 days'),
 'assessment',(SELECT count(*) FROM training t JOIN people l ON l.id=t.learner_id WHERE l.store_id=m.store_id AND t.resource='course' AND t.assessor_required AND t.theory_completed_at IS NOT NULL)),
 (date_trunc('week',at_time AT TIME ZONE 'Europe/London')+interval '8 hours') AT TIME ZONE 'Europe/London',
 (date_trunc('week',at_time AT TIME ZONE 'Europe/London')+interval '32 hours') AT TIME ZONE 'Europe/London'
 FROM store_managers m JOIN learners manager ON manager.id=m.learner_id LEFT JOIN organisation_stores st ON st.id=m.store_id
 WHERE manager.archived_at IS NULL AND NULLIF(btrim(manager.email),'') IS NOT NULL AND COALESCE(st.active,true)
)
SELECT e.* FROM events e CROSS JOIN settings s
WHERE s.enabled ? e.kind AND e.occurred_at>=GREATEST(s.active_since,COALESCE((s.enabled_since->>e.kind)::timestamptz,s.active_since))
 AND e.occurred_at<=at_time AND e.ends_at>at_time;
$$;
