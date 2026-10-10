import {isDeepStrictEqual} from 'node:util';
import {requireFeature,featureEnabled} from '@/lib/features';
import type {NextRequest} from 'next/server';
import {db,inTransaction} from '@/lib/database';
import {bodyJson,CourseError,failed,json} from '@/lib/course-admin';
import {currentLearner} from '@/lib/server';
import {requireUserAdministrator} from '@/lib/user-administration';
import {organisationSettings} from '@/lib/organisation-settings';
import {activeLearnerSql} from '@/lib/account-type';
import {getReportingAccess,reportingFilter} from '@/lib/reporting-access';
import {storeDirectory} from '@/lib/store-directory';
import {pathwayEnrolments,validatePathway,validatePathwayRule} from '@/lib/pathways';
import {creditError} from '@/lib/credits';
import type {Pathway,PathwayItem} from '@/lib/pathway-types';
export const dynamic='force-dynamic';
async function manager(request?:NextRequest){const a=await requireUserAdministrator(request);if(!a.platformAdmin&&a.access.scope!=='organisation')throw new CourseError('Organisation or platform admin access is required.',403);return a;}
export async function GET(request:NextRequest){try{
 const mode=request.nextUrl.searchParams.get('mode')||'mine';
 if(mode==='availability'){const learner=await currentLearner(request),access=await getReportingAccess(request);if(!learner&&!access)throw new CourseError('Sign in first.',403);const settings=await organisationSettings();const existing=learner?await db().prepare('SELECT id FROM pathway_enrolments WHERE learner_id=? LIMIT 1').bind(learner.id).first():null;return json({enabled:settings.pathways_enabled||!access&&!!existing});}
 if(mode==='manage'){
  const actor=await manager(),settings=await organisationSettings();
  if(!settings.pathways_enabled)return json({enabled:false,platformAdmin:actor.platformAdmin});
  const [pathways,courses]=await Promise.all([db().prepare('SELECT * FROM learning_pathways ORDER BY archived,name').all(),db().prepare("SELECT c.id,c.title,c.status,c.catalogue_scope,c.available_countries_json FROM courses c JOIN course_packages p ON p.id=c.package_id WHERE c.status='published' AND p.status='ready' ORDER BY title").all()]);
  return json({enabled:true,pathways:pathways.results,courses:courses.results,platformAdmin:actor.platformAdmin,stores:await storeDirectory(false),failures:(await db().prepare(`SELECT f.*,l.name AS learner_name,p.name AS pathway_name FROM pathway_assignment_failures f JOIN learners l ON l.id=f.learner_id JOIN learning_pathways p ON p.id=f.pathway_id WHERE ${activeLearnerSql()} AND l.employment_ended_on IS NULL AND NOT p.archived AND p.assignment_rule->>'enabled'='true' ORDER BY f.attempted_at DESC LIMIT 100`).all()).results});
 }
 if(mode==='people'){
  await manager();if(!(await organisationSettings()).pathways_enabled)throw new CourseError('Pathways are not enabled.',403);
  const search=(request.nextUrl.searchParams.get('search')||'').trim().slice(0,150);
  if(search.length<2)return json({people:[]});
  return json({people:(await db().prepare(`SELECT l.id,l.name,l.email,l.workday_id,l.store_id,l.country FROM learners l WHERE ${activeLearnerSql()} AND strpos(lower(concat_ws(' ',l.name,l.email,l.workday_id)),lower(?))>0 ORDER BY l.name,l.id LIMIT 51`).bind(search).all()).results});
 }
 if(mode==='report'){
  const access=await getReportingAccess(request);if(!access)throw new CourseError('Reporting access is required.',403);
  if(!(await organisationSettings()).pathways_enabled)return json({enabled:false,rows:[]});
  const filter=reportingFilter(access,request.nextUrl.searchParams,await storeDirectory());
  return json({enabled:true,rows:await pathwayEnrolments(null,filter.siteIds)});
 }
 if(mode!=='mine')throw new CourseError('Unknown pathway view.');
 const learner=await currentLearner(request);if(!learner||learner.admin_only)throw new CourseError('Learner sign-in is required.',403);
 const settings=await organisationSettings();
 // Already assigned pathways remain visible when new pathway use is disabled.
 await db().prepare('SELECT sync_credit_assignments(?)').bind(learner.id).run();
 const rows=await pathwayEnrolments(learner.id);
 return json({enabled:settings.pathways_enabled||rows.length>0,rows});
}catch(e){return failed(e);}}
export async function POST(request:NextRequest){try{
 const actor=await manager(request),b=await bodyJson(request,50000);
 const result=await inTransaction(async tx=>{
  await tx.query("SELECT set_config('app.audit_actor',$1,true)",[actor.email]);
  if(actor.id){const a=(await tx.query(`SELECT l.id FROM learners l WHERE l.id=$1 AND l.archived_at IS NULL AND (EXISTS(SELECT 1 FROM platform_admins p WHERE p.learner_id=l.id) OR EXISTS(SELECT 1 FROM reporting_access r WHERE r.learner_id=l.id AND r.scope='organisation')) FOR UPDATE`,[actor.id])).rows[0];if(!a)throw new CourseError('Organisation or platform admin access is required.',403);}
  const settings=(await tx.query('SELECT pathways_enabled FROM organisation_settings WHERE id=1 FOR SHARE')).rows[0];if(!settings?.pathways_enabled)throw new CourseError('Pathways are not enabled.',403);
  if(b.action==='retry-rules'){
   await requireFeature('pathway_rules');
   const row=(await tx.query('SELECT sync_pathway_assignments() AS assigned')).rows[0];return {assigned:row.assigned};
  }
  if(b.action==='save'){
   const value=validatePathway(b),ids=value.items.map(i=>i.courseId);
   const courses=(await tx.query("SELECT c.id FROM courses c JOIN course_packages p ON p.id=c.package_id WHERE c.id=ANY($1::text[]) AND ($2 OR (c.status='published' AND p.status='ready'))",[ids,b.archived])).rows;
   if(courses.length!==ids.length)throw new CourseError('Choose published courses with a ready package.');
   const id=typeof b.id==='string'?b.id:crypto.randomUUID();
   if(b.id){
    if(!Number.isSafeInteger(b.revision))throw new CourseError('Reload the pathway before editing.');
    const changed=await tx.query('UPDATE learning_pathways SET name=$1,description=$2,items=$3,deadline_days=$4,award_certificate=$5,archived=$6,revision=revision+1,updated_at=now(),updated_by=$7 WHERE id=$8 AND revision=$9 RETURNING id',[value.name,b.description,JSON.stringify(value.items),b.deadline_days,b.award_certificate,b.archived,actor.email,id,b.revision]);
    if(!changed.rowCount)throw new CourseError('This pathway changed. Reload before saving.',409);
   }else await tx.query('INSERT INTO learning_pathways(id,name,description,items,deadline_days,award_certificate,archived,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,value.name,b.description,JSON.stringify(value.items),b.deadline_days,b.award_certificate,b.archived,actor.email]);
   if(b.assignment_rule!==undefined){
    const rule=await validatePathwayRule(b.assignment_rule);
    if(rule.enabled&&!await featureEnabled('pathway_rules')){
     const prior=(await tx.query('SELECT assignment_rule FROM learning_pathways WHERE id=$1',[id])).rows[0];
     if(!isDeepStrictEqual(prior?.assignment_rule,rule))throw new CourseError('This feature is switched off in Settings.',403);
    }
    await tx.query('UPDATE learning_pathways SET assignment_rule=$1 WHERE id=$2',[JSON.stringify(rule),id]);
    await tx.query('DELETE FROM pathway_assignment_failures WHERE pathway_id=$1',[id]);
    await tx.query('SELECT sync_pathway_assignments(NULL,$1)',[id]);
   }
   await tx.query('INSERT INTO pathway_audit(actor,action,details) VALUES($1,\'save\',$2)',[actor.email,JSON.stringify({...b,id,items:value.items})]);
   return {id};
  }
  if(b.action!=='assign'||typeof b.pathwayId!=='string'||!Array.isArray(b.learnerIds)||!b.learnerIds.length||b.learnerIds.length>100||b.learnerIds.some((id:unknown)=>typeof id!=='string'))throw new CourseError('Choose a pathway and up to 100 learners.');
  if(b.dueDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(b.dueDate)||!Number.isFinite(Date.parse(b.dueDate))||new Date(b.dueDate).toISOString().slice(0,10)!==b.dueDate))throw new CourseError('Choose a valid deadline.');
  const p=(await tx.query('SELECT * FROM learning_pathways WHERE id=$1 AND NOT archived FOR SHARE',[b.pathwayId])).rows[0] as Pathway|undefined;
  if(!p)throw new CourseError('Choose an active pathway.');
  let assigned=0,existing=0;
  for(const learnerId of [...new Set<string>(b.learnerIds)].sort()){
   const person=(await tx.query(`SELECT l.* FROM learners l WHERE l.id=$1 AND ${activeLearnerSql()} FOR UPDATE`,[learnerId])).rows[0];if(!person)throw new CourseError('Choose active learner accounts.');
   if((await tx.query('SELECT id FROM pathway_enrolments WHERE learner_id=$1 AND pathway_id=$2',[learnerId,p.id])).rowCount){existing++;continue;}
   // Honour this manual assignment's fixed deadline before automatic rules run.
   await tx.query('SELECT sync_course_credit_assignments($1)',[learnerId]);
   const eid=crypto.randomUUID();
   await tx.query(`INSERT INTO pathway_enrolments(id,pathway_id,learner_id,pathway_revision,name,description,learner_name,award_certificate,assigned_by,due_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $10::date IS NOT NULL THEN (($10::date+1)::timestamp AT TIME ZONE 'Europe/London')-interval '1 millisecond' ELSE now()+$11::int*interval '24 hours' END)`,[eid,p.id,learnerId,p.revision,p.name,p.description,person.name,p.award_certificate,actor.email,b.dueDate||null,p.deadline_days]);
   if(b.dueDate&&(await tx.query('SELECT id FROM pathway_enrolments WHERE id=$1 AND due_at<now()',[eid])).rowCount)throw new CourseError('Choose a deadline today or later.');
   for(const [position,item] of (p.items as PathwayItem[]).entries()){
    const c=(await tx.query("SELECT c.* FROM courses c JOIN course_packages pack ON pack.id=c.package_id WHERE c.id=$1 AND c.status='published' AND pack.status='ready' FOR SHARE OF c",[item.courseId])).rows[0];
    if(!c||!(c.catalogue_scope==='global'||c.catalogue_scope==='countries'&&JSON.parse(String(c.available_countries_json||'[]')).includes(person.country)))throw new CourseError('Every pathway course must be available in the learner’s country.');
    const old=(await tx.query(`SELECT h.id,h.completed_at,cert.expires_at FROM course_assignments a JOIN assignment_history h ON h.id=a.history_id LEFT JOIN certificates cert ON cert.assignment_id=h.id AND cert.cancelled_at IS NULL AND cert.archived_at IS NULL WHERE a.learner_id=$1 AND a.course_id=$2`,[learnerId,c.id])).rows[0];
    const expired=!!old?.expires_at&&Date.parse(String(old.expires_at))<=Date.now();
    if(!old||expired)await tx.query("SELECT assign_credit_course($1,$2,$3,now(),$4,true,'pathway')",[learnerId,c.id,actor.email,expired]);
    const h=(await tx.query('SELECT h.* FROM course_assignments a JOIN assignment_history h ON h.id=a.history_id WHERE a.learner_id=$1 AND a.course_id=$2',[learnerId,c.id])).rows[0];if(!h)throw new CourseError('This course could not be assigned.');
    await tx.query('INSERT INTO pathway_enrolment_courses(enrolment_id,course_id,assignment_id,title,stage,position,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[eid,c.id,h.id,c.title,item.stage,position,h.completed_at]);
    await tx.query('UPDATE assignment_history SET due_at=LEAST(due_at,(SELECT due_at FROM pathway_enrolments WHERE id=$1)) WHERE id=$2 AND completed_at IS NULL',[eid,h.id]);
   }
   // Shared courses must not create circular prerequisites across pathways.
   const cycle=(await tx.query(`WITH RECURSIVE edges AS (
    SELECT DISTINCT i.course_id child,prior.course_id parent FROM pathway_enrolments e JOIN pathway_enrolment_courses i ON i.enrolment_id=e.id JOIN pathway_enrolment_courses prior ON prior.enrolment_id=e.id AND prior.stage<i.stage
    WHERE e.learner_id=$1 AND e.completed_at IS NULL AND i.completed_at IS NULL AND prior.completed_at IS NULL),
    reach(child,parent) AS (SELECT child,parent FROM edges UNION SELECT r.child,e.parent FROM reach r JOIN edges e ON e.child=r.parent)
    SELECT 1 FROM reach WHERE child=parent LIMIT 1`,[learnerId])).rowCount;
   if(cycle)throw new CourseError('These pathways would create conflicting course orders for a learner. Adjust the stages first.');
   await tx.query('SELECT finish_learning_pathway($1)',[eid]);assigned++;
  }
  await tx.query('INSERT INTO pathway_audit(actor,action,details) VALUES($1,\'assign\',$2)',[actor.email,JSON.stringify({pathwayId:p.id,learnerIds:b.learnerIds,dueDate:b.dueDate||null,assigned,existing})]);
  return {assigned,existing};
 });
 return json({ok:true,...result});
}catch(e){return failed(creditError(e));}}
