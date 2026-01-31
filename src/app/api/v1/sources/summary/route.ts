import { requireUser } from '@/lib/auth/require-user';
import { prisma } from '@/lib/db/prisma';
import { ok } from '@/lib/http/response';

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const sources = await prisma.source.findMany({
    where: { enabled: true, deletedAt: null },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, sourceType: true, enabled: true },
  });

  return ok(
    sources.map((s) => ({ sourceId: s.id, name: s.name, sourceType: s.sourceType, enabled: s.enabled })),
    { requestId: auth.requestId },
  );
}
