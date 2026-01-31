import { describe, expect, it, vi } from 'vitest';

import { GET, PUT } from '@/app/api/v1/assets/[uuid]/route';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const asset = { findUnique: vi.fn(), update: vi.fn() };
  const assetRunSnapshot = { findFirst: vi.fn() };
  return { prisma: { asset, assetRunSnapshot } };
});

describe('GET /api/v1/assets/:uuid', () => {
  it('returns 404 when asset missing', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);
    (prisma.asset.findUnique as any).mockResolvedValue(null);

    const req = new Request('http://localhost/api/v1/assets/550e8400-e29b-41d4-a716-446655440000');
    const res = await GET(req, { params: Promise.resolve({ uuid: '550e8400-e29b-41d4-a716-446655440000' }) });

    expect(res.status).toBe(404);
    expect(res.headers.get('X-Request-ID')).toBe('req_test');

    const body = (await res.json()) as any;
    expect(body.error.code).toBe('CONFIG_ASSET_NOT_FOUND');
  });

  it('returns asset and latest canonical snapshot', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);

    (prisma.asset.findUnique as any).mockResolvedValue({
      uuid: '550e8400-e29b-41d4-a716-446655440000',
      assetType: 'vm',
      status: 'in_service',
      displayName: 'vm-01',
      machineNameOverride: null,
      lastSeenAt: new Date('2026-01-28T00:00:00.000Z'),
    } as any);

    (prisma.assetRunSnapshot.findFirst as any).mockResolvedValue({
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
      mergedIntoAssetUuid: null,
      displayName: 'vm-01',
      machineNameOverride: null,
      lastSeenAt: '2026-01-28T00:00:00.000Z',
      latestSnapshot: {
        runId: 'run_1',
        createdAt: '2026-01-28T00:10:00.000Z',
        canonical: { version: 'canonical-v1', asset_uuid: '550e8400-e29b-41d4-a716-446655440000' },
      },
    });
  });
});

describe('PUT /api/v1/assets/:uuid', () => {
  it('returns 400 when body invalid', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);

    const req = new Request('http://localhost/api/v1/assets/550e8400-e29b-41d4-a716-446655440000', {
      method: 'PUT',
      body: 'not-json',
    });
    const res = await PUT(req, { params: Promise.resolve({ uuid: '550e8400-e29b-41d4-a716-446655440000' }) });

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('CONFIG_INVALID_REQUEST');
  });

  it('returns 404 when asset missing', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);
    (prisma.asset.findUnique as any).mockResolvedValue(null);

    const req = new Request('http://localhost/api/v1/assets/550e8400-e29b-41d4-a716-446655440000', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ machineNameOverride: 'vm-guest-01' }),
    });
    const res = await PUT(req, { params: Promise.resolve({ uuid: '550e8400-e29b-41d4-a716-446655440000' }) });

    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('CONFIG_ASSET_NOT_FOUND');
  });

  it('trims and updates machineNameOverride', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);
    (prisma.asset.findUnique as any).mockResolvedValue({ uuid: '550e8400-e29b-41d4-a716-446655440000' });
    (prisma.asset.update as any).mockResolvedValue({
      uuid: '550e8400-e29b-41d4-a716-446655440000',
      machineNameOverride: 'vm-guest-01',
      updatedAt: new Date('2026-01-29T00:00:00.000Z'),
    });

    const req = new Request('http://localhost/api/v1/assets/550e8400-e29b-41d4-a716-446655440000', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ machineNameOverride: '  vm-guest-01  ' }),
    });
    const res = await PUT(req, { params: Promise.resolve({ uuid: '550e8400-e29b-41d4-a716-446655440000' }) });

    expect(prisma.asset.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { machineNameOverride: 'vm-guest-01' } }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toEqual({
      assetUuid: '550e8400-e29b-41d4-a716-446655440000',
      machineNameOverride: 'vm-guest-01',
    });
  });
});
