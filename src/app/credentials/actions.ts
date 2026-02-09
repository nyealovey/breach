'use server';

import { z } from 'zod/v4';

import { requireServerAdminSession } from '@/lib/auth/require-server-session';
import { actionError, actionOk, getActionErrorMessage } from '@/lib/actions/action-result';
import { deriveCredentialAccount, deriveCredentialAccountFromCiphertext } from '@/lib/credentials/credential-account';
import { payloadSchemaByType } from '@/lib/credentials/schema';
import { encryptJson } from '@/lib/crypto/aes-gcm';
import { prisma } from '@/lib/db/prisma';
import { SourceType } from '@prisma/client';

import type { ActionResult } from '@/lib/actions/action-result';

export type CredentialListItem = {
  credentialId: string;
  name: string;
  type: string;
  account: string | null;
  usageCount: number;
  updatedAt: string;
};

export type CredentialDetail = CredentialListItem & { createdAt: string };

function clampPageSize(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const n = Math.trunc(value);
  if (n <= 0) return fallback;
  return Math.min(n, 200);
}

async function loadUsageCountMap(credentialIds: string[]) {
  const counts =
    credentialIds.length > 0
      ? await prisma.source.groupBy({
          by: ['credentialId'],
          where: { deletedAt: null, credentialId: { in: credentialIds } },
          _count: { _all: true },
        })
      : [];

  const countMap = new Map<string, number>();
  for (const row of counts as Array<{ credentialId: string | null; _count: { _all: number } }>) {
    if (row.credentialId) countMap.set(row.credentialId, row._count._all);
  }
  return countMap;
}

export async function listCredentials(input?: { pageSize?: number; type?: string; q?: string }) {
  await requireServerAdminSession();

  const pageSize = clampPageSize(input?.pageSize, 100);
  const type = input?.type?.trim() ? (input.type.trim() as SourceType) : undefined;
  const q = input?.q?.trim() ? input.q.trim() : undefined;

  const where = {
    ...(type ? { type } : {}),
    ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
  };

  const credentials = await prisma.credential.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take: pageSize,
  });

  const ids = credentials.map((c) => c.id);
  const countMap = await loadUsageCountMap(ids);

  return credentials.map((c) => ({
    credentialId: c.id,
    name: c.name,
    type: c.type,
    account: deriveCredentialAccountFromCiphertext(c.type, c.payloadCiphertext),
    usageCount: countMap.get(c.id) ?? 0,
    updatedAt: c.updatedAt.toISOString(),
  })) satisfies CredentialListItem[];
}

export async function getCredential(credentialId: string): Promise<CredentialDetail | null> {
  await requireServerAdminSession();

  const id = credentialId.trim();
  if (!id) return null;

  const credential = await prisma.credential.findUnique({ where: { id } });
  if (!credential) return null;

  const usageCount = await prisma.source.count({ where: { credentialId: id, deletedAt: null } });

  return {
    credentialId: credential.id,
    name: credential.name,
    type: credential.type,
    account: deriveCredentialAccountFromCiphertext(credential.type, credential.payloadCiphertext),
    usageCount,
    createdAt: credential.createdAt.toISOString(),
    updatedAt: credential.updatedAt.toISOString(),
  };
}

const CredentialCreateBodySchema = z.object({
  name: z.string().min(1),
  type: z.nativeEnum(SourceType),
  payload: z.unknown(),
});

export async function createCredentialAction(input: unknown): Promise<ActionResult<CredentialDetail>> {
  await requireServerAdminSession();

  let body: z.infer<typeof CredentialCreateBodySchema>;
  try {
    body = CredentialCreateBodySchema.parse(input);
  } catch {
    return actionError('Validation failed');
  }

  const payloadResult = payloadSchemaByType(body.type).safeParse(body.payload);
  if (!payloadResult.success) return actionError('Validation failed');

  let payloadCiphertext: string;
  try {
    payloadCiphertext = encryptJson(payloadResult.data);
  } catch (err) {
    return actionError(getActionErrorMessage(err, 'Credential encryption failed'));
  }

  try {
    const credential = await prisma.credential.create({
      data: { name: body.name, type: body.type, payloadCiphertext },
    });

    return actionOk({
      credentialId: credential.id,
      name: credential.name,
      type: credential.type,
      account: deriveCredentialAccount(body.type, payloadResult.data),
      usageCount: 0,
      createdAt: credential.createdAt.toISOString(),
      updatedAt: credential.updatedAt.toISOString(),
    });
  } catch (err) {
    if (typeof err === 'object' && err && 'code' in err && (err as { code: string }).code === 'P2002') {
      return actionError('Name already exists');
    }
    return actionError(getActionErrorMessage(err, 'Failed to create credential'));
  }
}

const CredentialUpdateBodySchema = z.object({
  name: z.string().min(1).optional(),
  payload: z.unknown().optional(),
});

export async function updateCredentialAction(
  credentialId: string,
  input: unknown,
): Promise<ActionResult<CredentialDetail>> {
  await requireServerAdminSession();

  const id = credentialId.trim();
  if (!id) return actionError('Invalid credentialId');

  let body: z.infer<typeof CredentialUpdateBodySchema>;
  try {
    body = CredentialUpdateBodySchema.parse(input);
  } catch {
    return actionError('Validation failed');
  }

  const existing = await prisma.credential.findUnique({ where: { id } });
  if (!existing) return actionError('Credential not found');

  const data: { name?: string; payloadCiphertext?: string } = {};
  if (body.name !== undefined) data.name = body.name;

  if (body.payload !== undefined) {
    const result = payloadSchemaByType(existing.type).safeParse(body.payload);
    if (!result.success) return actionError('Validation failed');

    try {
      data.payloadCiphertext = encryptJson(result.data);
    } catch (err) {
      return actionError(getActionErrorMessage(err, 'Credential encryption failed'));
    }
  }

  try {
    const updated = await prisma.credential.update({ where: { id }, data });
    const usageCount = await prisma.source.count({ where: { credentialId: id, deletedAt: null } });

    return actionOk({
      credentialId: updated.id,
      name: updated.name,
      type: updated.type,
      account: deriveCredentialAccountFromCiphertext(updated.type, updated.payloadCiphertext),
      usageCount,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (err) {
    if (typeof err === 'object' && err && 'code' in err && (err as { code: string }).code === 'P2002') {
      return actionError('Name already exists');
    }
    return actionError(getActionErrorMessage(err, 'Failed to update credential'));
  }
}

export async function deleteCredentialAction(credentialId: string): Promise<ActionResult<{ deleted: true }>> {
  await requireServerAdminSession();

  const id = credentialId.trim();
  if (!id) return actionError('Invalid credentialId');

  const credential = await prisma.credential.findUnique({ where: { id }, select: { id: true } });
  if (!credential) return actionError('Credential not found');

  const usageCount = await prisma.source.count({ where: { credentialId: id, deletedAt: null } });
  if (usageCount > 0) return actionError('Credential is still referenced by sources');

  try {
    await prisma.credential.delete({ where: { id } });
    return actionOk({ deleted: true });
  } catch (err) {
    return actionError(getActionErrorMessage(err, 'Failed to delete credential'));
  }
}
