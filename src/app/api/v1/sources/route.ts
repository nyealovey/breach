import { z } from 'zod/v4';

import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { buildPagination, parseBoolean, parsePagination } from '@/lib/http/pagination';
import { created, fail, okPaginated } from '@/lib/http/response';
import { validateAndNormalizeAdSourceConfig } from '@/lib/sources/ad-source';
import { AgentType, SourceRole, SourceType } from '@prisma/client';

import type { Prisma } from '@prisma/client';

const VcenterPreferredVersionSchema = z.enum(['6.5-6.7', '7.0-8.x']);
const PveAuthTypeSchema = z.enum(['api_token', 'user_password']);
const PveScopeSchema = z.enum(['auto', 'standalone', 'cluster']);
const HypervConnectionMethodSchema = z.enum(['winrm', 'agent']);
const AdPurposeSchema = z.enum(['auth_collect', 'collect_only', 'auth_only']);

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
    purpose: AdPurposeSchema.optional(),
    server_url: z.string().optional(),
    base_dn: z.string().optional(),
    upn_suffixes: z.array(z.string()).optional(),
    user_filter: z.string().optional(),

    // Hyper-V（B 方案）：Windows Agent
    connection_method: HypervConnectionMethodSchema.optional(),
    agent_url: z.string().min(1).optional(),
    agent_tls_verify: z.boolean().optional(),
    agent_timeout_ms: z.number().int().positive().optional(),
  })
  .passthrough();

