export type RelationRef = {
  relationType: string;
  toAssetUuid: string;
  toAssetType: string | null;
  toDisplayName: string | null;
};

export type RelationChainNode = {
  assetUuid: string;
  assetType: string | null;
  displayName: string | null;
};

export function findRunsOnHost(relations: RelationRef[]): RelationChainNode | null {
  const rel = relations.find((r) => r.relationType === 'runs_on');
  if (!rel) return null;
  return { assetUuid: rel.toAssetUuid, assetType: rel.toAssetType, displayName: rel.toDisplayName };
}

export function findMemberOfCluster(relations: RelationRef[]): RelationChainNode | null {
  const rel = relations.find((r) => r.relationType === 'member_of');
  if (!rel) return null;
  return { assetUuid: rel.toAssetUuid, assetType: rel.toAssetType, displayName: rel.toDisplayName };
}
