import { getSessionFromRequest } from '@/lib/auth/session';
import { ErrorCode } from '@/lib/errors/error-codes';
import { fail } from '@/lib/http/response';

export async function requireUser(request: Request) {
  const requestId = request.headers.get('x-request-id') ?? undefined;
  const session = await getSessionFromRequest(request);

  if (!session) {
    return {
      ok: false as const,
      response: fail(
        { code: ErrorCode.AUTH_UNAUTHORIZED, category: 'auth', message: 'Not authenticated', retryable: false },
        401,
        { requestId },
      ),
    };
  }

  return { ok: true as const, session, requestId };
}
