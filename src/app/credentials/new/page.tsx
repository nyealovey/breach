'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { RequireAdminClient } from '@/components/auth/require-admin-client';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';

import type { FormEvent } from 'react';

type CredentialType = 'vcenter' | 'pve' | 'hyperv' | 'aliyun' | 'third_party';

export default function NewCredentialPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [type, setType] = useState<CredentialType>('vcenter');

  const [pveAuthType, setPveAuthType] = useState<'api_token' | 'user_password'>('api_token');
  const [hypervAuth, setHypervAuth] = useState<'winrm' | 'agent'>('winrm');
  const [domain, setDomain] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [hypervAgentToken, setHypervAgentToken] = useState('');
  const [apiTokenId, setApiTokenId] = useState('');
  const [apiTokenSecret, setApiTokenSecret] = useState('');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [accessKeySecret, setAccessKeySecret] = useState('');
  const [token, setToken] = useState('');

  const [submitting, setSubmitting] = useState(false);

  const payload = useMemo(() => {
    if (type === 'aliyun') return { accessKeyId, accessKeySecret };
    if (type === 'third_party') return { token };
    if (type === 'pve') {
      return pveAuthType === 'api_token'
        ? { auth_type: 'api_token', api_token_id: apiTokenId, api_token_secret: apiTokenSecret }
        : { auth_type: 'user_password', username, password };
    }
    if (type === 'hyperv') {
      return hypervAuth === 'agent'
        ? { auth: 'agent', token: hypervAgentToken }
        : { auth: 'winrm', ...(domain.trim() ? { domain: domain.trim() } : {}), username, password };
    }
    return { username, password };
  }, [
    accessKeyId,
    accessKeySecret,
    apiTokenId,
    apiTokenSecret,
    domain,
    hypervAgentToken,
    hypervAuth,
    password,
    pveAuthType,
    token,
    type,
    username,
  ]);

  const validate = () => {
    if (!name.trim()) return '请输入名称';
    if (type === 'aliyun' && (!accessKeyId.trim() || !accessKeySecret.trim()))
      return '请填写 accessKeyId/accessKeySecret';
    if (type === 'third_party' && !token.trim()) return '请填写 token';
    if (type === 'pve') {
      if (pveAuthType === 'api_token' && (!apiTokenId.trim() || !apiTokenSecret.trim()))
        return '请填写 api_token_id/api_token_secret';
      if (pveAuthType === 'user_password' && (!username.trim() || !password.trim())) return '请填写用户名/密码';
      return null;
    }
    if (type === 'hyperv') {
      if (hypervAuth === 'agent' && !hypervAgentToken.trim()) return '请填写 agent token';
      if (hypervAuth === 'winrm' && (!username.trim() || !password.trim())) return '请填写用户名/密码';
      return null;
    }
    if (type === 'vcenter' && (!username.trim() || !password.trim())) return '请填写用户名/密码';
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
      const res = await fetch('/api/v1/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type, payload }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        toast.error(body?.error?.message ?? '创建失败');
        return;
      }
      toast.success('凭据已创建');
      router.push('/credentials');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <RequireAdminClient />
      <div className="mx-auto w-full max-w-xl space-y-6">
        <PageHeader
          title="新建凭据"
          description="配置采集凭据（可被多个来源引用）。"
          actions={
            <Button asChild size="sm" variant="outline">
              <Link href="/credentials">返回列表</Link>
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
                <Label htmlFor="type">类型</Label>
                <NativeSelect
                  id="type"
                  value={type}
                  onChange={(e) => {
                    const next = e.target.value as CredentialType;
                    setType(next);
                    if (next === 'pve') setPveAuthType('api_token');
                    if (next === 'hyperv') setHypervAuth('winrm');
                  }}
                >
                  <option value="vcenter">vCenter</option>
                  <option value="pve">PVE</option>
                  <option value="hyperv">Hyper-V</option>
                  <option value="aliyun">阿里云</option>
                  <option value="third_party">第三方</option>
                </NativeSelect>
              </div>

              {(type === 'vcenter' || type === 'hyperv') && (
                <>
                  {type === 'hyperv' ? (
                    <div className="space-y-2">
                      <Label htmlFor="hypervAuth">凭据类型</Label>
                      <NativeSelect
                        id="hypervAuth"
                        value={hypervAuth}
                        onChange={(e) => setHypervAuth(e.target.value as typeof hypervAuth)}
                      >
                        <option value="winrm">WinRM（username/password）</option>
                        <option value="agent">Agent（Bearer token）</option>
                      </NativeSelect>
                      <div className="text-xs text-muted-foreground">
                        说明：域内推荐使用 Agent + gMSA；token 将通过 Authorization: Bearer 发送给 Windows Agent。
                      </div>
                    </div>
                  ) : null}

                  {type === 'hyperv' && hypervAuth === 'agent' ? (
                    <div className="space-y-2">
                      <Label htmlFor="hypervAgentToken">token</Label>
                      <Input
                        id="hypervAgentToken"
                        type="password"
                        value={hypervAgentToken}
                        onChange={(e) => setHypervAgentToken(e.target.value)}
                      />
                    </div>
                  ) : (
                    <>
                      {type === 'hyperv' ? (
                        <div className="space-y-2">
                          <Label htmlFor="domain">域（可选）</Label>
                          <Input id="domain" value={domain} onChange={(e) => setDomain(e.target.value)} />
                          <div className="space-y-1 text-xs text-muted-foreground">
                            <div>说明：当 Source 选择 auto/kerberos 时，采集会优先使用 Kerberos（WinRM 默认）。</div>
                            <div>domain 可用于 Kerberos realm 推导。</div>
                            <div>Kerberos 失败时才会以 DOMAIN\username 走 NTLM（legacy）。</div>
                            <div>如你知道 UPN，建议直接在用户名填写 user@domain（更稳定）。</div>
                          </div>
                        </div>
                      ) : null}
                      <div className="space-y-2">
                        <Label htmlFor="username">用户名</Label>
                        <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="password">密码</Label>
                        <Input
                          id="password"
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                        />
                      </div>
                    </>
                  )}
                </>
              )}

              {type === 'pve' && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="pveAuthType">认证方式</Label>
                    <NativeSelect
                      id="pveAuthType"
                      value={pveAuthType}
                      onChange={(e) => setPveAuthType(e.target.value as typeof pveAuthType)}
                    >
                      <option value="api_token">API Token（推荐）</option>
                      <option value="user_password">用户名/密码</option>
                    </NativeSelect>
                  </div>

                  {pveAuthType === 'api_token' ? (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="apiTokenId">api_token_id</Label>
                        <Input id="apiTokenId" value={apiTokenId} onChange={(e) => setApiTokenId(e.target.value)} />
                        <div className="text-xs text-muted-foreground">示例：user@pam!tokenid</div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="apiTokenSecret">api_token_secret</Label>
                        <Input
                          id="apiTokenSecret"
                          type="password"
                          value={apiTokenSecret}
                          onChange={(e) => setApiTokenSecret(e.target.value)}
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="username">用户名</Label>
                        <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="password">密码</Label>
                        <Input
                          id="password"
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                        />
                      </div>
                    </>
                  )}
                </>
              )}

              {type === 'aliyun' && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="accessKeyId">accessKeyId</Label>
                    <Input id="accessKeyId" value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="accessKeySecret">accessKeySecret</Label>
                    <Input
                      id="accessKeySecret"
                      type="password"
                      value={accessKeySecret}
                      onChange={(e) => setAccessKeySecret(e.target.value)}
                    />
                  </div>
                </>
              )}

              {type === 'third_party' && (
                <div className="space-y-2">
                  <Label htmlFor="token">token</Label>
                  <Input id="token" type="password" value={token} onChange={(e) => setToken(e.target.value)} />
                </div>
              )}

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
