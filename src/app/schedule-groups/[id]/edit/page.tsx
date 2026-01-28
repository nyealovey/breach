'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

import type { FormEvent } from 'react';

type ScheduleGroup = {
  groupId: string;
  name: string;
  timezone: string;
  runAtHhmm: string;
  enabled: boolean;
};

export default function EditScheduleGroupPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('Asia/Shanghai');
  const [runAtHhmm, setRunAtHhmm] = useState('02:00');
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      const res = await fetch(`/api/v1/schedule-groups/${params.id}`);
      if (!res.ok) {
        toast.error('加载失败');
        setLoading(false);
        return;
      }
      const body = (await res.json()) as { data: ScheduleGroup };
      if (active) {
        const group = body.data;
        setName(group.name);
        setTimezone(group.timezone);
        setRunAtHhmm(group.runAtHhmm);
        setEnabled(group.enabled);
        setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [params.id]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);

    try {
      const res = await fetch(`/api/v1/schedule-groups/${params.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, timezone, runAtHhmm, enabled }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        toast.error(body?.error?.message ?? '更新失败');
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
    const res = await fetch(`/api/v1/schedule-groups/${params.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      toast.error(body?.error?.message ?? '删除失败');
      return;
    }
    toast.success('调度组已删除');
    router.push('/schedule-groups');
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground">加载中…</div>;
  }

  return (
    <Card className="max-w-xl">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>编辑调度组</CardTitle>
        <Button variant="destructive" size="sm" onClick={onDelete}>
          删除
        </Button>
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
          <Button type="submit" disabled={submitting}>
            {submitting ? '保存中…' : '保存'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
