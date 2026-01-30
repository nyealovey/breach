import { describe, expect, it, vi } from 'vitest';

import { ingestCollectRun } from '@/lib/ingest/ingest-run';

function key(sourceId: string, kind: string, id: string) {
  return `${sourceId}:${kind}:${id}`;
}

describe('ingestCollectRun (relation endpoint lookup)', () => {
  it('resolves relation endpoints from existing AssetSourceLink when missing from run assets', async () => {
    const existingLinks = new Map<string, any>();

    // Pretend hosts-run already created this host link.
    existingLinks.set(key('src_1', 'host', 'host-1'), {
      id: 'link_host_1',
      assetUuid: 'asset_host_1',
      asset: { displayName: 'esxi-01', assetType: 'host' },
    });

    const snapshots: any[] = [];
    const relationUpserts: any[] = [];

    const tx = {
      assetSourceLink: {
        upsert: vi.fn(async (args: any) => {
          const where = args.where?.sourceId_externalKind_externalId;
          const sourceId = where?.sourceId as string;
          const externalKind = where?.externalKind as string;
          const externalId = where?.externalId as string;

          const k = key(sourceId, externalKind, externalId);
          const existing = existingLinks.get(k);
          if (existing) return existing;

          const displayName = args.create?.asset?.create?.displayName ?? null;
          const assetType = args.create?.asset?.create?.assetType ?? externalKind;

          const created = {
            id: `link_${externalKind}_${externalId}`,
            assetUuid: `asset_${externalKind}_${externalId}`,
            asset: { displayName, assetType },
          };
          existingLinks.set(k, created);
          return created;
        }),

        findUnique: vi.fn(async (args: any) => {
          const where = args.where?.sourceId_externalKind_externalId;
          const sourceId = where?.sourceId as string;
          const externalKind = where?.externalKind as string;
          const externalId = where?.externalId as string;
          return existingLinks.get(key(sourceId, externalKind, externalId)) ?? null;
        }),
      },
      sourceRecord: {
        create: vi.fn(async () => ({ id: 'sr_1' })),
      },
      relation: {
        upsert: vi.fn(async (args: any) => {
          relationUpserts.push(args);
          return { id: `rel_${relationUpserts.length}` };
        }),
      },
      relationRecord: {
        create: vi.fn(async () => ({})),
      },
      assetRunSnapshot: {
        create: vi.fn(async (args: any) => {
          snapshots.push(args.data);
          return {};
        }),
      },
    };

    const prisma = {
      $transaction: vi.fn(async (fn: any) => fn(tx)),
    } as any;

    const result = await ingestCollectRun({
      prisma,
      runId: 'run_1',
      sourceId: 'src_1',
      collectedAt: new Date('2026-01-30T00:00:00.000Z'),
      assets: [
        {
          external_kind: 'vm',
          external_id: 'vm-1',
          normalized: { identity: { caption: 'vm-1' } },
          raw_payload: { vm: 'vm-1' },
        },
      ],
      relations: [
        {
          type: 'runs_on',
          from: { external_kind: 'vm', external_id: 'vm-1' },
          to: { external_kind: 'host', external_id: 'host-1' },
          raw_payload: { vm: 'vm-1', host: 'host-1' },
        },
        {
          type: 'hosts_vm',
          from: { external_kind: 'host', external_id: 'host-1' },
          to: { external_kind: 'vm', external_id: 'vm-1' },
          raw_payload: { host: 'host-1', vm: 'vm-1' },
        },
      ],
    });

    // Ensure the host endpoint is looked up from DB (not created in this run).
    expect(tx.assetSourceLink.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sourceId_externalKind_externalId: { sourceId: 'src_1', externalKind: 'host', externalId: 'host-1' },
        },
      }),
    );

    // Relations should not be skipped due to missing endpoints.
    expect(result.warnings).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ type: 'relation.skipped_missing_endpoint' })]),
    );
    expect(result.ingestedRelations).toBe(2);

    // VM canonical snapshot should contain the runs_on relation pointing to the existing host.
    expect(snapshots).toHaveLength(1);
    const canonical = snapshots[0].canonical as any;
    expect(canonical.relations.outgoing).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'runs_on',
          to: { asset_uuid: 'asset_host_1', display_name: 'esxi-01', asset_type: 'host' },
        }),
      ]),
    );

    // Sanity check: both relations were attempted.
    expect(relationUpserts).toHaveLength(2);
  });
});
