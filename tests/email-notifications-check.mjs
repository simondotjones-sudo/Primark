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
writeFileSync(entry,`export * as mail from '${process.cwd()}/lib/email-notifications.ts';
export * as reports from '${process.cwd()}/lib/scheduled-reports.ts';
export * as training from '${process.cwd()}/lib/training-report.ts';
export * as worker from '${process.cwd()}/lib/email-worker.ts';
export * as api from '${process.cwd()}/app/api/admin/emails/route.ts';
export * as invites from '${process.cwd()}/app/api/invitations/route.ts';
export * as prototype from '${process.cwd()}/app/api/prototype/route.ts';
export * as delivery from '${process.cwd()}/lib/email-delivery.ts';
export * as template from '${process.cwd()}/lib/email-templates.ts';
export {storeDirectory} from '${process.cwd()}/lib/store-directory.ts';
export {hash} from '${process.cwd()}/lib/server.ts';`);
await build({entryPoints:[entry],outfile:join(dir,'bundle.mjs'),bundle:true,platform:'node',format:'esm',tsconfig:'tsconfig.json',plugins:[{name:'test',setup(b){
 b.onResolve({filter:/^@netlify\/database$/},()=>({path:'db',namespace:'test'}));
 b.onResolve({filter:/^@\/lib\/admin-auth$/},()=>({path:'auth',namespace:'test'}));
 b.onResolve({filter:/^next\/headers$/},()=>({path:'cookies',namespace:'test'}));
 b.onResolve({filter:/^next\/server$/},()=>({path:'next',namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},a=>({contents:a.path==='db'?'export const getDatabase=()=>({pool:globalThis.__creditTest.pool});':a.path==='auth'?'export const getAdminUser=async()=>globalThis.__creditTest.identity();export const ADMIN_COOKIE="primark_admin";export const safeReturnTo=v=>v||"/";export const passwordMatches=async()=>false;export const credentials=()=>null;export const allowLoginAttempt=async()=>true;export const credentialFingerprint=async()=>"unused";export const sessionCredentialFingerprint=async()=>"unused";':a.path==='cookies'?"export const cookies=async()=>({get:n=>n==='primark_session'&&globalThis.__creditTest.cookie()?{value:globalThis.__creditTest.cookie()}:undefined});":'export class NextRequest extends Request {}; export class NextResponse extends Response {cookies={set(){},delete(){}};static json(data,init){return new NextResponse(JSON.stringify(data),{...init,headers:{...init?.headers,"Content-Type":"application/json"}})}};',loader:'js'}));
}}]});
const m=await import(join(dir,'bundle.mjs'));let checks=0;
const q=async(sql,...args)=>(await pg.query(sql,args)).rows;
const one=async(sql,...args)=>(await q(sql,...args))[0];
async function check(name,fn){await fn();console.log('PASS '+name);checks++;}
const stamp=new Date(),day=86400000;
const at=days=>new Date(stamp.getTime()+days*day).toISOString();
const actor={email:'platform@test.invalid',platformAdmin:true,access:{scope:'organisation',country:null,siteId:null},managerStoreId:null};
const settings=async(enabled)=>q("UPDATE email_settings SET mode='live',active_since=$1,enabled=$2,enabled_since='{}'",at(-365),JSON.stringify(enabled));
const candidates=async(date=at(0))=>q('SELECT * FROM learning_email_candidates($1::timestamptz)',date);
async function call(mod,method,path,body,{user='',admin=false,origin='https://local.test'}={}){return context.run({user,admin},async()=>{const req=new Request('https://local.test'+path,{method,headers:{'Content-Type':'application/json',Origin:origin,...(user?{Cookie:'primark_session='+user}:{})},...(body?{body:JSON.stringify(body)}:{})});req.nextUrl=new URL(req.url);req.cookies={get:n=>n==='primark_session'&&user?{value:user}:undefined};return mod[method](req);});}
let store;
const person=async(id,login=at(-2))=>{await q('INSERT INTO learners(id,name,email,code_hash,store_id,country,entered_at,last_login_at) VALUES($1,$1,$2,$1,$3,$4,$5,$6)',id,id+'@test.invalid',store.id,store.country,at(-100),login);await q('INSERT INTO sessions(token_hash,learner_id,expires_at) VALUES($1,$2,$3)',await m.hash(id),id,at(100));};
async function course(id){await q("INSERT INTO courses(id,title,status,audience_json,created_at,updated_at,catalogue_scope,validity_months,deadline_days) VALUES($1,$1,'published','{}',$2,$2,'global',12,30)",id,at(-100));await q("INSERT INTO course_packages(id,course_id,filename,status,scos_json,file_count,total_bytes,created_at) VALUES($1,$2,'fixture.zip','ready',$3,1,10,$4)",id+'-pack',id,JSON.stringify([{id:'sco',title:'Lesson',href:'index.html',mastery:'',launchData:''}]),at(-100));await q('UPDATE courses SET package_id=$2 WHERE id=$1',id,id+'-pack');}
async function assignment(id,cid){await q('SELECT assign_credit_course($1,$2,$3,$4::timestamptz)',id,cid,'test',at(-10));return (await one('SELECT history_id FROM course_assignments WHERE learner_id=$1 AND course_id=$2',id,cid)).history_id;}
async function cert(id,cid,aid,expiry=at(30),token='cert-'+id){await q(`INSERT INTO certificates(token,learner_id,course_id,package_id,course_title,learner_name,store_id,country,completed_at,expires_at,issued_at,assignment_id) VALUES($1,$2,$3,$4,$3,$2,$5,$6,$7,$8,$7,$9)`,token,id,cid,cid+'-pack',store.id,store.country,at(-1),expiry,aid);await q('UPDATE assignment_history SET completed_at=$2 WHERE id=$1',aid,at(-1));await q('UPDATE certificates SET expires_at=$2 WHERE token=$1',token,expiry);return token;}
const originalFetch=globalThis.fetch,messages=[],env={...process.env};
globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.postmarkapp.com/email');const body=JSON.parse(options.body);messages.push(body);assert(!body.TextBody.includes('Initial-password'));return Response.json({ErrorCode:0,MessageID:'message-'+messages.length});};
try{
 await q('UPDATE organisation_settings SET credits_enabled=false');store=(await m.storeDirectory()).find(s=>s.active&&s.country==='Ireland');
 for(const id of ['learner','archived','administrator','org','site','manager','pending-login'])await person(id,id==='pending-login'?null:at(-2));
 await q("UPDATE learners SET archived_at=$1 WHERE id='archived'",at(-1));
 await q("INSERT INTO reporting_access(learner_id,scope,country,site_id,assigned_by,updated_at) VALUES('administrator','organisation',NULL,NULL,'test',$1),('org','organisation',NULL,NULL,'test',$1),('site','site',$2,$3,'test',$1)",at(-1),store.country,store.id);
 await q("INSERT INTO store_managers(learner_id,store_id,assigned_by,updated_at) VALUES('manager',$1,'test',$2)",store.id,at(-1));
 await course('induction');const aid=await assignment('learner','induction');await cert('learner','induction',aid);
 await check('Migration defaults to off; missing credentials and preview never send or queue',async()=>{
  assert.equal((await m.mail.emailSettings()).mode,'off');
  delete process.env.POSTMARK_SERVER_TOKEN;delete process.env.PRIMARK_EMAIL_DELIVERY;
  assert((await m.worker.runEmailNotifications()).disabled);assert.equal(messages.length,0);assert.equal((await q('SELECT * FROM email_outbox')).length,0);
  process.env.POSTMARK_SERVER_TOKEN='mock-token';process.env.POSTMARK_FROM_EMAIL='sender@test.invalid';process.env.PRIMARK_APP_URL='https://learning.test.invalid';process.env.CONTEXT='production';process.env.PRIMARK_EMAIL_DELIVERY='enabled';
  await q("UPDATE email_settings SET mode='preview'");await m.worker.runEmailNotifications();assert.equal(messages.length,0);assert.equal((await q('SELECT * FROM email_outbox')).length,0);
  process.env.CONTEXT='deploy-preview';assert.equal(m.delivery.emailConnection().ready,false);process.env.CONTEXT='production';
  process.env.POSTMARK_SERVER_TOKEN='POSTMARK_API_TEST';assert.equal(m.delivery.emailConnection().ready,false);process.env.POSTMARK_SERVER_TOKEN='mock-token';
 });
 await check('Exact 30, 14 and 3-day reminders plus expired notice, once per certificate milestone',async()=>{
  await settings(['expiry_reminder','expired']);
  for(const days of [30,14,3,0]){
   const time=at(30-days);const rows=await candidates(time);assert.equal(rows.length,1,JSON.stringify(rows));assert.equal(rows[0].kind,days?'expiry_reminder':'expired');assert.equal(rows[0].payload.days,days||undefined);
   assert.equal((await candidates(new Date(new Date(time).getTime()-1000).toISOString())).length,0);
   assert.equal((await candidates(new Date(new Date(time).getTime()+day).toISOString())).length,0);
  }
 });
 await check('Cancelled certificates, archived people and admin-only accounts are excluded',async()=>{
  await q("UPDATE certificates SET cancelled_at=$1 WHERE token='cert-learner'",at(0));assert.equal((await candidates()).length,0);await q("UPDATE certificates SET cancelled_at=NULL WHERE token='cert-learner'");
  await q("UPDATE learners SET archived_at=$1 WHERE id='learner'",at(0));assert.equal((await candidates()).length,0);await q("UPDATE learners SET archived_at=NULL WHERE id='learner'");
  await q("INSERT INTO reporting_access(learner_id,scope,assigned_by,updated_at) VALUES('learner','organisation','test',$1)",at(0));assert.equal((await candidates()).length,0);await q("DELETE FROM reporting_access WHERE learner_id='learner'");
 });
 await check('Starting a renewal retains expiry warnings; completed renewal suppresses the old certificate',async()=>{
  await q("UPDATE certificates SET archived_at=$1 WHERE token='cert-learner'",at(0));assert.equal((await candidates()).length,1);
  await q(`INSERT INTO certificates(token,learner_id,course_id,package_id,course_title,learner_name,store_id,country,completed_at,expires_at,issued_at) VALUES('renewed','learner','induction','induction-pack','induction','learner',$1,$2,$3,$4,$3)`,store.id,store.country,at(0),at(365));assert.equal((await candidates()).length,0);
  await q("UPDATE certificates SET cancelled_at=$1,archived_at=$1 WHERE token='renewed'",at(0));await q("UPDATE certificates SET archived_at=NULL WHERE token='cert-learner'");
 });
 await check('Completed linked refresher suppresses original expiry notices',async()=>{
  await course('refresher');const rid=await assignment('learner','refresher');await cert('learner','refresher',rid,at(365),'refresher-cert');
  await q("INSERT INTO course_refresher_assignments(certificate_token,country,refresher_course_id,assignment_id,outcome,attempted_at) VALUES('cert-learner',$1,'refresher',$2,'assigned',$3)",store.country,rid,at(0));assert.equal((await candidates()).length,0);
  await q("UPDATE certificates SET cancelled_at=$1 WHERE token='refresher-cert'",at(0));assert.equal((await candidates()).length,1);
 });
 await check('Activation does not replay old reminders or assignment notices',async()=>{
  await q('UPDATE email_settings SET active_since=$1',at(0.1));assert.equal((await candidates(at(0.2))).length,0);
  await settings(['expiry_reminder']);
 });
 await check('Worker sends once, records provider acceptance and never logs message bodies or tokens',async()=>{
  // Candidate is just inside the current dispatch window.
  await q("UPDATE certificates SET expires_at=$1 WHERE token='cert-learner'",at(30));
  const before=messages.length;await m.worker.runEmailNotifications();assert.equal(messages.length,before+1);await m.worker.runEmailNotifications();assert.equal(messages.length,before+1);
  const rows=await q('SELECT * FROM email_outbox');assert.equal(rows[0].status,'sent');assert.equal(rows[0].to_email,'learner@test.invalid');assert(rows[0].provider_id);assert(!JSON.stringify(rows).includes('HtmlBody'));
 });
 await check('Settings, previews and invitation administration are organisation-scoped and same-origin',async()=>{
  for(const auth of [{},{user:'learner'},{user:'site'},{admin:true,origin:'https://evil.invalid'}])assert.equal((await call(m.api,'POST','/api/admin/emails',{action:'preview',kind:'expired'},auth)).status,403);
  const before=messages.length;const r=await call(m.api,'POST','/api/admin/emails',{action:'preview',kind:'invitation'},{user:'org'});assert.equal(r.status,200);const p=await r.json();assert(p.HtmlBody.includes('Sample Learner'));assert.equal(messages.length,before);
  const old=await m.mail.emailSettings();await assert.rejects(()=>m.mail.saveEmailSettings(actor,{...old,revision:old.revision+1}),/Reload/);
  await assert.rejects(()=>m.mail.saveEmailSettings(actor,{...old,expiry_days:[30,30]}),/Check/);
 });
 let invitation,inviteToken;
 await check('Draft invitations do not send; the 48-hour clock starts at actual provider acceptance',async()=>{
  await settings(['invitation','invitation_reminder']);
  invitation=await m.mail.createInvitation(actor,{name:'Invited Colleague',email:'invited@test.invalid',storeId:store.id});
  const before=messages.length;await m.worker.runEmailNotifications();assert.equal(messages.length,before);
  await m.mail.changeInvitation(actor,invitation,'queue');await m.worker.runEmailNotifications();assert.equal(messages.length,before+1);
  const i=await one('SELECT * FROM learning_invitations WHERE id=$1',invitation);assert(i.first_sent_at);inviteToken=new URL(messages.at(-1).TextBody.match(/https:\/\/\S+/)[0]).hash.slice(7);
  assert.equal(inviteToken.length,64);assert(!JSON.stringify(await q('SELECT * FROM learning_invitation_tokens')).includes(inviteToken));
  const due=new Date(new Date(i.first_sent_at).getTime()+48*3600000);
  assert.equal((await candidates(new Date(due.getTime()-1).toISOString())).length,0);
  const reminders=await candidates(due.toISOString());assert.equal(reminders.length,1);assert.equal(reminders[0].kind,'invitation_reminder');
 });
 await check('Invitation acceptance fixes email/store, creates one account, consumes the link and stops reminders',async()=>{
  const inspected=await m.mail.invitationForToken(inviteToken);assert.equal(inspected.email,'invited@test.invalid');
  const body={action:'register',invitationToken:inviteToken,name:'Invited Colleague',email:'invited@test.invalid',storeId:store.id,workdayId:'INV-0001',password:'Example-Password-123'};
  const wrong=await call(m.prototype,'POST','/api/prototype',{...body,email:'attacker@test.invalid'});assert.equal(wrong.status,400);
  const r=await call(m.prototype,'POST','/api/prototype',body);assert.equal(r.status,200,await r.clone().text());const learner=await one("SELECT * FROM learners WHERE email='invited@test.invalid'");assert(learner);assert(learner.last_login_at);
  assert((await one('SELECT * FROM learning_invitations WHERE id=$1',invitation)).accepted_at);await assert.rejects(()=>m.mail.invitationForToken(inviteToken),/no longer/);
  assert.equal((await candidates(at(2.01))).filter(x=>x.invitation_id===invitation).length,0);
 });
 await check('Existing accounts get a first-login reminder, not a create-account reminder',async()=>{
  await settings(['account_ready','account_reminder']);await q("UPDATE learners SET entered_at=$1 WHERE id='pending-login'",at(-0.01));await m.worker.runEmailNotifications();
  const welcome=await one("SELECT * FROM email_outbox WHERE event_key='account:pending-login'");assert.equal(welcome.status,'sent');
  const due=new Date(new Date(welcome.sent_at).getTime()+48*3600000).toISOString();assert((await candidates(due)).some(x=>x.kind==='account_reminder'));
  await q("UPDATE learners SET last_login_at=$1 WHERE id='pending-login'",at(0));assert(!(await candidates(due)).some(x=>x.kind==='account_reminder'));
 });
 await check('Deadline notices stop when learning completes; withdrawn assignments never notify',async()=>{
  await person('deadline-learner');const id=await assignment('deadline-learner','induction');await q('UPDATE assignment_history SET due_at=$2 WHERE id=$1',id,at(7));await settings(['deadline_reminder','overdue']);
  assert((await candidates()).some(x=>x.recipient_id==='deadline-learner'&&x.kind==='deadline_reminder'));assert((await candidates(at(7))).some(x=>x.kind==='overdue'));
  await q('UPDATE assignment_history SET completed_at=$2 WHERE id=$1',id,at(0));assert(!(await candidates()).some(x=>x.recipient_id==='deadline-learner'));
  await q('UPDATE assignment_history SET completed_at=NULL,cancelled_at=$2 WHERE id=$1',id,at(0));assert(!(await candidates()).some(x=>x.recipient_id==='deadline-learner'));
 });
 await check('Pathway assignments suppress duplicate course notices; assessment and certificate notices respect current completion',async()=>{
  await person('pathway-learner');await course('assessment-induction');await q("UPDATE courses SET assessor_required=true WHERE id='assessment-induction'");const id=await assignment('pathway-learner','assessment-induction');
  await q('UPDATE assignment_history SET assigned_at=$2 WHERE id=$1',id,at(-0.01));
  await q("INSERT INTO learning_pathways(id,name,items,updated_by) VALUES('email-path','Safety pathway',$1,'test')",JSON.stringify([{courseId:'assessment-induction',stage:1}]));
  await q("INSERT INTO pathway_enrolments(id,pathway_id,learner_id,pathway_revision,name,description,learner_name,award_certificate,assigned_at,assigned_by,due_at) VALUES('email-enrol','email-path','pathway-learner',1,'Safety pathway','','Pathway Learner',false,$1,'test',$2)",at(-0.01),at(7));
  await q("INSERT INTO pathway_enrolment_courses(enrolment_id,course_id,assignment_id,title,stage,position) VALUES('email-enrol','assessment-induction',$1,'Induction',1,1)",id);
  await settings(['course_assigned','pathway_assigned']);let rows=await candidates();assert.equal(rows.filter(x=>x.recipient_id==='pathway-learner'&&x.kind==='pathway_assigned').length,1);assert.equal(rows.filter(x=>x.recipient_id==='pathway-learner'&&x.kind==='course_assigned').length,0);
  await q('UPDATE assignment_history SET theory_completed_at=$2 WHERE id=$1',id,at(-0.01));await settings(['assessment_pending']);assert((await candidates()).some(x=>x.recipient_id==='pathway-learner'));
  await q('UPDATE assignment_history SET completed_at=$2 WHERE id=$1',id,at(0));assert(!(await candidates()).some(x=>x.recipient_id==='pathway-learner'));
  await settings(['certificate_ready']);await q("UPDATE certificates SET issued_at=$1 WHERE token='cert-learner'",at(-0.01));assert((await candidates()).some(x=>x.recipient_id==='learner'));await q("UPDATE certificates SET cancelled_at=$1 WHERE token='cert-learner'",at(0));assert(!(await candidates()).some(x=>x.recipient_id==='learner'));
  await q("UPDATE certificates SET cancelled_at=NULL WHERE token='cert-learner'");
 });
 await check('Timeout or uncertain provider acceptance is never automatically resent',async()=>{
  await person('uncertain');const id=await assignment('uncertain','induction');await q('UPDATE assignment_history SET due_at=$2 WHERE id=$1',id,at(-0.01));await settings(['overdue']);
  let calls=0;const send=globalThis.fetch;globalThis.fetch=async()=>{calls++;throw new Error('lost response');};await m.worker.runEmailNotifications();await m.worker.runEmailNotifications();assert.equal(calls,1);assert.equal((await one('SELECT status FROM email_outbox WHERE recipient_id=$1','uncertain')).status,'unknown');globalThis.fetch=send;
 });
 await check('Explicit rate limiting retries with backoff; a later completion cancels the retry',async()=>{
  await person('retry');const id=await assignment('retry','induction');await q('UPDATE assignment_history SET due_at=$2 WHERE id=$1',id,at(-0.01));
  const send=globalThis.fetch;globalThis.fetch=async()=>new Response('',{status:429});await m.worker.runEmailNotifications();const job=await one("SELECT * FROM email_outbox WHERE recipient_id='retry'");assert.equal(job.status,'queued');assert(new Date(job.next_attempt_at)>stamp);
  await q('UPDATE assignment_history SET completed_at=$2 WHERE id=$1',id,at(0));await q('UPDATE email_outbox SET next_attempt_at=$2 WHERE id=$1',job.id,at(-1));globalThis.fetch=send;const before=messages.length;await m.worker.runEmailNotifications();assert.equal(messages.length,before);assert.equal((await one('SELECT status FROM email_outbox WHERE id=$1',job.id)).status,'cancelled');
 });
 await check('Manager summary is scoped to the current store, scheduled Monday 08:00 London with DST',async()=>{
  await settings(['manager_digest']);const monday='2026-10-12T07:00:00Z';const rows=await candidates(monday);assert.equal(rows.length,1);assert.equal(rows[0].recipient_id,'manager');assert.equal(rows[0].payload.reportScope,store.id);const built=await m.reports.buildScheduledReport('manager_digest',rows[0].payload);assert(built.report.overdue>=1);assert(built.report.rows.some(r=>r.name==='uncertain'));assert(!built.report.rows.some(r=>r.name==='archived'));assert(!JSON.stringify(rows[0].payload).includes('test.invalid'));
  assert.equal((await candidates('2026-10-12T06:59:59Z')).length,0);assert.equal((await candidates('2026-11-02T07:59:59Z')).length,0);assert.equal((await candidates('2026-11-02T08:00:00Z')).length,1);
 });
 await check('Report schedules enforce access, feature gates, validation, revision checks and audit',async()=>{
  const schedules=await m.reports.reportSchedules();const weekly=schedules.find(s=>s.kind==='manager_digest');
  const body={action:'report_schedule',...weekly,weekday:3,hour:9,timezone:'Europe/Dublin'};
  for(const user of ['', 'learner','site','manager'])assert.equal((await call(m.api,'POST','/api/admin/emails',body,{user})).status,403);
  assert.equal((await call(m.api,'POST','/api/admin/emails',{...body,monthday:31},{user:'org'})).status,400);
  assert.equal((await call(m.api,'POST','/api/admin/emails',{...body,timezone:'Invented/Zone'},{user:'org'})).status,400);
  assert.equal((await call(m.api,'POST','/api/admin/emails',body,{user:'org',origin:'https://evil.invalid'})).status,403);
  assert.equal((await call(m.api,'POST','/api/admin/emails',body,{user:'org'})).status,200);
  assert.equal((await call(m.api,'POST','/api/admin/emails',body,{user:'org'})).status,409);
  assert.equal((await candidates('2026-10-12T07:00:00Z')).length,0);
  assert.equal((await candidates('2026-10-14T07:59:59Z')).length,0);
  assert.equal((await candidates('2026-10-14T08:00:00Z')).length,1);
  assert((await q("SELECT * FROM audit_events WHERE entity='scheduled_report'")).length);
  await q("UPDATE organisation_settings SET features=jsonb_set(features,'{weekly_store_reports,policy}','\"disabled\"')");
  assert.equal((await candidates('2026-10-14T08:00:00Z')).length,0);
  assert.equal((await call(m.api,'POST','/api/admin/emails',{...body,revision:weekly.revision+1},{user:'org'})).status,403);
  await q("UPDATE organisation_settings SET features=jsonb_set(features,'{weekly_store_reports,policy}','\"optional\"')");
 });
 await check('Monthly recipients follow current country permissions and parent feature switches',async()=>{
  await settings(['country_digest']);assert.equal((await candidates('2026-11-01T08:00:00Z')).length,0);
  await q("UPDATE organisation_settings SET features=jsonb_set(features,'{monthly_country_reports,enabled}','true')");
  await person('country-report-admin');await q("INSERT INTO reporting_access VALUES('country-report-admin','country',$1,NULL,'test',$2)",store.country,at(0));
  const rows=await candidates('2026-11-01T08:00:00Z');
  assert(rows.some(r=>r.recipient_id==='org'&&r.payload.reportScope===store.country));
  const mine=rows.filter(r=>r.recipient_id==='country-report-admin');assert.equal(mine.length,1);assert.equal(mine[0].payload.reportScope,store.country);
  const summary=await m.reports.buildScheduledReport('country_digest',mine[0].payload);assert.equal(summary.report.rows.length,0);assert(summary.report.assessed>0);
  assert(!rows.some(r=>['learner','manager','site','archived'].includes(r.recipient_id)));
  assert.equal(new Set(rows.map(r=>r.event_key)).size,rows.length);
  assert.equal((await candidates('2026-11-01T07:59:59Z')).length,0);
  assert.equal((await candidates('2026-11-02T08:00:00Z')).length,0);
  assert((await candidates('2026-07-01T07:00:00Z')).length>0);
  await q("DELETE FROM reporting_access WHERE learner_id='country-report-admin'");
  assert(!(await candidates('2026-11-01T08:00:00Z')).some(r=>r.recipient_id==='country-report-admin'));
  await q("UPDATE organisation_settings SET features=jsonb_set(features,'{scheduled_reports,enabled}','false')");assert.equal((await candidates('2026-11-01T08:00:00Z')).length,0);
  await q("UPDATE organisation_settings SET features=jsonb_set(features,'{scheduled_reports,enabled}','true')");
 });
 await check('Report previews share dashboard compliance, are scoped, and never send or queue',async()=>{
  const before=messages.length,queued=(await q('SELECT id FROM email_outbox')).length;
  const summary=await m.reports.buildScheduledReport('manager_digest',{name:'Manager',reportScope:store.id});
  const overview=await m.training.trainingOverview([store.id]);
  assert.equal(summary.report.compliance,overview.metrics.compliance);assert.equal(summary.report.assessed,overview.metrics.assessed);
  const other=(await m.storeDirectory()).find(s=>s.active&&s.id!==store.id);
  const empty=await m.reports.buildScheduledReport('manager_digest',{name:'Manager',reportScope:other.id});assert.equal(empty.report.overdue,0);assert.equal(empty.report.rows.length,0);
  const body={action:'report_preview',kind:'manager_digest',scope:store.id};
  assert.equal((await call(m.api,'POST','/api/admin/emails',body,{user:'manager'})).status,403);
  const response=await call(m.api,'POST','/api/admin/emails',body,{user:'org'});assert.equal(response.status,200,await response.clone().text());
  const preview=await response.json();assert(preview.TextBody.includes('Compliance:'));assert(preview.TextBody.includes('uncertain'));
  assert.equal(messages.length,before);assert.equal((await q('SELECT id FROM email_outbox')).length,queued);
 });
 await check('Worker generates reports once per period and rechecks access before delivery',async()=>{
  await settings(['manager_digest']);
  const local=new Date().getUTCDay()||7,hour=new Date().getUTCHours();
  await q("UPDATE scheduled_report_settings SET weekday=$1,hour=$2,timezone='UTC' WHERE kind='manager_digest'",local,hour);
  const before=messages.length;await m.worker.runEmailNotifications();assert.equal(messages.length,before+1);assert(messages.at(-1).TextBody.includes('Compliance:'));
  await m.worker.runEmailNotifications();assert.equal(messages.length,before+1);
  const event=(await candidates()).find(r=>r.kind==='manager_digest');
  await q("UPDATE email_outbox SET status='queued',next_attempt_at=now() WHERE event_key=$1",event.event_key);
  await q("DELETE FROM store_managers WHERE learner_id='manager'");await m.worker.runEmailNotifications();assert.equal(messages.length,before+1);
  assert.equal((await one('SELECT status FROM email_outbox WHERE event_key=$1',event.event_key)).status,'cancelled');
 });
 await check('All templates escape authored content and contain plain-text alternatives',async()=>{
  for(const kind of ['invitation','invitation_reminder','account_ready','account_reminder','course_assigned','pathway_assigned','deadline_reminder','overdue','expiry_reminder','expired','certificate_ready','assessment_pending','manager_digest','country_digest','password_reset']){const p=m.template.renderLearningEmail(kind,{name:'<img src=x onerror=alert(1)>',title:'<script>evil</script>',date:at(0),days:3},'https://learning.test.invalid');assert(p.TextBody);assert(!p.HtmlBody.includes('<script>'));assert(!p.HtmlBody.includes('<img src=x'));if(kind!=='password_reset')assert(p.HtmlBody.includes('&lt;img'));}
 });
 console.log(`PASS ${checks} email notification integration checks`);
}finally{globalThis.fetch=originalFetch;for(const key of ['POSTMARK_SERVER_TOKEN','POSTMARK_FROM_EMAIL','PRIMARK_APP_URL','CONTEXT','PRIMARK_EMAIL_DELIVERY']){if(env[key]===undefined)delete process.env[key];else process.env[key]=env[key];}await pg.close();rmSync(dir,{recursive:true,force:true});}
