'use server';

import { z } from 'zod/v4';

import { requireServerAdminSession } from '@/lib/auth/require-server-session';
import { actionError, actionOk, getActionErrorMessage } from '@/lib/actions/action-result';
import { prisma } from '@/lib/db/prisma';
import { AgentType } from '@prisma/client';

import type { ActionResult } from '@/lib/actions/action-result';

export type AgentListItem = {
  agentId: string;
  name: string;
  agentType: string;
  endpoint: string;
  enabled: boolean;
  tlsVerify: boolean;
  timeoutMs: number;
  usageCount: number;
  updatedAt: string;
};

export type AgentDetail = AgentListItem & { createdAt: string };

export type AgentCheckResult = {
  reachable: boolean;
  status: number | null;
  durationMs: number;
  error: string | null;
};

function clampPageSize(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const n = Math.trunc(value);
  if (n <= 0) return fallback;
  return Math.min(n, 200);
}

function clampPositiveInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0) return value;
  return fallback;
}

async function loadUsageCountMap(agentIds: string[]) {
  const counts =
    agentIds.length > 0
      ? await prisma.source.groupBy({
          by: ['agentId'],
          where: { deletedAt: null, agentId: { in: agentIds } },
          _count: { _all: true },
        })
      : [];

  const countMap = new Map<string, number>();
  for (const row of counts as Array<{ agentId: string | null; _count: { _all: number } }>) {
    if (row.agentId) countMap.set(row.agentId, row._count._all);
  }
  return countMap;
}

export async function listAgents(input?: { pageSize?: number; enabled?: boolean; agentType?: string; q?: string }) {
  await requireServerAdminSession();

  const pageSize = clampPageSize(input?.pageSize, 100);
  const enabled = typeof input?.enabled === 'boolean' ? input.enabled : undefined;
  const agentType = input?.agentType?.trim() ? (input.agentType.trim() as AgentType) : undefined;
  const q = input?.q?.trim() ? input.q.trim() : undefined;

  const where = {
    ...(enabled === undefined ? {} : { enabled }),
    ...(agentType ? { agentType } : {}),
    ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
  };

  const agents = await prisma.agent.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take: pageSize,
  });

  const ids = agents.map((a) => a.id);
  const countMap = await loadUsageCountMap(ids);

  return agents.map((a) => ({
    agentId: a.id,
    name: a.name,
    agentType: a.agentType,
    endpoint: a.endpoint,
    enabled: a.enabled,
    tlsVerify: a.tlsVerify,
    timeoutMs: a.timeoutMs,
    usageCount: countMap.get(a.id) ?? 0,
    updatedAt: a.updatedAt.toISOString(),
  })) satisfies AgentListItem[];
}

export async function getAgent(agentId: string): Promise<AgentDetail | null> {
  await requireServerAdminSession();

  const id = agentId.trim();
  if (!id) return null;

  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) return null;

  const usageCount = await prisma.source.count({ where: { deletedAt: null, agentId: id } });

  return {
    agentId: agent.id,
    name: agent.name,
    agentType: agent.agentType,
    endpoint: agent.endpoint,
    enabled: agent.enabled,
    tlsVerify: agent.tlsVerify,
    timeoutMs: agent.timeoutMs,
    usageCount,
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
  };
}

