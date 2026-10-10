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
const pool={async query(sql,args=[]){const r=await pg.query(sql,args);return {rows:r.rows,rowCount:r.rowCount??r.affectedRows};},async connect(){return {...this,release(){}};}};
globalThis.__creditTest={pool,identity:()=>context.getStore()?.admin?{email:'platform@test.invalid'}:null,cookie:()=>context.getStore()?.user||''};
const dir=mkdtempSync(join(tmpdir(),'primark-credit-check-')),entry=join(dir,'entry.ts');
writeFileSync(entry,`export * as pathways from '${process.cwd()}/app/api/pathways/route.ts';
 export * as settings from '${process.cwd()}/app/api/admin/settings/route.ts';
 export * as quiz from '${process.cwd()}/app/api/courses/quiz/route.ts';
 export * as access from '${process.cwd()}/lib/course-access.ts';
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
 b.onLoad({filter:/.*/,namespace:'test'},a=>({contents:a.path==='db'?'export const getDatabase=()=>({pool:globalThis.__creditTest.pool});':a.path==='auth'?'export const getAdminUser=async()=>globalThis.__creditTest.identity();export const credentials=()=>null;':a.path==='cookies'?"export const cookies=async()=>({get:n=>n==='primark_session'&&globalThis.__creditTest.cookie()?{value:globalThis.__creditTest.cookie()}:undefined});":'export class NextRequest extends Request {}; export const NextResponse=Response;',loader:'js'}));
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
 const path=(action,body={},who={admin:true})=>call(m.pathways,'POST','/api/pathways',{action,...body},who);
 const get=(mode,who={admin:true},query='')=>call(m.pathways,'GET','/api/pathways?mode='+mode+query,null,who);
 const save=(name,items,extra={},who={admin:true})=>path('save',{name,description:'Training programme',items,deadline_days:30,award_certificate:true,archived:false,...extra},who);
 const enroll=(id,learnerIds=['student'],extra={})=>path('assign',{pathwayId:id,learnerIds,...extra});
 const savedId=async response=>{const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data.id;};
 const complete=async(person,cid)=>{const stamp=new Date().toISOString();await q("INSERT INTO scorm_progress(learner_id,package_id,sco_id,status,completed_at,updated_at) VALUES($1,$2,'sco','passed',$3,$3) ON CONFLICT(learner_id,package_id,sco_id) DO UPDATE SET status='passed',completed_at=$3",person,cid+'-pack',stamp);await q('SELECT issue_course_certificate($1,$2)',person,cid+'-pack');};
 for(const id of ['student','other','org','country','site','third','fourth'])await person(id);
 await q("INSERT INTO reporting_access(learner_id,scope,country,site_id,assigned_by,updated_at) VALUES('org','organisation',NULL,NULL,'test','2026-01-01'),('country','country','Ireland',NULL,'test','2026-01-01'),('site','site','Ireland','credit-ie','test','2026-01-01')");
 for(const id of ['intro','fire','manual','other-course'])await course(id);
 const items=[{courseId:'intro',stage:1},{courseId:'fire',stage:2},{courseId:'manual',stage:2}];
 assert.equal((await save('Disabled',items)).status,403);
 let settings=await one('SELECT * FROM organisation_settings');
 assert.equal((await call(m.settings,'POST','/api/admin/settings',{pathways_enabled:true,revision:settings.revision},{user:'org'})).status,403);
 assert.equal((await call(m.settings,'POST','/api/admin/settings',{pathways_enabled:true,revision:settings.revision},{admin:true})).status,200);
 assert.equal((await get('manage',{user:'student'})).status,403);
 assert.equal((await save('No',items,{}, {user:'country'})).status,403);
 assert.equal((await save('No',items,{}, {user:'site'})).status,403);
 assert.equal((await path('save',{},{admin:true,origin:'https://evil.invalid'})).status,403);
 assert.equal((await save('Bad',[...items,items[0]])).status,400);
 assert.equal((await save('Bad',items,{deadline_days:0})).status,400);
 const pid=await savedId(await save('First then any',items,{}, {user:'org'}));

 // Start with an existing assignment and its earlier course deadline.
 await q("UPDATE courses SET deadline_days=7 WHERE id='intro'");await assign('student','intro');
 const h0=await history('student','intro'),b0=await balance();
 let result=await enroll(pid);assert.equal(result.status,200,await result.text());
 assert.equal(await balance(),b0-2);
 assert.equal((await history('student','intro')).id,h0.id);
 assert.equal(String((await history('student','intro')).due_at),String(h0.due_at));
 assert.equal((await one("SELECT pathway_course_unlocked('student','intro') unlocked")).unlocked,true);
 assert.equal((await one("SELECT pathway_course_unlocked('student','fire') unlocked")).unlocked,false);
 let tiles=await (await call(m.courses,'GET','/api/courses',null,{user:'student'})).json();assert.equal(tiles.courses.find(c=>c.id==='fire').pathwayLocked,true);
 assert.equal((await call(m.runtime,'POST','/api/scorm',{action:'launch',courseId:'fire'},{user:'student'})).status,403);
 assert.equal((await call(m.quiz,'GET','/api/courses/quiz?courseId=fire',null,{user:'student'})).status,404);
 const before=await balance();result=await enroll(pid);assert.equal(result.status,200);assert.equal((await result.json()).existing,1);assert.equal(await balance(),before);
 await assert.rejects(q('SELECT cancel_credit_assignment($1,$2,$3)',(await history('student','fire')).id,'manager','Assigned by mistake'),/required by an assigned pathway/);
 // Course edits cannot change the enrolled version, deadline, or ordering.
 assert.equal((await save('Edited',[{courseId:'other-course',stage:1}],{id:pid,revision:1,deadline_days:99})).status,200);
 assert.equal((await save('Stale',items,{id:pid,revision:1})).status,409);
 let e=await one('SELECT * FROM pathway_enrolments WHERE pathway_id=$1 AND learner_id=$2',pid,'student');assert.equal(e.name,'First then any');assert.equal(e.pathway_revision,1);
 const conflict=await savedId(await save('Reverse',[{courseId:'fire',stage:1},{courseId:'intro',stage:2}]));
 result=await enroll(conflict);assert.equal(result.status,400,await result.text());assert.equal((await q('SELECT id FROM pathway_enrolments WHERE pathway_id=$1',conflict)).length,0);assert.equal(await balance(),before);
 await complete('student','intro');assert.equal((await one("SELECT pathway_course_unlocked('student','fire') unlocked")).unlocked,true);
 assert.equal((await one("SELECT pathway_course_unlocked('student','manual') unlocked")).unlocked,true);
 await complete('student','fire');await complete('student','manual');
 e=await one('SELECT * FROM pathway_enrolments WHERE id=$1',e.id);assert.ok(e.completed_at);assert.ok(e.certificate_token);
 const token=e.certificate_token;
 // Expiry preserves pathway achievement, while reporting indicates expiry.
 await q("UPDATE certificates SET expires_at='2000-01-01' WHERE learner_id='student' AND course_id='fire'");
 let mine=await (await get('mine',{user:'student'})).json();assert.equal(mine.rows.length,1);assert.equal(mine.rows[0].certificate_token,token);assert.equal(mine.rows[0].courses.find(c=>c.courseId==='fire').expired,true);
 assert.equal((await (await get('mine',{user:'other'})).json()).rows.length,0);
 assert.equal((await get('report',{user:'student'})).status,403);
 assert.equal((await get('report',{user:'country'},'&role=global')).status,403);
 assert.equal((await get('report',{user:'site'},'&role=global')).status,403);
 assert.equal((await get('report',{user:'org'})).status,200);
 // A valid completion is reused without credits or a duplicate course assignment.
 const reused=await savedId(await save('Reuse',[{courseId:'intro',stage:1}],{award_certificate:false}));
 const reuseBalance=await balance();assert.equal((await enroll(reused)).status,200);assert.equal(await balance(),reuseBalance);
 const reuseRow=await one('SELECT * FROM pathway_enrolments WHERE pathway_id=$1',reused);assert.ok(reuseRow.completed_at);assert.equal(reuseRow.certificate_token,null);
 // Atomic bulk assignment: one unavailable country rolls back all users and charges.
 await q("UPDATE courses SET catalogue_scope='countries',available_countries_json='[\"Ireland\"]' WHERE id='other-course'");await q("UPDATE learners SET country='France' WHERE id='other'");
 result=await enroll(pid,['fourth','other']);assert.equal(result.status,400);assert.equal((await q('SELECT * FROM pathway_enrolments WHERE pathway_id=$1 AND learner_id<>$2',pid,'student')).length,0);
 assert.equal((await q("SELECT * FROM course_assignments WHERE learner_id='fourth' AND course_id='other-course'")).length,0);
 // Fixed dates use the full London day; impossible and past dates fail.
 assert.equal((await enroll(pid,['fourth'],{dueDate:'2027-02-30'})).status,400);
 assert.equal((await enroll(pid,['fourth'],{dueDate:'2000-01-01'})).status,400);
 result=await enroll(pid,['fourth'],{dueDate:'2030-06-01'});assert.equal(result.status,200,await result.text());
 const fixed=await one("SELECT due_at::text due FROM pathway_enrolments WHERE learner_id='fourth'");assert.match(fixed.due,/2030-06-01 22:59:59.999/);
 // Required assessment must finish before the next stage opens or a pathway is awarded.
 await q("UPDATE courses SET assessor_required=true WHERE id='manual'");
 const practical=await savedId(await save('Practical',[{courseId:'manual',stage:1},{courseId:'other-course',stage:2}]));
 assert.equal((await enroll(practical,['third'])).status,200);await complete('third','manual');
 assert.equal((await one("SELECT pathway_course_unlocked('third','other-course') unlocked")).unlocked,false);
 mine=await (await get('mine',{user:'third'})).json();assert.equal(mine.rows[0].courses[0].awaitingAssessment,true);assert.equal(mine.rows[0].completed_at,null);
 await person('assessor');await q("INSERT INTO assessor_accounts VALUES('assessor',false)");await q("INSERT INTO assessor_grants(id,learner_id,course_id,site_id,qualification,assigned_by) VALUES('grant','assessor','manual','*','Qualified','admin')");
 const h=await history('third','manual');await q('SELECT record_practical_assessment($1,$2,$3,$4,true,$5)',h.id,'assessor','pass',new Date().toISOString().slice(0,10),'');
 assert.equal((await one("SELECT pathway_course_unlocked('third','other-course') unlocked")).unlocked,true);await complete('third','other-course');
 assert.ok((await one("SELECT completed_at FROM pathway_enrolments WHERE learner_id='third'")).completed_at);
 const assessment=(await history('third','manual')).passed_assessment_id;
 assert.equal((await call(m.assessor,'POST','/api/assessor',{action:'revoke',id:assessment,reason:'Wrong assessment'},{admin:true})).status,200);
 assert.equal((await one("SELECT completed_at FROM pathway_enrolments WHERE learner_id='third'")).completed_at,null);
 // An insufficient-credit failure rolls back both the enrolment and all course assignments.
 await person('no-credit');await q("SELECT ensure_store_credits('credit-ie','Test','Ireland')");
 const savedBalance=await balance();await q("UPDATE store_credit_accounts SET balance=0 WHERE store_id='credit-ie'");
 result=await enroll(pid,['no-credit']);assert.equal(result.status,409);
 assert.equal((await q("SELECT * FROM pathway_enrolments WHERE learner_id='no-credit'")).length,0);
 assert.equal((await q("SELECT * FROM course_assignments WHERE learner_id='no-credit'")).length,0);
 await q("UPDATE store_credit_accounts SET balance=$1 WHERE store_id='credit-ie'",savedBalance);
 // Expired existing completion is renewed and charged once, while its old pathway award stays intact.
 const renewalPath=await savedId(await save('Renew expired fire',[{courseId:'fire',stage:1}]));
 const oldFire=(await history('student','fire')).id,renewBalance=await balance();
 assert.equal((await enroll(renewalPath)).status,200);assert.equal(await balance(),renewBalance-1);
 assert.notEqual((await history('student','fire')).id,oldFire);
 assert.equal((await one('SELECT certificate_token FROM pathway_enrolments WHERE id=$1',e.id)).certificate_token,token);
 assert.equal((await one('SELECT completed_at FROM pathway_enrolments WHERE pathway_id=$1',renewalPath)).completed_at,null);
 // Disable preserves learner access/history but blocks new assignments and reports.
 await q('UPDATE organisation_settings SET pathways_enabled=false');assert.equal((await enroll(pid,['other'])).status,403);
 mine=await (await get('mine',{user:'student'})).json();assert.equal(mine.enabled,true);assert.equal(mine.rows.length,3);
 assert.equal((await (await get('report',{user:'org'})).json()).enabled,false);
 console.log('PASS pathways: enablement, admin roles, CSRF, validation, stage locks, direct launch denial, quiz denial, credits/reuse, idempotency, cancellation guard, snapshots, conflict rollback, completion/certificates, expiry history, report scope, fixed deadlines, atomic bulk assignment, assessor gating/revocation and disablement.');
}finally{await pg.close();rmSync(dir,{recursive:true,force:true});delete globalThis.__creditTest;}
