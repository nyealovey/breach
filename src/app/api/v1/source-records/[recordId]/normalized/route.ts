import { requireUser } from '@/lib/auth/require-user';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { fail, ok } from '@/lib/http/response';

export async function GET(request: Request, context: { params: Promise<{ recordId: string }> }) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const { recordId } = await context.params;

  const record = await prisma.sourceRecord.findFirst({
    where: { id: recordId },
    orderBy: { collectedAt: 'desc' },
    select: {
      id: true,
      collectedAt: true,
      runId: true,
      sourceId: true,
      assetUuid: true,
      externalKind: true,
      externalId: true,
      normalized: true,
    },
  });

  if (!record) {
    return fail(
      {
        code: ErrorCode.CONFIG_SOURCE_RECORD_NOT_FOUND,
        category: 'config',
        message: 'Source record not found',
        retryable: false,
      },
      404,
      { requestId: auth.requestId },
    );
  }

  return ok(
    {
      normalizedPayload: record.normalized,
      meta: {
        recordId: record.id,
        assetUuid: record.assetUuid,
        collectedAt: record.collectedAt.toISOString(),
        runId: record.runId,
        sourceId: record.sourceId,
        externalKind: record.externalKind,
        externalId: record.externalId,
      },
    },
    { requestId: auth.requestId },
  );
}