const SourceCreateSchema = z.object({
  name: z.string().min(1),
  sourceType: z.nativeEnum(SourceType),
  role: z.nativeEnum(SourceRole).optional(),
  enabled: z.boolean().optional(),
  scheduleGroupId: z.string().min(1).nullable().optional(),
  agentId: z.string().min(1).nullable().optional(),
  config: SourceConfigSchema,
  credentialId: z.string().min(1).nullable().optional(),
});

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(url.searchParams);
  const enabled = parseBoolean(url.searchParams.get('enabled'));
  const sourceType = url.searchParams.get('sourceType') ?? undefined;
  const scheduleGroupId = url.searchParams.get('scheduleGroupId') ?? undefined;

  const where = {
    deletedAt: null,
    ...(enabled === undefined ? {} : { enabled }),
    ...(sourceType ? { sourceType: sourceType as SourceType } : {}),
    ...(scheduleGroupId ? { scheduleGroupId } : {}),
  };

  const [total, sources] = await prisma.$transaction([
    prisma.source.count({ where }),
    prisma.source.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        scheduleGroup: { select: { name: true } },
        credential: { select: { id: true, name: true, type: true } },
        agent: { select: { id: true, name: true, agentType: true } },
      },
    }),
  ]);

  const sourceIds = sources.map((s) => s.id);
  const runs =
    sourceIds.length > 0
      ? await prisma.run.findMany({
          where: { sourceId: { in: sourceIds } },
          orderBy: { createdAt: 'desc' },
        })
      : [];

  const lastRunMap = new Map<string, (typeof runs)[number]>();
  for (const run of runs) {
    if (!lastRunMap.has(run.sourceId)) lastRunMap.set(run.sourceId, run);
  }

  const data = sources.map((source) => {
    const lastRun = lastRunMap.get(source.id);
    return {
      sourceId: source.id,
      name: source.name,
      sourceType: source.sourceType,
      role: source.role,
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
      lastRun: lastRun
        ? {
            runId: lastRun.id,
            status: lastRun.status,
            finishedAt: lastRun.finishedAt?.toISOString() ?? null,
            mode: lastRun.mode,
          }
        : null,
      createdAt: source.createdAt.toISOString(),
      updatedAt: source.updatedAt.toISOString(),
    };
  });

  return okPaginated(data, buildPagination(total, page, pageSize), { requestId: auth.requestId });
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof SourceCreateSchema>;
  try {
    body = SourceCreateSchema.parse(await request.json());
  } catch {
    return fail(
      { code: ErrorCode.CONFIG_INVALID_REQUEST, category: 'config', message: 'Validation failed', retryable: false },
      400,
      { requestId: auth.requestId },
    );
  }

  const duplicate = await prisma.source.findFirst({
    where: { name: body.name, deletedAt: null },
    select: { id: true },
  });
  if (duplicate) {
    return fail(
      { code: ErrorCode.CONFIG_DUPLICATE_NAME, category: 'config', message: 'Name already exists', retryable: false },
      409,
      { requestId: auth.requestId },
    );
  }

  const scheduleGroupId = body.scheduleGroupId ?? null;
  if (scheduleGroupId !== null) {
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

  const credentialId = body.credentialId ?? null;
  const credential = credentialId !== null ? await prisma.credential.findUnique({ where: { id: credentialId } }) : null;
  if (credentialId !== null && !credential) {
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

  const agentId = body.agentId ?? null;
  const agent = agentId !== null ? await prisma.agent.findUnique({ where: { id: agentId } }) : null;
  if (agentId !== null && !agent) {
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

  const normalizedConfigResult = await validateAndNormalizeAdSourceConfig({
    prisma,
    sourceType: body.sourceType,
    config: body.config as Record<string, unknown>,
    credentialId,
  });
  if (!normalizedConfigResult.ok) {
    return fail(
      {
        code: ErrorCode.CONFIG_INVALID_REQUEST,
        category: 'config',
        message: normalizedConfigResult.message,
        retryable: false,
      },
      400,
      { requestId: auth.requestId },
    );
  }
  const normalizedConfig = normalizedConfigResult.normalizedConfig;

  const endpoint = typeof normalizedConfig.endpoint === 'string' ? normalizedConfig.endpoint.trim() : '';
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

  const role =
    body.role ??
    (body.sourceType === SourceType.solarwinds || body.sourceType === SourceType.veeam
      ? SourceRole.signal
      : SourceRole.inventory);
  if (body.sourceType === SourceType.solarwinds && role !== SourceRole.signal) {
    return fail(
      {
        code: ErrorCode.CONFIG_INVALID_REQUEST,
        category: 'config',
        message: 'solarwinds sources must use role=signal',
        retryable: false,
      },
      400,
      { requestId: auth.requestId },
    );
  }
  if (body.sourceType === SourceType.veeam && role !== SourceRole.signal) {
    return fail(
      {
        code: ErrorCode.CONFIG_INVALID_REQUEST,
        category: 'config',
        message: 'veeam sources must use role=signal',
        retryable: false,
      },
      400,
      { requestId: auth.requestId },
    );
  }
  if (role === SourceRole.signal && body.sourceType !== SourceType.solarwinds && body.sourceType !== SourceType.veeam) {
    return fail(
      {
        code: ErrorCode.CONFIG_INVALID_REQUEST,
        category: 'config',
        message: 'role=signal is only supported for solarwinds/veeam sources',
        retryable: false,
      },
      400,
      { requestId: auth.requestId },
    );
  }
  if (body.sourceType === SourceType.activedirectory && role === SourceRole.signal) {
    return fail(
      {
        code: ErrorCode.CONFIG_INVALID_REQUEST,
        category: 'config',
        message: 'activedirectory sources must use role=inventory',
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
  } else if (agentId !== null) {
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

  try {
    const source = await prisma.source.create({
      data: {
        name: body.name,
        sourceType: body.sourceType,
        role,
        enabled: body.enabled ?? true,
        scheduleGroupId,
        agentId,
        // `request.json()` guarantees JSON-compatible types; Zod passthrough uses `unknown` for values.
        config: normalizedConfig as unknown as Prisma.InputJsonValue,
        credentialId,
      },
      include: {
        credential: { select: { id: true, name: true, type: true } },
        agent: { select: { id: true, name: true, agentType: true } },
      },
    });

    return created(
      {
        sourceId: source.id,
        name: source.name,
        sourceType: source.sourceType,
        role: source.role,
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
  } catch {
    return fail(
      { code: ErrorCode.DB_WRITE_FAILED, category: 'db', message: 'Failed to create source', retryable: false },
      500,
      { requestId: auth.requestId },
    );
  }
}
