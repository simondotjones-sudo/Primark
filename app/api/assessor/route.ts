import type {NextRequest} from 'next/server';
import {currentLearner,hash,randomToken,now} from '@/lib/server';
import {getAdminUser} from '@/lib/admin-auth';
import {bodyJson,CourseError,failed,json,requireAdmin} from '@/lib/course-admin';
import {db,inTransaction} from '@/lib/database';
import {sameOrigin} from '@/lib/shot-server';
import {hasAssessorAccess} from '@/lib/assessor';
import {hashPassword,validPassword} from '@/lib/learner-auth';
import {storeDirectory} from '@/lib/store-directory';
const scope=`EXISTS(SELECT 1 FROM assessor_grants g WHERE g.learner_id=? AND g.course_id=h.course_id AND g.active AND (g.expires_on IS NULL OR g.expires_on>=CURRENT_DATE) AND (g.site_id='*' OR g.site_id=l.store_id))`;
export async function GET(request:NextRequest){try{
 const [actor,admin]=await Promise.all([currentLearner(request),getAdminUser()]);
 if(!admin&&(!actor||!await hasAssessorAccess(actor.id)))throw new CourseError('Assessor access is required.',403);
 const permitted=admin?'true':scope,args=admin?[]:[actor!.id];
 const [pending,history]=await Promise.all([
 db().prepare(`SELECT h.id,h.course_title,l.name,l.email,l.workday_id,l.store_id,l.country,h.theory_completed_at FROM assignment_history h JOIN learners l ON l.id=h.learner_id JOIN course_assignments a ON a.history_id=h.id WHERE h.assessor_required AND h.theory_completed_at IS NOT NULL AND h.passed_assessment_id IS NULL AND h.cancelled_at IS NULL AND h.superseded_at IS NULL AND l.archived_at IS NULL AND ${permitted} ORDER BY h.theory_completed_at LIMIT 1000`).bind(...args).all(),
 db().prepare(`SELECT p.id,p.assessor_name,p.outcome,p.assessed_at,p.recorded_at,p.notes,p.declaration,p.revoked_at,p.revoke_reason,h.course_title,l.name,l.email,l.workday_id,l.store_id,l.country FROM practical_assessments p JOIN assignment_history h ON h.id=p.assignment_id JOIN learners l ON l.id=h.learner_id WHERE ${permitted} ORDER BY p.recorded_at DESC LIMIT 1000`).bind(...args).all()]);
 const stores=await storeDirectory();
 if(!admin)return json({admin:false,pending:pending.results,history:history.results,stores:stores.filter(s=>pending.results.some(p=>p.store_id===s.id)||history.results.some(p=>p.store_id===s.id))});
 const [courses,people,grants]=await Promise.all([
 db().prepare('SELECT id,title,assessor_required FROM courses WHERE assessor_required=true ORDER BY title').all(),
 db().prepare('SELECT id,name,email FROM learners WHERE archived_at IS NULL ORDER BY name').all(),
 db().prepare('SELECT g.*,l.name,c.title FROM assessor_grants g JOIN learners l ON l.id=g.learner_id JOIN courses c ON c.id=g.course_id ORDER BY l.name,c.title').all()]);
 return json({admin:true,pending:pending.results,history:history.results,courses:courses.results,people:people.results,grants:grants.results,stores});
}catch(e){return failed(e);}}
export async function POST(request:NextRequest){try{
 if(!sameOrigin(request))throw new CourseError('Please use the Assessor page.',403);
 const body=await bodyJson(request,15000);
 if(body.action==='assess'){
  const actor=await currentLearner(request);if(!actor)throw new CourseError('Sign in with your authorised assessor account.',403);
  if(typeof body.id!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(body.date)||!['pass','not_yet_competent'].includes(body.outcome)||typeof body.notes!=='string'||body.notes.length>5000)throw new CourseError('Check the assessment details.');
  try{await db().prepare('SELECT record_practical_assessment(?,?,?,?,?,?)').bind(body.id,actor.id,body.outcome,body.date,body.declaration===true,body.notes).run();}catch(e){if((e as {code?:string}).code==='P0001')throw new CourseError((e as Error).message);throw e;}
 }else{
  await requireAdmin(request);const admin=(await getAdminUser())!;
  await inTransaction(async tx=>{
   if(body.action==='requirement'){
    if(typeof body.required!=='boolean')throw new CourseError('Choose whether sign-off is required.');
    const updated=await tx.query('UPDATE courses SET assessor_required=$1,revision=revision+1,updated_at=$2 WHERE id=$3 RETURNING id',[body.required,now(),body.courseId]);if(!updated.rowCount)throw new CourseError('Course not found.',404);
   }else if(body.action==='grant'){
    if(typeof body.qualification!=='string'||!body.qualification.trim()||body.qualification.length>2000)throw new CourseError('Enter the assessor qualification.');
    if(body.expiresOn&&(!/^\d{4}-\d{2}-\d{2}$/.test(body.expiresOn)||body.expiresOn<new Date().toISOString().slice(0,10)))throw new CourseError('Choose a current qualification expiry date.');
    if(body.siteId!=='*'&&!(await storeDirectory()).some(s=>s.id===body.siteId))throw new CourseError('Choose a valid site.');
    let id=body.personId;
    if(body.external){
     const name=String(body.name||'').trim(),email=String(body.email||'').trim().toLowerCase();
     if(name.length<2||name.length>101||email.length>254||!/^\S+@\S+\.\S+$/.test(email)||!validPassword(body.password)||body.password.length<16)throw new CourseError('Enter a name, email and a password of 16–128 characters.');
     id=crypto.randomUUID();
     await tx.query(`INSERT INTO learners(id,name,email,code_hash,password_hash,store_id,country,entered_at,induction_enrolled) VALUES($1,$2,$3,$4,$5,'','',$6,false)`,[id,name,email,await hash(randomToken()),await hashPassword(body.password),now()]);
    }else if(!(await tx.query('SELECT id FROM learners WHERE id=$1 AND archived_at IS NULL FOR UPDATE',[id])).rowCount)throw new CourseError('Choose an active user.');
    if(!(await tx.query('SELECT id FROM courses WHERE id=$1',[body.courseId])).rowCount)throw new CourseError('Choose a course.');
    await tx.query('INSERT INTO assessor_accounts(learner_id,assessor_only) VALUES($1,$2) ON CONFLICT(learner_id) DO NOTHING',[id,!!body.external]);
    await tx.query('INSERT INTO assessor_grants(id,learner_id,course_id,site_id,qualification,expires_on,assigned_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[crypto.randomUUID(),id,body.courseId,body.siteId,body.qualification.trim(),body.expiresOn||null,admin.email]);
    body.personId=id;delete body.password;
   }else if(body.action==='disable'){
    await tx.query('UPDATE assessor_grants SET active=false,updated_at=now() WHERE id=$1',[body.id]);
   }else if(body.action==='revoke'){
    if(typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>2000)throw new CourseError('Enter a revocation reason.');
    const row=(await tx.query('SELECT assignment_id FROM practical_assessments WHERE id=$1',[body.id])).rows[0];if(!row)throw new CourseError('Assessment not found.',404);
    const history=(await tx.query('SELECT passed_assessment_id FROM assignment_history WHERE id=$1 FOR UPDATE',[row.assignment_id])).rows[0];
    if(history?.passed_assessment_id!==body.id)throw new CourseError('Only the current successful sign-off can be revoked.',409);
    const changed=await tx.query('UPDATE practical_assessments SET revoked_at=now(),revoked_by=$1,revoke_reason=$2 WHERE id=$3 AND revoked_at IS NULL RETURNING id',[admin.email,body.reason.trim(),body.id]);
    if(!changed.rowCount)throw new CourseError('Assessment already revoked.',409);
    await tx.query('UPDATE certificates SET cancelled_at=now(),archived_at=COALESCE(archived_at,now()) WHERE assignment_id=$1',[row.assignment_id]);
    await tx.query('UPDATE assignment_history SET passed_assessment_id=NULL,completed_at=NULL WHERE id=$1 AND passed_assessment_id=$2',[row.assignment_id,body.id]);
   }else throw new CourseError('Unknown action.');
   const {password,...audit}=body;void password;
   await tx.query('INSERT INTO assessor_audit(actor,action,details) VALUES($1,$2,$3)',[admin.email,body.action,JSON.stringify(audit)]);
  });
 }
 return json({ok:true});
}catch(e){if((e as {code?:string}).code==='23505')return failed(new CourseError('This email is already registered. Choose the existing user instead.',409));return failed(e);}}
