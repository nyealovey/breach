import { requireUser } from '@/lib/auth/require-user';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { fail, ok } from '@/lib/http/response';

export async function GET(request: Request, context: { params: Promise<{ uuid: string }> }) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const { uuid } = await context.params;

  const asset = await prisma.asset.findUnique({ where: { uuid }, select: { uuid: true } });
  if (!asset) {
    return fail(
      { code: ErrorCode.CONFIG_ASSET_NOT_FOUND, category: 'config', message: 'Asset not found', retryable: false },
      404,
      { requestId: auth.requestId },
    );
  }

  const records = await prisma.sourceRecord.findMany({
    where: { assetUuid: uuid },
    orderBy: { collectedAt: 'desc' },
    take: 200,
    select: {
      id: true,
      collectedAt: true,
      runId: true,
      sourceId: true,
      externalKind: true,
      externalId: true,
      normalized: true,
    },
  });

  return ok(
    records.map((r) => ({
      recordId: r.id,
      collectedAt: r.collectedAt.toISOString(),
      runId: r.runId,
      sourceId: r.sourceId,
      externalKind: r.externalKind,
      externalId: r.externalId,
      normalized: r.normalized,
    })),
    { requestId: auth.requestId },
  );
}
