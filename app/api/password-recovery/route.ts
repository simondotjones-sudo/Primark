import { NextRequest, NextResponse } from 'next/server';
import { allowLoginAttempt } from '@/lib/admin-auth';
import { bodyJson, CourseError } from '@/lib/course-admin';
import { sameOrigin } from '@/lib/request-origin';
import { RecoveryError, requestPasswordReset, resetPassword } from '@/lib/password-recovery';

export const dynamic = 'force-dynamic';
const reply = (data: object, status = 200) => NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return reply({error:'Please use the password recovery page.'},403);
  try {
    const body = await bodyJson(request,4096) as Record<string,unknown>;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({error:'Invalid request.'},400);
    if (body.action !== 'request' && body.action !== 'reset') return reply({error:'Choose a password recovery action.'},400);
    const ip = request.headers.get('x-nf-client-connection-ip') || 'local';
    if (!await allowLoginAttempt('recovery-ip:'+ip,30)) return reply({error:'Too many attempts. Try again in 15 minutes.'},429);
    if (body.action === 'request') {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (email.length > 254 || /[<>,;:"\\]/.test(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({error:'Enter a valid email address.'},400);
      // The same response for unknown, existing and throttled addresses.
      if (await allowLoginAttempt('recovery-email:'+email,3)) await requestPasswordReset(email);
      return reply({ok:true});
    }
    await resetPassword(body.token,body.password);
    const response = reply({ok:true});
    response.cookies.delete('primark_session');response.cookies.delete('primark_admin');
    return response;
  } catch (error) {
    if (error instanceof RecoveryError) return reply({error:error.message},400);
    if (error instanceof CourseError) return reply({error:error.message},error.status);
    return reply({error:'Password recovery is temporarily unavailable. Please try again later.'},503);
  }
}
