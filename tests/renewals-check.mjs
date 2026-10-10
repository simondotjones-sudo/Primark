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
writeFileSync(entry,`export * as renew from '${process.cwd()}/app/api/courses/renew/route.ts';
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
const current=(await one('SELECT now() AS at')).at;
const expiry=days=>new Date(current.getTime()+days*86400000).toISOString();
async function complete(id,cid,days=20){
 await assign(id,cid);
 await q("INSERT INTO scorm_progress(learner_id,package_id,sco_id,status,completed_at,updated_at,data_json,total_centiseconds) VALUES($1,$2,'sco','passed',$3,$3,$4,4500)",id,cid+'-pack',expiry(-350),JSON.stringify({'cmi.suspend_data':'retained answers','cmi.core.score.raw':'95'}));
 await q('SELECT issue_course_certificate($1,$2)',id,cid+'-pack');
 await q('UPDATE certificates SET expires_at=$3 WHERE learner_id=$1 AND course_id=$2 AND archived_at IS NULL',id,cid,days===null?null:expiry(days));
 return one('SELECT * FROM certificates WHERE learner_id=$1 AND course_id=$2 AND archived_at IS NULL',id,cid);
}
const rule=async(source,target,country='Ireland')=>q('INSERT INTO course_refresher_rules VALUES($1,$2,$3)',source,country,target);
const auto=async(token,at=current.toISOString())=>(await one('SELECT assign_course_refresher($1,$2::timestamptz) AS result',token,at)).result;
await q("SELECT ensure_store_credits('renewal-store','Renewal store','Ireland')");
for(const c of ['original','refresher','ordinary'])await course(c);
await rule('original','refresher');
await check('Migration configures induction 154 → 209 for UK and Ireland only, without publishing content',async()=>{
 const rules=await q("SELECT r.country,s.source_course_id AS source,t.source_course_id AS target,t.status FROM course_refresher_rules r JOIN courses s ON s.id=r.source_course_id JOIN courses t ON t.id=r.refresher_course_id WHERE s.source_course_id='154' ORDER BY r.country");
 assert.deepEqual(rules.map(r=>[r.country,r.source,r.target]),[['Ireland','154','209'],['United Kingdom','154','209']]);assert(rules.every(r=>r.status==='draft'));
});
await check('The warning and reset window includes exactly 30 days, expired dates and no unconfigured expiry',async()=>{
 assert.equal(m.renewalDays(expiry(30),current.getTime()),30);assert.equal(m.renewalDays(expiry(30.00001),current.getTime()),null);
 assert.equal(m.renewalDays(expiry(0.1),current.getTime()),1);assert.equal(m.renewalDays(expiry(-1),current.getTime()),0);assert.equal(m.renewalDays(null),null);
 await person('boundary','renewal-store');const cert=await complete('boundary','ordinary',30);
 await assert.rejects(assign('boundary','ordinary',new Date(current.getTime()-1).toISOString(),true),/30 days/);
 assert.equal((await assign('boundary','ordinary',current.toISOString(),true)).added,true);
 await person('permanent','renewal-store');await complete('permanent','ordinary',null);
 await assert.rejects(assign('permanent','ordinary',current.toISOString(),true),/30 days/);
});
await check('Self-renewal charges once, retains the previous date, certificate and full progress, and invalidates stale launches',async()=>{
 await person('self','renewal-store');const cert=await complete('self','ordinary');const previous=await history('self','ordinary');
 const launch=await call(m.runtime,'POST','/api/scorm',{action:'launch',courseId:'ordinary'},{user:'self'});assert.equal(launch.status,200);const token=(await launch.json()).token;
 const before=await balance('renewal-store');const body={courseId:'ordinary',certificateToken:cert.token};
 const r=await call(m.renew,'POST','/api/courses/renew',body,{user:'self'});assert.equal(r.status,200,await r.clone().text());
 const h=await history('self','ordinary');assert.equal(h.previous_id,previous.id);assert.equal(h.source,'self-renewal');assert.equal(await balance('renewal-store'),before-1);
 const old=await one('SELECT * FROM certificates WHERE token=$1',cert.token);assert(old.archived_at);assert.equal(old.completed_at,cert.completed_at);assert.equal(old.expires_at,cert.expires_at);
 const evidence=await one('SELECT * FROM assignment_history WHERE id=$1',previous.id);assert.equal(evidence.progress_snapshot[0].total_centiseconds,4500);assert.equal(JSON.parse(evidence.progress_snapshot[0].data_json)['cmi.suspend_data'],'retained answers');assert(evidence.completed_at);
 assert.equal((await q("SELECT * FROM scorm_progress WHERE learner_id='self'")).length,0);
 assert.equal((await call(m.renew,'POST','/api/courses/renew',body,{user:'self'})).status,409);assert.equal(await balance('renewal-store'),before-1);
 assert.notEqual((await call(m.runtime,'POST','/api/scorm',{action:'save',token,sequence:1,data:{'cmi.core.lesson_status':'passed'}},{user:'self'})).status,200);
 const list=await call(m.courses,'GET','/api/courses',null,{user:'self'});assert.equal(list.status,200,await list.clone().text());const item=(await list.json()).courses.find(c=>c.id==='ordinary');assert.equal(item.status,'Not started');assert.equal(item.certificate,null);assert.equal(item.renewal.previousCertificate.token,cert.token);
});
await check('Renewal enforces ownership, CSRF, live role, active account and current certificate',async()=>{
 await person('owner','renewal-store');const cert=await complete('owner','ordinary');const body={courseId:'ordinary',certificateToken:cert.token};
 const before=await balance('renewal-store');
 for(const [options,status] of [[{},401],[{user:'self'},409],[{user:'owner',origin:'https://evil.invalid'},403]])assert.equal((await call(m.renew,'POST','/api/courses/renew',body,options)).status,status);
 await q("INSERT INTO reporting_access VALUES('owner','organisation',NULL,NULL,'test','2026-01-01')");assert.equal((await call(m.renew,'POST','/api/courses/renew',body,{user:'owner'})).status,403);
 await q("DELETE FROM reporting_access WHERE learner_id='owner'");await q("UPDATE learners SET archived_at='2026-10-01' WHERE id='owner'");assert.equal((await call(m.renew,'POST','/api/courses/renew',body,{user:'owner'})).status,401);
 assert.equal(await balance('renewal-store'),before);
});
await check('Country substitution charges one credit and retains the entire original completion',async()=>{
 await person('auto','renewal-store');const cert=await complete('auto','original',30),before=await balance('renewal-store');
 await assert.rejects(assign('auto','original',current.toISOString(),true),/refresher course/);
 assert.equal(await auto(cert.token,new Date(current.getTime()-1).toISOString()),'not_due');
 assert.equal(await auto(cert.token),'assigned');assert.equal(await auto(cert.token),'already_assigned');
 assert.equal(await balance('renewal-store'),before-1);assert.deepEqual(await one('SELECT * FROM certificates WHERE token=$1',cert.token),cert);
 assert.equal((await q("SELECT * FROM scorm_progress WHERE learner_id='auto' AND package_id='original-pack'")).length,1);
 assert.equal((await history('auto','original')).progress_snapshot.length,1);
 const rows=await m.renewal.courseRenewalsFor('auto');assert.equal(rows.get('original').canRenew,false);assert.equal(rows.get('original').refresher.courseId,'refresher');assert.equal(rows.get('original').refresher.status,'assigned');
});
await check('Another country and a country transfer cannot receive an Ireland-only refresher',async()=>{
 await person('outside','renewal-store','France');let cert=await complete('outside','original');assert.equal(await auto(cert.token),'not_due');
 await q("UPDATE learners SET country='Ireland' WHERE id='outside'");assert.equal(await auto(cert.token),'assigned');
 await person('transfer','renewal-store');cert=await complete('transfer','original');await q("UPDATE learners SET country='France' WHERE id='transfer'");assert.equal(await auto(cert.token),'not_due');
});
await check('An already assigned refresher is reused without another debit',async()=>{
 await person('existing-ref','renewal-store');const cert=await complete('existing-ref','original');await assign('existing-ref','refresher');const before=await balance('renewal-store'),h=await history('existing-ref','refresher');
 assert.equal(await auto(cert.token),'assigned');assert.equal(await balance('renewal-store'),before);assert.equal((await one('SELECT assignment_id FROM course_refresher_assignments WHERE certificate_token=$1',cert.token)).assignment_id,h.id);
});
await check('Unavailable content stays pending and is retryable after publication',async()=>{
 await person('unavailable','renewal-store');const cert=await complete('unavailable','original'),before=await balance('renewal-store');
 await q("UPDATE courses SET status='draft' WHERE id='refresher'");assert.equal(await auto(cert.token),'unavailable');assert.equal(await balance('renewal-store'),before);
 assert.equal((await m.renewal.courseRenewalsFor('unavailable')).get('original').refresher.available,false);
 await q("UPDATE courses SET status='published' WHERE id='refresher'");assert.equal(await auto(cert.token),'assigned');
});
await check('Insufficient credits leave all evidence unchanged and a top-up permits one retry',async()=>{
 await person('low','renewal-store');const cert=await complete('low','original');await q("UPDATE store_credit_accounts SET balance=0 WHERE store_id='renewal-store'");
 assert.equal(await auto(cert.token),'no_credits');assert.equal(await history('low','refresher'),undefined);assert.deepEqual(await one('SELECT * FROM certificates WHERE token=$1',cert.token),cert);
 await q("UPDATE store_credit_accounts SET balance=50 WHERE store_id='renewal-store'");assert.equal(await auto(cert.token),'assigned');assert.equal(await balance('renewal-store'),49);
});
await check('A removed automatic refresher is refunded once and never resurrected by repeated checks',async()=>{
 const h=await history('auto','refresher'),cert=await one("SELECT * FROM certificates WHERE learner_id='auto' AND course_id='original'");const before=await balance('renewal-store');
 await q('SELECT cancel_credit_assignment($1,$2,$3,$4::timestamptz)',h.id,'manager','Assigned in error',current.toISOString());assert.equal(await balance('renewal-store'),before+1);
 assert.equal(await auto(cert.token),'already_assigned');assert.equal(await history('auto','refresher'),undefined);assert.equal((await m.renewal.courseRenewalsFor('auto')).get('original').refresher.status,'removed');
});
await check('Manual removal exclusions also block an initial refresher assignment',async()=>{
 await person('excluded','renewal-store');const cert=await complete('excluded','original');await assign('excluded','refresher');const h=await history('excluded','refresher');await q('SELECT cancel_credit_assignment($1,$2,$3)',h.id,'manager','Not required');
 const before=await balance('renewal-store');assert.equal(await auto(cert.token),'excluded');assert.equal(await balance('renewal-store'),before);
});
await check('An expiring existing refresher is renewed with its own history and credit',async()=>{
 await person('old-ref','renewal-store');const source=await complete('old-ref','original'),old=await complete('old-ref','refresher',-1),before=await balance('renewal-store');
 assert.equal(await auto(source.token),'assigned');assert.equal(await balance('renewal-store'),before-1);assert.equal((await history('old-ref','refresher')).previous_id,old.assignment_id);assert((await one('SELECT archived_at FROM certificates WHERE token=$1',old.token)).archived_at);
});
await check('The scheduled batch processes eligible learners and reuses durable events',async()=>{
 await person('batch','renewal-store');await complete('batch','original');const before=await balance('renewal-store');
 const first=await m.renewal.syncCourseRefreshers('batch');assert.equal(first.assigned,1);assert.equal(await balance('renewal-store'),before-1);const second=await m.renewal.syncCourseRefreshers('batch');assert.equal(second.checked,0);
});
await check('Refresher configuration is platform-only, validates course/country IDs and survives course saves',async()=>{
 const c=await one("SELECT * FROM courses WHERE id='ordinary'"),base={id:c.id,revision:c.revision,title:c.title,description:'',audience:{countries:[],sites:[],users:[]},status:'published'};
 const rules=[{country:'Ireland',courseId:'refresher'}];
 assert.equal((await call(m.admin,'POST','/api/admin/courses',{...base,refresherRules:rules},{user:'self'})).status,403);
 for(const bad of [[{country:'Ireland',courseId:'ordinary'}],[...rules,...rules],[{country:'Nowhere',courseId:'refresher'}],[{country:'Ireland',courseId:'missing'}]])assert.equal((await call(m.admin,'POST','/api/admin/courses',{...base,refresherRules:bad},{admin:true})).status,400);
 const response=await call(m.admin,'POST','/api/admin/courses',{...base,refresherRules:rules},{admin:true});assert.equal(response.status,200,await response.clone().text());const saved=(await response.json()).course;assert.deepEqual(saved.refresher_rules,rules);
 const old=(await call(m.admin,'POST','/api/admin/courses',{...base,refresherRules:[]},{admin:true}));assert.equal(old.status,409);
 const keep=await call(m.admin,'POST','/api/admin/courses',{...base,revision:saved.revision},{admin:true});assert.equal(keep.status,200);assert.deepEqual((await keep.json()).course.refresher_rules,rules);
});

await check('A self-renewal without credits leaves the current certificate and progress untouched',async()=>{
 await course('normal-next');await person('no-credit-self','self-empty');const cert=await complete('no-credit-self','normal-next');const h=await history('no-credit-self','normal-next');
 await q("UPDATE store_credit_accounts SET balance=0 WHERE store_id='self-empty'");
 const r=await call(m.renew,'POST','/api/courses/renew',{courseId:'normal-next',certificateToken:cert.token},{user:'no-credit-self'});assert.equal(r.status,409);
 assert.equal(await balance('self-empty'),0);assert.deepEqual(await history('no-credit-self','normal-next'),h);assert.deepEqual(await one('SELECT * FROM certificates WHERE token=$1',cert.token),cert);assert.equal((await q("SELECT * FROM scorm_progress WHERE learner_id='no-credit-self'")).length,1);
});
await check('The expiry warning survives replacing a course package',async()=>{
 await person('new-package','renewal-store');const cert=await complete('new-package','normal-next');
 await q("INSERT INTO course_packages(id,course_id,filename,status,scos_json,file_count,total_bytes,created_at) SELECT 'replacement-pack',course_id,filename,status,scos_json,file_count,total_bytes,created_at FROM course_packages WHERE id='normal-next-pack'");await q("UPDATE courses SET package_id='replacement-pack' WHERE id='normal-next'");
 const response=await call(m.courses,'GET','/api/courses',null,{user:'new-package'});assert.equal(response.status,200);const c=(await response.json()).courses.find(c=>c.id==='normal-next');assert.equal(c.certificate.token,cert.token);assert.equal(c.renewal.canRenew,true);
});
await check('Completing the refresher resolves the original tile without changing its certificate',async()=>{
 const before=await one("SELECT * FROM certificates WHERE learner_id='existing-ref' AND course_id='original'");
 const launch=await call(m.runtime,'POST','/api/scorm',{action:'launch',courseId:'refresher'},{user:'existing-ref'});assert.equal(launch.status,200);const {token}=await launch.json();
 const save=await call(m.runtime,'POST','/api/scorm',{action:'save',token,sequence:1,data:{'cmi.core.lesson_status':'passed','cmi.core.session_time':'0000:01:00.00'}},{user:'existing-ref'});assert.equal(save.status,200,await save.clone().text());
 const data=await (await call(m.courses,'GET','/api/courses',null,{user:'existing-ref'})).json();const original=data.courses.find(c=>c.id==='original');assert.equal(original.renewal.refresher.status,'completed');assert.equal(original.renewal.canRenew,false);assert.equal(original.status,'Completed');
 assert.deepEqual(await one('SELECT * FROM certificates WHERE token=$1',before.token),before);
});
await check('The scheduled batch continues past a store without credits and respects archived accounts',async()=>{
 for(const [id,store]of [['batch-empty','batch-empty-store'],['batch-funded','batch-funded-store'],['batch-archived','batch-archive-store']]){await person(id,store);await complete(id,'original');}
 await q("UPDATE store_credit_accounts SET balance=0 WHERE store_id='batch-empty-store'");await q("UPDATE learners SET archived_at='2026-10-01' WHERE id='batch-archived'");
 const result=await m.renewal.syncCourseRefreshers();assert.equal(result.failed,0);assert.equal(await history('batch-empty','refresher'),undefined);assert(await history('batch-funded','refresher'));assert.equal(await history('batch-archived','refresher'),undefined);
 await q("UPDATE store_credit_accounts SET balance=10 WHERE store_id='batch-empty-store'");await q("UPDATE course_refresher_assignments SET attempted_at=now()-interval '16 minutes' WHERE certificate_token IN (SELECT token FROM certificates WHERE learner_id='batch-empty')");
 assert.equal((await m.renewal.syncCourseRefreshers('batch-empty')).assigned,1);assert.equal(await balance('batch-empty-store'),9);
});
await check('Rendered tiles expose renewal, refresher and history actions for the correct states',async()=>{
 const file=join(dir,'ui.cjs');await build({stdin:{contents:`import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Notice from './components/course-renewal-notice';export const render=(props)=>renderToStaticMarkup(createElement(Notice,props));`,resolveDir:process.cwd()},outfile:file,bundle:true,platform:'node',format:'cjs',tsconfig:'tsconfig.json'});
 const {render}=await import(file),base={certificate:{expiresAt:expiry(20)},renewal:{canRenew:true,previousCertificate:null,refresher:null},onRenew:()=>{}};
 assert.match(render(base),/Expires in 20 days/);assert.match(render(base),/Restart course/);
 assert.doesNotMatch(render({...base,certificate:{expiresAt:expiry(31)}}),/Restart course|Expires in/);
 assert.doesNotMatch(render({...base,certificate:null}),/Restart course|Expires in/);
 const linked={courseId:'refresher',title:'Induction refresher',status:'assigned',available:true};
 const assigned=render({...base,renewal:{...base.renewal,canRenew:false,refresher:linked}});assert.match(assigned,/href="\/learn\/refresher\/"/);assert.doesNotMatch(assigned,/Restart course/);
 const done=render({...base,renewal:{...base.renewal,canRenew:false,refresher:{...linked,status:'completed'}}});assert.match(done,/Refresher completed/);assert.doesNotMatch(done,/Expires in/);
 const pending=render({...base,renewal:{...base.renewal,canRenew:false,refresher:{...linked,status:'pending',available:false}}});assert.match(pending,/Contact your Store Manager/);assert.doesNotMatch(pending,/href=|Restart course/);
 const history=render({...base,certificate:null,renewal:{canRenew:false,refresher:null,previousCertificate:{token:'previous-token',completedAt:expiry(-365)}}});assert.match(history,/Previous completion/);assert.match(history,/href="\/certificates\/previous-token\/"/);
});
console.log(`${checks} renewal and refresher checks passed in isolated PostgreSQL.`);
await pg.close();rmSync(dir,{recursive:true,force:true});
