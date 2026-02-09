'use client';

import dynamic from 'next/dynamic';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardPenLine, Columns3, Download } from 'lucide-react';
import { toast } from 'sonner';

import { CreateAssetLedgerExportButton } from '@/components/exports/create-asset-ledger-export-button';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { buildAssetListUrlSearchParams, parseAssetListUrlState } from '@/lib/assets/asset-list-url';
import {
  clearAssetListStateInSession,
  readAssetListStateFromSession,
  writeAssetListStateToSession,
} from '@/lib/assets/asset-list-persistence';
import { listLedgerFieldMetasV1 } from '@/lib/ledger/ledger-fields-v1';

import { AssetsFilterPanel } from './components/assets-filter-panel';

import type { AssetListUrlState, VmPowerStateParam } from '@/lib/assets/asset-list-url';
import type { LedgerFieldKey, LedgerFieldsV1 } from '@/lib/ledger/ledger-fields-v1';

export type AssetListItem = {
  assetUuid: string;
  assetType: string;
  status: string;
  brand: string | null;
  model: string | null;
  machineName: string | null;
  machineNameOverride: string | null;
  machineNameCollected: string | null;
  machineNameMismatch: boolean;
  hostName: string | null;
  vmName: string | null;
  os: string | null;
  osCollected: string | null;
  osOverrideText: string | null;
  vmPowerState: string | null;
  toolsRunning: boolean | null;
  ip: string | null;
  ipCollected: string | null;
  ipOverrideText: string | null;
  monitorCovered: boolean | null;
  monitorState: string | null;
  monitorStatus: string | null;
  monitorUpdatedAt: string | null;
  backupCovered: boolean | null;
  backupState: string | null;
  backupLastSuccessAt: string | null;
  backupLastResult: string | null;
  backupUpdatedAt: string | null;
  recordedAt: string;
  ledgerFields: LedgerFieldsV1;
  cpuCount: number | null;
  memoryBytes: number | null;
  totalDiskBytes: number | null;
};

export type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type SourceOption = { sourceId: string; name: string };

export type LedgerFieldFilterOptions = {
  regions: string[];
  companies: string[];
  departments: string[];
  systemCategories: string[];
  systemLevels: string[];
  bizOwners: string[];
  osNames: string[];
  brands: string[];
  models: string[];
};

export type AssetListFiltersState = {
  qInput: string;
  assetTypeInput: 'all' | 'vm' | 'host';
  sourceIdInput: 'all' | string;
  sourceTypeInput: 'all' | 'vcenter' | 'pve' | 'hyperv';
  statusInput: 'all' | 'in_service' | 'offline';
  vmPowerStateInput: 'all' | VmPowerStateParam;
  ipMissingInput: boolean;
  machineNameMissingInput: boolean;
  machineNameVmNameMismatchInput: boolean;
  recentAddedInput: boolean;
  brandInput: string;
  modelInput: string;
  regionInput: string;
  companyInput: string;
  departmentInput: string;
  systemCategoryInput: string;
  systemLevelInput: string;
  bizOwnerInput: string;
  osInput: string;
  page: number;
  pageSize: number;
};

export type AssetListColumnId =
  | 'status'
  | 'machineName'
  | 'vmName'
  | 'hostName'
  | 'os'
  | 'ip'
  | 'brand'
  | 'model'
  | 'monitorState'
  | 'recordedAt'
  | 'cpuCount'
  | 'memoryBytes'
  | 'totalDiskBytes'
  | 'vmPowerState'
  | `ledger.${LedgerFieldKey}`;

const ASSETS_TABLE_COLUMNS_PREFERENCE_KEY = 'assets.table.columns.v2' as const;

export type AssetsPageInitialData = {
  role: 'admin' | 'user' | null;
  sourceOptions: SourceOption[];
  ledgerFieldFilterOptions: LedgerFieldFilterOptions;
  visibleColumns: AssetListColumnId[] | null;
  queryString: string;
  list: { items: AssetListItem[]; pagination: Pagination | null } | null;
};

type ColumnSettingItem = {
  id: string;
  label: string;
};

type SolarWindsCandidate = {
  nodeId: string;
  caption: string | null;
  sysName: string | null;
  dns: string | null;
  ipAddress: string | null;
  machineType: string | null;
  statusDescription: string | null;
  unmanaged: boolean | null;
  lastSyncIso: string | null;
  matchScore: number;
  matchReasons: string[];
};

const BASE_ASSET_LIST_COLUMNS: Array<{
  id: AssetListColumnId;
  label: string;
  description?: string;
}> = [
  { id: 'machineName', label: '机器名', description: '支持“覆盖显示”，并标记覆盖≠采集。' },
  { id: 'status', label: '状态' },
  { id: 'vmName', label: '虚拟机名', description: '仅 VM。' },
  { id: 'hostName', label: '宿主机名', description: '仅 VM（VM --runs_on--> Host displayName）。' },
  { id: 'os', label: '操作系统' },
  { id: 'ip', label: 'IP', description: 'VM 若 Tools / Guest 服务未运行可能缺失。' },
  { id: 'brand', label: '品牌' },
  { id: 'model', label: '型号' },
  { id: 'cpuCount', label: 'CPU' },
  { id: 'memoryBytes', label: '内存' },
  { id: 'totalDiskBytes', label: '总分配磁盘' },
  { id: 'vmPowerState', label: '电源', description: '电源状态（poweredOn/off/suspended）。' },
  { id: 'monitorState', label: '监控', description: 'SolarWinds 监控 + Veeam 备份（信号来源；不影响库存）。' },
  { id: 'recordedAt', label: '录入时间', description: '若未录入台账字段，默认显示第一次采集时间。' },
];

