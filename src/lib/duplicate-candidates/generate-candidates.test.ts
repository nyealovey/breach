import { describe, expect, it } from 'vitest';

import { generateDuplicateCandidatesForRunAssets } from '@/lib/duplicate-candidates/generate-candidates';

describe('generateDuplicateCandidatesForRunAssets', () => {
  it('generates unique candidate pairs (a<b) and never emits (a,a)', () => {
    const asset1 = '00000000-0000-0000-0000-000000000002';
    const asset2 = '00000000-0000-0000-0000-000000000001';
    const asset3 = '00000000-0000-0000-0000-000000000003';

    const pool = [
      {
        assetUuid: asset1,
        normalized: {
          identity: { machine_uuid: 'a0b1c2d3-1111-2222-3333-444455556666' },
          network: { mac_addresses: ['AA:BB:CC:DD:EE:FF'] },
        },
      },
      {
        assetUuid: asset2,
        normalized: {
          identity: { machine_uuid: 'A0B1C2D3111122223333444455556666' },
          network: { mac_addresses: ['aa-bb-cc-dd-ee-ff'] },
        },
      },
      {
        assetUuid: asset3,
        normalized: {
          identity: { machine_uuid: 'ffff' },
          network: { mac_addresses: ['11:22:33:44:55:66'] },
        },
      },
    ];

    const res = generateDuplicateCandidatesForRunAssets({
      assetType: 'vm',
      runAssets: [
        { assetUuid: asset1, normalized: pool[0]!.normalized },
        { assetUuid: asset2, normalized: pool[1]!.normalized },
      ],
      pool,
    });

    expect(res).toHaveLength(1);

    const c = res[0]!;
    expect(c.assetUuidA).toBe(asset2);
    expect(c.assetUuidB).toBe(asset1);
    expect(c.score).toBe(100);
    expect(c.reasons.map((r) => r.code).sort()).toEqual(['vm.machine_uuid_match', 'vm.mac_overlap'].sort());
  });
});
