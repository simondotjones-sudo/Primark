import type {NextRequest} from 'next/server';
import {currentLearner,db} from '@/lib/server';
import {inTransaction} from '@/lib/database';
import {CourseError,bodyJson,failed,json} from '@/lib/course-admin';
import {sameOrigin} from '@/lib/request-origin';
import {activeLearnerSql} from '@/lib/account-type';
import {markQuiz,type CourseQuiz} from '@/lib/course-quiz';
import {issueCourseCertificate} from '@/lib/certificate-server';
export const dynamic='force-dynamic';
const quizQuery=`SELECT h.id AS assignment_id,h.assessor_required,h.quiz_json,h.course_title AS title,h.package_id,
 EXISTS(SELECT 1 FROM course_quiz_attempts q WHERE q.assignment_id=h.id AND q.passed) AS passed,
 jsonb_array_length(p.scos_json::jsonb)>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.scos_json::jsonb) item
  WHERE NOT EXISTS(SELECT 1 FROM scorm_progress s WHERE s.learner_id=a.learner_id AND s.package_id=h.package_id AND s.sco_id=item->>'id' AND s.completed_at IS NOT NULL AND s.status IN ('completed','passed'))) AS lessons_complete
 FROM course_assignments a JOIN assignment_history h ON h.id=a.history_id JOIN courses c ON c.id=a.course_id
 JOIN course_packages p ON p.id=h.package_id AND p.status='ready'
 WHERE a.learner_id=? AND a.course_id=? AND c.status='published' AND pathway_course_unlocked(a.learner_id,a.course_id)`;
type QuizRow={assessor_required:boolean;assignment_id:string;quiz_json:CourseQuiz|null;title:string;package_id:string;passed:boolean;lessons_complete:boolean};
export async function GET(request:NextRequest){try{
 const learner=await currentLearner(request);if(!learner||learner.admin_only)throw new CourseError('Learner sign-in is required.',403);
 const row=await db().prepare(quizQuery).bind(learner.id,request.nextUrl.searchParams.get('courseId')).first<QuizRow>();
 if(!row?.quiz_json)throw new CourseError('No quiz is assigned for this course.',404);
 return json({assessorRequired:row.assessor_required,assignmentId:row.assignment_id,title:row.title,passed:row.passed,lessonsComplete:row.lessons_complete,passPercent:row.quiz_json.passPercent,
  questions:row.lessons_complete?row.quiz_json.questions.map(q=>({prompt:q.prompt,options:q.options})):[]});
}catch(e){return failed(e);}}
export async function POST(request:NextRequest){try{
 if(!sameOrigin(request))throw new CourseError('Open the quiz from My Courses.',403);
 const learner=await currentLearner(request);if(!learner||learner.admin_only)throw new CourseError('Learner sign-in is required.',403);
 const b=await bodyJson(request,10000);
 if(typeof b.attemptId!=='string'||!/^[-a-zA-Z0-9]{16,80}$/.test(b.attemptId))throw new CourseError('Invalid quiz attempt.');
 const result=await inTransaction(async client=>{
  await client.query("SELECT set_config('app.audit_actor',$1,true)",[learner.email]);
  const {rows:[person]}=await client.query(`SELECT id FROM learners l WHERE id=$1 AND ${activeLearnerSql()} FOR UPDATE`,[learner.id]);
  if(!person)throw new CourseError('Learner sign-in is required.',403);
  const {rows:[data]}=await db().prepare(quizQuery).bind(learner.id,b.courseId).execute(client);
  const row=data as QuizRow|undefined;
  if(!row?.quiz_json||row.assignment_id!==b.assignmentId)throw new CourseError('This course assignment changed. Reopen the quiz.',409);
  if(!row.lessons_complete)throw new CourseError('Complete the lessons before taking the quiz.',409);
  const {rows:[old]}=await client.query('SELECT * FROM course_quiz_attempts WHERE id=$1 AND assignment_id=$2',[b.attemptId,row.assignment_id]);
  if(old)return {correct:old.correct_count,total:old.question_count,passPercent:old.pass_percent,passed:old.passed};
  let marked;try{marked=markQuiz(row.quiz_json,b.answers);}catch(e){throw new CourseError((e as Error).message);}
  await client.query('INSERT INTO course_quiz_attempts(id,assignment_id,answers,correct_count,question_count,pass_percent,passed) VALUES($1,$2,$3,$4,$5,$6,$7)',[b.attemptId,row.assignment_id,JSON.stringify(b.answers),marked.correct,marked.total,marked.passPercent,marked.passed]);
  await client.query('UPDATE assignment_history SET started_at=COALESCE(started_at,now()) WHERE id=$1',[row.assignment_id]);
  if(marked.passed)await issueCourseCertificate(learner.id,row.package_id).execute(client);
  return marked;
 });
 return json(result);
}catch(e){return failed(e);}}
