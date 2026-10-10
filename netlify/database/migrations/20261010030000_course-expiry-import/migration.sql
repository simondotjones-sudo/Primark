-- Source: course_entitlements-primark.xlsx, Sheet1 rows 2-53, supplied 10 October 2026.
-- Years convert to 12/24 calendar months from completion, using existing certificate logic.
-- Source IDs come from the reviewed 005 catalogue seed and survive later title edits.
-- The other titles match only an exact, case-insensitive trimmed title. Never infer
-- a policy from category, language or similar names, and never create missing courses.
-- Issued certificates retain their original policy and expiry snapshots.
DO $$
DECLARE
 policy record; course_id text; matches integer; changed integer;
 matched_count integer := 0; updated_count integer := 0; missing_count integer := 0;
 changed_at text := to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
 FOR policy IN SELECT * FROM (VALUES
  (NULL, 'Manual Handling', 12),
  (NULL, 'Workstation Self Assessment', 12),
  (NULL, 'Manual Handling (Classic)', 12),
  ('154', 'Primark Employee Induction', 24),
  ('168', 'Primark Werknemer Inductie (NL)', 24),
  ('169', 'Primark Fire Warden Training (IE)', 12),
  (NULL, 'Primark Contractor Induction', 12),
  ('191', 'Iniciación para empleados de Primark (ES)', 24),
  ('192', 'Introdução de funcionário da Primark (PT)', 24),
  ('208', 'Primark Fire Warden Training (UK)', 12),
  ('209', 'Primark Employee Induction Refresher', 24),
  ('235', 'Primark Formação para responsáveis pela evacuação (PT)', 12),
  ('236', 'Primark Formación Brigadas de Emergencia', 12),
  ('264', 'Primark Mitarbeiterinduktion (DE)', 24),
  ('329', 'Primark Night Shift Worker Training (UK)', 12),
  (NULL, 'Primark Delivery Area Training', 12),
  (NULL, 'Primark Brandschutzhelfer-Kurs (DE)', 12),
  ('462', 'Primark Opleiding brandopzichter (NL)', 12),
  ('473', 'Initiation des employés de Primark (FR)', 24),
  ('474', 'Formation d’agent de sécurité incendie de Primark (Belgique) (FR)', 12),
  (NULL, 'Primark Brandschutzhelfer-Kurs (Österreich) (DE)', 12),
  ('587', 'Formation d''agent de sécurité incendie (France) (FR)', 12),
  (NULL, 'Équipement de protection individuelle', 12),
  ('673', 'Primark Employee Induction (US)', 24),
  ('819', 'Emergency Procedures', 24),
  ('1743', 'Procedimientos de emergencia', 24),
  ('1755', 'Procédures d''urgence', 24),
  ('1765', 'NOODPROCEDURES', 24),
  ('1769', 'Procedimentos de Emergência', 24),
  (NULL, 'Workstation Safety 2.0', 12),
  ('1860', 'Procedure Di Emergenza', 24),
  (NULL, 'NOTFALL-PROZEDUREN', 24),
  ('1877', 'Baler Safety', 12),
  ('1878', 'Primark Fire Warden Training (US)', 12),
  ('2006', 'Primark Induzione EHS (IT)', 12),
  (NULL, 'Primark tečaj za uvajanje zaposlenih', 24),
  (NULL, 'Home Workstation Self Assessment', 12),
  (NULL, 'Home Safety Guide', 12),
  ('2371', 'Preventing Workplace Violence', 24),
  ('2379', 'Primark Night Shift Worker Training (IE)', 12),
  ('2470', 'Induction Positive Workplace: Preventing Harassment in the Workplace (2hr)', 12),
  (NULL, 'Part 1 - 2025 Annual Refresher Positive Workplace: Preventing Harassment in the Workplace', 12),
  (NULL, 'Part 2 - 2025 Annual Refresher Positive Workplace: Preventing Harassment in the Workplace', 12),
  (NULL, 'Part 3 - 2025 Annual Refresher Positive Workplace: Preventing Harassment in the Workplace', 12),
  ('2487', '2025 Annual Refresher Positive Workplace: Preventing Harassment in the Workplace (1hr)', 12),
  (NULL, 'Prevención de la violencia en el lugar de trabajo', 12),
  ('2509', 'Primark Manual Handling (IE)', 24),
  ('2520', '2026 Positive Workplace: Preventing Harassment in the Workplace (1hr)', 12),
  ('2521', '2026 Bystander Intervention (1hr)', 12),
  ('2522', '2026 Positive Workplace: Preventing Harassment in the Workplace (40min)', 12),
  (NULL, '2026 Positive Workplace: Preventing Harassment in the Workplace (2hr)', 12),
  ('2525', '2026 NY State Workplace Violence Prevention Training (1hr)', 12)
 ) AS expiry(source_course_id, title, validity_months)
 LOOP
  SELECT count(*), min(c.id) INTO matches, course_id
  FROM courses c
  WHERE (policy.source_course_id IS NOT NULL AND c.source_course_id=policy.source_course_id)
     OR (policy.source_course_id IS NULL AND lower(btrim(c.title))=lower(btrim(policy.title)));
  IF matches>1 THEN
   RAISE EXCEPTION 'Ambiguous course expiry match for %: % courses', policy.title, matches;
  ELSIF matches=0 THEN
   missing_count := missing_count+1;
   RAISE NOTICE 'Course expiry not applied: no existing match for % (source ID %)', policy.title, policy.source_course_id;
   CONTINUE;
  END IF;
  matched_count := matched_count+1;
  UPDATE courses SET validity_months=policy.validity_months, revision=revision+1, updated_at=changed_at
   WHERE id=course_id AND validity_months IS DISTINCT FROM policy.validity_months;
  GET DIAGNOSTICS changed = ROW_COUNT;
  updated_count := updated_count+changed;
 END LOOP;
 RAISE NOTICE 'Course expiry import: % matched, % updated, % unmatched of 52 source rows', matched_count, updated_count, missing_count;
END $$;
