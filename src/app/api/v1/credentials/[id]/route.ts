import { z } from 'zod/v4';

import { requireAdmin } from '@/lib/auth/require-admin';
import { encryptJson } from '@/lib/crypto/aes-gcm';
import { prisma } from '@/lib/db/prisma';
import { payloadSchemaByType } from '@/lib/credentials/schema';
import { ErrorCode } from '@/lib/errors/error-codes';
import { getOrCreateRequestId } from '@/lib/http/request-id';
import { fail, ok } from '@/lib/http/response';

const CredentialUpdateBodySchema = z.object({
  name: z.string().min(1).optional(),
  payload: z.unknown().optional(),
});

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const credential = await prisma.credential.findUnique({ where: { id } });
  if (!credential) {
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

  const usageCount = await prisma.source.count({ where: { credentialId: id, deletedAt: null } });

  return ok(
    {
      credentialId: credential.id,
      name: credential.name,
      type: credential.type,
      usageCount,
      createdAt: credential.createdAt.toISOString(),
      updatedAt: credential.updatedAt.toISOString(),
    },
    { requestId: auth.requestId },
  );
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;

  let body: z.infer<typeof CredentialUpdateBodySchema>;
  try {
    body = CredentialUpdateBodySchema.parse(await request.json());
  } catch {
    return fail(
      { code: ErrorCode.CONFIG_INVALID_REQUEST, category: 'config', message: 'Validation failed', retryable: false },
      400,
      { requestId: auth.requestId },
    );
  }

  const existing = await prisma.credential.findUnique({ where: { id } });
  if (!existing) {
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

  const data: { name?: string; payloadCiphertext?: string } = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.payload !== undefined) {
    const result = payloadSchemaByType(existing.type).safeParse(body.payload);
    if (!result.success) {
      return fail(
        { code: ErrorCode.CONFIG_INVALID_REQUEST, category: 'config', message: 'Validation failed', retryable: false },
        400,
        { requestId: auth.requestId },
      );
    }

    try {
      data.payloadCiphertext = encryptJson(result.data);
    } catch (err) {
      return fail(
        {
          code: ErrorCode.INTERNAL_ERROR,
          category: 'unknown',
          message: err instanceof Error ? err.message : 'Credential encryption failed',
          retryable: false,
        },
        500,
        { requestId: auth.requestId },
      );
    }
  }

  try {
    const updated = await prisma.credential.update({ where: { id }, data });
    const usageCount = await prisma.source.count({ where: { credentialId: id, deletedAt: null } });

    return ok(
      {
        credentialId: updated.id,
        name: updated.name,
        type: updated.type,
        usageCount,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
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
      { code: ErrorCode.DB_WRITE_FAILED, category: 'db', message: 'Failed to update credential', retryable: false },
      500,
      { requestId: auth.requestId },
    );
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const credential = await prisma.credential.findUnique({ where: { id } });
  if (!credential) {
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

  const usageCount = await prisma.source.count({ where: { credentialId: id, deletedAt: null } });
  if (usageCount > 0) {
    return fail(
      {
        code: ErrorCode.CONFIG_RESOURCE_CONFLICT,
        category: 'config',
        message: 'Credential is still referenced by sources',
        retryable: false,
        redacted_context: { credentialId: id, usageCount },
      },
      409,
      { requestId: auth.requestId },
    );
  }

  await prisma.credential.delete({ where: { id } });

  const requestId = getOrCreateRequestId(auth.requestId);
  return new Response(null, { status: 204, headers: { 'X-Request-ID': requestId } });
}

