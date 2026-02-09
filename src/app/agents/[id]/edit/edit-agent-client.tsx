'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { IdText } from '@/components/ui/id-text';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';

import { deleteAgentAction, updateAgentAction } from '../../actions';

import type { FormEvent } from 'react';

import type { AgentDetail } from '../../actions';

type AgentType = 'hyperv' | 'veeam';

export function EditAgentClient({ initialAgent }: { initialAgent: AgentDetail }) {
  const router = useRouter();

  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [name, setName] = useState(initialAgent.name);
  const [agentType, setAgentType] = useState<AgentType>(initialAgent.agentType as AgentType);
  const [endpoint, setEndpoint] = useState(initialAgent.endpoint);
  const [tlsVerify, setTlsVerify] = useState(initialAgent.tlsVerify);
  const [timeoutMs, setTimeoutMs] = useState(initialAgent.timeoutMs);
  const [enabled, setEnabled] = useState(initialAgent.enabled);
  const [usageCount, setUsageCount] = useState(initialAgent.usageCount);

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
      const result = await updateAgentAction(initialAgent.agentId, {
        name,
        agentType,
        endpoint: endpoint.trim(),
        tlsVerify,
        timeoutMs,
        enabled,
      });
      if (!result.ok) {
        toast.error(result.error ?? '保存失败');
        return;
      }
      setUsageCount(result.data.usageCount);
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
      const result = await deleteAgentAction(initialAgent.agentId);
      if (result.ok) {
        toast.success('代理已删除');
        router.push('/agents');
        return;
      }
      toast.error(result.error ?? '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-xl space-y-6">
      <PageHeader
        title="编辑代理"
        meta={<IdText value={initialAgent.agentId} className="text-foreground" />}
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
