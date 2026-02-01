import { describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/v1/source-records/[recordId]/normalized/route';
import { requireUser } from '@/lib/auth/require-user';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/auth/require-user', () => ({ requireUser: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const sourceRecord = { findFirst: vi.fn() };
  return { prisma: { sourceRecord } };
});

describe('GET /api/v1/source-records/:recordId/normalized', () => {
  it('returns auth response when requireUser fails', async () => {
    (requireUser as any).mockResolvedValue({ ok: false, response: new Response('unauthorized', { status: 401 }) });

    const req = new Request('http://localhost/api/v1/source-records/rec_1/normalized');
    const res = await GET(req, { params: Promise.resolve({ recordId: 'rec_1' }) });
    expect(res.status).toBe(401);
  });

  it('returns 404 when record does not exist', async () => {
    (requireUser as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);

    (prisma.sourceRecord.findFirst as any).mockResolvedValue(null);

    const req = new Request('http://localhost/api/v1/source-records/rec_404/normalized');
    const res = await GET(req, { params: Promise.resolve({ recordId: 'rec_404' }) });
    expect(res.status).toBe(404);
  });

  it('returns normalized payload and meta with request id header', async () => {
    (requireUser as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);

    (prisma.sourceRecord.findFirst as any).mockResolvedValue({
      id: 'rec_1',
      collectedAt: new Date('2026-01-28T00:00:00.000Z'),
      runId: 'run_1',
      sourceId: 'src_1',
      assetUuid: '550e8400-e29b-41d4-a716-446655440000',
      externalKind: 'vm',
      externalId: 'vm-123',
      normalized: { version: 'normalized-v1', kind: 'vm', identity: { hostname: 'vm-01' } },
    } as any);

    const req = new Request('http://localhost/api/v1/source-records/rec_1/normalized');
    const res = await GET(req, { params: Promise.resolve({ recordId: 'rec_1' }) });

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Request-ID')).toBe('req_test');

    const body = (await res.json()) as any;
    expect(body.data).toEqual({
      normalizedPayload: { version: 'normalized-v1', kind: 'vm', identity: { hostname: 'vm-01' } },
      meta: {
        recordId: 'rec_1',
        assetUuid: '550e8400-e29b-41d4-a716-446655440000',
        collectedAt: '2026-01-28T00:00:00.000Z',
        runId: 'run_1',
        sourceId: 'src_1',
        externalKind: 'vm',
        externalId: 'vm-123',
      },
    });
  });
});
