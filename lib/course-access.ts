import {syncAssignments} from '@/lib/credits';
import { canLearn } from '@/lib/account-type';
import { db } from '@/lib/database';
import { type Course } from '@/lib/course-types';
import { type EnrolledPerson } from '@/lib/course-catalogue';

export async function readyCourses() {
  return (await db().prepare("SELECT c.*,p.scos_json FROM courses c JOIN course_packages p ON p.id=c.package_id WHERE c.status='published' AND p.status='ready' ORDER BY c.title").all<Course & {scos_json:string}>()).results;
}
export async function assignedInduction(learner:EnrolledPerson) {
  if(!learner.induction_enrolled || !await canLearn(learner.id))return null;
  await syncAssignments(learner.id).run();
  return (await db().prepare('SELECT i.course_id FROM learner_inductions i WHERE i.learner_id=?').bind(learner.id).first<{course_id:string}>())?.course_id||null;
}
export async function assignedCourses(learner: EnrolledPerson) {
  if (!await canLearn(learner.id)) return [];
  await syncAssignments(learner.id).run();
  const [courses, assignments] = await Promise.all([
    readyCourses(),
    db().prepare('SELECT course_id FROM course_assignments WHERE learner_id=?').bind(learner.id).all<{course_id:string}>(),
  ]);
  const explicit = new Set(assignments.results.map(a=>a.course_id));
  return courses.filter(c => explicit.has(c.id));
}
export async function canAccessCourse(course: Course, learner: EnrolledPerson) {
  if (course.status !== 'published' || !await canLearn(learner.id)) return false;
  await syncAssignments(learner.id).run();
  return !!await db().prepare('SELECT course_id FROM course_assignments WHERE learner_id=? AND course_id=?').bind(learner.id,course.id).first();
}
