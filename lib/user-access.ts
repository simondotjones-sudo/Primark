import {validateJobRole} from '@/lib/job-roles';
import {requireFeature} from '@/lib/features';
import {credentials} from '@/lib/admin-auth';
import {CourseError} from '@/lib/course-admin';
import {inTransaction,postgresSql} from '@/lib/database';
import {storeDirectory} from '@/lib/store-directory';
import {allowedAdminRoles,canEditUsers,managedUsersSql,userColumns,userJoins,userRevision,type UserAdministrator} from '@/lib/user-administration';
import type {UserPerson} from '@/lib/user-administration-types';
import {allowLoginAttempt} from '@/lib/admin-auth';
import {RecoveryError,requestPasswordReset} from '@/lib/password-recovery';
import {isLanguage} from '@/lib/i18n';
import {normalizeWorkdayId} from '@/lib/learner-auth';

export async function changeUserAccess(originalActor:UserAdministrator,body:Record<string,unknown>){
  if(!body||typeof body!=='object'||Array.isArray(body)||typeof body.id!=='string'||typeof body.revision!=='string'||!['details','password-reset','access','archive','restore','transfer','rejoin','leave'].includes(String(body.action)))throw new CourseError('Choose an existing learner account.');
  if(['transfer','rejoin','leave'].includes(String(body.action)))await requireFeature('lifecycle');
  const stores=await storeDirectory(),activeStores=stores.filter(s=>s.active);
  await inTransaction(async client=>{
    // Serialize changes to the actor and target, including archive/restore races.
    await client.query('SELECT id FROM learners WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE',[[body.id,...(originalActor.id?[originalActor.id]:[])]]);
    const read=async(id:string)=>(await client.query(`SELECT ${userColumns} ${userJoins} WHERE l.id=$1`,[id])).rows[0] as unknown as UserPerson|undefined;
    let actor=originalActor;
    if(actor.id){
      const current=await read(actor.id);
      if(!current||current.archived_at||(!current.platform_admin&&!current.scope&&!current.manager_store_id))throw new CourseError('Reporting access is required.',403);
      const managedStore=stores.find(s=>s.id===current.manager_store_id);
      actor={email:current.email,id:current.id,platformAdmin:current.platform_admin,managerStoreId:current.manager_store_id,access:current.platform_admin?{scope:'organisation',country:null,siteId:null}:current.scope?{scope:current.scope,country:current.reporting_country,siteId:current.reporting_site_id}:{scope:'site',country:managedStore?.country||null,siteId:current.manager_store_id}};
    }
    const target=await read(body.id as string);
    if(!target)throw new CourseError('Choose an existing learner account.');
    if(target.id===actor.id||target.email===actor.email||target.email===credentials()?.email)throw new CourseError('Ask another administrator to change your access or archive your account.',403);
    const scope=managedUsersSql(actor,stores);
    const allowed=(await client.query(postgresSql(`SELECT l.id FROM learners l WHERE l.id=? AND ${scope.sql}`),[target.id,...scope.args])).rows[0];
    if(!allowed)throw new CourseError('You can manage accounts only within your assigned scope.',403);
    if(body.revision!==userRevision(target))throw new CourseError('This account changed. Refresh the list and try again.',409);
    await client.query("SELECT set_config('app.audit_actor',$1,true)",[actor.email]);
    const lifecycle=['transfer','rejoin','leave'].includes(String(body.action));
    const reason=typeof body.reason==='string'?body.reason.trim():'';
    if(lifecycle&&(reason.length<3||reason.length>500))throw new CourseError('Enter a reason between 3 and 500 characters.');
    await client.query("SELECT set_config('app.audit_reason',$1,true)",[reason]);
    let invalidateSessions=true;
    if(lifecycle){
      if(!canEditUsers(actor))throw new CourseError('Country or organisation admin access is required.',403);
      const effective=typeof body.effectiveDate==='string'?body.effectiveDate:'';
      if(!/^\d{4}-\d{2}-\d{2}$/.test(effective)||!Number.isFinite(Date.parse(effective))||new Date(effective).toISOString().slice(0,10)!==effective||effective>new Date().toISOString().slice(0,10))throw new CourseError('Choose an effective date no later than today. Changes apply immediately.');
      await client.query("SELECT set_config('app.audit_reason',$1,true)",[reason+' (effective '+effective+')']);
      if(body.action==='leave'){
        if(target.archived_at)throw new CourseError('This account is already archived.',409);
        if(target.employment_started_on&&effective<String(target.employment_started_on).slice(0,10))throw new CourseError('The leaving date cannot be before the employment start date.');
        await client.query('UPDATE learners SET archived_at=now(),employment_ended_on=$2,lifecycle_reason=$3 WHERE id=$1',[target.id,effective,reason]);
        await client.query('UPDATE assessor_grants SET active=false WHERE learner_id=$1',[target.id]);
      }else{
        if(body.action==='transfer'&&target.archived_at||body.action==='rejoin'&&!target.archived_at)throw new CourseError('This account changed. Refresh the list and try again.',409);
        const destination=activeStores.find(s=>s.id===body.storeId);
        if(!destination)throw new CourseError('Choose an active destination store.');
        if(actor.access.scope==='country'&&destination.country!==actor.access.country)throw new CourseError('An organisation admin must handle transfers between countries.',403);
        if(target.platform_admin||target.scope==='country'||target.scope==='organisation')throw new CourseError('Use Edit access to change this administrator’s scope before transferring or rejoining.');
        if(body.action==='transfer'&&destination.id===target.store_id)throw new CourseError('Choose a different destination store.');
        await client.query('UPDATE learners SET store_id=$2,country=$3,archived_at=NULL,employment_ended_on=NULL,lifecycle_reason=$4,employment_started_on=CASE WHEN $5 THEN $6::date ELSE employment_started_on END WHERE id=$1',[target.id,destination.id,destination.country,reason,body.action==='rejoin',effective]);
        if(body.action==='rejoin'){
          await client.query('DELETE FROM reporting_access WHERE learner_id=$1',[target.id]);
          await client.query('DELETE FROM store_managers WHERE learner_id=$1',[target.id]);
          await client.query('UPDATE assessor_grants SET active=false WHERE learner_id=$1',[target.id]);
          await client.query('DELETE FROM assessor_accounts WHERE learner_id=$1',[target.id]);
        }else{
          await client.query("UPDATE reporting_access SET site_id=$2,country=$3,assigned_by=$4,updated_at=now() WHERE learner_id=$1 AND scope='site'",[target.id,destination.id,destination.country,actor.email]);
          await client.query('UPDATE store_managers SET store_id=$2,assigned_by=$3,updated_at=now() WHERE learner_id=$1',[target.id,destination.id,actor.email]);
          await client.query('UPDATE assessor_grants SET active=false WHERE learner_id=$1',[target.id]);
        }
        if(destination.country!==target.country)await client.query('DELETE FROM learner_inductions WHERE learner_id=$1',[target.id]);
        await client.query('SELECT sync_credit_assignments($1)',[target.id]);
      }
    }else if(body.action==='details'){
      if(target.archived_at)throw new CourseError('Restore this account before editing details.');
      const name=typeof body.name==='string'?body.name.trim().replace(/\s+/g,' '):'';
      const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
      if(name.length<2||name.length>101)throw new CourseError('Enter a name with 2–101 characters.');
      if(email.length>254||/[<>,;:"\\]/.test(email)||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new CourseError('Enter a valid email address.');
      if(email===credentials()?.email)throw new CourseError('This email is already registered.',409);
      const rawId=body.workdayId===undefined?target.workday_id:body.workdayId;
      if(rawId!==null&&typeof rawId!=='string')throw new CourseError('Check your Workday ID, or leave it blank.');
      const workdayId=normalizeWorkdayId(rawId);
      if(typeof rawId==='string'&&rawId.trim()&&!workdayId)throw new CourseError('Check your Workday ID, or leave it blank.');
      const jobRoleId=body.jobRoleId===undefined?target.job_role_id:await validateJobRole(body.jobRoleId,target.job_role_id,client);
      try{await client.query('UPDATE learners SET name=$1,email=$2,workday_id=$3,job_role_id=$5 WHERE id=$4',[name,email,workdayId,target.id,jobRoleId]);}
      catch(error){if((error as {code?:string}).code==='23505')throw new CourseError((error as {constraint?:string}).constraint?.includes('workday')?'This Employee ID is already linked to an account.':'This email is already registered.',409);throw error;}
      if(jobRoleId!==target.job_role_id)await client.query('SELECT sync_pathway_assignments($1)',[target.id]);
      invalidateSessions=email!==target.email||workdayId!==target.workday_id;
    }else if(body.action==='password-reset'){
      if(target.archived_at)throw new CourseError('Restore this account before sending a password reset email.');
      if(!await allowLoginAttempt('admin-recovery-actor:'+actor.email,30)||!await allowLoginAttempt('recovery-email:'+target.email,3))throw new CourseError('Too many attempts. Try again in 15 minutes.',429);
      try{await requestPasswordReset(target.email,isLanguage(body.lang)?body.lang:'en',true);}
      catch(error){if(error instanceof RecoveryError)throw new CourseError(error.message,503);throw error;}
      invalidateSessions=false;
    }else if(body.action==='access'){
      if(!canEditUsers(actor))throw new CourseError('You cannot edit account access.',403);
      if(target.archived_at)throw new CourseError('Restore this account before editing access.');
      const role=String(body.role);
      if(!['learner','manager',...allowedAdminRoles(actor)].includes(role))throw new CourseError('You cannot grant this level of access.',403);
      const needsStore=['learner','site','manager'].includes(role);
      const store=activeStores.find(s=>s.id===body.storeId);
      let country:string|null=null,storeId='';
      if(needsStore){if(!store)throw new CourseError('Choose a store.');storeId=store.id;country=store.country;}
      else if(role==='country'){if(typeof body.country!=='string'||!activeStores.some(s=>s.country===body.country))throw new CourseError('Choose a country from the directory.');country=body.country;}
      if(actor.access.scope==='country'&&country!==actor.access.country||actor.access.scope==='site'&&storeId!==actor.access.siteId)throw new CourseError('You can manage accounts only within your assigned scope.',403);
      await client.query('DELETE FROM platform_admins WHERE learner_id=$1',[target.id]);
      await client.query('DELETE FROM reporting_access WHERE learner_id=$1',[target.id]);
      await client.query('DELETE FROM store_managers WHERE learner_id=$1',[target.id]);
      const date=new Date().toISOString();
      if(role==='platform')await client.query('INSERT INTO platform_admins(learner_id,assigned_by,updated_at) VALUES($1,$2,$3)',[target.id,actor.email,date]);
      else if(role!=='learner')await client.query('INSERT INTO reporting_access(learner_id,scope,country,site_id,assigned_by,updated_at) VALUES($1,$2,$3,$4,$5,$6)',[target.id,role==='manager'?'site':role,country,needsStore?storeId:null,actor.email,date]);
      if(role==='manager')await client.query('INSERT INTO store_managers(learner_id,store_id,assigned_by,updated_at) VALUES($1,$2,$3,$4)',[target.id,storeId,actor.email,date]);
      await client.query('UPDATE learners SET store_id=$1,country=$2 WHERE id=$3',[storeId,country||'',target.id]);
      if(country!==target.country)await client.query('DELETE FROM learner_inductions WHERE learner_id=$1',[target.id]);
      if(role==='learner')await client.query('SELECT sync_credit_assignments($1)',[target.id]);
    }else{
      const archive=body.action==='archive';
      if(archive===!!target.archived_at)throw new CourseError('This account changed. Refresh the list and try again.',409);
      // Keep grants and all learning evidence. Restore never revives old sessions.
      await client.query('UPDATE learners SET archived_at=$1 WHERE id=$2',[archive?new Date().toISOString():null,target.id]);
      if(archive)await client.query('UPDATE assessor_grants SET active=false WHERE learner_id=$1',[target.id]);
      else await client.query('SELECT sync_credit_assignments($1)',[target.id]);
    }
    if(invalidateSessions){
      await client.query('DELETE FROM sessions WHERE learner_id=$1',[target.id]);
      await client.query('DELETE FROM scorm_launches WHERE learner_id=$1',[target.id]);
      await client.query("DELETE FROM password_resets WHERE account_type='learner' AND account_id=$1",[target.id]);
    }
    await client.query('INSERT INTO user_access_audit(learner_id,actor_email,action,previous_state,next_state) VALUES($1,$2,$3,audit_safe_state($4::jsonb),audit_safe_state($5::jsonb))',[target.id,actor.email,body.action,JSON.stringify(target),JSON.stringify(await read(target.id))]);
  });
}
