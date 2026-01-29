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

type SourceDetail = {
  sourceId: string;
  name: string;
  sourceType: string;
  enabled: boolean;
  credential: { credentialId: string; name: string; type: string } | null;
  config?: { endpoint?: string };
};
type CredentialItem = { credentialId: string; name: string; type: string };

export default function EditSourcePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState('');
  const [sourceType, setSourceType] = useState('vcenter');
  const [endpoint, setEndpoint] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [credentialId, setCredentialId] = useState('');
  const [credentials, setCredentials] = useState<CredentialItem[]>([]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const sourceRes = await fetch(`/api/v1/sources/${params.id}`);
      if (sourceRes.ok) {
        const body = (await sourceRes.json()) as { data: SourceDetail };
        const source = body.data;
        if (active) {
          setName(source.name);
          setSourceType(source.sourceType);
          setEndpoint(source.config?.endpoint ?? '');
          setEnabled(source.enabled);
          setCredentialId(source.credential?.credentialId ?? '');
        }
      } else {
        toast.error('加载失败');
      }
      if (active) setLoading(false);
    };
    void load();
    return () => {
      active = false;
    };
  }, [params.id]);

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
      const res = await fetch(`/api/v1/sources/${params.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          sourceType,
          enabled,
          config: { endpoint },
          credentialId: credentialId ? credentialId : null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        toast.error(body?.error?.message ?? '更新失败');
        return;
      }
      toast.success('来源已更新');
      router.push('/sources');
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async () => {
    if (!confirm('确认删除该来源？')) return;
    const res = await fetch(`/api/v1/sources/${params.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      toast.error(body?.error?.message ?? '删除失败');
      return;
    }
    toast.success('来源已删除');
    router.push('/sources');
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground">加载中…</div>;
  }

  return (
    <div className="space-y-6">
      <Card className="max-w-xl">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>编辑来源</CardTitle>
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
    </div>
  );
}
