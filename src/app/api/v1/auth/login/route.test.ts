import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/v1/auth/login/route';
import { bootstrapAdmin } from '@/lib/auth/bootstrap-admin';
import { verifyPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/auth/bootstrap-admin', () => ({ bootstrapAdmin: vi.fn() }));
vi.mock('@/lib/auth/password', () => ({ verifyPassword: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ createSession: vi.fn() }));
vi.mock('@/lib/crypto/aes-gcm', () => ({ decryptJson: vi.fn() }));
vi.mock('@/lib/auth/ldap', () => ({
  parseLdapAuthConfig: vi.fn(),
  verifyLdapPassword: vi.fn(),
}));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    source: { findMany: vi.fn() },
  },
}));

describe('POST /api/v1/auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows local admin login', async () => {
    (bootstrapAdmin as any).mockResolvedValue(undefined);
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'u_admin',
      username: 'admin',
      role: 'admin',
      authType: 'local',
      passwordHash: 'hash',
      enabled: true,
    });
    (verifyPassword as any).mockResolvedValue(true);
    (createSession as any).mockResolvedValue({
      sessionId: 's_1',
      cookieValue: 'cookie',
      expiresAt: new Date('2026-02-10T00:00:00.000Z'),
    });

    const req = new Request('http://localhost/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'secret' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toMatchObject({ userId: 'u_admin', username: 'admin', role: 'admin', authType: 'local' });
  });

  it('rejects ldap login when user is not in local whitelist', async () => {
    (prisma.user.findUnique as any).mockResolvedValue(null);
    (prisma.user.findFirst as any).mockResolvedValue(null);

    const req = new Request('http://localhost/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'user@example.com', password: 'secret' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.error?.code).toBe('AUTH_INVALID_CREDENTIALS');
  });
});
