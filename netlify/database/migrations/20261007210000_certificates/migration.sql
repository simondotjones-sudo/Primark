-- Certificates snapshot the evidence and renewal policy at the time of completion.
-- Updating a catalogue entry never rewrites an issued certificate.
CREATE TABLE certificates (
  token text PRIMARY KEY,
  certificate_number integer GENERATED ALWAYS AS IDENTITY UNIQUE,
  learner_id text NOT NULL REFERENCES learners(id),
  course_id text REFERENCES courses(id),
  package_id text REFERENCES course_packages(id),
  course_revision integer,
  course_title text NOT NULL,
  language_code text NOT NULL DEFAULT 'en',
  learner_name text NOT NULL,
  store_id text NOT NULL,
  country text NOT NULL,
  completed_at text NOT NULL,
  validity_months integer CHECK (validity_months IS NULL OR validity_months BETWEEN 1 AND 120),
  expires_at text,
  issued_at text NOT NULL,
  UNIQUE(learner_id, package_id)
);
CREATE INDEX certificates_learner ON certificates(learner_id, completed_at DESC);

-- One certificate per completed package. All launch items must have completion
-- evidence; extra/stale progress rows do not qualify. Repeated commits are safe.
CREATE FUNCTION issue_course_certificate(person_id text, pack_id text) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO certificates(token,learner_id,course_id,package_id,course_revision,course_title,
    language_code,learner_name,store_id,country,completed_at,validity_months,expires_at,issued_at)
  SELECT replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''),
    l.id,c.id,p.id,c.revision,c.title,c.language_code,l.name,l.store_id,l.country,
    evidence.completed_at,c.validity_months,
    CASE WHEN c.validity_months IS NOT NULL THEN
      to_char((evidence.completed_at::timestamptz AT TIME ZONE 'UTC') + make_interval(months => c.validity_months),
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ELSE NULL END,
    to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM learners l
  JOIN course_packages p ON p.id=pack_id AND p.status='ready'
  JOIN courses c ON c.id=p.course_id
  CROSS JOIN LATERAL (
    SELECT max(s.completed_at) AS completed_at,
      bool_and(s.status IN ('completed','passed') AND s.completed_at IS NOT NULL) AS complete,
      count(s.sco_id) AS saved_count
    FROM jsonb_array_elements(p.scos_json::jsonb) item
    LEFT JOIN scorm_progress s ON s.learner_id=l.id AND s.package_id=p.id AND s.sco_id=item->>'id'
  ) evidence
  WHERE l.id=person_id AND jsonb_array_length(p.scos_json::jsonb)>0
    AND evidence.complete AND evidence.saved_count=jsonb_array_length(p.scos_json::jsonb)
    AND evidence.completed_at IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM certificates issued WHERE issued.learner_id=l.id AND issued.package_id=p.id)
  ON CONFLICT (learner_id,package_id) DO NOTHING;
$$;

-- Retain the existing completion date. The current renewal setting becomes the
-- initial policy snapshot for existing evidence, including older package versions.
SELECT issue_course_certificate(learner_id,package_id)
FROM (SELECT DISTINCT learner_id,package_id FROM scorm_progress) completed_packages;

-- Preserve existing Safety Passport QR links and explicitly record no expiry.
INSERT INTO certificates(token,learner_id,course_title,learner_name,store_id,country,completed_at,issued_at)
SELECT certificate_token,id,'Primark Safety Passport',name,store_id,country,completed_at,
  to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
FROM learners WHERE completed_at IS NOT NULL AND certificate_token IS NOT NULL;
