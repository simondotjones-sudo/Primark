// The named sample-account data migration is covered separately by sample-completion-check.mjs.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AsyncLocalStorage} from 'node:async_hooks';
import {PGlite} from '@electric-sql/pglite';
import {build} from 'esbuild';
const pg=new PGlite();
const migrations=readdirSync('netlify/database/migrations').sort().filter(name=>name!=='20261009160000_sample-learner-induction-completion');
const migration=migrations.find(n=>n.endsWith('_period-credits'));
for(const n of migrations.filter(n=>n<migration))await pg.exec(readFileSync(`netlify/database/migrations/${n}/migration.sql`,'utf8'));
await pg.exec(`INSERT INTO learners(id,name,email,code_hash,store_id,country,entered_at) VALUES('existing','Existing learner','existing@test.invalid','unused','legacy-store','Ireland','2026-10-01');
 INSERT INTO courses(id,title,audience_json,created_at,updated_at) VALUES('existing-course','Existing course','{}','2026-10-01','2026-10-01');
 INSERT INTO course_assignments VALUES('existing','existing-course','original manager','2026-10-01T00:00:00Z');`);
await pg.exec(readFileSync(`netlify/database/migrations/${migration}/migration.sql`,'utf8'));
for(const n of migrations.filter(n=>n>migration))await pg.exec(readFileSync(`netlify/database/migrations/${n}/migration.sql`,'utf8'));
const context=new AsyncLocalStorage();
const pool={async query(sql,args=[]){const r=await pg.query(sql,args);return {rows:r.rows,rowCount:r.affectedRows};},async connect(){return {...this,release(){}};}};
globalThis.__creditTest={pool,identity:()=>context.getStore()?.admin?{email:'platform@test.invalid'}:null,cookie:()=>context.getStore()?.user||''};
const dir=mkdtempSync(join(tmpdir(),'primark-credit-check-')),entry=join(dir,'entry.ts');
writeFileSync(entry,`export * as recognition from '${process.cwd()}/app/api/training-recognition/route.ts';
export * as roles from '${process.cwd()}/app/api/job-roles/route.ts';
export * as pathways from '${process.cwd()}/app/api/pathways/route.ts';
export * as bulk from '${process.cwd()}/app/api/users/import/route.ts';
export {parseLearnerCsv,csvDownload} from '${process.cwd()}/lib/learner-import-csv.ts';
export {verifyPassword} from '${process.cwd()}/lib/learner-auth.ts';
export * as users from '${process.cwd()}/app/api/users/route.ts';
 export * as audit from '${process.cwd()}/app/api/audit/route.ts';
 export {storeDirectory} from '${process.cwd()}/lib/store-directory.ts';
 export {userRevision} from '${process.cwd()}/lib/user-administration.ts';
export * as report from '${process.cwd()}/lib/training-report.ts';
 export * as assessor from '${process.cwd()}/app/api/assessor/route.ts';
 export * as renew from '${process.cwd()}/app/api/courses/renew/route.ts';
 export * as courses from '${process.cwd()}/app/api/courses/route.ts';
 export * as admin from '${process.cwd()}/app/api/admin/courses/route.ts';
 export * as runtime from '${process.cwd()}/app/api/scorm/route.ts';
 export * as renewal from '${process.cwd()}/lib/course-renewals.ts';
 export {renewalDays} from '${process.cwd()}/lib/course-renewal-status.ts';
 export {hash} from '${process.cwd()}/lib/server.ts';`);
