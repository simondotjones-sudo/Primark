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
writeFileSync(entry,`export * as bulk from '${process.cwd()}/app/api/users/import/route.ts';
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
 const stores=await m.storeDirectory(),ie=stores.find(s=>s.active&&s.country==='Ireland'&&s.storeCode),other=stores.find(s=>s.active&&s.country==='Ireland'&&s.storeCode&&s.id!==ie.id);
 for(const id of ['org','country','site','student'])await person(id,ie.id,ie.country);
 await q("INSERT INTO reporting_access(learner_id,scope,country,site_id,assigned_by,updated_at) VALUES('org','organisation',NULL,NULL,'test','2026-01-01'),('country','country','Ireland',NULL,'test','2026-01-01'),('site','site','Ireland',$1,'test','2026-01-01')",ie.id);
 const csv=(...rows)=>m.csvDownload([['workday_id','name','email','store_code','start_date','status','effective_date','reason','initial_password'],...rows]);
 const row=(id,extra={})=>{const r={id,name:'Import Learner',email:id+'@test.invalid',store:ie.storeCode,start:'2026-01-01',status:'active',effective:'',reason:'',password:'Unique-password-123',...extra};return [r.id,r.name,r.email,r.store,r.start,r.status,r.effective,r.reason,r.password];};
 const request=async(source,extra={},auth={admin:true})=>call(m.bulk,'POST','/api/users/import',{csv:source,mode:'upsert',...extra},auth);
 const preview=async(source,extra={})=>{const r=await request(source,extra);assert.equal(r.status,200,await r.clone().text());return r.json();};
 const apply=async(source)=>{const p=await preview(source);assert.equal(p.valid,true,JSON.stringify(p.rows));const r=await request(source,{revision:p.revision});assert.equal(r.status,200,await r.clone().text());return r.json();};
 await check('CSV supports BOM, quoted commas/newlines, leading zeroes; rejects malformed files',async()=>{
  const parsed=m.parseLearnerCsv(csv(row('00012',{name:'Doe, Jane\nAnn'})));assert.equal(parsed[0].record.workday_id,'00012');assert.equal(parsed[0].record.name,'Doe, Jane\nAnn');
  for(const source of ['workday_id,workday_id\na,b','workday_id\n"abc','workday_id\na,b','workday_id,role\n123,platform','workday_id\n'+Array(201).fill('1').join('\n')])assert.throws(()=>m.parseLearnerCsv(source));
  assert(m.csvDownload([['=HYPERLINK("x")']]).includes("'=HYPERLINK"));
 });
 await check('Authentication, organisation scope and same-origin enforced',async()=>{
  for(const auth of [{},{user:'student'},{user:'site'},{user:'country'},{admin:true,origin:'https://evil.test'}])assert.equal((await request(csv(row('AUTH')),{},auth)).status,403);
  assert.equal((await request(csv(row('AUTH')),{},{user:'org'})).status,200);
 });
 await check('Preview is read-only and never exposes passwords',async()=>{
  const p=await preview(csv(row('00012')));assert(p.valid,JSON.stringify(p.rows));assert(!JSON.stringify(p).includes('Unique-password'));assert.equal(await one("SELECT id FROM learners WHERE workday_id='00012'"),undefined);
 });
 await check('Create hashes password and audit excludes secrets; repeated apply rejected',async()=>{
  const source=csv(row('00012'));const p=await preview(source);const r=await request(source,{revision:p.revision});assert.equal(r.status,200,await r.clone().text());
  const learner=await one("SELECT * FROM learners WHERE workday_id='00012'");assert(await m.verifyPassword('Unique-password-123',learner.password_hash));assert.equal(learner.store_id,ie.id);
  const events=await q('SELECT * FROM audit_events WHERE learner_id=$1',learner.id);assert(events.length);assert(events.some(e=>e.actor==='platform@test.invalid'));assert(!JSON.stringify(events).includes('Unique-password'));assert(!JSON.stringify(events).includes('scrypt-v1'));
  assert.equal((await request(source,{revision:p.revision})).status,409);
 });
 await check('Duplicates, conflicting identities, invalid stores, modes and dates rejected',async()=>{
  for(const source of [csv(row('DUP'),row('dup')),csv(row('ONE',{email:'same@test.invalid'}),row('TWO',{email:'same@test.invalid'})),csv(row('OTHER',{email:'00012@test.invalid'})),csv(row('BADSTORE',{store:'not-a-store'})),csv(row('BADDATE',{start:'2026-02-30'})),csv(row('BADPASS',{password:''}))])assert.equal((await preview(source)).valid,false);
  assert.equal((await preview(csv(row('00012',{password:''})),{mode:'create'})).valid,false);assert.equal((await preview(csv(row('MISSING')),{mode:'update'})).valid,false);
 });
 await check('Blank updates preserve fields and concurrent changes invalidate preview',async()=>{
  const source='workday_id,name\n00012,Updated Learner';const p=await preview(source);assert(p.valid,JSON.stringify(p.rows));assert.equal(p.rows[0].changes.length,1);
  await q("UPDATE learners SET name='Concurrent edit' WHERE workday_id='00012'");assert.equal((await request(source,{revision:p.revision})).status,409);
  await apply(source);const person=await one("SELECT * FROM learners WHERE workday_id='00012'");assert.equal(person.name,'Updated Learner');assert.equal(person.email,'00012@test.invalid');assert.equal(person.store_id,ie.id);
  assert.equal((await preview(source)).changed,0);
 });
 await check('Privileged accounts cannot be changed through learner import',async()=>{
  await q("UPDATE learners SET workday_id='ORG' WHERE id='org'");assert.equal((await preview('workday_id,name\nORG,Changed')).valid,false);
 });
 await course('bulk-training',{countries:['Ireland'],sites:[],users:[]});
 await check('Create synchronises training and updates preserve assignments',async()=>{
  await apply(csv(row('AUTO')));const learner=await one("SELECT id FROM learners WHERE workday_id='AUTO'");assert(await history(learner.id,'bulk-training'));
  const h=await history(learner.id,'bulk-training');await apply('workday_id,name\nAUTO,New Name');assert.equal((await history(learner.id,'bulk-training')).id,h.id);
 });
 await check('Transfer, leave and rejoin retain evidence and invalidate access',async()=>{
  const learner=await one("SELECT id FROM learners WHERE workday_id='AUTO'");const h=await history(learner.id,'bulk-training');
  await q('INSERT INTO sessions VALUES($1,$2,$3)','session-test',learner.id,'2099-01-01');
  await apply(csv(row('AUTO',{name:'',email:'',store:other.storeCode,start:'',password:'',effective:'2026-10-01',reason:'Store move'})));
  assert.equal((await one('SELECT store_id FROM learners WHERE id=$1',learner.id)).store_id,other.id);assert.equal((await q('SELECT * FROM sessions WHERE learner_id=$1',learner.id)).length,0);
  await apply(csv(row('AUTO',{name:'',email:'',store:'',start:'',password:'',status:'leaver',effective:'2026-10-02',reason:'Left business'})));
  assert((await one('SELECT archived_at FROM learners WHERE id=$1',learner.id)).archived_at);assert(await history(learner.id,'bulk-training'));
  assert.equal((await preview('workday_id,name\nAUTO,Silent restore')).valid,false);
  await apply(csv(row('AUTO',{name:'',email:'',store:ie.storeCode,start:'',password:'',status:'rejoin',effective:'2026-10-03',reason:'Returned to business'})));
  const p=await one('SELECT * FROM learners WHERE id=$1',learner.id);assert.equal(p.archived_at,null);assert.equal(p.employment_ended_on,null);assert.equal((await history(learner.id,'bulk-training')).id,h.id);
 });
 await check('Automatic pathways apply to imported joiners without duplicate enrolments',async()=>{
  await q('UPDATE organisation_settings SET pathways_enabled=true');
  await q("INSERT INTO learning_pathways(id,name,items,updated_by,assignment_rule) VALUES('bulk-path','Bulk pathway',$1,'test',$2)",JSON.stringify([{courseId:'bulk-training',stage:1}]),JSON.stringify({enabled:true,scope:'all',countries:[],sites:[],startedFrom:null,startedTo:null}));
  await apply(csv(row('PATH')));const learner=await one("SELECT id FROM learners WHERE workday_id='PATH'");
  assert.equal((await q("SELECT * FROM pathway_enrolments WHERE learner_id=$1 AND pathway_id='bulk-path'",learner.id)).length,1);
  await apply('workday_id,name\nPATH,Updated Path Learner');assert.equal((await q("SELECT * FROM pathway_enrolments WHERE learner_id=$1 AND pathway_id='bulk-path'",learner.id)).length,1);
 });
 await check('Invalid batch applies nothing',async()=>{
  const source=csv(row('GOOD'),row('BAD',{store:'missing'}));const p=await preview(source);assert(!p.valid);assert.equal((await request(source,{revision:p.revision})).status,400);assert.equal(await one("SELECT id FROM learners WHERE workday_id='GOOD'"),undefined);
 });
 await check('Mid-batch database failure rolls back accounts and audit entries',async()=>{
  await pg.exec("CREATE FUNCTION reject_bulk_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.workday_id='FAIL' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER reject_bulk_fixture BEFORE INSERT ON learners FOR EACH ROW EXECUTE FUNCTION reject_bulk_fixture();");
  const source=csv(row('ROLLBACK'),row('FAIL'));const p=await preview(source);assert(p.valid,JSON.stringify(p.rows));const r=await request(source,{revision:p.revision});assert.equal(r.status,409);assert.equal(await one("SELECT id FROM learners WHERE workday_id='ROLLBACK'"),undefined);assert.equal((await q("SELECT * FROM audit_events WHERE next_state->>'workday_id'='ROLLBACK'")).length,0);
 });
 console.log(`PASS ${checks} bulk learner import checks`);
}finally{await pg.close();rmSync(dir,{recursive:true,force:true});}
