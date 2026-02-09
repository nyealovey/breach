'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

import type { Dispatch, SetStateAction } from 'react';

import type { AssetListFiltersState, LedgerFieldFilterOptions, SourceOption } from '../page.client';

type AssetsFilterPanelProps = {
  filters: AssetListFiltersState;
  setFilters: Dispatch<SetStateAction<AssetListFiltersState>>;
  hasActiveFilters: boolean;
  sourceOptions: SourceOption[];
  ledgerFieldFilterOptions: LedgerFieldFilterOptions;
  onClearFilters: () => void;
};

export function AssetsFilterPanel({
  filters,
  setFilters,
  hasActiveFilters,
  sourceOptions,
  ledgerFieldFilterOptions,
  onClearFilters,
}: AssetsFilterPanelProps) {
  return (
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
          <Button type="button" variant="outline" disabled={!hasActiveFilters} onClick={onClearFilters}>
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
                {filters.departmentInput && !ledgerFieldFilterOptions.departments.includes(filters.departmentInput) ? (
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
  );
}
