import { z } from 'zod/v4';

import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { created, fail, ok } from '@/lib/http/response';

const BodySchema = z.object({
  mode: z.enum(['collect', 'healthcheck']),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;

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

  const source = await prisma.source.findFirst({ where: { id, deletedAt: null } });
  if (!source) {
    return fail(
      { code: ErrorCode.CONFIG_SOURCE_NOT_FOUND, category: 'config', message: 'Source not found', retryable: false },
      404,
      { requestId: auth.requestId },
    );
  }

  const active = await prisma.run.findFirst({
    where: { sourceId: id, status: { in: ['Queued', 'Running'] } },
    orderBy: { createdAt: 'desc' },
  });

  if (active) {
    await prisma.auditEvent.create({
      data: {
        eventType: 'run.trigger_suppressed',
        actorUserId: auth.session.user.id,
        payload: { sourceId: id, runId: active.id, requestId: auth.requestId },
      },
    });

    return ok(
      {
        runId: active.id,
        sourceId: active.sourceId,
        status: active.status,
        message: 'Active run already exists',
      },
      { requestId: auth.requestId },
    );
  }

  const run = await prisma.run.create({
    data: {
      sourceId: id,
      scheduleGroupId: source.scheduleGroupId,
      triggerType: 'manual',
      mode: body.mode,
      status: 'Queued',
    },
  });

  return created(
    {
      runId: run.id,
      sourceId: run.sourceId,
      mode: run.mode,
      triggerType: run.triggerType,
      status: run.status,
      createdAt: run.createdAt.toISOString(),
    },
    { requestId: auth.requestId },
  );
}
