import { z } from 'zod/v4';

import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { fail, ok } from '@/lib/http/response';

const BodySchema = z
  .object({
    role: z.enum(['admin', 'user']),
  })
  .strict();

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return fail(
      { code: ErrorCode.CONFIG_INVALID_REQUEST, category: 'config', message: 'Validation failed', retryable: false },
      400,
      { requestId: auth.requestId },
    );
  }

  const existing = await prisma.user.findUnique({
    where: { id },
    select: { id: true, username: true, deletedAt: true },
  });
  if (!existing || existing.deletedAt) {
    return fail(
      { code: ErrorCode.CONFIG_INVALID_REQUEST, category: 'config', message: 'User not found', retryable: false },
      404,
      { requestId: auth.requestId },
    );
  }

  if (existing.username === 'admin') {
    return fail(
      {
        code: ErrorCode.CONFIG_INVALID_REQUEST,
        category: 'config',
        message: 'admin user is protected',
        retryable: false,
      },
      400,
      { requestId: auth.requestId },
    );
  }

  try {
    const user = await prisma.user.update({ where: { id }, data: { role: body.role } });
    return ok(
      {
        userId: user.id,
        username: user.username,
        role: user.role,
        authType: user.authType,
        externalAuthId: user.externalAuthId,
        enabled: user.enabled,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      },
      { requestId: auth.requestId },
    );
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && (error as { code: string }).code === 'P2025') {
      return fail(
        { code: ErrorCode.CONFIG_INVALID_REQUEST, category: 'config', message: 'User not found', retryable: false },
        404,
        { requestId: auth.requestId },
      );
    }

    return fail(
      { code: ErrorCode.DB_WRITE_FAILED, category: 'db', message: 'Failed to update user role', retryable: false },
      500,
      { requestId: auth.requestId },
    );
  }
}
