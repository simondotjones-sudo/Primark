import {requireFeature} from '@/lib/features';
import {createHash} from 'node:crypto';
import {credentials} from '@/lib/admin-auth';
import {CourseError} from '@/lib/course-admin';
import {inTransaction} from '@/lib/database';
import {hash,randomToken} from '@/lib/server';
import {hashPassword,normalizeWorkdayId,validPassword} from '@/lib/learner-auth';
import {learnerOnlySql} from '@/lib/account-type';
import {storeDirectory} from '@/lib/store-directory';
import type {UserAdministrator} from '@/lib/user-administration';
import {parseLearnerCsv,type ImportPreviewRow} from '@/lib/learner-import-csv';

type Person={id:string;name:string;email:string|null;workday_id:string;store_id:string;country:string;archived_at:string|null;employment_started_on:string|null;employment_ended_on:string|null;admin_only:boolean};
const dateValue=(value:unknown)=>value instanceof Date?value.toISOString().slice(0,10):String(value||'').slice(0,10);
export async function importLearners(actor:UserAdministrator,csv:string,mode:string,revision?:string){
 if(!actor.platformAdmin&&actor.access.scope!=='organisation')throw new CourseError('Organisation admin access is required.',403);
 await requireFeature('bulk_import');
 if(!['create','update','upsert'].includes(mode))throw new CourseError('Choose an import mode.');
 let rows;try{rows=parseLearnerCsv(csv);}catch(e){throw new CourseError((e as Error).message);}
 // Passwords never enter previews, audit events or error reports. Hash before taking locks.
 const passwords=new Map<number,string>();
 if(revision)for(const row of rows)if(validPassword(row.record.initial_password))passwords.set(row.row,await hashPassword(row.record.initial_password));
 return inTransaction(async client=>{
  // Short, bounded transaction: protect identity uniqueness, permissions and store changes.
  await client.query('LOCK TABLE learners,platform_admins,reporting_access,store_managers,assessor_accounts,organisation_stores IN SHARE ROW EXCLUSIVE MODE');
  if(actor.id){const current=(await client.query(`SELECT l.archived_at,EXISTS(SELECT 1 FROM platform_admins WHERE learner_id=l.id) AS platform,EXISTS(SELECT 1 FROM reporting_access WHERE learner_id=l.id AND scope='organisation') AS organisation FROM learners l WHERE id=$1`,[actor.id])).rows[0];if(!current||current.archived_at||(!current.platform&&!current.organisation))throw new CourseError('Organisation admin access is required.',403);}
  const lifecycleEnabled=!!(await client.query("SELECT feature_enabled('lifecycle') enabled")).rows[0].enabled;
  const stores=await storeDirectory();
  const ids=rows.map(r=>normalizeWorkdayId(r.record.workday_id)).filter(Boolean);
  const emails=rows.map(r=>r.record.email.toLowerCase()).filter(Boolean);
  const people=(await client.query(`SELECT l.id,l.name,l.email,l.workday_id,l.store_id,l.country,l.archived_at,l.employment_started_on,l.employment_ended_on,NOT (${learnerOnlySql()}) AS admin_only FROM learners l WHERE l.workday_id=ANY($1::text[]) OR lower(l.email)=ANY($2::text[]) ORDER BY l.id`,[ids,emails])).rows as unknown as Person[];
  const seenIds=new Set<string>(),seenEmails=new Set<string>();
  const today=new Date().toISOString().slice(0,10);
  const dateOk=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v&&v<=today;
  const plans=rows.map(({row,record:r})=>{
   const id=normalizeWorkdayId(r.workday_id)||'',target=people.find(p=>p.workday_id===id);
   const out:ImportPreviewRow={row,workdayId:id||r.workday_id,name:r.name||target?.name||'',action:target?'Update':'Create',changes:[],errors:[]};
   const error=(s:string)=>out.errors.push(s);
   if(!id)error('Enter a valid Workday ID.');
   if(seenIds.has(id))error('Duplicate Workday ID in this file.');seenIds.add(id);
   if(target&&(target.admin_only||target.id===actor.id||target.email===actor.email||target.email===credentials()?.email))error('Only learner accounts can be imported.');
   if(target&&mode==='create')error('This Workday ID already exists.');
   if(!target&&mode==='update')error('This Workday ID does not exist.');
   const name=(r.name||target?.name||'').replace(/\s+/g,' '),email=(r.email||target?.email||'').toLowerCase();
   if(name.length<2||name.length>101)error('Enter a name with 2–101 characters.');
   if(email&&(email.length>254||/[<>,;:"\\]/.test(email)||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))error('Enter a valid email address.');
   if(!target&&!email)error('Enter a valid email address.');
   if(email&&(email===credentials()?.email||people.some(p=>p.email?.toLowerCase()===email&&p.id!==target?.id)))error('This email is already registered.');
   if(email&&seenEmails.has(email))error('Duplicate email in this file.');if(email)seenEmails.add(email);
   const matches=r.store_code?stores.filter(s=>s.storeCode===r.store_code):stores.filter(s=>s.id===target?.store_id);
   const store=matches.length===1?matches[0]:undefined;
   const status=r.status.toLowerCase()||'active';
   if(!['active','leaver','rejoin'].includes(status))error('Use active, leaver or rejoin for status.');
   if(!store||(!store.active&&status!=='leaver'))error('Choose an active, unambiguous store code.');
   if(!target&&status!=='active')error('New learners must have active status.');
   if(target?.archived_at&&status!=='rejoin')error('Use rejoin to restore an archived learner.');
   if(target&&!target.archived_at&&status==='rejoin')error('Only archived learners can rejoin.');
   const transfer=!!target&&!!store&&store.id!==target.store_id;
   if(status==='leaver'&&transfer)error('Do not combine a transfer with leaving.');
   const lifecycle=transfer||status==='leaver'||status==='rejoin';
   if(lifecycle&&!lifecycleEnabled)error('This feature is switched off in Settings.');
   const effective=r.effective_date;
   if(lifecycle&&(!dateOk(effective)||r.reason.length<3||r.reason.length>500))error('Transfers, leavers and rejoiners need an effective date and a reason (3–500 characters).');
   if(!lifecycle&&effective)error('Effective date is only for transfers, leavers and rejoiners.');
   if(r.start_date&&!dateOk(r.start_date))error('Choose a start date no later than today.');
   if(status==='rejoin'&&r.start_date&&r.start_date!==effective)error('For rejoiners, start date must match effective date.');
   const start=status==='rejoin'?effective:r.start_date||dateValue(target?.employment_started_on)||(!target?today:'');
   if(lifecycle&&start&&effective<start)error('The effective date cannot be before the employment start date.');
   if(!target&&!validPassword(r.initial_password))error('New learners need an initial password with 8–128 characters.');
   if(target&&r.initial_password)error('Leave initial password blank for existing learners.');
   const after={name,email:email||null,store_id:store?.id||'',country:store?.country||'',employment_started_on:start||null};
   for(const [field,value] of Object.entries(after)){const before=target?(field==='employment_started_on'?dateValue(target[field]):String(target[field as keyof Person]||'')):'';if(before!==String(value||''))out.changes.push({field,before,after:String(value||'')});}
   if(lifecycle){out.action=status==='leaver'?'Mark as leaver':status==='rejoin'?'Rejoin':'Transfer';out.changes.push({field:'status',before:target?.archived_at?'Archived':'Active',after:status==='leaver'?'Archived':'Active'},{field:'effective_date',before:'',after:effective},{field:'reason',before:'',after:r.reason});}
   if(target&&!out.changes.length)out.action='Unchanged';
   return {out,target,after,status,lifecycle,transfer,record:r};
  });
  const fingerprint=createHash('sha256').update(JSON.stringify({actor:actor.email,csv,mode,people,stores:stores.map(s=>[s.id,s.country,s.active,s.storeCode]),today})).digest('hex');
  const preview={rows:plans.map(p=>p.out),revision:fingerprint,valid:plans.every(p=>!p.out.errors.length),changed:plans.filter(p=>p.out.action!=='Unchanged').length};
  if(!revision)return preview;
  if(revision!==fingerprint)throw new CourseError('The file or learner records changed. Preview the file again.',409);
  if(!preview.valid)throw new CourseError('Fix every row error before applying the import.');
  const batch=crypto.randomUUID();let rowNumber=0;
  try{for(const p of plans){
   rowNumber=p.out.row;if(p.out.action==='Unchanged')continue;
   const id=p.target?.id||crypto.randomUUID(),a=p.after;
   await client.query("SELECT set_config('app.audit_actor',$1,true),set_config('app.audit_reason',$2,true)",[actor.email,`Bulk import ${batch}; row ${rowNumber}`+(p.lifecycle?`; ${p.record.reason} (effective ${p.record.effective_date})`:'')]);
   if(!p.target){await client.query('INSERT INTO learners(id,name,email,workday_id,store_id,country,entered_at,code_hash,password_hash,induction_enrolled,employment_started_on) VALUES($1,$2,$3,$4,$5,$6,now(),$7,$8,true,$9)',[id,a.name,a.email,p.out.workdayId,a.store_id,a.country,await hash(randomToken()),passwords.get(rowNumber),a.employment_started_on]);}
   else{
    await client.query('UPDATE learners SET name=$2,email=$3,store_id=$4,country=$5,employment_started_on=$6 WHERE id=$1',[id,a.name,a.email,a.store_id,a.country,a.employment_started_on]);
    if(p.lifecycle){await client.query('UPDATE learners SET archived_at=CASE WHEN $2 THEN now() ELSE NULL END,employment_ended_on=CASE WHEN $2 THEN $3::date ELSE NULL END,lifecycle_reason=$4 WHERE id=$1',[id,p.status==='leaver',p.record.effective_date,p.record.reason]);await client.query('UPDATE assessor_grants SET active=false WHERE learner_id=$1',[id]);if(p.status==='rejoin')await client.query('DELETE FROM assessor_accounts WHERE learner_id=$1',[id]);}
    if(p.target.country!==a.country)await client.query('DELETE FROM learner_inductions WHERE learner_id=$1',[id]);
    if(p.lifecycle||p.target.email!==a.email){await client.query('DELETE FROM sessions WHERE learner_id=$1',[id]);await client.query('DELETE FROM scorm_launches WHERE learner_id=$1',[id]);await client.query("DELETE FROM password_resets WHERE account_type='learner' AND account_id=$1",[id]);}
   }
   if(p.status!=='leaver')await client.query('SELECT sync_credit_assignments($1)',[id]);
  }}catch{throw new CourseError(`Import failed at row ${rowNumber}. No changes were saved. Check available credits and preview again.`,409);}
  const failures=(await client.query('SELECT COUNT(*)::int AS total FROM pathway_assignment_failures WHERE learner_id IN (SELECT id FROM learners WHERE workday_id=ANY($1::text[]))',[ids])).rows[0]?.total||0;
  return {...preview,applied:true,batch,pathwayFailures:failures};
 });
}
