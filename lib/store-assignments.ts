import {db} from '@/lib/database';
import {activeLearnerSql} from '@/lib/account-type';
import type {Course} from '@/lib/course-types';
export type StoreAssignment={learner_id:string;course_id:string};
export async function storeAssignments(storeId:string,_courses?:Course[],userIds?:string[]):Promise<StoreAssignment[]>{
 return (await db().prepare(`SELECT a.learner_id,a.course_id FROM course_assignments a JOIN learners l ON l.id=a.learner_id
 WHERE l.store_id=? AND ${activeLearnerSql()} ${userIds?'AND l.id=ANY(?::text[])':''}`)
 .bind(storeId,...(userIds?[userIds]:[])).all<StoreAssignment>()).results;
}
