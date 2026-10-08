import {db} from '@/lib/database';
import {activeLearnerSql} from '@/lib/account-type';
import {readyCourses} from '@/lib/course-access';
import {inductionFor} from '@/lib/course-catalogue';
import {matchesAudience,type Course,type Person} from '@/lib/course-types';
export type StoreAssignment={learner_id:string;course_id:string};
// Mirror learner access, including audience grants and pinned/default inductions.
export async function storeAssignments(storeId:string,courses?:Course[],userIds?:string[]):Promise<StoreAssignment[]>{
 const ready=courses||await readyCourses();
 const [people,explicit,pinned]=await Promise.all([
  db().prepare(`SELECT l.id,l.name,l.email,l.country,l.store_id,l.induction_enrolled FROM learners l WHERE l.store_id=? AND ${activeLearnerSql()} ${userIds?'AND l.id=ANY(?::text[])':''}`).bind(storeId,...(userIds?[userIds]:[])).all<Person&{induction_enrolled:boolean}>(),
  db().prepare('SELECT a.learner_id,a.course_id FROM course_assignments a JOIN learners l ON l.id=a.learner_id WHERE l.store_id=?').bind(storeId).all<StoreAssignment>(),
  db().prepare('SELECT i.learner_id,i.course_id FROM learner_inductions i JOIN learners l ON l.id=i.learner_id WHERE l.store_id=?').bind(storeId).all<StoreAssignment>(),
 ]);
 const assigned=new Set(explicit.results.map(a=>a.learner_id+'\0'+a.course_id)),inductions=new Map(pinned.results.map(a=>[a.learner_id,a.course_id]));
 const defaults=new Map<string,string|undefined>();
 const result:StoreAssignment[]=[];
 for(const person of people.results){
  if(!defaults.has(person.country))defaults.set(person.country,inductionFor(ready,person.country)?.id);
  const induction=person.induction_enrolled?(inductions.get(person.id)||defaults.get(person.country)):null;
  for(const course of ready)if(assigned.has(person.id+'\0'+course.id)||course.id===induction||((!person.induction_enrolled||course.induction_role==='none')&&matchesAudience(JSON.parse(course.audience_json),person)))result.push({learner_id:person.id,course_id:course.id});
 }
 return result;
}
