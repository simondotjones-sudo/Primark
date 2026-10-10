import type {NextRequest} from 'next/server';
import {createHash} from 'node:crypto';
import {currentLearner} from '@/lib/server';
import {getAdminUser} from '@/lib/admin-auth';
import {db,inTransaction} from '@/lib/database';
import {CourseError,failed,json} from '@/lib/course-admin';
import {sameOrigin} from '@/lib/request-origin';
import {evidenceStore,type Evidence} from '@/lib/assessment-evidence';
export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};

export async function GET(request:NextRequest,{params}:Context){try{
 const [actor,admin]=await Promise.all([currentLearner(request),getAdminUser()]);
 if(!actor&&!admin)throw new CourseError('Assessor access is required.',403);
 const {id}=await params;
 const row=await db().prepare(`SELECT e.* FROM assessment_evidence e JOIN assignment_history h ON h.id=e.assignment_id JOIN learners l ON l.id=h.learner_id
 WHERE e.id=? AND e.state='ready' AND (
 (e.assessment_id IS NULL AND e.uploaded_by=?) OR
 (e.assessment_id IS NOT NULL AND (? OR EXISTS(SELECT 1 FROM assessor_accounts a JOIN assessor_grants g ON g.learner_id=a.learner_id
 WHERE a.learner_id=? AND g.course_id=h.course_id AND g.active AND (g.expires_on IS NULL OR g.expires_on>=CURRENT_DATE) AND (g.site_id='*' OR g.site_id=l.store_id)))))`)
 .bind(id,actor?.id||'',!!admin,actor?.id||'').first<Evidence>();
 if(!row)throw new CourseError('Evidence is not available.',404);
 const bytes=await evidenceStore(row.storage_context).get(row.id,{type:'arrayBuffer'});
 if(!bytes||bytes.byteLength!==row.size||createHash('sha256').update(new Uint8Array(bytes)).digest('hex')!==row.sha256)throw new CourseError('Evidence could not be downloaded. Please try again.',503);
 const filename=row.filename.replace(/[^a-zA-Z0-9._-]/g,'_');
 return new Response(bytes,{headers:{'Content-Type':row.mime_type,'Content-Length':String(row.size),
 'Content-Disposition':`attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(row.filename).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16))}`,
 'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin','Content-Security-Policy':"sandbox; default-src 'none'"}});
}catch(e){return failed(e);}}

export async function DELETE(request:NextRequest,{params}:Context){try{
 if(!sameOrigin(request))throw new CourseError('Please use the Assessor page.',403);
 const actor=await currentLearner(request);if(!actor)throw new CourseError('Assessor access is required.',403);
 const {id}=await params;
 const row=await db().prepare('SELECT * FROM assessment_evidence WHERE id=? AND uploaded_by=?').bind(id,actor.id).first<Evidence>();
 if(!row)throw new CourseError('Evidence is not available.',404);
 const store=evidenceStore(row.storage_context,true);
 await inTransaction(async tx=>{
  await tx.query('SELECT id FROM assignment_history WHERE id=$1 FOR UPDATE',[row.assignment_id]);
  const current=(await tx.query('SELECT assessment_id,state FROM assessment_evidence WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(current.assessment_id)throw new CourseError('Saved assessment evidence cannot be changed.',409);
  if(current.state==='removed')return;
  await tx.query("SELECT set_config('app.audit_actor',$1,true)",[actor.email]);
  await tx.query("UPDATE assessment_evidence SET state='removed',removed_at=now() WHERE id=$1",[id]);
 });
 await store.delete(row.id);
 return json({ok:true});
}catch(e){return failed(e);}}
