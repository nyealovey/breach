import { z } from 'zod/v4';

import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { getOrCreateRequestId } from '@/lib/http/request-id';
import { fail, ok } from '@/lib/http/response';
import { AgentType, SourceType } from '@prisma/client';

import type { Prisma } from '@prisma/client';

const VcenterPreferredVersionSchema = z.enum(['6.5-6.7', '7.0-8.x']);
const PveAuthTypeSchema = z.enum(['api_token', 'user_password']);
const PveScopeSchema = z.enum(['auto', 'standalone', 'cluster']);
const HypervConnectionMethodSchema = z.enum(['winrm', 'agent']);

const SourceConfigSchema = z
  .object({
    // 所有来源都需要 endpoint（Hyper-V agent 模式下代表目标主机/集群；agent_url 仅表示认证入口）。
    endpoint: z.string().optional(),
    preferred_vcenter_version: VcenterPreferredVersionSchema.optional(),
    tls_verify: z.boolean().optional(),
    timeout_ms: z.number().int().positive().optional(),
    scope: PveScopeSchema.optional(),
    max_parallel_nodes: z.number().int().positive().optional(),
    auth_type: PveAuthTypeSchema.optional(),

    // Hyper-V（B 方案）：Windows Agent
    connection_method: HypervConnectionMethodSchema.optional(),
    agent_url: z.string().min(1).optional(),
    agent_tls_verify: z.boolean().optional(),
    agent_timeout_ms: z.number().int().positive().optional(),
  })
  .passthrough();

