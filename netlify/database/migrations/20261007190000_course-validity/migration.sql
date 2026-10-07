ALTER TABLE courses ADD COLUMN validity_months integer
  CHECK (validity_months IS NULL OR validity_months BETWEEN 1 AND 120);
