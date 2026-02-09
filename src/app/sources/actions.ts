'use server';

import { z } from 'zod/v4';

import { actionError, actionOk, getActionErrorMessage } from '@/lib/actions/action-result';
import { requireServerAdminSession } from '@/lib/auth/require-server-session';
import { prisma } from '@/lib/db/prisma';
import { validateAndNormalizeAdSourceConfig } from '@/lib/sources/ad-source';
import { AgentType, SourceRole, SourceType } from '@prisma/client';

import type { ActionResult } from '@/lib/actions/action-result';
import type { Prisma } from '@prisma/client';

const VcenterPreferredVersionSchema = z.enum(['6.5-6.7', '7.0-8.x']);
const PveAuthTypeSchema = z.enum(['api_token', 'user_password']);
const PveScopeSchema = z.enum(['auto', 'standalone', 'cluster']);
const HypervConnectionMethodSchema = z.enum(['winrm', 'agent']);
const AdPurposeSchema = z.enum(['auth_collect', 'collect_only', 'auth_only']);

const SourceConfigSchema = z
  .object({
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

const SourceUpdateSchema = SourceCreateSchema;

type ParsedSourceInput = z.infer<typeof SourceCreateSchema>;

type SourceWithRelations = {
  id: string;
  name: string;
  sourceType: SourceType;
  role: SourceRole;
  enabled: boolean;
  scheduleGroupId: string | null;
  scheduleGroup: { name: string } | null;
  credential: { id: string; name: string; type: SourceType } | null;
  agent: { id: string; name: string; agentType: AgentType } | null;
  config: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
};

export type SourceListItem = {
  sourceId: string;
  name: string;
  sourceType: string;
  enabled: boolean;
  credential: { credentialId: string; name: string; type: string } | null;
  config?: { endpoint?: string } | null;
  lastRun: { runId: string; status: string; finishedAt: string | null; mode: string } | null;
};

export type SourceDetail = {
  sourceId: string;
  name: string;
  sourceType: string;
  enabled: boolean;
  scheduleGroupId: string | null;
  scheduleGroupName: string | null;
  credential: { credentialId: string; name: string; type: string } | null;
  agent: { agentId: string; name: string; agentType: string } | null;
  config?: Record<string, unknown> | null;
};

function toSourceDetail(source: SourceWithRelations): SourceDetail {
  return {
    sourceId: source.id,
    name: source.name,
    sourceType: source.sourceType,
    enabled: source.enabled,
    scheduleGroupId: source.scheduleGroupId,
    scheduleGroupName: source.scheduleGroup?.name ?? null,
    credential: source.credential
      ? {
          credentialId: source.credential.id,
          name: source.credential.name,
          type: source.credential.type,
        }
      : null,
    agent: source.agent
      ? {
          agentId: source.agent.id,
          name: source.agent.name,
          agentType: source.agent.agentType,
        }
      : null,
    config: (source.config ?? null) as Record<string, unknown> | null,
  };
}

function resolveRoleForCreate(sourceType: SourceType, role?: SourceRole): SourceRole {
  return (
    role ??
    (sourceType === SourceType.solarwinds || sourceType === SourceType.veeam ? SourceRole.signal : SourceRole.inventory)
  );
}

function resolveRoleForUpdate(sourceType: SourceType, existingRole: SourceRole, role?: SourceRole): SourceRole {
  return (
    role ??
    (sourceType === SourceType.solarwinds || sourceType === SourceType.veeam
      ? SourceRole.signal
      : existingRole === SourceRole.signal
        ? SourceRole.inventory
        : existingRole)
  );
}

function validateRole(sourceType: SourceType, role: SourceRole): string | null {
  if (sourceType === SourceType.solarwinds && role !== SourceRole.signal) {
    return 'solarwinds sources must use role=signal';
  }
  if (sourceType === SourceType.veeam && role !== SourceRole.signal) {
    return 'veeam sources must use role=signal';
  }
  if (role === SourceRole.signal && sourceType !== SourceType.solarwinds && sourceType !== SourceType.veeam) {
    return 'role=signal is only supported for solarwinds/veeam sources';
  }
  if (sourceType === SourceType.activedirectory && role === SourceRole.signal) {
    return 'activedirectory sources must use role=inventory';
  }
  return null;
}

function validateHypervAgent(input: {
  sourceType: SourceType;
  config: ParsedSourceInput['config'];
  agentId: string | null | undefined;
  agent: { agentType: AgentType; enabled: boolean } | null;
}): string | null {
  const { sourceType, config, agentId, agent } = input;

  if (sourceType === SourceType.hyperv && config.connection_method === 'agent') {
    if (agent) {
      if (agent.agentType !== AgentType.hyperv) return 'Agent type mismatch';
      if (!agent.enabled) return 'Agent is disabled';
      return null;
    }

    const agentUrl = typeof config.agent_url === 'string' ? config.agent_url.trim() : '';
    if (!agentUrl) return 'agentId or agent_url is required when connection_method=agent';
    return null;
  }

  if (agentId !== null && agentId !== undefined) {
    return 'agentId is only allowed when sourceType=hyperv and connection_method=agent';
  }

  return null;
}

async function normalizeConfig(input: {
  sourceType: SourceType;
  config: ParsedSourceInput['config'];
  credentialId: string | null;
  excludeSourceId?: string;
}): Promise<{ config?: Record<string, unknown>; error?: string }> {
  const normalizedConfigResult = await validateAndNormalizeAdSourceConfig({
    prisma,
    sourceType: input.sourceType,
    config: input.config as Record<string, unknown>,
    credentialId: input.credentialId,
    excludeSourceId: input.excludeSourceId,
  });

  if (!normalizedConfigResult.ok) {
    return { error: normalizedConfigResult.message };
  }

  const config = normalizedConfigResult.normalizedConfig;
  const endpoint = typeof config.endpoint === 'string' ? config.endpoint.trim() : '';
  if (!endpoint) {
    return { error: 'endpoint is required' };
  }

  return { config };
}

export async function listSources(): Promise<SourceListItem[]> {
  await requireServerAdminSession();

  const sources = await prisma.source.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      credential: { select: { id: true, name: true, type: true } },
    },
  });

  const sourceIds = sources.map((source) => source.id);
  const runRows =
    sourceIds.length > 0
      ? await prisma.run.findMany({
          where: { sourceId: { in: sourceIds } },
          orderBy: { createdAt: 'desc' },
        })
      : [];

  const lastRunMap = new Map<string, (typeof runRows)[number]>();
  for (const run of runRows) {
    if (!lastRunMap.has(run.sourceId)) {
      lastRunMap.set(run.sourceId, run);
    }
  }

  return sources.map((source) => {
    const lastRun = lastRunMap.get(source.id);
    return {
      sourceId: source.id,
      name: source.name,
      sourceType: source.sourceType,
      enabled: source.enabled,
      credential: source.credential
        ? {
            credentialId: source.credential.id,
            name: source.credential.name,
            type: source.credential.type,
          }
        : null,
      config: (source.config as { endpoint?: string } | null | undefined) ?? null,
      lastRun: lastRun
        ? {
            runId: lastRun.id,
            status: lastRun.status,
            finishedAt: lastRun.finishedAt?.toISOString() ?? null,
            mode: lastRun.mode,
          }
        : null,
    };
  });
}

