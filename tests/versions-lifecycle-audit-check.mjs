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
writeFileSync(entry,`export * as users from '${process.cwd()}/app/api/users/route.ts';
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
 const stores=await m.storeDirectory(),ie=stores.find(s=>s.active&&s.country==='Ireland'),other=stores.find(s=>s.active&&s.country==='Ireland'&&s.id!==ie.id),uk=stores.find(s=>s.active&&s.country==='United Kingdom');
 for(const id of ['student','new-student','org','country','site'])await person(id,ie.id,ie.country);
 await q("INSERT INTO reporting_access(learner_id,scope,country,site_id,assigned_by,updated_at) VALUES('org','organisation',NULL,NULL,'test','2026-01-01'),('country','country','Ireland',NULL,'test','2026-01-01'),('site','site','Ireland',$1,'test','2026-01-01')",ie.id);
 await course('versioned');
 const save=async(extra={})=>{const c=await one("SELECT * FROM courses WHERE id='versioned'");return call(m.admin,'POST','/api/admin/courses',{id:c.id,revision:c.revision,title:c.title,description:c.description,status:'published',audience:JSON.parse(c.audience_json),catalogueScope:'global',...extra},{admin:true});};
 let r=await save();assert.equal(r.status,200,await r.text());
 await assign('student','versioned');const original=await history('student','versioned');
 await check('Published version changes preserve assigned content and requirements',async()=>{
  await q("INSERT INTO course_packages(id,course_id,filename,status,scos_json,file_count,total_bytes,created_at) VALUES('new-pack','versioned','new.zip','ready',$1,1,10,'2026-10-10')",JSON.stringify([{id:'new-sco',title:'New lesson',href:'index.html',mastery:'',launchData:''}]));
  await q("UPDATE courses SET package_id='new-pack' WHERE id='versioned'");
  r=await save({title:'Version two',validityMonths:6,versionReason:'Updated content'});assert.equal(r.status,200,await r.text());
  assert.equal((await one("SELECT learning_version FROM courses WHERE id='versioned'")).learning_version,2);
  const courses=await (await call(m.courses,'GET','/api/courses',null,{user:'student'})).json();assert.equal(courses.courses[0].title,'versioned');assert.equal(courses.courses[0].scos[0].id,'sco');
  const launch=await call(m.runtime,'POST','/api/scorm',{action:'launch',courseId:'versioned'},{user:'student'});assert.equal(launch.status,200,await launch.clone().text());
  const data=await launch.json();assert.equal((await one('SELECT package_id FROM scorm_launches WHERE token=$1',data.token)).package_id,'versioned-pack');
  r=await call(m.runtime,'POST','/api/scorm',{action:'save',token:data.token,sequence:1,data:{'cmi.core.lesson_status':'passed','cmi.core.score.raw':'95','cmi.core.session_time':'0000:01:00.00'}},{user:'student'});assert.equal(r.status,200,await r.text());
  const cert=await one("SELECT * FROM certificates WHERE learner_id='student'");assert.equal(cert.learning_version,1);assert.equal(cert.course_title,'versioned');assert.equal(cert.validity_months,12);
  const report=await m.report.trainingReport(null);assert.equal(report.records.find(r=>r.learnerId==='student'&&r.courseId==='versioned').status,'completed');
  await assign('new-student','versioned');assert.equal((await history('new-student','versioned')).package_id,'new-pack');assert.equal((await history('new-student','versioned')).learning_version,2);
 });
 await check('Retraining preserves evidence, creates new assignments and rejects repeat requests',async()=>{
  r=await save({title:'Version three',retrain:true,versionReason:'Mandatory updated procedure'});assert.equal(r.status,200,await r.text());
  const current=await history('student','versioned');assert.notEqual(current.id,original.id);assert.equal(current.previous_id,original.id);assert.equal(current.learning_version,3);assert.equal(current.completed_at,null);
  assert.ok((await one('SELECT * FROM assignment_history WHERE id=$1',original.id)).progress_snapshot.length);assert.ok((await one("SELECT * FROM certificates WHERE learner_id='student'")).archived_at);
  const before=(await q('SELECT id FROM assignment_history')).length;r=await save({retrain:true,versionReason:'Duplicate'});assert.equal(r.status,400);assert.equal((await q('SELECT id FROM assignment_history')).length,before);
  const records=(await m.report.trainingReport(null)).records;assert.equal(records.find(r=>r.learnerId==='student'&&r.courseId==='versioned').status,'not-started');
 });
 const read=async id=>{const r=await call(m.users,'GET','/api/users?status='+((await one('SELECT archived_at FROM learners WHERE id=$1',id)).archived_at?'archived':'active')+'&search='+id,null,{admin:true});assert.equal(r.status,200,await r.clone().text());return (await r.json()).people.find(p=>p.id===id);};
 const action=async(id,action,extra={},who={admin:true})=>{const p=await read(id);return call(m.users,'PATCH','/api/users',{id,revision:p.revision,action,effectiveDate:new Date().toISOString().slice(0,10),reason:'Workforce change',...extra},who);};
 await course('uk-induction');await q("UPDATE courses SET induction_role='country',catalogue_scope='countries',available_countries_json='[\"United Kingdom\"]' WHERE id='uk-induction'");await q("UPDATE learners SET induction_enrolled=true WHERE id='student'");
 await check('Transfers preserve history, apply destination induction and enforce scope',async()=>{
  const current=await history('student','versioned');
  r=await action('student','transfer',{storeId:uk.id},{user:'country'});assert.equal(r.status,403);
  r=await action('student','transfer',{storeId:other.id},{user:'site'});assert.equal(r.status,403);
  r=await action('student','transfer',{storeId:uk.id},{user:'org'});assert.equal(r.status,200,await r.text());
  assert.equal((await one("SELECT store_id FROM learners WHERE id='student'")).store_id,uk.id);assert.equal((await history('student','versioned')).id,current.id);assert.equal((await history('student','versioned')).store_id,ie.id);
  assert.ok(await history('student','uk-induction'));assert.equal((await q("SELECT * FROM sessions WHERE learner_id='student'")).length,0);
 });
 await check('Leaving blocks access; rejoining retains records and removes old privileges',async()=>{
  const before=(await q("SELECT id FROM assignment_history WHERE learner_id='student'")).length;
  r=await action('student','leave');assert.equal(r.status,200,await r.text());assert.ok((await read('student')).employment_ended_on);
  r=await call(m.courses,'GET','/api/courses',null,{user:'student'});assert.equal(r.status,401);
  await q("INSERT INTO reporting_access(learner_id,scope,country,site_id,assigned_by,updated_at) VALUES('student','site',$1,$2,'test','2026-01-01')",uk.country,uk.id);
  r=await action('student','rejoin',{storeId:other.id});assert.equal(r.status,200,await r.text());assert.equal((await read('student')).archived_at,null);assert.equal((await q("SELECT * FROM reporting_access WHERE learner_id='student'")).length,0);assert.ok((await q("SELECT id FROM assignment_history WHERE learner_id='student'")).length>=before);
  assert.equal((await q("SELECT * FROM sessions WHERE learner_id='student'")).length,0);
 });
 await check('Insufficient credits roll back publication, retraining and transfers atomically',async()=>{
  await q('UPDATE organisation_settings SET credits_enabled=true');
  await q('UPDATE store_credit_accounts SET balance=0');
  const version=await one("SELECT learning_version,title,revision FROM courses WHERE id='versioned'");
  const assignments=await q("SELECT history_id FROM course_assignments WHERE course_id='versioned' ORDER BY learner_id");
  r=await save({title:'Must roll back',retrain:true,versionReason:'Mandatory change'});assert.equal(r.status,409,await r.text());
  assert.deepEqual(await one("SELECT learning_version,title,revision FROM courses WHERE id='versioned'"),version);
  assert.deepEqual(await q("SELECT history_id FROM course_assignments WHERE course_id='versioned' ORDER BY learner_id"),assignments);
  await person('blocked-mover',ie.id,ie.country);await q("UPDATE learners SET induction_enrolled=true WHERE id='blocked-mover'");
  r=await action('blocked-mover','transfer',{storeId:uk.id},{user:'org'});assert.equal(r.status,409,await r.text());
  assert.equal((await one("SELECT store_id FROM learners WHERE id='blocked-mover'")).store_id,ie.id);
  assert.equal((await q("SELECT * FROM course_assignments WHERE learner_id='blocked-mover'")).length,0);
  await q('UPDATE organisation_settings SET credits_enabled=false');
 });
 await check('Audit is permission-controlled, attributed, searchable and append-only',async()=>{
  r=await call(m.audit,'GET','/api/audit',null,{user:'country'});assert.equal(r.status,403);
  r=await call(m.audit,'GET','/api/audit?search=Workforce',null,{user:'org'});assert.equal(r.status,200);const events=await r.json();assert.ok(events.total>0);assert.ok(events.events.some(e=>e.action==='transfer'));
  const all=JSON.stringify(await q('SELECT * FROM audit_events'));for(const secret of ['password_hash','code_hash','legacy_access_code','certificate_token','data_json','quiz_json'])assert.ok(!all.includes(secret),secret);
  assert.ok((await q("SELECT * FROM audit_events WHERE actor='platform@test.invalid' AND entity='course_versions'")).length);
  await assert.rejects(q("UPDATE audit_events SET actor='forged'"),/cannot be changed/);
  await assert.rejects(q('DELETE FROM course_versions'),/cannot be changed/);
  await assert.rejects(q("UPDATE assignment_history SET learning_version=999 WHERE learner_id='student'"),/cannot be rewritten/);
  assert.equal((await call(m.audit,'GET','/api/audit?page=-1',null,{admin:true})).status,400);
 });
 console.log(`${checks} version, lifecycle and audit integration checks passed`);
}finally{await pg.close();rmSync(dir,{recursive:true,force:true});}
