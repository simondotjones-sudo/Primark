import {CourseError} from '@/lib/course-admin';
type Client={query:(sql:string,args?:unknown[])=>Promise<{rows:Record<string,unknown>[]}>};
export async function publishCourseVersion(tx:Client,id:string,reason:unknown,retrain:boolean){
 const c=(await tx.query('SELECT * FROM courses WHERE id=$1 FOR UPDATE',[id])).rows[0];
 const last=(await tx.query('SELECT * FROM course_versions WHERE course_id=$1 ORDER BY version DESC LIMIT 1',[id])).rows[0];
 const note=typeof reason==='string'?reason.trim():'';
 if(note.length>500)throw new CourseError('Keep the version reason within 500 characters.');
 const fields=['title','description','package_id','quiz_json','assessor_required','validity_months','deadline_days','language_code','lesson_count','estimated_duration_minutes'];
 const old=last?.snapshot as Record<string,unknown>|undefined;
 const changed=!old||fields.some(k=>JSON.stringify(old[k])!==JSON.stringify(c[k]));
 if(retrain&&(!changed||note.length<3))throw new CourseError('Change the course content or requirements and enter a version reason before requiring retraining.');
 if(!changed)return;
 const version=last?Number(last.version)+1:1;
 await tx.query('UPDATE courses SET learning_version=$2 WHERE id=$1',[id,version]);
 await tx.query(`INSERT INTO course_versions(course_id,version,snapshot,published_by,reason,retraining)
 SELECT id,learning_version,to_jsonb(c),current_setting('app.audit_actor'),$2,$3 FROM courses c WHERE id=$1`,[id,note||'Published course update',retrain]);
 if(retrain){
  const people=(await tx.query(`SELECT l.id FROM learners l JOIN course_assignments a ON a.learner_id=l.id WHERE a.course_id=$1 AND l.archived_at IS NULL ORDER BY l.id FOR UPDATE OF l`,[id])).rows;
  for(const person of people)await tx.query("SELECT assign_credit_course($1,$2,current_setting('app.audit_actor'),now(),true,true,'version-update')",[person.id,id]);
 }
}