export async function getSource(sourceId: string): Promise<SourceDetail | null> {
  await requireServerAdminSession();

  const id = sourceId.trim();
  if (!id) return null;

  const source = await prisma.source.findFirst({
    where: { id, deletedAt: null },
    include: {
      scheduleGroup: { select: { name: true } },
      credential: { select: { id: true, name: true, type: true } },
      agent: { select: { id: true, name: true, agentType: true } },
    },
  });

  if (!source) return null;
  return toSourceDetail(source as SourceWithRelations);
}

export async function createSourceAction(input: unknown): Promise<ActionResult<SourceDetail>> {
  await requireServerAdminSession();

  let body: ParsedSourceInput;
  try {
    body = SourceCreateSchema.parse(input);
  } catch {
    return actionError('Validation failed');
  }

  try {
    const duplicate = await prisma.source.findFirst({
      where: { name: body.name, deletedAt: null },
      select: { id: true },
    });
    if (duplicate) return actionError('Name already exists');

    const scheduleGroupId = body.scheduleGroupId ?? null;
    const credentialId = body.credentialId ?? null;
    const agentId = body.agentId ?? null;

    const [group, credential, agent] = await Promise.all([
      scheduleGroupId !== null
        ? prisma.scheduleGroup.findUnique({ where: { id: scheduleGroupId }, select: { id: true } })
        : null,
      credentialId !== null ? prisma.credential.findUnique({ where: { id: credentialId } }) : null,
      agentId !== null ? prisma.agent.findUnique({ where: { id: agentId } }) : null,
    ]);

    if (scheduleGroupId !== null && !group) return actionError('Schedule group not found');
    if (credentialId !== null && !credential) return actionError('Credential not found');
    if (credential && credential.type !== body.sourceType) return actionError('Credential type mismatch');

    if (agentId !== null && !agent) return actionError('Agent not found');

    if (body.sourceType === SourceType.vcenter && !body.config.preferred_vcenter_version) {
      return actionError('preferred_vcenter_version is required for vcenter sources');
    }

    const normalizedConfigResult = await normalizeConfig({
      sourceType: body.sourceType,
      config: body.config,
      credentialId,
    });
    if (normalizedConfigResult.error || !normalizedConfigResult.config) {
      return actionError(normalizedConfigResult.error ?? 'Validation failed');
    }

    const role = resolveRoleForCreate(body.sourceType, body.role);
    const roleError = validateRole(body.sourceType, role);
    if (roleError) return actionError(roleError);

    const hypervAgentError = validateHypervAgent({
      sourceType: body.sourceType,
      config: body.config,
      agentId,
      agent,
    });
    if (hypervAgentError) return actionError(hypervAgentError);

    const source = await prisma.source.create({
      data: {
        name: body.name,
        sourceType: body.sourceType,
        role,
        enabled: body.enabled ?? true,
        scheduleGroupId,
        agentId,
        config: normalizedConfigResult.config as Prisma.InputJsonValue,
        credentialId,
      },
      include: {
        scheduleGroup: { select: { name: true } },
        credential: { select: { id: true, name: true, type: true } },
        agent: { select: { id: true, name: true, agentType: true } },
      },
    });

    return actionOk(toSourceDetail(source as SourceWithRelations));
  } catch (err) {
    if (typeof err === 'object' && err && 'code' in err && (err as { code: string }).code === 'P2002') {
      return actionError('Name already exists');
    }
    return actionError(getActionErrorMessage(err, '创建失败'));
  }
}

