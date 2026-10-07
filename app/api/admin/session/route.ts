import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_COOKIE, allowLoginAttempt, credentialFingerprint, credentials, passwordMatches, safeReturnTo } from '@/lib/admin-auth';
import { db, hash, randomToken, now } from '@/lib/server';
import { sameOrigin, isSecureRequest } from '@/lib/request-origin';
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
    const token = randomToken(), expires = new Date(Date.now() + 8 * 3600000);
    const statements = [
      db().prepare('DELETE FROM admin_sessions WHERE expires_at<? OR credential_hash<>?').bind(now(), credentialFingerprint()),
      db().prepare('INSERT INTO admin_sessions(token_hash,email,credential_hash,expires_at) VALUES(?,?,?,?)').bind(await hash(token), credentials()!.email, credentialFingerprint(), expires.toISOString()),
    ];
    const learnerToken = request.cookies.get('primark_session')?.value;
    const previousAdmin = request.cookies.get(ADMIN_COOKIE)?.value;
    if (learnerToken) statements.push(db().prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(learnerToken)));
    if (previousAdmin) statements.push(db().prepare('DELETE FROM admin_sessions WHERE token_hash=?').bind(await hash(previousAdmin)));
    await db().batch(statements);
    const response = NextResponse.json({ returnTo: safeReturnTo(body.returnTo) });
    response.cookies.set(ADMIN_COOKIE, token, { httpOnly: true, secure: isSecureRequest(request), sameSite: 'strict', path: '/', expires });
    response.cookies.delete('primark_session');
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) { console.error('Admin sign-in failed', error); return NextResponse.json({ error: 'Sign-in is temporarily unavailable.' }, { status: 503 }); }
}
