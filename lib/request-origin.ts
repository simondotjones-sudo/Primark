import type { NextRequest } from 'next/server';

// Next.js can retain the first request's hostname in a warm Netlify handler.
// Use the current request's Host, never a client-supplied X-Forwarded-Host.
export function publicRequestOrigin(request: NextRequest): string | null {
  const host = request.headers.get('host') || request.nextUrl.host;
  const forwardedProtocol = request.headers.get('x-forwarded-proto');
  const protocol = forwardedProtocol === 'https' || forwardedProtocol === 'http'
    ? `${forwardedProtocol}:` : request.nextUrl.protocol;
  if (!['http:', 'https:'].includes(protocol) || /[\s,/@\\?#]/.test(host)) return null;
  try {
    return new URL(`${protocol}//${host}`).origin;
  } catch {
    return null;
  }
}

export function sameOrigin(request: NextRequest) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = request.headers.get('origin');
  return !origin || origin === publicRequestOrigin(request);
}

export function isSecureRequest(request: NextRequest) {
  return publicRequestOrigin(request)?.startsWith('https://') ?? false;
}
