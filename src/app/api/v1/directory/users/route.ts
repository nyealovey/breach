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
  const q = (url.searchParams.get('q') ?? '').trim();

  const where = {
    ...(sourceId ? { sourceId } : {}),
    ...(q
      ? {
          OR: [
            { upn: { contains: q, mode: 'insensitive' as const } },
            { samAccountName: { contains: q, mode: 'insensitive' as const } },
            { displayName: { contains: q, mode: 'insensitive' as const } },
            { dn: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [total, rows] = await prisma.$transaction([
    prisma.directoryUser.count({ where }),
    prisma.directoryUser.findMany({
      where,
      orderBy: [{ lastSeenAt: 'desc' }, { dn: 'asc' }],
      skip,
      take,
      include: {
        source: { select: { id: true, name: true } },
      },
    }),
  ]);

  return okPaginated(
    rows.map((row) => ({
      directoryUserId: row.id,
      sourceId: row.sourceId,
      sourceName: row.source.name,
      objectGuid: row.objectGuid,
      dn: row.dn,
      upn: row.upn,
      samAccountName: row.samAccountName,
      displayName: row.displayName,
      mail: row.mail,
      enabled: row.enabled,
      lastSeenAt: row.lastSeenAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    buildPagination(total, page, pageSize),
    { requestId: auth.requestId },
  );
}