const AgentCreateSchema = z.object({
  name: z.string().min(1),
  agentType: z.nativeEnum(AgentType),
  endpoint: z.string().url(),
  enabled: z.boolean().optional(),
  tlsVerify: z.boolean().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export async function createAgentAction(input: unknown): Promise<ActionResult<AgentDetail>> {
  await requireServerAdminSession();

  let body: z.infer<typeof AgentCreateSchema>;
  try {
    body = AgentCreateSchema.parse(input);
  } catch {
    return actionError('Validation failed');
  }

  try {
    const agent = await prisma.agent.create({
      data: {
        name: body.name,
        agentType: body.agentType,
        endpoint: body.endpoint.trim(),
        enabled: body.enabled ?? true,
        tlsVerify: body.tlsVerify ?? true,
        timeoutMs: body.timeoutMs ?? 60_000,
      },
    });

    return actionOk({
      agentId: agent.id,
      name: agent.name,
      agentType: agent.agentType,
      endpoint: agent.endpoint,
      enabled: agent.enabled,
      tlsVerify: agent.tlsVerify,
      timeoutMs: agent.timeoutMs,
      usageCount: 0,
      createdAt: agent.createdAt.toISOString(),
      updatedAt: agent.updatedAt.toISOString(),
    });
  } catch (err) {
    // Prisma unique constraint.
    if (typeof err === 'object' && err && 'code' in err && (err as { code: string }).code === 'P2002') {
      return actionError('Name already exists');
    }
    return actionError(getActionErrorMessage(err, 'Failed to create agent'));
  }
}

const AgentUpdateSchema = AgentCreateSchema;

export async function updateAgentAction(agentId: string, input: unknown): Promise<ActionResult<AgentDetail>> {
  await requireServerAdminSession();

  const id = agentId.trim();
  if (!id) return actionError('Invalid agentId');

  let body: z.infer<typeof AgentUpdateSchema>;
  try {
    body = AgentUpdateSchema.parse(input);
  } catch {
    return actionError('Validation failed');
  }

  const existing = await prisma.agent.findUnique({ where: { id } });
  if (!existing) return actionError('Agent not found');

  const duplicate = await prisma.agent.findFirst({ where: { name: body.name, NOT: { id } }, select: { id: true } });
  if (duplicate) return actionError('Name already exists');

  try {
    const agent = await prisma.agent.update({
      where: { id },
      data: {
        name: body.name,
        agentType: body.agentType,
        endpoint: body.endpoint.trim(),
        enabled: body.enabled ?? true,
        tlsVerify: body.tlsVerify ?? true,
        timeoutMs: body.timeoutMs ?? 60_000,
      },
    });

    const usageCount = await prisma.source.count({ where: { deletedAt: null, agentId: id } });

    return actionOk({
      agentId: agent.id,
      name: agent.name,
      agentType: agent.agentType,
      endpoint: agent.endpoint,
      enabled: agent.enabled,
      tlsVerify: agent.tlsVerify,
      timeoutMs: agent.timeoutMs,
      usageCount,
      createdAt: agent.createdAt.toISOString(),
      updatedAt: agent.updatedAt.toISOString(),
    });
  } catch (err) {
    if (typeof err === 'object' && err && 'code' in err && (err as { code: string }).code === 'P2002') {
      return actionError('Name already exists');
    }
    return actionError(getActionErrorMessage(err, 'Failed to update agent'));
  }
}

export async function deleteAgentAction(agentId: string): Promise<ActionResult<{ deleted: true }>> {
  await requireServerAdminSession();

  const id = agentId.trim();
  if (!id) return actionError('Invalid agentId');

  const agent = await prisma.agent.findUnique({ where: { id }, select: { id: true } });
  if (!agent) return actionError('Agent not found');

  const usageCount = await prisma.source.count({ where: { deletedAt: null, agentId: id } });
  if (usageCount > 0) return actionError('Agent is still referenced by sources');

  try {
    await prisma.agent.delete({ where: { id } });
    return actionOk({ deleted: true });
  } catch (err) {
    return actionError(getActionErrorMessage(err, 'Failed to delete agent'));
  }
}

export async function checkAgentAction(agentId: string): Promise<ActionResult<AgentCheckResult>> {
  await requireServerAdminSession();

  const id = agentId.trim();
  if (!id) return actionError('Invalid agentId');

  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) return actionError('Agent not found');

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeoutMs = clampPositiveInt(agent.timeoutMs, 60_000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let reachable = false;
  let status: number | null = null;
  let error: string | null = null;

  try {
    const url = new URL('/health', agent.endpoint).toString();
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    status = res.status;
    reachable = res.ok;
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      error = text ? text.slice(0, 500) : `status=${res.status}`;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timeout);
  }

  const durationMs = Date.now() - startedAt;
  return actionOk({ reachable, status, durationMs, error });
}
