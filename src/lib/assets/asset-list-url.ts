import { parsePagination } from '@/lib/http/pagination';

export type AssetTypeParam = 'vm' | 'host';
export type ExcludeAssetTypeParam = 'cluster';
export type SourceTypeParam = 'vcenter' | 'pve' | 'hyperv';
export type VmPowerStateParam = 'poweredOn' | 'poweredOff' | 'suspended';

export type AssetListUrlState = {
  q?: string;
  assetType?: AssetTypeParam;
  excludeAssetType?: ExcludeAssetTypeParam;
  sourceId?: string;
  sourceType?: SourceTypeParam;
  region?: string;
  company?: string;
  department?: string;
  systemCategory?: string;
  systemLevel?: string;
  bizOwner?: string;
  os?: string;
  vmPowerState?: VmPowerStateParam;
  ipMissing?: boolean;
  machineNameMissing?: boolean;
  machineNameVmNameMismatch?: boolean;
  createdWithinDays?: number;
  page: number;
  pageSize: number;
};

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const ALLOWED_PAGE_SIZES = [10, 20, 50, 100] as const;

function parseAssetType(input: string | null): AssetTypeParam | undefined {
  if (input === 'vm' || input === 'host') return input;
  return undefined;
}

function parseExcludeAssetType(input: string | null): ExcludeAssetTypeParam | undefined {
  if (input === 'cluster') return 'cluster';
  return undefined;
}

function parseSourceType(input: string | null): SourceTypeParam | undefined {
  if (input === 'vcenter' || input === 'pve' || input === 'hyperv') return input;
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

function parseMachineNameMissing(input: string | null): boolean | undefined {
  if (input === 'true') return true;
  return undefined;
}

function parseMachineNameVmNameMismatch(input: string | null): boolean | undefined {
  if (input === 'true') return true;
  return undefined;
}

function parseCreatedWithinDays(input: string | null): number | undefined {
  if (!input) return undefined;
  const raw = Number(input);
  if (!Number.isFinite(raw) || raw <= 0) return undefined;
  return Math.min(365, Math.floor(raw));
}

function normalizePageSize(pageSize: number): number {
  return (ALLOWED_PAGE_SIZES as readonly number[]).includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE;
}

export function parseAssetListUrlState(params: URLSearchParams): AssetListUrlState {
  const { page, pageSize } = parsePagination(params, { page: DEFAULT_PAGE, pageSize: DEFAULT_PAGE_SIZE });

  return {
    q: parseOptionalString(params.get('q')),
    assetType: parseAssetType(params.get('asset_type')),
    excludeAssetType: parseExcludeAssetType(params.get('exclude_asset_type')),
    sourceId: parseOptionalString(params.get('source_id')),
    sourceType: parseSourceType(params.get('source_type')),
    region: parseOptionalString(params.get('region')),
    company: parseOptionalString(params.get('company')),
    department: parseOptionalString(params.get('department')),
    systemCategory: parseOptionalString(params.get('system_category')),
    systemLevel: parseOptionalString(params.get('system_level')),
    bizOwner: parseOptionalString(params.get('biz_owner')),
    os: parseOptionalString(params.get('os')),
    vmPowerState: parseVmPowerState(params.get('vm_power_state')),
    ipMissing: parseIpMissing(params.get('ip_missing')),
    machineNameMissing: parseMachineNameMissing(params.get('machine_name_missing')),
    machineNameVmNameMismatch: parseMachineNameVmNameMismatch(params.get('machine_name_vmname_mismatch')),
    createdWithinDays: parseCreatedWithinDays(params.get('created_within_days')),
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
  if (state.sourceType) params.set('source_type', state.sourceType);
  if (state.region) params.set('region', state.region);
  if (state.company) params.set('company', state.company);
  if (state.department) params.set('department', state.department);
  if (state.systemCategory) params.set('system_category', state.systemCategory);
  if (state.systemLevel) params.set('system_level', state.systemLevel);
  if (state.bizOwner) params.set('biz_owner', state.bizOwner);
  if (state.os) params.set('os', state.os);
  if (state.vmPowerState) params.set('vm_power_state', state.vmPowerState);
  if (state.ipMissing === true) params.set('ip_missing', 'true');
  if (state.machineNameMissing === true) params.set('machine_name_missing', 'true');
  if (state.machineNameVmNameMismatch === true) params.set('machine_name_vmname_mismatch', 'true');
  if (state.createdWithinDays && state.createdWithinDays > 0)
    params.set('created_within_days', String(state.createdWithinDays));

  const page = Number.isFinite(state.page) && state.page > 0 ? Math.floor(state.page) : DEFAULT_PAGE;
  const pageSize = normalizePageSize(
    Number.isFinite(state.pageSize) && state.pageSize > 0 ? Math.floor(state.pageSize) : DEFAULT_PAGE_SIZE,
  );

  if (page !== DEFAULT_PAGE) params.set('page', String(page));
  if (pageSize !== DEFAULT_PAGE_SIZE) params.set('pageSize', String(pageSize));

  return params;
}
