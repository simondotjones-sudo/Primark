-- Credits begin at deployment. Existing access is retained without back-billing.
CREATE TABLE accounting_periods (
 id text PRIMARY KEY, year_label text NOT NULL, period_number integer NOT NULL CHECK(period_number BETWEEN 1 AND 13),
 starts_on date NOT NULL, ends_on date NOT NULL, CHECK(ends_on>=starts_on), UNIQUE(year_label,period_number)
);
INSERT INTO accounting_periods
 SELECT '2026-2027-P'||n,'2026/2027',n,DATE '2026-09-13'+(n-1)*28,
 DATE '2026-09-13'+n*28-1+CASE WHEN n=13 THEN 7 ELSE 0 END FROM generate_series(1,13) n;
CREATE TABLE credit_rates (
 id text PRIMARY KEY, effective_at timestamptz NOT NULL UNIQUE, cents integer NOT NULL CHECK(cents BETWEEN 0 AND 1000000),
 actor text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO credit_rates(id,effective_at,cents,actor) VALUES('initial','2026-09-13 00:00 Europe/London',325,'initial configuration');
CREATE TABLE store_credit_accounts (
 store_id text PRIMARY KEY, store_name text NOT NULL, country text NOT NULL, store_code text,
 balance integer NOT NULL DEFAULT 0, target integer NOT NULL CHECK(target>0),
 created_at timestamptz NOT NULL DEFAULT now(), active boolean NOT NULL DEFAULT true
);
CREATE TABLE assignment_history (
 id text PRIMARY KEY, learner_id text NOT NULL REFERENCES learners(id), course_id text NOT NULL REFERENCES courses(id),
 package_id text REFERENCES course_packages(id), course_title text NOT NULL, learner_name text NOT NULL,
 store_id text NOT NULL REFERENCES store_credit_accounts(store_id), country text NOT NULL,
 assigned_at timestamptz NOT NULL, assigned_by text NOT NULL, source text NOT NULL,
 billed boolean NOT NULL, unit_cents integer NOT NULL CHECK(unit_cents>=0),
 previous_id text REFERENCES assignment_history(id), started_at timestamptz, completed_at timestamptz,
 superseded_at timestamptz, cancelled_at timestamptz, cancelled_by text, cancellation_reason text,
 refunded boolean NOT NULL DEFAULT false, progress_snapshot jsonb NOT NULL DEFAULT '[]',
 CHECK(NOT refunded OR (billed AND cancelled_at IS NOT NULL AND started_at IS NULL AND completed_at IS NULL))
);
CREATE INDEX assignment_history_period ON assignment_history(assigned_at,store_id);
CREATE INDEX assignment_history_store ON assignment_history(store_id,learner_id,assigned_at DESC);
CREATE INDEX assignment_history_refunds ON assignment_history(cancelled_at,store_id) WHERE refunded;
ALTER TABLE course_assignments ADD COLUMN history_id text REFERENCES assignment_history(id);
CREATE UNIQUE INDEX course_assignment_current_history ON course_assignments(history_id);
ALTER TABLE scorm_launches ADD COLUMN assignment_id text REFERENCES assignment_history(id);
CREATE TABLE assignment_exclusions (
 learner_id text NOT NULL REFERENCES learners(id), course_id text NOT NULL REFERENCES courses(id),
 PRIMARY KEY(learner_id,course_id)
);
CREATE TABLE credit_ledger (
 id text PRIMARY KEY, store_id text NOT NULL REFERENCES store_credit_accounts(store_id),
 kind text NOT NULL CHECK(kind IN ('opening','period_topup','assignment','refund','manual_topup')),
 credits integer NOT NULL, value_cents integer NOT NULL DEFAULT 0,
 assignment_id text REFERENCES assignment_history(id), period_id text REFERENCES accounting_periods(id),
 recorded_at timestamptz NOT NULL, actor text NOT NULL, note text NOT NULL DEFAULT '',
 UNIQUE(assignment_id,kind)
);
CREATE UNIQUE INDEX credit_opening_once ON credit_ledger(store_id) WHERE kind='opening';
CREATE UNIQUE INDEX credit_period_once ON credit_ledger(store_id,period_id) WHERE kind='period_topup';
CREATE INDEX credit_ledger_period ON credit_ledger(recorded_at,store_id);

-- Retain every issued certificate, including previous and removed attempts.
ALTER TABLE certificates ADD COLUMN assignment_id text REFERENCES assignment_history(id);
ALTER TABLE certificates ADD COLUMN archived_at timestamptz;
ALTER TABLE certificates ADD COLUMN cancelled_at timestamptz;
ALTER TABLE certificates DROP CONSTRAINT certificates_learner_id_package_id_key;
CREATE UNIQUE INDEX certificates_current_package ON certificates(learner_id,package_id) WHERE archived_at IS NULL;

CREATE FUNCTION ensure_store_credits(sid text,sname text,scountry text,scode text DEFAULT NULL,at_time timestamptz DEFAULT now()) RETURNS void LANGUAGE plpgsql AS $$
DECLARE allowance integer:=CASE WHEN lower(scountry) IN ('united states','usa','us','united states of america') THEN 300 ELSE 100 END; made integer;
BEGIN
 INSERT INTO store_credit_accounts(store_id,store_name,country,store_code,balance,target,created_at)
 VALUES(sid,sname,scountry,scode,allowance,allowance,at_time) ON CONFLICT(store_id) DO NOTHING;
 GET DIAGNOSTICS made=ROW_COUNT;
 IF made=1 THEN
  INSERT INTO credit_ledger(id,store_id,kind,credits,recorded_at,actor) VALUES(gen_random_uuid()::text,sid,'opening',allowance,at_time,'store setup');
 END IF;
END $$;

CREATE FUNCTION topup_store_credits(sid text,at_time timestamptz DEFAULT now()) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE account store_credit_accounts%ROWTYPE; p accounting_periods%ROWTYPE; amount integer; total integer:=0;
BEGIN
 SELECT * INTO account FROM store_credit_accounts WHERE store_id=sid FOR UPDATE;
 IF NOT FOUND OR NOT account.active THEN RETURN 0; END IF;
 -- Retry-safe, date-based catch-up. Week 53 belongs to P13; no extra top-up.
 FOR p IN SELECT * FROM accounting_periods WHERE starts_on <= (at_time AT TIME ZONE 'Europe/London')::date
  AND starts_on::timestamp AT TIME ZONE 'Europe/London' > account.created_at
  ORDER BY starts_on LOOP
  IF NOT EXISTS(SELECT 1 FROM credit_ledger WHERE store_id=sid AND period_id=p.id AND kind='period_topup') THEN
   amount:=greatest(0,account.target-account.balance);
   INSERT INTO credit_ledger(id,store_id,kind,credits,period_id,recorded_at,actor)
    VALUES(gen_random_uuid()::text,sid,'period_topup',amount,p.id,p.starts_on::timestamp AT TIME ZONE 'Europe/London','scheduled top-up');
   account.balance:=account.balance+amount;
   UPDATE store_credit_accounts SET balance=account.balance WHERE store_id=sid;
   total:=total+amount;
  END IF;
 END LOOP;
 RETURN total;
END $$;

CREATE FUNCTION assign_credit_course(person_id text,cid text,actor text,at_time timestamptz DEFAULT now(),renew boolean DEFAULT false,bill_new boolean DEFAULT true,origin text DEFAULT 'manual') RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE person learners%ROWTYPE; c courses%ROWTYPE; current_row course_assignments%ROWTYPE;
 old assignment_history%ROWTYPE; aid text:=gen_random_uuid()::text; amount integer; assignment_date timestamptz:=at_time;
 charging boolean:=bill_new; cert certificates%ROWTYPE; evidence jsonb; stamp text;
BEGIN
 SELECT * INTO person FROM learners WHERE id=person_id FOR UPDATE;
 IF NOT FOUND OR person.archived_at IS NOT NULL OR EXISTS(SELECT 1 FROM platform_admins WHERE learner_id=person_id)
  OR EXISTS(SELECT 1 FROM reporting_access WHERE learner_id=person_id) OR EXISTS(SELECT 1 FROM store_managers WHERE learner_id=person_id) THEN RETURN false; END IF;
 SELECT * INTO c FROM courses WHERE id=cid;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO current_row FROM course_assignments WHERE learner_id=person_id AND course_id=cid;
 IF current_row.history_id IS NOT NULL AND NOT renew THEN RETURN false; END IF;
 IF renew THEN
  SELECT * INTO old FROM assignment_history WHERE id=current_row.history_id;
  SELECT * INTO cert FROM certificates WHERE learner_id=person_id AND course_id=cid AND archived_at IS NULL ORDER BY completed_at DESC LIMIT 1;
  IF old.id IS NULL OR cert.expires_at IS NULL OR cert.expires_at::timestamptz>at_time THEN RAISE EXCEPTION 'Only an expired assignment can be renewed.' USING ERRCODE='P0001'; END IF;
 END IF;
 IF current_row.learner_id IS NOT NULL AND current_row.history_id IS NULL THEN
  assignment_date:=current_row.assigned_at::timestamptz; charging:=false; actor:=current_row.assigned_by; origin:='manual';
 ELSIF NOT charging THEN
  SELECT i.assigned_at INTO stamp FROM learner_inductions i WHERE i.learner_id=person_id AND i.course_id=cid;
  IF stamp IS NOT NULL THEN assignment_date:=stamp::timestamptz; END IF;
 END IF;
 IF charging AND (c.status<>'published' OR NOT EXISTS(SELECT 1 FROM course_packages WHERE id=c.package_id AND status='ready')) THEN RETURN false; END IF;
 PERFORM ensure_store_credits(person.store_id,person.store_id,person.country);
 PERFORM topup_store_credits(person.store_id,at_time);
 PERFORM 1 FROM store_credit_accounts WHERE store_id=person.store_id FOR UPDATE;
 SELECT cents INTO amount FROM credit_rates WHERE effective_at<=at_time ORDER BY effective_at DESC LIMIT 1;
 IF charging AND amount IS NULL THEN RAISE EXCEPTION 'No credit price is configured for this date.'; END IF;
 IF charging AND (SELECT balance FROM store_credit_accounts WHERE store_id=person.store_id)<1 THEN
  RAISE EXCEPTION 'This store has no credits available. Contact a platform admin for a top-up.';
 END IF;
 stamp:=to_char(assignment_date AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 IF renew THEN
  SELECT COALESCE(jsonb_agg(to_jsonb(s)),'[]') INTO evidence FROM scorm_progress s JOIN course_packages p ON p.id=s.package_id WHERE s.learner_id=person_id AND p.course_id=cid;
  UPDATE assignment_history SET progress_snapshot=evidence,superseded_at=at_time WHERE id=old.id;
  UPDATE certificates SET archived_at=at_time WHERE learner_id=person_id AND course_id=cid AND archived_at IS NULL;
  DELETE FROM scorm_launches WHERE learner_id=person_id AND course_id=cid;
  DELETE FROM scorm_progress WHERE learner_id=person_id AND package_id IN (SELECT id FROM course_packages WHERE course_id=cid);
 END IF;
 INSERT INTO assignment_history(id,learner_id,course_id,package_id,course_title,learner_name,store_id,country,assigned_at,assigned_by,source,billed,unit_cents,previous_id)
 VALUES(aid,person_id,cid,c.package_id,c.title,person.name,person.store_id,person.country,assignment_date,actor,origin,charging,COALESCE(amount,0),old.id);
 IF NOT charging THEN
  UPDATE assignment_history SET started_at=(SELECT min(updated_at::timestamptz) FROM scorm_progress WHERE learner_id=person_id AND package_id=c.package_id),
   completed_at=(SELECT max(completed_at::timestamptz) FROM certificates WHERE learner_id=person_id AND course_id=cid AND archived_at IS NULL) WHERE id=aid;
 END IF;
 INSERT INTO course_assignments(learner_id,course_id,assigned_by,assigned_at,history_id) VALUES(person_id,cid,actor,stamp,aid)
 ON CONFLICT(learner_id,course_id) DO UPDATE SET history_id=excluded.history_id,assigned_by=excluded.assigned_by,assigned_at=excluded.assigned_at;
 DELETE FROM assignment_exclusions WHERE learner_id=person_id AND course_id=cid;
 UPDATE certificates SET assignment_id=aid WHERE learner_id=person_id AND course_id=cid AND assignment_id IS NULL AND archived_at IS NULL;
 IF charging THEN
  UPDATE store_credit_accounts SET balance=balance-1 WHERE store_id=person.store_id;
  INSERT INTO credit_ledger(id,store_id,kind,credits,value_cents,assignment_id,recorded_at,actor)
   VALUES(gen_random_uuid()::text,person.store_id,'assignment',-1,amount,aid,assignment_date,actor);
 END IF;
 RETURN true;
END $$;

-- Pin induction and materialise audience grants. Exclusions survive subsequent reads/publications.
CREATE FUNCTION sync_credit_assignments(person_id text DEFAULT NULL,bill_new boolean DEFAULT true) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE person learners%ROWTYPE; cid text; induction text; n integer:=0;
BEGIN
 -- Lock the full learner set before touching shared store balances. Bulk publication
 -- and manual assignment then use the same lock order as single assignments.
 PERFORM 1 FROM learners l WHERE (person_id IS NULL OR l.id=person_id) AND l.archived_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM platform_admins WHERE learner_id=l.id) AND NOT EXISTS(SELECT 1 FROM reporting_access WHERE learner_id=l.id)
  AND NOT EXISTS(SELECT 1 FROM store_managers WHERE learner_id=l.id) ORDER BY l.id FOR UPDATE;
 FOR person IN SELECT l.* FROM learners l WHERE (person_id IS NULL OR l.id=person_id) AND l.archived_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM platform_admins WHERE learner_id=l.id) AND NOT EXISTS(SELECT 1 FROM reporting_access WHERE learner_id=l.id)
  AND NOT EXISTS(SELECT 1 FROM store_managers WHERE learner_id=l.id) ORDER BY l.id LOOP
  PERFORM 1 FROM learners WHERE id=person.id FOR UPDATE;
  induction:=NULL;
  IF person.induction_enrolled THEN
   SELECT course_id INTO induction FROM learner_inductions WHERE learner_id=person.id;
   IF induction IS NULL THEN
    SELECT c.id INTO induction FROM courses c JOIN course_packages p ON p.id=c.package_id AND p.status='ready'
    WHERE c.status='published' AND ((c.induction_role='country' AND jsonb_exists(c.available_countries_json::jsonb,person.country)) OR (c.induction_role='default' AND c.language_code='en'))
    ORDER BY (c.induction_role='country') DESC,c.updated_at DESC,c.id LIMIT 1;
    IF induction IS NOT NULL THEN INSERT INTO learner_inductions VALUES(person.id,induction,to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ON CONFLICT DO NOTHING; END IF;
   END IF;
  END IF;
  FOR cid IN SELECT c.id FROM courses c WHERE EXISTS(SELECT 1 FROM course_assignments a WHERE a.learner_id=person.id AND a.course_id=c.id AND a.history_id IS NULL)
   OR (c.status='published' AND EXISTS(SELECT 1 FROM course_packages p WHERE p.id=c.package_id AND p.status='ready')
    AND (c.id=induction OR ((NOT person.induction_enrolled OR c.induction_role='none') AND
      (jsonb_exists(c.audience_json::jsonb->'countries',person.country) OR jsonb_exists(c.audience_json::jsonb->'sites',person.store_id) OR jsonb_exists(c.audience_json::jsonb->'users',person.id))))
    AND NOT EXISTS(SELECT 1 FROM assignment_exclusions e WHERE e.learner_id=person.id AND e.course_id=c.id)) ORDER BY c.id LOOP
   IF assign_credit_course(person.id,cid,'automatic assignment',now(),false,bill_new,'automatic') THEN n:=n+1; END IF;
  END LOOP;
 END LOOP;
 RETURN n;
END $$;

CREATE FUNCTION cancel_credit_assignment(aid text,actor text,reason text,at_time timestamptz DEFAULT now()) RETURNS jsonb LANGUAGE plpgsql AS $$
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
 refund:=a.billed AND a.started_at IS NULL AND a.completed_at IS NULL;
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

CREATE OR REPLACE FUNCTION issue_course_certificate(person_id text,pack_id text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO certificates(token,learner_id,course_id,package_id,course_revision,course_title,language_code,learner_name,store_id,country,completed_at,validity_months,expires_at,issued_at,assignment_id)
 SELECT replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),l.id,c.id,p.id,c.revision,c.title,c.language_code,l.name,l.store_id,l.country,
 evidence.completed_at,c.validity_months,CASE WHEN c.validity_months IS NOT NULL THEN to_char((evidence.completed_at::timestamptz AT TIME ZONE 'UTC')+make_interval(months=>c.validity_months),'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
 to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),a.history_id
 FROM learners l JOIN course_packages p ON p.id=pack_id AND p.status='ready' JOIN courses c ON c.id=p.course_id
 LEFT JOIN course_assignments a ON a.learner_id=l.id AND a.course_id=c.id
 CROSS JOIN LATERAL (SELECT max(s.completed_at) AS completed_at,bool_and(s.status IN ('completed','passed') AND s.completed_at IS NOT NULL) AS complete,count(s.sco_id) AS saved_count
 FROM jsonb_array_elements(p.scos_json::jsonb) item LEFT JOIN scorm_progress s ON s.learner_id=l.id AND s.package_id=p.id AND s.sco_id=item->>'id') evidence
 WHERE l.id=person_id AND jsonb_array_length(p.scos_json::jsonb)>0 AND evidence.complete AND evidence.saved_count=jsonb_array_length(p.scos_json::jsonb) AND evidence.completed_at IS NOT NULL
 ON CONFLICT(learner_id,package_id) WHERE archived_at IS NULL DO NOTHING;
 UPDATE assignment_history h SET completed_at=COALESCE(h.completed_at,c.completed_at::timestamptz)
 FROM certificates c WHERE c.assignment_id=h.id AND c.learner_id=person_id AND c.package_id=pack_id AND c.archived_at IS NULL;
END $$;

-- Baseline directory is authoritative for stores with no learner activity.
SELECT ensure_store_credits(s.id,s.name,s.country) FROM (VALUES
('gerasdorf-vienna-7db91dd','Gerasdorf (Vienna)','Austria'),
('graz-37700a2','Graz','Austria'),
('innsbrusk-4804bad','Innsbrusk','Austria'),
('linz-pasching-c0f5f43','Linz / Pasching','Austria'),
('vienna-scs-1d7441c','Vienna SCS','Austria'),
('city-centre-bahrain-8eb7964','City Centre Bahrain','Bahrain'),
('antwerp-953223e','Antwerp','Belgium'),
('brussels-rue-nueve-8e85672','Brussels - Rue Nueve','Belgium'),
('charleroi-3daf3c6','Charleroi','Belgium'),
('chaussee-d-ixelles-a701f14','Chaussee D''Ixelles','Belgium'),
('ghent-92acb1c','Ghent','Belgium'),
('hasselt-5114ae0','Hasselt','Belgium'),
('mons-ca4fd49','Mons','Belgium'),
('prague-metropole-zlicin-fa8f2e0','Prague, Metropole Zlicin','Czech Republic'),
('primark-olympia-brno-modrice-24a74a4','Primark Olympia Brno, Modrice','Czech Republic'),
('primark-ostrava-3c59c67','Primark Ostrava','Czech Republic'),
('primark-wenceslas-square-prague-2ec1a4c','Primark Wenceslas Square, Prague','Czech Republic'),
('angers-b0a417c','Angers','France'),
('bordeaux-e7ac871','Bordeaux','France'),
('brest-f1a5053','Brest','France'),
('caen-mondeville-4819f39','Caen Mondeville','France'),
('cagnes-sur-mer-nice-f36e18a','Cagnes-sur-Mer (Nice)','France'),
('coquelles-c8ffb03','Coquelles','France'),
('creteil-76c4605','Creteil','France'),
('dijon-65eced4','Dijon','France'),
('evry-77baae1','Évry','France'),
('grenoble-6bdca8c','Grenoble','France'),
('la-valette-du-var-toulon-79ab651','La Valette du Var (Toulon)','France'),
('le-havre-4d35e85','Le Havre','France'),
('lille-cd0ade5','Lille','France'),
('lyon-e57a12d','Lyon','France'),
('marseille-grand-littoral-cc6ee52','Marseille - Grand Littoral','France'),
('metz-c377ef5','Metz','France'),
('montpellier-c91471b','Montpellier','France'),
('mulhouse-porte-jeune-08b4a65','Mulhouse, Porte Jeune','France'),
('nantes-f509dc1','Nantes','France'),
('noyelles-88c7719','Noyelles','France'),
('o-parinor-cd227da','O''Parinor','France'),
('plaisir-e001491','Plaisir','France'),
('primark-belle-epine-25aa6fd','Primark Belle Epine','France'),
('rouen-saint-sever-shopping-centre-31c402b','Rouen, Saint-Sever Shopping Centre','France'),
('st-etienne-fe26eb1','St-Etienne','France'),
('strasbourg-b2461fe','Strasbourg','France'),
('toulouse-77a42fc','Toulouse','France'),
('tours-l-heure-tranquille-shopping-c-5770e1d','Tours, L''Heure Tranquille Shopping Centre','France'),
('val-d-europe-36636b4','Val d''Europe','France'),
('villeneuve-la-garenne-6e408aa','Villeneuve La Garenne','France'),
('berlin-ap-d7ace81','Berlin AP','Germany'),
('berlin-gropius-c477443','Berlin Gropius','Germany'),
('berlin-zoom-22d8bbc','Berlin ZOOM','Germany'),
('bielefeld-5deb715','Bielefeld','Germany'),
('bonn-2b60c1b','Bonn','Germany'),
('braunschweig-a662c50','Braunschweig','Germany'),
('bremen-7b30615','Bremen','Germany'),
('cologne-392d96b','Cologne','Germany'),
('dortmund-077d235','Dortmund','Germany'),
('dresden-34d4887','Dresden','Germany'),
('essen-3f976c6','Essen','Germany'),
('frankfurt-nwz-b9d6036','Frankfurt NWZ','Germany'),
('frankfurt-zeil-3c1460f','Frankfurt Zeil','Germany'),
('hamburg-dcde4f7','Hamburg','Germany'),
('hannover-e268386','Hannover','Germany'),
('ingolstadt-c464a6e','Ingolstadt','Germany'),
('karlsruhe-16311ce','Karlsruhe','Germany'),
('kiel-ab26a85','Kiel','Germany'),
('leipzig-c2de614','Leipzig','Germany'),
('mannheim-3db8862','Mannheim','Germany'),
('munich-3fd5cce','Munich','Germany'),
('munster-8862862','Münster','Germany'),
('regensburg-8d00595','Regensburg','Germany'),
('rostock-ostsee-park-5aff780','Rostock (Ostsee Park)','Germany'),
('saarbrucken-73812ca','Saarbrucken','Germany'),
('stuttgart-konigstrasse-1310941','Stuttgart Konigstrasse','Germany'),
('stuttgart-milaneo-eafba9e','Stuttgart Milaneo','Germany'),
('wuppertal-b2a9c0a','Wuppertal','Germany'),
('arena-mall-budapest-east-bcadb4f','Arena Mall, Budapest East','Hungary'),
('arese-35c1ca4','Arese','Italy'),
('bari-casamassima-717d335','Bari Casamassima','Italy'),
('biella-gli-orsi-31277c5','Biella, Gli Orsi','Italy'),
('bologna-7b11190','Bologna','Italy'),
('brescia-aecf918','Brescia','Italy'),
('campi-bisenzio-florence-7a26297','Campi Bisenzio / Florence','Italy'),
('caserta-campania-0e92058','Caserta Campania','Italy'),
('catania-centro-900219d','Catania Centro','Italy'),
('chieti-megalo-435ccd6','Chieti - Megalò','Italy'),
('cosenza-82a51d4','Cosenza','Italy'),
('cremona-po-c3cb830','Cremona Po','Italy'),
('fiordaliso-ba16126','Fiordaliso','Italy'),
('livorno-porto-a-mare-486c63a','Livorno, Porto a Mare','Italy'),
('milan-via-torino-1f4c1c6','Milan via Torino','Italy'),
('naples-grande-sud-fdac0e4','Naples Grande Sud','Italy'),
('naples-la-cartiera-836027b','Naples La Cartiera','Italy'),
('parma-promenade-5145cd0','Parma Promenade','Italy'),
('pontecagnano-salerno-45012d3','Pontecagnano, Salerno','Italy'),
('roma-est-218cc6e','Roma Est','Italy'),
('roma-maximo-7328484','Roma Maximo','Italy'),
('turin-le-gru-a7adb73','Turin Le Gru','Italy'),
('turin-to-dream-b14aa06','Turin to Dream','Italy'),
('venice-576f8c1','Venice','Italy'),
('verona-0045308','Verona','Italy'),
('the-avenues-kuwait-47893c0','The Avenues Kuwait','Kuwait'),
('almere-e2a95aa','Almere','Netherlands'),
('amsterdam-damrak-f37510e','Amsterdam Damrak','Netherlands'),
('arnhem-2e6a2e1','Arnhem','Netherlands'),
('eindhoven-5ec9757','Eindhoven','Netherlands'),
('enschede-92556f0','Enschede','Netherlands'),
('groningen-577a490','Groningen','Netherlands'),
('hilversum-f491244','Hilversum','Netherlands'),
('hoofddorp-0d8550e','Hoofddorp','Netherlands'),
('nijmegen-8e7b848','Nijmegen','Netherlands'),
('rotterdam-401fdfa','Rotterdam','Netherlands'),
('rotterdam-forum-2942026','Rotterdam Forum','Netherlands'),
('rotterdam-zuid-d5bf61f','Rotterdam Zuid','Netherlands'),
('the-hague-654bf7b','The Hague','Netherlands'),
('tilburg-83eedc9','Tilburg','Netherlands'),
('utrecht-dba5d96','Utrecht','Netherlands'),
('venlo-3588d8f','Venlo','Netherlands'),
('zaandam-a91e51e','Zaandam','Netherlands'),
('zoetermeer-3cbcb1c','Zoetermeer','Netherlands'),
('zwolle-48c1bc9','Zwolle','Netherlands'),
('bydgoszcz-zielone-arkady-8601a54','Bydgoszcz – Zielone Arkady','Poland'),
('katowice-c1e5fad','Katowice','Poland'),
('koszalin-forum-s-c-8e76135','Koszalin Forum S.C','Poland'),
('krakow-bonarka-6525460','Krakow Bonarka','Poland'),
('lublin-felicity-850f98d','Lublin, Felicity','Poland'),
('manufaktura-shopping-centre-lodz-6f98558','Manufaktura Shopping Centre, Lodz','Poland'),
('primark-galeria-mociny-warsaw-2af694b','Primark Galeria Młociny, Warsaw','Poland'),
('primark-magnolia-park-sc-wroclaw-d03d4bc','Primark Magnolia Park SC, Wroclaw','Poland'),
('primark-posnania-mall-poznan-115fe4d','Primark Posnania Mall, Poznan','Poland'),
('almada-forum-lisbon-81a1a92','Almada Forum Lisbon','Portugal'),
('braga-parque-52e0da8','Braga Parque','Portugal'),
('castelo-branco-7f266f4','Castelo Branco','Portugal'),
('coimbra-77d1455','Coimbra','Portugal'),
('colombo-d55a962','Colombo','Portugal'),
('guimaraes-4277484','Guimaraes','Portugal'),
('lisbon-dolce-vita-ubbo-cd3e24d','Lisbon Dolce Vita / UBBO','Portugal'),
('loule-centro-comercial-mar-shopping-713eff4','Loule / Centro Comercial MAR Shopping','Portugal'),
('montijo-98d1de9','Montijo','Portugal'),
('portimao-aqua-45af91b','Portimao (Aqua)','Portugal'),
('porto-norteshopping-05f55d7','Porto Norteshopping','Portugal'),
('porto-parque-nascente-aafd613','Porto Parque Nascente','Portugal'),
('setubal-86fa585','Setúbal','Portugal'),
('sintra-lisbon-bc15447','Sintra (Lisbon)','Portugal'),
('viseu-418e6f6','Viseu','Portugal'),
('artane-0d4559d','Artane','Ireland'),
('athlone-b48226f','Athlone','Ireland'),
('ballina-aed7e0c','Ballina','Ireland'),
('blanchardstown-087d73a','Blanchardstown','Ireland'),
('bray-706fab7','Bray','Ireland'),
('carlow-fd01297','Carlow','Ireland'),
('castlebar-6369767','Castlebar','Ireland'),
('clonmel-8a60462','Clonmel','Ireland'),
('cork-patrick-st-8be0902','Cork - Patrick St','Ireland'),
('cork-wilton-3d0e5ac','Cork - Wilton','Ireland'),
('dooradoyle-d6af39e','Dooradoyle','Ireland'),
('drogheda-3b5a9ba','Drogheda','Ireland'),
('dun-laoghaire-bb7fdab','Dun Laoghaire','Ireland'),
('dundrum-99af11f','Dundrum','Ireland'),
('ennis-95b1466','Ennis','Ireland'),
('galway-95f588f','Galway','Ireland'),
('galway-eyre-square-0c30797','Galway - Eyre Square','Ireland'),
('kilkenny-b0c36f1','Kilkenny','Ireland'),
('killarney-9d79413','Killarney','Ireland'),
('letterkenny-b081159','Letterkenny','Ireland'),
('liffey-valley-14d8928','Liffey Valley','Ireland'),
('limerick-ab06bcd','Limerick','Ireland'),
('longford-71d1ecf','Longford','Ireland'),
('mary-st-973407b','Mary St','Ireland'),
('mullingar-686b614','Mullingar','Ireland'),
('navan-9606ede','Navan','Ireland'),
('newbridge-d23e7ed','Newbridge','Ireland'),
('nutgrove-d1b2542','Nutgrove','Ireland'),
('o-connell-st-15f3b41','O''Connell St','Ireland'),
('portlaoise-108f11b','Portlaoise','Ireland'),
('santry-2a08553','Santry','Ireland'),
('sligo-1386475','Sligo','Ireland'),
('swords-d25d2a4','Swords','Ireland'),
('tallaght-070a459','Tallaght','Ireland'),
('tralee-aac7033','Tralee','Ireland'),
('waterford-5606f98','Waterford','Ireland'),
('wexford-b785abc','Wexford','Ireland'),
('bucharest-afi-8d16eb1','Bucharest AFI','Romania'),
('cluj-napoca-a87fdb8','Cluj-Napoca','Romania'),
('craiova-electroputere-mall-445b53c','Craiova - Electroputere Mall','Romania'),
('iasi-palas-cf2385b','Iasi, Palas','Romania'),
('park-lake-65c90a0','Park Lake','Romania'),
('sibiu-shopping-centre-1bed359','Sibiu Shopping Centre','Romania'),
('timisoara-255a7c1','Timisoara','Romania'),
('bratislava-7039738','Bratislava','Slovakia'),
('ljubljana-5cc9fb5','Ljubljana','Slovenia'),
('albacete-0582734','Albacete','Spain'),
('alcala-magna-89cbb51','Alcalá Magna','Spain'),
('alicante-d51528f','Alicante','Spain'),
('algeciras-4145386','Algeciras','Spain'),
('almeria-torrecardenas-e0c2893','Almeria Torrecardenas','Spain'),
('badajoz-53d2a28','Badajoz','Spain'),
('barcelona-l-illa-422f9be','Barcelona L''Illa','Spain'),
('barcelona-plaza-catalunya-79694ab','Barcelona Plaza Catalunya','Spain'),
('barcelona-sant-cugat-4974a08','Barcelona Sant Cugat','Spain'),
('bilbao-ballonti-b537796','Bilbao Ballonti','Spain'),
('bilbao-gran-via-4157431','Bilbao Gran Via','Spain'),
('cartagena-espacio-med-a02d54e','Cartagena Espacio Med','Spain'),
('castellon-178463a','Castellon','Spain'),
('conde-de-penalver-madrid-50bfcb0','Conde de Peñalver, Madrid','Spain'),
('cordoba-el-arcangel-8c080bf','Cordoba (El Arcangel)','Spain'),
('cornella-c20c985','Cornella','Spain'),
('diagonal-mar-barcelona-3bf6a3b','Diagonal Mar - Barcelona','Spain'),
('elche-249d1b6','Elche','Spain'),
('espacio-leon-c3bb5d0','Espacio Leon','Spain'),
('fuengirola-parque-miramar-d9d8e24','Fuengirola Parque Miramar','Spain'),
('girona-espai-girones-a98d5fb','Girona - Espai Girones','Spain'),
('gran-via-89f4896','Gran Via','Spain'),
('granada-dd30045','Granada','Spain'),
('huelva-holea-0cfa1ff','Huelva Holea','Spain'),
('islazul-d16fafd','Islazul','Spain'),
('jaen-plaza-ea6e4b0','Jaen Plaza','Spain'),
('jerez-c20c9a6','Jerez','Spain'),
('la-vaguada-16ef910','La Vaguada','Spain'),
('lanzarote-7147e7e','Lanzarote','Spain'),
('logrono-el-berceo-d5cb31d','Logrono - El Berceo','Spain'),
('lorca-4769379','Lorca','Spain'),
('lugo-d0eddaf','Lugo','Spain'),
('madrid-la-gavia-d16a375','Madrid La Gavia','Spain'),
('madrid-rivas-6598e5a','Madrid Rivas','Spain'),
('majadahonda-ec66205','Majadahonda','Spain'),
('malaga-larios-5aa0288','Malaga / Larios','Spain'),
('marbella-la-canada-1eaec29','Marbella La Cañada','Spain'),
('marineda-la-coruna-a5fddd7','Marineda (La Coruna)','Spain'),
('melilla-d67697c','Melilla','Spain'),
('murcia-fbfb6ae','Murcia','Spain'),
('orihuela-la-zenia-0c720f8','Orihuela La Zenia','Spain'),
('oviedo-parque-principado-c880007','Oviedo - Parque Principado','Spain'),
('palma-fan-mallorca-194ffec','Palma FAN Mallorca','Spain'),
('pamplona-la-morea-df1e9fd','Pamplona La Morea','Spain'),
('parque-corredor-af249c1','Parque Corredor','Spain'),
('parque-sur-d7f7cb0','Parque Sur','Spain'),
('plenilunio-4ac33c5','Plenilunio','Spain'),
('roquetas-de-mar-2f9dc16','Roquetas de Mar','Spain'),
('san-fernando-bahia-sur-22d5a27','San Fernando - Bahia Sur','Spain'),
('san-sebastian-donostia-garbera-ca34f9a','San Sebastian Donostia - Garbera','Spain'),
('santander-valle-real-c4b9b42','Santander Valle Real','Spain'),
('santiago-de-compostela-e7f25b6','Santiago de Compostela','Spain'),
('sevilla-lagoh-5db6e0d','Sevilla - Lagoh','Spain'),
('sevilla-torre-sevilla-39d2b10','Sevilla - Torre Sevilla','Spain'),
('talavera-bf0866e','Talavera','Spain'),
('tarragona-70db3ef','Tarragona','Spain'),
('tenerife-meridiano-67f9246','Tenerife Meridiano','Spain'),
('toledo-d826cc5','Toledo','Spain'),
('valencia-bonaire-790dc64','Valencia - Bonaire','Spain'),
('valencia-ruzafa-0f1b66c','Valencia - Ruzafa','Spain'),
('valladolid-rio-shopping-6215258','Valladolid Rio Shopping','Spain'),
('vigo-vialia-5c45928','Vigo Vialia','Spain'),
('vitoria-ef4a29a','Vitoria','Spain'),
('xanadu-madrid-3afa742','Xanadu (Madrid)','Spain'),
('zaragoza-gran-casa-9476adb','Zaragoza Gran Casa','Spain'),
('zaragoza-puerto-venecia-434c0ed','Zaragoza Puerto Venecia','Spain'),
('dubai-mall-336e8f8','Dubai Mall','UAE'),
('dubai-mirdif-6789c5e','Dubai Mirdif','UAE'),
('mall-of-emirates-8ff2bb9','Mall of Emirates','UAE'),
('aberdeen-17d7ae2','Aberdeen','United Kingdom'),
('argyle-street-glasgow-f6d5fc6','Argyle Street Glasgow','United Kingdom'),
('ayr-cbc4969','AYR','United Kingdom'),
('banbury-3967a3f','Banbury','United Kingdom'),
('barnsley-5e15717','Barnsley','United Kingdom'),
('barnstaple-eba0034','Barnstaple','United Kingdom'),
('basildon-4f02a00','Basildon','United Kingdom'),
('bath-d54a476','Bath','United Kingdom'),
('basingstoke-47033b5','Basingstoke','United Kingdom'),
('bedford-716f10d','Bedford','United Kingdom'),
('belfast-2c6b1e2','Belfast','United Kingdom'),
('belfast-bank-buildings-6053f7b','Belfast Bank Buildings','United Kingdom'),
('bexleyheath-10f6150','Bexleyheath','United Kingdom'),
('birmingham-3fd2060','Birmingham','United Kingdom'),
('birmingham-fort-1ff8926','Birmingham Fort','United Kingdom'),
('birkenhead-f6b5cc5','Birkenhead','United Kingdom'),
('blackburn-50c0b09','Blackburn','United Kingdom'),
('blackpool-df69beb','Blackpool','United Kingdom'),
('bluewater-4f43f22','Bluewater','United Kingdom'),
('bolton-47117cd','Bolton','United Kingdom'),
('bournemouth-8228d84','Bournemouth','United Kingdom'),
('boscombe-a69e126','Boscombe','United Kingdom'),
('bradford-7774737','Bradford','United Kingdom'),
('bracknell-fbe98a4','Bracknell','United Kingdom'),
('bristol-416e169','Bristol','United Kingdom'),
('broughton-park-eb0aba6','Broughton Park','United Kingdom'),
('burnley-44fbe86','Burnley','United Kingdom'),
('bury-6234f38','Bury','United Kingdom'),
('bury-st-edmunds-2b6e65b','Bury St Edmunds','United Kingdom'),
('camberley-ee09cd3','Camberley','United Kingdom'),
('cambridge-cee48c6','Cambridge','United Kingdom'),
('canterbury-1300e88','Canterbury','United Kingdom'),
('cardiff-4931ead','Cardiff','United Kingdom'),
('carlisle-a5fca49','Carlisle','United Kingdom'),
('charlton-brocklebank-fcd5c5c','Charlton / Brocklebank','United Kingdom'),
('chelmsford-d005673','Chelmsford','United Kingdom'),
('cheltenham-d8868e1','Cheltenham','United Kingdom'),
('chester-abb9ca4','Chester','United Kingdom'),
('chesterfield-f7af827','Chesterfield','United Kingdom'),
('chatham-18098ae','Chatham','United Kingdom'),
('colchester-5b6ef7d','Colchester','United Kingdom'),
('corby-878d7dc','Corby','United Kingdom'),
('coventry-34350e1','Coventry','United Kingdom'),
('craigavon-910f705','Craigavon','United Kingdom'),
('crawley-cd4b0dc','Crawley','United Kingdom'),
('croydon-543b06b','Croydon','United Kingdom'),
('cwmbran-36a50e4','Cwmbran','United Kingdom'),
('darlington-549297f','Darlington','United Kingdom'),
('derby-932be2a','Derby','United Kingdom'),
('derry-781449e','Derry','United Kingdom'),
('doncaster-bf9c724','Doncaster','United Kingdom'),
('dundee-cbe8368','Dundee','United Kingdom'),
('dunfermline-126985b','Dunfermline','United Kingdom'),
('ealing-54d3dc0','Ealing','United Kingdom'),
('east-ham-d5e5f8b','East Ham','United Kingdom'),
('east-kilbride-5211d7a','East Kilbride','United Kingdom'),
('eastbourne-841938f','Eastbourne','United Kingdom'),
('edinburgh-3919405','Edinburgh','United Kingdom'),
('epsom-8a26861','Epsom','United Kingdom'),
('exeter-c03aca6','Exeter','United Kingdom'),
('folkestone-b1445a0','Folkestone','United Kingdom'),
('fort-kinnaird-b617bd8','Fort Kinnaird','United Kingdom'),
('fosse-park-93d2ca7','Fosse Park','United Kingdom'),
('glasgow-fort-a04d1f8','Glasgow Fort','United Kingdom'),
('gloucester-2acc2f2','Gloucester','United Kingdom'),
('gravesend-d538049','Gravesend','United Kingdom'),
('greenock-6a64784','Greenock','United Kingdom'),
('grimsby-c1f05b5','Grimsby','United Kingdom'),
('guildford-ed9af1b','Guildford','United Kingdom'),
('hackney-d6e34f4','Hackney','United Kingdom'),
('hamilton-ee91ef0','Hamilton','United Kingdom'),
('hanley-e413ece','Hanley','United Kingdom'),
('hammersmith-81e2a46','Hammersmith','United Kingdom'),
('harrogate-671872d','Harrogate','United Kingdom'),
('harrow-85ab55b','Harrow','United Kingdom'),
('hartlepool-14dbe1d','Hartlepool','United Kingdom'),
('hastings-f0c1097','Hastings','United Kingdom'),
('hemel-hempstead-5996311','Hemel Hempstead','United Kingdom'),
('hereford-9e6bd46','Hereford','United Kingdom'),
('high-wycombe-7cb4dd8','High Wycombe','United Kingdom'),
('hounslow-6e6b9c6','Hounslow','United Kingdom'),
('huddersfield-eca530b','Huddersfield','United Kingdom'),
('hull-a8c3ec6','Hull','United Kingdom'),
('ilford-85e8565','Ilford','United Kingdom'),
('inverness-b020615','Inverness','United Kingdom'),
('ipswich-ddd8404','Ipswich','United Kingdom'),
('irvine-9c0782f','Irvine','United Kingdom'),
('kings-lynn-42922b7','Kings Lynn','United Kingdom'),
('kilburn-99fc57f','Kilburn','United Kingdom'),
('kingston-46cade1','Kingston','United Kingdom'),
('lakeside-837724d','Lakeside','United Kingdom'),
('lancaster-market-gate-9450197','Lancaster / Market Gate','United Kingdom'),
('leeds-ba1a8cb','Leeds','United Kingdom'),
('leeds-white-rose-a8cda5a','Leeds White Rose','United Kingdom'),
('leicester-fcc039a','Leicester','United Kingdom'),
('lincoln-f77cc30','Lincoln','United Kingdom'),
('liverpool-197f8b4','Liverpool','United Kingdom'),
('livingston-c5384d2','Livingston','United Kingdom'),
('loughborough-4435107','Loughborough','United Kingdom'),
('luton-42551e9','Luton','United Kingdom'),
('manchester-78ae262','Manchester','United Kingdom'),
('mansfield-fa774ef','Mansfield','United Kingdom'),
('margate-thanet-e443980','Margate / Thanet','United Kingdom'),
('meadowhall-df7cefe','Meadowhall','United Kingdom'),
('merry-hill-80c0eed','Merry Hill','United Kingdom'),
('metro-newcastle-1f3eacb','Metro Newcastle','United Kingdom'),
('middlesbrough-28f48a8','Middlesbrough','United Kingdom'),
('milton-keynes-centre-mk-7dda50f','Milton Keynes – Centre MK','United Kingdom'),
('milton-keynes-stadium-21d7ae4','Milton Keynes – Stadium','United Kingdom'),
('motherwell-7e084b4','Motherwell','United Kingdom'),
('newbury-b3643f9','Newbury','United Kingdom'),
('newcastle-c9b0a8e','Newcastle','United Kingdom'),
('newport-25daa70','Newport','United Kingdom'),
('newry-e18716a','Newry','United Kingdom'),
('newtownabbey-de23508','NewtownAbbey','United Kingdom'),
('newtownards-6b0bd41','Newtownards','United Kingdom'),
('northampton-1e8a9d5','Northampton','United Kingdom'),
('norwich-52a7f21','Norwich','United Kingdom'),
('nottingham-e830370','Nottingham','United Kingdom'),
('oldham-df50623','Oldham','United Kingdom'),
('omagh-53efb45','Omagh','United Kingdom'),
('oxford-st-east-tottenham-court-e0e2ef0','Oxford St East (Tottenham Court)','United Kingdom'),
('oxford-st-west-marble-arch-8bda4b5','Oxford St West (Marble Arch)','United Kingdom'),
('oxford-westgate-47c73ee','Oxford Westgate','United Kingdom'),
('park-head-glasgow-72289ed','Park Head Glasgow','United Kingdom'),
('perth-6142ebb','Perth','United Kingdom'),
('peterborough-d6693fb','Peterborough','United Kingdom'),
('plymouth-15d3069','Plymouth','United Kingdom'),
('poole-3022238','Poole','United Kingdom'),
('portsmouth-4190cc1','Portsmouth','United Kingdom'),
('preston-bb2debb','Preston','United Kingdom'),
('reading-aaf3204','Reading','United Kingdom'),
('redditch-b098c4e','Redditch','United Kingdom'),
('romford-617e4d5','Romford','United Kingdom'),
('rotherham-58acb9c','Rotherham','United Kingdom'),
('rushden-lakes-b351e24','Rushden Lakes','United Kingdom'),
('salisbury-54901ce','Salisbury','United Kingdom'),
('scunthorpe-463d7b3','Scunthorpe','United Kingdom'),
('sheffield-acc33b7','Sheffield','United Kingdom'),
('shrewsbury-1efdb9e','Shrewsbury','United Kingdom'),
('slough-2c89e04','Slough','United Kingdom'),
('southampton-1e05bf5','Southampton','United Kingdom'),
('southend-8e2f50a','Southend','United Kingdom'),
('southport-6ae6d13','Southport','United Kingdom'),
('stevenage-633ecd0','Stevenage','United Kingdom'),
('stockport-35a803e','Stockport','United Kingdom'),
('stratford-city-b1d9eea','Stratford City','United Kingdom'),
('staines-b7e361f','Staines','United Kingdom'),
('sunderland-1da258a','Sunderland','United Kingdom'),
('swansea-f57f897','Swansea','United Kingdom'),
('sutton-8171e3e','Sutton','United Kingdom'),
('swindon-4c50081','Swindon','United Kingdom'),
('tamworth-62934a1','Tamworth','United Kingdom'),
('taunton-1e29060','Taunton','United Kingdom'),
('teesside-park-bd6e2c6','Teesside Park','United Kingdom'),
('telford-c6638cc','Telford','United Kingdom'),
('torquay-4e8eab1','Torquay','United Kingdom'),
('trafford-d52ead1','Trafford','United Kingdom'),
('trafford-home-3324a62','Trafford Home','United Kingdom'),
('truro-lemon-quay-d7e9127','Truro Lemon Quay','United Kingdom'),
('tunbridge-wells-d2c3db5','Tunbridge Wells','United Kingdom'),
('uxbridge-8d459bf','Uxbridge','United Kingdom'),
('wakefield-e87f578','Wakefield','United Kingdom'),
('wallasey-4f5c68b','Wallasey','United Kingdom'),
('walsall-19d9178','Walsall','United Kingdom'),
('wandsworth-73b37a5','Wandsworth','United Kingdom'),
('warrington-82f3e26','Warrington','United Kingdom'),
('watford-f2e80e6','Watford','United Kingdom'),
('wembley-f87d804','Wembley','United Kingdom'),
('west-bromwich-35945b1','West Bromwich','United Kingdom'),
('westfield-london-white-city-4ecd333','Westfield London (White City)','United Kingdom'),
('weymouth-939e6be','Weymouth','United Kingdom'),
('wigan-70dcfb6','Wigan','United Kingdom'),
('winchester-db015ef','Winchester"','United Kingdom'),
('woking-9118f6a','Woking','United Kingdom'),
('wolverhampton-5f3a961','Wolverhampton','United Kingdom'),
('wood-green-a710377','Wood Green','United Kingdom'),
('woolwich-95a05b8','Woolwich','United Kingdom'),
('worcester-40f8641','Worcester','United Kingdom'),
('wrexham-c40168e','Wrexham','United Kingdom'),
('yeovil-3eb2e34','Yeovil','United Kingdom'),
('york-coppergate-a99e299','York Coppergate','United Kingdom'),
('york-monks-cross-c8f201e','York Monks Cross','United Kingdom'),
('american-dream-efc63aa','American Dream','United States'),
('arundel-mills-baltimore-md-10557f8','Arundel Mills, Baltimore, MD','United States'),
('boston-downtown-crossing-dtx-9e0d591','Boston Downtown Crossing (DTX)','United States'),
('braintree-primark-south-shore-plaza-4a9c518','Braintree / Primark South Shore Plaza','United States'),
('brooklyn-primark-kings-plaza-mall-6820e6b','Brooklyn / Primark King’s Plaza Mall','United States'),
('buffalo-ny-0d85367','Buffalo, NY','United States'),
('burlington-96ac77e','Burlington','United States'),
('castleton-square-96cae04','Castleton Square','United States'),
('chicago-state-street-76a0f3d','Chicago State Street','United States'),
('city-point-brooklyn-6d4a569','City Point, Brooklyn','United States'),
('concord-mills-fb7690d','Concord Mills','United States'),
('crossgates-albany-75e6640','Crossgates, Albany','United States'),
('danbury-03a0fbd','Danbury','United States'),
('fl-dolphin-mall-miami-0ad52b5','FL, Dolphin Mall, Miami','United States'),
('freehold-6536276','Freehold','United States'),
('great-lakes-crossing-5000aee','Great Lakes Crossing','United States'),
('green-acres-long-island-f159537','Green Acres, Long Island','United States'),
('herald-square-c165d18','Herald Square','United States'),
('il-gurnee-mills-949a877','IL Gurnee Mills','United States'),
('jamaica-ave-6d57326','Jamaica Ave','United States'),
('jersey-gardens-f50cbd0','Jersey Gardens','United States'),
('king-of-prussia-aa597d0','King of Prussia"','United States'),
('mall-of-america-0993e16','Mall of America','United States'),
('mall-of-prince-george-hyattsville-u-bf284b4','Mall of Prince George, Hyattsville USA','United States'),
('nj-newport-centre-jersey-city-adc8d54','NJ Newport Centre, Jersey City','United States'),
('nyc-queens-center-queens-35253c5','NYC Queens Center, Queens','United States'),
('orlando-florida-53d3e63','Orlando, Florida','United States'),
('philadelphia-fashion-district-c7aed4f','Philadelphia Fashion District','United States'),
('potomac-mills-va-729a343','Potomac Mills, VA','United States'),
('roosevelt-field-7d89c23','Roosevelt Field','United States'),
('sawgrass-563b0c5','Sawgrass','United States'),
('smith-haven-42269c3','Smith Haven','United States'),
('staten-island-c55f175','Staten Island','United States'),
('sugarloaf-mills-27573c6','Sugarloaf Mills','United States'),
('tn-cool-springs-galleria-64e650a','TN, Cool Springs Galleria','United States'),
('tn-wolfchase-galleria-60f58bf','TN Wolfchase Galleria','United States'),
('tx-grapevine-mills-dallas-fe1c27e','TX Grapevine Mills, Dallas','United States'),
('tx-katy-mills-houston-16da35c','TX Katy Mills, Houston','United States'),
('tx-la-plaza-mall-mcallen-3e085f2','TX La Plaza Mall, McAllen','United States'),
('tx-parks-at-arlington-cba6719','TX Parks at Arlington','United States'),
('north-east-mall-texas-5e10a31','North East Mall, Texas','United States'),
('texas-cielo-vista-mall-ab88123','Texas Cielo Vista Mall','United States'),
('tysons-corner-washington-va-a319132','Tysons Corner, Washington, VA','United States'),
('vineland-premium-outlets-22f63dd','Vineland Premium Outlets','United States'),
('willowbrook-mall-houston-tx-85816dd','Willowbrook Mall, Houston TX','United States'),
('willow-grove-1819ce1','Willow Grove','United States'),
('woodfield-mall-chicago-il-09296cf','Woodfield Mall, Chicago, IL','United States')) AS s(id,name,country);
SELECT ensure_store_credits(id,name,country,store_code) FROM organisation_stores;
UPDATE store_credit_accounts a SET store_name=s.name,country=s.country,store_code=s.store_code,active=s.active FROM organisation_stores s WHERE s.id=a.store_id;
SELECT sync_credit_assignments(NULL,false);

UPDATE scorm_launches s SET assignment_id=a.history_id FROM course_assignments a WHERE a.learner_id=s.learner_id AND a.course_id=s.course_id;
