'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardPenLine, Columns3, Download, Eye, HelpCircle, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { SolarWindsMark, VeeamMark } from '@/components/icons/signal-sources';
import { CreateAssetLedgerExportButton } from '@/components/exports/create-asset-ledger-export-button';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { buildAssetListUrlSearchParams, parseAssetListUrlState } from '@/lib/assets/asset-list-url';
import {
  clearAssetListStateInSession,
  readAssetListStateFromSession,
  writeAssetListStateToSession,
} from '@/lib/assets/asset-list-persistence';
import { backupStateDisplay } from '@/lib/assets/backup-state';
import { monitorStateDisplay } from '@/lib/assets/monitor-state';
import { getOverrideVisualMeta, normalizeOptionalText } from '@/lib/assets/override-visual';
import { normalizePowerState, powerStateLabelZh } from '@/lib/assets/power-state';
import {
  shouldShowToolsNotRunning,
  TOOLS_NOT_RUNNING_TEXT,
  TOOLS_NOT_RUNNING_TOOLTIP,
} from '@/lib/assets/tools-not-running';
import { listLedgerFieldMetasV1 } from '@/lib/ledger/ledger-fields-v1';

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

type AssetListFiltersState = {
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

function powerStateLabel(powerState: string) {
  return powerStateLabelZh(powerState);
}

function powerStateBadgeVariant(powerState: string): React.ComponentProps<typeof Badge>['variant'] {
  const normalized = normalizePowerState(powerState);
  if (normalized === 'poweredOn') return 'default';
  if (normalized === 'poweredOff') return 'secondary';
  if (normalized === 'suspended') return 'outline';
  return 'outline';
}

function assetStatusLabel(status: string): string {
  if (status === 'in_service') return '在服';
  if (status === 'offline') return '离线';
  if (status === 'merged') return '已合并';
  return status;
}

function assetStatusBadgeVariant(status: string): React.ComponentProps<typeof Badge>['variant'] {
  if (status === 'in_service') return 'default';
  if (status === 'offline') return 'secondary';
  return 'outline';
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

function formatBytes(bytes: number | null) {
  if (bytes === null) return '-';
  if (!Number.isFinite(bytes) || bytes < 0) return '-';

  const gib = bytes / 1024 ** 3;
  if (gib >= 1024) return `${(gib / 1024).toFixed(1)} TiB`;
  if (gib >= 10) return `${Math.round(gib)} GiB`;
  if (gib >= 1) return `${gib.toFixed(1)} GiB`;

  const mib = bytes / 1024 ** 2;
  if (mib >= 10) return `${Math.round(mib)} MiB`;
  if (mib >= 1) return `${mib.toFixed(1)} MiB`;

  return `${bytes} B`;
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
  const [swCandidates, setSwCandidates] = useState<Array<{
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
  }> | null>(null);
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

  const renderColumnSettingItem = (col: { id: AssetListColumnId; label: string }) => {
    const locked = CORE_COLUMNS.includes(col.id as (typeof CORE_COLUMNS)[number]);
    const vmOnly = VM_ONLY_COLUMNS.includes(col.id as (typeof VM_ONLY_COLUMNS)[number]);
    const hostOnlyAsset = HOST_ONLY_COLUMNS.includes(col.id as (typeof HOST_ONLY_COLUMNS)[number]);
    const hostOnlyLedger =
      col.id.startsWith('ledger.') && LEDGER_HOST_ONLY_KEY_SET.has(col.id.slice('ledger.'.length) as LedgerFieldKey);
    const hostOnly = hostOnlyAsset || hostOnlyLedger;

    const disabled =
      locked || (vmOnly && filters.assetTypeInput === 'host') || (hostOnly && filters.assetTypeInput === 'vm');
    const checked = locked ? true : columnDraft.includes(col.id);

    return (
      <div
        key={col.id}
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
              const draft = next
                ? prev.includes(col.id)
                  ? prev
                  : [...prev, col.id]
                : prev.filter((id) => id !== col.id);
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

  return (
    <div className="space-y-6">
      <PageHeader title="资产" description="统一视图（canonical）。支持搜索/筛选/列设置与台账字段批量维护。" />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              className="sm:flex-1"
              placeholder="搜索（机器名/虚拟机名/宿主机名/操作系统/IP/地区/公司/部门/系统分类/系统分级/业务对接人员/管理IP）"
              value={filters.qInput}
              onChange={(e) => {
                setFilters((prev) => ({ ...prev, page: 1, qInput: e.target.value }));
              }}
            />
            <Button type="button" variant="outline" disabled={!hasActiveFilters} onClick={handleClearFilters}>
              清除筛选
            </Button>
          </div>

          <details open className="rounded-md border bg-background p-3">
            <summary className="cursor-pointer select-none text-sm font-medium">快捷筛选</summary>
            <div className="mt-3 grid gap-2 md:grid-cols-2 lg:grid-cols-4">
              <div className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium">仅 IP 缺失</div>
                  <div className="text-xs text-muted-foreground">仅 VM 且 IP 缺失</div>
                </div>
                <Switch
                  checked={filters.ipMissingInput}
                  onCheckedChange={(checked) => {
                    setFilters((prev) => ({
                      ...prev,
                      page: 1,
                      ipMissingInput: checked,
                      ...(checked ? { assetTypeInput: 'vm', brandInput: '', modelInput: '' } : {}),
                    }));
                  }}
                />
              </div>

              <div className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium">仅 机器名缺失</div>
                  <div className="text-xs text-muted-foreground">仅 VM 且机器名缺失</div>
                </div>
                <Switch
                  checked={filters.machineNameMissingInput}
                  onCheckedChange={(checked) => {
                    setFilters((prev) => ({
                      ...prev,
                      page: 1,
                      machineNameMissingInput: checked,
                      ...(checked ? { assetTypeInput: 'vm', brandInput: '', modelInput: '' } : {}),
                    }));
                  }}
                />
              </div>

              <div className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium">仅 机器名≠虚拟机名</div>
                  <div className="text-xs text-muted-foreground">仅 VM 且机器名与虚拟机名不一致</div>
                </div>
                <Switch
                  checked={filters.machineNameVmNameMismatchInput}
                  onCheckedChange={(checked) => {
                    setFilters((prev) => ({
                      ...prev,
                      page: 1,
                      machineNameVmNameMismatchInput: checked,
                      ...(checked ? { assetTypeInput: 'vm', brandInput: '', modelInput: '' } : {}),
                    }));
                  }}
                />
              </div>

              <div className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium">仅 最近新增</div>
                  <div className="text-xs text-muted-foreground">最近 7 天创建</div>
                </div>
                <Switch
                  checked={filters.recentAddedInput}
                  onCheckedChange={(checked) => {
                    setFilters((prev) => ({ ...prev, page: 1, recentAddedInput: checked }));
                  }}
                />
              </div>
            </div>
          </details>

          <details open className="rounded-md border bg-background p-3">
            <summary className="cursor-pointer select-none text-sm font-medium">资产字段</summary>
            <div className="mt-3 flex flex-col gap-2 md:flex-row md:flex-wrap md:items-end">
              <Select
                value={filters.assetTypeInput}
                onValueChange={(value) => {
                  setFilters((prev) => {
                    const next = { ...prev, page: 1, assetTypeInput: value as typeof prev.assetTypeInput };

                    // VM-only filters don't apply to other types; reset them to avoid confusing empty results.
                    if (value !== 'vm') {
                      next.vmPowerStateInput = 'all';
                      next.ipMissingInput = false;
                      next.machineNameMissingInput = false;
                      next.machineNameVmNameMismatchInput = false;
                    }

                    // Host-only filters don't apply to other types; reset them to avoid confusing empty results.
                    if (value !== 'host') {
                      next.brandInput = '';
                      next.modelInput = '';
                    }

                    return next;
                  });
                }}
              >
                <SelectTrigger className="w-full md:w-[150px]">
                  <SelectValue placeholder="类型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部类型</SelectItem>
                  <SelectItem value="vm">VM</SelectItem>
                  <SelectItem value="host">Host</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={filters.statusInput}
                onValueChange={(value) => {
                  setFilters((prev) => ({ ...prev, page: 1, statusInput: value as typeof prev.statusInput }));
                }}
              >
                <SelectTrigger className="w-full md:w-[160px]">
                  <SelectValue placeholder="状态" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部状态</SelectItem>
                  <SelectItem value="in_service">在服</SelectItem>
                  <SelectItem value="offline">离线</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={filters.sourceIdInput}
                onValueChange={(value) => {
                  setFilters((prev) => ({ ...prev, page: 1, sourceIdInput: value }));
                }}
              >
                <SelectTrigger className="w-full md:w-[240px]">
                  <SelectValue placeholder="来源" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部来源</SelectItem>
                  {sourceOptions.map((s) => (
                    <SelectItem key={s.sourceId} value={s.sourceId}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={filters.sourceTypeInput}
                onValueChange={(value) => {
                  setFilters((prev) => ({ ...prev, page: 1, sourceTypeInput: value as typeof prev.sourceTypeInput }));
                }}
              >
                <SelectTrigger className="w-full md:w-[180px]">
                  <SelectValue placeholder="虚拟化技术" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部技术</SelectItem>
                  <SelectItem value="vcenter">vCenter</SelectItem>
                  <SelectItem value="pve">PVE</SelectItem>
                  <SelectItem value="hyperv">Hyper-V</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={filters.brandInput || 'all'}
                onValueChange={(value) => {
                  setFilters((prev) => {
                    const next = { ...prev, page: 1, brandInput: value === 'all' ? '' : value };
                    if (value !== 'all') {
                      next.assetTypeInput = 'host';
                      next.vmPowerStateInput = 'all';
                      next.ipMissingInput = false;
                      next.machineNameMissingInput = false;
                      next.machineNameVmNameMismatchInput = false;
                    }
                    return next;
                  });
                }}
              >
                <SelectTrigger className="w-full md:w-[200px]">
                  <SelectValue placeholder="品牌" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部品牌</SelectItem>
                  {filters.brandInput && !ledgerFieldFilterOptions.brands.includes(filters.brandInput) ? (
                    <SelectItem value={filters.brandInput}>{filters.brandInput}（当前）</SelectItem>
                  ) : null}
                  {ledgerFieldFilterOptions.brands.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={filters.modelInput || 'all'}
                onValueChange={(value) => {
                  setFilters((prev) => {
                    const next = { ...prev, page: 1, modelInput: value === 'all' ? '' : value };
                    if (value !== 'all') {
                      next.assetTypeInput = 'host';
                      next.vmPowerStateInput = 'all';
                      next.ipMissingInput = false;
                      next.machineNameMissingInput = false;
                      next.machineNameVmNameMismatchInput = false;
                    }
                    return next;
                  });
                }}
              >
                <SelectTrigger className="w-full md:w-[200px]">
                  <SelectValue placeholder="型号" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部型号</SelectItem>
                  {filters.modelInput && !ledgerFieldFilterOptions.models.includes(filters.modelInput) ? (
                    <SelectItem value={filters.modelInput}>{filters.modelInput}（当前）</SelectItem>
                  ) : null}
                  {ledgerFieldFilterOptions.models.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={filters.vmPowerStateInput}
                onValueChange={(value) => {
                  setFilters((prev) => {
                    const next = {
                      ...prev,
                      page: 1,
                      vmPowerStateInput: value as typeof prev.vmPowerStateInput,
                    };
                    if (value !== 'all') {
                      next.assetTypeInput = 'vm';
                      next.brandInput = '';
                      next.modelInput = '';
                    }
                    return next;
                  });
                }}
              >
                <SelectTrigger className="w-full md:w-[160px]">
                  <SelectValue placeholder="电源状态" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部电源状态</SelectItem>
                  <SelectItem value="poweredOn">运行</SelectItem>
                  <SelectItem value="poweredOff">关机</SelectItem>
                  <SelectItem value="suspended">挂起</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={filters.osInput || 'all'}
                onValueChange={(value) => {
                  setFilters((prev) => ({ ...prev, page: 1, osInput: value === 'all' ? '' : value }));
                }}
              >
                <SelectTrigger className="w-full md:w-[220px]">
                  <SelectValue placeholder="操作系统" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部操作系统</SelectItem>
                  {filters.osInput && !ledgerFieldFilterOptions.osNames.includes(filters.osInput) ? (
                    <SelectItem value={filters.osInput}>{filters.osInput}（当前）</SelectItem>
                  ) : null}
                  {ledgerFieldFilterOptions.osNames.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </details>

          <details className="rounded-md border bg-background p-3">
            <summary className="cursor-pointer select-none text-sm font-medium">台账字段</summary>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Select
                value={filters.regionInput || 'all'}
                onValueChange={(value) => {
                  setFilters((prev) => ({ ...prev, page: 1, regionInput: value === 'all' ? '' : value }));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="地区（台账）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部地区</SelectItem>
                  {filters.regionInput && !ledgerFieldFilterOptions.regions.includes(filters.regionInput) ? (
                    <SelectItem value={filters.regionInput}>{filters.regionInput}（当前）</SelectItem>
                  ) : null}
                  {ledgerFieldFilterOptions.regions.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={filters.companyInput || 'all'}
                onValueChange={(value) => {
                  setFilters((prev) => ({ ...prev, page: 1, companyInput: value === 'all' ? '' : value }));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="公司（台账）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部公司</SelectItem>
                  {filters.companyInput && !ledgerFieldFilterOptions.companies.includes(filters.companyInput) ? (
                    <SelectItem value={filters.companyInput}>{filters.companyInput}（当前）</SelectItem>
                  ) : null}
                  {ledgerFieldFilterOptions.companies.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={filters.departmentInput || 'all'}
                onValueChange={(value) => {
                  setFilters((prev) => ({ ...prev, page: 1, departmentInput: value === 'all' ? '' : value }));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="部门（台账）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部部门</SelectItem>
                  {filters.departmentInput &&
                  !ledgerFieldFilterOptions.departments.includes(filters.departmentInput) ? (
                    <SelectItem value={filters.departmentInput}>{filters.departmentInput}（当前）</SelectItem>
                  ) : null}
                  {ledgerFieldFilterOptions.departments.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={filters.systemCategoryInput || 'all'}
                onValueChange={(value) => {
                  setFilters((prev) => ({ ...prev, page: 1, systemCategoryInput: value === 'all' ? '' : value }));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="系统分类（台账）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部系统分类</SelectItem>
                  {filters.systemCategoryInput &&
                  !ledgerFieldFilterOptions.systemCategories.includes(filters.systemCategoryInput) ? (
                    <SelectItem value={filters.systemCategoryInput}>{filters.systemCategoryInput}（当前）</SelectItem>
                  ) : null}
                  {ledgerFieldFilterOptions.systemCategories.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={filters.systemLevelInput || 'all'}
                onValueChange={(value) => {
                  setFilters((prev) => ({ ...prev, page: 1, systemLevelInput: value === 'all' ? '' : value }));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="系统分级（台账）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部系统分级</SelectItem>
                  {filters.systemLevelInput &&
                  !ledgerFieldFilterOptions.systemLevels.includes(filters.systemLevelInput) ? (
                    <SelectItem value={filters.systemLevelInput}>{filters.systemLevelInput}（当前）</SelectItem>
                  ) : null}
                  {ledgerFieldFilterOptions.systemLevels.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={filters.bizOwnerInput || 'all'}
                onValueChange={(value) => {
                  setFilters((prev) => ({ ...prev, page: 1, bizOwnerInput: value === 'all' ? '' : value }));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="业务对接人员（台账）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部业务对接人员</SelectItem>
                  {filters.bizOwnerInput && !ledgerFieldFilterOptions.bizOwners.includes(filters.bizOwnerInput) ? (
                    <SelectItem value={filters.bizOwnerInput}>{filters.bizOwnerInput}（当前）</SelectItem>
                  ) : null}
                  {ledgerFieldFilterOptions.bizOwners.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </details>
        </CardContent>
      </Card>

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
              onClick={() => {
                setColumnDraft(ensureCoreVisibleColumns(visibleColumns));
                setColumnSettingsOpen(true);
              }}
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
                  onClick={() => {
                    setBulkKey('');
                    setBulkValue('');
                    setBulkSetOpen(true);
                  }}
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
          {loading ? (
            <div className="text-sm text-muted-foreground">加载中…</div>
          ) : items.length === 0 ? (
            <div className="text-sm text-muted-foreground">暂无资产。请先配置来源并触发一次 collect Run。</div>
          ) : (
            <>
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow>
                    {isAdmin ? (
                      <TableHead className="w-[36px]">
                        <input
                          type="checkbox"
                          aria-label="选择当前页"
                          checked={items.length > 0 && items.every((it) => selectedAssetUuidSet.has(it.assetUuid))}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedAssetUuids(items.map((it) => it.assetUuid));
                            else setSelectedAssetUuids([]);
                          }}
                        />
                      </TableHead>
                    ) : null}

                    {visibleColumnsForTable.map((colId) => {
                      const label = ASSET_LIST_COLUMN_LABEL_BY_ID.get(colId) ?? colId;
                      const rightAligned =
                        colId === 'cpuCount' || colId === 'memoryBytes' || colId === 'totalDiskBytes';
                      const centerAligned = colId === 'monitorState';
                      const headClassName = rightAligned
                        ? 'text-right'
                        : centerAligned
                          ? 'w-[64px] text-center'
                          : undefined;
                      return (
                        <TableHead key={colId} className={headClassName}>
                          {label}
                        </TableHead>
                      );
                    })}
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.assetUuid}>
                      {isAdmin ? (
                        <TableCell>
                          <input
                            type="checkbox"
                            aria-label="选择资产"
                            checked={selectedAssetUuidSet.has(item.assetUuid)}
                            onChange={(e) => {
                              setSelectedAssetUuids((prev) => {
                                const set = new Set(prev);
                                if (e.target.checked) set.add(item.assetUuid);
                                else set.delete(item.assetUuid);
                                return Array.from(set);
                              });
                            }}
                          />
                        </TableCell>
                      ) : null}

                      {visibleColumnsForTable.map((colId) => {
                        const showToolsNotRunning = shouldShowToolsNotRunning({
                          assetType: item.assetType,
                          powerState: item.vmPowerState,
                          toolsRunning: item.toolsRunning,
                        });
                        const toolsNotRunningNode = showToolsNotRunning ? (
                          <span className="cursor-help text-muted-foreground" title={TOOLS_NOT_RUNNING_TOOLTIP}>
                            {TOOLS_NOT_RUNNING_TEXT}
                          </span>
                        ) : null;

                        if (colId === 'machineName') {
                          const machineNameOverride = normalizeOptionalText(item.machineNameOverride);
                          const machineNameCollected = normalizeOptionalText(item.machineNameCollected);
                          const visualMeta = getOverrideVisualMeta({
                            overrideText: machineNameOverride,
                            collectedText: machineNameCollected,
                            mismatch: item.machineNameMismatch,
                          });
                          const lineClassName = `flex flex-wrap items-center gap-2 border-l-2 pl-2 font-medium ${visualMeta.borderClassName}`;

                          return (
                            <TableCell key={colId}>
                              <div className={lineClassName} title={visualMeta.title}>
                                {item.machineName ? <span>{item.machineName}</span> : (toolsNotRunningNode ?? '-')}
                              </div>
                            </TableCell>
                          );
                        }

                        if (colId === 'status') {
                          return (
                            <TableCell key={colId}>
                              <Badge variant={assetStatusBadgeVariant(item.status)}>
                                {assetStatusLabel(item.status)}
                              </Badge>
                            </TableCell>
                          );
                        }

                        if (colId === 'vmName') {
                          return (
                            <TableCell key={colId} className="font-medium">
                              {item.vmName ?? '-'}
                            </TableCell>
                          );
                        }

                        if (colId === 'hostName') {
                          return (
                            <TableCell key={colId} className="font-medium">
                              {item.hostName ?? '-'}
                            </TableCell>
                          );
                        }

                        if (colId === 'os') {
                          const visualMeta = getOverrideVisualMeta({
                            overrideText: normalizeOptionalText(item.osOverrideText),
                            collectedText: normalizeOptionalText(item.osCollected),
                          });
                          return (
                            <TableCell key={colId} className="max-w-[240px] whitespace-normal break-words text-sm">
                              <div
                                className={`flex flex-wrap items-center gap-2 border-l-2 pl-2 ${visualMeta.borderClassName}`}
                                title={visualMeta.title}
                              >
                                <span>{item.os ? item.os : (toolsNotRunningNode ?? '-')}</span>
                              </div>
                            </TableCell>
                          );
                        }

                        if (colId === 'ip') {
                          const visualMeta = getOverrideVisualMeta({
                            overrideText: normalizeOptionalText(item.ipOverrideText),
                            collectedText: normalizeOptionalText(item.ipCollected),
                          });
                          const lineClassName = `flex flex-wrap items-center gap-2 border-l-2 pl-2 ${visualMeta.borderClassName}`;
                          return (
                            <TableCell
                              key={colId}
                              className="max-w-[280px] whitespace-normal break-all font-mono text-xs"
                            >
                              <div className={lineClassName} title={visualMeta.title}>
                                <span>{item.ip ? item.ip : (toolsNotRunningNode ?? '-')}</span>
                              </div>
                            </TableCell>
                          );
                        }

                        if (colId === 'brand') {
                          return (
                            <TableCell key={colId} className="max-w-[220px] whitespace-normal break-words text-sm">
                              {item.brand ?? '-'}
                            </TableCell>
                          );
                        }

                        if (colId === 'model') {
                          return (
                            <TableCell key={colId} className="max-w-[220px] whitespace-normal break-words text-sm">
                              {item.model ?? '-'}
                            </TableCell>
                          );
                        }

                        if (colId === 'monitorState') {
                          const display = monitorStateDisplay({
                            monitorCovered: item.monitorCovered,
                            monitorState: item.monitorState,
                          });
                          const backupDisplay = backupStateDisplay({
                            backupCovered: item.backupCovered,
                            backupState: item.backupState,
                          });

                          if (!display && !backupDisplay) {
                            return (
                              <TableCell key={colId} className="text-center">
                                <span className="inline-flex items-center justify-center" title="无监控/备份信息">
                                  <HelpCircle
                                    className="h-4 w-4 text-slate-400 dark:text-slate-500"
                                    aria-hidden="true"
                                  />
                                  <span className="sr-only">无监控/备份信息</span>
                                </span>
                              </TableCell>
                            );
                          }

                          const solarwindsTitleParts: string[] = [];
                          if (display) {
                            solarwindsTitleParts.push(`SolarWinds：${display.labelZh}`);
                            if (item.monitorStatus) solarwindsTitleParts.push(item.monitorStatus);
                            if (item.monitorUpdatedAt)
                              solarwindsTitleParts.push(`更新：${formatDateTime(item.monitorUpdatedAt)}`);
                          }
                          const solarwindsTitle = solarwindsTitleParts.join(' · ');

                          const veeamTitleParts: string[] = [];
                          if (backupDisplay) {
                            veeamTitleParts.push(`Veeam：${backupDisplay.labelZh}`);
                            if (item.backupLastResult) veeamTitleParts.push(`结果：${item.backupLastResult}`);
                            if (item.backupLastSuccessAt)
                              veeamTitleParts.push(`最近成功：${formatDateTime(item.backupLastSuccessAt)}`);
                            if (item.backupUpdatedAt)
                              veeamTitleParts.push(`更新：${formatDateTime(item.backupUpdatedAt)}`);
                          }
                          const veeamTitle = veeamTitleParts.join(' · ');

                          const solarwindsTone =
                            display?.state === 'up'
                              ? ('good' as const)
                              : display?.state === 'warning'
                                ? ('warning' as const)
                                : display?.state === 'down'
                                  ? ('bad' as const)
                                  : ('muted' as const);

                          const veeamTone =
                            backupDisplay?.state === 'success'
                              ? ('good' as const)
                              : backupDisplay?.state === 'warning'
                                ? ('warning' as const)
                                : backupDisplay?.state === 'failed'
                                  ? ('bad' as const)
                                  : ('muted' as const);

                          return (
                            <TableCell key={colId} className="text-center">
                              <span className="inline-flex items-center justify-center gap-1">
                                {display ? <SolarWindsMark tone={solarwindsTone} title={solarwindsTitle} /> : null}
                                {backupDisplay ? <VeeamMark tone={veeamTone} title={veeamTitle} /> : null}
                              </span>
                            </TableCell>
                          );
                        }

                        if (colId === 'recordedAt') {
                          return (
                            <TableCell
                              key={colId}
                              className="whitespace-nowrap font-mono text-xs text-muted-foreground"
                            >
                              {formatDateTime(item.recordedAt)}
                            </TableCell>
                          );
                        }

                        if (colId === 'cpuCount') {
                          return (
                            <TableCell key={colId} className="text-right">
                              {item.cpuCount ?? '-'}
                            </TableCell>
                          );
                        }

                        if (colId === 'memoryBytes') {
                          return (
                            <TableCell key={colId} className="text-right">
                              {formatBytes(item.memoryBytes)}
                            </TableCell>
                          );
                        }

                        if (colId === 'totalDiskBytes') {
                          return (
                            <TableCell key={colId} className="text-right">
                              {formatBytes(item.totalDiskBytes)}
                            </TableCell>
                          );
                        }

                        if (colId === 'vmPowerState') {
                          return (
                            <TableCell key={colId}>
                              {item.vmPowerState ? (
                                <Badge variant={powerStateBadgeVariant(item.vmPowerState)}>
                                  {powerStateLabel(item.vmPowerState)}
                                </Badge>
                              ) : (
                                '-'
                              )}
                            </TableCell>
                          );
                        }

                        if (colId.startsWith('ledger.')) {
                          const key = colId.slice('ledger.'.length) as LedgerFieldKey;
                          const sourceValue = item.ledgerFields?.[key]?.source ?? null;
                          const overrideValue = item.ledgerFields?.[key]?.override ?? null;
                          const effectiveValue = item.ledgerFields?.[key]?.effective ?? null;
                          const tooltip = [
                            `来源值：${sourceValue ?? '-'}`,
                            `覆盖值：${overrideValue ?? '-'}`,
                            `生效值：${effectiveValue ?? '-'}`,
                          ].join('\n');
                          return (
                            <TableCell
                              key={colId}
                              className="max-w-[220px] whitespace-normal break-words text-sm"
                              title={tooltip}
                            >
                              {effectiveValue ?? '-'}
                            </TableCell>
                          );
                        }

                        return <TableCell key={colId}>-</TableCell>;
                      })}

                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {isAdmin ? (
                            <Button
                              size="icon"
                              variant="outline"
                              title="编辑/覆盖字段"
                              aria-label="编辑/覆盖字段"
                              onClick={() => {
                                openEditForItem(item);
                              }}
                            >
                              <Pencil />
                            </Button>
                          ) : null}
                          <Button asChild size="icon" variant="outline" title="查看详情" aria-label="查看详情">
                            <Link href={`/assets/${item.assetUuid}`}>
                              <Eye />
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <div className="text-xs text-muted-foreground">每页</div>
                  <Select
                    value={String(filters.pageSize)}
                    onValueChange={(value) => {
                      setFilters((prev) => ({ ...prev, page: 1, pageSize: Number(value) }));
                    }}
                  >
                    <SelectTrigger className="w-[120px]">
                      <SelectValue placeholder="每页" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10 / 页</SelectItem>
                      <SelectItem value="20">20 / 页</SelectItem>
                      <SelectItem value="50">50 / 页</SelectItem>
                      <SelectItem value="100">100 / 页</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canPrev}
                    onClick={() => setFilters((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                  >
                    上一页
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canNext}
                    onClick={() => setFilters((prev) => ({ ...prev, page: prev.page + 1 }))}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            </>
          )}

          <Dialog
            open={columnSettingsOpen}
            onOpenChange={(open) => {
              setColumnSettingsOpen(open);
              if (!open) {
                setColumnDraft(ensureCoreVisibleColumns(visibleColumns));
                setColumnSaving(false);
              }
            }}
          >
            <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col">
              <DialogHeader>
                <DialogTitle>列设置</DialogTitle>
                <DialogDescription>列配置按用户保存到数据库，可在不同设备复用。</DialogDescription>
              </DialogHeader>

              <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto pr-1 md:grid-cols-2">
                <div className="min-w-0 space-y-4">
                  <div className="text-sm font-semibold">资产字段</div>

                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground">通用字段</div>
                    <div className="space-y-2">{assetFieldCommonColumns.map(renderColumnSettingItem)}</div>
                  </div>

                  {assetFieldVmOnlyColumns.length > 0 ? (
                    <div className="space-y-2">
                      <div className="text-xs font-medium text-muted-foreground">VM 专属</div>
                      <div className="space-y-2">{assetFieldVmOnlyColumns.map(renderColumnSettingItem)}</div>
                    </div>
                  ) : null}

                  {assetFieldHostOnlyColumns.length > 0 ? (
                    <div className="space-y-2">
                      <div className="text-xs font-medium text-muted-foreground">Host 专属</div>
                      <div className="space-y-2">{assetFieldHostOnlyColumns.map(renderColumnSettingItem)}</div>
                    </div>
                  ) : null}
                </div>

                <div className="min-w-0 space-y-4">
                  <div className="text-sm font-semibold">台账字段</div>

                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground">通用字段</div>
                    <div className="space-y-2">{ledgerFieldCommonColumns.map(renderColumnSettingItem)}</div>
                  </div>

                  {ledgerFieldHostOnlyColumns.length > 0 ? (
                    <div className="space-y-2">
                      <div className="text-xs font-medium text-muted-foreground">Host 专属</div>
                      <div className="space-y-2">{ledgerFieldHostOnlyColumns.map(renderColumnSettingItem)}</div>
                    </div>
                  ) : null}
                </div>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  disabled={columnSaving}
                  onClick={() => {
                    setColumnDraft(ensureCoreVisibleColumns(DEFAULT_VISIBLE_COLUMNS));
                  }}
                >
                  恢复默认
                </Button>
                <Button
                  variant="outline"
                  disabled={columnSaving}
                  onClick={() => {
                    setColumnSettingsOpen(false);
                  }}
                >
                  取消
                </Button>
                <Button
                  disabled={columnSaving || columnDraft.length < 1}
                  onClick={async () => {
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
                      setColumnSettingsOpen(false);
                    } finally {
                      setColumnSaving(false);
                    }
                  }}
                >
                  保存
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog
            open={bulkSetOpen}
            onOpenChange={(open) => {
              setBulkSetOpen(open);
              if (!open) {
                setBulkKey('');
                setBulkValue('');
                setBulkSaving(false);
              }
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>批量设置台账覆盖值</DialogTitle>
                <DialogDescription>仅支持对“当前页勾选”的资产批量设置 1 个字段（N≤100）。</DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="text-xs text-muted-foreground">已选择：{selectedAssetUuids.length} 个资产</div>

                <div className="space-y-2">
                  <Label>字段</Label>
                  <Select
                    value={bulkKey || 'choose'}
                    onValueChange={(value) => {
                      setBulkKey(value === 'choose' ? '' : (value as LedgerFieldKey));
                      setBulkValue('');
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择字段" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="choose">请选择</SelectItem>
                      {LEDGER_FIELD_METAS.map((m) => {
                        const disabled =
                          m.scope === 'host_only' &&
                          items.some((it) => selectedAssetUuidSet.has(it.assetUuid) && it.assetType === 'vm');
                        return (
                          <SelectItem key={m.key} value={m.key} disabled={disabled}>
                            {m.labelZh}
                            {m.scope === 'host_only' ? '（仅 Host）' : ''}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>值</Label>
                  {bulkKey && LEDGER_FIELD_METAS.find((m) => m.key === bulkKey)?.kind === 'date' ? (
                    <Input type="date" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} />
                  ) : (
                    <Input
                      value={bulkValue}
                      placeholder="留空表示清空"
                      onChange={(e) => setBulkValue(e.target.value)}
                    />
                  )}
                  <div className="text-xs text-muted-foreground">留空表示清空（等价 value=null）。</div>
                </div>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  disabled={bulkSaving}
                  onClick={() => {
                    setBulkSetOpen(false);
                  }}
                >
                  取消
                </Button>
                <Button
                  disabled={!isAdmin || bulkSaving || selectedAssetUuids.length < 1 || !bulkKey}
                  onClick={async () => {
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
                      setBulkSetOpen(false);
                    } finally {
                      setBulkSaving(false);
                    }
                  }}
                >
                  保存
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog
            open={editAssetOpen}
            onOpenChange={(open) => {
              setEditAssetOpen(open);
              if (!open) resetEditState();
            }}
          >
            <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle>编辑资产字段</DialogTitle>
                <DialogDescription>
                  可覆盖机器名 / IP / 操作系统。打开编辑后，可手动点击采集图标把 SolarWinds
                  采集值填充到覆盖字段（不会自动保存）。
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-6 md:grid-cols-2">
                <div className="flex h-full flex-col rounded-md border bg-muted/30 p-3 text-xs">
                  <div className="font-medium">覆盖值（草稿）</div>
                  <div className="mt-3 flex-1 space-y-3 text-sm">
                    <div className="space-y-1.5">
                      <Label htmlFor="asset-machineNameOverride">机器名（覆盖）</Label>
                      <Input
                        id="asset-machineNameOverride"
                        value={editMachineNameValue}
                        placeholder="留空表示不覆盖"
                        onChange={(e) => setEditMachineNameValue(e.target.value)}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="asset-ipOverrideText">IP（覆盖）</Label>
                      <Input
                        id="asset-ipOverrideText"
                        value={editIpValue}
                        placeholder="多个用逗号分隔；留空表示不覆盖"
                        onChange={(e) => setEditIpValue(e.target.value)}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="asset-osOverrideText">操作系统（覆盖）</Label>
                      <Input
                        id="asset-osOverrideText"
                        value={editOsValue}
                        placeholder="留空表示不覆盖"
                        onChange={(e) => setEditOsValue(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    支持多个 IP（逗号分隔）；资产清单展示/搜索/筛选会优先使用覆盖值。
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex h-full flex-col rounded-md border bg-muted/30 p-3 text-xs">
                    <div className="font-medium">采集值（当前）</div>
                    <div className="mt-3 flex-1 space-y-3">
                      <div>
                        <div className="text-muted-foreground">机器名</div>
                        <div className="mt-1 font-mono break-all">{editTarget?.machineNameCollected ?? '暂无'}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">IP</div>
                        <div className="mt-1 font-mono break-all">{editTarget?.ipCollected ?? '暂无'}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">操作系统</div>
                        <div className="mt-1 break-words">{editTarget?.osCollected ?? '暂无'}</div>
                      </div>
                    </div>
                  </div>

                  {swCandidates ? (
                    <div className="space-y-2">
                      <div className="text-sm font-medium">多个 SolarWinds 节点匹配</div>
                      <div className="text-xs text-muted-foreground">
                        请选择一个节点继续采集（采集会填充覆盖字段，但不会自动保存）。
                      </div>
                      <div className="max-h-[260px] space-y-2 overflow-auto rounded-md border bg-background p-2">
                        {swCandidates.map((c) => {
                          const title = c.caption ?? c.sysName ?? c.dns ?? `Node ${c.nodeId}`;
                          const subtitleParts = [
                            c.ipAddress ? `IP: ${c.ipAddress}` : null,
                            c.machineType ? `OS: ${c.machineType}` : null,
                            c.unmanaged === true ? 'Unmanaged' : null,
                            c.lastSyncIso ? `LastSync: ${formatDateTime(c.lastSyncIso)}` : null,
                          ].filter((v): v is string => typeof v === 'string' && v.length > 0);

                          return (
                            <label
                              key={c.nodeId}
                              className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors hover:bg-muted/30 ${
                                swSelectedNodeId === c.nodeId ? 'border-primary/50 bg-muted/20' : ''
                              }`}
                            >
                              <input
                                type="radio"
                                name="sw_node"
                                className="mt-1"
                                checked={swSelectedNodeId === c.nodeId}
                                onChange={() => setSwSelectedNodeId(c.nodeId)}
                              />
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="min-w-0 break-all font-medium">{title}</div>
                                  <Badge variant="outline">NodeID: {c.nodeId}</Badge>
                                  <Badge variant="secondary">score {c.matchScore}</Badge>
                                </div>
                                {subtitleParts.length > 0 ? (
                                  <div className="mt-1 break-words text-xs text-muted-foreground">
                                    {subtitleParts.join(' · ')}
                                  </div>
                                ) : null}
                                {c.matchReasons.length > 0 ? (
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    命中：{c.matchReasons.join(', ')}
                                  </div>
                                ) : null}
                                {c.statusDescription ? (
                                  <div className="mt-1 text-xs text-muted-foreground">状态：{c.statusDescription}</div>
                                ) : null}
                              </div>
                            </label>
                          );
                        })}
                      </div>

                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={swCollecting}
                          onClick={() => {
                            setSwCandidates(null);
                            setSwSelectedNodeId('');
                          }}
                        >
                          关闭
                        </Button>
                        <Button
                          size="sm"
                          disabled={!editTarget || !swSelectedNodeId || swCollecting}
                          onClick={() => {
                            if (!editTarget || !swSelectedNodeId) return;
                            void runSolarWindsCollect({ assetUuid: editTarget.assetUuid, nodeId: swSelectedNodeId });
                          }}
                        >
                          选择并采集
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <DialogFooter className="flex-row items-center justify-between gap-2 sm:space-x-0">
                <div className="flex items-center gap-2">
                  <Button
                    size="icon"
                    variant="outline"
                    title="采集并填充覆盖草稿（不会自动保存）"
                    aria-label="采集并填充覆盖草稿"
                    disabled={!editTarget || swCollecting}
                    onClick={() => {
                      if (!editTarget) return;
                      void runSolarWindsCollect({ assetUuid: editTarget.assetUuid });
                    }}
                  >
                    <RefreshCw className={swCollecting ? 'animate-spin' : undefined} />
                  </Button>
                  <Button
                    size="icon"
                    variant="outline"
                    title="清空覆盖草稿（需点击保存生效）"
                    aria-label="清空覆盖草稿"
                    disabled={editSaving || swCollecting || !hasOverrideDraft}
                    onClick={clearOverrideDraft}
                  >
                    <Trash2 />
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    disabled={editSaving || swCollecting}
                    onClick={() => {
                      setEditAssetOpen(false);
                    }}
                  >
                    取消
                  </Button>
                  <Button
                    disabled={!editTarget || editSaving}
                    onClick={async () => {
                      if (!editTarget) return;
                      setEditSaving(true);

                      try {
                        const nextMachineNameOverride = editMachineNameValue.trim()
                          ? editMachineNameValue.trim()
                          : null;
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
                        setEditAssetOpen(false);
                      } finally {
                        setEditSaving(false);
                      }
                    }}
                  >
                    保存
                  </Button>
                </div>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    </div>
  );
}
