'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

import type { FormEvent } from 'react';

type SourceItem = {
  sourceId: string;
  name: string;
  sourceType: string;
  enabled: boolean;
  scheduleGroupId: string | null;
  scheduleGroupName: string | null;
};

export default function NewScheduleGroupPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('Asia/Shanghai');
  const [runAtHhmm, setRunAtHhmm] = useState('02:00');
  const [enabled, setEnabled] = useState(true);
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    const loadSources = async () => {
      const res = await fetch('/api/v1/sources?enabled=true&pageSize=100');
      if (!res.ok) {
        if (active) setSources([]);
        return;
      }
      const body = (await res.json()) as { data: SourceItem[] };
      if (active) setSources(body.data ?? []);
    };
    void loadSources();
    return () => {
      active = false;
    };
  }, []);

  const selectedSet = useMemo(() => new Set(selectedSourceIds), [selectedSourceIds]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (selectedSourceIds.length === 0) {
      toast.error('请至少选择 1 个来源');
      return;
    }
    setSubmitting(true);

    try {
      const res = await fetch('/api/v1/schedule-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, timezone, runAtHhmm, enabled, sourceIds: selectedSourceIds }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        toast.error(body?.error?.message ?? '创建失败');
        return;
      }

      toast.success('调度组已创建');
      router.push('/schedule-groups');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>新建调度组</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={onSubmit}>
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
          <div className="flex items-center justify-between rounded border px-3 py-2">
            <div className="text-sm">
              <div className="font-medium">启用</div>
              <div className="text-xs text-muted-foreground">启用后会按设定时间触发 Run</div>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
          <div className="space-y-2">
            <Label>选择来源（多选，必须为启用状态）</Label>
            {sources.length === 0 ? (
              <div className="text-sm text-muted-foreground">暂无可选来源（仅展示 enabled=true 的来源）。</div>
            ) : (
              <div className="space-y-2 rounded border p-3">
                {sources.map((s) => {
                  const checked = selectedSet.has(s.sourceId);
                  const hint =
                    s.scheduleGroupName || s.scheduleGroupId ? `当前：${s.scheduleGroupName ?? s.scheduleGroupId}` : '';
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
                        <div className="font-mono text-xs text-muted-foreground">{s.sourceId}</div>
                        {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          <Button type="submit" disabled={submitting}>
            {submitting ? '保存中…' : '保存'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
