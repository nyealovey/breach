import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { getOrCreateRequestId } from '@/lib/http/request-id';
import { fail } from '@/lib/http/response';
import { logEvent } from '@/lib/logging/logger';

export async function GET(request: Request, context: { params: Promise<{ exportId: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const requestId = getOrCreateRequestId(auth.requestId);
  const { exportId } = await context.params;

  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const exp = await tx.assetLedgerExport.findUnique({
      where: { id: exportId },
      select: { id: true, status: true, fileBytes: true, fileName: true },
    });

    if (!exp) return { ok: false as const, kind: 'not_found' as const };

    if (exp.status === 'Expired' || (exp.status === 'Succeeded' && !exp.fileBytes)) {
      return { ok: false as const, kind: 'expired' as const };
    }

    if (exp.status !== 'Succeeded') {
      return { ok: false as const, kind: 'not_ready' as const, status: exp.status };
    }

    await tx.assetLedgerExport.update({
      where: { id: exportId },
      data: { status: 'Expired', expiresAt: now, fileBytes: null },
    });

    return { ok: true as const, fileBytes: exp.fileBytes!, fileName: exp.fileName };
  });

  if (!result.ok) {
    if (result.kind === 'not_found') {
      return fail(
        { code: ErrorCode.CONFIG_EXPORT_NOT_FOUND, category: 'config', message: 'Export not found', retryable: false },
        404,
        { requestId },
      );
    }

    if (result.kind === 'expired') {
      return fail(
        { code: ErrorCode.CONFIG_EXPORT_EXPIRED, category: 'config', message: 'Export expired', retryable: false },
        410,
        { requestId },
      );
    }

    return fail(
      {
        code: ErrorCode.CONFIG_RESOURCE_CONFLICT,
        category: 'config',
        message: 'Export not ready',
        retryable: true,
        redacted_context: { status: result.status },
      },
      409,
      { requestId },
    );
  }

  logEvent({
    level: 'info',
    service: 'web',
    event_type: 'export.downloaded',
    export_id: exportId,
    user_id: auth.session.user.id,
  });

  const headers = new Headers();
  headers.set('Content-Type', 'text/csv; charset=utf-8');
  headers.set('Content-Disposition', `attachment; filename="${result.fileName ?? 'asset-ledger-export.csv'}"`);
  headers.set('X-Request-ID', requestId);

  return new Response(result.fileBytes, { status: 200, headers });
}
