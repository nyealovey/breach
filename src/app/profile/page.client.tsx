'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { changePasswordAction } from '@/lib/actions/auth';

import type { FormEvent } from 'react';

export type CurrentUser = {
  userId: string;
  username: string;
  role: 'admin' | 'user';
  authType: 'local' | 'ldap';
};

export default function ProfilePageClient({ initialUser }: { initialUser: CurrentUser }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting || initialUser.authType !== 'local') return;

    if (!currentPassword.trim() || !newPassword.trim()) {
      toast.error('请填写当前密码和新密码');
      return;
    }

    setSubmitting(true);
    try {
      const result = await changePasswordAction({ currentPassword, newPassword });
      if (!result.ok) {
        toast.error(result.error ?? '修改失败');
        return;
      }

      toast.success('密码已更新');
      setCurrentPassword('');
      setNewPassword('');
    } finally {
      setSubmitting(false);
    }
  };

  const canChangePassword = initialUser.authType === 'local';

  return (
    <div className="mx-auto w-full max-w-xl space-y-6">
      <PageHeader title="账号设置" description="管理当前登录账号信息。" />

      <Card>
        <CardHeader className="space-y-1">
          <div className="text-sm font-medium">当前账号</div>
          <div className="text-xs text-muted-foreground">
            用户：{initialUser.username} ｜ 角色：{initialUser.role} ｜ 认证方式：{initialUser.authType}
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
