import { buildAssetListUrlSearchParams, parseAssetListUrlState } from '@/lib/assets/asset-list-url';

import type { AssetListUrlState } from '@/lib/assets/asset-list-url';

export const ASSET_LIST_SESSION_STORAGE_KEY = 'assets.list.filters.v1' as const;

const PERSISTENCE_VERSION = 1 as const;

type PersistedAssetListStateEnvelope = {
  version: typeof PERSISTENCE_VERSION;
  state: AssetListUrlState;
};

const KNOWN_STATE_KEYS: ReadonlyArray<keyof AssetListUrlState> = [
  'q',
  'assetType',
  'excludeAssetType',
  'sourceId',
  'sourceType',
  'status',
  'brand',
  'model',
  'region',
  'company',
  'department',
  'systemCategory',
  'systemLevel',
  'bizOwner',
  'os',
  'vmPowerState',
  'ipMissing',
  'machineNameMissing',
  'machineNameVmNameMismatch',
  'createdWithinDays',
  'page',
  'pageSize',
] as const;

function getSessionStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function normalizeState(state: Partial<AssetListUrlState>): AssetListUrlState {
  return parseAssetListUrlState(
    buildAssetListUrlSearchParams({
      q: typeof state.q === 'string' ? state.q : undefined,
      assetType: state.assetType === 'vm' || state.assetType === 'host' ? state.assetType : undefined,
      excludeAssetType: state.excludeAssetType === 'cluster' ? state.excludeAssetType : undefined,
      sourceId: typeof state.sourceId === 'string' ? state.sourceId : undefined,
      sourceType:
        state.sourceType === 'vcenter' || state.sourceType === 'pve' || state.sourceType === 'hyperv'
          ? state.sourceType
          : undefined,
      status: state.status === 'in_service' || state.status === 'offline' ? state.status : undefined,
      brand: typeof state.brand === 'string' ? state.brand : undefined,
      model: typeof state.model === 'string' ? state.model : undefined,
      region: typeof state.region === 'string' ? state.region : undefined,
      company: typeof state.company === 'string' ? state.company : undefined,
      department: typeof state.department === 'string' ? state.department : undefined,
      systemCategory: typeof state.systemCategory === 'string' ? state.systemCategory : undefined,
      systemLevel: typeof state.systemLevel === 'string' ? state.systemLevel : undefined,
      bizOwner: typeof state.bizOwner === 'string' ? state.bizOwner : undefined,
      os: typeof state.os === 'string' ? state.os : undefined,
      vmPowerState:
        state.vmPowerState === 'poweredOn' || state.vmPowerState === 'poweredOff' || state.vmPowerState === 'suspended'
          ? state.vmPowerState
          : undefined,
      ipMissing: state.ipMissing === true ? true : undefined,
      machineNameMissing: state.machineNameMissing === true ? true : undefined,
      machineNameVmNameMismatch: state.machineNameVmNameMismatch === true ? true : undefined,
      createdWithinDays: typeof state.createdWithinDays === 'number' ? state.createdWithinDays : undefined,
      page: typeof state.page === 'number' ? state.page : 1,
      pageSize: typeof state.pageSize === 'number' ? state.pageSize : 20,
    }),
  );
}

function hasAnyKnownStateKeys(input: Record<string, unknown>): boolean {
  return KNOWN_STATE_KEYS.some((key) => key in input);
}

function decodePersistedState(input: unknown): AssetListUrlState | null {
  if (!isRecord(input)) return null;
  if (!hasAnyKnownStateKeys(input)) return null;

  return normalizeState(input as Partial<AssetListUrlState>);
}

export function serializeAssetListState(state: AssetListUrlState): string {
  const normalized = normalizeState(state);
  const envelope: PersistedAssetListStateEnvelope = {
    version: PERSISTENCE_VERSION,
    state: normalized,
  };

  return JSON.stringify(envelope);
}

export function deserializeAssetListState(raw: string): AssetListUrlState | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;

    if ('version' in parsed) {
      if (parsed.version !== PERSISTENCE_VERSION) return null;
      return decodePersistedState(parsed.state);
    }

    // Backward compatibility: accept direct state object if present.
    return decodePersistedState(parsed);
  } catch {
    return null;
  }
}

export function readAssetListStateFromSession(): AssetListUrlState | null {
  const storage = getSessionStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(ASSET_LIST_SESSION_STORAGE_KEY);
    if (!raw) return null;
    return deserializeAssetListState(raw);
  } catch {
    return null;
  }
}

export function writeAssetListStateToSession(state: AssetListUrlState): void {
  const storage = getSessionStorage();
  if (!storage) return;

  try {
    storage.setItem(ASSET_LIST_SESSION_STORAGE_KEY, serializeAssetListState(state));
  } catch {
    // Ignore browser storage exceptions (quota/security mode).
  }
}

export function clearAssetListStateInSession(): void {
  const storage = getSessionStorage();
  if (!storage) return;

  try {
    storage.removeItem(ASSET_LIST_SESSION_STORAGE_KEY);
  } catch {
    // Ignore browser storage exceptions (quota/security mode).
  }
}
