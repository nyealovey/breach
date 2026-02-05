'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { RequireAdminClient } from '@/components/auth/require-admin-client';
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

export default function EditAgentPage() {
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
        toast.error(body?.error?.message ?? '更新失败');
        return;
      }
      toast.success('代理已更新');
      router.push('/agents');
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async () => {
    if (deleting) return;
    if (!confirm('确认删除该代理？（仅当 usageCount=0 才允许删除）')) return;
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
    return (
      <>
        <RequireAdminClient />
        <div className="text-sm text-muted-foreground">加载中…</div>
      </>
    );
  }

  return (
    <>
      <RequireAdminClient />
      <div className="mx-auto w-full max-w-xl space-y-6">
        <PageHeader
          title="编辑代理"
          meta={<IdText value={params.id} className="text-foreground" />}
          actions={
            <>
              <Button asChild size="sm" variant="outline">
                <Link href="/agents">返回列表</Link>
              </Button>
              <Button size="sm" variant="destructive" onClick={() => void onDelete()}>
                删除
              </Button>
            </>
          }
        />

        <Card>
          <CardContent className="pt-6">
            <form className="space-y-4" onSubmit={onSubmit}>
              <div className="space-y-2">
                <Label htmlFor="agentId">Agent ID</Label>
                <Input id="agentId" value={params.id} disabled className="font-mono" />
              </div>

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
              </div>

              <div className="space-y-2">
                <Label htmlFor="endpoint">endpoint</Label>
                <Input id="endpoint" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
              </div>

              <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
                <div className="text-sm">
                  <div className="font-medium">TLS 校验</div>
                  <div className="text-xs text-muted-foreground">
                    仅 https 生效；关闭仅用于自签名/内网环境（有安全风险）
                  </div>
                </div>
                <Switch checked={tlsVerify} onCheckedChange={setTlsVerify} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="timeoutMs">timeout_ms</Label>
                <Input
                  id="timeoutMs"
                  type="number"
                  value={String(timeoutMs)}
                  onChange={(e) => setTimeoutMs(Number(e.target.value))}
                />
              </div>

              <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
                <div className="text-sm">
                  <div className="font-medium">启用</div>
                  <div className="text-xs text-muted-foreground">停用后来源将无法引用该代理（或运行会失败）。</div>
                </div>
                <Switch checked={enabled} onCheckedChange={setEnabled} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="usageCount">引用数</Label>
                <Input id="usageCount" value={String(usageCount)} disabled />
                <div className="text-xs text-muted-foreground">引用数不为 0 时禁止删除。</div>
              </div>

              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? '提交中…' : '保存'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
