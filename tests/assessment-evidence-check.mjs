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
writeFileSync(entry,`export * as evidence from '${process.cwd()}/app/api/assessor/evidence/route.ts';
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
const today=new Date().toISOString().slice(0,10);
const assess=(aid,evidenceIds=[],extra={},user='assessor')=>call(m.assessor,'POST','/api/assessor',{action:'assess',id:aid,date:today,outcome:'pass',declaration:true,notes:'',evidenceIds,...extra},{user});
const drafts=async aid=>(await (await evidenceCall('GET',aid)).json()).evidence;
const upload=async aid=>{const r=await evidenceCall('POST',aid);assert.equal(r.status,201,JSON.stringify(await r.clone().json()));return (await r.json()).evidence;};
const remove=async(id,opts={})=>evidenceCall('DELETE','',{id,...opts});
let aid,second,draft;
try{
 await q('UPDATE organisation_settings SET credits_enabled=false');
 for(const id of ['student','second','assessor','colleague','wrong','expired','unfinished'])await person(id);
 await course('practical');await q("UPDATE courses SET assessor_required=true WHERE id='practical'");
 for(const id of ['assessor','colleague','wrong','expired']){
  await q('INSERT INTO assessor_accounts VALUES($1,false)',id);
  await q("INSERT INTO assessor_grants(id,learner_id,course_id,site_id,qualification,expires_on,assigned_by) VALUES($1,$1,'practical',$2,'Qualified trainer',$3,'admin')",id,id==='wrong'?'other-site':'*',id==='expired'?'2000-01-01':null);
 }
 for(const id of ['student','second','unfinished']){
  await assign(id,'practical');
  if(id!=='unfinished'){
   await q("INSERT INTO scorm_progress(learner_id,package_id,sco_id,status,completed_at,updated_at) VALUES($1,'practical-pack','sco','passed',$2,$2)",id,today+'T00:00:00Z');
   await q("SELECT issue_course_certificate($1,'practical-pack')",id);
  }
 }
 aid=(await history('student','practical')).id;second=(await history('second','practical')).id;
 await check('Evidence upload requires an active scoped assessor, completed theory and same origin',async()=>{
  for(const user of ['','student','wrong','expired'])assert.equal((await evidenceCall('POST',aid,{user})).status,403);
  assert.equal((await evidenceCall('POST',aid,{origin:'https://evil.invalid'})).status,403);
  assert.equal((await evidenceCall('POST',(await history('unfinished','practical')).id)).status,403);
  assert.equal((await q('SELECT * FROM assessment_evidence')).length,0);
 });
 await check('File signatures, empty files, payload limits and safe filenames are enforced',async()=>{
  assert.equal((await evidenceCall('POST',aid,{upload:file('fake.pdf','<script>bad</script>')})).status,400);
  assert.equal((await evidenceCall('POST',aid,{upload:file('empty.pdf','')})).status,413);
  assert.equal((await evidenceCall('POST',aid,{upload:file('large.pdf',new Uint8Array(3*1024*1024+1))})).status,413);
  const result=await evidenceCall('POST',aid,{upload:file('bad<>name.html',pdf,'text/html')});assert.equal(result.status,201);
  draft=(await result.json()).evidence;assert.equal(draft.filename,'bad__name.pdf');assert.equal(draft.mime_type,'application/pdf');
  assert.deepEqual((await drafts(aid)).map(f=>f.id),[draft.id]);
  for(const [bytes,mime] of [[new Uint8Array([255,216,255,0]),'image/jpeg'],[new Uint8Array([137,80,78,71,13,10,26,10]),'image/png'],['RIFF0000WEBP','image/webp'],['0000ftypheic','image/heic']])assert.equal((await m.evidenceLib.evidenceFile(file('photo',bytes))).mime,mime);
 });
 await check('Drafts belong to their uploader; downloads are private and byte-verified',async()=>{
  for(const options of [{user:''},{user:'colleague'},{user:'wrong'},{user:'student'},{user:'',admin:true}])assert.notEqual((await evidenceCall('GET','',{id:draft.id,...options})).status,200);
  assert.equal((await (await evidenceCall('GET',aid,{user:'colleague'})).json()).evidence.length,0);
  const result=await evidenceCall('GET','',{id:draft.id});assert.equal(result.status,200);assert.equal(await result.text(),pdf);
  assert.equal(result.headers.get('Cache-Control'),'private, no-store');assert.match(result.headers.get('Content-Disposition'),/^attachment/);assert.equal(result.headers.get('X-Content-Type-Options'),'nosniff');
  const values=blobStores.get('primark-evidence-production'),original=values.get(draft.id);values.set(draft.id,new TextEncoder().encode('corrupted').buffer);
  assert.equal((await evidenceCall('GET','',{id:draft.id})).status,503);values.set(draft.id,original);
 });
 await check('Five-file cap, draft removal and retry after a failed storage write',async()=>{
  for(let i=0;i<4;i++)await upload(aid);assert.equal((await evidenceCall('POST',aid)).status,400);
  for(const f of (await drafts(aid)).filter(f=>f.id!==draft.id))assert.equal((await remove(f.id)).status,200);
  const oldError=console.error;console.error=()=>{};
  try{globalThis.__evidenceTest.failWrite=true;assert.equal((await evidenceCall('POST',aid)).status,503);}finally{globalThis.__evidenceTest.failWrite=false;console.error=oldError;}
  const failed=(await drafts(aid)).find(f=>f.state==='uploading');assert(failed);
  assert.equal((await assess(aid,[failed.id])).status,400);assert.equal((await remove(failed.id)).status,200);
  const temp=await upload(aid);globalThis.__evidenceTest.failDelete=true;console.error=()=>{};
  try{assert.equal((await remove(temp.id)).status,503);}finally{globalThis.__evidenceTest.failDelete=false;console.error=oldError;}
  assert.equal((await remove(temp.id)).status,200);assert.equal(blobStores.get('primark-evidence-production').has(temp.id),false);
  assert.equal((await remove(draft.id,{user:'colleague'})).status,404);
 });
 await check('Evidence from another learner or assessor cannot be attached; failed sign-off is atomic',async()=>{
  const before=(await q('SELECT * FROM practical_assessments')).length;
  for(const [assignment,ids,extra,user] of [[aid,[],{},'assessor'],[second,[draft.id],{},'assessor'],[aid,[draft.id],{},'colleague'],[aid,[draft.id,draft.id],{},'assessor'],[aid,['missing'],{},'assessor'],[aid,[draft.id],{declaration:false},'assessor']])assert.equal((await assess(assignment,ids,extra,user)).status,400);
  assert.equal((await q('SELECT * FROM practical_assessments')).length,before);assert.equal((await one('SELECT assessment_id FROM assessment_evidence WHERE id=$1',draft.id)).assessment_id,null);
  assert.equal((await q("SELECT * FROM certificates WHERE learner_id='student'")).length,0);
 });
 await check('Unsuccessful attempts retain their own evidence without issuing certificates',async()=>{
  assert.equal((await assess(aid,[draft.id],{outcome:'not_yet_competent',declaration:false,notes:'Repeat lifting technique'})).status,200);
  assert.equal((await q("SELECT * FROM certificates WHERE learner_id='student'")).length,0);
  assert.equal((await remove(draft.id)).status,409);assert.equal((await assess(aid,[draft.id])).status,400);
  const historyData=await (await call(m.assessor,'GET','/api/assessor',null,{user:'assessor'})).json();assert.deepEqual(historyData.history[0].evidence.map(f=>f.id),[draft.id]);assert(!JSON.stringify(historyData).includes('storage_context'));
 });
 let passedFile,pass;
 await check('Successful sign-off links files and issues one certificate without extra credits',async()=>{
  passedFile=await upload(aid);const before=(await one('SELECT count(*)::int n FROM credit_ledger')).n;
  assert.equal((await assess(aid,[passedFile.id])).status,200);pass=(await history('student','practical')).passed_assessment_id;
  assert.equal((await one('SELECT assessment_id FROM assessment_evidence WHERE id=$1',passedFile.id)).assessment_id,pass);
  assert.equal((await q("SELECT * FROM certificates WHERE learner_id='student' AND cancelled_at IS NULL")).length,1);assert.equal((await one('SELECT count(*)::int n FROM credit_ledger')).n,before);
  assert.equal((await evidenceCall('POST',aid)).status,403);
  assert.equal((await evidenceCall('GET','',{id:passedFile.id,user:'',admin:true})).status,200);
  assert.equal((await evidenceCall('GET','',{id:passedFile.id,user:'colleague'})).status,200);
  assert.equal((await evidenceCall('GET','',{id:passedFile.id,user:'wrong'})).status,404);
 });
 await check('Attached records are immutable, audited and retained after revocation and reassessment',async()=>{
  await assert.rejects(q('UPDATE assessment_evidence SET filename=$1 WHERE id=$2','replace.pdf',passedFile.id),/cannot be changed/);
  await assert.rejects(q('DELETE FROM assessment_evidence WHERE id=$1',passedFile.id),/cannot be deleted/);
  assert.equal((await remove(passedFile.id)).status,409);
  assert.equal((await call(m.assessor,'POST','/api/assessor',{action:'revoke',id:pass,reason:'Assessment review'},{admin:true})).status,200);
  assert.equal((await evidenceCall('GET','',{id:passedFile.id})).status,200);
  assert.equal((await assess(aid,[])).status,200);
  const events=await q("SELECT * FROM audit_events WHERE entity='assessment_evidence' AND entity_id=$1",passedFile.id);
  assert.deepEqual(events.map(e=>e.action),['upload_started','uploaded','attached']);assert(events.every(e=>e.actor==='assessor@test.invalid'));assert.equal(events[2].learner_id,'student');assert.equal(events[2].next_state.assessment_id,pass);assert.equal(events[2].next_state.sha256.length,64);
 });
 await check('Archived and deauthorised assessors lose access to recorded evidence',async()=>{
  await q("UPDATE assessor_grants SET active=false WHERE id='colleague'");assert.equal((await evidenceCall('GET','',{id:passedFile.id,user:'colleague'})).status,404);
  await q("UPDATE learners SET archived_at=now() WHERE id='assessor'");assert.equal((await evidenceCall('GET','',{id:passedFile.id})).status,403);
  await q("UPDATE learners SET archived_at=NULL WHERE id='assessor'");
 });
 await check('Preview uploads use a separate store and cannot remove production snapshot files',async()=>{
  const prodDraft=await upload(second);globalThis.__evidenceTest.buildContext.context='deploy-preview';
  const previewFile=await upload(second);assert(blobStores.get('primark-evidence-preview-evidence-test').has(previewFile.id));assert(!blobStores.get('primark-evidence-production').has(previewFile.id));
  assert.equal((await evidenceCall('GET','',{id:prodDraft.id})).status,200);assert.equal((await remove(prodDraft.id)).status,404);assert(blobStores.get('primark-evidence-production').has(prodDraft.id));
  assert.equal((await remove(previewFile.id)).status,200);globalThis.__evidenceTest.buildContext.context='production';
 });
 console.log(`PASS ${checks} assessment evidence integration checks`);
}finally{await pg.close();rmSync(dir,{recursive:true,force:true});delete globalThis.__creditTest;delete globalThis.__evidenceTest;}
