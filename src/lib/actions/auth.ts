'use server';

import { z } from 'zod/v4';
import { cookies } from 'next/headers';

import { bootstrapAdmin } from '@/lib/auth/bootstrap-admin';
import { parseLdapAuthConfig, verifyLdapPassword } from '@/lib/auth/ldap';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { createSession, destroySession } from '@/lib/auth/session';
import { getServerSession } from '@/lib/auth/server-session';
import { actionError, actionOk, getActionErrorMessage } from '@/lib/actions/action-result';
import { decryptJson } from '@/lib/crypto/aes-gcm';
import { prisma } from '@/lib/db/prisma';
import {
  extractUpnSuffix,
  isAdAuthPurpose,
  isLikelyUpn,
  normalizeUpn,
  readAdPurpose,
  readAdUpnSuffixes,
} from '@/lib/directory/ad-source-config';

import type { ActionResult } from '@/lib/actions/action-result';

export type CurrentUser = {
  userId: string;
  username: string;
  role: 'admin' | 'user';
  authType: 'local' | 'ldap';
  enabled: boolean;
};

export async function getMeAction(): Promise<ActionResult<CurrentUser>> {
  const session = await getServerSession();
  if (!session) return actionError('Not authenticated');

  return actionOk({
    userId: session.user.id,
    username: session.user.username,
    role: session.user.role,
    authType: session.user.authType,
    enabled: session.user.enabled,
  });
}

const LoginBodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

function invalidCredentials(): ActionResult<never> {
  return actionError('Invalid credentials');
}

function matchSuffix(candidateSuffixes: string[], loginSuffix: string): string | null {
  let best: string | null = null;

  for (const suffix of candidateSuffixes) {
    const normalized = suffix.trim().toLowerCase();
    if (!normalized) continue;

    const exact = loginSuffix === normalized;
    const child = loginSuffix.endsWith(`.${normalized}`);
    if (!exact && !child) continue;

    if (!best || normalized.length > best.length) best = normalized;
  }

  return best;
}

async function selectLdapSourceByUpn(upn: string) {
  const loginSuffix = extractUpnSuffix(upn);
  if (!loginSuffix) return null;

  const sources = await prisma.source.findMany({
    where: {
      sourceType: 'activedirectory',
      enabled: true,
      deletedAt: null,
      credentialId: { not: null },
    },
    include: { credential: true },
  });

  let best: { source: (typeof sources)[number]; matchedSuffix: string } | null = null;

  for (const source of sources) {
    const purpose = readAdPurpose(source.config);
    if (!purpose || !isAdAuthPurpose(purpose)) continue;

    const suffixes = readAdUpnSuffixes(source.config);
    const matchedSuffix = matchSuffix(suffixes, loginSuffix);
    if (!matchedSuffix) continue;

    if (!best || matchedSuffix.length > best.matchedSuffix.length) best = { source, matchedSuffix };
  }

  return best?.source ?? null;
}

export async function loginAction(input: unknown): Promise<ActionResult<CurrentUser>> {
  let parsed: z.infer<typeof LoginBodySchema>;
  try {
    parsed = LoginBodySchema.parse(input);
  } catch {
    return actionError('Validation failed');
  }

  const username = parsed.username.trim();
  const password = parsed.password;
  if (!username || !password) return invalidCredentials();

  // Keep admin bootstrap behavior for local fallback access.
  if (username === 'admin') {
    try {
      await bootstrapAdmin();
    } catch {
      return actionError('Internal error');
    }
  }

  const localUser = await prisma.user.findUnique({ where: { username } });
  if (localUser && localUser.authType === 'local') {
    if (!localUser.enabled) return invalidCredentials();
    if (!localUser.passwordHash) return actionError('Internal error');

    const okPw = await verifyPassword(password, localUser.passwordHash);
    if (!okPw) return invalidCredentials();

    const session = await createSession(localUser.id);
    (await cookies()).set({
      name: 'session',
      value: session.cookieValue,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: session.expiresAt,
    });

    return actionOk({
      userId: localUser.id,
      username: localUser.username,
      role: localUser.role,
      authType: localUser.authType,
      enabled: localUser.enabled,
    });
  }

  if (!isLikelyUpn(username)) return invalidCredentials();

  const normalizedUpn = normalizeUpn(username);
  const allowedUser = await prisma.user.findFirst({
    where: { authType: 'ldap', externalAuthId: normalizedUpn, enabled: true },
  });
  if (!allowedUser) return invalidCredentials();

  const source = await selectLdapSourceByUpn(normalizedUpn);
  if (!source?.credential?.payloadCiphertext) return invalidCredentials();

  const sourceConfig =
    source.config && typeof source.config === 'object' && !Array.isArray(source.config)
      ? (source.config as Record<string, unknown>)
      : null;
  if (!sourceConfig) return invalidCredentials();

  let credentialPayload: unknown;
  try {
    credentialPayload = decryptJson(source.credential.payloadCiphertext);
  } catch {
    return invalidCredentials();
  }

  const credentialObj =
    credentialPayload && typeof credentialPayload === 'object' && !Array.isArray(credentialPayload)
      ? (credentialPayload as Record<string, unknown>)
      : null;
  if (!credentialObj) return invalidCredentials();

  const ldapConfig = parseLdapAuthConfig({ config: sourceConfig, credential: credentialObj });
  if (!ldapConfig) return invalidCredentials();

  const ldapResult = await verifyLdapPassword({ upn: normalizedUpn, password, config: ldapConfig });
  if (!ldapResult.ok) return invalidCredentials();

  const session = await createSession(allowedUser.id);
  (await cookies()).set({
    name: 'session',
    value: session.cookieValue,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: session.expiresAt,
  });

  return actionOk({
    userId: allowedUser.id,
    username: allowedUser.username,
    role: allowedUser.role,
    authType: allowedUser.authType,
    enabled: allowedUser.enabled,
  });
}

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

export async function changePasswordAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const session = await getServerSession();
  if (!session) return actionError('Not authenticated');

  if (session.user.authType !== 'local' || !session.user.passwordHash) {
    return actionError('Password change is not allowed for this account');
  }

  let body: z.infer<typeof ChangePasswordSchema>;
  try {
    body = ChangePasswordSchema.parse(input);
  } catch {
    return actionError('Validation failed');
  }

  const okPw = await verifyPassword(body.currentPassword, session.user.passwordHash);
  if (!okPw) return invalidCredentials();

  try {
    const newHash = await hashPassword(body.newPassword);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: session.user.id }, data: { passwordHash: newHash } });
      await tx.session.deleteMany({ where: { userId: session.user.id } });
    });

    // Create a fresh session after password rotation.
    const fresh = await createSession(session.user.id);
    await destroySession(session.id);

    (await cookies()).set({
      name: 'session',
      value: fresh.cookieValue,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: fresh.expiresAt,
    });

    return actionOk({ ok: true });
  } catch (err) {
    return actionError(getActionErrorMessage(err, 'Failed to update password'));
  }
}