export async function updateSourceAction(sourceId: string, input: unknown): Promise<ActionResult<SourceDetail>> {
  await requireServerAdminSession();

  const id = sourceId.trim();
  if (!id) return actionError('Invalid sourceId');

  let body: z.infer<typeof SourceUpdateSchema>;
  try {
    body = SourceUpdateSchema.parse(input);
  } catch {
    return actionError('Validation failed');
  }

  try {
    const existing = await prisma.source.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return actionError('Source not found');

    const duplicate = await prisma.source.findFirst({
      where: { name: body.name, deletedAt: null, NOT: { id } },
      select: { id: true },
    });
    if (duplicate) return actionError('Name already exists');

    const scheduleGroupId = body.scheduleGroupId === undefined ? existing.scheduleGroupId : body.scheduleGroupId;
    const credentialId = body.credentialId === undefined ? existing.credentialId : body.credentialId;
    const agentId = body.agentId === undefined ? existing.agentId : body.agentId;

    const [group, credential, agent] = await Promise.all([
      scheduleGroupId !== null && scheduleGroupId !== undefined
        ? prisma.scheduleGroup.findUnique({ where: { id: scheduleGroupId }, select: { id: true } })
        : null,
      credentialId !== null && credentialId !== undefined
        ? prisma.credential.findUnique({ where: { id: credentialId } })
        : null,
      agentId !== null && agentId !== undefined ? prisma.agent.findUnique({ where: { id: agentId } }) : null,
    ]);

    if (scheduleGroupId !== null && scheduleGroupId !== undefined && !group)
      return actionError('Schedule group not found');
    if (credentialId !== null && credentialId !== undefined && !credential) {
      return actionError('Credential not found');
    }
    if (credential && credential.type !== body.sourceType) return actionError('Credential type mismatch');

    if (agentId !== null && agentId !== undefined && !agent) return actionError('Agent not found');

    if (body.sourceType === SourceType.vcenter && !body.config.preferred_vcenter_version) {
      return actionError('preferred_vcenter_version is required for vcenter sources');
    }

    const normalizedConfigResult = await normalizeConfig({
      sourceType: body.sourceType,
      config: body.config,
      credentialId: credentialId ?? null,
      excludeSourceId: id,
    });
    if (normalizedConfigResult.error || !normalizedConfigResult.config) {
      return actionError(normalizedConfigResult.error ?? 'Validation failed');
    }

    const role = resolveRoleForUpdate(body.sourceType, existing.role, body.role);
    const roleError = validateRole(body.sourceType, role);
    if (roleError) return actionError(roleError);

    const hypervAgentError = validateHypervAgent({
      sourceType: body.sourceType,
      config: body.config,
      agentId,
      agent,
    });
    if (hypervAgentError) return actionError(hypervAgentError);

    const source = await prisma.source.update({
      where: { id },
      data: {
        name: body.name,
        sourceType: body.sourceType,
        role,
        enabled: body.enabled ?? true,
        scheduleGroupId: scheduleGroupId ?? null,
        agentId: agentId ?? null,
        config: normalizedConfigResult.config as Prisma.InputJsonValue,
        credentialId: credentialId ?? null,
      },
      include: {
        scheduleGroup: { select: { name: true } },
        credential: { select: { id: true, name: true, type: true } },
        agent: { select: { id: true, name: true, agentType: true } },
      },
    });

    return actionOk(toSourceDetail(source as SourceWithRelations));
  } catch (err) {
    if (typeof err === 'object' && err && 'code' in err && (err as { code: string }).code === 'P2002') {
      return actionError('Name already exists');
    }
    return actionError(getActionErrorMessage(err, '更新失败'));
  }
}

export async function deleteSourceAction(sourceId: string): Promise<ActionResult<{ deleted: true }>> {
  await requireServerAdminSession();

  const id = sourceId.trim();
  if (!id) return actionError('Invalid sourceId');

  try {
    const source = await prisma.source.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!source) return actionError('Source not found');

    const activeRun = await prisma.run.findFirst({
      where: { sourceId: id, status: { in: ['Queued', 'Running'] } },
      select: { id: true },
    });
    if (activeRun) return actionError('Active run exists for this source');

    await prisma.source.update({
      where: { id },
      data: { deletedAt: new Date(), enabled: false, credentialId: null },
    });

    return actionOk({ deleted: true });
  } catch (err) {
    return actionError(getActionErrorMessage(err, '删除失败'));
  }
}
