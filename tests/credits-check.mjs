import assert from 'node:assert/strict';
import {mock} from 'node:test';
import {readFileSync,readdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AsyncLocalStorage} from 'node:async_hooks';
import {PGlite} from '@electric-sql/pglite';
import {build} from 'esbuild';
import {ZipReader,Uint8ArrayReader,TextWriter} from '@zip.js/zip.js';
import {XMLParser} from 'fast-xml-parser';
const pg=new PGlite();
const migrations=readdirSync('netlify/database/migrations').sort();
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
writeFileSync(entry,`export * as credits from '${process.cwd()}/lib/credits.ts';
 export * as reportView from '${process.cwd()}/lib/period-report-view.ts';
 export * as periods from '${process.cwd()}/lib/period-report.ts';
 export * as xlsx from '${process.cwd()}/lib/period-export.ts';
 export * as report from '${process.cwd()}/app/api/reporting/periods/route.ts';
 export * as assignments from '${process.cwd()}/app/api/store/assignments/route.ts';
 export * as manager from '${process.cwd()}/app/api/store/route.ts';
 export * as settings from '${process.cwd()}/app/api/admin/credits/route.ts';
 export * as runtime from '${process.cwd()}/app/api/scorm/route.ts';
 export * as access from '${process.cwd()}/lib/course-access.ts';
 export {hash} from '${process.cwd()}/lib/server.ts';`);
