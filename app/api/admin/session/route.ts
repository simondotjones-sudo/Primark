import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_COOKIE, allowLoginAttempt, credentials, passwordMatches } from '@/lib/admin-auth';
import { createAdminSession } from '@/lib/admin-session';
import { db, hash } from '@/lib/server';
import { sameOrigin } from '@/lib/request-origin';
export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Please use the sign-in page.' }, { status: 403 });
  try {
    const body = await request.json();
    if (body.action === 'logout') {
      const token = request.cookies.get(ADMIN_COOKIE)?.value;
      if (token) await db().prepare('DELETE FROM admin_sessions WHERE token_hash=?').bind(await hash(token)).run();
      const response = NextResponse.json({ ok: true }); response.cookies.delete(ADMIN_COOKIE); return response;
    }
    if (!credentials()) return NextResponse.json({ error: 'Set PRIMARK_ADMIN_EMAIL and PRIMARK_ADMIN_PASSWORD (at least 16 characters) in Netlify, make them available to Functions, then redeploy.' }, { status: 503 });
    if (!await allowLoginAttempt('platform-admin')) return NextResponse.json({ error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429 });
    if (typeof body.email !== 'string' || typeof body.password !== 'string' || body.password.length > 1024 || !passwordMatches(body.email.trim(), body.password))
      return NextResponse.json({ error: 'Those sign-in details did not match.' }, { status: 401 });
    return await createAdminSession(request, body.returnTo);
  } catch (error) { console.error('Admin sign-in failed', error); return NextResponse.json({ error: 'Sign-in is temporarily unavailable.' }, { status: 503 }); }
}
