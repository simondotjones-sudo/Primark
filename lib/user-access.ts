import {credentials} from '@/lib/admin-auth';
import {CourseError} from '@/lib/course-admin';
import {inTransaction,postgresSql} from '@/lib/database';
import {storeDirectory} from '@/lib/store-directory';
import {allowedAdminRoles,canEditUsers,managedUsersSql,userColumns,userJoins,userRevision,type UserAdministrator} from '@/lib/user-administration';
import type {UserPerson} from '@/lib/user-administration-types';

export async function changeUserAccess(originalActor:UserAdministrator,body:Record<string,unknown>){
  if(!body||typeof body!=='object'||Array.isArray(body)||typeof body.id!=='string'||typeof body.revision!=='string'||!['access','archive','restore'].includes(String(body.action)))throw new CourseError('Choose an existing learner account.');
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
    if(body.action==='access'){
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
    }else{
      const archive=body.action==='archive';
      if(archive===!!target.archived_at)throw new CourseError('This account changed. Refresh the list and try again.',409);
      // Keep grants and all learning evidence. Restore never revives old sessions.
      await client.query('UPDATE learners SET archived_at=$1 WHERE id=$2',[archive?new Date().toISOString():null,target.id]);
    }
    await client.query('DELETE FROM sessions WHERE learner_id=$1',[target.id]);
    await client.query('DELETE FROM scorm_launches WHERE learner_id=$1',[target.id]);
    await client.query("DELETE FROM password_resets WHERE account_type='learner' AND account_id=$1",[target.id]);
    await client.query('INSERT INTO user_access_audit(learner_id,actor_email,action,previous_state,next_state) VALUES($1,$2,$3,$4::jsonb,$5::jsonb)',[target.id,actor.email,body.action,JSON.stringify(target),JSON.stringify(await read(target.id))]);
  });
}