await build({entryPoints:[entry],outfile:join(dir,'bundle.mjs'),bundle:true,platform:'node',format:'esm',tsconfig:'tsconfig.json',plugins:[{name:'test',setup(b){
 b.onResolve({filter:/^@netlify\/database$/},()=>({path:'db',namespace:'test'}));
 b.onResolve({filter:/^@\/lib\/admin-auth$/},()=>({path:'auth',namespace:'test'}));
 b.onResolve({filter:/^next\/headers$/},()=>({path:'cookies',namespace:'test'}));
 b.onResolve({filter:/^next\/server$/},()=>({path:'next',namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},a=>({contents:a.path==='db'?'export const getDatabase=()=>({pool:globalThis.__creditTest.pool});':a.path==='auth'?'export const getAdminUser=async()=>globalThis.__creditTest.identity();export const credentials=()=>null;export const allowLoginAttempt=async()=>true;export const credentialFingerprint=async()=>"unused";export const sessionCredentialFingerprint=async()=>"unused";':a.path==='cookies'?"export const cookies=async()=>({get:n=>n==='primark_session'&&globalThis.__creditTest.cookie()?{value:globalThis.__creditTest.cookie()}:undefined});":'export class NextRequest extends Request {}; export const NextResponse=Response;',loader:'js'}));
}}]});
const m=await import(join(dir,'bundle.mjs'));let checks=0;
const q=async(sql,...args)=>(await pg.query(sql,args)).rows;
const one=async(sql,...args)=>(await q(sql,...args))[0];
async function check(name,fn){await fn();console.log('PASS '+name);checks++;}
async function call(mod,method,path,body,{user='',admin=false,origin='https://local.test'}={}){return context.run({user,admin},async()=>{const req=new Request('https://local.test'+path,{method,headers:{'Content-Type':'application/json',Origin:origin,...(user?{Cookie:'primark_session='+user}:{})},...(body?{body:JSON.stringify(body)}:{})});req.nextUrl=new URL(req.url);req.cookies={get:n=>n==='primark_session'&&user?{value:user}:undefined};return mod[method](req);});}
const person=async(id,store='credit-ie',country='Ireland')=>{await q('INSERT INTO learners(id,name,email,code_hash,store_id,country,entered_at) VALUES($1,$1,$2,$1,$3,$4,$5)',id,id+'@test.invalid',store,country,new Date().toISOString());await q('INSERT INTO sessions VALUES($1,$2,$3)',await m.hash(id),id,'2099-01-01');};
async function course(id,audience={countries:[],sites:[],users:[]}){await q("INSERT INTO courses(id,title,status,audience_json,created_at,updated_at,catalogue_scope,validity_months) VALUES($1,$1,'published',$2,'2026-01-01','2026-01-01','global',12)",id,JSON.stringify(audience));await q("INSERT INTO course_packages(id,course_id,filename,status,scos_json,file_count,total_bytes,created_at) VALUES($1,$2,'fixture.zip','ready',$3,1,10,'2026-01-01')",id+'-pack',id,JSON.stringify([{id:'sco',title:'Lesson',href:'index.html',mastery:'',launchData:''}]));await q('UPDATE courses SET package_id=$2 WHERE id=$1',id,id+'-pack');}
const assign=async(id,cid,at=new Date().toISOString(),renew=false)=>one('SELECT assign_credit_course($1,$2,$3,$4::timestamptz,$5) AS added',id,cid,'manager@test.invalid',at,renew);
const history=async(id,cid)=>one('SELECT h.* FROM course_assignments a JOIN assignment_history h ON h.id=a.history_id WHERE a.learner_id=$1 AND a.course_id=$2',id,cid);
const balance=async(store='credit-ie')=>(await one('SELECT balance FROM store_credit_accounts WHERE store_id=$1',store)).balance;
try{
 await q('UPDATE organisation_settings SET credits_enabled=false');
 for(const id of ['org','site','student'])await person(id);
 await q("INSERT INTO reporting_access(learner_id,scope,country,site_id,assigned_by,updated_at) VALUES('org','organisation',NULL,NULL,'test','2026-01-01'),('site','site','Ireland','credit-ie','test','2026-01-01')");
 await course('recognition-course');await assign('student','recognition-course');const h=await history('student','recognition-course');
 const body={action:'approve',assignmentId:h.id,kind:'exempt',reason:'Temporary agreed leave',evidenceRef:'HR approval 123',validUntil:'2099-01-01T00:00:00Z'};
 const save=(b=body,auth={user:'org'})=>call(m.recognition,'POST','/api/training-recognition',b,auth);
 const report=async()=>m.report.trainingReport(null);
 const status=async()=> (await report()).records.find(r=>r.learnerId==='student'&&r.courseId==='recognition-course').status;
 const revoke=async()=>{const r=await one('SELECT id FROM training_recognitions WHERE assignment_id=$1 AND revoked_at IS NULL',h.id);const response=await save({action:'revoke',assignmentId:h.id,id:r.id,reason:'Review changed decision'});assert.equal(response.status,200,await response.clone().text());};
 await check('Default off; only organisation/platform admins; same-origin protection',async()=>{
  assert.equal((await save()).status,403);
  await q(`UPDATE organisation_settings SET features=jsonb_set(features,'{training_recognition,enabled}','true')`);
  for(const user of ['student','site']){assert.equal((await save(body,{user})).status,403);assert.equal((await call(m.recognition,'GET','/api/training-recognition',null,{user})).status,403);}
  assert.equal((await save(body,{user:'org',origin:'https://other.test'})).status,403);
  assert.equal((await save({...body,evidenceRef:''})).status,400);
  assert.equal((await save({...body,validUntil:'2020-01-01'})).status,400);
 });
 await check('Exemption is distinct and removed from compliance denominator without completion or credits',async()=>{
  const response=await save();assert.equal(response.status,200,await response.clone().text());assert.equal(await status(),'exempt');
  const o=await m.report.trainingOverview(null,{category:'all',courseId:'recognition-course'});assert.equal(o.metrics.assessed,0);assert.equal(o.metrics.completed,0);
  assert.equal((await history('student','recognition-course')).completed_at,null);
  assert.equal((await one('SELECT count(*)::int n FROM certificates')).n,0);
  assert.equal((await save()).status,409);
  await q(`UPDATE organisation_settings SET features=jsonb_set(features,'{training_recognition,enabled}','false')`);assert.equal(await status(),'exempt');
  await revoke();assert.equal(await status(),'not-started');
  await q(`UPDATE organisation_settings SET features=jsonb_set(features,'{training_recognition,enabled}','true')`);
 });
 await check('Prior learning counts as compliant separately from completed; no certificate',async()=>{
  const response=await save({...body,kind:'recognised',qualification:'External safety certificate',achievedOn:'2025-01-01'});assert.equal(response.status,200,await response.clone().text());
  assert.equal(await status(),'recognised');
  const learnerResponse=await call(m.courses,'GET','/api/courses',null,{user:'student'});assert.equal(learnerResponse.status,200,await learnerResponse.clone().text());const payload=await learnerResponse.json();assert.equal(payload.courses.find(c=>c.id==='recognition-course').recognition.kind,'recognised');assert(!JSON.stringify(payload).includes('HR approval 123'));
  const o=await m.report.trainingOverview(null,{category:'all',courseId:'recognition-course'});assert.equal(o.metrics.assessed,1);assert.equal(o.metrics.compliant,1);assert.equal(o.metrics.completed,0);assert.equal(o.groups[0].completedCourses,0);assert.equal(Number(o.metrics.compliance),100);
  assert.equal((await one('SELECT count(*)::int n FROM certificates')).n,0);
  await revoke();
 });
 await check('Expiry restores normal training requirement and records remain immutable',async()=>{
  await q(`INSERT INTO training_recognitions(assignment_id,learner_id,kind,reason,evidence_ref,approved_at,valid_until,approved_by) VALUES($1,'student','exempt','Past leave','Historic evidence','2020-01-01','2020-02-01','test')`,h.id);
  assert.equal(await status(),'not-started');
  await assert.rejects(q("UPDATE training_recognitions SET reason='tampered' WHERE assignment_id=$1",h.id));
  await assert.rejects(q('DELETE FROM training_recognitions WHERE assignment_id=$1',h.id));await revoke();
 });
 await check('Deadline extensions remain the due date after expiry, revoke restores original; practical signoff protected',async()=>{
  await q("UPDATE assignment_history SET due_at='2020-01-01',assessor_required=true WHERE id=$1",h.id);
  assert.equal((await save()).status,400);
  const response=await save({...body,kind:'extension'});assert.equal(response.status,200,await response.clone().text());
  let record=(await report()).records.find(r=>r.learnerId==='student'&&r.courseId==='recognition-course');assert.equal(record.dueAt,'2099-01-01T00:00:00.000Z');assert.equal(record.status,'not-started');
  await q("UPDATE email_settings SET active_since='2020-01-01'");const mails=await q("SELECT * FROM learning_email_candidates_unfiltered('2099-01-01T01:00:00Z') WHERE kind='overdue' AND recipient_id='student'");assert.equal(mails.length,1);assert.equal(new Date(mails[0].payload.date).toISOString(),'2099-01-01T00:00:00.000Z');
  await revoke();record=(await report()).records.find(r=>r.learnerId==='student'&&r.courseId==='recognition-course');assert.equal(record.dueAt,'2020-01-01T00:00:00.000Z');
  const events=await q("SELECT * FROM audit_events WHERE entity='training_recognitions'");assert(events.some(r=>r.actor==='org@test.invalid'&&r.action==='insert'));assert(events.some(r=>r.action==='update'));
 });
 console.log(`PASS ${checks} training recognition integration checks`);
}finally{await pg.close();rmSync(dir,{recursive:true,force:true});}
