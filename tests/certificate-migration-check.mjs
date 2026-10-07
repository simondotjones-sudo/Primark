import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const pg=new PGlite();
const names=readdirSync('netlify/database/migrations').sort();
for(const name of names.filter(n=>!n.endsWith('_certificates')))await pg.exec(readFileSync('netlify/database/migrations/'+name+'/migration.sql','utf8'));
await pg.exec(`
INSERT INTO learners(id,name,email,code_hash,store_id,country,entered_at,completed_at,certificate_token)
VALUES('historic','Original Name','history@example.test','unused','store','Ireland','2024-01-01','2024-01-31T10:00:00.000Z',repeat('a',64));
INSERT INTO courses(id,title,audience_json,created_at,updated_at,validity_months) VALUES('history-course','Original course','{}','2024-01-01','2024-01-01',1);
INSERT INTO course_packages(id,course_id,filename,status,scos_json,file_count,total_bytes,created_at) VALUES('history-package','history-course','old.zip','ready','[{"id":"one"},{"id":"two"}]',1,10,'2024-01-01');
INSERT INTO scorm_progress(learner_id,package_id,sco_id,status,completed_at,updated_at) VALUES
('historic','history-package','one','passed','2024-01-20T10:00:00.000Z','2024-01-20'),
('historic','history-package','two','completed','2024-01-31T10:00:00.000Z','2024-01-31');
`);
await pg.exec(readFileSync('netlify/database/migrations/'+names.find(n=>n.endsWith('_certificates'))+'/migration.sql','utf8'));
const certs=(await pg.query('SELECT * FROM certificates ORDER BY package_id NULLS LAST')).rows;
assert.equal(certs.length,2);assert.equal(certs[0].completed_at,'2024-01-31T10:00:00.000Z');assert.equal(certs[0].expires_at,'2024-02-29T10:00:00.000Z');
assert.equal(certs[1].token,'a'.repeat(64));assert.equal(certs[1].expires_at,null);
assert.equal((await pg.query('SELECT completed_at FROM learners')).rows[0].completed_at,'2024-01-31T10:00:00.000Z');
await pg.exec("UPDATE courses SET validity_months=12; DELETE FROM certificates WHERE package_id IS NOT NULL; UPDATE scorm_progress SET completed_at='2024-02-29T10:00:00.000Z'; SELECT issue_course_certificate('historic','history-package')");
assert.equal((await pg.query('SELECT expires_at FROM certificates WHERE package_id IS NOT NULL')).rows[0].expires_at,'2025-02-28T10:00:00.000Z');
console.log('PASS Migration backfills completed packages, preserves legacy QR tokens and dates, and clamps month-end/leap-year expiry.');
await pg.close();
