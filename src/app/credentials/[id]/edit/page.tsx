'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { RequireAdminClient } from '@/components/auth/require-admin-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

import type { FormEvent } from 'react';

type CredentialType = 'vcenter' | 'pve' | 'hyperv' | 'aliyun' | 'third_party';

type CredentialDetail = {
  credentialId: string;
  name: string;
  type: CredentialType;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
};

export default function EditCredentialPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState('');
  const [type, setType] = useState<CredentialType>('vcenter');
  const [usageCount, setUsageCount] = useState(0);

  const [updateSecret, setUpdateSecret] = useState(false);
  const [pveAuthType, setPveAuthType] = useState<'api_token' | 'user_password'>('api_token');
  const [domain, setDomain] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [apiTokenId, setApiTokenId] = useState('');
  const [apiTokenSecret, setApiTokenSecret] = useState('');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [accessKeySecret, setAccessKeySecret] = useState('');
  const [token, setToken] = useState('');

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      const res = await fetch(`/api/v1/credentials/${params.id}`);
      if (!res.ok) {
        toast.error('加载失败');
        if (active) setLoading(false);
        return;
      }
      const body = (await res.json()) as { data: CredentialDetail };
      const c = body.data;
      if (active) {
        setName(c.name);
        setType(c.type);
        setUsageCount(c.usageCount);
        setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [params.id]);

  const payload = useMemo(() => {
    if (type === 'aliyun') return { accessKeyId, accessKeySecret };
    if (type === 'third_party') return { token };
    if (type === 'pve') {
      return pveAuthType === 'api_token'
        ? { auth_type: 'api_token', api_token_id: apiTokenId, api_token_secret: apiTokenSecret }
        : { auth_type: 'user_password', username, password };
    }
    if (type === 'hyperv') return { ...(domain.trim() ? { domain: domain.trim() } : {}), username, password };
    return { username, password };
  }, [accessKeyId, accessKeySecret, apiTokenId, apiTokenSecret, domain, password, pveAuthType, token, type, username]);

  const validate = () => {
    if (!name.trim()) return '请输入名称';
    if (!updateSecret) return null;

    if (type === 'aliyun' && (!accessKeyId.trim() || !accessKeySecret.trim()))
      return '请填写 accessKeyId/accessKeySecret';
    if (type === 'third_party' && !token.trim()) return '请填写 token';
    if (type === 'pve') {
      if (pveAuthType === 'api_token' && (!apiTokenId.trim() || !apiTokenSecret.trim()))
        return '请填写 api_token_id/api_token_secret';
      if (pveAuthType === 'user_password' && (!username.trim() || !password.trim())) return '请填写用户名/密码';
      return null;
    }
    if ((type === 'vcenter' || type === 'hyperv') && (!username.trim() || !password.trim())) return '请填写用户名/密码';

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
      const body = updateSecret ? { name, payload } : { name };
      const res = await fetch(`/api/v1/credentials/${params.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const r = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        toast.error(r?.error?.message ?? '更新失败');
        return;
      }
      toast.success('凭据已更新');
      router.push('/credentials');
    } finally {
      setSubmitting(false);
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
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>编辑凭据</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label htmlFor="credentialId">Credential ID</Label>
              <Input id="credentialId" value={params.id} disabled className="font-mono" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">名称</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="type">类型</Label>
              <Input id="type" value={type} disabled />
              <div className="text-xs text-muted-foreground">类型创建后不可修改。</div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="usageCount">引用数</Label>
              <Input id="usageCount" value={String(usageCount)} disabled />
              <div className="text-xs text-muted-foreground">引用数不为 0 时禁止删除（可在列表页删除）。</div>
            </div>

            <div className="flex items-center justify-between rounded border px-3 py-2">
              <div className="text-sm">
                <div className="font-medium">更新密钥/密码</div>
                <div className="text-xs text-muted-foreground">开启后需要重新输入 secret，旧值不会回显。</div>
              </div>
              <Switch checked={updateSecret} onCheckedChange={setUpdateSecret} />
            </div>

            {updateSecret && (type === 'vcenter' || type === 'hyperv') && (
              <>
                {type === 'hyperv' ? (
                  <div className="space-y-2">
                    <Label htmlFor="domain">域（可选）</Label>
                    <Input id="domain" value={domain} onChange={(e) => setDomain(e.target.value)} />
                    <div className="text-xs text-muted-foreground">
                      填写后会以 DOMAIN\username 的形式进行认证（触发 NTLM）。
                    </div>
                  </div>
                ) : null}
                <div className="space-y-2">
                  <Label htmlFor="username">用户名</Label>
                  <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">密码</Label>
                  <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
              </>
            )}

            {updateSecret && type === 'pve' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="pveAuthType">认证方式</Label>
                  <select
                    id="pveAuthType"
                    className="h-9 w-full rounded border border-input bg-background px-3 text-sm"
                    value={pveAuthType}
                    onChange={(e) => setPveAuthType(e.target.value as typeof pveAuthType)}
                  >
                    <option value="api_token">API Token（推荐）</option>
                    <option value="user_password">用户名/密码</option>
                  </select>
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

            {updateSecret && type === 'aliyun' && (
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

            {updateSecret && type === 'third_party' && (
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
    </>
  );
}
