import { requireUser } from '@/lib/auth/require-user';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { fail, ok } from '@/lib/http/response';

const TAKE_LIMIT = 500;

function cleanDistinctStrings(values: Array<string | null | undefined>): string[] {
  const cleaned = values.map((v) => (typeof v === 'string' ? v.trim() : '')).filter((v) => v.length > 0);

  return Array.from(new Set(cleaned)).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  try {
    type OsNameRow = { osName: string | null };
    type BrandRow = { brand: string | null };
    type ModelRow = { model: string | null };

    const [
      regionsRows,
      companiesRows,
      departmentsRows,
      systemCategoryRows,
      systemLevelRows,
      bizOwnerRows,
      osNameRows,
      brandRows,
      modelRows,
    ] = await Promise.all([
      prisma.assetLedgerFields.findMany({
        distinct: ['region'],
        where: { asset: { status: { not: 'merged' } }, region: { not: null } },
        select: { region: true },
        orderBy: { region: 'asc' },
        take: TAKE_LIMIT,
      }),
      prisma.assetLedgerFields.findMany({
        distinct: ['company'],
        where: { asset: { status: { not: 'merged' } }, company: { not: null } },
        select: { company: true },
        orderBy: { company: 'asc' },
        take: TAKE_LIMIT,
      }),
      prisma.assetLedgerFields.findMany({
        distinct: ['department'],
        where: { asset: { status: { not: 'merged' } }, department: { not: null } },
        select: { department: true },
        orderBy: { department: 'asc' },
        take: TAKE_LIMIT,
      }),
      prisma.assetLedgerFields.findMany({
        distinct: ['systemCategory'],
        where: { asset: { status: { not: 'merged' } }, systemCategory: { not: null } },
        select: { systemCategory: true },
        orderBy: { systemCategory: 'asc' },
        take: TAKE_LIMIT,
      }),
      prisma.assetLedgerFields.findMany({
        distinct: ['systemLevel'],
        where: { asset: { status: { not: 'merged' } }, systemLevel: { not: null } },
        select: { systemLevel: true },
        orderBy: { systemLevel: 'asc' },
        take: TAKE_LIMIT,
      }),
      prisma.assetLedgerFields.findMany({
        distinct: ['bizOwner'],
        where: { asset: { status: { not: 'merged' } }, bizOwner: { not: null } },
        select: { bizOwner: true },
        orderBy: { bizOwner: 'asc' },
        take: TAKE_LIMIT,
      }),
      prisma.$queryRaw<OsNameRow[]>`
        SELECT DISTINCT os_name AS "osName"
        FROM (
          SELECT DISTINCT ON (ars."assetUuid")
            ars.canonical #>> '{fields,os,name,value}' AS os_name
          FROM "AssetRunSnapshot" ars
          JOIN "Asset" a ON a.uuid = ars."assetUuid"
          WHERE a.status <> 'merged'
          ORDER BY ars."assetUuid", ars."createdAt" DESC
        ) t
        WHERE os_name IS NOT NULL AND btrim(os_name) <> ''
        ORDER BY os_name
        LIMIT ${TAKE_LIMIT}
      `,
      prisma.$queryRaw<BrandRow[]>`
        SELECT DISTINCT brand AS "brand"
        FROM (
          SELECT DISTINCT ON (ars."assetUuid")
            ars.canonical #>> '{fields,identity,vendor,value}' AS brand
          FROM "AssetRunSnapshot" ars
          JOIN "Asset" a ON a.uuid = ars."assetUuid"
          WHERE a.status <> 'merged' AND a."assetType" = 'host'
          ORDER BY ars."assetUuid", ars."createdAt" DESC
        ) t
        WHERE brand IS NOT NULL AND btrim(brand) <> ''
        ORDER BY brand
        LIMIT ${TAKE_LIMIT}
      `,
      prisma.$queryRaw<ModelRow[]>`
        SELECT DISTINCT model AS "model"
        FROM (
          SELECT DISTINCT ON (ars."assetUuid")
            ars.canonical #>> '{fields,identity,model,value}' AS model
          FROM "AssetRunSnapshot" ars
          JOIN "Asset" a ON a.uuid = ars."assetUuid"
          WHERE a.status <> 'merged' AND a."assetType" = 'host'
          ORDER BY ars."assetUuid", ars."createdAt" DESC
        ) t
        WHERE model IS NOT NULL AND btrim(model) <> ''
        ORDER BY model
        LIMIT ${TAKE_LIMIT}
      `,
    ]);

    const regions = cleanDistinctStrings(regionsRows.map((r) => r.region));
    const companies = cleanDistinctStrings(companiesRows.map((r) => r.company));
    const departments = cleanDistinctStrings(departmentsRows.map((r) => r.department));
    const systemCategories = cleanDistinctStrings(systemCategoryRows.map((r) => r.systemCategory));
    const systemLevels = cleanDistinctStrings(systemLevelRows.map((r) => r.systemLevel));
    const bizOwners = cleanDistinctStrings(bizOwnerRows.map((r) => r.bizOwner));
    const osNames = cleanDistinctStrings(osNameRows.map((r) => r.osName));
    const brands = cleanDistinctStrings(brandRows.map((r) => r.brand));
    const models = cleanDistinctStrings(modelRows.map((r) => r.model));

    return ok(
      { regions, companies, departments, systemCategories, systemLevels, bizOwners, osNames, brands, models },
      { requestId: auth.requestId },
    );
  } catch {
    return fail(
      {
        code: ErrorCode.DB_READ_FAILED,
        category: 'db',
        message: 'Failed to load ledger field options',
        retryable: false,
      },
      500,
      { requestId: auth.requestId },
    );
  }
}
