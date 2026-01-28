import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { fail, ok } from '@/lib/http/response';

export async function GET(request: Request, context: { params: Promise<{ uuid: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { uuid } = await context.params;

  const asset = await prisma.asset.findUnique({
    where: { uuid },
    select: { uuid: true, assetType: true, status: true, displayName: true, lastSeenAt: true },
  });
  if (!asset) {
    return fail(
      { code: ErrorCode.CONFIG_ASSET_NOT_FOUND, category: 'config', message: 'Asset not found', retryable: false },
      404,
      { requestId: auth.requestId },
    );
  }

  const snapshot = await prisma.assetRunSnapshot.findFirst({
    where: { assetUuid: uuid },
    orderBy: { createdAt: 'desc' },
    select: { runId: true, canonical: true, createdAt: true },
  });

  return ok(
    {
      assetUuid: asset.uuid,
      assetType: asset.assetType,
      status: asset.status,
      displayName: asset.displayName,
      lastSeenAt: asset.lastSeenAt?.toISOString() ?? null,
      latestSnapshot: snapshot
        ? { runId: snapshot.runId, createdAt: snapshot.createdAt.toISOString(), canonical: snapshot.canonical }
        : null,
    },
    { requestId: auth.requestId },
  );
}
