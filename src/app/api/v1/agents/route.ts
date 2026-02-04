import { z } from 'zod/v4';

import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { buildPagination, parseBoolean, parsePagination } from '@/lib/http/pagination';
import { created, fail, okPaginated } from '@/lib/http/response';
import { AgentType } from '@prisma/client';

const AgentCreateSchema = z.object({
  name: z.string().min(1),
  agentType: z.nativeEnum(AgentType),
  endpoint: z.string().url(),
  enabled: z.boolean().optional(),
  tlsVerify: z.boolean().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(url.searchParams);
  const enabled = parseBoolean(url.searchParams.get('enabled'));
  const agentType = url.searchParams.get('agentType') ?? undefined;
  const q = url.searchParams.get('q') ?? undefined;

  const where = {
    ...(enabled === undefined ? {} : { enabled }),
    ...(agentType ? { agentType: agentType as AgentType } : {}),
    ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
  };

  const [total, agents] = await prisma.$transaction([
    prisma.agent.count({ where }),
    prisma.agent.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip,
      take,
    }),
  ]);

  const ids = agents.map((a) => a.id);
  const counts =
    ids.length > 0
      ? await prisma.source.groupBy({
          by: ['agentId'],
          where: { deletedAt: null, agentId: { in: ids } },
          _count: { _all: true },
        })
      : [];

  const countMap = new Map<string, number>();
  for (const row of counts as Array<{ agentId: string | null; _count: { _all: number } }>) {
    if (row.agentId) countMap.set(row.agentId, row._count._all);
  }

  const data = agents.map((a) => ({
    agentId: a.id,
    name: a.name,
    agentType: a.agentType,
    endpoint: a.endpoint,
    enabled: a.enabled,
    tlsVerify: a.tlsVerify,
    timeoutMs: a.timeoutMs,
    usageCount: countMap.get(a.id) ?? 0,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  }));

  return okPaginated(data, buildPagination(total, page, pageSize), { requestId: auth.requestId });
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof AgentCreateSchema>;
  try {
    body = AgentCreateSchema.parse(await request.json());
  } catch {
    return fail(
      { code: ErrorCode.CONFIG_INVALID_REQUEST, category: 'config', message: 'Validation failed', retryable: false },
      400,
      { requestId: auth.requestId },
    );
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

    return created(
      {
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
      },
      { requestId: auth.requestId },
    );
  } catch (err) {
    if (typeof err === 'object' && err && 'code' in err && (err as { code: string }).code === 'P2002') {
      return fail(
        { code: ErrorCode.CONFIG_DUPLICATE_NAME, category: 'config', message: 'Name already exists', retryable: false },
        409,
        { requestId: auth.requestId },
      );
    }

    return fail(
      { code: ErrorCode.DB_WRITE_FAILED, category: 'db', message: 'Failed to create agent', retryable: false },
      500,
      { requestId: auth.requestId },
    );
  }
}
