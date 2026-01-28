import { describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/v1/source-records/[recordId]/raw/route';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { decompressRaw } from '@/lib/ingest/raw';

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const sourceRecord = { findFirst: vi.fn() };
  const auditEvent = { create: vi.fn() };
  return { prisma: { sourceRecord, auditEvent } };
});
vi.mock('@/lib/ingest/raw', () => ({ decompressRaw: vi.fn() }));

describe('GET /api/v1/source-records/:recordId/raw', () => {
  it('returns redacted raw payload and writes audit event', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);

    vi.mocked(prisma.sourceRecord.findFirst).mockResolvedValue({
      id: 'rec_1',
      raw: new Uint8Array([1, 2, 3]),
      rawHash: 'hash_1',
      rawSizeBytes: 3,
      rawCompression: 'zstd',
      runId: 'run_1',
      sourceId: 'src_1',
      assetUuid: '550e8400-e29b-41d4-a716-446655440000',
      collectedAt: new Date('2026-01-28T00:00:00.000Z'),
    } as any);

    vi.mocked(decompressRaw).mockResolvedValue({
      password: 'p',
      nested: { token: 't', safe: 'ok' },
    });

    vi.mocked(prisma.auditEvent.create).mockResolvedValue({ id: 'ae_1' } as any);

    const req = new Request('http://localhost/api/v1/source-records/rec_1/raw');
    const res = await GET(req, { params: Promise.resolve({ recordId: 'rec_1' }) });

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Request-ID')).toBe('req_test');

    const body = (await res.json()) as any;
    expect(body.data).toEqual({
      rawPayload: { password: '***', nested: { token: '***', safe: 'ok' } },
      meta: {
        hash: 'hash_1',
        sizeBytes: 3,
        compression: 'zstd',
        collectedAt: '2026-01-28T00:00:00.000Z',
        runId: 'run_1',
        sourceId: 'src_1',
      },
    });

    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: {
        eventType: 'source_record.raw_viewed',
        actorUserId: 'u1',
        payload: {
          recordId: 'rec_1',
          runId: 'run_1',
          sourceId: 'src_1',
          assetUuid: '550e8400-e29b-41d4-a716-446655440000',
          requestId: 'req_test',
        },
      },
    });
  });
});
