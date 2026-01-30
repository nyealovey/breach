'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type SourceItem = {
  sourceId: string;
  name: string;
  sourceType: string;
  enabled: boolean;
  config?: { endpoint?: string } | null;
  lastRun: { runId: string; status: string; finishedAt: string | null; mode: string } | null;
};

export default function SourcesPage() {
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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>来源</CardTitle>
        <Button asChild>
          <Link href="/sources/new">新建来源</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-sm text-muted-foreground">加载中…</div>
        ) : items.length === 0 ? (
          <div className="text-sm text-muted-foreground">暂无来源，点击「新建来源」开始配置。</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>启用</TableHead>
                <TableHead>Endpoint</TableHead>
                <TableHead>最新 Run</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.sourceId}>
                  <TableCell>
                    <div className="font-medium">{item.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">{item.sourceId}</div>
                  </TableCell>
                  <TableCell>{item.sourceType}</TableCell>
                  <TableCell>{item.enabled ? '启用' : '停用'}</TableCell>
                  <TableCell className="font-mono text-xs">{item.config?.endpoint ?? '-'}</TableCell>
                  <TableCell className="font-mono text-xs">{item.lastRun?.finishedAt ?? '-'}</TableCell>
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
  );
}
