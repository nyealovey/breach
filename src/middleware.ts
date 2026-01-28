import { NextResponse, type NextRequest } from 'next/server';

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
  const { pathname } = request.nextUrl;

  if (isAllowedPath(pathname)) return NextResponse.next();

  if (hasSessionCookie(request)) return NextResponse.next();

  const requestId = getOrCreateRequestId(request);

  if (isApiPath(pathname)) {
    const res = NextResponse.json(
      {
        error: { code: 'AUTH_UNAUTHORIZED', category: 'auth', message: 'Not authenticated', retryable: false },
        meta: { requestId, timestamp: new Date().toISOString() },
      },
      { status: 401 },
    );
    res.headers.set('X-Request-ID', requestId);
    return res;
  }

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

