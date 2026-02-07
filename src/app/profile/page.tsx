'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import type { FormEvent } from 'react';

type CurrentUser = {
  userId: string;
  username: string;
  role: 'admin' | 'user';
  authType: 'local' | 'ldap';
};

export default function ProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      const res = await fetch('/api/v1/auth/me');
      if (!res.ok) {
        if (active) router.replace('/login');
        return;
      }

      const body = (await res.json().catch(() => null)) as { data?: CurrentUser } | null;
      if (active) {
        setUser(body?.data ?? null);
        setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [router]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting || !user || user.authType !== 'local') return;

    if (!currentPassword.trim() || !newPassword.trim()) {
      toast.error('请填写当前密码和新密码');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/v1/auth/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        toast.error(body?.error?.message ?? '修改失败');
        return;
      }

      toast.success('密码已更新');
      setCurrentPassword('');
      setNewPassword('');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground">加载中…</div>;
  }

  if (!user) {
    return null;
  }

  const canChangePassword = user.authType === 'local';

  return (
    <div className="mx-auto w-full max-w-xl space-y-6">
      <PageHeader title="账号设置" description="管理当前登录账号信息。" />

      <Card>
        <CardHeader className="space-y-1">
          <div className="text-sm font-medium">当前账号</div>
          <div className="text-xs text-muted-foreground">
            用户：{user.username} ｜ 角色：{user.role} ｜ 认证方式：{user.authType}
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="space-y-1">
          <div className="text-sm font-medium">修改密码</div>
          <div className="text-xs text-muted-foreground">
            {canChangePassword ? '本地用户可在此修改密码。' : 'LDAP 用户不支持在本系统修改密码，请在 AD 侧修改。'}
          </div>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label htmlFor="currentPassword">当前密码</Label>
              <Input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={!canChangePassword || submitting}
                autoComplete="current-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newPassword">新密码</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={!canChangePassword || submitting}
                autoComplete="new-password"
              />
            </div>
            <Button type="submit" disabled={!canChangePassword || submitting}>
              {submitting ? '提交中…' : '更新密码'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
