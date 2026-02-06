import { describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/v1/signals/solarwinds/links/[linkId]/unbind/route';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const assetSignalLink = { findUnique: vi.fn(), update: vi.fn(), count: vi.fn() };
  const assetOperationalState = { upsert: vi.fn() };

  return { prisma: { assetSignalLink, assetOperationalState } };
});

describe('POST /api/v1/signals/solarwinds/links/:linkId/unbind', () => {
  it('clears manual binding and resets operational state when no remaining links', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);

    (prisma.assetSignalLink.findUnique as any).mockResolvedValue({
      id: 'link1',
      assetUuid: 'a1',
      source: { sourceType: 'solarwinds' },
    });
    (prisma.assetSignalLink.update as any).mockResolvedValue({ id: 'link1', assetUuid: null });
    (prisma.assetSignalLink.count as any).mockResolvedValue(0);

    const req = new Request('http://localhost/api/v1/signals/solarwinds/links/link1/unbind', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ linkId: 'link1' }) });

    expect(res.status).toBe(200);
    expect(prisma.assetOperationalState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assetUuid: 'a1' },
        update: expect.objectContaining({ monitorCovered: null }),
      }),
    );
  });
});
