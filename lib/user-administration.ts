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
