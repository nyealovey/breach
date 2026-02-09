'use server';

import { z } from 'zod/v4';

import { requireServerAdminSession } from '@/lib/auth/require-server-session';
import { actionError, actionOk, getActionErrorMessage } from '@/lib/actions/action-result';
import { prisma } from '@/lib/db/prisma';
import { ASSET_LEDGER_EXPORT_V1_FORMAT, ASSET_LEDGER_EXPORT_V1_VERSION } from '@/lib/exports/asset-ledger-export-v1';
import { getOrCreateRequestId } from '@/lib/http/request-id';
import { logEvent } from '@/lib/logging/logger';

import type { ActionResult } from '@/lib/actions/action-result';

const BodySchema = z.object({
  format: z.literal(ASSET_LEDGER_EXPORT_V1_FORMAT),
  version: z.literal(ASSET_LEDGER_EXPORT_V1_VERSION),
});

export async function createAssetLedgerExportAction(
  input: unknown,
): Promise<ActionResult<{ exportId: string; status: string }>> {
  const session = await requireServerAdminSession();
  const requestId = getOrCreateRequestId(undefined);

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(input);
  } catch {
    return actionError('Validation failed');
  }

  try {
    const exp = await prisma.assetLedgerExport.create({
      data: { requestedByUserId: session.user.id, status: 'Queued', requestId, params: body },
      select: { id: true, status: true },
    });

    logEvent({
      level: 'info',
      service: 'web',
      event_type: 'export.task_created',
      export_id: exp.id,
      user_id: session.user.id,
      params: body,
      request_id: requestId,
    });

    return actionOk({ exportId: exp.id, status: exp.status });
  } catch (err) {
    return actionError(getActionErrorMessage(err, 'Failed to create export task'));
  }
}
