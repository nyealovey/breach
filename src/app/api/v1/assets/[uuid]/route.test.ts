import { describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/v1/assets/[uuid]/route';
import { requireUser } from '@/lib/auth/require-user';
import { prisma } from '@/lib/db/prisma';
import { decompressRaw } from '@/lib/ingest/raw';

vi.mock('@/lib/auth/require-user', () => ({ requireUser: vi.fn() }));
vi.mock('@/lib/ingest/raw', () => ({ decompressRaw: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    asset: { findUnique: vi.fn() },
    assetRunSnapshot: { findFirst: vi.fn() },
    signalRecord: { findFirst: vi.fn() },
  },
}));

describe('GET /api/v1/assets/:uuid', () => {
  it('returns operationalState backup fields and backupLast7 from latest veeam signal', async () => {
    (requireUser as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);

    (prisma.asset.findUnique as any).mockResolvedValue({
      uuid: '550e8400-e29b-41d4-a716-446655440000',
      assetType: 'vm',
      status: 'in_service',
      mergedIntoAssetUuid: null,
      displayName: 'vm-01',
      machineNameOverride: null,
      ipOverrideText: null,
      osOverrideText: null,
      lastSeenAt: new Date('2026-02-06T00:00:00.000Z'),
      operationalState: {
        monitorCovered: true,
        monitorState: 'up',
        monitorStatus: 'Up',
        monitorUpdatedAt: new Date('2026-02-06T00:00:00.000Z'),
        backupCovered: true,
        backupState: 'success',
        backupLastSuccessAt: new Date('2026-02-05T00:00:00.000Z'),
        backupLastResult: 'Success: OK',
        backupUpdatedAt: new Date('2026-02-06T00:00:00.000Z'),
      },
      ledgerFields: null,
    } as any);

    (prisma.assetRunSnapshot.findFirst as any).mockResolvedValue(null);

    (prisma.signalRecord.findFirst as any).mockResolvedValue({
      collectedAt: new Date('2026-02-06T00:00:00.000Z'),
      raw: Buffer.from('raw'),
      rawCompression: 'zstd',
    } as any);

    (decompressRaw as any).mockResolvedValue({
      history_last7: [
        {
          end_time: '2026-02-05T00:00:00.000Z',
          result: 'Success',
          message: 'OK',
          job_name: 'Job A',
        },
      ],
    });

    const req = new Request('http://localhost/api/v1/assets/550e8400-e29b-41d4-a716-446655440000');
    const res = await GET(req, { params: Promise.resolve({ uuid: '550e8400-e29b-41d4-a716-446655440000' }) } as any);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    expect(body.data.operationalState.backupCovered).toBe(true);
    expect(body.data.operationalState.backupState).toBe('success');
    expect(body.data.backupLast7).toHaveLength(1);
    expect(body.data.backupLast7[0]).toMatchObject({ result: 'Success', job_name: 'Job A' });
  });
});
