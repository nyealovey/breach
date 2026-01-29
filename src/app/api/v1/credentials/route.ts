import { z } from 'zod/v4';

import { requireAdmin } from '@/lib/auth/require-admin';
import { encryptJson } from '@/lib/crypto/aes-gcm';
import { prisma } from '@/lib/db/prisma';
import { payloadSchemaByType } from '@/lib/credentials/schema';
import { ErrorCode } from '@/lib/errors/error-codes';
import { buildPagination, parsePagination } from '@/lib/http/pagination';
import { created, fail, okPaginated } from '@/lib/http/response';
import { SourceType } from '@prisma/client';

const CredentialCreateBodySchema = z.object({
  name: z.string().min(1),
  type: z.nativeEnum(SourceType),
  payload: z.unknown(),
});

const SortBySchema = z.enum(['createdAt', 'updatedAt', 'name']);
const SortOrderSchema = z.enum(['asc', 'desc']);

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(url.searchParams);

  const type = url.searchParams.get('type') ?? undefined;
  const q = url.searchParams.get('q') ?? undefined;

  const sortBy = SortBySchema.safeParse(url.searchParams.get('sortBy') ?? 'updatedAt');
  const sortOrder = SortOrderSchema.safeParse(url.searchParams.get('sortOrder') ?? 'desc');

  const where = {
    ...(type ? { type: type as SourceType } : {}),
    ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
  };

  const [total, credentials] = await prisma.$transaction([
    prisma.credential.count({ where }),
    prisma.credential.findMany({
      where,
      orderBy: { [sortBy.success ? sortBy.data : 'updatedAt']: sortOrder.success ? sortOrder.data : 'desc' },
      skip,
      take,
    }),
  ]);

  const ids = credentials.map((c) => c.id);
  const counts =
    ids.length > 0
      ? await prisma.source.groupBy({
          by: ['credentialId'],
          where: { deletedAt: null, credentialId: { in: ids } },
          _count: { _all: true },
        })
      : [];

  const countMap = new Map<string, number>();
  for (const row of counts as Array<{ credentialId: string | null; _count: { _all: number } }>) {
    if (row.credentialId) countMap.set(row.credentialId, row._count._all);
  }

  const data = credentials.map((c) => ({
    credentialId: c.id,
    name: c.name,
    type: c.type,
    usageCount: countMap.get(c.id) ?? 0,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }));

  return okPaginated(data, buildPagination(total, page, pageSize), { requestId: auth.requestId });
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof CredentialCreateBodySchema>;
  try {
    body = CredentialCreateBodySchema.parse(await request.json());
  } catch {
    return fail(
      { code: ErrorCode.CONFIG_INVALID_REQUEST, category: 'config', message: 'Validation failed', retryable: false },
      400,
      { requestId: auth.requestId },
    );
  }

  const payloadResult = payloadSchemaByType(body.type).safeParse(body.payload);
  if (!payloadResult.success) {
    return fail(
      { code: ErrorCode.CONFIG_INVALID_REQUEST, category: 'config', message: 'Validation failed', retryable: false },
      400,
      { requestId: auth.requestId },
    );
  }

  let payloadCiphertext: string;
  try {
    payloadCiphertext = encryptJson(payloadResult.data);
  } catch (err) {
    return fail(
      {
        code: ErrorCode.INTERNAL_ERROR,
        category: 'unknown',
        message: err instanceof Error ? err.message : 'Credential encryption failed',
        retryable: false,
      },
      500,
      { requestId: auth.requestId },
    );
  }

  try {
    const credential = await prisma.credential.create({
      data: {
        name: body.name,
        type: body.type,
        payloadCiphertext,
      },
    });

    return created(
      {
        credentialId: credential.id,
        name: credential.name,
        type: credential.type,
        usageCount: 0,
        createdAt: credential.createdAt.toISOString(),
        updatedAt: credential.updatedAt.toISOString(),
      },
      { requestId: auth.requestId },
    );
  } catch (err) {
    if (typeof err === 'object' && err && 'code' in err && (err as { code: string }).code === 'P2002') {
      return fail(
        { code: ErrorCode.CONFIG_DUPLICATE_NAME, category: 'config', message: 'Name already exists', retryable: false },
        409,
        { requestId: auth.requestId },
      );
    }

    return fail(
      { code: ErrorCode.DB_WRITE_FAILED, category: 'db', message: 'Failed to create credential', retryable: false },
      500,
      { requestId: auth.requestId },
    );
  }
}

