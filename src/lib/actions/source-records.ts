'use server';

import { requireServerAdminSession, requireServerSession } from '@/lib/auth/require-server-session';
import { actionError, actionOk, getActionErrorMessage } from '@/lib/actions/action-result';
import { prisma } from '@/lib/db/prisma';
import { decompressRaw } from '@/lib/ingest/raw';
import { redactJsonSecrets } from '@/lib/redaction/redact-json';

import type { ActionResult } from '@/lib/actions/action-result';

export type SourceRecordRawResult = {
  rawPayload: unknown;
  meta: {
    hash: string;
    sizeBytes: number;
    compression: string;
    collectedAt: string;
    runId: string;
    sourceId: string;
  };
};

export type SourceRecordNormalizedResult = {
  normalizedPayload: unknown;
  meta: {
    recordId: string;
    assetUuid: string | null;
    collectedAt: string;
    runId: string;
    sourceId: string;
    externalKind: string | null;
    externalId: string | null;
  };
};

export async function getSourceRecordRawAction(recordId: string): Promise<ActionResult<SourceRecordRawResult>> {
  const session = await requireServerAdminSession();

  const id = recordId.trim();
  if (!id) return actionError('Invalid recordId');

  try {
    const record = await prisma.sourceRecord.findFirst({
      where: { id },
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

    if (!record) return actionError('Source record not found');
    if (record.rawCompression !== 'zstd') return actionError('Unsupported raw compression');

    const payload = await decompressRaw(record.raw);
    const redacted = redactJsonSecrets(payload);

    await prisma.auditEvent.create({
      data: {
        eventType: 'source_record.raw_viewed',
        actorUserId: session.user.id,
        payload: { recordId: id, runId: record.runId, sourceId: record.sourceId, assetUuid: record.assetUuid },
      },
    });

    return actionOk({
      rawPayload: redacted,
      meta: {
        hash: record.rawHash,
        sizeBytes: record.rawSizeBytes,
        compression: record.rawCompression,
        collectedAt: record.collectedAt.toISOString(),
        runId: record.runId,
        sourceId: record.sourceId,
      },
    });
  } catch (err) {
    return actionError(getActionErrorMessage(err, 'Failed to load raw payload'));
  }
}

export async function getSourceRecordNormalizedAction(
  recordId: string,
): Promise<ActionResult<SourceRecordNormalizedResult>> {
  await requireServerSession();

  const id = recordId.trim();
  if (!id) return actionError('Invalid recordId');

  try {
    const record = await prisma.sourceRecord.findFirst({
      where: { id },
      orderBy: { collectedAt: 'desc' },
      select: {
        id: true,
        collectedAt: true,
        runId: true,
        sourceId: true,
        assetUuid: true,
        externalKind: true,
        externalId: true,
        normalized: true,
      },
    });

    if (!record) return actionError('Source record not found');

    return actionOk({
      normalizedPayload: record.normalized,
      meta: {
        recordId: record.id,
        assetUuid: record.assetUuid,
        collectedAt: record.collectedAt.toISOString(),
        runId: record.runId,
        sourceId: record.sourceId,
        externalKind: record.externalKind,
        externalId: record.externalId,
      },
    });
  } catch (err) {
    return actionError(getActionErrorMessage(err, 'Failed to load normalized payload'));
  }
}
