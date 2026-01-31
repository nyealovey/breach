import { z } from 'zod/v4';

import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ASSET_LEDGER_EXPORT_V1_FORMAT, ASSET_LEDGER_EXPORT_V1_VERSION } from '@/lib/exports/asset-ledger-export-v1';
import { ErrorCode } from '@/lib/errors/error-codes';
import { getOrCreateRequestId } from '@/lib/http/request-id';
import { created, fail } from '@/lib/http/response';
import { logEvent } from '@/lib/logging/logger';

const BodySchema = z.object({
  format: z.literal(ASSET_LEDGER_EXPORT_V1_FORMAT),
  version: z.literal(ASSET_LEDGER_EXPORT_V1_VERSION),
});

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const requestId = getOrCreateRequestId(auth.requestId);

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return fail(
      { code: ErrorCode.CONFIG_INVALID_REQUEST, category: 'config', message: 'Validation failed', retryable: false },
      400,
      { requestId },
    );
  }

  try {
    const exp = await prisma.assetLedgerExport.create({
      data: {
        requestedByUserId: auth.session.user.id,
        status: 'Queued',
        requestId,
        params: body,
      },
      select: { id: true, status: true },
    });

    logEvent({
      level: 'info',
      service: 'web',
      event_type: 'export.task_created',
      export_id: exp.id,
      user_id: auth.session.user.id,
      params: body,
    });

    return created({ exportId: exp.id, status: exp.status }, { requestId });
  } catch {
    return fail(
      { code: ErrorCode.DB_WRITE_FAILED, category: 'db', message: 'Failed to create export task', retryable: true },
      500,
      { requestId },
    );
  }
}
