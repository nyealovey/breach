'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { IdText } from '@/components/ui/id-text';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type SourceItem = {
  sourceId: string;
  name: string;
  sourceType: string;
  enabled: boolean;
  credential: { credentialId: string; name: string; type: string } | null;
  config?: { endpoint?: string } | null;
  lastRun: { runId: string; status: string; finishedAt: string | null; mode: string } | null;
};

export function SourcesClient() {
  const [items, setItems] = useState<SourceItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      const res = await fetch('/api/v1/sources');
      if (!res.ok) {
        setItems([]);
        setLoading(false);
        return;
      }
      const body = (await res.json()) as { data: SourceItem[] };
      if (active) {
        setItems(body.data ?? []);
        setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="来源"
        description="采集来源配置（endpoint/启用状态/凭据绑定）。"
        actions={
          <Button asChild size="sm">
            <Link href="/sources/new">新建来源</Link>
          </Button>
        }
      />

      <Card>
        <CardHeader className="flex flex-col gap-3 space-y-0 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <div className="text-sm font-medium">列表</div>
            <div className="text-xs text-muted-foreground">
              {loading ? '加载中…' : items.length === 0 ? '暂无数据' : `共 ${items.length} 条`}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground">加载中…</div>
          ) : items.length === 0 ? (
            <div className="text-sm text-muted-foreground">暂无来源，点击「新建来源」开始配置。</div>
          ) : (
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>启用</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>凭据</TableHead>
                  <TableHead>最后一次运行</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.sourceId}>
                    <TableCell>
                      <div className="font-medium">{item.name}</div>
                      <IdText value={item.sourceId} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{item.sourceType}</TableCell>
                    <TableCell className="font-mono text-xs">{item.enabled ? 'true' : 'false'}</TableCell>
                    <TableCell className="font-mono text-xs">{item.config?.endpoint ?? '-'}</TableCell>
                    <TableCell className="text-sm">
                      {item.credential ? (
                        <>
                          <div className="font-medium">{item.credential.name}</div>
                          <div className="text-xs text-muted-foreground">
                            <span className="font-mono">{item.credential.type}</span>
                            <span className="mx-2">·</span>
                            <span className="font-mono">{item.credential.credentialId}</span>
                          </div>
                        </>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {item.lastRun ? (
                        <>
                          <div className="font-mono text-xs">{item.lastRun.status}</div>
                          <div className="text-xs text-muted-foreground">
                            {item.lastRun.finishedAt ?? '-'} · {item.lastRun.mode}
                          </div>
                        </>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/sources/${item.sourceId}/edit`}>编辑</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
