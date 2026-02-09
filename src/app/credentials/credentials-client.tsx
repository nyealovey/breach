'use client';

import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { IdText } from '@/components/ui/id-text';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

import { deleteCredentialAction } from './actions';

import type { CredentialListItem } from './actions';

export function CredentialsClient({ initialItems }: { initialItems: CredentialListItem[] }) {
  const [items, setItems] = useState<CredentialListItem[]>(initialItems);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const onDelete = async (credentialId: string) => {
    if (deletingId) return;
    if (!confirm('确认删除该凭据？（仅当 usageCount=0 才允许删除）')) return;
    setDeletingId(credentialId);
    try {
      const result = await deleteCredentialAction(credentialId);
      if (!result.ok) {
        toast.error(result.error ?? '删除失败');
        return;
      }
      toast.success('凭据已删除');
      setItems((prev) => prev.filter((c) => c.credentialId !== credentialId));
    } finally {
      setDeletingId(null);
    }
  };

  return (
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
              {items.length === 0 ? '暂无数据' : `共 ${items.length} 条`}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
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
                          disabled={deletingId === item.credentialId || item.usageCount > 0}
                          onClick={() => void onDelete(item.credentialId)}
                        >
                          {item.usageCount > 0 ? '无法删除' : '删除'}
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
  );
}