const LEDGER_FIELD_METAS = listLedgerFieldMetasV1();
const LEDGER_HOST_ONLY_KEY_SET = new Set<LedgerFieldKey>(
  LEDGER_FIELD_METAS.filter((m) => m.scope === 'host_only').map((m) => m.key),
);
const LEDGER_FIELD_COLUMNS: Array<{ id: AssetListColumnId; label: string; description?: string }> =
  LEDGER_FIELD_METAS.map((m) => ({
    id: `ledger.${m.key}` as const,
    label: m.labelZh,
    description: m.scope === 'host_only' ? '台账字段（仅 Host）' : '台账字段',
  }));

const ASSET_LIST_COLUMNS: Array<{ id: AssetListColumnId; label: string; description?: string }> = [
  ...BASE_ASSET_LIST_COLUMNS,
  ...LEDGER_FIELD_COLUMNS,
];

// Base columns are visible by default; ledger fields are opt-in.
const DEFAULT_VISIBLE_COLUMNS: AssetListColumnId[] = BASE_ASSET_LIST_COLUMNS.map((c) => c.id);
const ASSET_LIST_COLUMN_ID_SET = new Set<AssetListColumnId>(ASSET_LIST_COLUMNS.map((c) => c.id));
const ASSET_LIST_COLUMN_LABEL_BY_ID = new Map<AssetListColumnId, string>(
  ASSET_LIST_COLUMNS.map((c) => [c.id, c.label]),
);
const ASSET_LIST_COLUMN_ORDER_INDEX = new Map<AssetListColumnId, number>(
  ASSET_LIST_COLUMNS.map((c, idx) => [c.id, idx]),
);

const CORE_COLUMNS: Array<Extract<AssetListColumnId, 'machineName' | 'ip'>> = ['machineName', 'ip'];
const VM_ONLY_COLUMNS: Array<Extract<AssetListColumnId, 'vmName' | 'hostName'>> = ['vmName', 'hostName'];
const HOST_ONLY_COLUMNS: Array<Extract<AssetListColumnId, 'brand' | 'model'>> = ['brand', 'model'];
const FILTER_FETCH_DEBOUNCE_MS = 300;

const ColumnSettingsDialog = dynamic(
  () => import('./components/column-settings-dialog').then((mod) => mod.ColumnSettingsDialog),
  { ssr: false },
);
const BulkSetLedgerDialog = dynamic(
  () => import('./components/bulk-set-ledger-dialog').then((mod) => mod.BulkSetLedgerDialog),
  { ssr: false },
);
const EditAssetDialog = dynamic(() => import('./components/edit-asset-dialog').then((mod) => mod.EditAssetDialog), {
  ssr: false,
});
const AssetsTableContent = dynamic(() =>
  import('./components/assets-table-content').then((mod) => mod.AssetsTableContent),
);

const preloadColumnSettingsDialog = () => import('./components/column-settings-dialog');
const preloadBulkSetLedgerDialog = () => import('./components/bulk-set-ledger-dialog');
const preloadEditAssetDialog = () => import('./components/edit-asset-dialog');

function ensureCoreVisibleColumns(columns: AssetListColumnId[]): AssetListColumnId[] {
  const set = new Set(columns);
  let next = [...columns];

  if (!set.has('machineName')) next = ['machineName', ...next];

  if (!set.has('ip')) {
    const insertAfterOs = next.indexOf('os');
    const insertAfterMachineName = next.indexOf('machineName');
    const insertIndex =
      insertAfterOs >= 0 ? insertAfterOs + 1 : insertAfterMachineName >= 0 ? insertAfterMachineName + 1 : next.length;
    next = [...next.slice(0, insertIndex), 'ip', ...next.slice(insertIndex)];
  }

  // De-dupe while preserving order.
  const seen = new Set<AssetListColumnId>();
  const unique = next.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
  // Column settings do not support manual reordering; keep a stable, canonical order.
  return unique.slice().sort((a, b) => {
    const ia = ASSET_LIST_COLUMN_ORDER_INDEX.get(a) ?? Number.MAX_SAFE_INTEGER;
    const ib = ASSET_LIST_COLUMN_ORDER_INDEX.get(b) ?? Number.MAX_SAFE_INTEGER;
    return ia - ib;
  });
}

function sanitizeVisibleColumns(input: unknown): AssetListColumnId[] | null {
  if (!Array.isArray(input)) return null;

  const ids = input
    .filter((v) => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v): v is AssetListColumnId => ASSET_LIST_COLUMN_ID_SET.has(v as AssetListColumnId));

  const unique = Array.from(new Set(ids));
  return unique.length > 0 ? ensureCoreVisibleColumns(unique) : null;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '-';
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function filtersStateFromUrlState(state: AssetListUrlState): AssetListFiltersState {
  return {
    qInput: state.q ?? '',
    assetTypeInput: state.assetType ?? 'all',
    sourceIdInput: state.sourceId ?? 'all',
    sourceTypeInput: state.sourceType ?? 'all',
    statusInput: state.status ?? 'all',
    vmPowerStateInput: state.vmPowerState ?? 'all',
    ipMissingInput: state.ipMissing === true,
    machineNameMissingInput: state.machineNameMissing === true,
    machineNameVmNameMismatchInput: state.machineNameVmNameMismatch === true,
    recentAddedInput: state.createdWithinDays === 7,
    brandInput: state.brand ?? '',
    modelInput: state.model ?? '',
    regionInput: state.region ?? '',
    companyInput: state.company ?? '',
    departmentInput: state.department ?? '',
    systemCategoryInput: state.systemCategory ?? '',
    systemLevelInput: state.systemLevel ?? '',
    bizOwnerInput: state.bizOwner ?? '',
    osInput: state.os ?? '',
    page: state.page,
    pageSize: state.pageSize,
  };
}

