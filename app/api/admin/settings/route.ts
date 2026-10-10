import type {NextRequest} from 'next/server';
import {bodyJson,CourseError,failed,json} from '@/lib/course-admin';
import {requireUserAdministrator} from '@/lib/user-administration';
import {inTransaction} from '@/lib/database';
import {organisationSettings} from '@/lib/organisation-settings';
import {featureChoices} from '@/lib/features';
import {featureCatalogue,type FeatureChoices,type FeatureId} from '@/lib/feature-catalogue';
export const dynamic='force-dynamic';
async function administrator(request?:NextRequest){
 const actor=await requireUserAdministrator(request);
 if(!actor.platformAdmin&&actor.access.scope!=='organisation')throw new CourseError('Organisation admin access is required.',403);
 return actor;
}
async function response(platform:boolean){return json({settings:await organisationSettings(),...await featureChoices(),canSetCredits:platform,platformAdmin:platform,organisation:'Primark'});}
export async function GET(){try{return await response((await administrator()).platformAdmin);}catch(e){return failed(e);}}
export async function POST(request:NextRequest){try{
 const actor=await administrator(request),b=await bodyJson(request,12000);
 if(!b||typeof b!=='object'||Array.isArray(b)||!Number.isSafeInteger(b.revision))throw new CourseError('Check the organisation settings.');
 const legacy=featureCatalogue.filter(f=>'legacy' in f);
 const allowed=['revision','changes',...legacy.map(f=>f.legacy)];
 if(Object.keys(b).some(k=>!allowed.includes(k))||legacy.some(f=>b[f.legacy]!==undefined&&typeof b[f.legacy]!=='boolean'))throw new CourseError('Check the organisation settings.');
 if(b.changes!==undefined&&(!b.changes||typeof b.changes!=='object'||Array.isArray(b.changes)))throw new CourseError('Check the feature settings.');
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
  const choices=structuredClone(old.features) as FeatureChoices;
  for(const f of legacy)choices[f.id].enabled=!!old[f.legacy];
  const changes:Record<string,unknown>={...b.changes};
  for(const f of legacy)if(b[f.legacy]!==undefined){
   if((f.id==='credits'||f.id==='pathways')&&!platform)throw new CourseError('Only platform admins can change credits or enable pathways.',403);
   changes[f.id]={enabled:b[f.legacy],...(platform?{policy:'optional'}:{})};
  }
  for(const [key,value] of Object.entries(changes)){
   if(!featureCatalogue.some(f=>f.id===key)||!value||typeof value!=='object'||Array.isArray(value))throw new CourseError('Check the feature settings.');
   const patch=value as Record<string,unknown>,id=key as FeatureId,current=choices[id];
   if(Object.keys(patch).some(k=>!['policy','enabled'].includes(k))||patch.enabled!==undefined&&typeof patch.enabled!=='boolean'||patch.policy!==undefined&&!['disabled','optional','required'].includes(String(patch.policy)))throw new CourseError('Check the feature settings.');
   if(!platform&&(patch.policy!==undefined||current.policy!=='optional'))throw new CourseError('This feature is managed by Platform Admin.',403);
   choices[id]={...current,...patch} as FeatureChoices[FeatureId];
  }
  // A required child must have an available parent; reject contradictions rather than imply it is active.
  for(const f of featureCatalogue)if('parent' in f&&choices[f.id].policy==='required'&&choices[f.parent].policy!=='required')throw new CourseError('Make the parent feature Required before requiring a dependent feature.');
  const {rows:[next]}=await client.query('UPDATE organisation_settings SET features=$1,revision=revision+1,updated_at=now(),updated_by=$2 WHERE id=1 RETURNING *',[JSON.stringify(choices),actor.email]);
  await client.query('INSERT INTO organisation_settings_audit(actor,previous_state,next_state) VALUES($1,$2,$3)',[actor.email,JSON.stringify(old),JSON.stringify(next)]);

  // Requiring a category also enables its templates, without turning live mail on.
  const groups:Partial<Record<FeatureId,string[]>>={assignment_emails:['course_assigned','pathway_assigned'],registration_reminders:['invitation_reminder','account_reminder'],expiry_reminders:['expiry_reminder','expired'],weekly_store_reports:['manager_digest'],monthly_country_reports:['country_digest']};
  const forced=Object.entries(groups).filter(([id])=>choices[id as FeatureId].policy==='required').flatMap(([,kinds])=>kinds!);
  if(forced.length){
   const {rows:[mail]}=await client.query('SELECT * FROM email_settings WHERE id=1 FOR UPDATE');
   const enabled=mail.enabled as string[],missing=forced.filter(k=>!enabled.includes(k));
   if(missing.length){
    const since={...(mail.enabled_since as Record<string,string>)};for(const k of missing)since[k]=new Date().toISOString();
    await client.query('UPDATE email_settings SET enabled=$1,enabled_since=$2,revision=revision+1,updated_at=now(),updated_by=$3 WHERE id=1',[JSON.stringify([...enabled,...missing]),JSON.stringify(since),actor.email]);
    await client.query("INSERT INTO email_audit(actor,action,details) VALUES($1,'required_features',$2)",[actor.email,JSON.stringify({enabled:missing})]);
   }
  }
  // Queued messages disabled by this change must never spring back to life later.
  await client.query("UPDATE email_outbox o SET status='cancelled',error_code='feature_disabled' WHERE status='queued' AND (NOT feature_enabled('email_notifications') OR (kind IN ('course_assigned','pathway_assigned') AND NOT feature_enabled('assignment_emails')) OR (kind IN ('invitation_reminder','account_reminder') AND NOT feature_enabled('registration_reminders')) OR (kind IN ('expiry_reminder','expired') AND NOT feature_enabled('expiry_reminders')) OR (kind='manager_digest' AND NOT feature_enabled('weekly_store_reports')) OR (kind='country_digest' AND NOT feature_enabled('monthly_country_reports')))");
 });
 return await response(actor.platformAdmin);
}catch(e){return failed(e);}}
