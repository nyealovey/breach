import { z } from 'zod/v4';

import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { fail, ok } from '@/lib/http/response';

const BodySchema = z.object({
  reason: z.string().optional(),
});

export async function POST(request: Request, context: { params: Promise<{ candidateId: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { candidateId } = await context.params;

  const candidate = await prisma.duplicateCandidate.findUnique({
    where: { id: candidateId },
    select: {
      id: true,
      status: true,
      assetUuidA: true,
      assetUuidB: true,
      ignoredAt: true,
      ignoreReason: true,
    },
  });

  if (!candidate) {
    return fail(
      {
        code: ErrorCode.CONFIG_DUPLICATE_CANDIDATE_NOT_FOUND,
        category: 'config',
        message: 'Duplicate candidate not found',
        retryable: false,
      },
      404,
      { requestId: auth.requestId },
    );
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return fail(
      { code: ErrorCode.CONFIG_INVALID_REQUEST, category: 'config', message: 'Validation failed', retryable: false },
      400,
      { requestId: auth.requestId },
    );
  }

  const ignoreReason = body.reason?.trim() ? body.reason.trim() : null;

  // Idempotency: ignored is terminal; keep original ignore fields and do not create duplicate audit events.
  if (candidate.status !== 'open') {
    return ok(
      {
        candidateId: candidate.id,
        status: candidate.status,
        ignoredAt: candidate.ignoredAt ? candidate.ignoredAt.toISOString() : null,
        ignoreReason: candidate.ignoreReason ?? null,
      },
      { requestId: auth.requestId },
    );
  }

  const now = new Date();
  const updated = await prisma.duplicateCandidate.updateMany({
    where: { id: candidate.id, status: 'open' },
    data: {
      status: 'ignored',
      ignoredByUserId: auth.session.user.id,
      ignoredAt: now,
      ignoreReason,
    },
  });

  if (updated.count === 1) {
    await prisma.auditEvent.create({
      data: {
        eventType: 'duplicate_candidate.ignored',
        actorUserId: auth.session.user.id,
        payload: {
          candidateId: candidate.id,
          assetUuidA: candidate.assetUuidA,
          assetUuidB: candidate.assetUuidB,
          ignoreReason,
          requestId: auth.requestId,
        },
      },
    });
  }

  return ok(
    {
      candidateId: candidate.id,
      status: 'ignored',
      ignoredAt: now.toISOString(),
      ignoreReason,
    },
    { requestId: auth.requestId },
  );
}
