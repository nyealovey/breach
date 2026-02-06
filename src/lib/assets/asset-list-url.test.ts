import { describe, expect, it } from 'vitest';

import { buildAssetListUrlSearchParams, parseAssetListUrlState } from '@/lib/assets/asset-list-url';

describe('asset list url', () => {
  it('parses supported params and normalizes page/pageSize', () => {
    const params = new URLSearchParams({
      q: '  host-01  ',
      asset_type: 'vm',
      exclude_asset_type: 'cluster',
      source_id: 'src_1',
      source_type: 'pve',
      vm_power_state: 'poweredOn',
      ip_missing: 'true',
      page: '2',
      pageSize: '50',
    });

    expect(parseAssetListUrlState(params)).toEqual({
      q: 'host-01',
      assetType: 'vm',
      excludeAssetType: 'cluster',
      sourceId: 'src_1',
      sourceType: 'pve',
      region: undefined,
      company: undefined,
      department: undefined,
      systemCategory: undefined,
      systemLevel: undefined,
      bizOwner: undefined,
      os: undefined,
      vmPowerState: 'poweredOn',
      ipMissing: true,
      machineNameMissing: undefined,
      machineNameVmNameMismatch: undefined,
      createdWithinDays: undefined,
      page: 2,
      pageSize: 50,
    });
  });

  it('falls back to defaults for invalid page/pageSize', () => {
    const params = new URLSearchParams({ page: '0', pageSize: '33' });
    expect(parseAssetListUrlState(params)).toEqual({
      q: undefined,
      assetType: undefined,
      excludeAssetType: undefined,
      sourceId: undefined,
      sourceType: undefined,
      region: undefined,
      company: undefined,
      department: undefined,
      systemCategory: undefined,
      systemLevel: undefined,
      bizOwner: undefined,
      os: undefined,
      vmPowerState: undefined,
      ipMissing: undefined,
      machineNameMissing: undefined,
      machineNameVmNameMismatch: undefined,
      createdWithinDays: undefined,
      page: 1,
      pageSize: 20,
    });
  });

  it('builds URLSearchParams with normalization rules', () => {
    const params = buildAssetListUrlSearchParams({
      q: '  ',
      assetType: undefined,
      excludeAssetType: 'cluster',
      sourceId: 'src_1',
      sourceType: 'hyperv',
      region: undefined,
      company: undefined,
      department: undefined,
      systemCategory: undefined,
      systemLevel: undefined,
      bizOwner: undefined,
      os: undefined,
      vmPowerState: undefined,
      ipMissing: false,
      page: 1,
      pageSize: 20,
    });

    expect(params.toString()).toBe('exclude_asset_type=cluster&source_id=src_1&source_type=hyperv');
  });

  it('ignores asset_type=cluster (cluster is not selectable in assets page UI)', () => {
    const params = new URLSearchParams({ asset_type: 'cluster' });
    expect(parseAssetListUrlState(params).assetType).toBeUndefined();
  });
});
