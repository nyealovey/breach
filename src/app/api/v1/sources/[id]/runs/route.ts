import { z } from 'zod/v4';

import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { created, fail, ok } from '@/lib/http/response';

const BodySchema = z.object({
  mode: z.enum(['collect', 'collect_hosts', 'collect_vms', 'detect', 'healthcheck']),
});

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function hasExplicitCollectScope(config: unknown): boolean {
  if (!isRecord(config)) return false;
  const scope = (config as Record<string, unknown>).scope;
  return scope === 'standalone' || scope === 'cluster';
}

function getHypervConnectionMethod(config: unknown): 'agent' | 'winrm' {
  if (!isRecord(config)) return 'winrm';
  return (config as Record<string, unknown>).connection_method === 'agent' ? 'agent' : 'winrm';
}

function hasExplicitHypervAuthMethod(config: unknown): boolean {
  if (!isRecord(config)) return false;
  const auth = (config as Record<string, unknown>).auth_method;
  return auth === 'kerberos' || auth === 'ntlm' || auth === 'basic';
}

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

  const isCollectMode = body.mode === 'collect' || body.mode === 'collect_hosts' || body.mode === 'collect_vms';
  if (isCollectMode && source.sourceType === 'vcenter') {
    const preferred =
      source.config && typeof source.config === 'object' && !Array.isArray(source.config)
        ? (source.config as Record<string, unknown>).preferred_vcenter_version
        : undefined;
    if (preferred !== '6.5-6.7' && preferred !== '7.0-8.x') {
      return fail(
        {
          code: ErrorCode.CONFIG_INVALID_REQUEST,
          category: 'config',
          message: 'preferred_vcenter_version is required for vcenter collect runs',
          retryable: false,
        },
        400,
        { requestId: auth.requestId },
      );
    }
  }

  if (body.mode === 'collect' && source.sourceType === 'pve') {
    if (!hasExplicitCollectScope(source.config)) {
      return fail(
        {
          code: ErrorCode.CONFIG_INVALID_REQUEST,
          category: 'config',
          message: 'scope is required for pve collect runs (standalone|cluster)',
          retryable: false,
        },
        400,
        { requestId: auth.requestId },
      );
    }
  }

  if (body.mode === 'collect' && source.sourceType === 'hyperv') {
    if (!hasExplicitCollectScope(source.config)) {
      return fail(
        {
          code: ErrorCode.CONFIG_INVALID_REQUEST,
          category: 'config',
          message: 'scope is required for hyperv collect runs (standalone|cluster)',
          retryable: false,
        },
        400,
        { requestId: auth.requestId },
      );
    }

    if (getHypervConnectionMethod(source.config) !== 'agent' && !hasExplicitHypervAuthMethod(source.config)) {
      return fail(
        {
          code: ErrorCode.CONFIG_INVALID_REQUEST,
          category: 'config',
          message: 'auth_method is required for hyperv winrm collect runs (kerberos|ntlm|basic)',
          retryable: false,
        },
        400,
        { requestId: auth.requestId },
      );
    }
  }

  const active = await prisma.run.findFirst({
    where: { sourceId: id, status: { in: ['Queued', 'Running'] }, mode: body.mode },
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
