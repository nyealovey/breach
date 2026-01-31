import { describe, expect, it } from 'vitest';

import { findMemberOfCluster, findRunsOnHost } from '@/lib/assets/asset-relation-chain';

describe('asset relation chain helpers', () => {
  it('picks runs_on host from relations', () => {
    const host = findRunsOnHost([
      {
        relationType: 'runs_on',
        toAssetUuid: 'host_1',
        toAssetType: 'host',
        toDisplayName: 'esxi-01',
      },
    ]);

    expect(host).toEqual({ assetUuid: 'host_1', assetType: 'host', displayName: 'esxi-01' });
  });

  it('picks member_of cluster from relations', () => {
    const cluster = findMemberOfCluster([
      {
        relationType: 'member_of',
        toAssetUuid: 'cluster_1',
        toAssetType: 'cluster',
        toDisplayName: 'cluster-a',
      },
    ]);

    expect(cluster).toEqual({ assetUuid: 'cluster_1', assetType: 'cluster', displayName: 'cluster-a' });
  });
});
