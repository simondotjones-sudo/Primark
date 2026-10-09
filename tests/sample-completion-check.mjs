import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const pg=new PGlite(),migration='20261009160000_sample-learner-induction-completion';
for(const name of readdirSync('netlify/database/migrations').sort().filter(n=>n!==migration))await pg.exec(readFileSync(`netlify/database/migrations/${name}/migration.sql`,'utf8'));
const sql=readFileSync(`netlify/database/migrations/${migration}/migration.sql`,'utf8');
const q=async(sql,...args)=>(await pg.query(sql,args)).rows;
await pg.exec(sql); // A fresh empty installation remains usable.
await pg.exec("INSERT INTO learners(id,name,email,code_hash,store_id,country,entered_at) VALUES('unrelated','Unrelated','unrelated@example.test','unused','bootstrap','Ireland','2026-10-08')");
await assert.rejects(pg.exec(sql),/Expected exactly one sample learner/);
await pg.exec(`
INSERT INTO organisation_stores(id,name,country,active,updated_by,updated_at) VALUES('sample-store','Sample store','Ireland',true,'test','2026-10-09');
SELECT ensure_store_credits('sample-store','Sample store','Ireland');
INSERT INTO learners(id,name,email,code_hash,store_id,country,entered_at) VALUES
('sample','Sample learner','Learner@Primark.com','unused','sample-store','Ireland','2026-10-08'),
('other','Other learner','other@example.test','unused','sample-store','Ireland','2026-10-08');
INSERT INTO courses(id,title,category,status,audience_json,created_at,updated_at,catalogue_scope,validity_months) VALUES
('sample-induction','Primark Employee Induction','Induction','published','{}','2026-10-08','2026-10-08','global',12),
('other-course','Other course','Safety','published','{}','2026-10-08','2026-10-08','global',NULL);
INSERT INTO course_packages(id,course_id,filename,status,scos_json,file_count,total_bytes,created_at) VALUES
('sample-package','sample-induction','sample.zip','ready','[{"id":"one"},{"id":"two"}]',1,10,'2026-10-08'),
('other-package','other-course','other.zip','ready','[{"id":"one"}]',1,10,'2026-10-08');
UPDATE courses SET package_id='sample-package' WHERE id='sample-induction';
UPDATE courses SET package_id='other-package' WHERE id='other-course';
`);
await assert.rejects(pg.exec(sql),/Expected exactly one assigned induction/);
await pg.exec(`SELECT assign_credit_course('sample','sample-induction','test');SELECT assign_credit_course('sample','other-course','test');SELECT assign_credit_course('other','sample-induction','test');`);
await q("UPDATE courses SET category='Induction' WHERE id='other-course'");
await assert.rejects(pg.exec(sql),/Expected exactly one assigned induction/);
assert.equal((await q('SELECT * FROM scorm_progress')).length,0);
await q("UPDATE courses SET category='Safety' WHERE id='other-course'");
await q("UPDATE learners SET archived_at='2026-10-09' WHERE id='sample'");
await assert.rejects(pg.exec(sql),/active learner account/);
await q("UPDATE learners SET archived_at=NULL WHERE id='sample'");
await q("UPDATE course_packages SET status='staged' WHERE id='sample-package'");
await assert.rejects(pg.exec(sql),/original ready package/);
await q("UPDATE course_packages SET status='ready' WHERE id='sample-package'");
await pg.exec(`
INSERT INTO scorm_progress(learner_id,package_id,sco_id,status,score,total_centiseconds,completed_at,updated_at,data_json) VALUES
('sample','sample-package','one','passed','85',4000,'2026-10-08T12:00:00.000Z','2026-10-08T12:00:00.000Z','{"cmi.suspend_data":"keep-original-resume","cmi.comments":"Existing comment","cmi.core.score.raw":"85"}'),
('sample','other-package','one','incomplete',NULL,500,NULL,'2026-10-08','{}'),
('other','sample-package','one','incomplete',NULL,600,NULL,'2026-10-08','{}');
INSERT INTO scorm_launches(token,course_id,package_id,learner_id,sco_id,preview,seed_json,base_time,expires_at,assignment_id)
SELECT 'sample-launch','sample-induction','sample-package','sample','two',0,'{}',0,'2099-01-01',history_id FROM course_assignments WHERE learner_id='sample' AND course_id='sample-induction';
`);
const credits=await q('SELECT * FROM credit_ledger ORDER BY id'),balance=await q("SELECT balance FROM store_credit_accounts WHERE store_id='sample-store'");
const unrelated=await q("SELECT * FROM scorm_progress WHERE learner_id='other' OR package_id='other-package' ORDER BY learner_id,package_id,sco_id");
await pg.exec(sql);
const progress=await q("SELECT * FROM scorm_progress WHERE learner_id='sample' AND package_id='sample-package' ORDER BY sco_id");
assert.deepEqual(progress.map(r=>r.status),['passed','completed']);assert(progress.every(r=>r.completed_at));
assert.equal(progress[0].score,'85');assert.equal(progress[0].total_centiseconds,4000);assert.equal(progress[0].completed_at,'2026-10-08T12:00:00.000Z');
assert.equal(JSON.parse(progress[0].data_json)['cmi.suspend_data'],'keep-original-resume');assert.match(JSON.parse(progress[0].data_json)['cmi.comments'],/^Existing comment\nSample completion/);
assert.equal(progress[1].score,null);assert.equal(progress[1].total_centiseconds,0);assert.equal(progress[1].active_launch,null);
const certificates=await q('SELECT * FROM certificates');assert.equal(certificates.length,1);assert.equal(certificates[0].learner_id,'sample');assert.equal(certificates[0].course_id,'sample-induction');assert(certificates[0].expires_at);
const history=await q("SELECT h.* FROM assignment_history h JOIN course_assignments a ON a.history_id=h.id WHERE a.learner_id='sample' AND a.course_id='sample-induction'");assert(history[0].started_at);assert(history[0].completed_at);assert.equal(history[0].id,certificates[0].assignment_id);
assert.equal((await q("SELECT * FROM scorm_launches WHERE learner_id='sample'")).length,0);
assert.deepEqual(await q('SELECT * FROM credit_ledger ORDER BY id'),credits);assert.deepEqual(await q("SELECT balance FROM store_credit_accounts WHERE store_id='sample-store'"),balance);
assert.deepEqual(await q("SELECT * FROM scorm_progress WHERE learner_id='other' OR package_id='other-package' ORDER BY learner_id,package_id,sco_id"),unrelated);
await pg.exec(sql);
assert.deepEqual(await q("SELECT * FROM scorm_progress WHERE learner_id='sample' AND package_id='sample-package' ORDER BY sco_id"),progress);
assert.deepEqual(await q('SELECT * FROM certificates'),certificates);
console.log('PASS Sample completion: unique active learner and induction guards, all lessons completed, existing evidence retained, certificate/history consistent, no fabricated score/time, no credit or unrelated changes, and idempotent replay.');
await pg.close();
