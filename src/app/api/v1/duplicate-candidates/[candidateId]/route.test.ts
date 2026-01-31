import { describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/v1/duplicate-candidates/[candidateId]/route';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const duplicateCandidate = {
    findUnique: vi.fn(),
  };
  const assetSourceLink = {
    findMany: vi.fn(),
  };

  return { prisma: { duplicateCandidate, assetSourceLink } };
});

describe('GET /api/v1/duplicate-candidates/:candidateId', () => {
  it('returns 404 when candidate is not found', async () => {
    (requireAdmin as any).mockResolvedValue({ ok: true, requestId: 'req_test', session: { user: { id: 'u1' } } });
    (prisma.duplicateCandidate.findUnique as any).mockResolvedValue(null);

    const req = new Request('http://localhost/api/v1/duplicate-candidates/dc_missing');
    const res = await GET(req, { params: Promise.resolve({ candidateId: 'dc_missing' }) });

    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe(ErrorCode.CONFIG_DUPLICATE_CANDIDATE_NOT_FOUND);
  });

  it('returns detail with per-source presenceStatus', async () => {
    (requireAdmin as any).mockResolvedValue({ ok: true, requestId: 'req_test', session: { user: { id: 'u1' } } });

    (prisma.duplicateCandidate.findUnique as any).mockResolvedValue({
      id: 'dc_1',
      status: 'open',
      score: 90,
      reasons: { version: 'dup-rules-v1', matched_rules: [{ code: 'vm.mac_overlap', weight: 90, evidence: {} }] },
      lastObservedAt: new Date('2026-01-31T00:00:00.000Z'),
      createdAt: new Date('2026-01-30T00:00:00.000Z'),
      updatedAt: new Date('2026-01-31T00:00:00.000Z'),
      assetUuidA: 'a',
      assetUuidB: 'b',
      assetA: { uuid: 'a', displayName: 'vm-a', assetType: 'vm', status: 'in_service', lastSeenAt: null },
      assetB: { uuid: 'b', displayName: 'vm-b', assetType: 'vm', status: 'offline', lastSeenAt: null },
    });

    (prisma.assetSourceLink.findMany as any).mockResolvedValue([
      {
        assetUuid: 'a',
        sourceId: 's1',
        externalKind: 'vm',
        externalId: 'vm-1',
        presenceStatus: 'present',
        lastSeenAt: new Date('2026-01-31T00:00:00.000Z'),
        lastSeenRunId: 'run_1',
        source: { id: 's1', name: 'vCenter 1' },
      },
      {
        assetUuid: 'b',
        sourceId: 's1',
        externalKind: 'vm',
        externalId: 'vm-2',
        presenceStatus: 'missing',
        lastSeenAt: new Date('2026-01-30T00:00:00.000Z'),
        lastSeenRunId: 'run_0',
        source: { id: 's1', name: 'vCenter 1' },
      },
    ]);

    const req = new Request('http://localhost/api/v1/duplicate-candidates/dc_1');
    const res = await GET(req, { params: Promise.resolve({ candidateId: 'dc_1' }) });

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Request-ID')).toBe('req_test');

    const body = (await res.json()) as any;
    expect(body.data).toMatchObject({
      candidateId: 'dc_1',
      score: 90,
      confidence: 'High',
      assetA: { assetUuid: 'a', assetType: 'vm' },
      assetB: { assetUuid: 'b', assetType: 'vm' },
    });
    expect(body.data.assetA.sourceLinks).toHaveLength(1);
    expect(body.data.assetA.sourceLinks[0]).toMatchObject({ sourceId: 's1', presenceStatus: 'present' });
  });
});
