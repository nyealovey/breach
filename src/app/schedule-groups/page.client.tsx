'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { IdText } from '@/components/ui/id-text';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

type GroupRunMode = 'healthcheck' | 'detect' | 'collect';

export default function ScheduleGroupsPage() {
  const [groups, setGroups] = useState<ScheduleGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [pendingGroup, setPendingGroup] = useState<{ id: string; name: string } | null>(null);
  const [runMode, setRunMode] = useState<GroupRunMode>('collect');

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

  const openRunDialog = (group: ScheduleGroup) => {
    if (runningId) return;
    setPendingGroup({ id: group.groupId, name: group.name });
    setRunMode('collect');
    setRunDialogOpen(true);
  };

  const onConfirmRun = async () => {
    if (!pendingGroup) return;
    if (runningId) return;

    setRunningId(pendingGroup.id);
    try {
      const res = await fetch(`/api/v1/schedule-groups/${pendingGroup.id}/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: runMode }),
      });
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
      setRunDialogOpen(false);
    } finally {
      setRunningId(null);
    }
  };

  return (
    <>
      <Dialog
        open={runDialogOpen}
        onOpenChange={(open) => {
          setRunDialogOpen(open);
          if (!open) setPendingGroup(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>触发运行</DialogTitle>
            <DialogDescription>
              {pendingGroup ? (
                <span>
                  调度组：<span className="font-mono">{pendingGroup.name}</span>
                </span>
              ) : (
                '请选择运行模式。'
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="runMode">模式</Label>
            <Select value={runMode} onValueChange={(v) => setRunMode(v as GroupRunMode)}>
              <SelectTrigger id="runMode">
                <SelectValue placeholder="选择模式" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="healthcheck">healthcheck（连通性/认证）</SelectItem>
                <SelectItem value="detect">detect（探测能力/driver 建议）</SelectItem>
                <SelectItem value="collect">collect（采集清单）</SelectItem>
              </SelectContent>
            </Select>
            <div className="text-xs text-muted-foreground">
              说明：collect 对 vCenter 会拆分为 collect_hosts + collect_vms；建议先 healthcheck/detect 再 collect。
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRunDialogOpen(false)} disabled={!!runningId}>
              取消
            </Button>
            <Button type="button" onClick={() => void onConfirmRun()} disabled={!!runningId || !pendingGroup}>
              {runningId ? '运行中…' : '运行'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="space-y-6">
        <PageHeader
          title="调度组"
          description="按时区与触发时间批量触发来源运行。"
          actions={
            <Button asChild size="sm">
              <Link href="/schedule-groups/new">新建调度组</Link>
            </Button>
          }
        />

        <Card>
          <CardHeader className="flex flex-col gap-3 space-y-0 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <div className="text-sm font-medium">列表</div>
              <div className="text-xs text-muted-foreground">
                {loading ? '加载中…' : groups.length === 0 ? '暂无数据' : `共 ${groups.length} 条`}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-sm text-muted-foreground">加载中…</div>
            ) : groups.length === 0 ? (
              <div className="text-sm text-muted-foreground">暂无调度组，点击「新建调度组」开始配置。</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/30">
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
                        <IdText value={group.groupId} />
                      </TableCell>
                      <TableCell>{group.enabled ? '启用' : '停用'}</TableCell>
                      <TableCell className="font-mono text-xs">{group.timezone}</TableCell>
                      <TableCell className="font-mono text-xs">{group.runAtHhmm}</TableCell>
                      <TableCell className="font-mono text-xs">{group.sourceCount}</TableCell>
                      <TableCell className="font-mono text-xs">{group.lastTriggeredOn ?? '-'}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!!runningId}
                            onClick={() => openRunDialog(group)}
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
      </div>
    </>
  );
}
