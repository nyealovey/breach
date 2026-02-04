import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const SESSION_COOKIE_NAME = 'session';

function hasValidSessionCookie(request: NextRequest) {
  const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? '';
  if (!cookieValue) return false;

  // Cookie format: v1:<sessionId>:<expiresMs>:<sig>
  // We can't verify the signature in Edge runtime, but we can at least
  // enforce the embedded expiry to avoid redirect loops for expired cookies.
  if (cookieValue.startsWith('v1:')) {
    const [, sessionId, expiresMsRaw] = cookieValue.split(':');
    if (!sessionId || !expiresMsRaw) return false;
    const expiresAtMs = Number(expiresMsRaw);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= 0) return false;
    return expiresAtMs > Date.now();
  }

  // Legacy/dev mode (unsigned).
  return cookieValue.trim().length > 0;
}

function isApiRoute(pathname: string) {
  return pathname.startsWith('/api/v1') || pathname === '/api/openapi.json';
}

function isPublicRoute(pathname: string) {
  return pathname === '/login';
}

export function proxy(request: NextRequest) {
  // Only redirect navigations; let non-GET requests pass through (e.g. form posts).
  if (request.method !== 'GET' && request.method !== 'HEAD') return NextResponse.next();

  const pathname = request.nextUrl.pathname;

  if (isApiRoute(pathname) || isPublicRoute(pathname)) return NextResponse.next();

  if (hasValidSessionCookie(request)) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  return NextResponse.redirect(url);
}

export const proxyConfig = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
};
