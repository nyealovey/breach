import { requireAdmin } from '@/lib/auth/require-admin';
import { ErrorCode } from '@/lib/errors/error-codes';
import { fail } from '@/lib/http/response';

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  // This endpoint is intentionally removed in the credentials-module increment.
  // Use /api/v1/credentials and bind `credentialId` on the Source instead.
  return fail(
    {
      code: ErrorCode.CONFIG_INVALID_REQUEST,
      category: 'config',
      message: 'Endpoint removed; create a Credential and bind Source.credentialId instead',
      retryable: false,
    },
    410,
    { requestId: auth.requestId },
  );
}
