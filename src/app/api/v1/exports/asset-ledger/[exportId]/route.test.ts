import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/v1/exports/asset-ledger/[exportId]/route';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const assetLedgerExport = { findUnique: vi.fn() };
  return { prisma: { assetLedgerExport } };
});

describe('GET /api/v1/exports/asset-ledger/:exportId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when export not found', async () => {
    (requireAdmin as any).mockResolvedValue({ ok: true, requestId: 'req_test', session: { user: { id: 'u1' } } });
    (prisma.assetLedgerExport.findUnique as any).mockResolvedValue(null);

    const req = new Request('http://localhost/api/v1/exports/asset-ledger/exp_missing');
    const res = await GET(req, { params: Promise.resolve({ exportId: 'exp_missing' }) });
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe(ErrorCode.CONFIG_EXPORT_NOT_FOUND);
  });

  it('returns status payload', async () => {
    (requireAdmin as any).mockResolvedValue({ ok: true, requestId: 'req_test', session: { user: { id: 'u1' } } });
    (prisma.assetLedgerExport.findUnique as any).mockResolvedValue({
      id: 'exp_1',
      status: 'Succeeded',
      requestId: 'req_test',
      params: { format: 'csv', version: 'asset-ledger-export-v1' },
      rowCount: 2,
      fileName: 'asset-ledger-export-20260131-120000.csv',
      fileSizeBytes: 123,
      fileSha256: 'sha',
      error: null,
      createdAt: new Date('2026-01-31T12:00:00Z'),
      startedAt: new Date('2026-01-31T12:00:01Z'),
      finishedAt: new Date('2026-01-31T12:00:02Z'),
      expiresAt: null,
    });

    const req = new Request('http://localhost/api/v1/exports/asset-ledger/exp_1');
    const res = await GET(req, { params: Promise.resolve({ exportId: 'exp_1' }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toEqual({
      exportId: 'exp_1',
      status: 'Succeeded',
      createdAt: '2026-01-31T12:00:00.000Z',
      startedAt: '2026-01-31T12:00:01.000Z',
      finishedAt: '2026-01-31T12:00:02.000Z',
      rowCount: 2,
      fileName: 'asset-ledger-export-20260131-120000.csv',
      fileSizeBytes: 123,
      fileSha256: 'sha',
      error: null,
      expiresAt: null,
    });
  });
});
