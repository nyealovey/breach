import { z } from 'zod/v4';

import { requireUser } from '@/lib/auth/require-user';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { fail, ok } from '@/lib/http/response';

function encodeCursor(input: { occurredAt: Date; id: string }): string {
  const payload = JSON.stringify({ occurredAt: input.occurredAt.toISOString(), id: input.id });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { occurredAt: Date; id: string } | null {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as { occurredAt?: unknown; id?: unknown };
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.occurredAt !== 'string' || typeof parsed.id !== 'string') return null;
    const d = new Date(parsed.occurredAt);
    if (!Number.isFinite(d.getTime())) return null;
    if (!parsed.id.trim()) return null;
    return { occurredAt: d, id: parsed.id };
  } catch {
    return null;
  }
}

async function listMergedAssetUuids(primaryAssetUuid: string): Promise<string[]> {
  const visited = new Set<string>([primaryAssetUuid]);
  let frontier: string[] = [primaryAssetUuid];
  const merged: string[] = [];

  const maxDepth = 10;
  const maxTotal = 200;

  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (frontier.length === 0) break;
    if (merged.length >= maxTotal) break;

    const rows = await prisma.asset.findMany({
      where: { mergedIntoAssetUuid: { in: frontier } },
      select: { uuid: true },
      take: maxTotal - merged.length,
    });

    const next: string[] = [];
    for (const r of rows) {
      if (visited.has(r.uuid)) continue;
      visited.add(r.uuid);
      merged.push(r.uuid);
      next.push(r.uuid);
    }
    frontier = next;
  }

  return merged;
}

const QuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  types: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),
});

const ALLOWED_TYPES = new Set(['collect.changed', 'ledger_fields.changed', 'asset.merged', 'asset.status_changed']);

export async function GET(request: Request, context: { params: Promise<{ uuid: string }> }) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const { uuid } = await context.params;
  const url = new URL(request.url);

  let query: z.infer<typeof QuerySchema>;
  try {
    query = QuerySchema.parse(Object.fromEntries(url.searchParams.entries()));
  } catch {
    return fail(
      { code: ErrorCode.CONFIG_INVALID_REQUEST, category: 'config', message: 'Validation failed', retryable: false },
      400,
      { requestId: auth.requestId },
    );
  }

  const asset = await prisma.asset.findUnique({ where: { uuid }, select: { uuid: true } });
  if (!asset) {
    return fail(
      { code: ErrorCode.CONFIG_ASSET_NOT_FOUND, category: 'config', message: 'Asset not found', retryable: false },
      404,
      { requestId: auth.requestId },
    );
  }

  const mergedUuids = await listMergedAssetUuids(uuid);
  const scopeUuids = [uuid, ...mergedUuids];

  const cursor = query.cursor ? decodeCursor(query.cursor) : null;

  const requestedTypes = query.types.filter((t) => ALLOWED_TYPES.has(t));

  const where = {
    assetUuid: { in: scopeUuids },
    ...(requestedTypes.length > 0 ? { eventType: { in: requestedTypes } } : {}),
    ...(cursor
      ? {
          OR: [{ occurredAt: { lt: cursor.occurredAt } }, { occurredAt: cursor.occurredAt, id: { lt: cursor.id } }],
        }
      : {}),
  } as const;

  const rows = await prisma.assetHistoryEvent.findMany({
    where,
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    select: { id: true, assetUuid: true, eventType: true, occurredAt: true, title: true, summary: true, refs: true },
  });

  const items = rows.slice(0, query.limit).map((e) => ({
    eventId: e.id,
    assetUuid: uuid,
    sourceAssetUuid: e.assetUuid !== uuid ? e.assetUuid : null,
    eventType: e.eventType,
    occurredAt: e.occurredAt.toISOString(),
    title: e.title,
    summary: e.summary,
    refs: e.refs ?? {},
  }));

  const nextRow = rows[query.limit];
  const next = nextRow ? encodeCursor(nextRow) : null;

  return ok({ items, nextCursor: next }, { requestId: auth.requestId });
}
