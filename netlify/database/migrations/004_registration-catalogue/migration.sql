ALTER TABLE learners ADD COLUMN password_hash text;
ALTER TABLE learners ADD COLUMN induction_enrolled boolean NOT NULL DEFAULT false;

ALTER TABLE courses ADD COLUMN english_title text NOT NULL DEFAULT '';
ALTER TABLE courses ADD COLUMN category text NOT NULL DEFAULT '';
ALTER TABLE courses ADD COLUMN language_code text NOT NULL DEFAULT 'en';
ALTER TABLE courses ADD COLUMN source_course_id text UNIQUE;
ALTER TABLE courses ADD COLUMN legacy_assignment_count integer;
ALTER TABLE courses ADD COLUMN available_countries_json text NOT NULL DEFAULT '[]';
ALTER TABLE courses ADD COLUMN catalogue_scope text NOT NULL DEFAULT 'unconfigured'
  CHECK (catalogue_scope IN ('unconfigured','countries','global'));
ALTER TABLE courses ADD COLUMN induction_role text NOT NULL DEFAULT 'none'
  CHECK (induction_role IN ('none','country','default'));

CREATE TABLE store_managers (
  learner_id text PRIMARY KEY REFERENCES learners(id) ON DELETE CASCADE,
  store_id text NOT NULL,
  assigned_by text NOT NULL,
  updated_at text NOT NULL
);
CREATE TABLE course_assignments (
  learner_id text NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  assigned_by text NOT NULL,
  assigned_at text NOT NULL,
  PRIMARY KEY (learner_id,course_id)
);
CREATE INDEX idx_course_assignments_course ON course_assignments(course_id);

CREATE TABLE learner_inductions (
  learner_id text PRIMARY KEY REFERENCES learners(id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES courses(id),
  assigned_at text NOT NULL
);
