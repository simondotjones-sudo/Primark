import {pathwayUnlocked} from '@/lib/pathways';
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
  const {results}=await db().prepare(`SELECT c.*,c.package_id AS catalogue_package_id,h.course_snapshot,p.id AS package_id,p.scos_json FROM courses c
    JOIN course_assignments a ON a.course_id=c.id AND a.learner_id=?
    JOIN assignment_history h ON h.id=a.history_id JOIN course_packages p ON p.id=h.package_id
    WHERE c.status='published' AND p.status='ready' ORDER BY c.title`).bind(learner.id).all<Course&{catalogue_package_id:string;course_snapshot:Partial<Course>;scos_json:string}>();
  return results.map(row=>({...row,...row.course_snapshot,category:row.category,induction_role:row.induction_role,catalogue_scope:row.catalogue_scope,available_countries_json:row.available_countries_json,...(row.package_id===row.catalogue_package_id?{estimated_duration_minutes:row.estimated_duration_minutes,lesson_count:row.lesson_count}:{}),status:row.status,package_id:row.package_id,scos_json:row.scos_json}));
}
export async function canAccessCourse(course: Course, learner: EnrolledPerson) {
  if (course.status !== 'published' || !await canLearn(learner.id)) return false;
  await syncAssignments(learner.id).run();
  return await pathwayUnlocked(learner.id,course.id) && !!await db().prepare('SELECT course_id FROM course_assignments WHERE learner_id=? AND course_id=?').bind(learner.id,course.id).first();
}
