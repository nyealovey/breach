import { z } from 'zod/v4';

import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { getOrCreateRequestId } from '@/lib/http/request-id';
import { fail, ok } from '@/lib/http/response';
import { AgentType } from '@prisma/client';

const AgentUpdateSchema = z.object({
  name: z.string().min(1),
  agentType: z.nativeEnum(AgentType),
  endpoint: z.string().url(),
  enabled: z.boolean().optional(),
  tlsVerify: z.boolean().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) {
    return fail(
      { code: ErrorCode.CONFIG_AGENT_NOT_FOUND, category: 'config', message: 'Agent not found', retryable: false },
      404,
      { requestId: auth.requestId },
    );
  }

  const usageCount = await prisma.source.count({ where: { deletedAt: null, agentId: id } });

  return ok(
    {
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
    },
    { requestId: auth.requestId },
  );
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  let body: z.infer<typeof AgentUpdateSchema>;
  try {
    body = AgentUpdateSchema.parse(await request.json());
  } catch {
    return fail(
      { code: ErrorCode.CONFIG_INVALID_REQUEST, category: 'config', message: 'Validation failed', retryable: false },
      400,
      { requestId: auth.requestId },
    );
  }

  const existing = await prisma.agent.findUnique({ where: { id } });
  if (!existing) {
    return fail(
      { code: ErrorCode.CONFIG_AGENT_NOT_FOUND, category: 'config', message: 'Agent not found', retryable: false },
      404,
      { requestId: auth.requestId },
    );
  }

  const duplicate = await prisma.agent.findFirst({ where: { name: body.name, NOT: { id } }, select: { id: true } });
  if (duplicate) {
    return fail(
      { code: ErrorCode.CONFIG_DUPLICATE_NAME, category: 'config', message: 'Name already exists', retryable: false },
      409,
      { requestId: auth.requestId },
    );
  }

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

  return ok(
    {
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
    },
    { requestId: auth.requestId },
  );
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) {
    return fail(
      { code: ErrorCode.CONFIG_AGENT_NOT_FOUND, category: 'config', message: 'Agent not found', retryable: false },
      404,
      { requestId: auth.requestId },
    );
  }

  const usageCount = await prisma.source.count({ where: { deletedAt: null, agentId: id } });
  if (usageCount > 0) {
    return fail(
      {
        code: ErrorCode.CONFIG_RESOURCE_CONFLICT,
        category: 'config',
        message: 'Agent is still referenced by sources',
        retryable: false,
        redacted_context: { agentId: id, usageCount },
      },
      409,
      { requestId: auth.requestId },
    );
  }

  await prisma.agent.delete({ where: { id } });

  const requestId = getOrCreateRequestId(auth.requestId);
  return new Response(null, { status: 204, headers: { 'X-Request-ID': requestId } });
}
