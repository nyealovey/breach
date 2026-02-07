import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildAssetListUrlSearchParams, parseAssetListUrlState } from '@/lib/assets/asset-list-url';
import {
  ASSET_LIST_SESSION_STORAGE_KEY,
  clearAssetListStateInSession,
  deserializeAssetListState,
  readAssetListStateFromSession,
  serializeAssetListState,
  writeAssetListStateToSession,
} from '@/lib/assets/asset-list-persistence';

import type { AssetListUrlState } from '@/lib/assets/asset-list-url';

class MemoryStorage {
  private readonly store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

function installWindow(storage = new MemoryStorage()): void {
  Object.defineProperty(globalThis, 'window', {
    value: { sessionStorage: storage },
    configurable: true,
    writable: true,
  });
}

describe('asset list persistence', () => {
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

  beforeEach(() => {
    installWindow();
  });

  afterEach(() => {
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
      return;
    }

    Reflect.deleteProperty(globalThis, 'window');
  });

  it('serializes and deserializes with URL normalization rules', () => {
    const state: AssetListUrlState = {
      q: '  db-01  ',
      assetType: 'vm',
      excludeAssetType: 'cluster',
      sourceId: 'src_1',
      sourceType: 'pve',
      status: 'in_service',
      brand: undefined,
      model: undefined,
      region: '  华东  ',
      company: '总部',
      department: '平台',
      systemCategory: undefined,
      systemLevel: undefined,
      bizOwner: undefined,
      os: ' Linux ',
      vmPowerState: 'poweredOn',
      ipMissing: true,
      machineNameMissing: undefined,
      machineNameVmNameMismatch: undefined,
      createdWithinDays: 999,
      page: 2,
      pageSize: 33,
    };

    const raw = serializeAssetListState(state);
    const restored = deserializeAssetListState(raw);
    const expected = parseAssetListUrlState(buildAssetListUrlSearchParams(state));

    expect(restored).toEqual(expected);
  });

  it('returns null for invalid persistence payload', () => {
    expect(deserializeAssetListState('not-json')).toBeNull();
    expect(deserializeAssetListState(JSON.stringify({ version: 99, state: {} }))).toBeNull();
    expect(deserializeAssetListState(JSON.stringify({ version: 1, state: {} }))).toBeNull();
  });

  it('normalizes direct state object payload for backward compatibility', () => {
    const restored = deserializeAssetListState(
      JSON.stringify({
        q: ' host-01 ',
        assetType: 'cluster',
        ipMissing: true,
        page: 0,
        pageSize: 50,
      }),
    );

    expect(restored).toMatchObject({
      q: 'host-01',
      assetType: undefined,
      ipMissing: true,
      page: 1,
      pageSize: 50,
    });
  });

  it('reads, writes, and clears state in sessionStorage', () => {
    const state: AssetListUrlState = {
      q: 'api',
      assetType: 'host',
      excludeAssetType: 'cluster',
      sourceId: undefined,
      sourceType: undefined,
      status: undefined,
      brand: 'Dell',
      model: undefined,
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
      page: 3,
      pageSize: 20,
    };

    writeAssetListStateToSession(state);
    const restored = readAssetListStateFromSession();
    expect(restored).toEqual(parseAssetListUrlState(buildAssetListUrlSearchParams(state)));

    clearAssetListStateInSession();
    expect(readAssetListStateFromSession()).toBeNull();
  });

  it('returns null when sessionStorage is unavailable', () => {
    Reflect.deleteProperty(globalThis, 'window');

    expect(readAssetListStateFromSession()).toBeNull();
    expect(() => writeAssetListStateToSession(parseAssetListUrlState(new URLSearchParams()))).not.toThrow();
    expect(() => clearAssetListStateInSession()).not.toThrow();
  });

  it('ignores unrelated keys in session storage', () => {
    const storage = new MemoryStorage();
    storage.setItem(ASSET_LIST_SESSION_STORAGE_KEY, JSON.stringify({ version: 1, state: { custom: true } }));
    installWindow(storage);

    expect(readAssetListStateFromSession()).toBeNull();
  });
});
