'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardPenLine, Columns3, Download, Eye, Pencil } from 'lucide-react';
import { toast } from 'sonner';

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
import { IdText } from '@/components/ui/id-text';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { buildAssetListUrlSearchParams, parseAssetListUrlState } from '@/lib/assets/asset-list-url';
import { monitorStateDisplay } from '@/lib/assets/monitor-state';
import { normalizePowerState, powerStateLabelZh } from '@/lib/assets/power-state';
import {
  shouldShowToolsNotRunning,
  TOOLS_NOT_RUNNING_TEXT,
  TOOLS_NOT_RUNNING_TOOLTIP,
} from '@/lib/assets/tools-not-running';
import { listLedgerFieldMetasV1 } from '@/lib/ledger/ledger-fields-v1';

import type { AssetListUrlState, VmPowerStateParam } from '@/lib/assets/asset-list-url';
import type { LedgerFieldKey, LedgerFieldsV1 } from '@/lib/ledger/ledger-fields-v1';

type AssetListItem = {
  assetUuid: string;
  assetType: string;
  status: string;
  machineName: string | null;
  machineNameOverride: string | null;
  machineNameCollected: string | null;
  machineNameMismatch: boolean;
  hostName: string | null;
  vmName: string | null;
  os: string | null;
  vmPowerState: string | null;
  toolsRunning: boolean | null;
  ip: string | null;
  monitorCovered: boolean | null;
  monitorState: string | null;
  monitorStatus: string | null;
  monitorUpdatedAt: string | null;
  recordedAt: string;
  ledgerFields: LedgerFieldsV1;
  cpuCount: number | null;
  memoryBytes: number | null;
  totalDiskBytes: number | null;
};

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type SourceOption = { sourceId: string; name: string };

type LedgerFieldFilterOptions = {
  regions: string[];
  companies: string[];
  departments: string[];
  systemCategories: string[];
  systemLevels: string[];
  bizOwners: string[];
  osNames: string[];
};

type AssetListColumnId =
  | 'machineName'
  | 'vmName'
  | 'hostName'
  | 'os'
  | 'ip'
  | 'monitorState'
  | 'recordedAt'
  | 'cpuCount'
  | 'memoryBytes'
  | 'totalDiskBytes'
  | 'vmPowerState'
  | `ledger.${LedgerFieldKey}`;

const ASSETS_TABLE_COLUMNS_PREFERENCE_KEY = 'assets.table.columns.v1' as const;

const BASE_ASSET_LIST_COLUMNS: Array<{
  id: AssetListColumnId;
  label: string;
  description?: string;
}> = [
  { id: 'machineName', label: '机器名', description: '支持“覆盖显示”，并标记覆盖≠采集。' },
  { id: 'vmName', label: '虚拟机名', description: '仅 VM。' },
  { id: 'hostName', label: '宿主机名', description: '仅 VM（VM --runs_on--> Host displayName）。' },
  { id: 'os', label: '操作系统' },
  { id: 'ip', label: 'IP', description: 'VM 若 Tools / Guest 服务未运行可能缺失。' },
  { id: 'monitorState', label: '监控', description: 'SolarWinds 监控覆盖与状态（信号来源；不影响库存）。' },
  { id: 'cpuCount', label: 'CPU' },
  { id: 'memoryBytes', label: '内存' },
  { id: 'totalDiskBytes', label: '总分配磁盘' },
  { id: 'vmPowerState', label: '电源', description: '电源状态（poweredOn/off/suspended）。' },
  { id: 'recordedAt', label: '录入时间', description: '若未录入台账字段，默认显示第一次采集时间。' },
];

const LEDGER_FIELD_METAS = listLedgerFieldMetasV1();
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

const EMPTY_LEDGER_FIELD_FILTER_OPTIONS: LedgerFieldFilterOptions = {
  regions: [],
  companies: [],
  departments: [],
  systemCategories: [],
  systemLevels: [],
  bizOwners: [],
  osNames: [],
};

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

