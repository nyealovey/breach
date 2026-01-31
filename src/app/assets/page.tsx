'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

type AssetListColumnId =
  | 'machineName'
  | 'vmName'
  | 'hostName'
  | 'os'
  | 'ip'
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
  { id: 'vmName', label: '虚拟机名' },
  { id: 'hostName', label: '宿主机名', description: 'VM --runs_on--> Host 的 displayName。' },
  { id: 'os', label: '操作系统' },
  { id: 'ip', label: 'IP', description: 'VM 若 Tools 未运行可能缺失。' },
  { id: 'cpuCount', label: 'CPU' },
  { id: 'memoryBytes', label: '内存' },
  { id: 'totalDiskBytes', label: '总分配磁盘' },
  { id: 'vmPowerState', label: '状态', description: 'VM 电源状态（poweredOn/off/suspended）。' },
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

// Default columns remain unchanged; ledger fields are opt-in.
const DEFAULT_VISIBLE_COLUMNS: AssetListColumnId[] = BASE_ASSET_LIST_COLUMNS.map((c) => c.id);
const ASSET_LIST_COLUMN_ID_SET = new Set<AssetListColumnId>(ASSET_LIST_COLUMNS.map((c) => c.id));
const ASSET_LIST_COLUMN_LABEL_BY_ID = new Map<AssetListColumnId, string>(
  ASSET_LIST_COLUMNS.map((c) => [c.id, c.label]),
);

function sanitizeVisibleColumns(input: unknown): AssetListColumnId[] | null {
  if (!Array.isArray(input)) return null;

  const ids = input
    .filter((v) => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v): v is AssetListColumnId => ASSET_LIST_COLUMN_ID_SET.has(v as AssetListColumnId));

  const unique = Array.from(new Set(ids));
  return unique.length > 0 ? unique : null;
}

function powerStateLabel(powerState: string) {
  if (powerState === 'poweredOn') return '运行';
  if (powerState === 'poweredOff') return '关机';
  if (powerState === 'suspended') return '挂起';
  return powerState;
}

