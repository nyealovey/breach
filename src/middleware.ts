import { NextResponse } from 'next/server';

import { logEvent } from '@/lib/logging/logger';

import type { NextRequest } from 'next/server';

const AUTH_COOKIE = 'session';

function getOrCreateRequestId(request: NextRequest) {
  const input = request.headers.get('x-request-id');
  return input && input.trim().length > 0 ? input : `req_${crypto.randomUUID()}`;
}

function isAllowedPath(pathname: string) {
  if (pathname === '/login') return true;
  if (pathname.startsWith('/api/v1/auth/')) return true;
  return false;
}

function hasSessionCookie(request: NextRequest) {
  return request.cookies.get(AUTH_COOKIE)?.value?.trim().length ? true : false;
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
      event_type: 'http.request',
      request_id: requestId,
      http: { method: request.method, path: pathname, status_code: 200 },
      duration_ms: Date.now() - start,
      outcome: 'success',
    });

    return res;
  }

  if (hasSessionCookie(request)) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-request-id', requestId);

    const res = NextResponse.next({ request: { headers: requestHeaders } });
    res.headers.set('X-Request-ID', requestId);

    logEvent({
      level: 'info',
      service: 'web',
      event_type: 'http.request',
      request_id: requestId,
      http: { method: request.method, path: pathname, status_code: 200 },
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
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