await build({entryPoints:[entry],outfile:join(dir,'bundle.mjs'),bundle:true,platform:'node',format:'esm',tsconfig:'tsconfig.json',plugins:[{name:'test',setup(b){
 b.onResolve({filter:/^@netlify\/database$/},()=>({path:'db',namespace:'test'}));
 b.onResolve({filter:/^@\/lib\/admin-auth$/},()=>({path:'auth',namespace:'test'}));
 b.onResolve({filter:/^next\/headers$/},()=>({path:'cookies',namespace:'test'}));
 b.onResolve({filter:/^next\/server$/},()=>({path:'next',namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},a=>({contents:a.path==='db'?'export const getDatabase=()=>({pool:globalThis.__creditTest.pool});':a.path==='auth'?'export const getAdminUser=async()=>globalThis.__creditTest.identity();export const credentials=()=>null;':a.path==='cookies'?"export const cookies=async()=>({get:n=>n==='primark_session'&&globalThis.__creditTest.cookie()?{value:globalThis.__creditTest.cookie()}:undefined});":'export class NextRequest extends Request {}; export const NextResponse=Response;',loader:'js'}));
}}]});
const m=await import(join(dir,'bundle.mjs'));let checks=0;
const reportAtClose=(stores,period,priced)=>m.periods.periodReport(stores,period,priced,new Date('2028-01-01T12:00:00Z'));
const q=async(sql,...args)=>(await pg.query(sql,args)).rows;
const one=async(sql,...args)=>(await q(sql,...args))[0];
async function check(name,fn){await fn();console.log('PASS '+name);checks++;}
async function call(mod,method,path,body,{user='',admin=false,origin='https://local.test'}={}){return context.run({user,admin},async()=>{const req=new Request('https://local.test'+path,{method,headers:{'Content-Type':'application/json',Origin:origin,...(user?{Cookie:'primark_session='+user}:{})},...(body?{body:JSON.stringify(body)}:{})});req.nextUrl=new URL(req.url);req.cookies={get:n=>n==='primark_session'&&user?{value:user}:undefined};return mod[method](req);});}
const person=async(id,store='credit-ie',country='Ireland')=>{await q('INSERT INTO learners(id,name,email,code_hash,store_id,country,entered_at) VALUES($1,$1,$2,$1,$3,$4,$5)',id,id+'@test.invalid',store,country,new Date().toISOString());await q('INSERT INTO sessions VALUES($1,$2,$3)',await m.hash(id),id,'2099-01-01');};
async function course(id,audience={countries:[],sites:[],users:[]}){await q("INSERT INTO courses(id,title,status,audience_json,created_at,updated_at,catalogue_scope,validity_months) VALUES($1,$1,'published',$2,'2026-01-01','2026-01-01','global',12)",id,JSON.stringify(audience));await q("INSERT INTO course_packages(id,course_id,filename,status,scos_json,file_count,total_bytes,created_at) VALUES($1,$2,'fixture.zip','ready',$3,1,10,'2026-01-01')",id+'-pack',id,JSON.stringify([{id:'sco',title:'Lesson',href:'index.html',mastery:'',launchData:''}]));await q('UPDATE courses SET package_id=$2 WHERE id=$1',id,id+'-pack');}
const assign=async(id,cid,at=new Date().toISOString(),renew=false)=>one('SELECT assign_credit_course($1,$2,$3,$4::timestamptz,$5) AS added',id,cid,'manager@test.invalid',at,renew);
const history=async(id,cid)=>one('SELECT h.* FROM course_assignments a JOIN assignment_history h ON h.id=a.history_id WHERE a.learner_id=$1 AND a.course_id=$2',id,cid);
const balance=async(store='credit-ie')=>(await one('SELECT balance FROM store_credit_accounts WHERE store_id=$1',store)).balance;
for(const [id,country]of [['credit-ie','Ireland'],['credit-zero','Ireland'],['credit-us','United States']]){await q('INSERT INTO organisation_stores(id,name,country,active,updated_by,updated_at,store_code) VALUES($1,$1,$2,true,$3,$4,$5)',id,country,'test',new Date().toISOString(),id);await q('SELECT ensure_store_credits($1,$1,$2,$1)',id,country);}
await person('learner');await person('manager');await person('other','credit-us','United States');await person('country-admin');await person('org-admin');
await q('INSERT INTO store_managers VALUES($1,$2,$3,$4)','manager','credit-ie','test','2026-01-01');
await q("INSERT INTO reporting_access VALUES('country-admin','country','Ireland',NULL,'test','2026-01-01'),('org-admin','organisation',NULL,NULL,'test','2026-01-01')");
await course('credit-course');await course('second-course');
await check('Migration preserves existing assignments and adds history without retrospective billing',async()=>{const h=await history('existing','existing-course');assert(h);assert.equal(h.billed,false);assert.equal(h.assigned_by,'original manager');assert.equal(h.assigned_at.toISOString(),'2026-10-01T00:00:00.000Z');assert.equal((await q("SELECT * FROM credit_ledger WHERE assignment_id=$1",h.id)).length,0);});
await check('Initial grants are 100/300 and repeated store setup cannot duplicate credits',async()=>{assert.equal(await balance(),100);assert.equal(await balance('credit-us'),300);await q("SELECT ensure_store_credits('credit-ie','Ignored','Ireland')");assert.equal(await balance(),100);});
await check('Assignment debits once immediately, with no start needed; duplicates do not alter the date',async()=>{assert.equal((await assign('learner','credit-course')).added,true);const h=await history('learner','credit-course');assert.equal(await balance(),99);assert.equal(h.started_at,null);assert.equal(h.unit_cents,325);assert.equal((await assign('learner','credit-course')).added,false);assert.equal(await balance(),99);assert.equal((await history('learner','credit-course')).id,h.id);});
await check('Unstarted removal returns one credit, records reason/actor and cannot refund twice',async()=>{const h=await history('learner','credit-course');const r=await call(m.assignments,'POST','/api/store/assignments',{action:'remove',assignmentId:h.id,reason:'Assigned in error'},{user:'manager'});assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).refunded,true);assert.equal(await balance(),100);const again=await call(m.assignments,'POST','/api/store/assignments',{action:'remove',assignmentId:h.id,reason:'Repeated request'},{user:'manager'});assert.equal(again.status,200);assert.equal(await balance(),100);const audit=await one('SELECT * FROM assignment_history WHERE id=$1',h.id);assert.equal(audit.cancellation_reason,'Assigned in error');assert.equal(audit.cancelled_by,'manager@test.invalid');assert.equal((await q("SELECT * FROM credit_ledger WHERE assignment_id=$1 AND kind='refund'",h.id)).length,1);});
await check('Cancelled automatic grants remain excluded after synchronisation; deliberate reassignment gets a new ID',async()=>{await q("UPDATE courses SET audience_json=$2 WHERE id=$1",'credit-course',JSON.stringify({countries:['Ireland'],sites:[],users:[]}));await q("SELECT sync_credit_assignments('learner')");assert.equal(await history('learner','credit-course'),undefined);await assign('learner','credit-course');assert.equal(await balance(),99);await q("UPDATE courses SET audience_json=$2 WHERE id=$1",'credit-course',JSON.stringify({countries:[],sites:[],users:[]}));});
await check('A zero-second SCORM launch blocks removal without changing credits or training evidence',async()=>{
 const before=await call(m.assignments,'GET','/api/store/assignments?learnerId=learner',null,{user:'manager'});
 assert.equal((await before.json()).rows.find(r=>r.courseTitle==='credit-course').canRemove,true);
 const r=await call(m.runtime,'POST','/api/scorm',{action:'launch',courseId:'credit-course'},{user:'learner'});
 assert.equal(r.status,200,await r.clone().text());const launch=await r.json(),h=await history('learner','credit-course');assert(h.started_at);
 const listed=await call(m.assignments,'GET','/api/store/assignments?learnerId=learner',null,{user:'manager'});
 assert.equal((await listed.json()).rows.find(r=>r.id===h.id).canRemove,false);
 const removed=await call(m.assignments,'POST','/api/store/assignments',{action:'remove',assignmentId:h.id,reason:'Training reassigned'},{user:'manager'});
 assert.equal(removed.status,409);assert.equal((await removed.json()).error,'Started or completed assignments cannot be removed.');
 assert.equal(await balance(),99);assert.deepEqual(await history('learner','credit-course'),h);
 assert.equal((await q('SELECT * FROM credit_ledger WHERE assignment_id=$1 AND kind=\'refund\'',h.id)).length,0);
 assert.equal((await call(m.runtime,'POST','/api/scorm',{action:'save',token:launch.token,sequence:1,data:{}},{user:'learner'})).status,200);
});
await check('Exact 14-day cutoff rejects removal while 1ms before the cutoff refunds',async()=>{await assign('learner','second-course','2026-10-01T10:00:00Z');let h=await history('learner','second-course');await assert.rejects(q('SELECT cancel_credit_assignment($1,$2,$3,$4::timestamptz)',h.id,'test','Boundary test','2026-10-15T10:00:00Z'),/14 days/);const r=await one('SELECT cancel_credit_assignment($1,$2,$3,$4::timestamptz) AS r',h.id,'test','Boundary test','2026-10-15T09:59:59.999Z');assert.equal(r.r.refunded,true);});
await check('Expired renewal snapshots progress/certificate, uses a new credit and restores previous evidence on cancellation',async()=>{await assign('learner','credit-course','2026-10-01T10:00:00Z');let previous=await history('learner','credit-course');await q("INSERT INTO scorm_progress(learner_id,package_id,sco_id,status,completed_at,updated_at,data_json,total_centiseconds) VALUES('learner','credit-course-pack','sco','passed','2024-01-31T10:00:00Z','2024-01-31','{\"cmi.suspend_data\":\"old evidence\"}',4000) ON CONFLICT(learner_id,package_id,sco_id) DO UPDATE SET status=EXCLUDED.status,completed_at=EXCLUDED.completed_at,updated_at=EXCLUDED.updated_at,data_json=EXCLUDED.data_json,total_centiseconds=EXCLUDED.total_centiseconds");await q("SELECT issue_course_certificate('learner','credit-course-pack')");const cert=await one("SELECT * FROM certificates WHERE assignment_id=$1",previous.id),before=await balance();await assign('learner','credit-course',new Date().toISOString(),true);const renewed=await history('learner','credit-course');assert.equal(renewed.previous_id,previous.id);assert.equal(await balance(),before-1);assert.equal((await q("SELECT * FROM scorm_progress WHERE learner_id='learner'")).length,0);assert((await one('SELECT archived_at FROM certificates WHERE token=$1',cert.token)).archived_at);await q('SELECT cancel_credit_assignment($1,$2,$3)',renewed.id,'manager','Incorrect renewal');assert.equal(await balance(),before);assert.equal((await history('learner','credit-course')).id,previous.id);const restored=await one('SELECT * FROM certificates WHERE token=$1',cert.token);assert.equal(restored.archived_at,null);assert.equal(restored.expires_at,cert.expires_at);assert.equal((await one("SELECT data_json FROM scorm_progress WHERE learner_id='learner'")).data_json,'{"cmi.suspend_data":"old evidence"}');});
await check('Completed renewals cannot be removed or restore an older certificate',async()=>{
 const previous=await history('learner','credit-course');await assign('learner','credit-course',new Date().toISOString(),true);
 const renewed=await history('learner','credit-course'),before=await balance();
 const launch=await call(m.runtime,'POST','/api/scorm',{action:'launch',courseId:'credit-course'},{user:'learner'});const token=(await launch.json()).token;
 const save=await call(m.runtime,'POST','/api/scorm',{action:'save',token,sequence:1,data:{'cmi.core.lesson_status':'passed','cmi.core.session_time':'0000:00:10.00'}},{user:'learner'});
 assert.equal(save.status,200,await save.clone().text());assert((await history('learner','credit-course')).completed_at);
 const cert=await one('SELECT * FROM certificates WHERE assignment_id=$1',renewed.id);
 await assert.rejects(q('SELECT cancel_credit_assignment($1,$2,$3)',renewed.id,'manager','Training recorded incorrectly'),/Started or completed/);
 const response=await call(m.assignments,'POST','/api/store/assignments',{action:'remove',assignmentId:renewed.id,reason:'Incorrect renewal'},{user:'manager'});
 assert.equal(response.status,409);assert.equal(await balance(),before);assert.equal((await history('learner','credit-course')).id,renewed.id);
 assert.deepEqual(await one('SELECT * FROM certificates WHERE assignment_id=$1',renewed.id),cert);
 assert((await one('SELECT archived_at FROM certificates WHERE assignment_id=$1',previous.id)).archived_at);
});
await check('Removal eligibility and API enforce age, completion and legacy launch/progress evidence',async()=>{
 await q("INSERT INTO organisation_stores(id,name,country,active,updated_by,updated_at) VALUES('removal-rules','Removal rules','Ireland',true,'test','2026-10-09')");
 await q("SELECT ensure_store_credits('removal-rules','Removal rules','Ireland')");
 for(const kind of ['old','future','completed','launch','progress']){
  const id='removal-'+kind;await person(id,'removal-rules');await assign(id,'second-course');const h=await history(id,'second-course');
  if(kind==='old'||kind==='future')await q("UPDATE assignment_history SET assigned_at=now()+$2::interval WHERE id=$1",h.id,kind==='old'?'-336 hours':'1 hour');
  if(kind==='completed')await q('UPDATE assignment_history SET completed_at=now() WHERE id=$1',h.id);
  if(kind==='launch'||kind==='progress'){
   const launched=await call(m.runtime,'POST','/api/scorm',{action:'launch',courseId:'second-course'},{user:id});assert.equal(launched.status,200,await launched.clone().text());
   await q('UPDATE assignment_history SET started_at=NULL WHERE id=$1',h.id);
   if(kind==='launch')await q('DELETE FROM scorm_progress WHERE learner_id=$1',id);
   else await q('DELETE FROM scorm_launches WHERE learner_id=$1',id);
  }
  const url='/api/store/assignments?storeId=removal-rules&learnerId='+id;
  const listing=await call(m.assignments,'GET',url,null,{admin:true});assert.equal(listing.status,200);
  assert.equal((await listing.json()).rows[0].canRemove,false,kind);
  const before=await history(id,'second-course'),credits=await balance('removal-rules');
  const response=await call(m.assignments,'POST',url,{action:'remove',assignmentId:h.id,reason:'Blocked correction'},{admin:true});
  assert.equal(response.status,409,kind);assert.deepEqual(await history(id,'second-course'),before);assert.equal(await balance('removal-rules'),credits);
 }
});
await check('Period dates are contiguous, include week 53 and apply London DST boundaries',async()=>{const periods=await m.periods.accountingPeriods();assert.equal(periods.length,13);assert.equal(periods[0].endsOn,'2027-09-18');assert.equal(periods.at(-1).startsOn,'2026-09-13');const p=await one("SELECT starts_on::timestamp AT TIME ZONE 'Europe/London' AS start,(ends_on+1)::timestamp AT TIME ZONE 'Europe/London' AS finish FROM accounting_periods WHERE id='2026-2027-P2'");assert.equal(p.start.toISOString(),'2026-10-10T23:00:00.000Z');assert.equal(p.finish.toISOString(),'2026-11-08T00:00:00.000Z');});
await check('Scheduled top-ups restore allowance once, retain surplus and do not top up again in week 53',async()=>{await q("SELECT ensure_store_credits('topup-test','Topup','Ireland',NULL,'2026-09-20T00:00:00Z'::timestamptz)");await q("UPDATE store_credit_accounts SET balance=37 WHERE store_id='topup-test'");assert.equal((await one("SELECT topup_store_credits('topup-test','2026-10-11T00:00:00Z'::timestamptz) AS n")).n,63);assert.equal((await one("SELECT topup_store_credits('topup-test','2026-10-12T00:00:00Z'::timestamptz) AS n")).n,0);await q("UPDATE store_credit_accounts SET balance=107 WHERE store_id='topup-test'");assert.equal((await one("SELECT topup_store_credits('topup-test','2026-11-08T00:00:00Z'::timestamptz) AS n")).n,0);assert.equal(await balance('topup-test'),107);await q("SELECT topup_store_credits('topup-test','2027-08-15T00:00:00Z'::timestamptz)");const n=(await one("SELECT count(*)::int AS n FROM credit_ledger WHERE store_id='topup-test' AND kind='period_topup'")).n;await q("SELECT topup_store_credits('topup-test','2027-09-12T00:00:00Z'::timestamptz)");assert.equal((await one("SELECT count(*)::int AS n FROM credit_ledger WHERE store_id='topup-test' AND kind='period_topup'")).n,n);});
await check('Three configured US automatic courses debit three credits only once',async()=>{for(let i=1;i<=3;i++)await course('us-auto-'+i,{countries:['United States'],sites:[],users:[]});await q("SELECT sync_credit_assignments('other')");assert.equal(await balance('credit-us'),297);await q("SELECT sync_credit_assignments('other')");assert.equal(await balance('credit-us'),297);});
await check('Cross-period refunds use the original price and produce a negative net on a zero-assignment store',async()=>{await person('late-refund','credit-zero');await assign('late-refund','second-course','2026-10-10T20:00:00Z');const h=await history('late-refund','second-course');await q("INSERT INTO credit_rates VALUES('changed','2026-10-11',400,'test',now())");await q('SELECT cancel_credit_assignment($1,$2,$3,$4::timestamptz)',h.id,'test','Late correction','2026-10-12T10:00:00Z');const first=await reportAtClose(['credit-zero'],'2026-2027-P1',true),next=await reportAtClose(['credit-zero'],'2026-2027-P2',true);assert.equal(first.totals.assignments,1);assert.equal(first.totals.refunds,0);assert.equal(first.totals.valueCents,325);assert.equal(next.totals.assignments,0);assert.equal(next.totals.refunds,1);assert.equal(next.totals.net,-1);assert.equal(next.totals.valueCents,-325);});
await check('All stores including zero-activity stores appear and credits reconcile',async()=>{const r=await reportAtClose(['credit-ie','credit-us','credit-zero'],'2026-2027-P1',true);assert.equal(r.rows.length,3);assert.equal(r.countries.reduce((n,c)=>n+c.assignments,0),r.totals.assignments);for(const row of r.rows)assert.equal(row.opening+row.topups-row.assignments+row.refunds,row.closing);const zero=await reportAtClose(['credit-zero'],'2026-2027-P3',true);assert.equal(zero.rows.length,1);assert.equal(zero.rows[0].assignments,0);});
await check('Learners cannot report, managers cannot cross stores and Primark roles never receive price fields',async()=>{for(const user of ['', 'learner'])assert.equal((await call(m.report,'GET','/api/reporting/periods',null,{user})).status,403);for(const user of ['manager','country-admin'])assert.equal((await call(m.report,'GET','/api/reporting/periods?role=site&site=credit-us',null,{user})).status,403);for(const user of ['manager','country-admin','org-admin']){const r=await call(m.report,'GET','/api/reporting/periods?period=2026-2027-P1&prices=true',null,{user});assert.equal(r.status,200,await r.clone().text());const text=await r.text();assert(!/valueCents|currentRateCents|unitCents/.test(text));}assert.equal((await call(m.settings,'GET','/api/admin/credits',null,{user:'org-admin'})).status,403);});
await check('Removal and renewal enforce scope, CSRF, current role and assignment identity',async()=>{const h=await history('learner','credit-course');for(const options of [{user:'learner'},{user:'country-admin'},{user:'manager',origin:'https://evil.invalid'}])assert.equal((await call(m.assignments,'POST','/api/store/assignments',{action:'remove',assignmentId:h.id,reason:'Blocked removal'},options)).status,403);assert.equal((await call(m.assignments,'GET','/api/store/assignments?storeId=credit-us',null,{user:'manager'})).status,403);await q("DELETE FROM store_managers WHERE learner_id='manager'");assert.equal((await call(m.assignments,'POST','/api/store/assignments',{action:'remove',assignmentId:h.id,reason:'Revoked access'},{user:'manager'})).status,403);});
await check('Excel exports contain editable formulas and no pricing cells/formulas for Primark users',async()=>{async function xml(report){const bytes=await m.xlsx.periodWorkbook(report);const zip=new ZipReader(new Uint8ArrayReader(bytes),{useWebWorkers:false});const entries=await zip.getEntries();const result=await entries.find(e=>e.filename==='xl/worksheets/sheet1.xml').getData(new TextWriter());await zip.close();return result;}const admin=await reportAtClose(['credit-ie','credit-zero'],'2026-2027-P1',true);const a=await xml(admin);assert(a.includes('Override EUR/unit'));assert(a.includes('IF($B$4='));assert(a.includes('Country total'));assert(a.includes('Overall total'));assert(a.includes('SUM('));const publicReport=await reportAtClose(['credit-ie','credit-zero'],'2026-2027-P1',false),p=await xml(publicReport);assert(!/EUR|B\$4|Recorded value|unit price/.test(p));assert(!('valueCents' in publicReport.totals));});
await check('Price changes preserve original charges and are platform-only, prospective and validated',async()=>{const date=new Date(Date.now()+3600000).toISOString();for(const cents of [-1,1.1,1000001])assert.equal((await call(m.settings,'POST','/api/admin/credits',{action:'price',cents,effectiveAt:date},{admin:true})).status,400);assert.equal((await call(m.settings,'POST','/api/admin/credits',{action:'price',cents:450,effectiveAt:'2024-01-01'},{admin:true})).status,400);const before=await one('SELECT unit_cents FROM assignment_history WHERE billed LIMIT 1');assert.equal((await call(m.settings,'POST','/api/admin/credits',{action:'price',cents:450,effectiveAt:date},{admin:true})).status,200);assert.deepEqual(await one('SELECT unit_cents FROM assignment_history WHERE billed LIMIT 1'),before);});
await check('A bulk request with insufficient credits rolls back every assignment and ledger debit',async()=>{await q("INSERT INTO organisation_stores(id,name,country,active,updated_by,updated_at) VALUES('low-credit','Low credit','Ireland',true,'test','2026-10-08')");await q("SELECT ensure_store_credits('low-credit','Low credit','Ireland')");await q("UPDATE store_credit_accounts SET balance=1 WHERE store_id='low-credit'");for(const id of ['bulk-one','bulk-two'])await person(id,'low-credit');const r=await call(m.manager,'POST','/api/store',{storeId:'low-credit',courseIds:['second-course'],userIds:['bulk-one','bulk-two']},{admin:true});assert.equal(r.status,409,await r.clone().text());assert.equal(await balance('low-credit'),1);assert.equal((await q("SELECT * FROM assignment_history WHERE store_id='low-credit'")).length,0);assert.equal((await q("SELECT * FROM credit_ledger WHERE store_id='low-credit' AND kind='assignment'")).length,0);});
await check('Manual top-up restores the allowance once and rejects unprivileged callers',async()=>{const payload={action:'topup',storeId:'low-credit',reason:'Approved extra training'};assert.equal((await call(m.settings,'POST','/api/admin/credits',payload,{user:'org-admin'})).status,403);for(let i=0;i<2;i++)assert.equal((await call(m.settings,'POST','/api/admin/credits',payload,{admin:true})).status,200);assert.equal(await balance('low-credit'),100);assert.equal((await q("SELECT * FROM credit_ledger WHERE store_id='low-credit' AND kind='manual_topup'")).length,1);});
await check('Calendar input rejects malformed and overlapping dates without a partial year',async()=>{assert.equal((await call(m.settings,'POST','/api/admin/credits',{action:'calendar',yearLabel:'2027/2028',periods:Array(13).fill(null)},{admin:true})).status,400);const start=Date.parse('2027-09-19T00:00:00Z'),periods=Array.from({length:13},(_,i)=>({startsOn:new Date(start+i*28*86400000).toISOString().slice(0,10),endsOn:new Date(start+((i+1)*28-1)*86400000).toISOString().slice(0,10)}));const body={action:'calendar',yearLabel:'2027/2028',periods};assert.equal((await call(m.settings,'POST','/api/admin/credits',body,{admin:true})).status,200);assert.equal((await call(m.settings,'POST','/api/admin/credits',{...body,yearLabel:'2028/2029'},{admin:true})).status,400);assert.equal((await q("SELECT * FROM accounting_periods WHERE year_label='2028/2029'")).length,0);assert.equal((await q("SELECT * FROM accounting_periods WHERE year_label='2027/2028'")).length,13);});
await check('Quarter ranges cover all thirteen periods once and retain week 53 in Q4',async()=>{
 const periods=await m.periods.accountingPeriods(),ranges=m.periods.reportingRanges(periods,'2026-10-08').filter(r=>r.yearLabel==='2026/2027');
 const quarters=ranges.filter(r=>r.kind==='quarter');
 assert.deepEqual(quarters.map(r=>[r.firstPeriod,r.lastPeriod]),[[1,3],[4,6],[7,9],[10,13]]);
 assert.equal(quarters[0].startsOn,'2026-09-13');assert.equal(quarters[3].endsOn,'2027-09-18');
 for(let i=1;i<4;i++)assert.equal(Date.parse(quarters[i].startsOn)-Date.parse(quarters[i-1].endsOn),86400000);
 assert.equal(ranges.find(r=>r.kind==='fytd').endsOn,'2026-10-08');
 assert(!m.periods.reportingRanges(periods,'2026-09-12').some(r=>r.kind==='fytd'));
 await q("SELECT ensure_store_credits('range-store','Range store','Ireland',NULL,'2026-09-13T00:00:00Z'::timestamptz)");
 await q("SELECT ensure_store_credits('never-store','Never assigned','Ireland',NULL,'2026-09-13T00:00:00Z'::timestamptz)");
 const starts=await q("SELECT period_number,starts_on::timestamp AT TIME ZONE 'Europe/London' AS at FROM accounting_periods WHERE year_label='2026/2027' ORDER BY period_number");
 for(const p of starts){const id='range-person-'+p.period_number;await person(id,'range-store');await assign(id,'second-course',p.at.toISOString());}
 for(const [i,range] of quarters.entries()){
  const report=await reportAtClose(['range-store'],range.id,true);assert.equal(report.totals.assignments,i===3?4:3);
  assert.equal(report.totals.net,report.totals.assignments);assert.equal(report.rows[0].opening+report.rows[0].topups-report.rows[0].assignments+report.rows[0].refunds,report.rows[0].closing);
 }
});
await check('Year-to-date uses London dates and excludes events after the current snapshot',async()=>{
 const before=await m.periods.periodReport(['range-store'],'2026-2027-P1-FYTD',true,new Date('2026-10-10T22:59:59Z'));
 const after=await m.periods.periodReport(['range-store'],'2026-2027-P1-FYTD',true,new Date('2026-10-10T23:00:01Z'));
 assert.equal(before.period.endsOn,'2026-10-10');assert.equal(before.totals.assignments,1);
 assert.equal(after.period.endsOn,'2026-10-11');assert.equal(after.totals.assignments,2);assert.equal(after.rows[0].daysSinceAssignment,0);
 const full=await reportAtClose(['range-store'],'2026-2027-P1-FYTD',true);assert.equal(full.period.endsOn,'2027-09-18');assert.equal(full.totals.assignments,13);
 await assert.rejects(m.periods.periodReport(null,'2026-2027-P1-Q5',true),/accounting period/);
 await assert.rejects(m.periods.periodReport(null,'2026-2027-P1-FYTD',true,new Date('2026-09-12T12:00:00Z')),/accounting period/);
});
await check('Inactivity uses historical cutoff and calendar days across DST, including preserved and removed assignments',async()=>{
 const closed=await reportAtClose(['range-store','never-store','legacy-store','credit-zero'],'2026-2027-P2',true);
 const row=id=>closed.rows.find(r=>r.storeId===id);
 assert.equal(closed.asOf,'2026-11-07');assert.equal(row('range-store').lastAssignedAt,'2026-10-10T23:00:00.000Z');assert.equal(row('range-store').daysSinceAssignment,27);
 assert.equal(row('never-store').lastAssignedAt,null);assert.equal(row('never-store').daysSinceAssignment,null);
 assert.equal(row('legacy-store').daysSinceAssignment,37);assert.equal(row('credit-zero').daysSinceAssignment,28);
 const current=await m.periods.periodReport(['range-store'],'2026-2027-P2',true,new Date('2026-10-25T12:00:00Z'));
 assert.equal(current.asOf,'2026-10-25');assert.equal(current.rows[0].daysSinceAssignment,14);
 const old=await reportAtClose(['range-store'],'2026-2027-P1',true);assert.equal(old.rows[0].lastAssignedAt,'2026-09-12T23:00:00.000Z');
});
await check('Inactivity filtering, global ordering and totals match the selected stores',async()=>{
 const original=await reportAtClose(['range-store','never-store','legacy-store','credit-zero'],'2026-2027-P2',true);
 const view=m.reportView.periodReportView(original,{zeroOnly:true,sort:'inactive'});
 assert.deepEqual(view.rows.map(r=>r.storeId),['legacy-store','credit-zero','never-store']);assert.equal(view.totals.stores,3);assert.equal(view.totals.assignments,0);assert.equal(view.totals.refunds,1);assert.equal(view.totals.valueCents,-325);
 assert.equal(original.rows.length,4);assert.equal(m.reportView.periodReportView(original,{search:'never',zeroOnly:true}).rows.length,1);
 const none=m.reportView.periodReportView(original,{search:'no match'});assert.equal(none.rows.length,0);assert.equal(none.totals.net,0);assert.equal(none.countries.length,0);
});
await check('Quarter and YTD API exports preserve role scope, filters and price privacy',async()=>{
 mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-08T12:00:00Z')});
 try{
 const result=await call(m.report,'GET','/api/reporting/periods?role=country&country=Ireland&period=2026-2027-P1-Q1&zeroOnly=1&search=credit-zero&sort=inactive',null,{user:'country-admin'});
 assert.equal(result.status,200,await result.clone().text());const report=await result.json();assert.equal(report.rows.length,1);assert.equal(report.rows[0].storeId,'credit-zero');assert.equal(report.sort,'inactive');assert.equal(report.totals.stores,1);assert(!JSON.stringify(report).includes('valueCents'));
 assert.equal((await call(m.report,'GET','/api/reporting/periods?role=site&site=credit-us&period=2026-2027-P1-Q1',null,{user:'country-admin'})).status,403);
 for(const range of ['2026-2027-P1-Q1','2026-2027-P1-FYTD']){
  const response=await call(m.report,'GET','/api/reporting/periods?period='+range+'&export=xlsx&zeroOnly=1&search=credit-zero&sort=inactive',null,{user:'org-admin'});
  assert.equal(response.status,200,await response.clone().text());assert(response.headers.get('content-type').includes('spreadsheetml'));
  const zip=new ZipReader(new Uint8ArrayReader(new Uint8Array(await response.arrayBuffer())),{useWebWorkers:false});const entries=await zip.getEntries();const xml=await entries.find(e=>e.filename==='xl/worksheets/sheet1.xml').getData(new TextWriter());await zip.close();
  assert(xml.includes(range.endsWith('Q1')?'Q1 (Periods 1–3)':'Financial Year to Date'));assert(xml.includes('Days since last assignment'));assert(!xml.includes('credit-ie'));assert(!xml.includes('Country total'));assert(!/EUR|B\$4|Recorded value/.test(xml));
 }
 const sortedReport=m.reportView.periodReportView(await reportAtClose(['legacy-store','credit-zero'],'2026-2027-P2',true),{zeroOnly:true,sort:'inactive'});
 const zip=new ZipReader(new Uint8ArrayReader(await m.xlsx.periodWorkbook(sortedReport)),{useWebWorkers:false}),entries=await zip.getEntries();
 const xml=await entries.find(e=>e.filename==='xl/worksheets/sheet1.xml').getData(new TextWriter());await zip.close();
 assert(xml.includes('SUM(D7:D8)'));assert(xml.includes('IF($B$4=&quot;&quot;,M7,ROUND(F7*$B$4,2))'));assert(xml.includes('Last assignment (Europe/London)'));
 assert(/<c r="P7" s="0"><v>37<\/v><\/c>/.test(xml),'Inactivity day counts must not use currency formatting');
 }finally{mock.timers.reset();}
});

