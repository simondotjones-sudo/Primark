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
const blobStores=new Map();
globalThis.__evidenceTest={buildContext:{context:'production',branch:'evidence-test'},failWrite:false,failDelete:false,store({name}){
 if(!blobStores.has(name))blobStores.set(name,new Map());const values=blobStores.get(name);
 return {async set(key,value,{onlyIfNew}={}){if(globalThis.__evidenceTest.failWrite)throw Error('Simulated storage failure');if(onlyIfNew&&values.has(key))return {modified:false};values.set(key,value.slice(0));return {modified:true};},async get(key){return values.get(key)?.slice(0)??null;},async delete(key){if(globalThis.__evidenceTest.failDelete)throw Error('Simulated deletion failure');values.delete(key);}};
}};
const dir=mkdtempSync(join(tmpdir(),'primark-credit-check-')),entry=join(dir,'entry.ts');
writeFileSync(entry,`export * as settings from '${process.cwd()}/app/api/admin/settings/route.ts';
 export * as imports from '${process.cwd()}/app/api/users/import/route.ts';
 export * as features from '${process.cwd()}/lib/features.ts';
 export * as renewals from '${process.cwd()}/lib/course-renewals.ts';
 export * as pathways from '${process.cwd()}/app/api/pathways/route.ts';
 export * as evidence from '${process.cwd()}/app/api/assessor/evidence/route.ts';
 export * as evidenceFile from '${process.cwd()}/app/api/assessor/evidence/[id]/route.ts';
 export * as evidenceLib from '${process.cwd()}/lib/assessment-evidence.ts';
 export * as assessor from '${process.cwd()}/app/api/assessor/route.ts';
 export {hash} from '${process.cwd()}/lib/server.ts';`);
