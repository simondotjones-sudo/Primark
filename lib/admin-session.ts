import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_COOKIE, sessionCredentialFingerprint, credentials, safeReturnTo } from '@/lib/admin-auth';
import { db, hash, randomToken, now } from '@/lib/server';
import { isSecureRequest } from '@/lib/request-origin';

// Call only after checking the configured admin password and rate limit.
export async function createAdminSession(request: NextRequest, returnTo: unknown) {
  const token = randomToken(), expires = new Date(Date.now() + 8 * 3600000);
  const fingerprint = await sessionCredentialFingerprint();
  const statements = [
    db().prepare('DELETE FROM admin_sessions WHERE expires_at<? OR credential_hash<>?').bind(now(), fingerprint),
    db().prepare('INSERT INTO admin_sessions(token_hash,email,credential_hash,expires_at) VALUES(?,?,?,?)').bind(await hash(token), credentials()!.email, fingerprint, expires.toISOString()),
  ];
  const learnerToken = request.cookies.get('primark_session')?.value;
  const previousAdmin = request.cookies.get(ADMIN_COOKIE)?.value;
  if (learnerToken) statements.push(db().prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(learnerToken)));
  if (previousAdmin) statements.push(db().prepare('DELETE FROM admin_sessions WHERE token_hash=?').bind(await hash(previousAdmin)));
  await db().batch(statements);
  const response = NextResponse.json({ ok: true, returnTo: safeReturnTo(returnTo) });
  response.cookies.set(ADMIN_COOKIE, token, { httpOnly: true, secure: isSecureRequest(request), sameSite: 'strict', path: '/', expires });
  response.cookies.delete('primark_session');
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
