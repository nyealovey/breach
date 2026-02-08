'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { IdText } from '@/components/ui/id-text';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';

import type { FormEvent } from 'react';

type AgentType = 'hyperv' | 'veeam';

type AgentDetail = {
  agentId: string;
  name: string;
  agentType: AgentType;
  endpoint: string;
  enabled: boolean;
  tlsVerify: boolean;
  timeoutMs: number;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
};

export function EditAgentClient() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [name, setName] = useState('');
  const [agentType, setAgentType] = useState<AgentType>('hyperv');
  const [endpoint, setEndpoint] = useState('');
  const [tlsVerify, setTlsVerify] = useState(true);
  const [timeoutMs, setTimeoutMs] = useState(60_000);
  const [enabled, setEnabled] = useState(true);
  const [usageCount, setUsageCount] = useState(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      const res = await fetch(`/api/v1/agents/${params.id}`);
      if (!res.ok) {
        toast.error('加载失败');
        if (active) setLoading(false);
        return;
      }
      const body = (await res.json()) as { data: AgentDetail };
      const a = body.data;
      if (active) {
        setName(a.name);
        setAgentType(a.agentType);
        setEndpoint(a.endpoint);
        setTlsVerify(a.tlsVerify);
        setTimeoutMs(a.timeoutMs);
        setEnabled(a.enabled);
        setUsageCount(a.usageCount);
        setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [params.id]);

  const validate = () => {
    if (!name.trim()) return '请输入名称';
    if (!endpoint.trim()) return '请填写 endpoint';
    if (!/^https?:\/\//i.test(endpoint.trim())) return 'endpoint 必须以 http:// 或 https:// 开头';
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return 'timeoutMs 必须是正整数';
    return null;
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/agents/${params.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          agentType,
          endpoint: endpoint.trim(),
          tlsVerify,
          timeoutMs,
          enabled,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        toast.error(body?.error?.message ?? '保存失败');
        return;
      }
      toast.success('代理已保存');
      router.push('/agents');
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async () => {
    if (deleting) return;
    if (usageCount > 0) {
      toast.error('该代理仍被引用，无法删除');
      return;
    }
    if (!confirm('确认删除该代理？')) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/agents/${params.id}`, { method: 'DELETE' });
      if (res.status === 204) {
        toast.success('代理已删除');
        router.push('/agents');
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      toast.error(body?.error?.message ?? '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground">加载中…</div>;
  }

  return (
    <div className="mx-auto w-full max-w-xl space-y-6">
      <PageHeader
        title="编辑代理"
        meta={<IdText value={params.id} className="text-foreground" />}
        description="修改 Agent 的 endpoint/类型/超时/TLS 校验。"
        actions={
          <Button asChild size="sm" variant="outline">
            <Link href="/agents">返回列表</Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="pt-6">
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label htmlFor="name">名称</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="agentType">类型</Label>
              <NativeSelect
                id="agentType"
                value={agentType}
                onChange={(e) => setAgentType(e.target.value as AgentType)}
              >
                <option value="hyperv">Hyper-V</option>
                <option value="veeam">Veeam</option>
              </NativeSelect>
              <div className="text-xs text-muted-foreground">
                说明：类型用于约束来源可选代理（例如 Hyper-V 来源仅可选 hyperv 代理）。
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="endpoint">endpoint</Label>
              <Input id="endpoint" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="timeoutMs">超时（ms）</Label>
                <Input
                  id="timeoutMs"
                  type="number"
                  inputMode="numeric"
                  value={timeoutMs}
                  onChange={(e) => setTimeoutMs(Number(e.target.value))}
                />
              </div>

              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="text-sm font-medium">TLS 校验</div>
                  <div className="text-xs text-muted-foreground">关闭后将跳过证书校验（不推荐）。</div>
                </div>
                <Switch checked={tlsVerify} onCheckedChange={setTlsVerify} />
              </div>

              <div className="flex items-center justify-between rounded-md border p-3 md:col-span-2">
                <div>
                  <div className="text-sm font-medium">启用</div>
                  <div className="text-xs text-muted-foreground">停用后该代理不会出现在可选列表中。</div>
                </div>
                <Switch checked={enabled} onCheckedChange={setEnabled} />
              </div>

              <div className="flex items-center justify-between rounded-md border p-3 md:col-span-2">
                <div>
                  <div className="text-sm font-medium">引用</div>
                  <div className="text-xs text-muted-foreground">仅当 usageCount=0 才允许删除。</div>
                </div>
                <div className="font-mono text-xs">{usageCount}</div>
              </div>
            </div>

            <div className="flex flex-col gap-2 md:flex-row">
              <Button className="flex-1" type="submit" disabled={submitting}>
                {submitting ? '保存中…' : '保存'}
              </Button>
              <Button
                className="flex-1"
                type="button"
                variant="destructive"
                disabled={deleting || usageCount > 0}
                onClick={() => void onDelete()}
              >
                {deleting ? '删除中…' : usageCount > 0 ? '无法删除（仍被引用）' : '删除'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
