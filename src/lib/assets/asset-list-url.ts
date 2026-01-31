import { parsePagination } from '@/lib/http/pagination';

export type AssetTypeParam = 'vm' | 'host' | 'cluster';
export type VmPowerStateParam = 'poweredOn' | 'poweredOff' | 'suspended';

export type AssetListUrlState = {
  q?: string;
  assetType?: AssetTypeParam;
  excludeAssetType?: AssetTypeParam;
  sourceId?: string;
  vmPowerState?: VmPowerStateParam;
  ipMissing?: boolean;
  page: number;
  pageSize: number;
};

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const ALLOWED_PAGE_SIZES = [10, 20, 50, 100] as const;

function parseAssetType(input: string | null): AssetTypeParam | undefined {
  if (input === 'vm' || input === 'host' || input === 'cluster') return input;
  return undefined;
}

function parseVmPowerState(input: string | null): VmPowerStateParam | undefined {
  if (input === 'poweredOn' || input === 'poweredOff' || input === 'suspended') return input;
  return undefined;
}

function parseOptionalString(input: string | null): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseIpMissing(input: string | null): boolean | undefined {
  if (input === 'true') return true;
  return undefined;
}

function normalizePageSize(pageSize: number): number {
  return (ALLOWED_PAGE_SIZES as readonly number[]).includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE;
}

export function parseAssetListUrlState(params: URLSearchParams): AssetListUrlState {
  const { page, pageSize } = parsePagination(params, { page: DEFAULT_PAGE, pageSize: DEFAULT_PAGE_SIZE });

  return {
    q: parseOptionalString(params.get('q')),
    assetType: parseAssetType(params.get('asset_type')),
    excludeAssetType: parseAssetType(params.get('exclude_asset_type')),
    sourceId: parseOptionalString(params.get('source_id')),
    vmPowerState: parseVmPowerState(params.get('vm_power_state')),
    ipMissing: parseIpMissing(params.get('ip_missing')),
    page,
    pageSize: normalizePageSize(pageSize),
  };
}

export function buildAssetListUrlSearchParams(state: AssetListUrlState): URLSearchParams {
  const params = new URLSearchParams();

  const q = state.q?.trim() ? state.q.trim() : undefined;
  if (q) params.set('q', q);

  if (state.assetType) params.set('asset_type', state.assetType);
  if (state.excludeAssetType) params.set('exclude_asset_type', state.excludeAssetType);
  if (state.sourceId) params.set('source_id', state.sourceId);
  if (state.vmPowerState) params.set('vm_power_state', state.vmPowerState);
  if (state.ipMissing === true) params.set('ip_missing', 'true');

  const page = Number.isFinite(state.page) && state.page > 0 ? Math.floor(state.page) : DEFAULT_PAGE;
  const pageSize = normalizePageSize(
    Number.isFinite(state.pageSize) && state.pageSize > 0 ? Math.floor(state.pageSize) : DEFAULT_PAGE_SIZE,
  );

  if (page !== DEFAULT_PAGE) params.set('page', String(page));
  if (pageSize !== DEFAULT_PAGE_SIZE) params.set('pageSize', String(pageSize));

  return params;
}
