import type {NextRequest} from 'next/server';
import {bodyJson,CourseError,failed,json} from '@/lib/course-admin';
import {sameOrigin} from '@/lib/request-origin';
import {allowLoginAttempt} from '@/lib/admin-auth';
import {invitationForToken} from '@/lib/email-notifications';
export const dynamic='force-dynamic';
export async function POST(request:NextRequest){try{
 if(!sameOrigin(request))throw new CourseError('Please use the Safety Passport page.',403);
 if(!await allowLoginAttempt('invitation:'+ (request.headers.get('x-nf-client-connection-ip')||'local'),30))throw new CourseError('Too many attempts. Try again in 15 minutes.',429);
 const body=await bodyJson(request,1000);return json(await invitationForToken(body.token));
}catch(e){return failed(e);}}
