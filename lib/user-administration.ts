import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { getAdminUser } from '@/lib/admin-auth';
import { learnerForSession } from '@/lib/server';
import { reportingAccessFor } from '@/lib/reporting-access';
import { managerStoreFor } from '@/lib/store-manager';
import { CourseError } from '@/lib/course-admin';
import { sameOrigin } from '@/lib/shot-server';
import type { ReportingAccess } from '@/lib/reporting-types';

export type UserAdministrator = {email:string;id?:string;platformAdmin:boolean;access:ReportingAccess;managerStoreId:string|null};
export async function getUserAdministrator(): Promise<UserAdministrator|null> {
  const admin = await getAdminUser();
  if (admin) return {email:admin.email,id:admin.learnerId,platformAdmin:true,access:{scope:'organisation',country:null,siteId:null},managerStoreId:null};
  const learner = await learnerForSession((await cookies()).get('primark_session')?.value);
  if (!learner) return null;
  const access = await reportingAccessFor(learner.id);
  if (!access) return null;
  const manager = await managerStoreFor(learner.id);
  return {email:learner.email,id:learner.id,platformAdmin:false,access,managerStoreId:manager?.id||null};
}
export async function requireUserAdministrator(request?:NextRequest) {
  const actor = await getUserAdministrator();
  if (!actor) throw new CourseError('Reporting access is required.',403);
  if (request && !sameOrigin(request)) throw new CourseError('Please use the Manage Users page.',403);
  return actor;
}
export function allowedAdminRoles(actor:UserAdministrator) {
  return actor.platformAdmin ? ['site','country','organisation','platform']
    : actor.access.scope==='organisation' ? ['site','country','organisation']
    : actor.access.scope==='country' ? ['site','country'] : ['site'];
}

// A home store must never give a lower-level admin control of a wider grant.
export function managedUsersSql(actor:UserAdministrator,stores:{id:string;country:string}[]) {
  const args:unknown[]=[];let sql='1=1';
  if(!actor.platformAdmin){
    sql='NOT EXISTS(SELECT 1 FROM platform_admins p WHERE p.learner_id=l.id)';
    if(actor.access.scope!=='organisation'){
      const isCountry=actor.access.scope==='country';
      const ids=stores.filter(s=>isCountry?s.country===actor.access.country:s.id===actor.access.siteId).map(s=>s.id);
      sql+=` AND (l.store_id=ANY(?::text[]) ${isCountry?"OR EXISTS(SELECT 1 FROM reporting_access r WHERE r.learner_id=l.id AND r.scope='country' AND r.country=?)":''})
        AND NOT EXISTS(SELECT 1 FROM reporting_access r WHERE r.learner_id=l.id AND ${isCountry?"(r.scope='organisation' OR r.country IS DISTINCT FROM ?)":"(r.scope<>'site' OR r.site_id IS DISTINCT FROM ?)"})
        AND NOT EXISTS(SELECT 1 FROM store_managers m WHERE m.learner_id=l.id AND NOT (m.store_id=ANY(?::text[])))`;
      args.push(ids,...(isCountry?[actor.access.country]:[]),isCountry?actor.access.country:actor.access.siteId,ids);
    }
  }
  return {sql,args};
}
export const canEditUsers=(actor:UserAdministrator)=>actor.platformAdmin||actor.access.scope!=='site';
export const userColumns=`l.id,l.name,l.email,l.workday_id,l.country,l.store_id,l.archived_at,
  r.scope,r.country AS reporting_country,r.site_id AS reporting_site_id,m.store_id AS manager_store_id,
  EXISTS(SELECT 1 FROM platform_admins p WHERE p.learner_id=l.id) AS platform_admin`;
export const userJoins='FROM learners l LEFT JOIN reporting_access r ON r.learner_id=l.id LEFT JOIN store_managers m ON m.learner_id=l.id';
export function userRevision(person:{name:string;email:string;workday_id:string|null;store_id:string;country:string;archived_at:string|null;scope:string|null;reporting_country:string|null;reporting_site_id:string|null;manager_store_id:string|null;platform_admin:boolean}){
  return JSON.stringify([person.name,person.email,person.workday_id,person.store_id,person.country,person.archived_at,person.scope,person.reporting_country,person.reporting_site_id,person.manager_store_id,person.platform_admin]);
}