await check('Assignment volume ranks globally with deterministic ties, zeros and filtered totals',async()=>{
 const base=await reportAtClose(['never-store'],'2026-2027-P1',true);
 const rows=[['us-tie','United States',3],['ie-zero','Ireland',0],['ie-tie-b','Ireland',3],['us-busy','United States',12],['ie-tie-a','Ireland',3]].map(([id,country,assignments])=>({...base.rows[0],storeId:id,storeName:id,country,assignments,net:assignments}));
 const original={...base,rows},view=m.reportView.periodReportView(original,{sort:'assignments'});
 assert.deepEqual(view.rows.map(r=>r.storeId),['us-busy','ie-tie-a','ie-tie-b','us-tie','ie-zero']);assert.equal(view.totals.assignments,21);assert.equal(view.totals.stores,5);
 assert.deepEqual(original.rows.map(r=>r.storeId),['us-tie','ie-zero','ie-tie-b','us-busy','ie-tie-a']);
 const filtered=m.reportView.periodReportView(original,{sort:'assignments',search:'Ireland'});assert.deepEqual(filtered.rows.map(r=>r.storeId),['ie-tie-a','ie-tie-b','ie-zero']);assert.equal(filtered.totals.assignments,6);
 const zero=m.reportView.periodReportView(original,{sort:'assignments',zeroOnly:true});assert.deepEqual(zero.rows.map(r=>r.storeId),['ie-zero']);assert.equal(zero.totals.assignments,0);
});
await check('Assignment sort reaches the API and Excel without regrouping or changing price privacy',async()=>{
 mock.timers.enable({apis:['Date'],now:Date.parse('2028-01-01T12:00:00Z')});
 try{
 for(const options of [{user:'org-admin'},{admin:true}]){
  const url='/api/reporting/periods?period=2026-2027-P1&search=credit-&sort=assignments';
  const response=await call(m.report,'GET',url,null,options);assert.equal(response.status,200,await response.clone().text());const report=await response.json();
  assert.equal(report.sort,'assignments');assert.deepEqual(report.rows.map(r=>r.storeId),['credit-ie','credit-us','credit-zero']);assert.equal(report.totals.stores,3);
  const exported=await call(m.report,'GET',url+'&export=xlsx',null,options);assert.equal(exported.status,200,await exported.clone().text());
  const zip=new ZipReader(new Uint8ArrayReader(new Uint8Array(await exported.arrayBuffer())),{useWebWorkers:false}),entries=await zip.getEntries();
  const xml=await entries.find(e=>e.filename==='xl/worksheets/sheet1.xml').getData(new TextWriter());await zip.close();
  const cells=new XMLParser({ignoreAttributes:false}).parse(xml).worksheet.sheetData.row.flatMap(row=>row.c||[]);
  for(const [i,row] of report.rows.entries())assert.equal(cells.find(c=>c['@_r']===`B${i+7}`)?.is?.t?.['#text'],row.storeCode);
  assert(!xml.includes('Country total'));assert(xml.includes('SUM(D7:D9)'));assert.equal(xml.includes('Override EUR/unit'),!!options.admin);assert.equal(xml.includes('IF($B$4='),!!options.admin);
 }
 const fallback=await call(m.report,'GET','/api/reporting/periods?period=2026-2027-P1&sort=unknown',null,{user:'org-admin'});assert.equal((await fallback.json()).sort,'store');
 }finally{mock.timers.reset();}
});

await check('Archived unused stores leave the period report while historical activity remains reportable',async()=>{
 await q("SELECT ensure_store_credits('retired-empty','Unused legacy','Ireland')");
 await q("UPDATE store_credit_accounts SET active=false WHERE store_id IN ('retired-empty','credit-ie')");
 try {
  const report=await reportAtClose(['retired-empty','credit-ie'],'2026-2027-P1',true);
  assert(!report.rows.some(r=>r.storeId==='retired-empty'));
  assert(report.rows.some(r=>r.storeId==='credit-ie'));
 } finally {await q("UPDATE store_credit_accounts SET active=true WHERE store_id='credit-ie'");}
});
console.log(`${checks} credit and accounting checks passed in isolated PostgreSQL.`);
await pg.close();rmSync(dir,{recursive:true,force:true});
