import { db } from '@/lib/database';
import { matchesAudience, type Course } from '@/lib/course-types';
import { inductionFor, type EnrolledPerson } from '@/lib/course-catalogue';

export async function readyCourses() {
  return (await db().prepare("SELECT c.*,p.scos_json FROM courses c JOIN course_packages p ON p.id=c.package_id WHERE c.status='published' AND p.status='ready' ORDER BY c.title").all<Course & {scos_json:string}>()).results;
}
export async function assignedInduction(learner:EnrolledPerson,courses?:Course[]) {
  if(!learner.induction_enrolled)return null;
  const read=()=>db().prepare('SELECT course_id FROM learner_inductions WHERE learner_id=?').bind(learner.id).first<{course_id:string}>();
  const existing=await read();
  if(existing)return existing.course_id;
  const selected=inductionFor(courses||await readyCourses(),learner.country);
  if(!selected)return null;
  await db().prepare('INSERT INTO learner_inductions(learner_id,course_id,assigned_at) VALUES(?,?,?) ON CONFLICT(learner_id) DO NOTHING').bind(learner.id,selected.id,new Date().toISOString()).run();
  return (await read())?.course_id||null;
}
export async function assignedCourses(learner: EnrolledPerson) {
  const [courses, assignments] = await Promise.all([
    readyCourses(),
    db().prepare('SELECT course_id FROM course_assignments WHERE learner_id=?').bind(learner.id).all<{course_id:string}>(),
  ]);
  const explicit = new Set(assignments.results.map(a=>a.course_id));
  const inductionId = await assignedInduction(learner,courses);
  return courses.filter(c => explicit.has(c.id) || ((!learner.induction_enrolled || c.induction_role === 'none') && matchesAudience(JSON.parse(c.audience_json),learner)) || c.id === inductionId);
}
export async function canAccessCourse(course: Course, learner: EnrolledPerson) {
  if (course.status !== 'published') return false;
  if ((!learner.induction_enrolled || course.induction_role === 'none') && matchesAudience(JSON.parse(course.audience_json),learner)) return true;
  if (await db().prepare('SELECT course_id FROM course_assignments WHERE learner_id=? AND course_id=?').bind(learner.id,course.id).first()) return true;
  return (await assignedInduction(learner)) === course.id;
}
