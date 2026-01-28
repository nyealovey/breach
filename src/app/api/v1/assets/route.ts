import { requireAdmin } from '@/lib/auth/require-admin';
import { parseAssetListQuery, buildAssetListWhere } from '@/lib/assets/asset-list-query';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { buildPagination, parsePagination } from '@/lib/http/pagination';
import { fail, okPaginated } from '@/lib/http/response';

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(url.searchParams);
  const query = parseAssetListQuery(url.searchParams);
  const where = buildAssetListWhere(query);

  try {
    const totalPromise = prisma.asset.count({ where });
    const itemsPromise = prisma.asset.findMany({
      where,
      orderBy: [{ displayName: 'asc' }, { createdAt: 'desc' }],
      skip,
      take,
      include: {
        sourceLinks: {
          include: {
            source: { select: { id: true, name: true } },
          },
        },
      },
    });

    const [total, items] = await prisma.$transaction([totalPromise, itemsPromise]);

    const data = items.map((asset) => {
      const sources = new Map<string, { sourceId: string; name: string }>();
      for (const link of asset.sourceLinks) {
        if (link.source) sources.set(link.source.id, { sourceId: link.source.id, name: link.source.name });
      }

      return {
        assetUuid: asset.uuid,
        assetType: asset.assetType,
        status: asset.status,
        displayName: asset.displayName,
        lastSeenAt: asset.lastSeenAt?.toISOString() ?? null,
        sources: Array.from(sources.values()),
      };
    });

    return okPaginated(data, buildPagination(total, page, pageSize), { requestId: auth.requestId });
  } catch {
    return fail(
      { code: ErrorCode.DB_READ_FAILED, category: 'db', message: 'Failed to load assets', retryable: false },
      500,
      { requestId: auth.requestId },
    );
  }
}
