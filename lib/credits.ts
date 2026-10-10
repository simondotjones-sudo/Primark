import {db,inTransaction} from '@/lib/database';
import {CourseError} from '@/lib/course-admin';
import type {UserAdministrator} from '@/lib/user-administration';

export const syncAssignments=(learnerId:string|null=null)=>db().prepare('SELECT sync_credit_assignments(?)').bind(learnerId);
const messages=new Set(['Renewal is available from 30 days before certificate expiry.','A refresher course is configured for this country.','Only an expired assignment can be renewed.','No credit price is configured for this date.',
 'This store has no credits available. Contact a platform admin for a top-up.','Assignment not found.',
 'This assignment has changed. Refresh and try again.','Assignments can be removed only within 14 days of assignment.',
 'Started or completed assignments cannot be removed.',
 'Enter a removal reason between 3 and 500 characters.']);
export function creditError(error:unknown){const e=error as {code?:string;message?:string};return e.code==='P0001'&&messages.has(e.message||'')?new CourseError(e.message!,409):error;}

// Recheck grants under the same learner lock used by access changes and SCORM.
export async function lockCreditActor(client:{query:(sql:string,args?:unknown[])=>Promise<{rows:Record<string,unknown>[]}>},actor:UserAdministrator,storeId:string){
 if(!actor.id){if(actor.platformAdmin)return;throw new CourseError('Store Manager access is required.',403);}
 const {rows:[row]}=await client.query(`SELECT l.archived_at,EXISTS(SELECT 1 FROM platform_admins WHERE learner_id=l.id) AS platform,
  EXISTS(SELECT 1 FROM store_managers WHERE learner_id=l.id AND store_id=$2) AS manager FROM learners l WHERE id=$1 FOR UPDATE`,[actor.id,storeId]);
 if(!row||row.archived_at||(!row.platform&&!row.manager))throw new CourseError('Store Manager access is required.',403);
}

export async function creditAccount(storeId:string){
 const {results:[account]}=await db().prepare(`SELECT a.store_id AS "storeId",a.balance,a.target,(SELECT credits_enabled FROM organisation_settings WHERE id=1) AS enabled,
  (SELECT min(starts_on)::text FROM accounting_periods WHERE starts_on>(now() AT TIME ZONE 'Europe/London')::date) AS "nextTopup",
  (SELECT count(*)::int FROM credit_ledger e JOIN accounting_periods p ON p.starts_on<=(now() AT TIME ZONE 'Europe/London')::date AND p.ends_on>=(now() AT TIME ZONE 'Europe/London')::date
   WHERE e.store_id=a.store_id AND e.kind='assignment' AND e.recorded_at>=p.starts_on::timestamp AT TIME ZONE 'Europe/London' AND e.recorded_at<(p.ends_on+1)::timestamp AT TIME ZONE 'Europe/London') AS "usedThisPeriod"
  FROM store_credit_accounts a WHERE a.store_id=?`).bind(storeId).all<CreditAccount>();
 return account||null;
}
export type CreditAccount={enabled:boolean;storeId:string;balance:number;target:number;nextTopup:string|null;usedThisPeriod:number};

export async function changeAssignment(actor:UserAdministrator,storeId:string,body:{action:string;assignmentId:string;reason?:string}){
 return inTransaction(async client=>{
  await lockCreditActor(client,actor,storeId);
  const {rows:[row]}=await client.query('SELECT learner_id,course_id,store_id FROM assignment_history WHERE id=$1',[body.assignmentId]);
  if(!row||row.store_id!==storeId)throw new CourseError('Assignment not found.',404);
  // Store transfers must not grant access to another store through an old record.
  const {rows:[learner]}=await client.query('SELECT store_id FROM learners WHERE id=$1 FOR UPDATE',[row.learner_id]);
  if(!learner||learner.store_id!==storeId)throw new CourseError('You can assign courses only to users in your store.',403);
  if(body.action==='remove'){
   const {rows:[result]}=await client.query('SELECT cancel_credit_assignment($1,$2,$3) AS result',[body.assignmentId,actor.email,body.reason||'']);return result.result;
  }
  if(body.action!=='renew')throw new CourseError('Invalid request.');
  const {rows:[current]}=await client.query('SELECT history_id FROM course_assignments WHERE learner_id=$1 AND course_id=$2',[row.learner_id,row.course_id]);
  if(current?.history_id!==body.assignmentId)throw new CourseError('This assignment has changed. Refresh and try again.',409);
  const {rows:[renewal]}=await client.query('SELECT assign_credit_course($1,$2,$3,now(),true) AS added',[row.learner_id,row.course_id,actor.email]);
  if(!renewal?.added)throw new CourseError('This assignment has changed. Refresh and try again.',409);
  return {renewed:true};
 });
}
