export type AssetDetailTab = 'overview' | 'debug';

export function parseAssetDetailTab(raw: string | null): AssetDetailTab {
  if (raw === 'debug') return 'debug';
  return 'overview';
}
