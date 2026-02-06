import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/v1/exports/asset-ledger/[exportId]/download/route';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const assetLedgerExport = { findUnique: vi.fn(), update: vi.fn() };
  const prismaMock = { assetLedgerExport };
  return {
    prisma: {
      ...prismaMock,
      $transaction: vi.fn(async (cb: any) => cb(prismaMock)),
    },
  };
});
vi.mock('@/lib/logging/logger', () => ({ logEvent: vi.fn() }));

describe('GET /api/v1/exports/asset-ledger/:exportId/download', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 204 and does not consume export for prefetch requests', async () => {
    (requireAdmin as any).mockResolvedValue({ ok: true, requestId: 'req_test', session: { user: { id: 'u1' } } });

    const req = new Request('http://localhost/api/v1/exports/asset-ledger/exp_1/download', {
      headers: { purpose: 'prefetch' },
    });
    const res = await GET(req, { params: Promise.resolve({ exportId: 'exp_1' }) });

    expect(res.status).toBe(204);
    expect(prisma.assetLedgerExport.findUnique).not.toHaveBeenCalled();
    expect(prisma.assetLedgerExport.update).not.toHaveBeenCalled();
  });

  it('returns 410 when export expired', async () => {
    (requireAdmin as any).mockResolvedValue({ ok: true, requestId: 'req_test', session: { user: { id: 'u1' } } });
    (prisma.assetLedgerExport.findUnique as any).mockResolvedValue({
      id: 'exp_1',
      status: 'Expired',
      fileBytes: null,
      fileName: null,
    });

    const req = new Request('http://localhost/api/v1/exports/asset-ledger/exp_1/download');
    const res = await GET(req, { params: Promise.resolve({ exportId: 'exp_1' }) });
    expect(res.status).toBe(410);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe(ErrorCode.CONFIG_EXPORT_EXPIRED);
  });

  it('returns csv and marks export expired', async () => {
    (requireAdmin as any).mockResolvedValue({ ok: true, requestId: 'req_test', session: { user: { id: 'u1' } } });
    (prisma.assetLedgerExport.findUnique as any).mockResolvedValue({
      id: 'exp_1',
      status: 'Succeeded',
      fileBytes: Buffer.from('a,b\n', 'utf8'),
      fileName: 'asset-ledger-export-20260131-120000.csv',
    });
    (prisma.assetLedgerExport.update as any).mockResolvedValue({ id: 'exp_1' });

    const req = new Request('http://localhost/api/v1/exports/asset-ledger/exp_1/download');
    const res = await GET(req, { params: Promise.resolve({ exportId: 'exp_1' }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('asset-ledger-export-20260131-120000.csv');

    expect(prisma.assetLedgerExport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'exp_1' },
        data: expect.objectContaining({ status: 'Expired', fileBytes: null }),
      }),
    );

    const text = await res.text();
    expect(text).toBe('a,b\n');
  });
});
