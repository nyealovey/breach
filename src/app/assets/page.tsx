'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type AssetListItem = {
  assetUuid: string;
  assetType: string;
  status: string;
  hostName: string | null;
  vmName: string | null;
  ip: string | null;
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

function statusBadgeVariant(status: string): React.ComponentProps<typeof Badge>['variant'] {
  if (status === 'in_service') return 'default';
  if (status === 'offline') return 'secondary';
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
  const [items, setItems] = useState<AssetListItem[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);

  const [sourceOptions, setSourceOptions] = useState<SourceOption[]>([]);

  const [qInput, setQInput] = useState('');
  const [assetTypeInput, setAssetTypeInput] = useState<'all' | 'vm' | 'host' | 'cluster'>('all');
  const [sourceIdInput, setSourceIdInput] = useState<'all' | string>('all');

  const [page, setPage] = useState(1);
  const pageSize = 20;

  const query = useMemo(() => {
    return {
      q: qInput.trim() ? qInput.trim() : undefined,
      assetType: assetTypeInput === 'all' ? undefined : assetTypeInput,
      sourceId: sourceIdInput === 'all' ? undefined : sourceIdInput,
      page,
      pageSize,
    };
  }, [assetTypeInput, page, qInput, sourceIdInput]);

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
    const load = async () => {
      setLoading(true);

      const params = new URLSearchParams();
      params.set('page', String(query.page));
      params.set('pageSize', String(query.pageSize));
      if (query.q) params.set('q', query.q);
      if (query.assetType) params.set('asset_type', query.assetType);
      if (query.sourceId) params.set('source_id', query.sourceId);

      const res = await fetch(`/api/v1/assets?${params.toString()}`);
      if (!res.ok) {
        if (active) {
          setItems([]);
          setPagination(null);
          setLoading(false);
        }
        return;
      }

      const body = (await res.json()) as { data: AssetListItem[]; pagination: Pagination };
      if (active) {
        setItems(body.data ?? []);
        setPagination(body.pagination ?? null);
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
              placeholder="搜索（displayName / externalId / uuid）"
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
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground">加载中…</div>
        ) : items.length === 0 ? (
          <div className="text-sm text-muted-foreground">暂无资产。请先配置来源并触发一次 collect Run。</div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>主机名</TableHead>
                  <TableHead>虚拟机名</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead className="text-right">CPU</TableHead>
                  <TableHead className="text-right">内存</TableHead>
                  <TableHead className="text-right">总分配磁盘</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.assetUuid}>
                    <TableCell className="font-medium">{item.hostName ?? '-'}</TableCell>
                    <TableCell className="font-medium">{item.vmName ?? '-'}</TableCell>
                    <TableCell className="font-mono text-xs">{item.ip ?? '-'}</TableCell>
                    <TableCell className="text-right">{item.cpuCount ?? '-'}</TableCell>
                    <TableCell className="text-right">{formatBytes(item.memoryBytes)}</TableCell>
                    <TableCell className="text-right">{formatBytes(item.totalDiskBytes)}</TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant(item.status)}>{item.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/assets/${item.assetUuid}`}>查看</Link>
                      </Button>
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
      </CardContent>
    </Card>
  );
}
