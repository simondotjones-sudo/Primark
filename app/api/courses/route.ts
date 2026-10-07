import { NextRequest } from 'next/server';
import { currentLearner, db } from '@/lib/server';
import { failed, json, CourseError } from '@/lib/course-admin';
import { courseStatus, matchesAudience, type Course, type Sco } from '@/lib/course-types';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest) {try {
 const learner=await currentLearner(request);if(!learner)throw new CourseError('Sign in to see your courses.',401);
 const [courses,progress]=await Promise.all([db().prepare("SELECT c.*,p.scos_json FROM courses c JOIN course_packages p ON p.id=c.package_id WHERE c.status='published' AND p.status='ready' ORDER BY c.title").all<Course&{scos_json:string}>(),db().prepare('SELECT * FROM scorm_progress WHERE learner_id=?').bind(learner.id).all<any>()]);
 return json({courses:courses.results.filter(c=>matchesAudience(JSON.parse(c.audience_json),learner)).map(c=>{const scos=JSON.parse(c.scos_json) as Sco[];const saved=progress.results.filter(p=>p.package_id===c.package_id);return {id:c.id,title:c.title,description:c.description,status:courseStatus(saved.map(s=>s.status),scos.length),scos:scos.map(s=>({id:s.id,title:s.title,status:saved.find(p=>p.sco_id===s.id)?.status||'not attempted',score:saved.find(p=>p.sco_id===s.id)?.score??null}))};})});
}catch(e){return failed(e);} }
