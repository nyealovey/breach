import { describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/v1/signals/solarwinds/links/[linkId]/bind/route';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const assetSignalLink = { findUnique: vi.fn(), update: vi.fn() };
  const asset = { findUnique: vi.fn() };
  const signalRecord = { findFirst: vi.fn() };
  const assetOperationalState = { upsert: vi.fn() };

  return { prisma: { assetSignalLink, asset, signalRecord, assetOperationalState } };
});

describe('POST /api/v1/signals/solarwinds/links/:linkId/bind', () => {
  it('binds link to asset and updates operational state', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);

    (prisma.assetSignalLink.findUnique as any).mockResolvedValue({
      id: 'link1',
      assetUuid: null,
      source: { sourceType: 'solarwinds' },
    });
    (prisma.asset.findUnique as any).mockResolvedValue({ uuid: 'a1', status: 'in_service' });
    (prisma.assetSignalLink.update as any).mockResolvedValue({
      id: 'link1',
      assetUuid: 'a1',
      sourceId: 'src_sw',
      externalKind: 'host',
      externalId: '123',
      lastSeenAt: new Date('2026-02-06T00:00:00.000Z'),
    });
    (prisma.signalRecord.findFirst as any).mockResolvedValue({
      normalized: { attributes: { monitor_status: 'up', monitor_status_raw: 'Up' } },
      collectedAt: new Date('2026-02-06T00:00:00.000Z'),
    });

    const req = new Request('http://localhost/api/v1/signals/solarwinds/links/link1/bind', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assetUuid: 'a1' }),
    });
    const res = await POST(req, { params: Promise.resolve({ linkId: 'link1' }) });

    expect(res.status).toBe(200);
    expect(prisma.assetOperationalState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assetUuid: 'a1' },
        update: expect.objectContaining({ monitorCovered: true, monitorState: 'up', monitorStatus: 'Up' }),
      }),
    );

    const body = (await res.json()) as any;
    expect(body.data).toEqual({ linkId: 'link1', assetUuid: 'a1' });
  });
});
