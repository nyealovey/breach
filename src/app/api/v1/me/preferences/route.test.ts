import { describe, expect, it, vi } from 'vitest';

import { GET, PUT } from '@/app/api/v1/me/preferences/route';
import { requireUser } from '@/lib/auth/require-user';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';

vi.mock('@/lib/auth/require-user', () => ({ requireUser: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const userPreference = {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  };

  return { prisma: { userPreference } };
});

describe('GET /api/v1/me/preferences', () => {
  it('returns 400 when key is missing', async () => {
    (requireUser as any).mockResolvedValue({ ok: true, requestId: 'req_test', session: { user: { id: 'u1' } } });

    const req = new Request('http://localhost/api/v1/me/preferences');
    const res = await GET(req);

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe(ErrorCode.CONFIG_INVALID_REQUEST);
  });

  it('returns 404 when preference is not found', async () => {
    (requireUser as any).mockResolvedValue({ ok: true, requestId: 'req_test', session: { user: { id: 'u1' } } });
    (prisma.userPreference.findUnique as any).mockResolvedValue(null);

    const req = new Request('http://localhost/api/v1/me/preferences?key=assets.table.columns.v1');
    const res = await GET(req);

    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe(ErrorCode.CONFIG_PREFERENCE_NOT_FOUND);
  });

  it('returns 200 with preference value', async () => {
    (requireUser as any).mockResolvedValue({ ok: true, requestId: 'req_test', session: { user: { id: 'u1' } } });
    (prisma.userPreference.findUnique as any).mockResolvedValue({
      id: 'pref_1',
      userId: 'u1',
      key: 'assets.table.columns.v1',
      value: { visibleColumns: ['machineName', 'ip'] },
    });

    const req = new Request('http://localhost/api/v1/me/preferences?key=assets.table.columns.v1');
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Request-ID')).toBe('req_test');

    const body = (await res.json()) as any;
    expect(body.data).toEqual({ key: 'assets.table.columns.v1', value: { visibleColumns: ['machineName', 'ip'] } });
  });
});

describe('PUT /api/v1/me/preferences', () => {
  it('returns 400 when value schema is invalid', async () => {
    (requireUser as any).mockResolvedValue({ ok: true, requestId: 'req_test', session: { user: { id: 'u1' } } });

    const req = new Request('http://localhost/api/v1/me/preferences', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'assets.table.columns.v1', value: { visibleColumns: [] } }),
    });
    const res = await PUT(req);

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe(ErrorCode.CONFIG_INVALID_REQUEST);
  });

  it('upserts preference and returns 200', async () => {
    (requireUser as any).mockResolvedValue({ ok: true, requestId: 'req_test', session: { user: { id: 'u1' } } });

    (prisma.userPreference.upsert as any).mockResolvedValue({
      id: 'pref_1',
      userId: 'u1',
      key: 'assets.table.columns.v1',
      value: { visibleColumns: ['machineName'] },
    });

    const req = new Request('http://localhost/api/v1/me/preferences', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'assets.table.columns.v1', value: { visibleColumns: ['machineName'] } }),
    });

    const res = await PUT(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Request-ID')).toBe('req_test');

    expect(prisma.userPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_key: { userId: 'u1', key: 'assets.table.columns.v1' } },
      }),
    );

    const body = (await res.json()) as any;
    expect(body.data).toEqual({ key: 'assets.table.columns.v1', value: { visibleColumns: ['machineName'] } });
  });
});
