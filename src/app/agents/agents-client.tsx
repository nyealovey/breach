'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { IdText } from '@/components/ui/id-text';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

import { checkAgentAction, deleteAgentAction } from './actions';

import type { AgentCheckResult, AgentListItem } from './actions';

export function AgentsClient({ initialItems }: { initialItems: AgentListItem[] }) {
  const [items, setItems] = useState<AgentListItem[]>(initialItems);
  const [checking, setChecking] = useState<Record<string, boolean>>({});
  const [checkResults, setCheckResults] = useState<Record<string, AgentCheckResult | undefined>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const hasItems = items.length > 0;
  const anyChecking = useMemo(() => Object.values(checking).some(Boolean), [checking]);

  const checkOne = async (agentId: string) => {
    if (checking[agentId]) return;
    setChecking((prev) => ({ ...prev, [agentId]: true }));
    try {
      const result = await checkAgentAction(agentId);
      if (!result.ok) {
        toast.error(result.error ?? '检测失败');
        return;
      }
      setCheckResults((prev) => ({ ...prev, [agentId]: result.data }));
    } finally {
      setChecking((prev) => ({ ...prev, [agentId]: false }));
    }
  };

  const checkAll = async () => {
    if (!hasItems || anyChecking) return;
    await Promise.all(items.map((a) => checkOne(a.agentId)));
  };

  const onDelete = async (agentId: string) => {
    if (deletingId) return;
    if (!confirm('确认删除该代理？（仅当 usageCount=0 才允许删除）')) return;
    setDeletingId(agentId);
    try {
      const result = await deleteAgentAction(agentId);
      if (result.ok) {
        toast.success('代理已删除');
        setItems((prev) => prev.filter((a) => a.agentId !== agentId));
        setCheckResults((prev) => {
          const copy = { ...prev };
          delete copy[agentId];
          return copy;
        });
        return;
      }
      toast.error(result.error ?? '删除失败');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="代理"
        description="集中管理采集 Agent（endpoint/类型/超时/TLS）。Hyper-V 来源选择 connection_method=agent 时将引用这里的代理配置。"
        actions={
          <>
            <Button size="sm" variant="outline" disabled={!hasItems || anyChecking} onClick={() => void checkAll()}>
              {anyChecking ? '检测中…' : '检测全部'}
            </Button>
            <Button asChild size="sm">
              <Link href="/agents/new">新建代理</Link>
            </Button>
          </>
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
            <div className="text-sm text-muted-foreground">暂无代理，点击「新建代理」开始配置。</div>
          ) : (
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>启用</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>引用</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const r = checkResults[item.agentId];
                  const checkingThis = !!checking[item.agentId];
                  return (
                    <TableRow key={item.agentId}>
                      <TableCell>
                        <div className="font-medium">{item.name}</div>
                        <IdText value={item.agentId} />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{item.agentType}</TableCell>
                      <TableCell>
                        <Badge variant={item.enabled ? 'secondary' : 'outline'}>{item.enabled ? '启用' : '停用'}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{item.endpoint}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {checkingThis ? (
                          <span className="text-muted-foreground">检测中…</span>
                        ) : r ? (
                          <span className={r.reachable ? 'text-emerald-600' : 'text-destructive'}>
                            {r.reachable ? '可达' : '不可达'}
                            <span className="ml-2 text-muted-foreground">
                              {r.status ?? '-'} / {r.durationMs}ms
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">未检测</span>
                        )}
                        {r?.error ? (
                          <div className="mt-1 max-w-[520px] truncate text-xs text-muted-foreground" title={r.error}>
                            {r.error}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{item.usageCount}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={checkingThis || anyChecking}
                            onClick={() => void checkOne(item.agentId)}
                          >
                            检测
                          </Button>
                          <Button asChild size="sm" variant="outline">
                            <Link href={`/agents/${item.agentId}/edit`}>编辑</Link>
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={deletingId === item.agentId}
                            onClick={() => void onDelete(item.agentId)}
                          >
                            删除
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
