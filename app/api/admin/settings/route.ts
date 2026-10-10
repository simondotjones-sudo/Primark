import type {NextRequest} from 'next/server';
import {bodyJson,CourseError,failed,json} from '@/lib/course-admin';
import {requireUserAdministrator} from '@/lib/user-administration';
import {inTransaction} from '@/lib/database';
import {organisationSettings} from '@/lib/organisation-settings';
export const dynamic='force-dynamic';
export async function GET(){try{
 const actor=await requireUserAdministrator();
 if(!actor.platformAdmin&&actor.access.scope!=='organisation')throw new CourseError('Organisation admin access is required.',403);
 return json({settings:await organisationSettings(),canSetCredits:actor.platformAdmin});
}catch(e){return failed(e);}}
export async function POST(request:NextRequest){try{
 const actor=await requireUserAdministrator(request),b=await bodyJson(request,2000);
 if(!actor.platformAdmin&&actor.access.scope!=='organisation')throw new CourseError('Organisation admin access is required.',403);
 const keys=['pathways_enabled','credits_enabled','auto_archive_enabled','exclude_within_deadline'];
 if(!b||keys.some(k=>b[k]!==undefined&&typeof b[k]!=='boolean')||!Number.isSafeInteger(b.revision))throw new CourseError('Check the organisation settings.');
 await inTransaction(async client=>{
  await client.query("SELECT set_config('app.audit_actor',$1,true)",[actor.email]);
  let platform=actor.platformAdmin;
  if(actor.id){
   const {rows:[current]}=await client.query(`SELECT l.archived_at,r.scope,EXISTS(SELECT 1 FROM platform_admins p WHERE p.learner_id=l.id) AS platform
    FROM learners l LEFT JOIN reporting_access r ON r.learner_id=l.id WHERE l.id=$1 FOR UPDATE OF l`,[actor.id]);
   if(!current||current.archived_at||(!current.platform&&current.scope!=='organisation'))throw new CourseError('Organisation admin access is required.',403);
   platform=!!current.platform;
  }
  const {rows:[old]}=await client.query('SELECT * FROM organisation_settings WHERE id=1 FOR UPDATE');
  if(old.revision!==b.revision)throw new CourseError('These settings changed. Reload before saving.',409);
  if((b.credits_enabled!==undefined||b.pathways_enabled!==undefined)&&!platform)throw new CourseError('Only platform admins can change credits or enable pathways.',403);
  const {rows:[next]}=await client.query(`UPDATE organisation_settings SET credits_enabled=$1,auto_archive_enabled=$2,exclude_within_deadline=$3,
   revision=revision+1,updated_at=now(),updated_by=$4,pathways_enabled=$5 WHERE id=1 RETURNING *`,
   [b.credits_enabled??old.credits_enabled,b.auto_archive_enabled??old.auto_archive_enabled,b.exclude_within_deadline??old.exclude_within_deadline,actor.email,b.pathways_enabled??old.pathways_enabled]);
  await client.query('INSERT INTO organisation_settings_audit(actor,previous_state,next_state) VALUES($1,$2,$3)',[actor.email,JSON.stringify(old),JSON.stringify(next)]);
 });
 return json({settings:await organisationSettings(),canSetCredits:actor.platformAdmin});
}catch(e){return failed(e);}}
