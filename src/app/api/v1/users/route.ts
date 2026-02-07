import { z } from 'zod/v4';

import { requireAdmin } from '@/lib/auth/require-admin';
import { hashPassword } from '@/lib/auth/password';
import { prisma } from '@/lib/db/prisma';
import { isLikelyUpn, normalizeUpn } from '@/lib/directory/ad-source-config';
import { ErrorCode } from '@/lib/errors/error-codes';
import { buildPagination, parsePagination } from '@/lib/http/pagination';
import { created, fail, okPaginated } from '@/lib/http/response';

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

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(url.searchParams);
  const q = (url.searchParams.get('q') ?? '').trim();

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

  const [total, users] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: [{ role: 'asc' }, { username: 'asc' }],
      skip,
      take,
    }),
  ]);

  return okPaginated(
    users.map((user) => ({
      userId: user.id,
      username: user.username,
      role: user.role,
      authType: user.authType,
      externalAuthId: user.externalAuthId,
      enabled: user.enabled,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    })),
    buildPagination(total, page, pageSize),
    { requestId: auth.requestId },
  );
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof UserCreateSchema>;
  try {
    body = UserCreateSchema.parse(await request.json());
  } catch {
    return fail(
      { code: ErrorCode.CONFIG_INVALID_REQUEST, category: 'config', message: 'Validation failed', retryable: false },
      400,
      { requestId: auth.requestId },
    );
  }

  const authType = body.authType;
  const role = body.role;
  const enabled = body.enabled ?? true;

  let username: string;
  let externalAuthId: string | null;
  let passwordHash: string | null;

  if (authType === 'ldap') {
    const upnRaw = (body.externalAuthId ?? body.username ?? '').trim();
    if (!upnRaw || !isLikelyUpn(upnRaw)) {
      return fail(
        {
          code: ErrorCode.CONFIG_INVALID_REQUEST,
          category: 'config',
          message: 'externalAuthId must be a valid UPN',
          retryable: false,
        },
        400,
        { requestId: auth.requestId },
      );
    }

    externalAuthId = normalizeUpn(upnRaw);
    username = (body.username ?? externalAuthId).trim().toLowerCase();
    passwordHash = null;
  } else {
    username = (body.username ?? '').trim();
    if (!username) {
      return fail(
        {
          code: ErrorCode.CONFIG_INVALID_REQUEST,
          category: 'config',
          message: 'username is required',
          retryable: false,
        },
        400,
        { requestId: auth.requestId },
      );
    }

    if (!body.password?.trim()) {
      return fail(
        {
          code: ErrorCode.CONFIG_INVALID_REQUEST,
          category: 'config',
          message: 'password is required',
          retryable: false,
        },
        400,
        { requestId: auth.requestId },
      );
    }

    externalAuthId = null;
    passwordHash = await hashPassword(body.password);
  }

  try {
    const user = await prisma.user.create({
      data: {
        username,
        role,
        authType,
        externalAuthId,
        passwordHash,
        enabled,
      },
    });

    return created(
      {
        userId: user.id,
        username: user.username,
        role: user.role,
        authType: user.authType,
        externalAuthId: user.externalAuthId,
        enabled: user.enabled,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      },
      { requestId: auth.requestId },
    );
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && (error as { code: string }).code === 'P2002') {
      return fail(
        { code: ErrorCode.CONFIG_DUPLICATE_NAME, category: 'config', message: 'Name already exists', retryable: false },
        409,
        { requestId: auth.requestId },
      );
    }

    return fail(
      { code: ErrorCode.DB_WRITE_FAILED, category: 'db', message: 'Failed to create user', retryable: false },
      500,
      { requestId: auth.requestId },
    );
  }
}
