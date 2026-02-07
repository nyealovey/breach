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

type SourceDetail = {
  sourceId: string;
  name: string;
  sourceType: string;
  enabled: boolean;
  scheduleGroupId: string | null;
  scheduleGroupName: string | null;
  credential: { credentialId: string; name: string; type: string } | null;
  agent: { agentId: string; name: string; agentType: string } | null;
  config?: {
    endpoint?: string;
    connection_method?: 'winrm' | 'agent';
    agent_url?: string;
    agent_tls_verify?: boolean;
    agent_timeout_ms?: number;
    preferred_vcenter_version?: string;
    tls_verify?: boolean;
    timeout_ms?: number;
    api_version?: string;
    sessions_limit?: number;
    task_sessions_limit?: number;
    page_size?: number;
    include_unmanaged?: boolean;
    scope?: 'auto' | 'standalone' | 'cluster';
    max_parallel_nodes?: number;
    auth_type?: 'api_token' | 'user_password';
    auth_method?: 'auto' | 'kerberos' | 'ntlm' | 'basic';
    scheme?: 'https' | 'http';
    port?: number;
    purpose?: 'auth_collect' | 'collect_only' | 'auth_only';
    server_url?: string;
    base_dn?: string;
    upn_suffixes?: string[];
    user_filter?: string;
  };
};
type CredentialItem = { credentialId: string; name: string; type: string };
type AgentItem = {
  agentId: string;
  name: string;
  agentType: string;
  endpoint: string;
  enabled: boolean;
  tlsVerify: boolean;
  timeoutMs: number;
};

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
  const [veeamTlsVerify, setVeeamTlsVerify] = useState(true);
  const [veeamTimeoutMs, setVeeamTimeoutMs] = useState(60_000);
  const [veeamApiVersion, setVeeamApiVersion] = useState('1.2-rev1');
  const [veeamSessionsLimit, setVeeamSessionsLimit] = useState(200);
  const [veeamTaskSessionsLimit, setVeeamTaskSessionsLimit] = useState(2000);
  const [solarwindsTlsVerify, setSolarwindsTlsVerify] = useState(true);
  const [solarwindsTimeoutMs, setSolarwindsTimeoutMs] = useState(60_000);
  const [solarwindsPageSize, setSolarwindsPageSize] = useState(500);
  const [solarwindsIncludeUnmanaged, setSolarwindsIncludeUnmanaged] = useState(true);
  const [hypervConnectionMethod, setHypervConnectionMethod] = useState<'winrm' | 'agent'>('winrm');
  const [hypervAgentId, setHypervAgentId] = useState('');
  const [hypervAgents, setHypervAgents] = useState<AgentItem[]>([]);
  const [hypervLegacyAgentUrl, setHypervLegacyAgentUrl] = useState('');
  const [hypervLegacyAgentTlsVerify, setHypervLegacyAgentTlsVerify] = useState(true);
  const [hypervLegacyAgentTimeoutMs, setHypervLegacyAgentTimeoutMs] = useState(60_000);
  const [hypervScheme, setHypervScheme] = useState<'https' | 'http'>('http');
  const [hypervPort, setHypervPort] = useState(5985);
  const [hypervTlsVerify, setHypervTlsVerify] = useState(true);
  const [hypervTimeoutMs, setHypervTimeoutMs] = useState(60_000);
  const [hypervScope, setHypervScope] = useState<'auto' | 'standalone' | 'cluster'>('auto');
  const [hypervMaxParallelNodes, setHypervMaxParallelNodes] = useState(5);
  const [hypervAuthMethod, setHypervAuthMethod] = useState<'auto' | 'kerberos' | 'ntlm' | 'basic'>('auto');
  const [adPurpose, setAdPurpose] = useState<'auth_collect' | 'collect_only' | 'auth_only'>('auth_collect');
  const [adBaseDn, setAdBaseDn] = useState('');
  const [adUpnSuffixes, setAdUpnSuffixes] = useState('');
  const [adTlsVerify, setAdTlsVerify] = useState(true);
  const [adTimeoutMs, setAdTimeoutMs] = useState(60_000);
  const [adUserFilter, setAdUserFilter] = useState('');
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
          if (source.sourceType === 'veeam') {
            setVeeamTlsVerify(source.config?.tls_verify ?? true);
            setVeeamTimeoutMs(
              typeof source.config?.timeout_ms === 'number' && Number.isFinite(source.config.timeout_ms)
                ? source.config.timeout_ms
                : 60_000,
            );
            setVeeamApiVersion(
              typeof source.config?.api_version === 'string' && source.config.api_version.trim()
                ? source.config.api_version.trim()
                : '1.2-rev1',
            );
            setVeeamSessionsLimit(
              typeof source.config?.sessions_limit === 'number' && Number.isFinite(source.config.sessions_limit)
                ? source.config.sessions_limit
                : 200,
            );
            setVeeamTaskSessionsLimit(
              typeof source.config?.task_sessions_limit === 'number' &&
                Number.isFinite(source.config.task_sessions_limit)
                ? source.config.task_sessions_limit
                : 2000,
            );
          }
          if (source.sourceType === 'solarwinds') {
            setSolarwindsTlsVerify(source.config?.tls_verify ?? true);
            setSolarwindsTimeoutMs(
              typeof source.config?.timeout_ms === 'number' && Number.isFinite(source.config.timeout_ms)
                ? source.config.timeout_ms
                : 60_000,
            );
            setSolarwindsPageSize(
              typeof source.config?.page_size === 'number' && Number.isFinite(source.config.page_size)
                ? source.config.page_size
                : 500,
            );
            setSolarwindsIncludeUnmanaged(source.config?.include_unmanaged ?? true);
          }
          if (source.sourceType === 'hyperv') {
            const connectionMethod = source.config?.connection_method === 'agent' ? 'agent' : 'winrm';
            setHypervConnectionMethod(connectionMethod);
            if (connectionMethod === 'agent') {
              setHypervAgentId(source.agent?.agentId ?? '');
              setHypervLegacyAgentUrl(source.config?.agent_url ?? '');
              setHypervLegacyAgentTlsVerify(source.config?.agent_tls_verify ?? true);
              setHypervLegacyAgentTimeoutMs(
                typeof source.config?.agent_timeout_ms === 'number' && Number.isFinite(source.config.agent_timeout_ms)
                  ? source.config.agent_timeout_ms
                  : 60_000,
              );
            } else {
              const scheme = source.config?.scheme === 'https' ? 'https' : 'http';
              setHypervScheme(scheme);
              setHypervPort(
                typeof source.config?.port === 'number' && Number.isFinite(source.config.port)
                  ? source.config.port
                  : scheme === 'https'
                    ? 5986
                    : 5985,
              );
              setHypervAuthMethod(source.config?.auth_method ?? 'auto');
              setHypervTlsVerify(source.config?.tls_verify ?? true);
              setHypervTimeoutMs(
                typeof source.config?.timeout_ms === 'number' && Number.isFinite(source.config.timeout_ms)
                  ? source.config.timeout_ms
                  : 60_000,
              );
            }
            setHypervScope(source.config?.scope ?? 'auto');
            setHypervMaxParallelNodes(
              typeof source.config?.max_parallel_nodes === 'number' && Number.isFinite(source.config.max_parallel_nodes)
                ? source.config.max_parallel_nodes
                : 5,
            );
          }
          if (source.sourceType === 'activedirectory') {
            setAdPurpose(source.config?.purpose ?? 'auth_collect');
            setAdBaseDn(source.config?.base_dn ?? '');
            setAdUpnSuffixes(Array.isArray(source.config?.upn_suffixes) ? source.config.upn_suffixes.join(',') : '');
            setAdTlsVerify(source.config?.tls_verify ?? true);
            setAdTimeoutMs(
              typeof source.config?.timeout_ms === 'number' && Number.isFinite(source.config.timeout_ms)
                ? source.config.timeout_ms
                : 60_000,
            );
            setAdUserFilter(source.config?.user_filter ?? '');
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

  useEffect(() => {
    if (sourceType !== 'hyperv' || hypervConnectionMethod !== 'agent') {
      setHypervAgents([]);
      return;
    }

    let active = true;
    const loadAgents = async () => {
      const res = await fetch('/api/v1/agents?agentType=hyperv&pageSize=100');
      if (!res.ok) {
        if (active) setHypervAgents([]);
        return;
      }
      const body = (await res.json()) as { data: AgentItem[] };
      if (!active) return;
      const next = body.data ?? [];
      setHypervAgents(next);
      if (!hypervAgentId && next.filter((a) => a.enabled).length === 1) {
        const onlyEnabled = next.find((a) => a.enabled);
        if (onlyEnabled) setHypervAgentId(onlyEnabled.agentId);
      }
    };
    void loadAgents();
    return () => {
      active = false;
    };
  }, [hypervConnectionMethod, hypervAgentId, sourceType]);

  const parseAdSuffixes = () =>
    Array.from(
      new Set(
        adUpnSuffixes
          .split(',')
          .map((item) => item.trim().toLowerCase().replace(/^@/, ''))
          .filter((item) => item.length > 0),
      ),
    );

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    if (sourceType === 'veeam' && !endpoint.trim()) {
      toast.error('请填写 endpoint');
      return;
    }
    if (sourceType === 'hyperv' && !endpoint.trim()) {
      toast.error('请填写 endpoint');
      return;
    }
    if (
      sourceType === 'hyperv' &&
      hypervConnectionMethod === 'agent' &&
      !hypervAgentId &&
      !hypervLegacyAgentUrl.trim()
    ) {
      toast.error('请选择代理');
      return;
    }
    if (sourceType === 'activedirectory' && !adBaseDn.trim()) {
      toast.error('请填写 base_dn');
      return;
    }
    if (sourceType === 'activedirectory' && (adPurpose === 'auth_collect' || adPurpose === 'auth_only')) {
      if (parseAdSuffixes().length === 0) {
        toast.error('认证用途的 AD Source 需要 upn_suffixes');
        return;
      }
      if (!credentialId) {
        toast.error('认证用途的 AD Source 必须绑定凭据');
        return;
      }
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/sources/${params.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          sourceType,
          role: sourceType === 'solarwinds' || sourceType === 'veeam' ? 'signal' : 'inventory',
          enabled,
          agentId:
            sourceType === 'hyperv' && hypervConnectionMethod === 'agent' && hypervAgentId ? hypervAgentId : null,
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
            ...(sourceType === 'veeam'
              ? {
                  tls_verify: veeamTlsVerify,
                  timeout_ms: veeamTimeoutMs,
                  api_version: veeamApiVersion.trim(),
                  sessions_limit: veeamSessionsLimit,
                  task_sessions_limit: veeamTaskSessionsLimit,
                }
              : {}),
            ...(sourceType === 'solarwinds'
              ? {
                  tls_verify: solarwindsTlsVerify,
                  timeout_ms: solarwindsTimeoutMs,
                  page_size: solarwindsPageSize,
                  include_unmanaged: solarwindsIncludeUnmanaged,
                }
              : {}),
            ...(sourceType === 'hyperv'
              ? hypervConnectionMethod === 'agent'
                ? {
                    connection_method: 'agent',
                    ...(hypervAgentId
                      ? {}
                      : {
                          agent_url: hypervLegacyAgentUrl.trim(),
                          agent_tls_verify: hypervLegacyAgentTlsVerify,
                          agent_timeout_ms: hypervLegacyAgentTimeoutMs,
                        }),
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
            ...(sourceType === 'activedirectory'
              ? {
                  purpose: adPurpose,
                  server_url: endpoint.trim(),
                  base_dn: adBaseDn.trim(),
                  upn_suffixes: parseAdSuffixes(),
                  tls_verify: adTlsVerify,
                  timeout_ms: adTimeoutMs,
                  ...(adUserFilter.trim() ? { user_filter: adUserFilter.trim() } : {}),
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
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <PageHeader
          title="编辑来源"
          meta={<IdText value={params.id} className="text-foreground" />}
          actions={
            <>
              <Button asChild size="sm" variant="outline">
                <Link href="/sources">返回列表</Link>
              </Button>
              <Button variant="destructive" size="sm" onClick={onDelete}>
                删除
              </Button>
            </>
          }
        />

        <Card>
          <CardContent className="pt-6">
            <form className="space-y-4" onSubmit={onSubmit}>
              <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                <div>
                  sourceId: <IdText value={params.id} className="text-foreground" />
                </div>
                <div>
                  scheduleGroup:{' '}
                  {scheduleGroupId ? (
                    <>
                      <span>{scheduleGroupName ?? '-'}</span>{' '}
                      <span className="font-mono" title={scheduleGroupId}>
                        (<IdText value={scheduleGroupId} className="text-foreground" />)
                      </span>
                    </>
                  ) : (
                    '-'
                  )}
                </div>
                <div>
                  credentialId: {credentialId ? <IdText value={credentialId} className="text-foreground" /> : '-'}
                </div>
              </div>
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
                    setVeeamTlsVerify(true);
                    setVeeamTimeoutMs(60_000);
                    setVeeamApiVersion('1.2-rev1');
                    setVeeamSessionsLimit(200);
                    setVeeamTaskSessionsLimit(2000);
                    setSolarwindsTlsVerify(true);
                    setSolarwindsTimeoutMs(60_000);
                    setSolarwindsPageSize(500);
                    setSolarwindsIncludeUnmanaged(true);
                    setHypervConnectionMethod('winrm');
                    setHypervAgentId('');
                    setHypervAgents([]);
                    setHypervLegacyAgentUrl('');
                    setHypervLegacyAgentTlsVerify(true);
                    setHypervLegacyAgentTimeoutMs(60_000);
                    setHypervScheme('http');
                    setHypervPort(5985);
                    setHypervTlsVerify(true);
                    setHypervTimeoutMs(60_000);
                    setHypervScope('auto');
                    setHypervMaxParallelNodes(5);
                    setHypervAuthMethod('auto');
                    setAdPurpose('auth_collect');
                    setAdBaseDn('');
                    setAdUpnSuffixes('');
                    setAdTlsVerify(true);
                    setAdTimeoutMs(60_000);
                    setAdUserFilter('');
                  }}
                >
                  <option value="vcenter">vCenter</option>
                  <option value="solarwinds">SolarWinds（Orion）</option>
                  <option value="veeam">Veeam（VBR）</option>
                  <option value="pve">PVE</option>
                  <option value="hyperv">Hyper-V</option>
                  <option value="activedirectory">Active Directory</option>
                  <option value="aliyun">阿里云</option>
                  <option value="third_party">第三方</option>
                </NativeSelect>
              </div>
              <div className="space-y-2">
                <Label htmlFor="endpoint">{sourceType === 'activedirectory' ? 'LDAP Server URL' : 'Endpoint'}</Label>
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
              {sourceType === 'activedirectory' ? (
                <div className="space-y-3 rounded-md border bg-background p-3">
                  <div className="text-sm font-medium">Active Directory 配置</div>

                  <div className="space-y-2">
                    <Label htmlFor="adPurpose">用途</Label>
                    <NativeSelect
                      id="adPurpose"
                      value={adPurpose}
                      onChange={(e) => setAdPurpose(e.target.value as typeof adPurpose)}
                    >
                      <option value="auth_collect">认证 + 采集</option>
                      <option value="collect_only">仅采集</option>
                      <option value="auth_only">仅认证</option>
                    </NativeSelect>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="adBaseDn">base_dn</Label>
                    <Input id="adBaseDn" value={adBaseDn} onChange={(e) => setAdBaseDn(e.target.value)} />
                    <div className="text-xs text-muted-foreground">示例：DC=example,DC=com</div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="adUpnSuffixes">upn_suffixes（逗号分隔）</Label>
                    <Input
                      id="adUpnSuffixes"
                      value={adUpnSuffixes}
                      onChange={(e) => setAdUpnSuffixes(e.target.value)}
                      placeholder="example.com,sub.example.com"
                    />
                    <div className="text-xs text-muted-foreground">
                      仅认证用途（auth_collect/auth_only）必填，用于多域 UPN 路由。
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="adUserFilter">user_filter（可选）</Label>
                    <Input
                      id="adUserFilter"
                      value={adUserFilter}
                      onChange={(e) => setAdUserFilter(e.target.value)}
                      placeholder="(memberOf=CN=AssetUsers,OU=Groups,DC=example,DC=com)"
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
                    <div className="text-sm">
                      <div className="font-medium">TLS 校验</div>
                      <div className="text-xs text-muted-foreground">建议生产环境开启</div>
                    </div>
                    <Switch checked={adTlsVerify} onCheckedChange={setAdTlsVerify} />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="adTimeoutMs">timeout_ms</Label>
                    <Input
                      id="adTimeoutMs"
                      type="number"
                      value={String(adTimeoutMs)}
                      onChange={(e) => setAdTimeoutMs(Number(e.target.value))}
                    />
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
              {sourceType === 'veeam' ? (
                <div className="space-y-3 rounded-md border bg-background p-3">
                  <div className="text-sm font-medium">Veeam（VBR）配置</div>

                  <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
                    <div className="text-sm">
                      <div className="font-medium">TLS 校验</div>
                      <div className="text-xs text-muted-foreground">关闭仅用于自签名/内网环境（有安全风险）</div>
                    </div>
                    <Switch checked={veeamTlsVerify} onCheckedChange={setVeeamTlsVerify} />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="veeamTimeoutMs">timeout_ms</Label>
                    <Input
                      id="veeamTimeoutMs"
                      type="number"
                      value={String(veeamTimeoutMs)}
                      onChange={(e) => setVeeamTimeoutMs(Number(e.target.value))}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="veeamApiVersion">x-api-version</Label>
                    <Input
                      id="veeamApiVersion"
                      value={veeamApiVersion}
                      onChange={(e) => setVeeamApiVersion(e.target.value)}
                    />
                    <div className="text-xs text-muted-foreground">
                      示例：1.2-rev1（VBR 12 常见）或 1.3-rev1（VBR 13）。
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="veeamSessionsLimit">sessions_limit</Label>
                    <Input
                      id="veeamSessionsLimit"
                      type="number"
                      value={String(veeamSessionsLimit)}
                      onChange={(e) => setVeeamSessionsLimit(Number(e.target.value))}
                    />
                    <div className="text-xs text-muted-foreground">说明：拉取最近 N 个 Sessions（越大越慢）。</div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="veeamTaskSessionsLimit">task_sessions_limit</Label>
                    <Input
                      id="veeamTaskSessionsLimit"
                      type="number"
                      value={String(veeamTaskSessionsLimit)}
                      onChange={(e) => setVeeamTaskSessionsLimit(Number(e.target.value))}
                    />
                    <div className="text-xs text-muted-foreground">
                      说明：单个 Session 下最多拉取 N 个 TaskSessions（避免大作业导致超时/爆量）。
                    </div>
                  </div>
                </div>
              ) : null}
              {sourceType === 'solarwinds' ? (
                <div className="space-y-3 rounded-md border bg-background p-3">
                  <div className="text-sm font-medium">SolarWinds 配置</div>

                  <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
                    <div className="text-sm">
                      <div className="font-medium">TLS 校验</div>
                      <div className="text-xs text-muted-foreground">关闭仅用于自签名/内网环境（有安全风险）</div>
                    </div>
                    <Switch checked={solarwindsTlsVerify} onCheckedChange={setSolarwindsTlsVerify} />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="solarwindsTimeoutMs">timeout_ms</Label>
                    <Input
                      id="solarwindsTimeoutMs"
                      type="number"
                      value={String(solarwindsTimeoutMs)}
                      onChange={(e) => setSolarwindsTimeoutMs(Number(e.target.value))}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="solarwindsPageSize">page_size</Label>
                    <Input
                      id="solarwindsPageSize"
                      type="number"
                      value={String(solarwindsPageSize)}
                      onChange={(e) => setSolarwindsPageSize(Number(e.target.value))}
                    />
                    <div className="text-xs text-muted-foreground">说明：分页大小，过大会增加 SWIS 压力。</div>
                  </div>

                  <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
                    <div className="text-sm">
                      <div className="font-medium">include_unmanaged</div>
                      <div className="text-xs text-muted-foreground">unmanaged 节点也计入“已纳入监控”。</div>
                    </div>
                    <Switch checked={solarwindsIncludeUnmanaged} onCheckedChange={setSolarwindsIncludeUnmanaged} />
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
                        <Label htmlFor="hypervAgentId">代理</Label>
                        <NativeSelect
                          id="hypervAgentId"
                          value={hypervAgentId}
                          onChange={(e) => setHypervAgentId(e.target.value)}
                        >
                          <option value="">请选择代理</option>
                          {hypervAgents.map((a) => (
                            <option key={a.agentId} value={a.agentId} disabled={!a.enabled}>
                              {a.enabled ? '' : '【停用】'}
                              {a.name} · {a.endpoint}
                            </option>
                          ))}
                        </NativeSelect>
                        <div className="text-xs text-muted-foreground">
                          说明：代理用于解决域内认证；endpoint 仍填写目标 Hyper-V 主机/集群。
                          <span className="ml-2">
                            <Link className="underline" href="/agents">
                              管理代理
                            </Link>
                          </span>
                        </div>
                      </div>

                      {!hypervAgentId && hypervLegacyAgentUrl.trim() ? (
                        <div className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
                          当前来源仍在使用 legacy agent_url：
                          <span className="ml-1 font-mono">{hypervLegacyAgentUrl}</span>
                          。建议在配置中心创建代理并选择，以便统一管理。
                        </div>
                      ) : null}
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
                      {c.name}
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
