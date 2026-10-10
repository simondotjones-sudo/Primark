import {db} from '@/lib/database';
import {CourseError} from '@/lib/course-admin';
import type {JobRole} from '@/lib/job-role-types';
export async function jobRoles(includeCounts=false){return (await db().prepare(`SELECT r.*${includeCounts?',(SELECT count(*)::int FROM learners WHERE job_role_id=r.id) AS users':''} FROM job_roles r WHERE organisation_id=1 ORDER BY archived,lower(name)`).all<JobRole>()).results;}
export async function validateJobRole(value:unknown,current?:string|null,tx?:{query:(sql:string,values:unknown[])=>Promise<{rows:Record<string,unknown>[]}>}){
 if(value===undefined||value===null||value==='')return null;
 if(typeof value!=='string'||value.length>100)throw new CourseError('Choose a valid job role.');
 const role=tx?(await tx.query('SELECT id,archived FROM job_roles WHERE id=$1 AND organisation_id=1 FOR SHARE',[value])).rows[0]:await db().prepare('SELECT id,archived FROM job_roles WHERE id=? AND organisation_id=1').bind(value).first();
 if(!role||(role.archived&&value!==current))throw new CourseError('Choose an active job role.');
 return value;
}
