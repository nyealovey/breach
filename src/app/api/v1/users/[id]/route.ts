import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { fail, ok } from '@/lib/http/response';

function userNotFound(requestId?: string) {
  return fail(
    { code: ErrorCode.CONFIG_INVALID_REQUEST, category: 'config', message: 'User not found', retryable: false },
    404,
    { requestId },
  );
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const requestId = auth.requestId;

  if (id === auth.session.user.id) {
    return fail(
      {
        code: ErrorCode.CONFIG_INVALID_REQUEST,
        category: 'config',
        message: 'Cannot delete current user',
        retryable: false,
      },
      400,
      { requestId },
    );
  }

  const existing = await prisma.user.findUnique({
    where: { id },
    select: { id: true, username: true, deletedAt: true },
  });
  if (!existing || existing.deletedAt) return userNotFound(requestId);

  if (existing.username === 'admin') {
    return fail(
      {
        code: ErrorCode.CONFIG_INVALID_REQUEST,
        category: 'config',
        message: 'admin user is protected',
        retryable: false,
      },
      400,
      { requestId },
    );
  }

  const tombstoneUsername = `deleted:${existing.id}:${existing.username}`;

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: existing.id },
      data: {
        deletedAt: new Date(),
        enabled: false,
        externalAuthId: null,
        passwordHash: null,
        username: tombstoneUsername,
      },
    });

    await tx.session.deleteMany({ where: { userId: existing.id } });
  });

  return ok({ message: 'User deleted' }, { requestId });
}
