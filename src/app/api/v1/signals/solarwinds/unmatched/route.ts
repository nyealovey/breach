import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { buildPagination, parsePagination } from '@/lib/http/pagination';
import { okPaginated } from '@/lib/http/response';

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(url.searchParams);

  const where = {
    assetUuid: null,
    ambiguous: false,
    // Exclude manual links even if inconsistent DB state leaves assetUuid null.
    NOT: { matchType: 'manual' as const },
    source: { sourceType: 'solarwinds' as const, deletedAt: null },
  };

  const totalPromise = prisma.assetSignalLink.count({ where });
  const itemsPromise = prisma.assetSignalLink.findMany({
    where,
    orderBy: { lastSeenAt: 'desc' },
    skip,
    take,
    include: { source: { select: { name: true } } },
  });

  const [total, items] = await prisma.$transaction([totalPromise, itemsPromise]);

  const data = items.map((l) => ({
    linkId: l.id,
    sourceId: l.sourceId,
    sourceName: l.source.name,
    externalKind: l.externalKind,
    externalId: l.externalId,
    firstSeenAt: l.firstSeenAt.toISOString(),
    lastSeenAt: l.lastSeenAt.toISOString(),
    matchEvidence: l.matchEvidence,
  }));

  return okPaginated(data, buildPagination(total, page, pageSize), { requestId: auth.requestId });
}
