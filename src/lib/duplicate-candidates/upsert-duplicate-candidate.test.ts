import { describe, expect, it, vi } from 'vitest';

import { upsertDuplicateCandidate } from '@/lib/duplicate-candidates/upsert-duplicate-candidate';

describe('upsertDuplicateCandidate', () => {
  it('creates candidate as open when missing (a<b normalized)', async () => {
    const prisma = {
      duplicateCandidate: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'c1' }),
        update: vi.fn(),
      },
    };

    const res = await upsertDuplicateCandidate({
      prisma,
      observedAt: new Date('2026-01-31T00:00:00.000Z'),
      assetUuidA: 'b',
      assetUuidB: 'a',
      score: 80,
      reasons: [{ code: 'vm.mac_overlap', weight: 90, evidence: { field: 'x', a: 1, b: 2 } }],
    });

    expect(res.action).toBe('created');
    expect(prisma.duplicateCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assetUuidA: 'a',
          assetUuidB: 'b',
          score: 80,
          status: 'open',
        }),
      }),
    );
  });

  it('updates score/reasons when existing is open', async () => {
    const prisma = {
      duplicateCandidate: {
        findUnique: vi.fn().mockResolvedValue({ id: 'c1', status: 'open' }),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({ id: 'c1' }),
      },
    };

    const res = await upsertDuplicateCandidate({
      prisma,
      observedAt: new Date('2026-01-31T00:00:00.000Z'),
      assetUuidA: 'a',
      assetUuidB: 'b',
      score: 100,
      reasons: [],
    });

    expect(res.action).toBe('updated_open');
    expect(prisma.duplicateCandidate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        data: expect.objectContaining({ score: 100 }),
      }),
    );
  });

  it('only bumps lastObservedAt when existing is ignored/merged', async () => {
    const prisma = {
      duplicateCandidate: {
        findUnique: vi.fn().mockResolvedValueOnce({ id: 'c1', status: 'ignored' }),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({ id: 'c1' }),
      },
    };

    const res = await upsertDuplicateCandidate({
      prisma,
      observedAt: new Date('2026-01-31T00:00:00.000Z'),
      assetUuidA: 'a',
      assetUuidB: 'b',
      score: 100,
      reasons: [{ code: 'vm.machine_uuid_match', weight: 100, evidence: { field: 'x', a: 1, b: 2 } }],
    });

    expect(res.action).toBe('bumped_terminal');
    expect(prisma.duplicateCandidate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        data: expect.objectContaining({ lastObservedAt: new Date('2026-01-31T00:00:00.000Z') }),
      }),
    );
    expect((prisma.duplicateCandidate.update as any).mock.calls[0][0].data).not.toHaveProperty('score');
  });
});
