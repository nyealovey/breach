import { describe, expect, it, vi } from 'vitest';

import { GET, POST } from '@/app/api/v1/credentials/route';
import { requireAdmin } from '@/lib/auth/require-admin';
import { encryptJson } from '@/lib/crypto/aes-gcm';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const credential = {
    count: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
  };
  const source = {
    groupBy: vi.fn(),
  };

  return {
    prisma: {
      credential,
      source,
      $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
    },
  };
});

describe('GET /api/v1/credentials', () => {
  it('returns okPaginated with usageCount and request id header', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);

    (prisma.credential.count as any).mockResolvedValue(1);
    (prisma.credential.findMany as any).mockResolvedValue([
      {
        id: 'c1',
        name: 'cred-1',
        type: 'vcenter',
        payloadCiphertext: encryptJson({ username: 'vc_user', password: 'p' }),
        createdAt: new Date('2026-01-29T00:00:00.000Z'),
        updatedAt: new Date('2026-01-29T00:00:00.000Z'),
      },
    ] as any);
    (prisma.source.groupBy as any).mockResolvedValue([{ credentialId: 'c1', _count: { _all: 2 } }] as any);

    const req = new Request('http://localhost/api/v1/credentials?page=1&pageSize=20');
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Request-ID')).toBe('req_test');

    const body = (await res.json()) as any;
    expect(body.pagination).toEqual({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
    expect(body.data).toEqual([
      {
        credentialId: 'c1',
        name: 'cred-1',
        type: 'vcenter',
        account: 'vc_user',
        usageCount: 2,
        createdAt: '2026-01-29T00:00:00.000Z',
        updatedAt: '2026-01-29T00:00:00.000Z',
      },
    ]);
  });
});

describe('POST /api/v1/credentials', () => {
  it('returns 409 when name already exists (P2002)', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);

    (prisma.credential.create as any).mockRejectedValue({ code: 'P2002' });

    const req = new Request('http://localhost/api/v1/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'cred-1', type: 'vcenter', payload: { username: 'u', password: 'p' } }),
    });
    const res = await POST(req);

    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('CONFIG_DUPLICATE_NAME');
  });
});
