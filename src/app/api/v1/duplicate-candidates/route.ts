import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { buildPagination, parsePagination } from '@/lib/http/pagination';
import { fail, okPaginated } from '@/lib/http/response';

function parseStatus(input: string | null): 'open' | 'ignored' | 'merged' | undefined {
  if (input === 'open' || input === 'ignored' || input === 'merged') return input;
  return undefined;
}

function parseAssetType(input: string | null): 'vm' | 'host' | undefined {
  if (input === 'vm' || input === 'host') return input;
  return undefined;
}

function parseConfidence(input: string | null): 'High' | 'Medium' | undefined {
  if (input === 'High' || input === 'Medium') return input;
  return undefined;
}

function confidenceLabel(score: number): 'High' | 'Medium' {
  return score >= 90 ? 'High' : 'Medium';
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(url.searchParams);

  const status = parseStatus(url.searchParams.get('status')) ?? 'open';
  const assetType = parseAssetType(url.searchParams.get('assetType'));
  const confidence = parseConfidence(url.searchParams.get('confidence'));

  const where: Record<string, unknown> = { status };
  if (assetType) {
    where.assetA = { assetType };
  }
  if (confidence === 'High') {
    where.score = { gte: 90 };
  } else if (confidence === 'Medium') {
    where.score = { gte: 70, lt: 90 };
  }

  try {
    const totalPromise = prisma.duplicateCandidate.count({ where } as any);
    const itemsPromise = prisma.duplicateCandidate.findMany({
      where: where as any,
      orderBy: [{ lastObservedAt: 'desc' }, { score: 'desc' }],
      skip,
      take,
      include: {
        assetA: { select: { uuid: true, displayName: true, assetType: true, status: true, lastSeenAt: true } },
        assetB: { select: { uuid: true, displayName: true, assetType: true, status: true, lastSeenAt: true } },
      },
    });

    const [total, items] = await prisma.$transaction([totalPromise, itemsPromise]);

    const data = items.map((c: any) => ({
      candidateId: c.id,
      status: c.status,
      score: c.score,
      confidence: confidenceLabel(c.score),
      lastObservedAt: c.lastObservedAt.toISOString(),
      assetA: {
        assetUuid: c.assetA.uuid,
        assetType: c.assetA.assetType,
        status: c.assetA.status,
        displayName: c.assetA.displayName ?? null,
        lastSeenAt: c.assetA.lastSeenAt ? c.assetA.lastSeenAt.toISOString() : null,
      },
      assetB: {
        assetUuid: c.assetB.uuid,
        assetType: c.assetB.assetType,
        status: c.assetB.status,
        displayName: c.assetB.displayName ?? null,
        lastSeenAt: c.assetB.lastSeenAt ? c.assetB.lastSeenAt.toISOString() : null,
      },
    }));

    return okPaginated(data, buildPagination(total as any, page, pageSize), { requestId: auth.requestId });
  } catch {
    return fail(
      {
        code: ErrorCode.DB_READ_FAILED,
        category: 'db',
        message: 'Failed to load duplicate candidates',
        retryable: false,
      },
      500,
      { requestId: auth.requestId },
    );
  }
}
