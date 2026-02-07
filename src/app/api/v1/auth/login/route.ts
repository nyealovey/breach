import { z } from 'zod/v4';

import { bootstrapAdmin } from '@/lib/auth/bootstrap-admin';
import { parseLdapAuthConfig, verifyLdapPassword } from '@/lib/auth/ldap';
import { verifyPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
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
import { ErrorCode } from '@/lib/errors/error-codes';
import { fail, ok } from '@/lib/http/response';

const LoginBodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

function invalidCredentials(requestId?: string) {
  return fail(
    {
      code: ErrorCode.AUTH_INVALID_CREDENTIALS,
      category: 'auth',
      message: 'Invalid credentials',
      retryable: false,
    },
    401,
    { requestId },
  );
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

  let best: {
    source: (typeof sources)[number];
    matchedSuffix: string;
  } | null = null;

  for (const source of sources) {
    const purpose = readAdPurpose(source.config);
    if (!purpose || !isAdAuthPurpose(purpose)) continue;

    const suffixes = readAdUpnSuffixes(source.config);
    const matchedSuffix = matchSuffix(suffixes, loginSuffix);
    if (!matchedSuffix) continue;

    if (!best || matchedSuffix.length > best.matchedSuffix.length) {
      best = { source, matchedSuffix };
    }
  }

  return best?.source ?? null;
}

export async function POST(request: Request) {
  const requestId = request.headers.get('x-request-id') ?? undefined;

  let parsed: z.infer<typeof LoginBodySchema>;
  try {
    parsed = LoginBodySchema.parse(await request.json());
  } catch {
    return fail(
      { code: ErrorCode.CONFIG_INVALID_REQUEST, category: 'config', message: 'Validation failed', retryable: false },
      400,
      { requestId },
    );
  }

  const username = parsed.username.trim();
  const password = parsed.password;

  if (!username || !password) return invalidCredentials(requestId);

  // Keep admin bootstrap behavior for local fallback access.
  if (username === 'admin') {
    try {
      await bootstrapAdmin();
    } catch {
      return fail(
        { code: ErrorCode.INTERNAL_ERROR, category: 'unknown', message: 'Internal error', retryable: false },
        500,
        { requestId },
      );
    }
  }

  const localUser = await prisma.user.findUnique({ where: { username } });
  if (localUser && localUser.authType === 'local') {
    if (!localUser.enabled) return invalidCredentials(requestId);
    if (!localUser.passwordHash) {
      return fail(
        { code: ErrorCode.INTERNAL_ERROR, category: 'unknown', message: 'Internal error', retryable: false },
        500,
        { requestId },
      );
    }

    const okPw = await verifyPassword(password, localUser.passwordHash);
    if (!okPw) return invalidCredentials(requestId);

    const session = await createSession(localUser.id);
    const res = ok(
      {
        userId: localUser.id,
        username: localUser.username,
        role: localUser.role,
        authType: localUser.authType,
      },
      { requestId },
    );
    res.cookies.set({
      name: 'session',
      value: session.cookieValue,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: session.expiresAt,
    });
    return res;
  }

  if (!isLikelyUpn(username)) return invalidCredentials(requestId);

  const normalizedUpn = normalizeUpn(username);
  const allowedUser = await prisma.user.findFirst({
    where: {
      authType: 'ldap',
      externalAuthId: normalizedUpn,
      enabled: true,
    },
  });
  if (!allowedUser) return invalidCredentials(requestId);

  const source = await selectLdapSourceByUpn(normalizedUpn);
  if (!source?.credential?.payloadCiphertext) return invalidCredentials(requestId);

  const sourceConfig =
    source.config && typeof source.config === 'object' && !Array.isArray(source.config)
      ? (source.config as Record<string, unknown>)
      : null;
  if (!sourceConfig) return invalidCredentials(requestId);

  let credentialPayload: unknown;
  try {
    credentialPayload = decryptJson(source.credential.payloadCiphertext);
  } catch {
    return invalidCredentials(requestId);
  }

  const credentialObj =
    credentialPayload && typeof credentialPayload === 'object' && !Array.isArray(credentialPayload)
      ? (credentialPayload as Record<string, unknown>)
      : null;
  if (!credentialObj) return invalidCredentials(requestId);

  const ldapConfig = parseLdapAuthConfig({ config: sourceConfig, credential: credentialObj });
  if (!ldapConfig) return invalidCredentials(requestId);

  const ldapResult = await verifyLdapPassword({
    upn: normalizedUpn,
    password,
    config: ldapConfig,
  });
  if (!ldapResult.ok) return invalidCredentials(requestId);

  const session = await createSession(allowedUser.id);

  const res = ok(
    {
      userId: allowedUser.id,
      username: allowedUser.username,
      role: allowedUser.role,
      authType: allowedUser.authType,
    },
    { requestId },
  );
  res.cookies.set({
    name: 'session',
    value: session.cookieValue,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: session.expiresAt,
  });
  return res;
}
