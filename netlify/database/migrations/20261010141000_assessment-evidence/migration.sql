CREATE TABLE assessment_evidence (
 id text PRIMARY KEY, assignment_id text NOT NULL REFERENCES assignment_history(id),
 assessment_id text REFERENCES practical_assessments(id), uploaded_by text NOT NULL REFERENCES learners(id),
 filename text NOT NULL, mime_type text NOT NULL CHECK(mime_type IN ('application/pdf','image/jpeg','image/png','image/webp','image/heic')),
 size integer NOT NULL CHECK(size BETWEEN 1 AND 3145728), sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 storage_context text NOT NULL, state text NOT NULL DEFAULT 'uploading' CHECK(state IN ('uploading','ready','removed')),
 uploaded_at timestamptz NOT NULL DEFAULT now(), removed_at timestamptz,
 CHECK(assessment_id IS NULL OR state='ready'), CHECK((state='removed')=(removed_at IS NOT NULL))
);
CREATE INDEX assessment_evidence_attempt ON assessment_evidence(assessment_id);
CREATE INDEX assessment_evidence_drafts ON assessment_evidence(assignment_id,uploaded_by) WHERE assessment_id IS NULL;

CREATE FUNCTION protect_assessment_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p practical_assessments%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Evidence records cannot be deleted.'; END IF;
 IF OLD.assessment_id IS NOT NULL OR OLD.state='removed' OR
 (to_jsonb(NEW)-ARRAY['assessment_id','state','removed_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['assessment_id','state','removed_at']) THEN
  RAISE EXCEPTION 'Saved assessment evidence cannot be changed.';
 END IF;
 IF NEW.assessment_id IS NOT NULL THEN
  SELECT * INTO p FROM practical_assessments WHERE id=NEW.assessment_id;
  IF OLD.state<>'ready' OR p.assignment_id IS DISTINCT FROM NEW.assignment_id OR p.assessor_id IS DISTINCT FROM NEW.uploaded_by THEN
   RAISE EXCEPTION 'Evidence does not belong to this assessment.';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER evidence_immutable BEFORE UPDATE OR DELETE ON assessment_evidence FOR EACH ROW EXECUTE FUNCTION protect_assessment_evidence();

-- Link exactly the selected files to this attempt in the same transaction as sign-off and certification.
CREATE FUNCTION record_practical_assessment(aid text,actor_id text,result text,assessment_date date,accepted boolean,assessment_notes text,evidence_ids text[]) RETURNS text LANGUAGE plpgsql AS $$
DECLARE rid text; found_count integer;
BEGIN
 PERFORM 1 FROM assignment_history WHERE id=aid FOR UPDATE;
 IF evidence_ids IS NULL OR cardinality(evidence_ids)>5 OR cardinality(evidence_ids)<>(SELECT count(DISTINCT x) FROM unnest(evidence_ids) x) THEN
  RAISE EXCEPTION 'Choose up to five evidence files.';
 END IF;
 PERFORM 1 FROM assessment_evidence WHERE id=ANY(evidence_ids) ORDER BY id FOR UPDATE;
 SELECT count(*) INTO found_count FROM assessment_evidence WHERE id=ANY(evidence_ids) AND assignment_id=aid AND uploaded_by=actor_id AND assessment_id IS NULL AND state='ready';
 IF found_count<>cardinality(evidence_ids) OR found_count<>(SELECT count(*) FROM assessment_evidence WHERE assignment_id=aid AND uploaded_by=actor_id AND assessment_id IS NULL AND state<>'removed') THEN
  RAISE EXCEPTION 'Evidence is not ready or belongs to another assessment.';
 END IF;
 rid:=record_practical_assessment(aid,actor_id,result,assessment_date,accepted,assessment_notes);
 UPDATE assessment_evidence SET assessment_id=rid WHERE id=ANY(evidence_ids);
 RETURN rid;
END $$;

CREATE FUNCTION capture_assessment_evidence_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE person learners%ROWTYPE; actor_email text; before_value jsonb; after_value jsonb;
BEGIN
 SELECT l.* INTO person FROM learners l JOIN assignment_history h ON h.learner_id=l.id WHERE h.id=NEW.assignment_id;
 SELECT email INTO actor_email FROM learners WHERE id=NEW.uploaded_by;
 IF TG_OP='UPDATE' THEN before_value:=jsonb_build_object('assessment_id',OLD.assessment_id,'status',OLD.state); END IF;
 after_value:=jsonb_build_object('assignment_id',NEW.assignment_id,'assessment_id',NEW.assessment_id,'filename',NEW.filename,'mime_type',NEW.mime_type,'size',NEW.size,'sha256',NEW.sha256,'status',NEW.state,'uploaded_by',NEW.uploaded_by);
 INSERT INTO audit_events(actor,entity,entity_id,action,learner_id,store_id,country,previous_state,next_state)
 VALUES(COALESCE(NULLIF(current_setting('app.audit_actor',true),''),actor_email),'assessment_evidence',NEW.id,
 CASE WHEN NEW.assessment_id IS NOT NULL THEN 'attached' WHEN NEW.state='removed' THEN 'removed' WHEN NEW.state='ready' THEN 'uploaded' ELSE 'upload_started' END,
 person.id,person.store_id,person.country,before_value,after_value);
 RETURN NULL;
END $$;
CREATE TRIGGER evidence_audit AFTER INSERT OR UPDATE ON assessment_evidence FOR EACH ROW EXECUTE FUNCTION capture_assessment_evidence_audit();
