'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

import type { FormEvent } from 'react';

type ScheduleGroup = { groupId: string; name: string };
type CredentialItem = { credentialId: string; name: string; type: string };

export default function NewSourcePage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [sourceType, setSourceType] = useState('vcenter');
  const [endpoint, setEndpoint] = useState('');
  const [scheduleGroupId, setScheduleGroupId] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [groups, setGroups] = useState<ScheduleGroup[]>([]);
  const [credentialId, setCredentialId] = useState('');
  const [credentials, setCredentials] = useState<CredentialItem[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    const loadGroups = async () => {
      const res = await fetch('/api/v1/schedule-groups?pageSize=100');
      if (!res.ok) return;
      const body = (await res.json()) as { data: ScheduleGroup[] };
      if (active) setGroups(body.data ?? []);
    };
    void loadGroups();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadCredentials = async () => {
      const res = await fetch(`/api/v1/credentials?type=${encodeURIComponent(sourceType)}&pageSize=100`);
      if (!res.ok) {
        if (active) setCredentials([]);
        return;
      }
      const body = (await res.json()) as { data: CredentialItem[] };
      if (active) setCredentials(body.data ?? []);
    };
    void loadCredentials();
    return () => {
      active = false;
    };
  }, [sourceType]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/v1/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          sourceType,
          scheduleGroupId,
          enabled,
          config: { endpoint },
          credentialId: credentialId ? credentialId : null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        toast.error(body?.error?.message ?? '创建失败');
        return;
      }
      toast.success('来源已创建');
      router.push('/sources');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>新建来源</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="name">名称</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sourceType">类型</Label>
            <select
              id="sourceType"
              className="h-9 w-full rounded border border-input bg-background px-3 text-sm"
              value={sourceType}
              onChange={(e) => {
                setSourceType(e.target.value);
                setCredentialId('');
              }}
            >
              <option value="vcenter">vCenter</option>
              <option value="pve">PVE</option>
              <option value="hyperv">Hyper-V</option>
              <option value="aliyun">阿里云</option>
              <option value="third_party">第三方</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="endpoint">Endpoint</Label>
            <Input id="endpoint" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="scheduleGroupId">调度组</Label>
            <select
              id="scheduleGroupId"
              className="h-9 w-full rounded border border-input bg-background px-3 text-sm"
              value={scheduleGroupId}
              onChange={(e) => setScheduleGroupId(e.target.value)}
            >
              <option value="">请选择</option>
              {groups.map((group) => (
                <option key={group.groupId} value={group.groupId}>
                  {group.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="credentialId">选择凭据</Label>
            <select
              id="credentialId"
              className="h-9 w-full rounded border border-input bg-background px-3 text-sm"
              value={credentialId}
              onChange={(e) => setCredentialId(e.target.value)}
            >
              <option value="">不选择</option>
              {credentials.map((c) => (
                <option key={c.credentialId} value={c.credentialId}>
                  {c.name}
                </option>
              ))}
            </select>
            {enabled && !credentialId ? (
              <div className="text-sm text-destructive">未配置凭据，无法参与运行/调度。</div>
            ) : null}
          </div>
          <div className="flex items-center justify-between rounded border px-3 py-2">
            <div className="text-sm">
              <div className="font-medium">启用</div>
              <div className="text-xs text-muted-foreground">启用后会参与调度与手动触发</div>
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
