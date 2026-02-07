import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { buildPagination, parsePagination } from '@/lib/http/pagination';
import { okPaginated } from '@/lib/http/response';

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(url.searchParams);
  const sourceId = (url.searchParams.get('sourceId') ?? '').trim();

  const where = sourceId ? { sourceId } : {};

  const [total, rows] = await prisma.$transaction([
    prisma.directoryDomain.count({ where }),
    prisma.directoryDomain.findMany({
      where,
      orderBy: [{ collectedAt: 'desc' }],
      skip,
      take,
      include: {
        source: { select: { id: true, name: true } },
      },
    }),
  ]);

  return okPaginated(
    rows.map((row) => ({
      domainId: row.id,
      sourceId: row.sourceId,
      sourceName: row.source.name,
      runId: row.runId,
      domainDn: row.domainDn,
      dnsRoot: row.dnsRoot,
      netbiosName: row.netbiosName,
      objectGuid: row.objectGuid,
      collectedAt: row.collectedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    })),
    buildPagination(total, page, pageSize),
    { requestId: auth.requestId },
  );
}
