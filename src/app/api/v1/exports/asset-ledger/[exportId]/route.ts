import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { fail, ok } from '@/lib/http/response';

export async function GET(request: Request, context: { params: Promise<{ exportId: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { exportId } = await context.params;

  const exp = await prisma.assetLedgerExport.findUnique({
    where: { id: exportId },
    select: {
      id: true,
      status: true,
      requestId: true,
      params: true,
      rowCount: true,
      fileName: true,
      fileSizeBytes: true,
      fileSha256: true,
      error: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
      expiresAt: true,
    },
  });

  if (!exp) {
    return fail(
      { code: ErrorCode.CONFIG_EXPORT_NOT_FOUND, category: 'config', message: 'Export not found', retryable: false },
      404,
      { requestId: auth.requestId },
    );
  }

  return ok(
    {
      exportId: exp.id,
      status: exp.status,
      createdAt: exp.createdAt.toISOString(),
      startedAt: exp.startedAt?.toISOString() ?? null,
      finishedAt: exp.finishedAt?.toISOString() ?? null,
      rowCount: exp.rowCount ?? null,
      fileName: exp.fileName ?? null,
      fileSizeBytes: exp.fileSizeBytes ?? null,
      fileSha256: exp.fileSha256 ?? null,
      error: exp.error ?? null,
      expiresAt: exp.expiresAt?.toISOString() ?? null,
    },
    { requestId: auth.requestId },
  );
}
