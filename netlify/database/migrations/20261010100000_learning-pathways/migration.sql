-- Each deployment represents one client organisation, matching organisation_settings.
ALTER TABLE organisation_settings ADD COLUMN pathways_enabled boolean NOT NULL DEFAULT false;
CREATE TABLE learning_pathways (
 id text PRIMARY KEY, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 150), description text NOT NULL DEFAULT '',
 items jsonb NOT NULL CHECK(jsonb_array_length(items)>0), deadline_days integer CHECK(deadline_days BETWEEN 1 AND 3650),
 award_certificate boolean NOT NULL DEFAULT false, archived boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL
);
CREATE TABLE pathway_enrolments (
 id text PRIMARY KEY, pathway_id text NOT NULL REFERENCES learning_pathways(id), learner_id text NOT NULL REFERENCES learners(id),
 pathway_revision integer NOT NULL, name text NOT NULL, description text NOT NULL, learner_name text NOT NULL,
 award_certificate boolean NOT NULL, assigned_at timestamptz NOT NULL DEFAULT now(), assigned_by text NOT NULL,
 due_at timestamptz, completed_at timestamptz, certificate_token text UNIQUE,
 UNIQUE(pathway_id,learner_id)
);
CREATE TABLE pathway_enrolment_courses (
 enrolment_id text NOT NULL REFERENCES pathway_enrolments(id), course_id text NOT NULL REFERENCES courses(id),
 assignment_id text NOT NULL REFERENCES assignment_history(id), title text NOT NULL,
 stage integer NOT NULL CHECK(stage BETWEEN 1 AND 100), position integer NOT NULL,
 completed_at timestamptz, PRIMARY KEY(enrolment_id,course_id)
);
CREATE INDEX pathway_course_assignment ON pathway_enrolment_courses(assignment_id);
CREATE INDEX pathway_enrolment_learner ON pathway_enrolments(learner_id);
CREATE TABLE pathway_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor text NOT NULL, action text NOT NULL,
 details jsonb NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);
-- Completion is recorded when the existing course certificate pipeline completes,
-- including any quiz and practical assessment. Later expiry does not erase history.
CREATE FUNCTION finish_learning_pathway(eid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 UPDATE pathway_enrolments e SET completed_at=GREATEST(e.assigned_at,(SELECT max(completed_at) FROM pathway_enrolment_courses WHERE enrolment_id=eid)),
 certificate_token=CASE WHEN e.award_certificate THEN COALESCE(e.certificate_token,gen_random_uuid()::text) END
 WHERE e.id=eid AND e.completed_at IS NULL
 AND EXISTS(SELECT 1 FROM pathway_enrolment_courses WHERE enrolment_id=eid)
 AND NOT EXISTS(SELECT 1 FROM pathway_enrolment_courses WHERE enrolment_id=eid AND completed_at IS NULL);
END $$;
CREATE FUNCTION update_pathway_completion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE eid text;
BEGIN
 IF NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
  UPDATE pathway_enrolment_courses SET completed_at=NEW.completed_at WHERE assignment_id=NEW.id;
  FOR eid IN SELECT enrolment_id FROM pathway_enrolment_courses WHERE assignment_id=NEW.id LOOP
   IF NEW.completed_at IS NULL THEN
    -- Explicit withdrawal of a course completion also withdraws its pathway award.
    UPDATE pathway_enrolments SET completed_at=NULL,certificate_token=NULL WHERE id=eid;
   ELSE PERFORM finish_learning_pathway(eid); END IF;
  END LOOP;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pathway_course_completion AFTER UPDATE OF completed_at ON assignment_history
 FOR EACH ROW EXECUTE FUNCTION update_pathway_completion();
CREATE FUNCTION pathway_course_unlocked(person_id text,cid text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS(
 SELECT 1 FROM pathway_enrolments e JOIN pathway_enrolment_courses item ON item.enrolment_id=e.id
 WHERE e.learner_id=person_id AND e.completed_at IS NULL AND item.course_id=cid AND item.completed_at IS NULL
 AND EXISTS(SELECT 1 FROM pathway_enrolment_courses prior WHERE prior.enrolment_id=e.id AND prior.stage<item.stage AND prior.completed_at IS NULL));
$$;
-- Do not allow an assignment to be removed out from under an active pathway.
CREATE FUNCTION protect_pathway_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.cancelled_at IS NOT NULL AND OLD.cancelled_at IS NULL AND EXISTS(
 SELECT 1 FROM pathway_enrolment_courses i JOIN pathway_enrolments e ON e.id=i.enrolment_id
 WHERE i.assignment_id=NEW.id AND e.completed_at IS NULL) THEN
 RAISE EXCEPTION 'This course is required by an assigned pathway and cannot be removed.';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pathway_assignment_guard BEFORE UPDATE OF cancelled_at ON assignment_history
 FOR EACH ROW EXECUTE FUNCTION protect_pathway_assignment();
-- A renewal replaces a course attempt; unfinished pathway requirements follow it.
CREATE FUNCTION relink_pathway_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.history_id IS DISTINCT FROM OLD.history_id THEN
  UPDATE pathway_enrolment_courses SET assignment_id=NEW.history_id
  WHERE assignment_id=OLD.history_id AND completed_at IS NULL;
  UPDATE assignment_history SET due_at=LEAST(due_at,(SELECT min(e.due_at) FROM pathway_enrolments e JOIN pathway_enrolment_courses i ON i.enrolment_id=e.id WHERE i.assignment_id=NEW.history_id AND e.completed_at IS NULL)) WHERE id=NEW.history_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pathway_reassignment AFTER UPDATE OF history_id ON course_assignments
 FOR EACH ROW EXECUTE FUNCTION relink_pathway_assignment();
