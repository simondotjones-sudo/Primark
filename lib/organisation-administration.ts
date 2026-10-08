import type {NextRequest} from 'next/server';
import {CourseError} from '@/lib/course-admin';
import {getUserAdministrator,type UserAdministrator} from '@/lib/user-administration';
import {sameOrigin} from '@/lib/request-origin';
export function requireStoreScope(actor:UserAdministrator|null):asserts actor is UserAdministrator{
  if(!actor||(!actor.platformAdmin&&!['organisation','country'].includes(actor.access.scope)))throw new CourseError('Organisation or country admin access is required.',403);
}
export async function requireStoreAdministrator(request?:NextRequest){
  const actor=await getUserAdministrator();requireStoreScope(actor);
  if(request&&!sameOrigin(request))throw new CourseError('Please use the Organisation page.',403);
  return actor;
}
