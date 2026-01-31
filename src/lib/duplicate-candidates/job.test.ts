import { describe, expect, it } from 'vitest';

import { inferDupCandidateAssetTypesFromRunMode } from '@/lib/duplicate-candidates/job';

describe('inferDupCandidateAssetTypesFromRunMode', () => {
  it('maps collect modes to vm/host scopes', () => {
    expect(inferDupCandidateAssetTypesFromRunMode('collect')).toEqual(['host', 'vm']);
    expect(inferDupCandidateAssetTypesFromRunMode('collect_hosts')).toEqual(['host']);
    expect(inferDupCandidateAssetTypesFromRunMode('collect_vms')).toEqual(['vm']);
  });

  it('maps non-collect modes to empty scope', () => {
    expect(inferDupCandidateAssetTypesFromRunMode('detect')).toEqual([]);
    expect(inferDupCandidateAssetTypesFromRunMode('healthcheck')).toEqual([]);
  });
});
