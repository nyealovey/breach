import { createHmac, timingSafeEqual } from 'node:crypto';

import { prisma } from '@/lib/db/prisma';
import { serverEnv } from '@/lib/env/server';

const SESSION_COOKIE_NAME = 'session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // MVP: 7 days

function parseCookieHeader(header: string | null): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const [rawName, ...rest] = part.trim().split('=');
    if (!rawName) continue;
    out[rawName] = decodeURIComponent(rest.join('='));
  }
  return out;
}

function signSessionToken(input: string) {
  const secret = serverEnv.SECRET_KEY;
  if (!secret) return null;
  return createHmac('sha256', secret).update(input).digest('base64url');
}

function safeEqual(a: string, b: string) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function decodeCookieValue(cookieValue: string): { sessionId: string; expiresAtMs?: number } | null {
  // v1:<sessionId>:<expiresMs>:<sig>
  if (cookieValue.startsWith('v1:')) {
    const [, sessionId, expiresMsRaw, sig] = cookieValue.split(':');
    if (!sessionId || !expiresMsRaw || !sig) return null;

    const expiresAtMs = Number(expiresMsRaw);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= 0) return null;

    const expected = signSessionToken(`${sessionId}.${expiresAtMs}`);
    if (!expected) return null;
    if (!safeEqual(sig, expected)) return null;

    return { sessionId, expiresAtMs };
  }

  // Legacy / dev mode (unsigned).
  return cookieValue.trim().length > 0 ? { sessionId: cookieValue.trim() } : null;
}

export function getSessionCookieName() {
  return SESSION_COOKIE_NAME;
}

export function getDefaultSessionTtlMs() {
  return SESSION_TTL_MS;
}

export async function createSession(userId: string) {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const session = await prisma.session.create({ data: { userId, expiresAt } });

  const sig = signSessionToken(`${session.id}.${expiresAt.getTime()}`);
  const cookieValue = sig ? `v1:${session.id}:${expiresAt.getTime()}:${sig}` : session.id;

  return { sessionId: session.id, cookieValue, expiresAt };
}

export async function destroySession(sessionId: string) {
  await prisma.session.deleteMany({ where: { id: sessionId } });
}

export async function getSessionFromRequest(req: Request) {
  const cookies = parseCookieHeader(req.headers.get('cookie'));
  const cookieValue = cookies[SESSION_COOKIE_NAME];
  if (!cookieValue) return null;

  const decoded = decodeCookieValue(cookieValue);
  if (!decoded) return null;

  if (decoded.expiresAtMs && decoded.expiresAtMs <= Date.now()) return null;

  const session = await prisma.session.findUnique({
    where: { id: decoded.sessionId },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;

  return session;
}

export function parseSessionCookieValue(cookieValue: string) {
  return decodeCookieValue(cookieValue);
}
