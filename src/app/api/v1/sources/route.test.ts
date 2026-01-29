import { describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/v1/sources/route';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    source: { findFirst: vi.fn(), create: vi.fn() },
    scheduleGroup: { findUnique: vi.fn() },
    credential: { findUnique: vi.fn() },
  },
}));

describe('POST /api/v1/sources', () => {
  it('returns 404 when credentialId does not exist', async () => {
    (requireAdmin as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);
    (prisma.source.findFirst as any).mockResolvedValue(null as any);
    (prisma.scheduleGroup.findUnique as any).mockResolvedValue({ id: 'g1' } as any);
    (prisma.credential.findUnique as any).mockResolvedValue(null as any);

    const req = new Request('http://localhost/api/v1/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 's1',
        sourceType: 'vcenter',
        scheduleGroupId: 'g1',
        enabled: true,
        config: { endpoint: 'https://example.invalid' },
        credentialId: 'c1',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('CONFIG_CREDENTIAL_NOT_FOUND');
  });
});

