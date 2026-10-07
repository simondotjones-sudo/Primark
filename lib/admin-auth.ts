import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createHash, timingSafeEqual } from 'node:crypto';
import { db } from '@/lib/database';
import { runtimeEnv } from '@/lib/runtime-env';

export const ADMIN_COOKIE = 'primark_admin';
export function credentials() {
  const email = runtimeEnv('PRIMARK_ADMIN_EMAIL').trim().toLowerCase();
  const password = runtimeEnv('PRIMARK_ADMIN_PASSWORD');
  return email && password.length >= 16 ? { email, password } : null;
}
export function credentialFingerprint() {
  const value = credentials();
  return value ? createHash('sha256').update(JSON.stringify(value)).digest('hex') : '';
}
export function passwordMatches(email: string, password: string) {
  const configured = credentials();
  if (!configured) return false;
  const hash = (value: string) => createHash('sha256').update(value).digest();
  const correctPassword = timingSafeEqual(hash(password), hash(configured.password));
  return email.toLowerCase() === configured.email && correctPassword;
}
export async function getAdminUser() {
  const jar = await cookies();
  // Fail closed for browsers with both cookies from before session separation.
  if (jar.get('primark_session')?.value) return null;
  const token = jar.get(ADMIN_COOKIE)?.value;
  if (!token || !credentials()) return null;
  const row = await db().prepare('SELECT email FROM admin_sessions WHERE token_hash=? AND credential_hash=? AND expires_at>?')
    .bind(createHash('sha256').update(token).digest('hex'), credentialFingerprint(), new Date().toISOString()).first<{ email: string }>();
  return row && row.email === credentials()!.email ? row : null;
}
export async function requireAdminUser(returnTo: string) {
  const user = await getAdminUser();
  if (user) return user;
  redirect(`/admin/sign-in?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`);
}
export function safeReturnTo(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/admin/courses';
  const url = new URL(value, 'https://local.invalid');
  return url.origin === 'https://local.invalid' && !url.pathname.startsWith('/admin/sign-in') ? url.pathname + url.search : '/admin/courses';
}
export async function allowLoginAttempt(key: string, maximum = 10) {
  const date = new Date().toISOString(), expires = new Date(Date.now() + 15 * 60000).toISOString();
  const id = createHash('sha256').update(key).digest('hex');
  const row = await db().prepare(`INSERT INTO auth_limits(key,attempts,expires_at) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN auth_limits.expires_at<? THEN 1 ELSE auth_limits.attempts+1 END,
    expires_at=CASE WHEN auth_limits.expires_at<? THEN excluded.expires_at ELSE auth_limits.expires_at END RETURNING attempts`)
    .bind(id, expires, date, date).first<{ attempts: number }>();
  return !!row && row.attempts <= maximum;
}
