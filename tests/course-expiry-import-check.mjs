import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const pg=new PGlite();
const migration='20261010030000_course-expiry-import';
for(const name of readdirSync('netlify/database/migrations').sort().filter(n=>n<migration)) {
  await pg.exec(readFileSync(`netlify/database/migrations/${name}/migration.sql`,'utf8'));
}
const sql=readFileSync(`netlify/database/migrations/${migration}/migration.sql`,'utf8');
const {courses:policies}=JSON.parse(readFileSync('data/imports/primark-course-expiry-2026-10-10.json','utf8'));
const q=async(sql,...values)=>(await pg.query(sql,values)).rows;
assert.equal(policies.length,52);
assert.equal(new Set(policies.map(p=>p.title)).size,52);
assert.equal(policies.filter(p=>p.validity_months===12).length,34);
assert.equal(policies.filter(p=>p.validity_months===24).length,18);
for(const policy of policies) assert.equal(policy.validity_months,policy.cert_lifecycle*12);
const imported=await q('SELECT source_course_id,title FROM courses WHERE source_course_id IS NOT NULL');
assert.equal(imported.length,34);
for(const course of imported) {
  const policy=policies.find(p=>p.source_course_id===course.source_course_id);
  assert(policy);assert.equal(policy.title,course.title.trim());
}

// IDs keep a renamed course matched; unrelated near-matches must not receive its policy.
await pg.exec(`
UPDATE courses SET title='Safety Induction' WHERE source_course_id='154';
UPDATE courses SET validity_months=36 WHERE source_course_id='169';
INSERT INTO courses(id,title,audience_json,created_at,updated_at,validity_months) VALUES
 ('manual','  MANUAL HANDLING  ','{}','2026-01-01','2026-01-01',NULL),
 ('similar','Manual Handling - other organisation','{}','2026-01-01','2026-01-01',48),
 ('same-title','Primark Employee Induction','{}','2026-01-01','2026-01-01',48);
INSERT INTO organisation_stores(id,name,country,active,updated_by,updated_at)
 VALUES('expiry-store','Expiry test','Ireland',true,'test','2026-10-10');
SELECT ensure_store_credits('expiry-store','Expiry test','Ireland');
INSERT INTO learners(id,name,email,code_hash,store_id,country,entered_at) VALUES
 ('existing','Existing learner','existing@example.test','unused','expiry-store','Ireland','2024-01-01'),
 ('future','Future learner','future@example.test','unused','expiry-store','Ireland','2024-01-01');
INSERT INTO course_packages(id,course_id,filename,status,scos_json,file_count,total_bytes,created_at) VALUES
 ('fire-package','legacy-169','fire.zip','ready','[{"id":"one"}]',1,10,'2024-01-01'),
 ('induction-package','legacy-154','induction.zip','ready','[{"id":"one"}]',1,10,'2024-01-01');
UPDATE courses SET status='published',catalogue_scope='global',package_id='fire-package' WHERE id='legacy-169';
UPDATE courses SET status='published',catalogue_scope='global',package_id='induction-package' WHERE id='legacy-154';
SELECT assign_credit_course('existing','legacy-169','test');
INSERT INTO scorm_progress(learner_id,package_id,sco_id,status,completed_at,updated_at)
 VALUES('existing','fire-package','one','passed','2024-02-29T10:00:00.000Z','2024-02-29T10:00:00.000Z');
SELECT issue_course_certificate('existing','fire-package');
`);
const before=await q('SELECT * FROM courses ORDER BY id');
const tables=['certificates','learners','course_packages','course_assignments','scorm_progress','assignment_history','credit_ledger','store_credit_accounts'];
const snapshots=Object.fromEntries(await Promise.all(tables.map(async table=>[table,await q(`SELECT * FROM ${table} ORDER BY 1`)])));
await pg.exec(sql);
const after=await q('SELECT * FROM courses ORDER BY id');
assert.equal(after.length,before.length,'No missing courses are created');
for(const course of after) {
  const previous=before.find(c=>c.id===course.id);
  const policy=course.source_course_id?policies.find(p=>p.source_course_id===course.source_course_id):course.id==='manual'?policies.find(p=>p.title==='Manual Handling'):null;
  if(!policy) {assert.deepEqual(course,previous);continue;}
  assert.equal(course.validity_months,policy.validity_months);
  assert.equal(course.revision,previous.revision+1);
  assert.deepEqual({...course,validity_months:previous.validity_months,revision:previous.revision,updated_at:previous.updated_at},previous);
}
assert.equal(after.find(c=>c.source_course_id==='2006').validity_months,12,'Italian induction keeps its one-year exception');
assert.equal(after.find(c=>c.source_course_id==='2509').validity_months,24,'Irish manual handling keeps its two-year exception');
for(const table of tables) assert.deepEqual(await q(`SELECT * FROM ${table} ORDER BY 1`),snapshots[table],`${table} remains unchanged`);
await pg.exec(sql);
assert.deepEqual(await q('SELECT * FROM courses ORDER BY id'),after,'Replay does not bump unchanged revisions');

// An ambiguous title aborts the entire import, including earlier updates in its DO block.
await pg.exec(`INSERT INTO courses(id,title,audience_json,created_at,updated_at) VALUES
 ('duplicate','Workstation Safety 2.0','{}','2026-01-01','2026-01-01'),
 ('duplicate-2','Workstation Safety 2.0','{}','2026-01-01','2026-01-01');
 UPDATE courses SET validity_months=60 WHERE source_course_id='169';`);
const ambiguousBefore=await q('SELECT * FROM courses ORDER BY id');
await assert.rejects(pg.exec(sql),/Ambiguous course expiry match/);
assert.deepEqual(await q('SELECT * FROM courses ORDER BY id'),ambiguousBefore);
await pg.exec("DELETE FROM courses WHERE id IN ('duplicate','duplicate-2'); UPDATE courses SET validity_months=12 WHERE source_course_id='169';");

// Future certificates use calendar-month arithmetic from completion, including leap day.
await pg.exec(`
 SELECT assign_credit_course('future','legacy-169','test');
 SELECT assign_credit_course('future','legacy-154','test');
 INSERT INTO scorm_progress(learner_id,package_id,sco_id,status,completed_at,updated_at) VALUES
 ('future','fire-package','one','passed','2024-02-29T10:00:00.000Z','2024-02-29T10:00:00.000Z'),
 ('future','induction-package','one','passed','2024-02-29T10:00:00.000Z','2024-02-29T10:00:00.000Z');
 SELECT issue_course_certificate('future','fire-package');
 SELECT issue_course_certificate('future','induction-package');
`);
const certs=await q("SELECT course_id,validity_months,expires_at FROM certificates WHERE learner_id='future' ORDER BY course_id");
assert.deepEqual(certs,[
 {course_id:'legacy-154',validity_months:24,expires_at:'2026-02-28T10:00:00.000Z'},
 {course_id:'legacy-169',validity_months:12,expires_at:'2025-02-28T10:00:00.000Z'},
]);
assert.deepEqual(await q("SELECT * FROM certificates WHERE learner_id='existing'"),snapshots.certificates);
console.log('PASS Course expiry import: all 34 seeded mappings, exact-title additions, renamed courses, distinct country policies, no new courses, preserved certificates/assignments/credits, atomic ambiguity guard, idempotence and future one/two-year leap-day expiry.');
await pg.close();
