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
    ambiguous: true,
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
    candidates: l.ambiguousCandidates,
  }));

  return okPaginated(data, buildPagination(total, page, pageSize), { requestId: auth.requestId });
}
