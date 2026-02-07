'use client';

import { toast } from 'sonner';
import { useEffect, useMemo, useState } from 'react';

import { RequireAdminClient } from '@/components/auth/require-admin-client';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type UserItem = {
  userId: string;
  username: string;
  role: 'admin' | 'user';
  authType: 'local' | 'ldap';
  externalAuthId: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type EditorMode = 'create' | 'edit';

function isSystemAdminUser(item: UserItem): boolean {
  return item.username === 'admin';
}

function normalizeUpnForCreate(value: string): string {
  return value.trim().toLowerCase();
}

export default function UsersPage() {
  const [items, setItems] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>('create');
  const [editingUser, setEditingUser] = useState<UserItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showSystemAccounts, setShowSystemAccounts] = useState(false);

  const [formUpn, setFormUpn] = useState('');
  const [formRole, setFormRole] = useState<'admin' | 'user'>('user');
  const [formEnabled, setFormEnabled] = useState(true);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingUser, setDeletingUser] = useState<UserItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { sortedItems, hiddenCount } = useMemo(() => {
    const filtered = showSystemAccounts ? items : items.filter((item) => item.authType === 'ldap');
    const sorted = [...filtered].sort((a, b) => a.username.localeCompare(b.username, 'zh-CN'));
    return { sortedItems: sorted, hiddenCount: items.length - filtered.length };
  }, [items, showSystemAccounts]);

  const loadUsers = async () => {
    setLoading(true);
    const res = await fetch('/api/v1/users?pageSize=200');
    if (!res.ok) {
      setItems([]);
      setLoading(false);
      return;
    }

    const body = (await res.json()) as { data: UserItem[] };
    setItems(body.data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    void loadUsers();
  }, []);

  const openCreateDialog = () => {
    if (submitting || deleting) return;
    setEditorMode('create');
    setEditingUser(null);
    setFormUpn('');
    setFormRole('user');
    setFormEnabled(true);
    setEditorOpen(true);
  };

  const openEditDialog = (user: UserItem) => {
    if (submitting || deleting) return;
    if (isSystemAdminUser(user)) return;
    setEditorMode('edit');
    setEditingUser(user);
    setFormRole(user.role);
    setFormEnabled(user.enabled);
    setEditorOpen(true);
  };

  const openDeleteDialog = (user: UserItem) => {
    if (submitting || deleting) return;
    if (isSystemAdminUser(user)) return;
    setDeletingUser(user);
    setDeleteOpen(true);
  };

  const submitEditor = async () => {
    if (submitting) return;

    setSubmitting(true);
    try {
      if (editorMode === 'create') {
        const upn = normalizeUpnForCreate(formUpn);
        if (!upn.includes('@') || upn.includes(' ')) {
          toast.error('请填写合法 UPN（例如 user@example.com）');
          return;
        }

        const res = await fetch('/api/v1/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            authType: 'ldap',
            externalAuthId: upn,
            username: upn,
            role: formRole,
            enabled: formEnabled,
          }),
        });

        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
          toast.error(body?.error?.message ?? '创建失败');
          return;
        }

        toast.success('用户已创建');
        setEditorOpen(false);
        await loadUsers();
        return;
      }

      if (!editingUser) return;
      const userId = editingUser.userId;

      const patches: Array<Promise<Response>> = [];
      if (editingUser.role !== formRole) {
        patches.push(
          fetch(`/api/v1/users/${userId}/role`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: formRole }),
          }),
        );
      }
      if (editingUser.enabled !== formEnabled) {
        patches.push(
          fetch(`/api/v1/users/${userId}/enabled`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: formEnabled }),
          }),
        );
      }

      if (patches.length === 0) {
        toast.message('未检测到修改');
        setEditorOpen(false);
        return;
      }

      for (const p of patches) {
        const res = await p;
        if (res.ok) continue;
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        toast.error(body?.error?.message ?? '保存失败');
        return;
      }

      toast.success('已保存');
      setEditorOpen(false);
      await loadUsers();
    } finally {
      setSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    if (deleting || !deletingUser) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/users/${deletingUser.userId}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        toast.error(body?.error?.message ?? '删除失败');
        return;
      }

      toast.success('用户已删除');
      setDeleteOpen(false);
      setDeletingUser(null);
      await loadUsers();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <RequireAdminClient />
      <Dialog
        open={editorOpen}
        onOpenChange={(open) => {
          if (submitting) return;
          setEditorOpen(open);
          if (!open) setEditingUser(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editorMode === 'create' ? '新增用户' : '编辑用户'}</DialogTitle>
            <DialogDescription>
              {editorMode === 'create'
                ? '仅支持创建 LDAP 白名单用户（UPN 登录）。'
                : editingUser
                  ? `用户：${editingUser.username}`
                  : '请选择一个用户进行编辑。'}
            </DialogDescription>
          </DialogHeader>

          {editorMode === 'edit' && editingUser ? (
            <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <div>
                  <span>认证类型：</span>
                  <span className="font-mono">{editingUser.authType}</span>
                </div>
                <div>
                  <span>UPN：</span>
                  <span className="font-mono">{editingUser.externalAuthId ?? '-'}</span>
                </div>
              </div>
            </div>
          ) : null}

          <div className="space-y-4">
            {editorMode === 'create' ? (
              <div className="space-y-2">
                <Label htmlFor="userUpn">UPN</Label>
                <Input
                  id="userUpn"
                  placeholder="user@example.com"
                  value={formUpn}
                  onChange={(e) => setFormUpn(e.target.value)}
                  disabled={submitting}
                />
                <div className="text-xs text-muted-foreground">说明：创建后使用 AD 密码登录，系统不保存用户密码。</div>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="userRole">角色</Label>
              <NativeSelect
                id="userRole"
                value={formRole}
                onChange={(e) => setFormRole((e.target.value as 'admin' | 'user') ?? 'user')}
                disabled={submitting}
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </NativeSelect>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/10 px-3 py-2">
              <div>
                <div className="text-sm font-medium">启用</div>
                <div className="text-xs text-muted-foreground">停用后该用户无法登录。</div>
              </div>
              <Switch checked={formEnabled} onCheckedChange={setFormEnabled} disabled={submitting} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditorOpen(false)} disabled={submitting}>
              取消
            </Button>
            <Button type="button" onClick={() => void submitEditor()} disabled={submitting}>
              {submitting ? '提交中…' : editorMode === 'create' ? '创建' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (deleting) return;
          setDeleteOpen(open);
          if (!open) setDeletingUser(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>删除用户</DialogTitle>
            <DialogDescription>
              {deletingUser ? (
                <>
                  即将删除：<span className="font-mono">{deletingUser.username}</span>
                </>
              ) : (
                '请选择一个用户。'
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border bg-muted/10 p-3 text-xs text-muted-foreground">
            删除后该用户将无法登录；如需恢复请重新创建（软删除）。
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void confirmDelete()}
              disabled={deleting || !deletingUser}
            >
              {deleting ? '删除中…' : '删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="space-y-6">
        <PageHeader
          title="用户管理"
          description="白名单模式：先创建用户再允许 LDAP 登录；角色由系统内维护，不做 LDAP 组自动映射。"
          actions={
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Switch
                  id="showSystemAccounts"
                  checked={showSystemAccounts}
                  onCheckedChange={setShowSystemAccounts}
                  aria-label="show-system-accounts"
                />
                <Label htmlFor="showSystemAccounts" className="text-xs text-muted-foreground">
                  显示系统账号
                </Label>
              </div>
              <Button size="sm" onClick={() => openCreateDialog()}>
                新增用户
              </Button>
            </div>
          }
        />

        <Card>
          <CardHeader className="space-y-1">
            <div className="text-sm font-medium">说明</div>
            <div className="text-xs text-muted-foreground">LDAP 用户不支持在本系统修改密码，请在 AD 侧修改。</div>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            <div>提示：列表仅展示；修改请点「编辑」进入弹窗；状态用开关表示。</div>
            <div>默认仅展示 LDAP 用户；如需查看本地系统账号（例如 admin）请打开「显示系统账号」。</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-1">
            <div className="text-sm font-medium">用户列表</div>
            <div className="text-xs text-muted-foreground">
              {loading
                ? '加载中…'
                : sortedItems.length === 0
                  ? showSystemAccounts || hiddenCount === 0
                    ? '暂无数据'
                    : `暂无 LDAP 用户（已隐藏 ${hiddenCount} 个本地账号）`
                  : `共 ${sortedItems.length} 条${showSystemAccounts || hiddenCount === 0 ? '' : `（已隐藏 ${hiddenCount} 个本地账号）`}`}
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-sm text-muted-foreground">加载中…</div>
            ) : sortedItems.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                {showSystemAccounts || hiddenCount === 0
                  ? '暂无用户。'
                  : `暂无 LDAP 用户（可打开「显示系统账号」查看本地账号）。`}
              </div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow>
                    <TableHead>用户名</TableHead>
                    <TableHead>认证类型</TableHead>
                    <TableHead>UPN</TableHead>
                    <TableHead>角色</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>改密</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedItems.map((item) => (
                    <TableRow key={item.userId}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs">{item.username}</span>
                          {isSystemAdminUser(item) ? <Badge variant="outline">系统保留</Badge> : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="font-mono text-xs font-medium">
                          {item.authType}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{item.externalAuthId ?? '-'}</TableCell>
                      <TableCell>
                        <Badge
                          variant={item.role === 'admin' ? 'default' : 'secondary'}
                          className="font-mono text-xs font-medium"
                        >
                          {item.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch checked={item.enabled} disabled aria-label={`enabled-${item.userId}`} />
                          <span className="text-xs text-muted-foreground">{item.enabled ? '启用' : '停用'}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {item.authType === 'local' ? '本地可改密' : '仅 AD 侧改密'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={submitting || deleting || isSystemAdminUser(item)}
                            onClick={() => openEditDialog(item)}
                          >
                            编辑
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={submitting || deleting || isSystemAdminUser(item)}
                            onClick={() => openDeleteDialog(item)}
                          >
                            删除
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
