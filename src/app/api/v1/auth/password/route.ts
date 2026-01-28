import { z } from 'zod/v4';

import { createSession, destroySession, getSessionFromRequest } from '@/lib/auth/session';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { fail, ok } from '@/lib/http/response';

const BodySchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

export async function PUT(request: Request) {
  const requestId = request.headers.get('x-request-id') ?? undefined;

  const session = await getSessionFromRequest(request);
  if (!session) {
    return fail(
      { code: ErrorCode.AUTH_UNAUTHORIZED, category: 'auth', message: 'Not authenticated', retryable: false },
      401,
      { requestId },
    );
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return fail(
      { code: ErrorCode.CONFIG_INVALID_REQUEST, category: 'config', message: 'Validation failed', retryable: false },
      400,
      { requestId },
    );
  }

  const okPw = await verifyPassword(body.currentPassword, session.user.passwordHash);
  if (!okPw) {
    return fail(
      {
        code: ErrorCode.AUTH_INVALID_CREDENTIALS,
        category: 'auth',
        message: 'Invalid credentials',
        retryable: false,
      },
      401,
      { requestId },
    );
  }

  const newHash = await hashPassword(body.newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: session.user.id }, data: { passwordHash: newHash } });
    await tx.session.deleteMany({ where: { userId: session.user.id } });
  });

  // Create a fresh session after password rotation.
  const fresh = await createSession(session.user.id);
  await destroySession(session.id);

  const res = ok({ message: 'Password updated successfully' }, { requestId });
  res.cookies.set({
    name: 'session',
    value: fresh.cookieValue,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: fresh.expiresAt,
  });
  return res;
}
