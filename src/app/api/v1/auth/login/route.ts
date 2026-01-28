import { z } from 'zod/v4';

import { bootstrapAdmin } from '@/lib/auth/bootstrap-admin';
import { createSession } from '@/lib/auth/session';
import { verifyPassword } from '@/lib/auth/password';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { fail, ok } from '@/lib/http/response';

const LoginBodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  const requestId = request.headers.get('x-request-id') ?? undefined;

  let parsed: z.infer<typeof LoginBodySchema>;
  try {
    parsed = LoginBodySchema.parse(await request.json());
  } catch {
    return fail(
      { code: ErrorCode.CONFIG_INVALID_REQUEST, category: 'config', message: 'Validation failed', retryable: false },
      400,
      { requestId },
    );
  }

  if (parsed.username !== 'admin') {
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

  await bootstrapAdmin();

  const user = await prisma.user.findUnique({ where: { username: 'admin' } });
  if (!user) {
    return fail(
      { code: ErrorCode.INTERNAL_ERROR, category: 'unknown', message: 'Internal error', retryable: false },
      500,
      { requestId },
    );
  }

  const okPw = await verifyPassword(parsed.password, user.passwordHash);
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

  const session = await createSession(user.id);

  const res = ok({ userId: user.id, username: user.username, role: user.role }, { requestId });
  res.cookies.set({
    name: 'session',
    value: session.cookieValue,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: session.expiresAt,
  });
  return res;
}
