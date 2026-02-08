import { NextResponse } from 'next/server';

import { logEvent } from '@/lib/logging/logger';

import type { NextRequest } from 'next/server';

const SESSION_COOKIE_NAME = 'session';

function getOrCreateRequestId(request: NextRequest) {
  const input = request.headers.get('x-request-id');
  return input && input.trim().length > 0 ? input : `req_${crypto.randomUUID()}`;
}

function isAllowedPath(pathname: string) {
  if (pathname === '/login') return true;
  if (pathname.startsWith('/api/v1/auth/')) return true;
  return false;
}

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

function isApiPath(pathname: string) {
  return pathname.startsWith('/api/');
}

export function middleware(request: NextRequest) {
  const start = Date.now();
  const { pathname } = request.nextUrl;
  const requestId = getOrCreateRequestId(request);

  if (isAllowedPath(pathname)) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-request-id', requestId);

    const res = NextResponse.next({ request: { headers: requestHeaders } });
    res.headers.set('X-Request-ID', requestId);

    logEvent({
      level: 'info',
      service: 'web',
      event_type: 'http.middleware',
      request_id: requestId,
      middleware_action: 'pass',
      http: { method: request.method, path: pathname },
      duration_ms: Date.now() - start,
      outcome: 'success',
    });

    return res;
  }

  if (hasValidSessionCookie(request)) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-request-id', requestId);

    const res = NextResponse.next({ request: { headers: requestHeaders } });
    res.headers.set('X-Request-ID', requestId);

    logEvent({
      level: 'info',
      service: 'web',
      event_type: 'http.middleware',
      request_id: requestId,
      middleware_action: 'pass',
      http: { method: request.method, path: pathname },
      duration_ms: Date.now() - start,
      outcome: 'success',
    });

    return res;
  }

  if (isApiPath(pathname)) {
    const res = NextResponse.json(
      {
        error: { code: 'AUTH_UNAUTHORIZED', category: 'auth', message: 'Not authenticated', retryable: false },
        meta: { requestId, timestamp: new Date().toISOString() },
      },
      { status: 401 },
    );
    res.headers.set('X-Request-ID', requestId);

    logEvent({
      level: 'error',
      service: 'web',
      event_type: 'http.request',
      request_id: requestId,
      http: { method: request.method, path: pathname, status_code: 401 },
      duration_ms: Date.now() - start,
      outcome: 'error',
      error: { code: 'AUTH_UNAUTHORIZED', category: 'auth', message: 'Not authenticated', retryable: false },
    });

    return res;
  }

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  const res = NextResponse.redirect(url);
  res.headers.set('X-Request-ID', requestId);

  logEvent({
    level: 'info',
    service: 'web',
    event_type: 'http.request',
    request_id: requestId,
    http: { method: request.method, path: pathname, status_code: res.status },
    duration_ms: Date.now() - start,
    outcome: 'success',
  });

  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
};
