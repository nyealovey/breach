'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { RequireAdminClient } from '@/components/auth/require-admin-client';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { compactId } from '@/lib/ui/compact-id';

import type { FormEvent } from 'react';

type CredentialItem = { credentialId: string; name: string; type: string };

export default function NewSourcePage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [sourceType, setSourceType] = useState('vcenter');
  const [endpoint, setEndpoint] = useState('');
  const [preferredVcenterVersion, setPreferredVcenterVersion] = useState<'6.5-6.7' | '7.0-8.x'>('7.0-8.x');
  const [pveTlsVerify, setPveTlsVerify] = useState(true);
  const [pveTimeoutMs, setPveTimeoutMs] = useState(60_000);
  const [pveScope, setPveScope] = useState<'auto' | 'standalone' | 'cluster'>('auto');
  const [pveMaxParallelNodes, setPveMaxParallelNodes] = useState(5);
  const [pveAuthType, setPveAuthType] = useState<'api_token' | 'user_password'>('api_token');
  const [hypervConnectionMethod, setHypervConnectionMethod] = useState<'winrm' | 'agent'>('winrm');
  const [hypervAgentUrl, setHypervAgentUrl] = useState('');
  const [hypervAgentTlsVerify, setHypervAgentTlsVerify] = useState(true);
  const [hypervAgentTimeoutMs, setHypervAgentTimeoutMs] = useState(60_000);
  const [hypervScheme, setHypervScheme] = useState<'https' | 'http'>('http');
  const [hypervPort, setHypervPort] = useState(5985);
  const [hypervTlsVerify, setHypervTlsVerify] = useState(true);
  const [hypervTimeoutMs, setHypervTimeoutMs] = useState(60_000);
  const [hypervScope, setHypervScope] = useState<'auto' | 'standalone' | 'cluster'>('auto');
  const [hypervMaxParallelNodes, setHypervMaxParallelNodes] = useState(5);
  const [hypervAuthMethod, setHypervAuthMethod] = useState<'auto' | 'kerberos' | 'ntlm' | 'basic'>('auto');
  const [enabled, setEnabled] = useState(true);
  const [credentialId, setCredentialId] = useState('');
  const [credentials, setCredentials] = useState<CredentialItem[]>([]);
  const [submitting, setSubmitting] = useState(false);

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

    if (sourceType === 'hyperv' && !endpoint.trim()) {
      toast.error('请填写 endpoint');
      return;
    }
    if (sourceType === 'hyperv' && hypervConnectionMethod === 'agent' && !hypervAgentUrl.trim()) {
      toast.error('请填写 agent_url');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/v1/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          sourceType,
          enabled,
          config: {
            endpoint: endpoint.trim(),
            ...(sourceType === 'vcenter' ? { preferred_vcenter_version: preferredVcenterVersion } : {}),
            ...(sourceType === 'pve'
              ? {
                  tls_verify: pveTlsVerify,
                  timeout_ms: pveTimeoutMs,
                  scope: pveScope,
                  max_parallel_nodes: pveMaxParallelNodes,
                  auth_type: pveAuthType,
                }
              : {}),
            ...(sourceType === 'hyperv'
              ? hypervConnectionMethod === 'agent'
                ? {
                    connection_method: 'agent',
                    agent_url: hypervAgentUrl.trim(),
                    agent_tls_verify: hypervAgentTlsVerify,
                    agent_timeout_ms: hypervAgentTimeoutMs,
                    scope: hypervScope,
                    max_parallel_nodes: hypervMaxParallelNodes,
                  }
                : {
                    connection_method: 'winrm',
                    auth_method: hypervAuthMethod,
                    scheme: hypervScheme,
                    port: hypervPort,
                    tls_verify: hypervTlsVerify,
                    timeout_ms: hypervTimeoutMs,
                    scope: hypervScope,
                    max_parallel_nodes: hypervMaxParallelNodes,
                  }
              : {}),
          },
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
    <>
      <RequireAdminClient />
      <div className="max-w-2xl space-y-6">
        <PageHeader
          title="新建来源"
          description="配置采集来源（endpoint/类型/凭据）。保存后可参与运行/调度。"
          actions={
            <Button asChild size="sm" variant="outline">
              <Link href="/sources">返回列表</Link>
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
                <Label htmlFor="sourceType">类型</Label>
                <NativeSelect
                  id="sourceType"
                  value={sourceType}
                  onChange={(e) => {
                    setSourceType(e.target.value);
                    setCredentialId('');
                    setPreferredVcenterVersion('7.0-8.x');
                    setPveTlsVerify(true);
                    setPveTimeoutMs(60_000);
                    setPveScope('auto');
                    setPveMaxParallelNodes(5);
                    setPveAuthType('api_token');
                    setHypervConnectionMethod('winrm');
                    setHypervAgentUrl('');
                    setHypervAgentTlsVerify(true);
                    setHypervAgentTimeoutMs(60_000);
                    setHypervScheme('http');
                    setHypervPort(5985);
                    setHypervTlsVerify(true);
                    setHypervTimeoutMs(60_000);
                    setHypervScope('auto');
                    setHypervMaxParallelNodes(5);
                    setHypervAuthMethod('auto');
                  }}
                >
                  <option value="vcenter">vCenter</option>
                  <option value="pve">PVE</option>
                  <option value="hyperv">Hyper-V</option>
                  <option value="aliyun">阿里云</option>
                  <option value="third_party">第三方</option>
                </NativeSelect>
              </div>
              <div className="space-y-2">
                <Label htmlFor="endpoint">Endpoint</Label>
                <Input id="endpoint" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
              </div>
              {sourceType === 'vcenter' ? (
                <div className="space-y-2">
                  <Label htmlFor="preferredVcenterVersion">vCenter 版本范围</Label>
                  <NativeSelect
                    id="preferredVcenterVersion"
                    value={preferredVcenterVersion}
                    onChange={(e) => setPreferredVcenterVersion(e.target.value as typeof preferredVcenterVersion)}
                  >
                    <option value="7.0-8.x">7.0-8.x（默认）</option>
                    <option value="6.5-6.7">6.5-6.7</option>
                  </NativeSelect>
                  <div className="text-xs text-muted-foreground">
                    说明：该字段用于选择采集 driver；detect 会给出建议，但不会自动改写配置。
                  </div>
                </div>
              ) : null}
              {sourceType === 'pve' ? (
                <div className="space-y-3 rounded-md border bg-background p-3">
                  <div className="text-sm font-medium">PVE 配置</div>

                  <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
                    <div className="text-sm">
                      <div className="font-medium">TLS 校验</div>
                      <div className="text-xs text-muted-foreground">关闭仅用于自签名/内网环境（有安全风险）</div>
                    </div>
                    <Switch checked={pveTlsVerify} onCheckedChange={setPveTlsVerify} />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="pveTimeoutMs">timeout_ms</Label>
                    <Input
                      id="pveTimeoutMs"
                      type="number"
                      value={String(pveTimeoutMs)}
                      onChange={(e) => setPveTimeoutMs(Number(e.target.value))}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="pveScope">scope</Label>
                    <NativeSelect
                      id="pveScope"
                      value={pveScope}
                      onChange={(e) => setPveScope(e.target.value as typeof pveScope)}
                    >
                      <option value="auto">auto（默认）</option>
                      <option value="standalone">standalone</option>
                      <option value="cluster">cluster</option>
                    </NativeSelect>
                    <div className="text-xs text-muted-foreground">说明：auto 会在 detect 阶段探测并给出建议。</div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="pveMaxParallelNodes">max_parallel_nodes</Label>
                    <Input
                      id="pveMaxParallelNodes"
                      type="number"
                      value={String(pveMaxParallelNodes)}
                      onChange={(e) => setPveMaxParallelNodes(Number(e.target.value))}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="pveAuthType">auth_type</Label>
                    <NativeSelect
                      id="pveAuthType"
                      value={pveAuthType}
                      onChange={(e) => setPveAuthType(e.target.value as typeof pveAuthType)}
                    >
                      <option value="api_token">api_token（推荐）</option>
                      <option value="user_password">user_password</option>
                    </NativeSelect>
                    <div className="text-xs text-muted-foreground">说明：该字段用于指导凭据结构（credential）。</div>
                  </div>
                </div>
              ) : null}
              {sourceType === 'hyperv' ? (
                <div className="space-y-3 rounded-md border bg-background p-3">
                  <div className="text-sm font-medium">Hyper-V 配置</div>

                  <div className="space-y-2">
                    <Label htmlFor="hypervConnectionMethod">connection_method</Label>
                    <NativeSelect
                      id="hypervConnectionMethod"
                      value={hypervConnectionMethod}
                      onChange={(e) => setHypervConnectionMethod(e.target.value as typeof hypervConnectionMethod)}
                    >
                      <option value="agent">agent（推荐：域内 gMSA）</option>
                      <option value="winrm">winrm（legacy）</option>
                    </NativeSelect>
                    <div className="text-xs text-muted-foreground">
                      说明：agent 模式下由 Windows Agent 在域内完成 Kerberos/Negotiate（HTTP 仍可消息级加密）。
                    </div>
                  </div>

                  {hypervConnectionMethod === 'agent' ? (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="hypervAgentUrl">agent_url</Label>
                        <Input
                          id="hypervAgentUrl"
                          value={hypervAgentUrl}
                          onChange={(e) => setHypervAgentUrl(e.target.value)}
                        />
                        <div className="text-xs text-muted-foreground">示例：http://hyperv-agent01:8787</div>
                      </div>

                      <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
                        <div className="text-sm">
                          <div className="font-medium">TLS 校验</div>
                          <div className="text-xs text-muted-foreground">
                            仅 https 生效；关闭仅用于自签名/内网环境（有安全风险）
                          </div>
                        </div>
                        <Switch checked={hypervAgentTlsVerify} onCheckedChange={setHypervAgentTlsVerify} />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="hypervAgentTimeoutMs">agent_timeout_ms</Label>
                        <Input
                          id="hypervAgentTimeoutMs"
                          type="number"
                          value={String(hypervAgentTimeoutMs)}
                          onChange={(e) => setHypervAgentTimeoutMs(Number(e.target.value))}
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="hypervAuthMethod">auth_method</Label>
                        <NativeSelect
                          id="hypervAuthMethod"
                          value={hypervAuthMethod}
                          onChange={(e) => setHypervAuthMethod(e.target.value as typeof hypervAuthMethod)}
                        >
                          <option value="auto">auto（默认：优先 Kerberos）</option>
                          <option value="kerberos">kerberos（强制）</option>
                          <option value="ntlm">ntlm（legacy）</option>
                          <option value="basic">basic（legacy）</option>
                        </NativeSelect>
                        <div className="text-xs text-muted-foreground">
                          说明：默认 WinRM 通常禁用 basic，建议使用 auto/kerberos；如填写了 domain，auto 会优先
                          Kerberos。
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="hypervScheme">scheme</Label>
                        <NativeSelect
                          id="hypervScheme"
                          value={hypervScheme}
                          onChange={(e) => {
                            const next = e.target.value as typeof hypervScheme;
                            setHypervScheme(next);
                            // Keep a sensible default when user hasn't changed port yet.
                            if (hypervPort === 5986 && next === 'http') setHypervPort(5985);
                            if (hypervPort === 5985 && next === 'https') setHypervPort(5986);
                          }}
                        >
                          <option value="http">http</option>
                          <option value="https">https</option>
                        </NativeSelect>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="hypervPort">port</Label>
                        <Input
                          id="hypervPort"
                          type="number"
                          value={String(hypervPort)}
                          onChange={(e) => setHypervPort(Number(e.target.value))}
                        />
                        <div className="text-xs text-muted-foreground">默认：https=5986；http=5985</div>
                      </div>

                      <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
                        <div className="text-sm">
                          <div className="font-medium">TLS 校验</div>
                          <div className="text-xs text-muted-foreground">关闭仅用于自签名/内网环境（有安全风险）</div>
                        </div>
                        <Switch checked={hypervTlsVerify} onCheckedChange={setHypervTlsVerify} />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="hypervTimeoutMs">timeout_ms</Label>
                        <Input
                          id="hypervTimeoutMs"
                          type="number"
                          value={String(hypervTimeoutMs)}
                          onChange={(e) => setHypervTimeoutMs(Number(e.target.value))}
                        />
                      </div>
                    </>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="hypervScope">scope</Label>
                    <NativeSelect
                      id="hypervScope"
                      value={hypervScope}
                      onChange={(e) => setHypervScope(e.target.value as typeof hypervScope)}
                    >
                      <option value="auto">auto（默认）</option>
                      <option value="standalone">standalone</option>
                      <option value="cluster">cluster</option>
                    </NativeSelect>
                    <div className="text-xs text-muted-foreground">说明：auto 会在 detect 阶段探测并给出建议。</div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="hypervMaxParallelNodes">max_parallel_nodes</Label>
                    <Input
                      id="hypervMaxParallelNodes"
                      type="number"
                      value={String(hypervMaxParallelNodes)}
                      onChange={(e) => setHypervMaxParallelNodes(Number(e.target.value))}
                    />
                  </div>
                </div>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="credentialId">选择凭据</Label>
                <NativeSelect id="credentialId" value={credentialId} onChange={(e) => setCredentialId(e.target.value)}>
                  <option value="">不选择</option>
                  {credentials.map((c) => (
                    <option key={c.credentialId} value={c.credentialId}>
                      {c.name} · {compactId(c.credentialId)}
                    </option>
                  ))}
                </NativeSelect>
                {enabled && !credentialId ? (
                  <div className="text-sm text-destructive">未配置凭据，无法参与运行/调度。</div>
                ) : null}
              </div>
              <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
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
    </>
  );
}
