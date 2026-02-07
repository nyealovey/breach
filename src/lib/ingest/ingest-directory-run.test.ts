import { describe, expect, it, vi } from 'vitest';

import { ingestDirectoryRun } from '@/lib/ingest/ingest-directory-run';

describe('ingestDirectoryRun', () => {
  it('upserts domain/user and writes user snapshots', async () => {
    const tx = {
      directoryDomain: { upsert: vi.fn().mockResolvedValue(null) },
      directoryUser: { upsert: vi.fn().mockResolvedValue({ id: 'du_1' }) },
      directoryUserSnapshot: { create: vi.fn().mockResolvedValue(null) },
    } as any;

    const prisma = {
      $transaction: vi.fn(async (fn: any) => fn(tx)),
    } as any;

    const result = await ingestDirectoryRun({
      prisma,
      runId: 'run_1',
      sourceId: 'src_1',
      collectedAt: new Date('2026-02-07T00:00:00.000Z'),
      domains: [{ domain_dn: 'DC=example,DC=com', dns_root: 'example.com' }],
      users: [
        {
          object_guid: '1111-2222',
          dn: 'CN=user01,OU=Users,DC=example,DC=com',
          upn: 'user01@example.com',
          display_name: 'user01',
          enabled: true,
        },
      ],
    });

    expect(result).toMatchObject({ ingestedDomains: 1, ingestedUsers: 1, warnings: [] });
    expect(tx.directoryDomain.upsert).toHaveBeenCalledTimes(1);
    expect(tx.directoryUser.upsert).toHaveBeenCalledTimes(1);
    expect(tx.directoryUserSnapshot.create).toHaveBeenCalledTimes(1);
  });

  it('adds warnings for malformed records', async () => {
    const tx = {
      directoryDomain: { upsert: vi.fn().mockResolvedValue(null) },
      directoryUser: { upsert: vi.fn().mockResolvedValue({ id: 'du_1' }) },
      directoryUserSnapshot: { create: vi.fn().mockResolvedValue(null) },
    } as any;

    const prisma = {
      $transaction: vi.fn(async (fn: any) => fn(tx)),
    } as any;

    const result = await ingestDirectoryRun({
      prisma,
      runId: 'run_1',
      sourceId: 'src_1',
      collectedAt: new Date('2026-02-07T00:00:00.000Z'),
      domains: [{ dns_root: 'example.com' }],
      users: [{ upn: 'user01@example.com' }],
    });

    expect(result.ingestedDomains).toBe(0);
    expect(result.ingestedUsers).toBe(0);
    expect(result.warnings.length).toBe(2);
  });
});
