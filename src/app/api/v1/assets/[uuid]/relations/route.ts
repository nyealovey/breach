import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { fail, ok } from '@/lib/http/response';

export async function GET(request: Request, context: { params: Promise<{ uuid: string }> }) {
  const auth = await requireAdmin(request);
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

  const relations = await prisma.relation.findMany({
    where: { fromAssetUuid: uuid, status: 'active' },
    orderBy: { lastSeenAt: 'desc' },
    take: 200,
    include: { toAsset: { select: { uuid: true, assetType: true, displayName: true } } },
  });

  return ok(
    relations.map((r) => ({
      relationId: r.id,
      relationType: r.relationType,
      toAssetUuid: r.toAssetUuid,
      toAssetType: r.toAsset?.assetType ?? null,
      toDisplayName: r.toAsset?.displayName ?? null,
      sourceId: r.sourceId,
      lastSeenAt: r.lastSeenAt.toISOString(),
    })),
    { requestId: auth.requestId },
  );
}