function powerStateBadgeVariant(powerState: string): React.ComponentProps<typeof Badge>['variant'] {
  if (powerState === 'poweredOn') return 'default';
  if (powerState === 'poweredOff') return 'secondary';
  if (powerState === 'suspended') return 'outline';
  return 'outline';
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

  const [items, setItems] = useState<AssetListItem[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);

  const [role, setRole] = useState<'admin' | 'user' | null>(null);
  const isAdmin = role === 'admin';

  const [sourceOptions, setSourceOptions] = useState<SourceOption[]>([]);

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
  const [assetTypeInput, setAssetTypeInput] = useState<'all' | 'vm' | 'host' | 'cluster'>('all');
  const [sourceIdInput, setSourceIdInput] = useState<'all' | string>('all');
  const [vmPowerStateInput, setVmPowerStateInput] = useState<'all' | VmPowerStateParam>('all');
  const [ipMissingInput, setIpMissingInput] = useState(false);
  const [companyInput, setCompanyInput] = useState('');
  const [departmentInput, setDepartmentInput] = useState('');
  const [systemCategoryInput, setSystemCategoryInput] = useState('');
  const [systemLevelInput, setSystemLevelInput] = useState('');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [editMachineNameOpen, setEditMachineNameOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AssetListItem | null>(null);
  const [editMachineNameValue, setEditMachineNameValue] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const query = useMemo(() => {
    const assetType = assetTypeInput === 'all' ? undefined : assetTypeInput;
    const vmPowerState = vmPowerStateInput === 'all' ? undefined : vmPowerStateInput;
    const ipMissing = ipMissingInput ? true : undefined;

    // Both vm_power_state and ip_missing are VM-only filters; selecting them implies `asset_type=vm`.
    const impliedAssetType = vmPowerState || ipMissing ? ('vm' as const) : assetType;

    return {
      q: qInput.trim() ? qInput.trim() : undefined,
      assetType: impliedAssetType,
      excludeAssetType: impliedAssetType ? undefined : ('cluster' as const),
      sourceId: sourceIdInput === 'all' ? undefined : sourceIdInput,
      company: companyInput.trim() ? companyInput.trim() : undefined,
      department: departmentInput.trim() ? departmentInput.trim() : undefined,
      systemCategory: systemCategoryInput.trim() ? systemCategoryInput.trim() : undefined,
      systemLevel: systemLevelInput.trim() ? systemLevelInput.trim() : undefined,
      vmPowerState,
      ipMissing,
      page,
      pageSize,
    };
  }, [
    assetTypeInput,
    companyInput,
    departmentInput,
    ipMissingInput,
    page,
    pageSize,
    qInput,
    sourceIdInput,
    systemCategoryInput,
    systemLevelInput,
    vmPowerStateInput,
  ]);

  useEffect(() => {
    const parsed = parseAssetListUrlState(new URLSearchParams(searchParams.toString()));
    setQInput(parsed.q ?? '');
    setAssetTypeInput(parsed.assetType ?? 'all');
    setSourceIdInput(parsed.sourceId ?? 'all');
    setCompanyInput(parsed.company ?? '');
    setDepartmentInput(parsed.department ?? '');
    setSystemCategoryInput(parsed.systemCategory ?? '');
    setSystemLevelInput(parsed.systemLevel ?? '');
    setVmPowerStateInput(parsed.vmPowerState ?? 'all');
    setIpMissingInput(parsed.ipMissing === true);
    setPage(parsed.page);
    setPageSize(parsed.pageSize);
  }, [searchParams]);

  useEffect(() => {
    const current = searchParams.toString();

    const nextParams = buildAssetListUrlSearchParams({
      q: query.q,
      assetType: query.assetType,
      excludeAssetType: query.excludeAssetType,
      sourceId: query.sourceId,
      company: query.company,
      department: query.department,
      systemCategory: query.systemCategory,
      systemLevel: query.systemLevel,
      vmPowerState: query.vmPowerState,
      ipMissing: query.ipMissing,
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
      const res = await fetch('/api/v1/sources?pageSize=100');
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
        company: query.company,
        department: query.department,
        systemCategory: query.systemCategory,
        systemLevel: query.systemLevel,
        vmPowerState: query.vmPowerState,
        ipMissing: query.ipMissing,
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
    <Card>
      <CardHeader>
        <CardTitle>资产</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <div className="flex flex-1 items-center gap-2">
            <Input
              placeholder="搜索（机器名/虚拟机名/宿主机名/操作系统/台账字段/externalId/uuid）"
              value={qInput}
              onChange={(e) => {
                setPage(1);
                setQInput(e.target.value);
              }}
            />
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={assetTypeInput}
              onValueChange={(value) => {
                setPage(1);
                setAssetTypeInput(value as typeof assetTypeInput);

                // VM-only filters don't apply to other types; reset them to avoid confusing empty results.
                if (value !== 'vm') {
                  setVmPowerStateInput('all');
                  setIpMissingInput(false);
                }
              }}
            >
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部类型</SelectItem>
                <SelectItem value="vm">VM</SelectItem>
                <SelectItem value="host">Host</SelectItem>
                <SelectItem value="cluster">Cluster</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={sourceIdInput}
              onValueChange={(value) => {
                setPage(1);
                setSourceIdInput(value);
              }}
            >
              <SelectTrigger className="w-[220px]">
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
              value={vmPowerStateInput}
              onValueChange={(value) => {
                setPage(1);
                setVmPowerStateInput(value as typeof vmPowerStateInput);

                if (value !== 'all') setAssetTypeInput('vm');
              }}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="电源状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部电源状态</SelectItem>
                <SelectItem value="poweredOn">运行</SelectItem>
                <SelectItem value="poweredOff">关机</SelectItem>
                <SelectItem value="suspended">挂起</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex items-center gap-2">
              <Switch
                checked={ipMissingInput}
                onCheckedChange={(checked) => {
                  setPage(1);
                  setIpMissingInput(checked);
                  if (checked) setAssetTypeInput('vm');
                }}
              />
              <span className="text-sm">仅 IP 缺失</span>
            </div>

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

            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setColumnDraft(visibleColumns);
                setColumnSettingsOpen(true);
              }}
            >
              列设置
            </Button>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-4">
          <Input
            placeholder="公司（台账）"
            value={companyInput}
            onChange={(e) => {
              setPage(1);
              setCompanyInput(e.target.value);
            }}
          />
          <Input
            placeholder="部门（台账）"
            value={departmentInput}
            onChange={(e) => {
              setPage(1);
              setDepartmentInput(e.target.value);
            }}
          />
          <Input
            placeholder="系统分类（台账）"
            value={systemCategoryInput}
            onChange={(e) => {
              setPage(1);
              setSystemCategoryInput(e.target.value);
            }}
          />
          <Input
            placeholder="系统分级（台账）"
            value={systemLevelInput}
            onChange={(e) => {
              setPage(1);
              setSystemLevelInput(e.target.value);
            }}
          />
        </div>

        {isAdmin ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={selectedAssetUuids.length < 1}
              onClick={() => {
                setBulkKey('');
                setBulkValue('');
                setBulkSetOpen(true);
              }}
            >
              批量设置台账字段
            </Button>
            {selectedAssetUuids.length > 0 ? (
              <>
                <span className="text-xs text-muted-foreground">已选择 {selectedAssetUuids.length} 个（当前页）</span>
                <Button size="sm" variant="ghost" onClick={() => setSelectedAssetUuids([])}>
                  清空选择
                </Button>
              </>
            ) : null}
          </div>
        ) : null}

        {loading ? (
          <div className="text-sm text-muted-foreground">加载中…</div>
        ) : items.length === 0 ? (
          <div className="text-sm text-muted-foreground">暂无资产。请先配置来源并触发一次 collect Run。</div>
        ) : (
          <>
            <Table>
              <TableHeader>
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

                  {visibleColumns.map((colId) => {
                    const label = ASSET_LIST_COLUMN_LABEL_BY_ID.get(colId) ?? colId;
                    const rightAligned = colId === 'cpuCount' || colId === 'memoryBytes' || colId === 'totalDiskBytes';
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

                    {visibleColumns.map((colId) => {
                      if (colId === 'machineName') {
                        return (
                          <TableCell key={colId} className="font-medium">
                            <div className="flex flex-wrap items-center gap-2">
                              <span>{item.machineName ?? ''}</span>
                              {item.machineNameOverride ? (
                                item.machineNameMismatch ? (
                                  <Badge variant="destructive">覆盖≠采集</Badge>
                                ) : (
                                  <Badge variant="secondary">覆盖</Badge>
                                )
                              ) : null}
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
                            {item.os ?? '-'}
                          </TableCell>
                        );
                      }

                      if (colId === 'ip') {
                        return (
                          <TableCell
                            key={colId}
                            className="max-w-[280px] whitespace-normal break-all font-mono text-xs"
                          >
                            {item.ip ? (
                              item.ip
                            ) : item.vmPowerState === 'poweredOn' && item.toolsRunning === false ? (
                              <span
                                className="cursor-help text-muted-foreground"
                                title="VMware Tools 未安装或未运行，无法获取 IP 地址"
                              >
                                - (Tools 未运行)
                              </span>
                            ) : (
                              '-'
                            )}
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
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditTarget(item);
                              setEditMachineNameValue(item.machineNameOverride ?? '');
                              setEditMachineNameOpen(true);
                            }}
                          >
                            编辑机器名
                          </Button>
                        ) : null}
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/assets/${item.assetUuid}`}>查看</Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex items-center justify-between pt-2">
              <div className="text-xs text-muted-foreground">
                {pagination ? `第 ${pagination.page} / ${pagination.totalPages} 页 · 共 ${pagination.total} 条` : null}
              </div>
              <div className="flex items-center gap-2">
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
              setColumnDraft(visibleColumns);
              setColumnSaving(false);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>列设置</DialogTitle>
              <DialogDescription>列配置按用户保存到数据库，可在不同设备复用。</DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              {ASSET_LIST_COLUMNS.map((col) => {
                const checked = columnDraft.includes(col.id);
                return (
                  <div key={col.id} className="flex items-center justify-between gap-4 rounded-md border p-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{col.label}</div>
                      {col.description ? (
                        <div className="mt-0.5 text-xs text-muted-foreground">{col.description}</div>
                      ) : null}
                    </div>
                    <Switch
                      checked={checked}
                      onCheckedChange={(next) => {
                        setColumnDraft((prev) => {
                          if (next) return prev.includes(col.id) ? prev : [...prev, col.id];
                          return prev.filter((id) => id !== col.id);
                        });
                      }}
                    />
                  </div>
                );
              })}
            </div>

            <div className="text-xs text-muted-foreground">至少选择 1 列（当前：{columnDraft.length} 列）。</div>

            <DialogFooter>
              <Button
                variant="outline"
                disabled={columnSaving}
                onClick={() => {
                  setColumnDraft(DEFAULT_VISIBLE_COLUMNS);
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
                    const res = await fetch('/api/v1/me/preferences', {
                      method: 'PUT',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({
                        key: ASSETS_TABLE_COLUMNS_PREFERENCE_KEY,
                        value: { visibleColumns: columnDraft },
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
                    const next = sanitizeVisibleColumns(body?.data?.value?.visibleColumns) ?? columnDraft;
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
                  <Input value={bulkValue} placeholder="留空表示清空" onChange={(e) => setBulkValue(e.target.value)} />
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
                        nextOverride !== null && machineNameCollected !== null && nextOverride !== machineNameCollected;

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
  );
}
