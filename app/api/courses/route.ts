import {organisationSettings} from '@/lib/organisation-settings';
import {syncCourseRefreshers,courseRenewalsFor} from '@/lib/course-renewals';
import {storeDirectory} from '@/lib/store-directory';
import {safetyPassportFor} from '@/lib/safety-passport';
import { certificatesFor } from '@/lib/certificate-server';
import { NextRequest } from 'next/server';
import { currentLearner, db } from '@/lib/server';
import { failed, json, CourseError } from '@/lib/course-admin';
import { courseStatus, type Sco } from '@/lib/course-types';
import { savedCourseProgress } from '@/lib/rise-progress';
import { assignedCourses, assignedInduction } from '@/lib/course-access';
import { coursePanelDetails } from '@/lib/course-panel-details';
import { courseCoverKey } from '@/lib/course-covers';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest) {try {
 const learner=await currentLearner(request);if(!learner)throw new CourseError('Sign in to see your courses.',401);
 if(learner.admin_only)throw new CourseError('Use your personal learner account for training.',403);
 await syncCourseRefreshers(learner.id);
 const courses=await assignedCourses(learner);
 const [renewals,progress,certificates,stores]=await Promise.all([courseRenewalsFor(learner.id),db().prepare('SELECT * FROM scorm_progress WHERE learner_id=?').bind(learner.id).all<any>(),certificatesFor(learner.id),storeDirectory()]);
 const [settings,assignments]=await Promise.all([organisationSettings(),db().prepare(`SELECT a.course_id,NOT pathway_course_unlocked(a.learner_id,a.course_id) AS pathway_locked,r.kind AS recognition_kind,r.valid_until AS recognition_expiry,h.assessor_required,h.theory_completed_at,to_char((CASE WHEN r.kind='extension' THEN r.valid_until ELSE h.due_at END) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS due_at,h.quiz_json IS NOT NULL AS quiz_required,
 EXISTS(SELECT 1 FROM course_quiz_attempts q WHERE q.assignment_id=h.id AND q.passed) AS quiz_passed
 FROM course_assignments a JOIN assignment_history h ON h.id=a.history_id LEFT JOIN training_recognitions r ON r.assignment_id=h.id AND h.completed_at IS NULL AND r.revoked_at IS NULL AND (r.valid_until>now() OR r.kind='extension') WHERE a.learner_id=?`).bind(learner.id).all<{recognition_kind:string|null;recognition_expiry:string|null;course_id:string;pathway_locked:boolean;assessor_required:boolean;theory_completed_at:string|null;due_at:string|null;quiz_required:boolean;quiz_passed:boolean}>()]);
 const inductionId=await assignedInduction(learner);
 return json({creditsEnabled:settings.credits_enabled,inductionPending:learner.induction_enrolled&&!inductionId,courses:courses.map(c=>{const assignment=assignments.results.find(a=>a.course_id===c.id);const scos=JSON.parse(c.scos_json) as Sco[];const saved=progress.results.filter(p=>p.package_id===c.package_id);const certificate=certificates.results.find(r=>r.course_id===c.id&&!r.archived_at&&!r.cancelled_at);return {recognition:assignment?.recognition_kind?{kind:assignment.recognition_kind,expiresAt:assignment.recognition_expiry}:null,pathwayLocked:!!assignment?.pathway_locked,awaitingAssessment:!!assignment?.assessor_required&&!certificate&&!!assignment?.theory_completed_at,assessorRequired:!!assignment?.assessor_required,dueAt:assignment?.due_at??null,quizRequired:!!assignment?.quiz_required,quizPassed:!!assignment?.quiz_passed,lessonsComplete:courseStatus(saved.map(s=>s.status),scos.length)==='Completed',renewal:renewals.get(c.id),passport:safetyPassportFor(c,certificate,stores.find(s=>s.id===certificate?.store_id)?.name||certificate?.store_id||''),certificate:certificate?{token:certificate.token,expiresAt:certificate.expires_at,completedAt:certificate.completed_at}:null,id:c.id,title:c.title,description:c.description,...coursePanelDetails(c),coverKey:courseCoverKey(c),status:!certificate&&assignment?.assessor_required&&courseStatus(saved.map(s=>s.status),scos.length)==='Completed'?'In progress':!certificate&&assignment?.quiz_required&&!assignment.quiz_passed&&courseStatus(saved.map(s=>s.status),scos.length)==='Completed'?'In progress':courseStatus(saved.map(s=>s.status),scos.length),progressPercent:savedCourseProgress(saved.find(p=>p.sco_id===scos[0]?.id)?.data_json,scos.length),scos:scos.map(s=>({id:s.id,title:s.title,status:saved.find(p=>p.sco_id===s.id)?.status||'not attempted',score:saved.find(p=>p.sco_id===s.id)?.score??null}))};})});
}catch(e){return failed(e);} }