function createDefaultFiltersState(): AssetListFiltersState {
  return filtersStateFromUrlState(parseAssetListUrlState(new URLSearchParams()));
}

function buildAssetListUiSearchParams(state: AssetListUrlState): URLSearchParams {
  return buildAssetListUrlSearchParams({
    ...state,
    // `exclude_asset_type=cluster` is an implementation detail for API querying; keep URL focused on user filters.
    excludeAssetType: undefined,
  });
}

function hasActiveAssetListQuery(state: AssetListUrlState): boolean {
  return buildAssetListUiSearchParams(state).toString().length > 0;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export default function AssetsPage({ initialData }: { initialData: AssetsPageInitialData }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const skipNextUrlSyncRef = useRef(false);
  const skipNextSessionSyncRef = useRef(false);
  const swCollectingRef = useRef(false);
  const skipInitialListFetchRef = useRef(initialData.list !== null);
  const initialQueryStringRef = useRef(initialData.queryString);

  const [items, setItems] = useState<AssetListItem[]>(initialData.list?.items ?? []);
  const [pagination, setPagination] = useState<Pagination | null>(initialData.list?.pagination ?? null);
  const [loading, setLoading] = useState(initialData.list === null);

  const [role] = useState<'admin' | 'user' | null>(initialData.role);
  const isAdmin = role === 'admin';

  const [sourceOptions] = useState<SourceOption[]>(initialData.sourceOptions);
  const [ledgerFieldFilterOptions] = useState<LedgerFieldFilterOptions>(initialData.ledgerFieldFilterOptions);

  const [visibleColumns, setVisibleColumns] = useState<AssetListColumnId[]>(
    sanitizeVisibleColumns(initialData.visibleColumns) ?? DEFAULT_VISIBLE_COLUMNS,
  );
  const [columnSettingsOpen, setColumnSettingsOpen] = useState(false);
  const [columnDraft, setColumnDraft] = useState<AssetListColumnId[]>(DEFAULT_VISIBLE_COLUMNS);
  const [columnSaving, setColumnSaving] = useState(false);

  const [selectedAssetUuids, setSelectedAssetUuids] = useState<string[]>([]);
  const selectedAssetUuidSet = useMemo(() => new Set(selectedAssetUuids), [selectedAssetUuids]);

  const [bulkSetOpen, setBulkSetOpen] = useState(false);
  const [bulkKey, setBulkKey] = useState<LedgerFieldKey | ''>('');
  const [bulkValue, setBulkValue] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);

  const [filters, setFilters] = useState<AssetListFiltersState>(() =>
    filtersStateFromUrlState(parseAssetListUrlState(new URLSearchParams(searchParams.toString()))),
  );

  const [editAssetOpen, setEditAssetOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AssetListItem | null>(null);
  const [editMachineNameValue, setEditMachineNameValue] = useState('');
  const [editIpValue, setEditIpValue] = useState('');
  const [editOsValue, setEditOsValue] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [swCollecting, setSwCollecting] = useState(false);
  const [swCandidates, setSwCandidates] = useState<SolarWindsCandidate[] | null>(null);
  const [swSelectedNodeId, setSwSelectedNodeId] = useState<string>('');
  const hasOverrideDraft =
    editMachineNameValue.trim().length > 0 || editIpValue.trim().length > 0 || editOsValue.trim().length > 0;
  const textFilters = useMemo(
    () => ({
      qInput: filters.qInput,
      brandInput: filters.brandInput,
      modelInput: filters.modelInput,
      regionInput: filters.regionInput,
      companyInput: filters.companyInput,
      departmentInput: filters.departmentInput,
      systemCategoryInput: filters.systemCategoryInput,
      systemLevelInput: filters.systemLevelInput,
      bizOwnerInput: filters.bizOwnerInput,
      osInput: filters.osInput,
    }),
    [
      filters.bizOwnerInput,
      filters.brandInput,
      filters.companyInput,
      filters.departmentInput,
      filters.modelInput,
      filters.osInput,
      filters.qInput,
      filters.regionInput,
      filters.systemCategoryInput,
      filters.systemLevelInput,
    ],
  );
  const [debouncedTextFilters, setDebouncedTextFilters] = useState(textFilters);

  const query = useMemo<AssetListUrlState>(() => {
    const assetType = filters.assetTypeInput === 'all' ? undefined : filters.assetTypeInput;
    const sourceType = filters.sourceTypeInput === 'all' ? undefined : filters.sourceTypeInput;
    const status = filters.statusInput === 'all' ? undefined : filters.statusInput;
    const vmPowerState = filters.vmPowerStateInput === 'all' ? undefined : filters.vmPowerStateInput;
    const ipMissing = filters.ipMissingInput ? true : undefined;
    const machineNameMissing = filters.machineNameMissingInput ? true : undefined;
    const machineNameVmNameMismatch = filters.machineNameVmNameMismatchInput ? true : undefined;
    const createdWithinDays = filters.recentAddedInput ? 7 : undefined;
    const brand = filters.brandInput.trim() ? filters.brandInput.trim() : undefined;
    const model = filters.modelInput.trim() ? filters.modelInput.trim() : undefined;

    // VM-only filters imply `asset_type=vm`.
    const impliedAssetType =
      vmPowerState || ipMissing || machineNameMissing || machineNameVmNameMismatch
        ? ('vm' as const)
        : brand || model
          ? ('host' as const)
          : assetType;

    return {
      q: filters.qInput.trim() ? filters.qInput.trim() : undefined,
      assetType: impliedAssetType,
      // Cluster is treated as a virtual asset type and is intentionally hidden from the assets page for now.
      excludeAssetType: 'cluster' as const,
      sourceId: filters.sourceIdInput === 'all' ? undefined : filters.sourceIdInput,
      sourceType,
      status,
      brand,
      model,
      region: filters.regionInput.trim() ? filters.regionInput.trim() : undefined,
      company: filters.companyInput.trim() ? filters.companyInput.trim() : undefined,
      department: filters.departmentInput.trim() ? filters.departmentInput.trim() : undefined,
      systemCategory: filters.systemCategoryInput.trim() ? filters.systemCategoryInput.trim() : undefined,
      systemLevel: filters.systemLevelInput.trim() ? filters.systemLevelInput.trim() : undefined,
      bizOwner: filters.bizOwnerInput.trim() ? filters.bizOwnerInput.trim() : undefined,
      os: filters.osInput.trim() ? filters.osInput.trim() : undefined,
      vmPowerState,
      ipMissing,
      machineNameMissing,
      machineNameVmNameMismatch,
      createdWithinDays,
      page: filters.page,
      pageSize: filters.pageSize,
    };
  }, [filters]);
  const fetchQuery = useMemo<AssetListUrlState>(() => {
    return {
      ...query,
      q: debouncedTextFilters.qInput.trim() ? debouncedTextFilters.qInput.trim() : undefined,
      brand: debouncedTextFilters.brandInput.trim() ? debouncedTextFilters.brandInput.trim() : undefined,
      model: debouncedTextFilters.modelInput.trim() ? debouncedTextFilters.modelInput.trim() : undefined,
      region: debouncedTextFilters.regionInput.trim() ? debouncedTextFilters.regionInput.trim() : undefined,
      company: debouncedTextFilters.companyInput.trim() ? debouncedTextFilters.companyInput.trim() : undefined,
      department: debouncedTextFilters.departmentInput.trim() ? debouncedTextFilters.departmentInput.trim() : undefined,
      systemCategory: debouncedTextFilters.systemCategoryInput.trim()
        ? debouncedTextFilters.systemCategoryInput.trim()
        : undefined,
      systemLevel: debouncedTextFilters.systemLevelInput.trim()
        ? debouncedTextFilters.systemLevelInput.trim()
        : undefined,
      bizOwner: debouncedTextFilters.bizOwnerInput.trim() ? debouncedTextFilters.bizOwnerInput.trim() : undefined,
      os: debouncedTextFilters.osInput.trim() ? debouncedTextFilters.osInput.trim() : undefined,
    };
  }, [debouncedTextFilters, query]);

  const hasActiveFilters = useMemo(() => hasActiveAssetListQuery(query), [query]);

  const visibleColumnsForTable = useMemo(() => {
    const cols = ensureCoreVisibleColumns(visibleColumns);
    if (filters.assetTypeInput === 'host') {
      return cols.filter((id) => !VM_ONLY_COLUMNS.includes(id as (typeof VM_ONLY_COLUMNS)[number]));
    }
    if (filters.assetTypeInput === 'vm') {
      return cols.filter((id) => {
        if (HOST_ONLY_COLUMNS.includes(id as (typeof HOST_ONLY_COLUMNS)[number])) return false;
        if (id.startsWith('ledger.')) {
          const key = id.slice('ledger.'.length) as LedgerFieldKey;
          if (LEDGER_HOST_ONLY_KEY_SET.has(key)) return false;
        }
        return true;
      });
    }
    return cols;
  }, [filters.assetTypeInput, visibleColumns]);

  const handleClearFilters = () => {
    clearAssetListStateInSession();
    setSelectedAssetUuids([]);
    setFilters(createDefaultFiltersState());
  };

  useEffect(() => {
    const parsed = parseAssetListUrlState(new URLSearchParams(searchParams.toString()));
    const persisted = readAssetListStateFromSession();
    const resolved = hasActiveAssetListQuery(parsed)
      ? parsed
      : persisted && hasActiveAssetListQuery(persisted)
        ? persisted
        : parsed;

    // When URL changes (e.g. external navigation/back/forward), update local state from URL/session.
    // Also skip the next "state -> URL" + "state -> session" sync to avoid oscillation while state catches up.
    skipNextUrlSyncRef.current = true;
    skipNextSessionSyncRef.current = true;
    setFilters(filtersStateFromUrlState(resolved));

    const current = searchParams.toString();
    const next = buildAssetListUiSearchParams(resolved).toString();
    if (next !== current) {
      router.replace(`${pathname}${next ? `?${next}` : ''}`, { scroll: false });
    }
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (skipNextUrlSyncRef.current) {
      skipNextUrlSyncRef.current = false;
      return;
    }

    const current = searchParams.toString();
    const nextParams = buildAssetListUiSearchParams(query);

    const next = nextParams.toString();
    if (next === current) return;
    router.replace(`${pathname}${next ? `?${next}` : ''}`, { scroll: false });
  }, [pathname, query, router, searchParams]);

  useEffect(() => {
    if (skipNextSessionSyncRef.current) {
      skipNextSessionSyncRef.current = false;
      return;
    }

    if (hasActiveFilters) {
      writeAssetListStateToSession(query);
      return;
    }

    clearAssetListStateInSession();
  }, [hasActiveFilters, query]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedTextFilters(textFilters);
    }, FILTER_FETCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [textFilters]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const load = async () => {
      const params = buildAssetListUrlSearchParams(fetchQuery);
      const queryString = params.toString();

      if (skipInitialListFetchRef.current) {
        skipInitialListFetchRef.current = false;
        if (queryString === initialQueryStringRef.current) {
          setSelectedAssetUuids([]);
          setLoading(false);
          return;
        }
      }

      setLoading(true);
      try {
        const res = await fetch(`/api/v1/assets?${queryString}`, { signal: controller.signal });
        if (!res.ok) {
          if (active) {
            setItems([]);
            setPagination(null);
            setSelectedAssetUuids([]);
            setLoading(false);
          }
          return;
        }

        const body = (await res.json()) as { data: AssetListItem[]; pagination: Pagination };
        if (active) {
          setItems(body.data ?? []);
          setPagination(body.pagination ?? null);
          setSelectedAssetUuids([]);
          setLoading(false);
        }
      } catch (error) {
        if (!active || controller.signal.aborted || isAbortError(error)) return;
        setItems([]);
        setPagination(null);
        setSelectedAssetUuids([]);
        setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [fetchQuery]);

  const canPrev = (pagination?.page ?? 1) > 1;
  const canNext = (pagination?.page ?? 1) < (pagination?.totalPages ?? 1);

  const renderColumnSettingItem = (col: ColumnSettingItem) => {
    const colId = col.id as AssetListColumnId;
    const locked = CORE_COLUMNS.includes(colId as (typeof CORE_COLUMNS)[number]);
    const vmOnly = VM_ONLY_COLUMNS.includes(colId as (typeof VM_ONLY_COLUMNS)[number]);
    const hostOnlyAsset = HOST_ONLY_COLUMNS.includes(colId as (typeof HOST_ONLY_COLUMNS)[number]);
    const hostOnlyLedger =
      colId.startsWith('ledger.') && LEDGER_HOST_ONLY_KEY_SET.has(colId.slice('ledger.'.length) as LedgerFieldKey);
    const hostOnly = hostOnlyAsset || hostOnlyLedger;

    const disabled =
      locked || (vmOnly && filters.assetTypeInput === 'host') || (hostOnly && filters.assetTypeInput === 'vm');
    const checked = locked ? true : columnDraft.includes(colId);

    return (
      <div
        key={colId}
        className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 ${
          disabled ? 'bg-muted/40 opacity-70' : ''
        }`}
      >
        <div className="min-w-0 text-sm font-medium leading-snug">{col.label}</div>
        <Switch
          checked={checked}
          disabled={disabled}
          onCheckedChange={(next) => {
            setColumnDraft((prev) => {
              const draft = next ? (prev.includes(colId) ? prev : [...prev, colId]) : prev.filter((id) => id !== colId);
              return ensureCoreVisibleColumns(draft);
            });
          }}
        />
      </div>
    );
  };

  const assetFieldCommonColumns = ASSET_LIST_COLUMNS.filter(
    (col) =>
      !col.id.startsWith('ledger.') &&
      !VM_ONLY_COLUMNS.includes(col.id as (typeof VM_ONLY_COLUMNS)[number]) &&
      !HOST_ONLY_COLUMNS.includes(col.id as (typeof HOST_ONLY_COLUMNS)[number]),
  );
  const assetFieldVmOnlyColumns = ASSET_LIST_COLUMNS.filter(
    (col) => !col.id.startsWith('ledger.') && VM_ONLY_COLUMNS.includes(col.id as (typeof VM_ONLY_COLUMNS)[number]),
  );
  const assetFieldHostOnlyColumns = ASSET_LIST_COLUMNS.filter(
    (col) => !col.id.startsWith('ledger.') && HOST_ONLY_COLUMNS.includes(col.id as (typeof HOST_ONLY_COLUMNS)[number]),
  );

  const ledgerFieldCommonColumns = ASSET_LIST_COLUMNS.filter((col) => {
    if (!col.id.startsWith('ledger.')) return false;
    const key = col.id.slice('ledger.'.length) as LedgerFieldKey;
    return !LEDGER_HOST_ONLY_KEY_SET.has(key);
  });
  const ledgerFieldHostOnlyColumns = ASSET_LIST_COLUMNS.filter((col) => {
    if (!col.id.startsWith('ledger.')) return false;
    const key = col.id.slice('ledger.'.length) as LedgerFieldKey;
    return LEDGER_HOST_ONLY_KEY_SET.has(key);
  });

  const resetEditState = () => {
    setEditTarget(null);
    setEditMachineNameValue('');
    setEditIpValue('');
    setEditOsValue('');
    setEditSaving(false);
    setSwCollecting(false);
    setSwCandidates(null);
    setSwSelectedNodeId('');
  };

  const openEditForItem = (item: AssetListItem) => {
    void preloadEditAssetDialog();
    setEditTarget(item);
    setEditMachineNameValue(item.machineNameOverride ?? '');
    setEditIpValue(item.ipOverrideText ?? '');
    setEditOsValue(item.osOverrideText ?? '');
    setEditSaving(false);
    setSwCollecting(false);
    setSwCandidates(null);
    setSwSelectedNodeId('');
    setEditAssetOpen(true);
  };

  const clearOverrideDraft = () => {
    setEditMachineNameValue('');
    setEditIpValue('');
    setEditOsValue('');
  };

  const mapSolarWindsMonitorState = (node: { status?: unknown; unmanaged?: unknown }): string => {
    if (node.unmanaged === true) return 'unmanaged';
    const status = node.status;
    if (typeof status === 'number') {
      if (status === 1) return 'up';
      if (status === 2) return 'down';
      if (status === 3) return 'warning';
    }
    if (typeof status === 'string') {
      const s = status.trim().toLowerCase();
      if (s === 'up') return 'up';
      if (s === 'down') return 'down';
      if (s === 'warning') return 'warning';
      if (s === 'unmanaged') return 'unmanaged';
    }
    return 'unknown';
  };

  const runSolarWindsCollect = async (args: { assetUuid: string; nodeId?: string }) => {
    if (swCollectingRef.current) return;
    swCollectingRef.current = true;
    setSwCollecting(true);

    try {
      const res = await fetch(`/api/v1/assets/${args.assetUuid}/solarwinds/collect`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(args.nodeId ? { nodeId: args.nodeId } : {}),
      });

      const body = (await res.json().catch(() => null)) as { data?: unknown; error?: { message?: string } } | null;

      if (!res.ok) {
        toast.error(body?.error?.message ?? '采集失败');
        return;
      }

      const data = body?.data;
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        toast.error('采集失败');
        return;
      }

      const status = (data as any).status as string | undefined;
      if (status === 'no_source') {
        toast.error('未配置 SolarWinds 信号来源（role=signal）');
        return;
      }
      if (status === 'no_match') {
        toast.error('SolarWinds 未找到匹配节点');
        setSwCandidates(null);
        setSwSelectedNodeId('');
        return;
      }
      if (status === 'ambiguous') {
        const candidates = Array.isArray((data as any).candidates) ? ((data as any).candidates as any[]) : [];
        const normalized = candidates
          .filter((c) => c && typeof c === 'object' && !Array.isArray(c))
          .map((c) => ({
            nodeId: String((c as any).nodeId ?? ''),
            caption: typeof (c as any).caption === 'string' ? (c as any).caption : null,
            sysName: typeof (c as any).sysName === 'string' ? (c as any).sysName : null,
            dns: typeof (c as any).dns === 'string' ? (c as any).dns : null,
            ipAddress: typeof (c as any).ipAddress === 'string' ? (c as any).ipAddress : null,
            machineType: typeof (c as any).machineType === 'string' ? (c as any).machineType : null,
            statusDescription: typeof (c as any).statusDescription === 'string' ? (c as any).statusDescription : null,
            unmanaged: typeof (c as any).unmanaged === 'boolean' ? (c as any).unmanaged : null,
            lastSyncIso: typeof (c as any).lastSyncIso === 'string' ? (c as any).lastSyncIso : null,
            matchScore: typeof (c as any).matchScore === 'number' ? (c as any).matchScore : 0,
            matchReasons: Array.isArray((c as any).matchReasons)
              ? ((c as any).matchReasons as unknown[]).filter((v): v is string => typeof v === 'string')
              : [],
          }))
          .filter((c) => c.nodeId.trim().length > 0);

        if (normalized.length === 0) {
          toast.error('采集失败：候选为空');
          return;
        }

        setSwCandidates(normalized);
        setSwSelectedNodeId(normalized[0]?.nodeId ?? '');
        toast.message('发现多个可能的 SolarWinds 节点，请选择后继续采集');
        return;
      }

      if (status === 'ok') {
        const fields = (data as any).fields as { machineName?: unknown; ipText?: unknown; osText?: unknown } | null;
        const nextMachineName = typeof fields?.machineName === 'string' ? fields.machineName : null;
        const nextIpText = typeof fields?.ipText === 'string' ? fields.ipText : null;
        const nextOsText = typeof fields?.osText === 'string' ? fields.osText : null;

        if (nextMachineName !== null) setEditMachineNameValue(nextMachineName);
        if (nextIpText !== null) setEditIpValue(nextIpText);
        if (nextOsText !== null) setEditOsValue(nextOsText);

        setSwCandidates(null);
        setSwSelectedNodeId('');

        const node = (data as any).node as any;
        const collectedAt = typeof (data as any).collectedAt === 'string' ? (data as any).collectedAt : null;
        const monitorState = mapSolarWindsMonitorState({ status: node?.status, unmanaged: node?.unmanaged });
        const monitorStatus = typeof node?.statusDescription === 'string' ? node.statusDescription : null;

        if (collectedAt) {
          setItems((prev) =>
            prev.map((it) =>
              it.assetUuid === args.assetUuid
                ? {
                    ...it,
                    monitorCovered: true,
                    monitorState,
                    monitorStatus,
                    monitorUpdatedAt: collectedAt,
                  }
                : it,
            ),
          );
          setEditTarget((prev) =>
            prev && prev.assetUuid === args.assetUuid
              ? { ...prev, monitorCovered: true, monitorState, monitorStatus, monitorUpdatedAt: collectedAt }
              : prev,
          );
        }

        toast.success('采集完成：已填充到覆盖字段（未保存）');
        return;
      }

      toast.error('采集失败：未知状态');
    } finally {
      swCollectingRef.current = false;
      setSwCollecting(false);
    }
  };

  const openColumnSettings = () => {
    void preloadColumnSettingsDialog();
    setColumnDraft(ensureCoreVisibleColumns(visibleColumns));
    setColumnSettingsOpen(true);
  };

  const handleColumnSettingsOpenChange = (open: boolean) => {
    setColumnSettingsOpen(open);
    if (!open) {
      setColumnDraft(ensureCoreVisibleColumns(visibleColumns));
      setColumnSaving(false);
    }
  };

  const handleSaveColumnSettings = async () => {
    setColumnSaving(true);
    try {
      const draft = ensureCoreVisibleColumns(columnDraft);
      setColumnDraft(draft);

      const res = await fetch('/api/v1/me/preferences', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          key: ASSETS_TABLE_COLUMNS_PREFERENCE_KEY,
          value: { visibleColumns: draft },
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        toast.error(body?.error?.message ?? '保存失败');
        return;
      }

      const body = (await res.json().catch(() => null)) as {
        data?: { value?: { visibleColumns?: unknown } };
      } | null;
      const next = sanitizeVisibleColumns(body?.data?.value?.visibleColumns) ?? draft;
      setVisibleColumns(next);
      toast.success('列配置已保存');
      handleColumnSettingsOpenChange(false);
    } finally {
      setColumnSaving(false);
    }
  };

  const openBulkSetDialog = () => {
    void preloadBulkSetLedgerDialog();
    setBulkKey('');
    setBulkValue('');
    setBulkSetOpen(true);
  };

  const handleBulkSetOpenChange = (open: boolean) => {
    setBulkSetOpen(open);
    if (!open) {
      setBulkKey('');
      setBulkValue('');
      setBulkSaving(false);
    }
  };

  const bulkFieldOptions = useMemo(
    () =>
      LEDGER_FIELD_METAS.map((meta) => {
        const isHostOnly = meta.scope === 'host_only';
        const disabled =
          isHostOnly && items.some((it) => selectedAssetUuidSet.has(it.assetUuid) && it.assetType === 'vm');

        return {
          key: meta.key,
          label: meta.labelZh,
          kind: meta.kind,
          isHostOnly,
          disabled,
        };
      }),
    [items, selectedAssetUuidSet],
  );
  const isBulkDateField = bulkKey ? bulkFieldOptions.find((field) => field.key === bulkKey)?.kind === 'date' : false;
  const canSaveBulkSet = !bulkSaving && selectedAssetUuids.length > 0 && bulkKey.length > 0;

  const handleSaveBulkSet = async () => {
    if (!bulkKey) return;
    if (selectedAssetUuids.length < 1) return;

    setBulkSaving(true);
    try {
      const valueTrimmed = bulkValue.trim();
      const value = valueTrimmed.length > 0 ? valueTrimmed : null;

      const res = await fetch('/api/v1/assets/ledger-fields/bulk-set', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assetUuids: selectedAssetUuids, key: bulkKey, value }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        toast.error(body?.error?.message ?? '批量设置失败');
        return;
      }

      setItems((prev) =>
        prev.map((it) => {
          if (!selectedAssetUuidSet.has(it.assetUuid)) return it;
          const prevField = it.ledgerFields?.[bulkKey] ?? {
            source: null,
            override: null,
            effective: null,
          };
          return {
            ...it,
            ledgerFields: {
              ...it.ledgerFields,
              [bulkKey]: {
                source: prevField.source,
                override: value,
                effective: value ?? prevField.source,
              },
            } as LedgerFieldsV1,
          };
        }),
      );

      toast.success('已批量设置');
      setSelectedAssetUuids([]);
      handleBulkSetOpenChange(false);
    } finally {
      setBulkSaving(false);
    }
  };

  const handleEditAssetOpenChange = (open: boolean) => {
    setEditAssetOpen(open);
    if (!open) resetEditState();
  };

  const handleCloseSolarWindsCandidates = () => {
    setSwCandidates(null);
    setSwSelectedNodeId('');
  };

  const handleSaveEditAsset = async () => {
    if (!editTarget) return;
    setEditSaving(true);

    try {
      const nextMachineNameOverride = editMachineNameValue.trim() ? editMachineNameValue.trim() : null;
      const nextIpOverrideText = editIpValue.trim() ? editIpValue.trim() : null;
      const nextOsOverrideText = editOsValue.trim() ? editOsValue.trim() : null;

      const res = await fetch(`/api/v1/assets/${editTarget.assetUuid}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          machineNameOverride: nextMachineNameOverride,
          ipOverrideText: nextIpOverrideText,
          osOverrideText: nextOsOverrideText,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        toast.error(body?.error?.message ?? '保存失败');
        return;
      }

      setItems((prev) =>
        prev.map((it) => {
          if (it.assetUuid !== editTarget.assetUuid) return it;

          const machineNameCollected = it.machineNameCollected;
          const machineName = nextMachineNameOverride ?? machineNameCollected;
          const machineNameMismatch =
            nextMachineNameOverride !== null &&
            machineNameCollected !== null &&
            nextMachineNameOverride !== machineNameCollected;

          const ip = nextIpOverrideText ?? it.ipCollected;
          const os = nextOsOverrideText ?? it.osCollected;

          return {
            ...it,
            machineNameOverride: nextMachineNameOverride,
            machineName,
            machineNameMismatch,
            ipOverrideText: nextIpOverrideText,
            ip,
            osOverrideText: nextOsOverrideText,
            os,
          };
        }),
      );

      toast.success('已保存');
      handleEditAssetOpenChange(false);
    } finally {
      setEditSaving(false);
    }
  };

  const handleSelectAllCurrentPage = (checked: boolean) => {
    if (checked) {
      setSelectedAssetUuids(items.map((it) => it.assetUuid));
      return;
    }

    setSelectedAssetUuids([]);
  };

  const handleToggleSelectAsset = (assetUuid: string, checked: boolean) => {
    setSelectedAssetUuids((prev) => {
      const set = new Set(prev);
      if (checked) set.add(assetUuid);
      else set.delete(assetUuid);
      return Array.from(set);
    });
  };

  const handlePageSizeChange = (pageSize: number) => {
    setFilters((prev) => ({ ...prev, page: 1, pageSize }));
  };

  const handlePrevPage = () => {
    setFilters((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }));
  };

  const handleNextPage = () => {
    setFilters((prev) => ({ ...prev, page: prev.page + 1 }));
  };

  return (
    <div className="space-y-6">
      <PageHeader title="资产" description="统一视图（canonical）。支持搜索/筛选/列设置与台账字段批量维护。" />

      <AssetsFilterPanel
        filters={filters}
        setFilters={setFilters}
        hasActiveFilters={hasActiveFilters}
        sourceOptions={sourceOptions}
        ledgerFieldFilterOptions={ledgerFieldFilterOptions}
        onClearFilters={handleClearFilters}
      />

      <Card>
        <CardHeader className="flex flex-col gap-3 space-y-0 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <div className="text-sm font-medium">列表</div>
            <div className="text-xs text-muted-foreground">
              {loading
                ? '加载中…'
                : pagination
                  ? `第 ${pagination.page} / ${pagination.totalPages} 页 · 共 ${pagination.total} 条`
                  : items.length === 0
                    ? '暂无数据'
                    : null}
              {isAdmin && selectedAssetUuids.length > 0 ? ` · 已选 ${selectedAssetUuids.length} 个（当前页）` : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="icon"
              variant="outline"
              title="列设置"
              aria-label="列设置"
              onMouseEnter={() => {
                void preloadColumnSettingsDialog();
              }}
              onFocus={() => {
                void preloadColumnSettingsDialog();
              }}
              onClick={openColumnSettings}
            >
              <Columns3 />
            </Button>

            {isAdmin ? (
              <>
                <Button
                  size="icon"
                  variant="outline"
                  title="批量设置台账覆盖值"
                  aria-label="批量设置台账覆盖值"
                  disabled={selectedAssetUuids.length < 1}
                  onMouseEnter={() => {
                    void preloadBulkSetLedgerDialog();
                  }}
                  onFocus={() => {
                    void preloadBulkSetLedgerDialog();
                  }}
                  onClick={openBulkSetDialog}
                >
                  <ClipboardPenLine />
                </Button>

                <CreateAssetLedgerExportButton
                  size="icon"
                  variant="outline"
                  title="导出台账 CSV"
                  aria-label="导出台账 CSV"
                >
                  <Download />
                </CreateAssetLedgerExportButton>

                {selectedAssetUuids.length > 0 ? (
                  <Button size="sm" variant="ghost" onClick={() => setSelectedAssetUuids([])}>
                    清空选择
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <AssetsTableContent
            loading={loading}
            items={items}
            isAdmin={isAdmin}
            selectedAssetUuidSet={selectedAssetUuidSet}
            visibleColumnsForTable={visibleColumnsForTable}
            columnLabelById={ASSET_LIST_COLUMN_LABEL_BY_ID}
            pageSize={filters.pageSize}
            canPrev={canPrev}
            canNext={canNext}
            onSelectAllCurrentPage={handleSelectAllCurrentPage}
            onToggleSelectAsset={handleToggleSelectAsset}
            onPageSizeChange={handlePageSizeChange}
            onPrevPage={handlePrevPage}
            onNextPage={handleNextPage}
            onOpenEditForItem={openEditForItem}
            onPreloadEditDialog={() => {
              void preloadEditAssetDialog();
            }}
          />

          {columnSettingsOpen ? (
            <ColumnSettingsDialog
              open={columnSettingsOpen}
              onOpenChange={handleColumnSettingsOpenChange}
              renderColumnSettingItem={renderColumnSettingItem}
              assetFieldCommonColumns={assetFieldCommonColumns}
              assetFieldVmOnlyColumns={assetFieldVmOnlyColumns}
              assetFieldHostOnlyColumns={assetFieldHostOnlyColumns}
              ledgerFieldCommonColumns={ledgerFieldCommonColumns}
              ledgerFieldHostOnlyColumns={ledgerFieldHostOnlyColumns}
              columnSaving={columnSaving}
              columnDraftLength={columnDraft.length}
              onResetDefault={() => {
                setColumnDraft(ensureCoreVisibleColumns(DEFAULT_VISIBLE_COLUMNS));
              }}
              onSave={handleSaveColumnSettings}
            />
          ) : null}

          {bulkSetOpen ? (
            <BulkSetLedgerDialog
              open={bulkSetOpen}
              onOpenChange={handleBulkSetOpenChange}
              selectedCount={selectedAssetUuids.length}
              fieldOptions={bulkFieldOptions}
              bulkKey={bulkKey}
              bulkValue={bulkValue}
              onBulkKeyChange={(value) => setBulkKey(value as LedgerFieldKey | '')}
              onBulkValueChange={setBulkValue}
              isDateField={isBulkDateField}
              isAdmin={isAdmin}
              bulkSaving={bulkSaving}
              canSave={canSaveBulkSet}
              onSave={handleSaveBulkSet}
            />
          ) : null}

          {editAssetOpen ? (
            <EditAssetDialog
              open={editAssetOpen}
              onOpenChange={handleEditAssetOpenChange}
              editTarget={editTarget}
              editMachineNameValue={editMachineNameValue}
              editIpValue={editIpValue}
              editOsValue={editOsValue}
              onEditMachineNameChange={setEditMachineNameValue}
              onEditIpChange={setEditIpValue}
              onEditOsChange={setEditOsValue}
              swCandidates={swCandidates}
              swSelectedNodeId={swSelectedNodeId}
              onSelectSolarWindsNode={setSwSelectedNodeId}
              onCloseSolarWindsCandidates={handleCloseSolarWindsCandidates}
              onCollectFromSolarWinds={runSolarWindsCollect}
              swCollecting={swCollecting}
              hasOverrideDraft={hasOverrideDraft}
              onClearOverrideDraft={clearOverrideDraft}
              editSaving={editSaving}
              onSave={handleSaveEditAsset}
              formatDateTime={formatDateTime}
            />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
