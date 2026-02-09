'use server';

import { cookies } from 'next/headers';

import { getSessionCookieName } from '@/lib/auth/session';

type ApiErrorBody = { error?: { message?: unknown } };

export async function buildInternalRequest(
  url: string,
  init: { method: string; json?: unknown; headers?: HeadersInit } = { method: 'GET' },
): Promise<Request> {
  const headers = new Headers(init.headers);

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(getSessionCookieName())?.value;
  if (sessionCookie) headers.set('cookie', `${getSessionCookieName()}=${sessionCookie}`);

  let body: string | undefined;
  if (init.json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(init.json);
  }

  return new Request(url, { method: init.method, headers, body });
}

export async function readInternalErrorMessage(res: Response, fallback: string): Promise<string> {
  if (res.status === 204) return fallback;

  const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
  const msg = body?.error?.message;
  return typeof msg === 'string' && msg.trim().length > 0 ? msg : fallback;
}
