import type { DupRulesV1Match } from '@/lib/duplicate-candidates/dup-rules-v1';

type DuplicateCandidateRow = { id: string; status: 'open' | 'ignored' | 'merged' };

type PrismaLike = {
  duplicateCandidate: {
    findUnique: (args: any) => PromiseLike<DuplicateCandidateRow | null>;
    create: (args: any) => PromiseLike<{ id: string }>;
    update: (args: any) => PromiseLike<{ id: string }>;
  };
};

function normalizePair(a: string, b: string): { a: string; b: string } {
  return a < b ? { a, b } : { a: b, b: a };
}

export async function upsertDuplicateCandidate(args: {
  prisma: PrismaLike;
  observedAt: Date;
  assetUuidA: string;
  assetUuidB: string;
  score: number;
  reasons: DupRulesV1Match[];
}): Promise<{ action: 'created' | 'updated_open' | 'bumped_terminal'; candidateId: string }> {
  const pair = normalizePair(args.assetUuidA, args.assetUuidB);

  const existing = await args.prisma.duplicateCandidate.findUnique({
    where: { assetUuidA_assetUuidB: { assetUuidA: pair.a, assetUuidB: pair.b } },
    select: { id: true, status: true },
  });

  const reasonsJson = { version: 'dup-rules-v1', matched_rules: args.reasons };

  if (!existing) {
    const created = await args.prisma.duplicateCandidate.create({
      data: {
        assetUuidA: pair.a,
        assetUuidB: pair.b,
        score: args.score,
        reasons: reasonsJson,
        status: 'open',
        lastObservedAt: args.observedAt,
      },
      select: { id: true },
    });
    return { action: 'created', candidateId: created.id };
  }

  if (existing.status === 'open') {
    const updated = await args.prisma.duplicateCandidate.update({
      where: { id: existing.id },
      data: {
        score: args.score,
        reasons: reasonsJson,
        lastObservedAt: args.observedAt,
      },
      select: { id: true },
    });
    return { action: 'updated_open', candidateId: updated.id };
  }

  const bumped = await args.prisma.duplicateCandidate.update({
    where: { id: existing.id },
    data: { lastObservedAt: args.observedAt },
    select: { id: true },
  });
  return { action: 'bumped_terminal', candidateId: bumped.id };
}
