import {db,inTransaction} from '@/lib/database';
import {CourseError} from '@/lib/course-admin';
import {activeLearnerSql} from '@/lib/account-type';

export type CourseRenewal={
 canRenew:boolean;
 previousCertificate:{token:string;completedAt:string}|null;
 refresher:{courseId:string;title:string;status:'pending'|'assigned'|'completed'|'removed';available:boolean}|null;
};

// The same learner lock protects renewals, assignments, role changes and SCORM.
// An expected certificate prevents retries or two tabs from charging twice.
export async function renewLearnerCourse(learnerId:string,courseId:string,certificateToken:string){
 return inTransaction(async client=>{
  const {rows:[learner]}=await client.query(`SELECT l.id,l.email FROM learners l WHERE l.id=$1 AND ${activeLearnerSql()} FOR UPDATE`,[learnerId]);
  if(!learner)throw new CourseError('Use your personal learner account for training.',403);
  await client.query("SELECT set_config('app.audit_actor',$1,true)",[learner.email]);
  const {rows:[certificate]}=await client.query(`SELECT cert.token FROM certificates cert JOIN course_assignments a ON a.history_id=cert.assignment_id
   WHERE a.learner_id=$1 AND a.course_id=$2 AND cert.token=$3 AND cert.archived_at IS NULL AND cert.cancelled_at IS NULL`,[learnerId,courseId,certificateToken]);
  if(!certificate)throw new CourseError('This assignment has changed. Refresh and try again.',409);
  const {rows:[result]}=await client.query("SELECT assign_credit_course($1,$2,$3,now(),true,true,'self-renewal') AS added",[learnerId,courseId,learner.email]);
  if(!result?.added)throw new CourseError('This assignment has changed. Refresh and try again.',409);
  return {renewed:true};
 });
}

export {syncCourseRefreshers} from '@/lib/course-refreshers';

export async function courseRenewalsFor(learnerId:string){
 const {results}=await db().prepare(`SELECT a.course_id AS id,
  (cert.expires_at::timestamptz<=now()+interval '720 hours' AND r.refresher_course_id IS NULL AND e.assignment_id IS NULL) IS TRUE AS "canRenew",
  CASE WHEN previous.token IS NOT NULL THEN jsonb_build_object('token',previous.token,'completedAt',previous.completed_at) END AS "previousCertificate",
  CASE WHEN target.id IS NOT NULL AND cert.expires_at::timestamptz<=now()+interval '720 hours' THEN
   jsonb_build_object('courseId',target.id,'title',target.title,
    'status',CASE WHEN h.cancelled_at IS NOT NULL THEN 'removed' WHEN h.completed_at IS NOT NULL THEN 'completed' WHEN h.id IS NOT NULL THEN 'assigned' ELSE 'pending' END,
    'available',target.status='published' AND p.status='ready' AND h.id IS NOT NULL AND h.cancelled_at IS NULL)
  END AS refresher
  FROM course_assignments a JOIN learners l ON l.id=a.learner_id
  LEFT JOIN LATERAL (SELECT * FROM certificates c WHERE c.assignment_id=a.history_id AND c.archived_at IS NULL AND c.cancelled_at IS NULL ORDER BY c.completed_at DESC LIMIT 1) cert ON true
  LEFT JOIN LATERAL (SELECT token,completed_at FROM certificates c WHERE c.learner_id=a.learner_id AND c.course_id=a.course_id AND c.archived_at IS NOT NULL AND c.cancelled_at IS NULL ORDER BY c.completed_at DESC LIMIT 1) previous ON true
  LEFT JOIN course_refresher_rules r ON r.source_course_id=a.course_id AND r.country=l.country
  LEFT JOIN course_refresher_assignments e ON e.certificate_token=cert.token
  LEFT JOIN courses target ON target.id=COALESCE(CASE WHEN e.assignment_id IS NOT NULL THEN e.refresher_course_id END,r.refresher_course_id)
  LEFT JOIN course_packages p ON p.id=target.package_id
  LEFT JOIN assignment_history h ON h.id=e.assignment_id
  WHERE a.learner_id=?`).bind(learnerId).all<CourseRenewal&{id:string}>();
 return new Map(results.map(r=>[r.id,r]));
}
