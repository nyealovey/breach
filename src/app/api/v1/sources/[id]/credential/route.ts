import { z } from 'zod/v4';

import { requireAdmin } from '@/lib/auth/require-admin';
import { encryptJson } from '@/lib/crypto/aes-gcm';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { fail, ok } from '@/lib/http/response';

const CredentialSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  let body: z.infer<typeof CredentialSchema>;
  try {
    body = CredentialSchema.parse(await request.json());
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

  let ciphertext: string;
  try {
    ciphertext = encryptJson({ username: body.username, password: body.password });
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

  await prisma.source.update({
    where: { id },
    data: { credentialCiphertext: ciphertext },
  });

  return ok({ message: 'Credential updated successfully' }, { requestId: auth.requestId });
}
