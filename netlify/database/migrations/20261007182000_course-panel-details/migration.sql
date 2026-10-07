-- Editorial values only: a SCORM launch item is not a reliable lesson count.
ALTER TABLE courses ADD COLUMN estimated_duration_minutes integer
  CHECK (estimated_duration_minutes BETWEEN 1 AND 10080);
ALTER TABLE courses ADD COLUMN lesson_count integer
  CHECK (lesson_count BETWEEN 1 AND 1000);
