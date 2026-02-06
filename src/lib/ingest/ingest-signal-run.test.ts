import { describe, expect, it } from 'vitest';

import { __private__ } from '@/lib/ingest/ingest-signal-run';

describe('ingestSignalRun matching helpers', () => {
  it('matches FQDN -> short name against collectedVmCaption', () => {
    const assetIndex = __private__.buildAssetIndex([
      {
        uuid: '550e8400-e29b-41d4-a716-446655440000',
        assetType: 'vm',
        collectedHostname: null,
        collectedVmCaption: 'vm-01',
        collectedIpText: null,
      },
    ]);

    const result = __private__.matchAsset({
      normalized: {
        identity: { hostname: 'vm-01.example.com' },
        network: { ip_addresses: [] },
      },
      assetIndex,
    });

    expect(result.type).toBe('matched');
    if (result.type !== 'matched') return;
    expect(result.assetUuid).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(result.reason).toBe('name');
  });

  it('returns ambiguous when multiple assets share the same name key', () => {
    const assetIndex = __private__.buildAssetIndex([
      {
        uuid: 'a1',
        assetType: 'vm',
        collectedHostname: null,
        collectedVmCaption: 'vm-dup',
        collectedIpText: null,
      },
      {
        uuid: 'a2',
        assetType: 'vm',
        collectedHostname: null,
        collectedVmCaption: 'vm-dup',
        collectedIpText: null,
      },
    ]);

    const result = __private__.matchAsset({
      normalized: { identity: { hostname: 'vm-dup' } },
      assetIndex,
    });

    expect(result.type).toBe('ambiguous');
  });

  it('prefers ip+name combined match with higher confidence', () => {
    const assetIndex = __private__.buildAssetIndex([
      {
        uuid: 'a1',
        assetType: 'vm',
        collectedHostname: null,
        collectedVmCaption: 'vm-01',
        collectedIpText: '192.0.2.10',
      },
    ]);

    const result = __private__.matchAsset({
      normalized: { identity: { caption: 'vm-01' }, network: { ip_addresses: ['192.0.2.10'] } },
      assetIndex,
    });

    expect(result.type).toBe('matched');
    if (result.type !== 'matched') return;
    expect(result.reason).toBe('ip+name');
    expect(result.confidence).toBeGreaterThanOrEqual(90);
  });
});
