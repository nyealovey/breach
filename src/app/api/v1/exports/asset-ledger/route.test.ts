import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/v1/exports/asset-ledger/route';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const assetLedgerExport = { create: vi.fn() };
  return { prisma: { assetLedgerExport } };
});
vi.mock('@/lib/logging/logger', () => ({ logEvent: vi.fn() }));

describe('POST /api/v1/exports/asset-ledger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 when not admin', async () => {
    (requireAdmin as any).mockResolvedValue({ ok: false, response: new Response('forbidden', { status: 403 }) });

    const req = new Request('http://localhost/api/v1/exports/asset-ledger', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ format: 'csv', version: 'asset-ledger-export-v1' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it('returns 400 when body invalid', async () => {
    (requireAdmin as any).mockResolvedValue({ ok: true, requestId: 'req_test', session: { user: { id: 'u1' } } });

    const req = new Request('http://localhost/api/v1/exports/asset-ledger', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ format: 'xlsx', version: 'asset-ledger-export-v1' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe(ErrorCode.CONFIG_INVALID_REQUEST);
  });

  it('creates export task and returns 201', async () => {
    (requireAdmin as any).mockResolvedValue({ ok: true, requestId: 'req_test', session: { user: { id: 'u1' } } });
    (prisma.assetLedgerExport.create as any).mockResolvedValue({ id: 'exp_1', status: 'Queued' });

    const req = new Request('http://localhost/api/v1/exports/asset-ledger', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ format: 'csv', version: 'asset-ledger-export-v1' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(prisma.assetLedgerExport.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requestedByUserId: 'u1',
          status: 'Queued',
          requestId: 'req_test',
          params: { format: 'csv', version: 'asset-ledger-export-v1' },
        }),
      }),
    );

    const body = (await res.json()) as any;
    expect(body.data).toEqual({ exportId: 'exp_1', status: 'Queued' });
  });
});
