import type {NextRequest} from 'next/server';
import {requireUserAdministrator} from '@/lib/user-administration';
import {bodyJson,CourseError,failed,json} from '@/lib/course-admin';
import {db,inTransaction} from '@/lib/database';
import {featureEnabled} from '@/lib/features';
export const dynamic='force-dynamic';
async function manager(request?:NextRequest){const a=await requireUserAdministrator(request);if(!a.platformAdmin&&a.access.scope!=='organisation')throw new CourseError('Organisation or platform admin access is required.',403);return a;}
export async function GET(request:NextRequest){try{
 await manager();const search=(request.nextUrl.searchParams.get('search')||'').trim().slice(0,150),page=Number(request.nextUrl.searchParams.get('page')||1);
 if(!Number.isSafeInteger(page)||page<1||page>100000)throw new CourseError('Check the page number.');
 const rows=await db().prepare(`SELECT h.id,l.name,l.email,l.workday_id,c.title,h.assessor_required,h.completed_at,h.due_at,
 (SELECT jsonb_agg(r ORDER BY r.approved_at DESC) FROM training_recognitions r WHERE r.assignment_id=h.id) AS decisions
 FROM course_assignments a JOIN assignment_history h ON h.id=a.history_id JOIN learners l ON l.id=a.learner_id JOIN courses c ON c.id=a.course_id
 WHERE l.archived_at IS NULL AND h.cancelled_at IS NULL AND h.superseded_at IS NULL
 AND (?='' OR strpos(lower(l.name||' '||COALESCE(l.email,'')||' '||COALESCE(l.workday_id,'')||' '||c.title),lower(?))>0)
 ORDER BY l.name,l.id,c.title,h.id LIMIT 26 OFFSET ?`).bind(search,search,(page-1)*25).all();
 return json({enabled:await featureEnabled('training_recognition'),rows:rows.results.slice(0,25),hasMore:rows.results.length>25});
}catch(e){return failed(e);}}
export async function POST(request:NextRequest){try{
 const actor=await manager(request),b=await bodyJson(request,12000);
 if(!b||typeof b.assignmentId!=='string'||!['approve','revoke'].includes(b.action)||typeof b.reason!=='string'||b.reason.trim().length<3||b.reason.length>2000)throw new CourseError('Enter an assignment and a reason.');
 await inTransaction(async tx=>{
  if(actor.id){const allowed=(await tx.query("SELECT id FROM learners l WHERE id=$1 AND archived_at IS NULL AND (EXISTS(SELECT 1 FROM platform_admins p WHERE p.learner_id=l.id) OR EXISTS(SELECT 1 FROM reporting_access r WHERE r.learner_id=l.id AND r.scope='organisation')) FOR UPDATE",[actor.id])).rows[0];if(!allowed)throw new CourseError('Organisation or platform admin access is required.',403);}
  const h=(await tx.query('SELECT h.*,l.email,l.archived_at FROM assignment_history h JOIN learners l ON l.id=h.learner_id JOIN course_assignments a ON a.history_id=h.id WHERE h.id=$1 FOR UPDATE OF h,l,a',[b.assignmentId])).rows[0];
  if(!h||h.archived_at||h.cancelled_at||h.superseded_at)throw new CourseError('This assignment is no longer available.',409);
  if(h.learner_id===actor.id||h.email===actor.email)throw new CourseError('You cannot approve or revoke your own training decision.',403);
  await tx.query("SELECT set_config('app.audit_actor',$1,true),set_config('app.audit_reason',$2,true)",[actor.email,b.reason.trim()]);
  if(b.action==='revoke'){
   if(typeof b.id!=='string')throw new CourseError('Choose a decision.');
   const r=await tx.query('UPDATE training_recognitions SET revoked_at=now(),revoked_by=$1,revocation_reason=$2 WHERE id=$3 AND assignment_id=$4 AND revoked_at IS NULL RETURNING id',[actor.email,b.reason.trim(),b.id,b.assignmentId]);
   if(!r.rowCount)throw new CourseError('This decision changed. Reload before saving.',409);
   return;
  }
  await tx.query('SELECT id FROM organisation_settings WHERE id=1 FOR SHARE');
  if(!(await tx.query("SELECT feature_enabled('training_recognition') AS enabled")).rows[0]?.enabled)throw new CourseError('This feature is switched off in Settings.',403);
  if(!['exempt','recognised','extension'].includes(b.kind)||typeof b.evidenceRef!=='string'||b.evidenceRef.trim().length<3||b.evidenceRef.length>2000||typeof b.validUntil!=='string'||!Number.isFinite(Date.parse(b.validUntil))||Date.parse(b.validUntil)<=Date.now())throw new CourseError('Enter evidence and a future expiry or deadline.');
  if(h.completed_at)throw new CourseError('This assignment is already completed.');
  if(h.assessor_required&&b.kind!=='extension')throw new CourseError('This course requires practical assessor sign-off. Only a deadline extension is allowed.');
  if(b.kind==='extension'&&(!h.due_at||Date.parse(b.validUntil)<=Date.parse(String(h.due_at))))throw new CourseError('Choose a deadline later than the original deadline.');
  if(b.kind==='recognised'&&(typeof b.qualification!=='string'||!b.qualification.trim()||b.qualification.length>300||typeof b.achievedOn!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.achievedOn)||!Number.isFinite(Date.parse(b.achievedOn))||new Date(b.achievedOn).toISOString().slice(0,10)!==b.achievedOn||Date.parse(b.achievedOn)>Date.now()))throw new CourseError('Enter the qualification and a valid past award date.');
  await tx.query('INSERT INTO training_recognitions(assignment_id,learner_id,kind,reason,evidence_ref,qualification,achieved_on,valid_until,approved_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[h.id,h.learner_id,b.kind,b.reason.trim(),b.evidenceRef.trim(),b.kind==='recognised'?b.qualification.trim():null,b.kind==='recognised'?b.achievedOn:null,b.validUntil,actor.email]);
 });return json({ok:true});
}catch(e){if((e as {code?:string}).code==='23505')return failed(new CourseError('Revoke the existing decision before recording a replacement.',409));return failed(e);}}
