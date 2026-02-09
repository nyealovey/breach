'use client';

import Link from 'next/link';
import { Eye, HelpCircle, Pencil } from 'lucide-react';

import { SolarWindsMark, VeeamMark } from '@/components/icons/signal-sources';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { backupStateDisplay } from '@/lib/assets/backup-state';
import { monitorStateDisplay } from '@/lib/assets/monitor-state';
import { getOverrideVisualMeta, normalizeOptionalText } from '@/lib/assets/override-visual';
import { normalizePowerState, powerStateLabelZh } from '@/lib/assets/power-state';
import {
  shouldShowToolsNotRunning,
  TOOLS_NOT_RUNNING_TEXT,
  TOOLS_NOT_RUNNING_TOOLTIP,
} from '@/lib/assets/tools-not-running';

import type { LedgerFieldKey } from '@/lib/ledger/ledger-fields-v1';

import type { AssetListColumnId, AssetListItem } from '../page.client';

type AssetsTableContentProps = {
  loading: boolean;
  items: AssetListItem[];
  isAdmin: boolean;
  selectedAssetUuidSet: ReadonlySet<string>;
  visibleColumnsForTable: AssetListColumnId[];
  columnLabelById: ReadonlyMap<AssetListColumnId, string>;
  pageSize: number;
  canPrev: boolean;
  canNext: boolean;
  onSelectAllCurrentPage: (checked: boolean) => void;
  onToggleSelectAsset: (assetUuid: string, checked: boolean) => void;
  onPageSizeChange: (pageSize: number) => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onOpenEditForItem: (item: AssetListItem) => void;
  onPreloadEditDialog: () => void;
};

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

export function AssetsTableContent({
  loading,
  items,
  isAdmin,
  selectedAssetUuidSet,
  visibleColumnsForTable,
  columnLabelById,
  pageSize,
  canPrev,
  canNext,
  onSelectAllCurrentPage,
  onToggleSelectAsset,
  onPageSizeChange,
  onPrevPage,
  onNextPage,
  onOpenEditForItem,
  onPreloadEditDialog,
}: AssetsTableContentProps) {
  if (loading) {
    return <div className="text-sm text-muted-foreground">加载中…</div>;
  }

  if (items.length === 0) {
    return <div className="text-sm text-muted-foreground">暂无资产。请先配置来源并触发一次 collect Run。</div>;
  }

  return (
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
                  onChange={(e) => onSelectAllCurrentPage(e.target.checked)}
                />
              </TableHead>
            ) : null}

            {visibleColumnsForTable.map((colId) => {
              const label = columnLabelById.get(colId) ?? colId;
              const rightAligned = colId === 'cpuCount' || colId === 'memoryBytes' || colId === 'totalDiskBytes';
              const centerAligned = colId === 'monitorState';
              const headClassName = rightAligned ? 'text-right' : centerAligned ? 'w-[64px] text-center' : undefined;
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
          {items.map((item) => {
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

            return (
              <TableRow key={item.assetUuid}>
                {isAdmin ? (
                  <TableCell>
                    <input
                      type="checkbox"
                      aria-label="选择资产"
                      checked={selectedAssetUuidSet.has(item.assetUuid)}
                      onChange={(e) => onToggleSelectAsset(item.assetUuid, e.target.checked)}
                    />
                  </TableCell>
                ) : null}

                {visibleColumnsForTable.map((colId) => {
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
                        <Badge variant={assetStatusBadgeVariant(item.status)}>{assetStatusLabel(item.status)}</Badge>
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
                      <TableCell key={colId} className="max-w-[280px] whitespace-normal break-all font-mono text-xs">
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
                            <HelpCircle className="h-4 w-4 text-slate-400 dark:text-slate-500" aria-hidden="true" />
                            <span className="sr-only">无监控/备份信息</span>
                          </span>
                        </TableCell>
                      );
                    }

                    const solarwindsTitleParts: string[] = [];
                    if (display) {
                      solarwindsTitleParts.push(`SolarWinds：${display.labelZh}`);
                      if (item.monitorStatus) solarwindsTitleParts.push(item.monitorStatus);
                      if (item.monitorUpdatedAt) {
                        solarwindsTitleParts.push(`更新：${formatDateTime(item.monitorUpdatedAt)}`);
                      }
                    }
                    const solarwindsTitle = solarwindsTitleParts.join(' · ');

                    const veeamTitleParts: string[] = [];
                    if (backupDisplay) {
                      veeamTitleParts.push(`Veeam：${backupDisplay.labelZh}`);
                      if (item.backupLastResult) veeamTitleParts.push(`结果：${item.backupLastResult}`);
                      if (item.backupLastSuccessAt)
                        veeamTitleParts.push(`最近成功：${formatDateTime(item.backupLastSuccessAt)}`);
                      if (item.backupUpdatedAt) veeamTitleParts.push(`更新：${formatDateTime(item.backupUpdatedAt)}`);
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
                      <TableCell key={colId} className="whitespace-nowrap font-mono text-xs text-muted-foreground">
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
                        onMouseEnter={onPreloadEditDialog}
                        onFocus={onPreloadEditDialog}
                        onClick={() => onOpenEditForItem(item)}
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
            );
          })}
        </TableBody>
      </Table>

      <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <div className="text-xs text-muted-foreground">每页</div>
          <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}>
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
          <Button size="sm" variant="outline" disabled={!canPrev} onClick={onPrevPage}>
            上一页
          </Button>
          <Button size="sm" variant="outline" disabled={!canNext} onClick={onNextPage}>
            下一页
          </Button>
        </div>
      </div>
    </>
  );
}
