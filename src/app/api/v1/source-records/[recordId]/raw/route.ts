import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { fail, ok } from '@/lib/http/response';
import { decompressRaw } from '@/lib/ingest/raw';
import { redactJsonSecrets } from '@/lib/redaction/redact-json';

export async function GET(request: Request, context: { params: Promise<{ recordId: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { recordId } = await context.params;

  const record = await prisma.sourceRecord.findFirst({
    where: { id: recordId },
    orderBy: { collectedAt: 'desc' },
    select: {
      id: true,
      collectedAt: true,
      runId: true,
      sourceId: true,
      assetUuid: true,
      raw: true,
      rawCompression: true,
      rawSizeBytes: true,
      rawHash: true,
    },
  });

  if (!record) {
    return fail(
      {
        code: ErrorCode.CONFIG_SOURCE_RECORD_NOT_FOUND,
        category: 'config',
        message: 'Source record not found',
        retryable: false,
      },
      404,
      { requestId: auth.requestId },
    );
  }

  if (record.rawCompression !== 'zstd') {
    return fail(
      { code: ErrorCode.INTERNAL_ERROR, category: 'unknown', message: 'Unsupported raw compression', retryable: false },
      500,
      { requestId: auth.requestId },
    );
  }

  const payload = await decompressRaw(record.raw);
  const redacted = redactJsonSecrets(payload);

  await prisma.auditEvent.create({
    data: {
      eventType: 'source_record.raw_viewed',
      actorUserId: auth.session.user.id,
      payload: {
        recordId,
        runId: record.runId,
        sourceId: record.sourceId,
        assetUuid: record.assetUuid,
        requestId: auth.requestId,
      },
    },
  });

  return ok(
    {
      rawPayload: redacted,
      meta: {
        hash: record.rawHash,
        sizeBytes: record.rawSizeBytes,
        compression: record.rawCompression,
        collectedAt: record.collectedAt.toISOString(),
        runId: record.runId,
        sourceId: record.sourceId,
      },
    },
    { requestId: auth.requestId },
  );
}
