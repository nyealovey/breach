'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type ScheduleGroup = {
  groupId: string;
  name: string;
  enabled: boolean;
  timezone: string;
  runAtHhmm: string;
  sourceCount: number;
  lastTriggeredOn: string | null;
};

type ManualRunResult = {
  queued: number;
  skipped_active: number;
  skipped_missing_credential: number;
  skipped_missing_config?: number;
  message: string;
};

export default function ScheduleGroupsPage() {
  const [groups, setGroups] = useState<ScheduleGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningId, setRunningId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      const res = await fetch('/api/v1/schedule-groups');
      if (!res.ok) {
        setGroups([]);
        setLoading(false);
        return;
      }
      const body = (await res.json()) as { data: ScheduleGroup[] };
      if (active) {
        setGroups(body.data ?? []);
        setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  const onRun = async (groupId: string) => {
    if (runningId) return;
    setRunningId(groupId);
    try {
      const res = await fetch(`/api/v1/schedule-groups/${groupId}/runs`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        toast.error(body?.error?.message ?? '触发失败');
        return;
      }
      const body = (await res.json()) as { data: ManualRunResult };
      const r = body.data;
      const skippedMissingConfig = r.skipped_missing_config ?? 0;
      const summary = `queued=${r.queued} · skipped_active=${r.skipped_active} · skipped_missing_credential=${r.skipped_missing_credential} · skipped_missing_config=${skippedMissingConfig}`;
      if (r.queued === 0) toast.message(r.message || '无可入队来源', { description: summary });
      else toast.success('已触发运行', { description: summary });
    } finally {
      setRunningId(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>调度组</CardTitle>
        <Button asChild>
          <Link href="/schedule-groups/new">新建调度组</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-sm text-muted-foreground">加载中…</div>
        ) : groups.length === 0 ? (
          <div className="text-sm text-muted-foreground">暂无调度组，点击「新建调度组」开始配置。</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>启用</TableHead>
                <TableHead>时区</TableHead>
                <TableHead>触发时间</TableHead>
                <TableHead>来源数量</TableHead>
                <TableHead>上次触发</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => (
                <TableRow key={group.groupId}>
                  <TableCell>
                    <div className="font-medium">{group.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">{group.groupId}</div>
                  </TableCell>
                  <TableCell>{group.enabled ? '启用' : '停用'}</TableCell>
                  <TableCell>{group.timezone}</TableCell>
                  <TableCell>{group.runAtHhmm}</TableCell>
                  <TableCell>{group.sourceCount}</TableCell>
                  <TableCell>{group.lastTriggeredOn ?? '-'}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={runningId === group.groupId}
                        onClick={() => void onRun(group.groupId)}
                      >
                        运行
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/schedule-groups/${group.groupId}/edit`}>编辑</Link>
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
  );
}
