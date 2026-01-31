import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/v1/assets/[uuid]/history/route';
import { requireUser } from '@/lib/auth/require-user';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';

vi.mock('@/lib/auth/require-user', () => ({ requireUser: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const asset = { findUnique: vi.fn(), findMany: vi.fn() };
  const assetHistoryEvent = { findMany: vi.fn() };
  return { prisma: { asset, assetHistoryEvent } };
});

describe('GET /api/v1/assets/:uuid/history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when asset not found', async () => {
    (requireUser as any).mockResolvedValue({ ok: true, requestId: 'req_test', session: { user: { id: 'u1' } } });
    (prisma.asset.findUnique as any).mockResolvedValue(null);

    const req = new Request('http://localhost/api/v1/assets/a1/history');
    const res = await GET(req, { params: Promise.resolve({ uuid: 'a1' }) });
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe(ErrorCode.CONFIG_ASSET_NOT_FOUND);
  });

  it('returns items and nextCursor', async () => {
    (requireUser as any).mockResolvedValue({ ok: true, requestId: 'req_test', session: { user: { id: 'u1' } } });
    (prisma.asset.findUnique as any).mockResolvedValue({ uuid: 'a1' });
    (prisma.asset.findMany as any).mockResolvedValue([]); // no merged assets
    (prisma.assetHistoryEvent.findMany as any).mockResolvedValue([
      {
        id: 'e2',
        assetUuid: 'a1',
        eventType: 'collect.changed',
        occurredAt: new Date('2026-01-31T12:00:02Z'),
        title: '采集变化',
        summary: { changes: [] },
        refs: { runId: 'run_1' },
      },
      {
        id: 'e1',
        assetUuid: 'a1',
        eventType: 'asset.status_changed',
        occurredAt: new Date('2026-01-31T12:00:01Z'),
        title: '资产状态变化',
        summary: { before: 'in_service', after: 'offline' },
        refs: {},
      },
    ]);

    const req = new Request('http://localhost/api/v1/assets/a1/history?limit=1');
    const res = await GET(req, { params: Promise.resolve({ uuid: 'a1' }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0].eventId).toBe('e2');
    expect(typeof body.data.nextCursor).toBe('string');
  });
});
