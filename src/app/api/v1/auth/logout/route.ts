import { NextResponse } from 'next/server';

import { destroySession, getSessionFromRequest } from '@/lib/auth/session';
import { getOrCreateRequestId } from '@/lib/http/request-id';

export async function POST(request: Request) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));

  const session = await getSessionFromRequest(request);
  if (session) await destroySession(session.id);

  const res = new NextResponse(null, { status: 204, headers: { 'X-Request-ID': requestId } });
  res.cookies.set({
    name: 'session',
    value: '',
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires: new Date(0),
  });
  return res;
}