await build({entryPoints:[entry],outfile:join(dir,'bundle.mjs'),bundle:true,platform:'node',format:'esm',tsconfig:'tsconfig.json',plugins:[{name:'test',setup(b){
 b.onResolve({filter:/^@netlify\/blobs$/},()=>({path:'blobs',namespace:'test'}));
 b.onResolve({filter:/deploy-context\.json$/},()=>({path:'context',namespace:'test'}));
 b.onResolve({filter:/^@netlify\/database$/},()=>({path:'db',namespace:'test'}));
 b.onResolve({filter:/^@\/lib\/admin-auth$/},()=>({path:'auth',namespace:'test'}));
 b.onResolve({filter:/^next\/headers$/},()=>({path:'cookies',namespace:'test'}));
 b.onResolve({filter:/^next\/server$/},()=>({path:'next',namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},a=>({contents:a.path==='context'?'export default globalThis.__evidenceTest.buildContext;':a.path==='blobs'?'export const getStore=options=>globalThis.__evidenceTest.store(options);':a.path==='db'?'export const getDatabase=()=>({pool:globalThis.__creditTest.pool});':a.path==='auth'?'export const getAdminUser=async()=>globalThis.__creditTest.identity();export const credentials=()=>null;':a.path==='cookies'?"export const cookies=async()=>({get:n=>n==='primark_session'&&globalThis.__creditTest.cookie()?{value:globalThis.__creditTest.cookie()}:undefined});":'export class NextRequest extends Request {}; export const NextResponse=Response;',loader:'js'}));
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
const pdf='%PDF-1.4\nSigned practical assessment fixture\n%%EOF';
const file=(name='assessment.pdf',bytes=pdf,type='application/pdf')=>new File([bytes],name,{type});
async function evidenceCall(method,assignment,{user='assessor',admin=false,origin='https://local.test',upload=file(),id}={}){
 return context.run({user,admin},async()=>{
  const form=new FormData();if(upload)form.set('file',upload);
  const req=new Request('https://local.test/api/assessor/evidence'+(id?'/'+id:'?assignment='+assignment),{method,headers:{Origin:origin},...(method==='POST'?{body:form}:{})});
  req.nextUrl=new URL(req.url);req.cookies={get:n=>n==='primark_session'&&user?{value:user}:undefined};
  return id?m.evidenceFile[method](req,{params:Promise.resolve({id})}):m.evidence[method](req);
 });
}

const settings=async(user='',admin=true)=>call(m.settings,'GET','/api/admin/settings',null,{user,admin});
const save=async(changes,{user='',admin=true,revision}={})=>{
 if(revision===undefined)revision=(await (await settings(user,admin)).json()).revision;
 return call(m.settings,'POST','/api/admin/settings',{revision,changes},{user,admin});
};
try {
 for(const id of ['org','country','student','assessor'])await person(id);
 await q("INSERT INTO reporting_access VALUES('org','organisation',NULL,NULL,'test','2026-01-01'),('country','country','Ireland',NULL,'test','2026-01-01')");
 await check('Only organisation and platform admins can read feature settings',async()=>{
  for(const user of ['','country','student'])assert.equal((await settings(user,false)).status,403);
  const d=await (await settings('org',false)).json();assert.equal(d.platformAdmin,false);assert.equal(Object.keys(d.choices).length,20);
  assert.equal(d.choices.pathways.enabled,false);assert.equal(d.choices.credits.enabled,true);assert.equal(d.choices.auto_archive.enabled,false);
 });
 await check('Platform access overrides organisation choice and cannot be forged',async()=>{
  assert.equal((await save({bulk_import:{policy:'disabled',enabled:true}})).status,200);
  assert.equal(await m.features.featureEnabled('bulk_import'),false);
  assert.equal((await save({bulk_import:{enabled:true}},{user:'org',admin:false})).status,403);
  assert.equal((await save({bulk_import:{policy:'optional'}},{user:'org',admin:false})).status,403);
  assert.equal((await call(m.imports,'POST','/api/users/import',{csv:'',mode:'create'},{user:'org'})).status,403);
  assert.equal((await save({bulk_import:{policy:'required',enabled:false}})).status,200);
  assert.equal(await m.features.featureEnabled('bulk_import'),true);
  assert.equal((await save({bulk_import:{enabled:false}},{user:'org',admin:false})).status,403);
 });
 await check('Optional switches work and old API cannot bypass locked policies',async()=>{
  assert.equal((await save({bulk_import:{policy:'optional',enabled:true},auto_archive:{policy:'disabled'}})).status,200);
  assert.equal((await save({bulk_import:{enabled:false}},{user:'org',admin:false})).status,200);
  assert.equal(await m.features.featureEnabled('bulk_import'),false);
  const d=await (await settings('org',false)).json();
  assert.equal((await call(m.settings,'POST','/api/admin/settings',{revision:d.revision,auto_archive_enabled:true},{user:'org'})).status,403);
 });
 await check('Validation, stale revisions, CSRF and unknown features fail safely',async()=>{
  const d=await (await settings()).json();
  assert.equal((await save({bulk_import:{policy:'optional',enabled:true}})).status,200);
  assert.equal((await save({bulk_import:{enabled:false}},{revision:d.revision})).status,409);
  assert.equal((await save({invented:{enabled:true}})).status,400);
  assert.equal((await save({bulk_import:{enabled:'yes'}})).status,400);
  assert.equal((await call(m.settings,'POST','/api/admin/settings',{revision:d.revision,changes:{}},{admin:true,origin:'https://evil.invalid'})).status,403);
 });
 await check('Parent switches and Required dependencies are enforced',async()=>{
  assert.equal((await save({pathway_rules:{policy:'required'}})).status,400);
  assert.equal((await save({pathways:{policy:'required'},pathway_rules:{policy:'required'}})).status,200);
  assert.equal(await m.features.featureEnabled('pathway_rules'),true);
  assert.equal((await save({pathway_rules:{policy:'optional'},pathways:{policy:'disabled'}})).status,200);
  assert.equal(await m.features.featureEnabled('pathway_rules'),false);
  assert.equal((await one('SELECT sync_pathway_assignments() n')).n,0);
 });
 await check('Legacy billing/archive fields, settings audit and main audit stay consistent',async()=>{
  assert.equal((await save({credits:{policy:'disabled'},auto_archive:{policy:'required'}})).status,200);
  const s=await one('SELECT * FROM organisation_settings');assert.equal(s.credits_enabled,false);assert.equal(s.auto_archive_enabled,true);
  assert((await q('SELECT * FROM organisation_settings_audit')).length>0);
  assert((await q("SELECT * FROM audit_events WHERE entity='organisation_settings'")).length>0);
 });
 await check('Disabling assessment configuration never releases outstanding certificates',async()=>{
  await course('practical');await q("UPDATE courses SET assessor_required=true WHERE id='practical'");
  await assign('student','practical');const before=await history('student','practical');
  await save({assessor:{policy:'disabled'},quizzes:{policy:'disabled'},assessment_evidence:{policy:'disabled'}});
  await q("INSERT INTO scorm_progress(learner_id,package_id,sco_id,status,completed_at,updated_at) VALUES('student','practical-pack','sco','passed','2026-10-10','2026-10-10')");
  await q("SELECT issue_course_certificate('student','practical-pack')");
  const after=await history('student','practical');assert.equal(after.assessor_required,true);assert.equal(after.completed_at,null);assert.equal(after.id,before.id);
  assert.equal((await q("SELECT * FROM certificates WHERE learner_id='student'")).length,0);
  await assert.rejects(()=>q("UPDATE courses SET quiz_json='{}' WHERE id='practical'"),/switched off/);
  assert.equal((await evidenceCall('POST',before.id)).status,403);
 });
 await check('Disabled renewal/refresher operations stop without deleting records',async()=>{
  await save({renewals:{policy:'disabled'},refreshers:{policy:'disabled'}});
  await assert.rejects(()=>m.renewals.renewLearnerCourse('student','practical','unused'),/switched off/);
  assert.equal((await one("SELECT assign_course_refresher('unused') result")).result,'not_due');
  assert((await history('student','practical')).id);
 });
 await check('Lifecycle cannot be bypassed through an alternate store update',async()=>{
  await save({lifecycle:{policy:'disabled'}});
  await assert.rejects(()=>q("UPDATE learners SET store_id='another' WHERE id='student'"),/switched off/);
  assert.equal((await one("SELECT store_id FROM learners WHERE id='student'")).store_id,'credit-ie');
 });
 await check('Email switches filter candidates and cancel queued mail',async()=>{
  await q("INSERT INTO email_outbox(event_key,kind,recipient_id,activation) VALUES('feature-test','course_assigned','student',now())");
  await save({assignment_emails:{policy:'disabled'}});
  assert.equal((await one("SELECT status FROM email_outbox WHERE event_key='feature-test'")).status,'cancelled');
  await save({email_notifications:{policy:'disabled'}});
  assert.equal((await q('SELECT * FROM learning_email_candidates()')).length,0);
 });
 console.log(`PASS ${checks} feature-settings integration groups`);
}finally{await pg.close();rmSync(dir,{recursive:true,force:true});}
