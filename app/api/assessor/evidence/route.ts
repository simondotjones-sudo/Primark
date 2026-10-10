import {requireFeature} from '@/lib/features';
import type {NextRequest} from 'next/server';
import {currentLearner} from '@/lib/server';
import {db,inTransaction} from '@/lib/database';
import {CourseError,failed,json} from '@/lib/course-admin';
import {sameOrigin} from '@/lib/request-origin';
import {evidenceColumns,evidenceContext,evidenceFile,evidenceStore,MAX_EVIDENCE_FILES,readEvidenceForm,requireEvidenceAssignment} from '@/lib/assessment-evidence';
export const dynamic='force-dynamic';

export async function GET(request:NextRequest){try{
 const actor=await currentLearner(request);if(!actor)throw new CourseError('Assessor access is required.',403);
 const assignment=request.nextUrl.searchParams.get('assignment')||'';
 await requireEvidenceAssignment(assignment,actor.id);
 const rows=await db().prepare(`SELECT ${evidenceColumns} FROM assessment_evidence WHERE assignment_id=? AND uploaded_by=? AND assessment_id IS NULL AND state<>'removed' ORDER BY uploaded_at`).bind(assignment,actor.id).all();
 return json({evidence:rows.results});
}catch(e){return failed(e);}}

export async function POST(request:NextRequest){try{
 await requireFeature('assessment_evidence');
 if(!sameOrigin(request))throw new CourseError('Please use the Assessor page.',403);
 const actor=await currentLearner(request);if(!actor)throw new CourseError('Assessor access is required.',403);
 const assignment=request.nextUrl.searchParams.get('assignment')||'';
 await requireEvidenceAssignment(assignment,actor.id);
 const form=await readEvidenceForm(request),file=form.get('file');
 if(!(file instanceof File))throw new CourseError('Choose an evidence file.');
 const value=await evidenceFile(file),id=crypto.randomUUID(),context=evidenceContext();
 await inTransaction(async tx=>{
  await tx.query('SELECT id FROM assignment_history WHERE id=$1 FOR UPDATE',[assignment]);
  await requireEvidenceAssignment(assignment,actor.id);
  const count=(await tx.query("SELECT count(*)::int n FROM assessment_evidence WHERE assignment_id=$1 AND uploaded_by=$2 AND assessment_id IS NULL AND state<>'removed'",[assignment,actor.id])).rows[0];
  if(Number(count.n)>=MAX_EVIDENCE_FILES)throw new CourseError('Choose up to five evidence files.');
  await tx.query("SELECT set_config('app.audit_actor',$1,true)",[actor.email]);
  await tx.query('INSERT INTO assessment_evidence(id,assignment_id,uploaded_by,filename,mime_type,size,sha256,storage_context) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,assignment,actor.id,value.filename,value.mime,file.size,value.sha256,context]);
 });
 // Every upload gets a new key. Even a concurrent retry cannot overwrite saved evidence.
 const store=evidenceStore(context,true);
 const stored=await store.set(id,value.bytes,{onlyIfNew:true});
 if(!stored.modified)throw new CourseError('Evidence is not available.',409);
 const row=await inTransaction(async tx=>{
  await tx.query('SELECT id FROM assignment_history WHERE id=$1 FOR UPDATE',[assignment]);
  await requireEvidenceAssignment(assignment,actor.id);
  await tx.query("SELECT set_config('app.audit_actor',$1,true)",[actor.email]);
  return (await tx.query(`UPDATE assessment_evidence SET state='ready' WHERE id=$1 AND state='uploading' AND assessment_id IS NULL RETURNING ${evidenceColumns}`,[id])).rows[0];
 });
 if(!row){await store.delete(id);throw new CourseError('Evidence is not available.',409);}
 return json({evidence:row},201);
}catch(e){return failed(e);}}
