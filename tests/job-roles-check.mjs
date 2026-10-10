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
writeFileSync(entry,`export * as roles from '${process.cwd()}/app/api/job-roles/route.ts';
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
 await q('UPDATE organisation_settings SET credits_enabled=false,pathways_enabled=true');
 const stores=await m.storeDirectory(),ie=stores.find(s=>s.active&&s.country==='Ireland'&&s.storeCode),uk=stores.find(s=>s.active&&s.country==='United Kingdom'&&s.storeCode);
 for(const id of ['org','country','site','student','other'])await person(id,ie.id,ie.country);
 await person('outside',uk.id,uk.country);
 await q("INSERT INTO reporting_access(learner_id,scope,country,site_id,assigned_by,updated_at) VALUES('org','organisation',NULL,NULL,'test','2026-01-01'),('country','country','Ireland',NULL,'test','2026-01-01'),('site','site','Ireland',$1,'test','2026-01-01')",ie.id);
 const roles=async()=> (await call(m.roles,'GET','/api/job-roles',null,{admin:true})).json();
 const saveRole=(body,auth={user:'org'})=>call(m.roles,'POST','/api/job-roles',body,auth);
 const directory=async(auth={admin:true},filter='')=>{const r=await call(m.users,'GET','/api/users?'+filter,null,auth);assert.equal(r.status,200,await r.clone().text());return r.json();};
 const change=async(id,jobRoleId,auth={admin:true})=>{const data=await directory();const p=data.people.find(p=>p.id===id);return call(m.users,'PATCH','/api/users',{...p,workdayId:p.workday_id,jobRoleId,action:'details'},auth);};
 let staff,supervisor,night;
 await check('Default roles leave existing users blank and restrict role-list writes',async()=>{
  const data=await roles();assert.deepEqual(data.roles.map(r=>r.name).sort(),['Manager','Night Worker','Staff','Supervisor']);staff=data.roles.find(r=>r.name==='Staff');supervisor=data.roles.find(r=>r.name==='Supervisor');night=data.roles.find(r=>r.name==='Night Worker');
  assert.equal((await one("SELECT job_role_id FROM learners WHERE id='student'")).job_role_id,null);
  const body={name:'Security',external_code:'SEC',archived:false};
  for(const user of ['student','country','site'])assert.equal((await saveRole(body,{user})).status,403);
  assert.equal((await saveRole(body,{user:'org',origin:'https://other.test'})).status,403);
  assert.equal((await saveRole(body)).status,200);
  assert.equal((await saveRole({...body,name:' security '})).status,409);
  assert.equal((await saveRole({...body,name:'Different role',external_code:'sec'})).status,409);
  assert.equal((await saveRole({...staff,name:'Shop Staff'})).status,200);
  assert.equal((await saveRole(staff)).status,409);
  staff=(await roles()).roles.find(r=>r.id===staff.id);assert.equal(staff.name,'Shop Staff');
 });
 await check('Job role editing respects learner, own-account and admin scope boundaries',async()=>{
  assert.equal((await change('student',staff.id,{user:'student'})).status,403);
  assert.equal((await change('org',staff.id,{user:'org'})).status,403);
  assert.equal((await change('outside',staff.id,{user:'country'})).status,403);
  assert.equal((await change('student',staff.id,{user:'site'})).status,200);
  assert.equal((await one("SELECT job_role_id FROM learners WHERE id='student'")).job_role_id,staff.id);
  assert.equal((await one("SELECT COUNT(*)::int n FROM reporting_access WHERE learner_id='student'")).n,0);
  assert.equal((await change('student','nonexistent')).status,400);
  assert.equal((await directory({user:'country'},'jobRole='+staff.id)).people.length,1);
  const r=await call(m.users,'GET','/api/users?export=1&jobRole='+staff.id,null,{user:'country'});assert.equal(r.status,200);const text=await r.text();assert(text.includes('Shop Staff'));assert(text.includes('student@test.invalid'));assert(!text.includes('outside@test.invalid'));
 });
 let pathId;
 await check('Role-based pathways assign on role change, combine filters, never duplicate or delete evidence',async()=>{
  await course('role-course');
  const r=await call(m.pathways,'POST','/api/pathways',{action:'save',name:'Supervisor training',description:'Role rules',items:[{courseId:'role-course',stage:1}],deadline_days:30,award_certificate:false,archived:false,assignment_rule:{enabled:true,scope:'countries',countries:['Ireland'],sites:[],jobRoles:[supervisor.id],startedFrom:null,startedTo:null}},{admin:true});assert.equal(r.status,200,await r.clone().text());pathId=(await r.json()).id;
  assert.equal((await one('SELECT COUNT(*)::int n FROM pathway_enrolments WHERE pathway_id=$1',pathId)).n,0);
  assert.equal((await change('student',supervisor.id)).status,200);
  assert.equal((await one("SELECT COUNT(*)::int n FROM pathway_enrolments WHERE learner_id='student' AND pathway_id=$1",pathId)).n,1);
  await q("UPDATE learners SET job_role_id=$1 WHERE id='outside'",supervisor.id);await q("SELECT sync_pathway_assignments('outside')");assert.equal((await one("SELECT COUNT(*)::int n FROM pathway_enrolments WHERE learner_id='outside'")).n,0);
  const before=await q("SELECT * FROM assignment_history WHERE learner_id='student'");
  assert.equal((await change('student',night.id)).status,200);assert.equal((await change('student',supervisor.id)).status,200);
  assert.deepEqual(await q("SELECT * FROM assignment_history WHERE learner_id='student'"),before);
  assert.equal((await one("SELECT COUNT(*)::int n FROM pathway_enrolments WHERE learner_id='student' AND pathway_id=$1",pathId)).n,1);
 });
 await check('Archived roles retain existing records and rules, reject new selections, and allow clearing',async()=>{
  assert.equal((await saveRole({...supervisor,archived:true})).status,200);
  assert.equal((await change('other',supervisor.id)).status,400);
  assert.equal((await change('student',supervisor.id)).status,200);
  assert.equal((await change('student','')).status,200);
  assert.equal((await one("SELECT job_role_id FROM learners WHERE id='student'")).job_role_id,null);
  assert.equal((await one("SELECT assignment_rule FROM learning_pathways WHERE id=$1",pathId)).assignment_rule.jobRoles[0],supervisor.id);
  await assert.rejects(q("UPDATE learners SET job_role_id=$1 WHERE id='other'",supervisor.id));
 });
 await check('New admin-created users receive roles and payroll codes work in bulk import',async()=>{
  const r=await call(m.users,'POST','/api/users',{accountType:'learner',name:'New Learner',email:'new@test.invalid',password:'Password-123456',workdayId:'ROLE001',storeId:ie.id,jobRoleId:night.id},{user:'org'});assert.equal(r.status,201,await r.clone().text());
  const role=(await roles()).roles.find(r=>r.name==='Security');
  const source=m.csvDownload([['workday_id','job_role'],['ROLE001','SEC']]);
  const preview=await call(m.bulk,'POST','/api/users/import',{csv:source,mode:'update'},{user:'org'});assert.equal(preview.status,200);const data=await preview.json();assert(data.valid,JSON.stringify(data));
  const apply=await call(m.bulk,'POST','/api/users/import',{csv:source,mode:'update',revision:data.revision},{user:'org'});assert.equal(apply.status,200,await apply.clone().text());
  assert.equal((await one("SELECT job_role_id FROM learners WHERE workday_id='ROLE001'")).job_role_id,role.id);
  const invalid=m.csvDownload([['workday_id','job_role'],['ROLE001','Unknown']]);const bad=await call(m.bulk,'POST','/api/users/import',{csv:invalid,mode:'update'},{user:'org'});assert.equal((await bad.json()).valid,false);
 });
 await check('Audit records role definitions and user job-role changes without credentials',async()=>{
  const definitions=await q("SELECT * FROM audit_events WHERE entity='job_roles'");assert(definitions.some(r=>r.next_state?.external_code==='SEC'));assert(definitions.some(r=>r.action==='update'));
  const events=await q("SELECT * FROM audit_events WHERE entity='learners' AND learner_id='student'");assert(events.some(r=>r.next_state?.job_role_id===staff.id));assert(!JSON.stringify(events).includes('password_hash'));
 });
 console.log(`PASS ${checks} job role integration checks`);
}finally{await pg.close();rmSync(dir,{recursive:true,force:true});}
