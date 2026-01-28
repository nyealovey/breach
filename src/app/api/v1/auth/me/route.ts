import { getSessionFromRequest } from '@/lib/auth/session';
import { ErrorCode } from '@/lib/errors/error-codes';
import { fail, ok } from '@/lib/http/response';

function hasSessionCookie(request: Request) {
  const cookie = request.headers.get('cookie');
  return cookie?.split(';').some((p) => p.trim().startsWith('session=')) ?? false;
}

export async function GET(request: Request) {
  const requestId = request.headers.get('x-request-id') ?? undefined;

  const session = await getSessionFromRequest(request);
  if (!session) {
    return fail(
      {
        code: hasSessionCookie(request) ? ErrorCode.AUTH_SESSION_EXPIRED : ErrorCode.AUTH_UNAUTHORIZED,
        category: 'auth',
        message: 'Not authenticated',
        retryable: false,
      },
      401,
      { requestId },
    );
  }

  return ok({ userId: session.user.id, username: session.user.username, role: session.user.role }, { requestId });
}
