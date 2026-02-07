import { describe, expect, it, vi } from 'vitest';

import { PUT } from '@/app/api/v1/auth/password/route';
import { getSessionFromRequest } from '@/lib/auth/session';

vi.mock('@/lib/auth/session', () => ({
  getSessionFromRequest: vi.fn(),
  createSession: vi.fn(),
  destroySession: vi.fn(),
}));
vi.mock('@/lib/auth/password', () => ({ hashPassword: vi.fn(), verifyPassword: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { $transaction: vi.fn() } }));

describe('PUT /api/v1/auth/password', () => {
  it('rejects ldap users with AUTH_PASSWORD_CHANGE_NOT_ALLOWED', async () => {
    (getSessionFromRequest as any).mockResolvedValue({
      id: 'sess_1',
      user: { id: 'u_1', authType: 'ldap', passwordHash: null },
    });

    const req = new Request('http://localhost/api/v1/auth/password', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'old', newPassword: 'new' }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body.error?.code).toBe('AUTH_PASSWORD_CHANGE_NOT_ALLOWED');
  });
});
