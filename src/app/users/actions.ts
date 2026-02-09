'use server';

import { z } from 'zod/v4';

import { requireServerAdminSession } from '@/lib/auth/require-server-session';
import { hashPassword } from '@/lib/auth/password';
import { actionError, actionOk, getActionErrorMessage } from '@/lib/actions/action-result';
import { prisma } from '@/lib/db/prisma';
import { isLikelyUpn, normalizeUpn } from '@/lib/directory/ad-source-config';

import type { ActionResult } from '@/lib/actions/action-result';

export type UserItem = {
  userId: string;
  username: string;
  role: 'admin' | 'user';
  authType: 'local' | 'ldap';
  externalAuthId: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

function toUserItem(u: {
  id: string;
  username: string;
  role: 'admin' | 'user';
  authType: 'local' | 'ldap';
  externalAuthId: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}): UserItem {
  return {
    userId: u.id,
    username: u.username,
    role: u.role,
    authType: u.authType,
    externalAuthId: u.externalAuthId,
    enabled: u.enabled,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}

export async function listUsers(input?: { pageSize?: number; q?: string }) {
  await requireServerAdminSession();

  const pageSize = Math.min(Math.max(Math.trunc(input?.pageSize ?? 200), 1), 500);
  const q = (input?.q ?? '').trim();

  const where = {
    deletedAt: null,
    ...(q
      ? {
          OR: [
            { username: { contains: q, mode: 'insensitive' as const } },
            { externalAuthId: { contains: q.toLowerCase(), mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const users = await prisma.user.findMany({
    where,
    orderBy: [{ role: 'asc' }, { username: 'asc' }],
    take: pageSize,
  });

  return users.map(toUserItem) satisfies UserItem[];
}

const UserCreateSchema = z
  .object({
    authType: z.enum(['local', 'ldap']).default('ldap'),
    username: z.string().min(1).optional(),
    externalAuthId: z.string().min(1).optional(),
    password: z.string().min(1).optional(),
    role: z.enum(['admin', 'user']),
    enabled: z.boolean().optional(),
  })
  .strict();

export async function createUserAction(input: unknown): Promise<ActionResult<UserItem>> {
  await requireServerAdminSession();

  let body: z.infer<typeof UserCreateSchema>;
  try {
    body = UserCreateSchema.parse(input);
  } catch {
    return actionError('Validation failed');
  }

  const authType = body.authType;
  const role = body.role;
  const enabled = body.enabled ?? true;

  let username: string;
  let externalAuthId: string | null;
  let passwordHash: string | null;

  if (authType === 'ldap') {
    const upnRaw = (body.externalAuthId ?? body.username ?? '').trim();
    if (!upnRaw || !isLikelyUpn(upnRaw)) return actionError('externalAuthId must be a valid UPN');

    externalAuthId = normalizeUpn(upnRaw);
    username = (body.username ?? externalAuthId).trim().toLowerCase();
    passwordHash = null;
  } else {
    username = (body.username ?? '').trim();
    if (!username) return actionError('username is required');
    if (!body.password?.trim()) return actionError('password is required');
    externalAuthId = null;
    passwordHash = await hashPassword(body.password);
  }

  try {
    const user = await prisma.user.create({
      data: { username, role, authType, externalAuthId, passwordHash, enabled },
    });
    return actionOk(toUserItem(user));
  } catch (err) {
    if (typeof err === 'object' && err && 'code' in err && (err as { code: string }).code === 'P2002') {
      return actionError('Name already exists');
    }
    return actionError(getActionErrorMessage(err, 'Failed to create user'));
  }
}

const RoleSchema = z.object({ role: z.enum(['admin', 'user']) }).strict();

export async function updateUserRoleAction(userId: string, input: unknown): Promise<ActionResult<UserItem>> {
  await requireServerAdminSession();

  const id = userId.trim();
  if (!id) return actionError('Invalid userId');

  let body: z.infer<typeof RoleSchema>;
  try {
    body = RoleSchema.parse(input);
  } catch {
    return actionError('Validation failed');
  }

  const existing = await prisma.user.findUnique({ where: { id }, select: { username: true, deletedAt: true } });
  if (!existing || existing.deletedAt) return actionError('User not found');
  if (existing.username === 'admin') return actionError('admin user is protected');

  try {
    const user = await prisma.user.update({ where: { id }, data: { role: body.role } });
    return actionOk(toUserItem(user));
  } catch (err) {
    return actionError(getActionErrorMessage(err, 'Failed to update user role'));
  }
}

const EnabledSchema = z.object({ enabled: z.boolean() }).strict();

export async function updateUserEnabledAction(userId: string, input: unknown): Promise<ActionResult<UserItem>> {
  await requireServerAdminSession();

  const id = userId.trim();
  if (!id) return actionError('Invalid userId');

  let body: z.infer<typeof EnabledSchema>;
  try {
    body = EnabledSchema.parse(input);
  } catch {
    return actionError('Validation failed');
  }

  const existing = await prisma.user.findUnique({ where: { id }, select: { username: true, deletedAt: true } });
  if (!existing || existing.deletedAt) return actionError('User not found');
  if (existing.username === 'admin') return actionError('admin user is protected');

  try {
    const user = await prisma.user.update({ where: { id }, data: { enabled: body.enabled } });
    return actionOk(toUserItem(user));
  } catch (err) {
    return actionError(getActionErrorMessage(err, 'Failed to update user status'));
  }
}

export async function deleteUserAction(userId: string): Promise<ActionResult<{ deleted: true }>> {
  const session = await requireServerAdminSession();

  const id = userId.trim();
  if (!id) return actionError('Invalid userId');
  if (id === session.user.id) return actionError('Cannot delete current user');

  const existing = await prisma.user.findUnique({
    where: { id },
    select: { id: true, username: true, deletedAt: true },
  });
  if (!existing || existing.deletedAt) return actionError('User not found');
  if (existing.username === 'admin') return actionError('admin user is protected');

  const tombstoneUsername = `deleted:${existing.id}:${existing.username}`;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: existing.id },
        data: {
          deletedAt: new Date(),
          enabled: false,
          externalAuthId: null,
          passwordHash: null,
          username: tombstoneUsername,
        },
      });

      await tx.session.deleteMany({ where: { userId: existing.id } });
    });

    return actionOk({ deleted: true });
  } catch (err) {
    return actionError(getActionErrorMessage(err, 'Failed to delete user'));
  }
}