export default function AssetsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const skipNextUrlSyncRef = useRef(false);

  const [items, setItems] = useState<AssetListItem[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);

  const [role, setRole] = useState<'admin' | 'user' | null>(null);
  const isAdmin = role === 'admin';

  const [sourceOptions, setSourceOptions] = useState<SourceOption[]>([]);
  const [ledgerFieldFilterOptions, setLedgerFieldFilterOptions] = useState<LedgerFieldFilterOptions>(
    EMPTY_LEDGER_FIELD_FILTER_OPTIONS,
  );

  const [visibleColumns, setVisibleColumns] = useState<AssetListColumnId[]>(DEFAULT_VISIBLE_COLUMNS);
  const [columnSettingsOpen, setColumnSettingsOpen] = useState(false);
  const [columnDraft, setColumnDraft] = useState<AssetListColumnId[]>(DEFAULT_VISIBLE_COLUMNS);
  const [columnSaving, setColumnSaving] = useState(false);

  const [selectedAssetUuids, setSelectedAssetUuids] = useState<string[]>([]);
  const selectedAssetUuidSet = useMemo(() => new Set(selectedAssetUuids), [selectedAssetUuids]);

  const [bulkSetOpen, setBulkSetOpen] = useState(false);
  const [bulkKey, setBulkKey] = useState<LedgerFieldKey | ''>('');
  const [bulkValue, setBulkValue] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);

  const [qInput, setQInput] = useState('');
  const [assetTypeInput, setAssetTypeInput] = useState<'all' | 'vm' | 'host'>('all');
  const [sourceIdInput, setSourceIdInput] = useState<'all' | string>('all');
  const [sourceTypeInput, setSourceTypeInput] = useState<'all' | 'vcenter' | 'pve' | 'hyperv'>('all');
  const [vmPowerStateInput, setVmPowerStateInput] = useState<'all' | VmPowerStateParam>('all');
  const [ipMissingInput, setIpMissingInput] = useState(false);
  const [machineNameMissingInput, setMachineNameMissingInput] = useState(false);
  const [machineNameVmNameMismatchInput, setMachineNameVmNameMismatchInput] = useState(false);
  const [recentAddedInput, setRecentAddedInput] = useState(false);
  const [regionInput, setRegionInput] = useState('');
  const [companyInput, setCompanyInput] = useState('');
  const [departmentInput, setDepartmentInput] = useState('');
  const [systemCategoryInput, setSystemCategoryInput] = useState('');
  const [systemLevelInput, setSystemLevelInput] = useState('');
  const [bizOwnerInput, setBizOwnerInput] = useState('');
  const [osInput, setOsInput] = useState('');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [editMachineNameOpen, setEditMachineNameOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AssetListItem | null>(null);
  const [editMachineNameValue, setEditMachineNameValue] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const query = useMemo(() => {
    const assetType = assetTypeInput === 'all' ? undefined : assetTypeInput;
    const sourceType = sourceTypeInput === 'all' ? undefined : sourceTypeInput;
    const vmPowerState = vmPowerStateInput === 'all' ? undefined : vmPowerStateInput;
    const ipMissing = ipMissingInput ? true : undefined;
    const machineNameMissing = machineNameMissingInput ? true : undefined;
    const machineNameVmNameMismatch = machineNameVmNameMismatchInput ? true : undefined;
    const createdWithinDays = recentAddedInput ? 7 : undefined;

    // VM-only filters imply `asset_type=vm`.
    const impliedAssetType =
      vmPowerState || ipMissing || machineNameMissing || machineNameVmNameMismatch ? ('vm' as const) : assetType;

    return {
      q: qInput.trim() ? qInput.trim() : undefined,
      assetType: impliedAssetType,
      // Cluster is treated as a virtual asset type and is intentionally hidden from the assets page for now.
      excludeAssetType: 'cluster' as const,
      sourceId: sourceIdInput === 'all' ? undefined : sourceIdInput,
      sourceType,
      region: regionInput.trim() ? regionInput.trim() : undefined,
      company: companyInput.trim() ? companyInput.trim() : undefined,
      department: departmentInput.trim() ? departmentInput.trim() : undefined,
      systemCategory: systemCategoryInput.trim() ? systemCategoryInput.trim() : undefined,
      systemLevel: systemLevelInput.trim() ? systemLevelInput.trim() : undefined,
      bizOwner: bizOwnerInput.trim() ? bizOwnerInput.trim() : undefined,
      os: osInput.trim() ? osInput.trim() : undefined,
      vmPowerState,
      ipMissing,
      machineNameMissing,
      machineNameVmNameMismatch,
      createdWithinDays,
      page,
      pageSize,
    };
  }, [
    assetTypeInput,
    bizOwnerInput,
    companyInput,
    machineNameMissingInput,
    machineNameVmNameMismatchInput,
    departmentInput,
    ipMissingInput,
    osInput,
    page,
    pageSize,
    qInput,
    recentAddedInput,
    regionInput,
    sourceIdInput,
    sourceTypeInput,
    systemCategoryInput,
    systemLevelInput,
    vmPowerStateInput,
  ]);

  const visibleColumnsForTable = useMemo(() => {
    const cols = ensureCoreVisibleColumns(visibleColumns);
    return assetTypeInput === 'host'
      ? cols.filter((id) => !VM_ONLY_COLUMNS.includes(id as (typeof VM_ONLY_COLUMNS)[number]))
      : cols;
  }, [assetTypeInput, visibleColumns]);

  useEffect(() => {
    // When URL changes (e.g. external navigation/back/forward), update local state from URL.
    // Also skip the next "state -> URL" sync to avoid oscillation while state catches up.
    skipNextUrlSyncRef.current = true;
    const parsed = parseAssetListUrlState(new URLSearchParams(searchParams.toString()));
    setQInput(parsed.q ?? '');
    setAssetTypeInput(parsed.assetType ?? 'all');
    setSourceIdInput(parsed.sourceId ?? 'all');
    setSourceTypeInput(parsed.sourceType ?? 'all');
    setRegionInput(parsed.region ?? '');
    setCompanyInput(parsed.company ?? '');
    setDepartmentInput(parsed.department ?? '');
    setSystemCategoryInput(parsed.systemCategory ?? '');
    setSystemLevelInput(parsed.systemLevel ?? '');
    setBizOwnerInput(parsed.bizOwner ?? '');
    setOsInput(parsed.os ?? '');
    setVmPowerStateInput(parsed.vmPowerState ?? 'all');
    setIpMissingInput(parsed.ipMissing === true);
    setMachineNameMissingInput(parsed.machineNameMissing === true);
    setMachineNameVmNameMismatchInput(parsed.machineNameVmNameMismatch === true);
    setRecentAddedInput(parsed.createdWithinDays === 7);
    setPage(parsed.page);
    setPageSize(parsed.pageSize);
  }, [searchParams]);

  useEffect(() => {
    if (skipNextUrlSyncRef.current) {
      skipNextUrlSyncRef.current = false;
      return;
    }

    const current = searchParams.toString();

    const nextParams = buildAssetListUrlSearchParams({
      q: query.q,
      assetType: query.assetType,
      excludeAssetType: query.excludeAssetType,
      sourceId: query.sourceId,
      sourceType: query.sourceType,
      region: query.region,
      company: query.company,
      department: query.department,
      systemCategory: query.systemCategory,
      systemLevel: query.systemLevel,
      bizOwner: query.bizOwner,
      os: query.os,
      vmPowerState: query.vmPowerState,
      ipMissing: query.ipMissing,
      machineNameMissing: query.machineNameMissing,
      machineNameVmNameMismatch: query.machineNameVmNameMismatch,
      createdWithinDays: query.createdWithinDays,
      page: query.page,
      pageSize: query.pageSize,
    } satisfies AssetListUrlState);

    const next = nextParams.toString();
    if (next === current) return;
    router.replace(`${pathname}${next ? `?${next}` : ''}`, { scroll: false });
  }, [pathname, query, router, searchParams]);

  useEffect(() => {
    let active = true;
    const loadMe = async () => {
      const res = await fetch('/api/v1/auth/me');
      if (!res.ok) {
        if (active) setRole(null);
        return;
      }
      const body = (await res.json().catch(() => null)) as { data?: { role?: unknown } } | null;
      const rawRole = body?.data?.role;
      const nextRole = rawRole === 'admin' || rawRole === 'user' ? rawRole : null;
      if (active) setRole(nextRole);
    };
    void loadMe();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadSources = async () => {
      const res = await fetch('/api/v1/sources/summary');
      if (!res.ok) return;
      const body = (await res.json()) as { data?: Array<{ sourceId: string; name: string }> };
      if (active) setSourceOptions(body.data ?? []);
    };
    void loadSources();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadLedgerFieldFilterOptions = async () => {
      const res = await fetch('/api/v1/assets/ledger-fields/options');
      if (!res.ok) {
        if (active) setLedgerFieldFilterOptions(EMPTY_LEDGER_FIELD_FILTER_OPTIONS);
        return;
      }

      const body = (await res.json().catch(() => null)) as { data?: LedgerFieldFilterOptions } | null;
      if (active) setLedgerFieldFilterOptions(body?.data ?? EMPTY_LEDGER_FIELD_FILTER_OPTIONS);
    };

    void loadLedgerFieldFilterOptions();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadColumnPreference = async () => {
      const res = await fetch(`/api/v1/me/preferences?key=${encodeURIComponent(ASSETS_TABLE_COLUMNS_PREFERENCE_KEY)}`);
      if (!active) return;

      // 404 means "not set yet" -> keep defaults.
      if (res.status === 404) return;
      if (!res.ok) return;

      const body = (await res.json().catch(() => null)) as { data?: { value?: { visibleColumns?: unknown } } } | null;
      const next = sanitizeVisibleColumns(body?.data?.value?.visibleColumns);
      if (next) setVisibleColumns(next);
    };

    void loadColumnPreference();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);

      const params = new URLSearchParams();

      // Keep API request params consistent with URL params.
      const urlParams = buildAssetListUrlSearchParams({
        q: query.q,
        assetType: query.assetType,
        excludeAssetType: query.excludeAssetType,
        sourceId: query.sourceId,
        sourceType: query.sourceType,
        region: query.region,
        company: query.company,
        department: query.department,
        systemCategory: query.systemCategory,
        systemLevel: query.systemLevel,
        bizOwner: query.bizOwner,
        os: query.os,
        vmPowerState: query.vmPowerState,
        ipMissing: query.ipMissing,
        machineNameMissing: query.machineNameMissing,
        machineNameVmNameMismatch: query.machineNameVmNameMismatch,
        createdWithinDays: query.createdWithinDays,
        page: query.page,
        pageSize: query.pageSize,
      } satisfies AssetListUrlState);

      urlParams.forEach((value, key) => {
        params.set(key, value);
      });

      const res = await fetch(`/api/v1/assets?${params.toString()}`);
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
    };
    void load();
    return () => {
      active = false;
    };
  }, [query]);

  const canPrev = (pagination?.page ?? 1) > 1;
  const canNext = (pagination?.page ?? 1) < (pagination?.totalPages ?? 1);

  return (
    <div className="space-y-6">
      <PageHeader title="资产" description="统一视图（canonical）。支持搜索/筛选/列设置与台账字段批量维护。" />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <Input
            placeholder="搜索（机器名/虚拟机名/宿主机名/操作系统/IP/地区/公司/部门/系统分类/系统分级/业务对接人员/管理IP）"
            value={qInput}
            onChange={(e) => {
              setPage(1);
              setQInput(e.target.value);
            }}
          />

          <details open className="rounded-md border bg-background p-3">
            <summary className="cursor-pointer select-none text-sm font-medium">快捷筛选</summary>
            <div className="mt-3 grid gap-2 md:grid-cols-2 lg:grid-cols-4">
              <div className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium">仅 IP 缺失</div>
                  <div className="text-xs text-muted-foreground">仅 VM 且 IP 缺失</div>
                </div>
                <Switch
                  checked={ipMissingInput}
                  onCheckedChange={(checked) => {
                    setPage(1);
                    setIpMissingInput(checked);
                    if (checked) setAssetTypeInput('vm');
                  }}
                />
              </div>

              <div className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium">仅 机器名缺失</div>
                  <div className="text-xs text-muted-foreground">仅 VM 且机器名缺失</div>
                </div>
                <Switch
                  checked={machineNameMissingInput}
                  onCheckedChange={(checked) => {
                    setPage(1);
                    setMachineNameMissingInput(checked);
                    if (checked) setAssetTypeInput('vm');
                  }}
                />
              </div>

              <div className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium">仅 机器名≠虚拟机名</div>
                  <div className="text-xs text-muted-foreground">仅 VM 且机器名与虚拟机名不一致</div>
                </div>
                <Switch
                  checked={machineNameVmNameMismatchInput}
                  onCheckedChange={(checked) => {
                    setPage(1);
                    setMachineNameVmNameMismatchInput(checked);
                    if (checked) setAssetTypeInput('vm');
                  }}
                />
              </div>

              <div className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium">仅 最近新增</div>
                  <div className="text-xs text-muted-foreground">最近 7 天创建</div>
                </div>
                <Switch
                  checked={recentAddedInput}
                  onCheckedChange={(checked) => {
                    setPage(1);
                    setRecentAddedInput(checked);
                  }}
                />
              </div>
            </div>
          </details>

          <details open className="rounded-md border bg-background p-3">
            <summary className="cursor-pointer select-none text-sm font-medium">资产字段</summary>
            <div className="mt-3 flex flex-col gap-2 md:flex-row md:flex-wrap md:items-end">
              <Select
                value={assetTypeInput}
                onValueChange={(value) => {
                  setPage(1);
                  setAssetTypeInput(value as typeof assetTypeInput);

                  // VM-only filters don't apply to other types; reset them to avoid confusing empty results.
                  if (value !== 'vm') {
                    setVmPowerStateInput('all');
                    setIpMissingInput(false);
                    setMachineNameMissingInput(false);
                    setMachineNameVmNameMismatchInput(false);
                  }
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
                value={sourceIdInput}
                onValueChange={(value) => {
                  setPage(1);
                  setSourceIdInput(value);
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
                value={sourceTypeInput}
                onValueChange={(value) => {
                  setPage(1);
                  setSourceTypeInput(value as typeof sourceTypeInput);
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
                value={vmPowerStateInput}
                onValueChange={(value) => {
                  setPage(1);
                  setVmPowerStateInput(value as typeof vmPowerStateInput);

                  if (value !== 'all') setAssetTypeInput('vm');
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
                value={osInput || 'all'}
                onValueChange={(value) => {
                  setPage(1);
                  setOsInput(value === 'all' ? '' : value);
                }}
              >
                <SelectTrigger className="w-full md:w-[220px]">
                  <SelectValue placeholder="操作系统" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部操作系统</SelectItem>
                  {osInput && !ledgerFieldFilterOptions.osNames.includes(osInput) ? (
                    <SelectItem value={osInput}>{osInput}（当前）</SelectItem>
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
                value={regionInput || 'all'}
                onValueChange={(value) => {
                  setPage(1);
                  setRegionInput(value === 'all' ? '' : value);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="地区（台账）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部地区</SelectItem>
                  {regionInput && !ledgerFieldFilterOptions.regions.includes(regionInput) ? (
                    <SelectItem value={regionInput}>{regionInput}（当前）</SelectItem>
                  ) : null}
                  {ledgerFieldFilterOptions.regions.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={companyInput || 'all'}
                onValueChange={(value) => {
                  setPage(1);
                  setCompanyInput(value === 'all' ? '' : value);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="公司（台账）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部公司</SelectItem>
                  {companyInput && !ledgerFieldFilterOptions.companies.includes(companyInput) ? (
                    <SelectItem value={companyInput}>{companyInput}（当前）</SelectItem>
                  ) : null}
                  {ledgerFieldFilterOptions.companies.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={departmentInput || 'all'}
                onValueChange={(value) => {
                  setPage(1);
                  setDepartmentInput(value === 'all' ? '' : value);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="部门（台账）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部部门</SelectItem>
                  {departmentInput && !ledgerFieldFilterOptions.departments.includes(departmentInput) ? (
                    <SelectItem value={departmentInput}>{departmentInput}（当前）</SelectItem>
                  ) : null}
                  {ledgerFieldFilterOptions.departments.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={systemCategoryInput || 'all'}
                onValueChange={(value) => {
                  setPage(1);
                  setSystemCategoryInput(value === 'all' ? '' : value);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="系统分类（台账）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部系统分类</SelectItem>
                  {systemCategoryInput && !ledgerFieldFilterOptions.systemCategories.includes(systemCategoryInput) ? (
                    <SelectItem value={systemCategoryInput}>{systemCategoryInput}（当前）</SelectItem>
                  ) : null}
                  {ledgerFieldFilterOptions.systemCategories.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={systemLevelInput || 'all'}
                onValueChange={(value) => {
                  setPage(1);
                  setSystemLevelInput(value === 'all' ? '' : value);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="系统分级（台账）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部系统分级</SelectItem>
                  {systemLevelInput && !ledgerFieldFilterOptions.systemLevels.includes(systemLevelInput) ? (
                    <SelectItem value={systemLevelInput}>{systemLevelInput}（当前）</SelectItem>
                  ) : null}
                  {ledgerFieldFilterOptions.systemLevels.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={bizOwnerInput || 'all'}
                onValueChange={(value) => {
                  setPage(1);
                  setBizOwnerInput(value === 'all' ? '' : value);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="业务对接人员（台账）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部业务对接人员</SelectItem>
                  {bizOwnerInput && !ledgerFieldFilterOptions.bizOwners.includes(bizOwnerInput) ? (
                    <SelectItem value={bizOwnerInput}>{bizOwnerInput}（当前）</SelectItem>
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
                  title="批量设置台账字段"
                  aria-label="批量设置台账字段"
                  disabled={selectedAssetUuids.length < 1}
                  onClick={() => {
                    setBulkKey('');
                    setBulkValue('');
                    setBulkSetOpen(true);
                  }}
                >
                  <ClipboardPenLine />
                </Button>

                <CreateAssetLedgerExportButton size="sm" variant="outline">
                  <Download />
                  导出台账 CSV
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
                      return (
                        <TableHead key={colId} className={rightAligned ? 'text-right' : undefined}>
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
                          return (
                            <TableCell key={colId}>
                              <div className="space-y-1">
                                <div className="flex flex-wrap items-center gap-2 font-medium">
                                  {item.machineName ? <span>{item.machineName}</span> : (toolsNotRunningNode ?? '-')}
                                  {item.machineNameOverride ? (
                                    item.machineNameMismatch ? (
                                      <Badge variant="destructive">覆盖≠采集</Badge>
                                    ) : (
                                      <Badge variant="secondary">覆盖</Badge>
                                    )
                                  ) : null}
                                </div>
                                <IdText value={item.assetUuid} />
                              </div>
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
                          return (
                            <TableCell key={colId} className="max-w-[240px] whitespace-normal break-words text-sm">
                              {item.os ? item.os : (toolsNotRunningNode ?? '-')}
                            </TableCell>
                          );
                        }

                        if (colId === 'ip') {
                          return (
                            <TableCell
                              key={colId}
                              className="max-w-[280px] whitespace-normal break-all font-mono text-xs"
                            >
                              {item.ip ? item.ip : (toolsNotRunningNode ?? '-')}
                            </TableCell>
                          );
                        }

                        if (colId === 'monitorState') {
                          const display = monitorStateDisplay({
                            monitorCovered: item.monitorCovered,
                            monitorState: item.monitorState,
                          });
                          if (!display) return <TableCell key={colId}>-</TableCell>;

                          const tooltipParts: string[] = [];
                          if (item.monitorStatus) tooltipParts.push(`SolarWinds: ${item.monitorStatus}`);
                          if (item.monitorUpdatedAt)
                            tooltipParts.push(`更新：${formatDateTime(item.monitorUpdatedAt)}`);
                          const tooltip = tooltipParts.length > 0 ? tooltipParts.join(' · ') : undefined;

                          return (
                            <TableCell key={colId}>
                              <Badge variant={display.variant} title={tooltip}>
                                {display.labelZh}
                              </Badge>
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
                          return (
                            <TableCell key={colId} className="max-w-[220px] whitespace-normal break-words text-sm">
                              {item.ledgerFields?.[key] ?? '-'}
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
                              title="编辑机器名"
                              aria-label="编辑机器名"
                              onClick={() => {
                                setEditTarget(item);
                                setEditMachineNameValue(item.machineNameOverride ?? '');
                                setEditMachineNameOpen(true);
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
                    value={String(pageSize)}
                    onValueChange={(value) => {
                      setPage(1);
                      setPageSize(Number(value));
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
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    上一页
                  </Button>
                  <Button size="sm" variant="outline" disabled={!canNext} onClick={() => setPage((p) => p + 1)}>
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
            <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col">
              <DialogHeader>
                <DialogTitle>列设置</DialogTitle>
                <DialogDescription>列配置按用户保存到数据库，可在不同设备复用。</DialogDescription>
              </DialogHeader>

              <div className="grid min-h-0 flex-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                {ASSET_LIST_COLUMNS.map((col) => {
                  const locked = CORE_COLUMNS.includes(col.id as (typeof CORE_COLUMNS)[number]);
                  const vmOnly = VM_ONLY_COLUMNS.includes(col.id as (typeof VM_ONLY_COLUMNS)[number]);
                  const disabled = locked || (vmOnly && assetTypeInput === 'host');
                  const checked = locked ? true : columnDraft.includes(col.id);
                  return (
                    <div
                      key={col.id}
                      className={`flex items-center justify-between gap-4 rounded-md border p-3 ${
                        disabled ? 'bg-muted/40 opacity-70' : ''
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{col.label}</div>
                        {col.description ? (
                          <div className="mt-0.5 text-xs text-muted-foreground">{col.description}</div>
                        ) : null}
                      </div>
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
                })}
              </div>

              <div className="text-xs text-muted-foreground">
                机器名/IP 为核心列固定显示；虚拟机名/宿主机名仅 VM（当前类型为 Host 时不展示）；其余列可选（当前：
                {columnDraft.length} 列）。
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
                <DialogTitle>批量设置台账字段</DialogTitle>
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
                          return { ...it, ledgerFields: { ...it.ledgerFields, [bulkKey]: value } as LedgerFieldsV1 };
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
            open={editMachineNameOpen}
            onOpenChange={(open) => {
              setEditMachineNameOpen(open);
              if (!open) {
                setEditTarget(null);
                setEditMachineNameValue('');
                setEditSaving(false);
              }
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>编辑机器名</DialogTitle>
                <DialogDescription>机器名优先展示“覆盖值”，采集值仍会持续入库。</DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="machineNameOverride">机器名（覆盖显示）</Label>
                  <Input
                    id="machineNameOverride"
                    value={editMachineNameValue}
                    placeholder="留空表示不覆盖"
                    onChange={(e) => setEditMachineNameValue(e.target.value)}
                  />
                </div>

                <div className="rounded-md border bg-muted/30 p-3 text-xs">
                  <div className="text-muted-foreground">采集到的机器名</div>
                  <div className="mt-1 font-mono">{editTarget?.machineNameCollected ?? '暂无'}</div>
                </div>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  disabled={editSaving}
                  onClick={() => {
                    setEditMachineNameOpen(false);
                  }}
                >
                  取消
                </Button>
                <Button
                  disabled={!editTarget || editSaving}
                  onClick={async () => {
                    if (!editTarget) return;
                    setEditSaving(true);

                    const nextOverride = editMachineNameValue.trim() ? editMachineNameValue.trim() : null;
                    const res = await fetch(`/api/v1/assets/${editTarget.assetUuid}`, {
                      method: 'PUT',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ machineNameOverride: nextOverride }),
                    });

                    if (!res.ok) {
                      setEditSaving(false);
                      return;
                    }

                    setItems((prev) =>
                      prev.map((it) => {
                        if (it.assetUuid !== editTarget.assetUuid) return it;

                        const machineNameCollected = it.machineNameCollected;
                        const machineName = nextOverride ?? machineNameCollected;
                        const machineNameMismatch =
                          nextOverride !== null &&
                          machineNameCollected !== null &&
                          nextOverride !== machineNameCollected;

                        return {
                          ...it,
                          machineNameOverride: nextOverride,
                          machineName,
                          machineNameMismatch,
                        };
                      }),
                    );

                    setEditSaving(false);
                    setEditMachineNameOpen(false);
                  }}
                >
                  保存
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    </div>
  );
}
