import { describe, expect, it } from 'vitest';

import { __private__ } from '@/lib/ingest/ingest-signal-run';

describe('ingestSignalRun matching helpers', () => {
  it('matches FQDN -> short name against collectedVmCaption', () => {
    const assetIndex = __private__.buildAssetIndex([
      {
        uuid: '550e8400-e29b-41d4-a716-446655440000',
        assetType: 'vm',
        machineNameOverride: null,
        ipOverrideText: null,
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
        machineNameOverride: null,
        ipOverrideText: null,
        collectedHostname: null,
        collectedVmCaption: 'vm-dup',
        collectedIpText: null,
      },
      {
        uuid: 'a2',
        assetType: 'vm',
        machineNameOverride: null,
        ipOverrideText: null,
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
        machineNameOverride: null,
        ipOverrideText: null,
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

describe('ingestSignalRun backup helpers', () => {
  it('extracts backup summary from normalized attributes', () => {
    const summary = (__private__ as any).extractBackupSummary({
      attributes: {
        backup_covered: true,
        backup_state: 'success',
        backup_last_end_at: '2026-02-07T00:09:59.000Z',
        backup_last_result: 'Success',
        backup_last_message: 'OK',
        backup_last_success_at: '2026-02-07T00:09:59.000Z',
      },
    });

    expect(summary).toMatchObject({
      covered: true,
      state: 'success',
      lastEndAt: '2026-02-07T00:09:59.000Z',
      lastSuccessAt: '2026-02-07T00:09:59.000Z',
      lastResultText: 'Success: OK',
    });
  });

  it('merges multiple signals by latest end_at and max success_at', () => {
    const merge = (__private__ as any).mergeBackupAggregate as (cur: any, next: any) => any;
    const extract = (__private__ as any).extractBackupSummary as (normalized: any) => any;

    const a = extract({
      attributes: {
        backup_covered: true,
        backup_state: 'success',
        backup_last_end_at: '2026-02-07T00:00:10.000Z',
        backup_last_result: 'Success',
        backup_last_success_at: '2026-02-07T00:00:10.000Z',
      },
    });
    const b = extract({
      attributes: {
        backup_covered: true,
        backup_state: 'failed',
        backup_last_end_at: '2026-02-07T00:00:20.000Z',
        backup_last_result: 'Failed',
        backup_last_message: 'Network error',
        backup_last_success_at: '2026-02-07T00:00:10.000Z',
      },
    });

    const merged = merge(null, a);
    const merged2 = merge(merged, b);

    expect(merged2).toMatchObject({
      covered: true,
      lastEndAt: '2026-02-07T00:00:20.000Z',
      state: 'failed',
      lastResultText: 'Failed: Network error',
      lastSuccessAt: '2026-02-07T00:00:10.000Z',
    });
  });
});
