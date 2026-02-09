'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { IdText } from '@/components/ui/id-text';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

import { deleteScheduleGroupAction, updateScheduleGroupAction } from '../../actions';

import type { FormEvent } from 'react';

import type { ScheduleGroupDetail, ScheduleGroupSourceItem } from '../../actions';

export default function EditScheduleGroupPage({
  initialGroup,
  initialSources,
}: {
  initialGroup: ScheduleGroupDetail;
  initialSources: ScheduleGroupSourceItem[];
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState(initialGroup.name);
  const [timezone, setTimezone] = useState(initialGroup.timezone);
  const [runAtHhmm, setRunAtHhmm] = useState(initialGroup.runAtHhmm);
  const [enabled, setEnabled] = useState(initialGroup.enabled);
  const [sources] = useState<ScheduleGroupSourceItem[]>(initialSources);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>(
    initialSources.filter((s) => s.scheduleGroupId === initialGroup.groupId).map((s) => s.sourceId),
  );

  const selectedSet = useMemo(() => new Set(selectedSourceIds), [selectedSourceIds]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);

    try {
      const result = await updateScheduleGroupAction(initialGroup.groupId, {
        name,
        timezone,
        runAtHhmm,
        enabled,
        sourceIds: selectedSourceIds,
      });
      if (!result.ok) {
        toast.error(result.error ?? '更新失败');
        return;
      }
      toast.success('调度组已更新');
      router.push('/schedule-groups');
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async () => {
    if (!confirm('确认删除该调度组？')) return;
    const result = await deleteScheduleGroupAction(initialGroup.groupId);
    if (!result.ok) {
      toast.error(result.error ?? '删除失败');
      return;
    }
    toast.success('调度组已删除');
    router.push('/schedule-groups');
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <PageHeader
        title="编辑调度组"
        meta={<IdText value={initialGroup.groupId} className="text-foreground" />}
        actions={
          <>
            <Button asChild size="sm" variant="outline">
              <Link href="/schedule-groups">返回列表</Link>
            </Button>
            <Button variant="destructive" size="sm" onClick={onDelete}>
              删除
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="pt-6">
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label htmlFor="groupId">Group ID</Label>
              <Input id="groupId" value={initialGroup.groupId} disabled className="font-mono" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">名称</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="timezone">时区</Label>
              <Input id="timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="runAtHhmm">触发时间（HH:mm）</Label>
              <Input id="runAtHhmm" value={runAtHhmm} onChange={(e) => setRunAtHhmm(e.target.value)} />
            </div>
            <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
              <div className="text-sm">
                <div className="font-medium">启用</div>
                <div className="text-xs text-muted-foreground">启用后会按设定时间触发 Run</div>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>
            <div className="space-y-2">
              <Label>选择来源（多选，仅展示 enabled=true 的来源）</Label>
              {sources.length === 0 ? (
                <div className="text-sm text-muted-foreground">暂无可选来源。</div>
              ) : (
                <div className="space-y-2 rounded-md border bg-background p-3">
                  {sources.map((s) => {
                    const checked = selectedSet.has(s.sourceId);
                    const hint =
                      s.scheduleGroupId && s.scheduleGroupId !== initialGroup.groupId
                        ? `（当前：${s.scheduleGroupName ?? s.scheduleGroupId}）`
                        : '';

                    return (
                      <label key={s.sourceId} className="flex cursor-pointer items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={checked}
                          onChange={(e) => {
                            setSelectedSourceIds((prev) => {
                              if (e.target.checked) return [...prev, s.sourceId];
                              return prev.filter((id) => id !== s.sourceId);
                            });
                          }}
                        />
                        <div className="min-w-0 space-y-0.5">
                          <div className="font-medium leading-none">{s.name}</div>
                          <IdText value={s.sourceId} />
                          {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                选择的来源若已属于其他调度组，会自动移动到当前调度组。
              </div>
            </div>
            <Button type="submit" disabled={submitting}>
              {submitting ? '保存中…' : '保存'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
