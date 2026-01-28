import { describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/v1/assets/[uuid]/route';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const asset = { findUnique: vi.fn() };
  const assetRunSnapshot = { findFirst: vi.fn() };
  return { prisma: { asset, assetRunSnapshot } };
});

describe('GET /api/v1/assets/:uuid', () => {
  it('returns 404 when asset missing', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);
    vi.mocked(prisma.asset.findUnique).mockResolvedValue(null);

    const req = new Request('http://localhost/api/v1/assets/550e8400-e29b-41d4-a716-446655440000');
    const res = await GET(req, { params: Promise.resolve({ uuid: '550e8400-e29b-41d4-a716-446655440000' }) });

    expect(res.status).toBe(404);
    expect(res.headers.get('X-Request-ID')).toBe('req_test');

    const body = (await res.json()) as any;
    expect(body.error.code).toBe('CONFIG_ASSET_NOT_FOUND');
  });

  it('returns asset and latest canonical snapshot', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);

    vi.mocked(prisma.asset.findUnique).mockResolvedValue({
      uuid: '550e8400-e29b-41d4-a716-446655440000',
      assetType: 'vm',
      status: 'in_service',
      displayName: 'vm-01',
      lastSeenAt: new Date('2026-01-28T00:00:00.000Z'),
    } as any);

    vi.mocked(prisma.assetRunSnapshot.findFirst).mockResolvedValue({
      runId: 'run_1',
      canonical: { version: 'canonical-v1', asset_uuid: '550e8400-e29b-41d4-a716-446655440000' },
      createdAt: new Date('2026-01-28T00:10:00.000Z'),
    } as any);

    const req = new Request('http://localhost/api/v1/assets/550e8400-e29b-41d4-a716-446655440000');
    const res = await GET(req, { params: Promise.resolve({ uuid: '550e8400-e29b-41d4-a716-446655440000' }) });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toEqual({
      assetUuid: '550e8400-e29b-41d4-a716-446655440000',
      assetType: 'vm',
      status: 'in_service',
      displayName: 'vm-01',
      lastSeenAt: '2026-01-28T00:00:00.000Z',
      latestSnapshot: {
        runId: 'run_1',
        createdAt: '2026-01-28T00:10:00.000Z',
        canonical: { version: 'canonical-v1', asset_uuid: '550e8400-e29b-41d4-a716-446655440000' },
      },
    });
  });
});
