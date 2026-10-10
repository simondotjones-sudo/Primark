import type {NextRequest} from 'next/server';
import {requireUserAdministrator} from '@/lib/user-administration';
import {bodyJson,CourseError,failed,json} from '@/lib/course-admin';
import {inTransaction} from '@/lib/database';
import {jobRoles} from '@/lib/job-roles';
export const dynamic='force-dynamic';
export async function GET(){try{const actor=await requireUserAdministrator();if(!actor.platformAdmin&&actor.access.scope!=='organisation')throw new CourseError('Organisation or platform admin access is required.',403);return json({roles:await jobRoles(true)});}catch(e){return failed(e);}}
export async function POST(request:NextRequest){try{
 const actor=await requireUserAdministrator(request);
 if(!actor.platformAdmin&&actor.access.scope!=='organisation')throw new CourseError('Organisation or platform admin access is required.',403);
 const b=await bodyJson(request,5000);
 if(!b||typeof b!=='object'||Array.isArray(b))throw new CourseError('Invalid request.');
 const name=typeof b.name==='string'?b.name.trim().replace(/\s+/g,' '):'';
 const code=typeof b.external_code==='string'?b.external_code.trim():null;
 if(!name||name.length>100||(b.external_code!==null&&typeof b.external_code!=='string')||(code&&code.length>100)||typeof b.archived!=='boolean')throw new CourseError('Enter a role name and optional payroll code (maximum 100 characters).');
 if(b.id!==undefined&&(typeof b.id!=='string'||!Number.isSafeInteger(b.revision)))throw new CourseError('Reload job roles before saving.');
 await inTransaction(async tx=>{
  if(actor.id){const current=(await tx.query("SELECT l.id FROM learners l WHERE l.id=$1 AND l.archived_at IS NULL AND (EXISTS(SELECT 1 FROM platform_admins p WHERE p.learner_id=l.id) OR EXISTS(SELECT 1 FROM reporting_access r WHERE r.learner_id=l.id AND r.scope='organisation')) FOR UPDATE",[actor.id])).rows[0];if(!current)throw new CourseError('Organisation or platform admin access is required.',403);}
  await tx.query("SELECT set_config('app.audit_actor',$1,true)",[actor.email]);
  if(b.id){const changed=await tx.query('UPDATE job_roles SET name=$1,external_code=$2,archived=$3,revision=revision+1 WHERE id=$4 AND revision=$5 AND organisation_id=1 RETURNING id',[name,code||null,b.archived,b.id,b.revision]);if(!changed.rowCount)throw new CourseError('This role changed. Reload job roles before saving.',409);}
  else await tx.query('INSERT INTO job_roles(name,external_code,archived) VALUES($1,$2,$3)',[name,code||null,b.archived]);
 });
 return json({roles:await jobRoles(true)});
}catch(e){if((e as {code?:string}).code==='23505')return failed(new CourseError('A role with this name or payroll code already exists.',409));return failed(e);}}
