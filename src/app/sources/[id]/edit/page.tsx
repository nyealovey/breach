'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { RequireAdminClient } from '@/components/auth/require-admin-client';
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
  scheduleGroupId: string | null;
  scheduleGroupName: string | null;
  credential: { credentialId: string; name: string; type: string } | null;
  config?: {
    endpoint?: string;
    preferred_vcenter_version?: string;
    tls_verify?: boolean;
    timeout_ms?: number;
    scope?: 'auto' | 'standalone' | 'cluster';
    max_parallel_nodes?: number;
    auth_type?: 'api_token' | 'user_password';
    scheme?: 'https' | 'http';
    port?: number;
  };
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
  const [preferredVcenterVersion, setPreferredVcenterVersion] = useState<'6.5-6.7' | '7.0-8.x'>('7.0-8.x');
  const [pveTlsVerify, setPveTlsVerify] = useState(true);
  const [pveTimeoutMs, setPveTimeoutMs] = useState(60_000);
  const [pveScope, setPveScope] = useState<'auto' | 'standalone' | 'cluster'>('auto');
  const [pveMaxParallelNodes, setPveMaxParallelNodes] = useState(5);
  const [pveAuthType, setPveAuthType] = useState<'api_token' | 'user_password'>('api_token');
  const [hypervScheme, setHypervScheme] = useState<'https' | 'http'>('https');
  const [hypervPort, setHypervPort] = useState(5986);
  const [hypervTlsVerify, setHypervTlsVerify] = useState(true);
  const [hypervTimeoutMs, setHypervTimeoutMs] = useState(60_000);
  const [hypervScope, setHypervScope] = useState<'auto' | 'standalone' | 'cluster'>('auto');
  const [hypervMaxParallelNodes, setHypervMaxParallelNodes] = useState(5);
  const [enabled, setEnabled] = useState(true);
  const [scheduleGroupId, setScheduleGroupId] = useState<string | null>(null);
  const [scheduleGroupName, setScheduleGroupName] = useState<string | null>(null);
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
          if (source.sourceType === 'vcenter') {
            setPreferredVcenterVersion(source.config?.preferred_vcenter_version === '6.5-6.7' ? '6.5-6.7' : '7.0-8.x');
          }
          if (source.sourceType === 'pve') {
            setPveTlsVerify(source.config?.tls_verify ?? true);
            setPveTimeoutMs(
              typeof source.config?.timeout_ms === 'number' && Number.isFinite(source.config.timeout_ms)
                ? source.config.timeout_ms
                : 60_000,
            );
            setPveScope(source.config?.scope ?? 'auto');
            setPveMaxParallelNodes(
              typeof source.config?.max_parallel_nodes === 'number' && Number.isFinite(source.config.max_parallel_nodes)
                ? source.config.max_parallel_nodes
                : 5,
            );
            setPveAuthType(source.config?.auth_type ?? 'api_token');
          }
          if (source.sourceType === 'hyperv') {
            const scheme = source.config?.scheme === 'http' ? 'http' : 'https';
            setHypervScheme(scheme);
            setHypervPort(
              typeof source.config?.port === 'number' && Number.isFinite(source.config.port)
                ? source.config.port
                : scheme === 'https'
                  ? 5986
                  : 5985,
            );
            setHypervTlsVerify(source.config?.tls_verify ?? true);
            setHypervTimeoutMs(
              typeof source.config?.timeout_ms === 'number' && Number.isFinite(source.config.timeout_ms)
                ? source.config.timeout_ms
                : 60_000,
            );
            setHypervScope(source.config?.scope ?? 'auto');
            setHypervMaxParallelNodes(
              typeof source.config?.max_parallel_nodes === 'number' && Number.isFinite(source.config.max_parallel_nodes)
                ? source.config.max_parallel_nodes
                : 5,
            );
          }
          setEnabled(source.enabled);
          setScheduleGroupId(source.scheduleGroupId ?? null);
          setScheduleGroupName(source.scheduleGroupName ?? null);
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
          config: {
            endpoint,
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
              ? {
                  connection_method: 'winrm',
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
              <div className="rounded border bg-muted/30 p-3 text-xs text-muted-foreground">
                <div>
                  sourceId: <span className="font-mono">{params.id}</span>
                </div>
                <div>
                  scheduleGroup:{' '}
                  {scheduleGroupId ? (
                    <>
                      <span>{scheduleGroupName ?? '-'}</span> <span className="font-mono">({scheduleGroupId})</span>
                    </>
                  ) : (
                    '-'
                  )}
                </div>
                <div>credentialId: {credentialId ? <span className="font-mono">{credentialId}</span> : '-'}</div>
              </div>
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
                    setPreferredVcenterVersion('7.0-8.x');
                    setPveTlsVerify(true);
                    setPveTimeoutMs(60_000);
                    setPveScope('auto');
                    setPveMaxParallelNodes(5);
                    setPveAuthType('api_token');
                    setHypervScheme('https');
                    setHypervPort(5986);
                    setHypervTlsVerify(true);
                    setHypervTimeoutMs(60_000);
                    setHypervScope('auto');
                    setHypervMaxParallelNodes(5);
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
              {sourceType === 'vcenter' ? (
                <div className="space-y-2">
                  <Label htmlFor="preferredVcenterVersion">vCenter 版本范围</Label>
                  <select
                    id="preferredVcenterVersion"
                    className="h-9 w-full rounded border border-input bg-background px-3 text-sm"
                    value={preferredVcenterVersion}
                    onChange={(e) => setPreferredVcenterVersion(e.target.value as typeof preferredVcenterVersion)}
                  >
                    <option value="7.0-8.x">7.0-8.x（默认）</option>
                    <option value="6.5-6.7">6.5-6.7</option>
                  </select>
                  <div className="text-xs text-muted-foreground">
                    说明：该字段用于选择采集 driver；detect 会给出建议，但不会自动改写配置。
                  </div>
                </div>
              ) : null}
              {sourceType === 'pve' ? (
                <div className="space-y-3 rounded border p-3">
                  <div className="text-sm font-medium">PVE 配置</div>

                  <div className="flex items-center justify-between rounded border px-3 py-2">
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
                    <select
                      id="pveScope"
                      className="h-9 w-full rounded border border-input bg-background px-3 text-sm"
                      value={pveScope}
                      onChange={(e) => setPveScope(e.target.value as typeof pveScope)}
                    >
                      <option value="auto">auto（默认）</option>
                      <option value="standalone">standalone</option>
                      <option value="cluster">cluster</option>
                    </select>
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
                    <select
                      id="pveAuthType"
                      className="h-9 w-full rounded border border-input bg-background px-3 text-sm"
                      value={pveAuthType}
                      onChange={(e) => setPveAuthType(e.target.value as typeof pveAuthType)}
                    >
                      <option value="api_token">api_token（推荐）</option>
                      <option value="user_password">user_password</option>
                    </select>
                    <div className="text-xs text-muted-foreground">说明：该字段用于指导凭据结构（credential）。</div>
                  </div>
                </div>
              ) : null}
              {sourceType === 'hyperv' ? (
                <div className="space-y-3 rounded border p-3">
                  <div className="text-sm font-medium">Hyper-V 配置（WinRM）</div>

                  <div className="space-y-2">
                    <Label htmlFor="hypervScheme">scheme</Label>
                    <select
                      id="hypervScheme"
                      className="h-9 w-full rounded border border-input bg-background px-3 text-sm"
                      value={hypervScheme}
                      onChange={(e) => {
                        const next = e.target.value as typeof hypervScheme;
                        setHypervScheme(next);
                        if (hypervPort === 5986 && next === 'http') setHypervPort(5985);
                        if (hypervPort === 5985 && next === 'https') setHypervPort(5986);
                      }}
                    >
                      <option value="https">https（默认）</option>
                      <option value="http">http</option>
                    </select>
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

                  <div className="flex items-center justify-between rounded border px-3 py-2">
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

                  <div className="space-y-2">
                    <Label htmlFor="hypervScope">scope</Label>
                    <select
                      id="hypervScope"
                      className="h-9 w-full rounded border border-input bg-background px-3 text-sm"
                      value={hypervScope}
                      onChange={(e) => setHypervScope(e.target.value as typeof hypervScope)}
                    >
                      <option value="auto">auto（默认）</option>
                      <option value="standalone">standalone</option>
                      <option value="cluster">cluster</option>
                    </select>
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
                <select
                  id="credentialId"
                  className="h-9 w-full rounded border border-input bg-background px-3 text-sm"
                  value={credentialId}
                  onChange={(e) => setCredentialId(e.target.value)}
                >
                  <option value="">不选择</option>
                  {credentials.map((c) => (
                    <option key={c.credentialId} value={c.credentialId}>
                      {c.name} · {c.credentialId}
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
    </>
  );
}
