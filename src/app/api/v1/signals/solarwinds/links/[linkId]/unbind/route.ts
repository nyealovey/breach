import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { fail, ok } from '@/lib/http/response';
import { Prisma } from '@prisma/client';

export async function POST(request: Request, context: { params: Promise<{ linkId: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { linkId } = await context.params;

  const link = await prisma.assetSignalLink.findUnique({
    where: { id: linkId },
    include: { source: { select: { sourceType: true } } },
  });
  if (!link || link.source.sourceType !== 'solarwinds') {
    return fail(
      {
        code: ErrorCode.CONFIG_SIGNAL_LINK_NOT_FOUND,
        category: 'config',
        message: 'Signal link not found',
        retryable: false,
      },
      404,
      { requestId: auth.requestId },
    );
  }

  const prevAssetUuid = link.assetUuid;

  const updated = await prisma.assetSignalLink.update({
    where: { id: linkId },
    data: {
      assetUuid: null,
      matchType: null,
      matchConfidence: null,
      matchReason: null,
      ambiguous: false,
      ambiguousCandidates: Prisma.DbNull,
    },
    select: { id: true, assetUuid: true },
  });

  if (prevAssetUuid) {
    const remaining = await prisma.assetSignalLink.count({
      where: { assetUuid: prevAssetUuid, source: { sourceType: 'solarwinds', deletedAt: null } },
    });
    if (remaining === 0) {
      await prisma.assetOperationalState.upsert({
        where: { assetUuid: prevAssetUuid },
        update: {
          monitorCovered: null,
          monitorState: null,
          monitorStatus: null,
          monitorUpdatedAt: null,
        },
        create: {
          asset: { connect: { uuid: prevAssetUuid } },
          monitorCovered: null,
          monitorState: null,
          monitorStatus: null,
          monitorUpdatedAt: null,
        },
      });
    }
  }

  return ok({ linkId: updated.id, assetUuid: updated.assetUuid }, { requestId: auth.requestId });
}
