'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { RequireAdminClient } from '@/components/auth/require-admin-client';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';

import type { FormEvent } from 'react';

type AgentType = 'hyperv' | 'veeam';

export default function NewAgentPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [agentType, setAgentType] = useState<AgentType>('hyperv');
  const [endpoint, setEndpoint] = useState('');
  const [tlsVerify, setTlsVerify] = useState(true);
  const [timeoutMs, setTimeoutMs] = useState(60_000);
  const [enabled, setEnabled] = useState(true);
  const [submitting, setSubmitting] = useState(false);

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
      const res = await fetch('/api/v1/agents', {
        method: 'POST',
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
        toast.error(body?.error?.message ?? '创建失败');
        return;
      }
      toast.success('代理已创建');
      router.push('/agents');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <RequireAdminClient />
      <div className="max-w-xl space-y-6">
        <PageHeader
          title="新建代理"
          description="配置 Agent 的 endpoint/类型/超时/TLS 校验。"
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
                <Input
                  id="endpoint"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder="http://hyperv-agent01.example.com:8787"
                />
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

              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? '提交中…' : '创建'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