const SourceUpdateSchema = z.object({
  name: z.string().min(1),
  sourceType: z.nativeEnum(SourceType),
  enabled: z.boolean().optional(),
  scheduleGroupId: z.string().min(1).nullable().optional(),
  agentId: z.string().min(1).nullable().optional(),
  config: SourceConfigSchema,
  credentialId: z.string().min(1).nullable().optional(),
});

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const source = await prisma.source.findFirst({
    where: { id, deletedAt: null },
    include: {
      scheduleGroup: { select: { name: true } },
      credential: { select: { id: true, name: true, type: true } },
      agent: { select: { id: true, name: true, agentType: true } },
    },
  });
  if (!source) {
    return fail(
      { code: ErrorCode.CONFIG_SOURCE_NOT_FOUND, category: 'config', message: 'Source not found', retryable: false },
      404,
      { requestId: auth.requestId },
    );
  }

  return ok(
    {
      sourceId: source.id,
      name: source.name,
      sourceType: source.sourceType,
      enabled: source.enabled,
      scheduleGroupId: source.scheduleGroupId,
      scheduleGroupName: source.scheduleGroup?.name ?? null,
      credential: source.credential
        ? { credentialId: source.credential.id, name: source.credential.name, type: source.credential.type }
        : null,
      agent: source.agent
        ? { agentId: source.agent.id, name: source.agent.name, agentType: source.agent.agentType }
        : null,
      config: source.config,
      createdAt: source.createdAt.toISOString(),
      updatedAt: source.updatedAt.toISOString(),
    },
    { requestId: auth.requestId },
  );
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  let body: z.infer<typeof SourceUpdateSchema>;
  try {
    body = SourceUpdateSchema.parse(await request.json());
  } catch {
    return fail(
      { code: ErrorCode.CONFIG_INVALID_REQUEST, category: 'config', message: 'Validation failed', retryable: false },
      400,
      { requestId: auth.requestId },
    );
  }

  const existing = await prisma.source.findFirst({ where: { id, deletedAt: null } });
  if (!existing) {
    return fail(
      { code: ErrorCode.CONFIG_SOURCE_NOT_FOUND, category: 'config', message: 'Source not found', retryable: false },
      404,
      { requestId: auth.requestId },
    );
  }

  const duplicate = await prisma.source.findFirst({
    where: { name: body.name, deletedAt: null, NOT: { id } },
    select: { id: true },
  });
  if (duplicate) {
    return fail(
      { code: ErrorCode.CONFIG_DUPLICATE_NAME, category: 'config', message: 'Name already exists', retryable: false },
      409,
      { requestId: auth.requestId },
    );
  }

  const scheduleGroupId = body.scheduleGroupId === undefined ? existing.scheduleGroupId : body.scheduleGroupId;
  if (scheduleGroupId !== null && scheduleGroupId !== undefined) {
    const group = await prisma.scheduleGroup.findUnique({ where: { id: scheduleGroupId }, select: { id: true } });
    if (!group) {
      return fail(
        {
          code: ErrorCode.CONFIG_SCHEDULE_GROUP_NOT_FOUND,
          category: 'config',
          message: 'Schedule group not found',
          retryable: false,
        },
        404,
        { requestId: auth.requestId },
      );
    }
  }

  const credentialId = body.credentialId === undefined ? existing.credentialId : body.credentialId;
  const credential =
    credentialId !== null && credentialId !== undefined
      ? await prisma.credential.findUnique({ where: { id: credentialId } })
      : null;
  if (credentialId !== null && credentialId !== undefined && !credential) {
    return fail(
      {
        code: ErrorCode.CONFIG_CREDENTIAL_NOT_FOUND,
        category: 'config',
        message: 'Credential not found',
        retryable: false,
      },
      404,
      { requestId: auth.requestId },
    );
  }
  if (credential && credential.type !== body.sourceType) {
    return fail(
      {
        code: ErrorCode.CONFIG_INVALID_REQUEST,
        category: 'config',
        message: 'Credential type mismatch',
        retryable: false,
      },
      400,
      { requestId: auth.requestId },
    );
  }

  const agentId = body.agentId === undefined ? existing.agentId : body.agentId;
  const agent =
    agentId !== null && agentId !== undefined ? await prisma.agent.findUnique({ where: { id: agentId } }) : null;
  if (agentId !== null && agentId !== undefined && !agent) {
    return fail(
      { code: ErrorCode.CONFIG_AGENT_NOT_FOUND, category: 'config', message: 'Agent not found', retryable: false },
      404,
      { requestId: auth.requestId },
    );
  }

  if (body.sourceType === SourceType.vcenter && !body.config.preferred_vcenter_version) {
    return fail(
      {
        code: ErrorCode.CONFIG_INVALID_REQUEST,
        category: 'config',
        message: 'preferred_vcenter_version is required for vcenter sources',
        retryable: false,
      },
      400,
      { requestId: auth.requestId },
    );
  }

  const endpoint = typeof body.config.endpoint === 'string' ? body.config.endpoint.trim() : '';
  if (!endpoint) {
    return fail(
      {
        code: ErrorCode.CONFIG_INVALID_REQUEST,
        category: 'config',
        message: 'endpoint is required',
        retryable: false,
      },
      400,
      { requestId: auth.requestId },
    );
  }

  if (body.sourceType === SourceType.hyperv && body.config.connection_method === 'agent') {
    // New path: bind to an Agent record (recommended).
    if (agent) {
      if (agent.agentType !== AgentType.hyperv) {
        return fail(
          {
            code: ErrorCode.CONFIG_INVALID_REQUEST,
            category: 'config',
            message: 'Agent type mismatch',
            retryable: false,
          },
          400,
          { requestId: auth.requestId },
        );
      }
      if (!agent.enabled) {
        return fail(
          {
            code: ErrorCode.CONFIG_INVALID_REQUEST,
            category: 'config',
            message: 'Agent is disabled',
            retryable: false,
          },
          400,
          { requestId: auth.requestId },
        );
      }
    } else {
      // Legacy path: allow storing agent_url directly in config.
      const agentUrl = typeof body.config.agent_url === 'string' ? body.config.agent_url.trim() : '';
      if (!agentUrl) {
        return fail(
          {
            code: ErrorCode.CONFIG_INVALID_REQUEST,
            category: 'config',
            message: 'agentId or agent_url is required when connection_method=agent',
            retryable: false,
          },
          400,
          { requestId: auth.requestId },
        );
      }
    }
  } else if (agentId !== null && agentId !== undefined) {
    return fail(
      {
        code: ErrorCode.CONFIG_INVALID_REQUEST,
        category: 'config',
        message: 'agentId is only allowed when sourceType=hyperv and connection_method=agent',
        retryable: false,
      },
      400,
      { requestId: auth.requestId },
    );
  }

  const source = await prisma.source.update({
    where: { id },
    data: {
      name: body.name,
      sourceType: body.sourceType,
      enabled: body.enabled ?? true,
      scheduleGroupId: scheduleGroupId ?? null,
      agentId: agentId ?? null,
      // `request.json()` guarantees JSON-compatible types; Zod passthrough uses `unknown` for values.
      config: body.config as unknown as Prisma.InputJsonValue,
      credentialId: credentialId ?? null,
    },
    include: {
      credential: { select: { id: true, name: true, type: true } },
      agent: { select: { id: true, name: true, agentType: true } },
    },
  });

  return ok(
    {
      sourceId: source.id,
      name: source.name,
      sourceType: source.sourceType,
      enabled: source.enabled,
      scheduleGroupId: source.scheduleGroupId,
      credential: source.credential
        ? { credentialId: source.credential.id, name: source.credential.name, type: source.credential.type }
        : null,
      agent: source.agent
        ? { agentId: source.agent.id, name: source.agent.name, agentType: source.agent.agentType }
        : null,
      config: source.config,
      createdAt: source.createdAt.toISOString(),
      updatedAt: source.updatedAt.toISOString(),
    },
    { requestId: auth.requestId },
  );
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const source = await prisma.source.findFirst({ where: { id, deletedAt: null } });
  if (!source) {
    return fail(
      { code: ErrorCode.CONFIG_SOURCE_NOT_FOUND, category: 'config', message: 'Source not found', retryable: false },
      404,
      { requestId: auth.requestId },
    );
  }

  const activeRun = await prisma.run.findFirst({
    where: { sourceId: id, status: { in: ['Queued', 'Running'] } },
    select: { id: true },
  });

  if (activeRun) {
    return fail(
      {
        code: ErrorCode.CONFIG_RESOURCE_CONFLICT,
        category: 'config',
        message: 'Active run exists for this source',
        retryable: false,
        redacted_context: { sourceId: id },
      },
      409,
      { requestId: auth.requestId },
    );
  }

  await prisma.source.update({
    where: { id },
    data: { deletedAt: new Date(), enabled: false, credentialId: null },
  });

  const requestId = getOrCreateRequestId(auth.requestId);
  return new Response(null, { status: 204, headers: { 'X-Request-ID': requestId } });
}
