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
 const [courses,progress,certificates]=await Promise.all([assignedCourses(learner),db().prepare('SELECT * FROM scorm_progress WHERE learner_id=?').bind(learner.id).all<any>(),certificatesFor(learner.id)]);
 const inductionId=await assignedInduction(learner);
 return json({inductionPending:learner.induction_enrolled&&!inductionId,courses:courses.map(c=>{const scos=JSON.parse(c.scos_json) as Sco[];const saved=progress.results.filter(p=>p.package_id===c.package_id);const certificate=certificates.results.find(r=>r.package_id===c.package_id&&!r.archived_at);return {certificate:certificate?{token:certificate.token,expiresAt:certificate.expires_at,completedAt:certificate.completed_at}:null,id:c.id,title:c.title,description:c.description,...coursePanelDetails(c),coverKey:courseCoverKey(c),status:courseStatus(saved.map(s=>s.status),scos.length),progressPercent:savedCourseProgress(saved.find(p=>p.sco_id===scos[0]?.id)?.data_json,scos.length),scos:scos.map(s=>({id:s.id,title:s.title,status:saved.find(p=>p.sco_id===s.id)?.status||'not attempted',score:saved.find(p=>p.sco_id===s.id)?.score??null}))};})});
}catch(e){return failed(e);} }
