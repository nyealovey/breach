'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { RequireAdminClient } from '@/components/auth/require-admin-client';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { IdText } from '@/components/ui/id-text';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type CredentialItem = {
  credentialId: string;
  name: string;
  type: string;
  account: string | null;
  usageCount: number;
  updatedAt: string;
};

export default function CredentialsPage() {
  const [items, setItems] = useState<CredentialItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      const res = await fetch('/api/v1/credentials?pageSize=100');
      if (!res.ok) {
        if (active) {
          setItems([]);
          setLoading(false);
        }
        return;
      }
      const body = (await res.json()) as { data: CredentialItem[] };
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

  const onDelete = async (credentialId: string) => {
    if (deletingId) return;
    if (!confirm('确认删除该凭据？（仅当 usageCount=0 才允许删除）')) return;
    setDeletingId(credentialId);
    try {
      const res = await fetch(`/api/v1/credentials/${credentialId}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        toast.error(body?.error?.message ?? '删除失败');
        return;
      }
      toast.success('凭据已删除');
      setItems((prev) => prev.filter((c) => c.credentialId !== credentialId));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <RequireAdminClient />
      <div className="space-y-6">
        <PageHeader
          title="凭据"
          description="管理采集凭据。凭据可被多个来源引用。"
          actions={
            <Button asChild size="sm">
              <Link href="/credentials/new">新建凭据</Link>
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
              <div className="text-sm text-muted-foreground">暂无凭据，点击「新建凭据」开始配置。</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow>
                    <TableHead>名称</TableHead>
                    <TableHead>用户名/账号</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>引用数</TableHead>
                    <TableHead>更新时间</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.credentialId}>
                      <TableCell>
                        <div className="font-medium">{item.name}</div>
                        <IdText value={item.credentialId} />
                      </TableCell>
                      <TableCell className="text-sm">{item.account ?? '-'}</TableCell>
                      <TableCell className="font-mono text-xs">{item.type}</TableCell>
                      <TableCell className="font-mono text-xs">{item.usageCount}</TableCell>
                      <TableCell className="font-mono text-xs">{item.updatedAt}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button asChild size="sm" variant="outline">
                            <Link href={`/credentials/${item.credentialId}/edit`}>编辑</Link>
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={deletingId === item.credentialId}
                            onClick={() => void onDelete(item.credentialId)}
                          >
                            删除
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
