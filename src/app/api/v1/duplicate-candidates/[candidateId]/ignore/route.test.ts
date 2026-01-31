import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/v1/duplicate-candidates/[candidateId]/ignore/route';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const duplicateCandidate = {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  };
  const auditEvent = {
    create: vi.fn(),
  };

  return { prisma: { duplicateCandidate, auditEvent } };
});

describe('POST /api/v1/duplicate-candidates/:candidateId/ignore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when candidate is not found', async () => {
    (requireAdmin as any).mockResolvedValue({ ok: true, requestId: 'req_test', session: { user: { id: 'u1' } } });
    (prisma.duplicateCandidate.findUnique as any).mockResolvedValue(null);

    const req = new Request('http://localhost/api/v1/duplicate-candidates/dc_missing/ignore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'x' }),
    });
    const res = await POST(req, { params: Promise.resolve({ candidateId: 'dc_missing' }) });

    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe(ErrorCode.CONFIG_DUPLICATE_CANDIDATE_NOT_FOUND);
  });

  it('returns 400 when body is invalid', async () => {
    (requireAdmin as any).mockResolvedValue({ ok: true, requestId: 'req_test', session: { user: { id: 'u1' } } });
    (prisma.duplicateCandidate.findUnique as any).mockResolvedValue({ id: 'dc_1', status: 'open' });

    const req = new Request('http://localhost/api/v1/duplicate-candidates/dc_1/ignore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 123 }),
    });
    const res = await POST(req, { params: Promise.resolve({ candidateId: 'dc_1' }) });

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe(ErrorCode.CONFIG_INVALID_REQUEST);
  });

  it('ignores open candidate and writes audit event', async () => {
    (requireAdmin as any).mockResolvedValue({ ok: true, requestId: 'req_test', session: { user: { id: 'u1' } } });
    (prisma.duplicateCandidate.findUnique as any).mockResolvedValue({
      id: 'dc_1',
      status: 'open',
      assetUuidA: 'a',
      assetUuidB: 'b',
    });
    (prisma.duplicateCandidate.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.auditEvent.create as any).mockResolvedValue({ id: 'ae_1' });

    const req = new Request('http://localhost/api/v1/duplicate-candidates/dc_1/ignore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'not duplicate' }),
    });
    const res = await POST(req, { params: Promise.resolve({ candidateId: 'dc_1' }) });

    expect(res.status).toBe(200);
    expect(prisma.duplicateCandidate.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'dc_1', status: 'open' } }),
    );
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'duplicate_candidate.ignored',
          actorUserId: 'u1',
          payload: expect.objectContaining({
            candidateId: 'dc_1',
            assetUuidA: 'a',
            assetUuidB: 'b',
            requestId: 'req_test',
          }),
        }),
      }),
    );

    const body = (await res.json()) as any;
    expect(body.data).toMatchObject({ candidateId: 'dc_1', status: 'ignored', ignoreReason: 'not duplicate' });
  });

  it('is idempotent for already-ignored candidate (no audit)', async () => {
    (requireAdmin as any).mockResolvedValue({ ok: true, requestId: 'req_test', session: { user: { id: 'u1' } } });
    (prisma.duplicateCandidate.findUnique as any).mockResolvedValue({
      id: 'dc_1',
      status: 'ignored',
      assetUuidA: 'a',
      assetUuidB: 'b',
      ignoredAt: new Date('2026-01-31T00:00:00.000Z'),
      ignoreReason: 'x',
    });

    const req = new Request('http://localhost/api/v1/duplicate-candidates/dc_1/ignore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'y' }),
    });
    const res = await POST(req, { params: Promise.resolve({ candidateId: 'dc_1' }) });

    expect(res.status).toBe(200);
    expect(prisma.duplicateCandidate.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();

    const body = (await res.json()) as any;
    expect(body.data).toMatchObject({ candidateId: 'dc_1', status: 'ignored', ignoreReason: 'x' });
  });
});
