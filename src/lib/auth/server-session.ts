import { cookies } from 'next/headers';
import { cache } from 'react';

import { prisma } from '@/lib/db/prisma';
import { parseSessionCookieValue } from '@/lib/auth/session';

export const getServerSession = cache(async () => {
  const cookieValue = (await cookies()).get('session')?.value ?? null;
  if (!cookieValue) return null;

  const decoded = parseSessionCookieValue(cookieValue);
  if (!decoded) return null;
  if (decoded.expiresAtMs && decoded.expiresAtMs <= Date.now()) return null;

  const session = await prisma.session.findUnique({
    where: { id: decoded.sessionId },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;

  return session;
});
