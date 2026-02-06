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
    type RegionRow = { region: string | null };
    type CompanyRow = { company: string | null };
    type DepartmentRow = { department: string | null };
    type SystemCategoryRow = { systemCategory: string | null };
    type SystemLevelRow = { systemLevel: string | null };
    type BizOwnerRow = { bizOwner: string | null };
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
      prisma.$queryRaw<RegionRow[]>`
        SELECT DISTINCT value AS "region"
        FROM (
          SELECT NULLIF(btrim(COALESCE(alf."regionOverride", alf."regionSource")), '') AS value
          FROM "AssetLedgerFields" alf
          JOIN "Asset" a ON a.uuid = alf."assetUuid"
          WHERE a.status <> 'merged'
        ) t
        WHERE value IS NOT NULL
        ORDER BY value
        LIMIT ${TAKE_LIMIT}
      `,
      prisma.$queryRaw<CompanyRow[]>`
        SELECT DISTINCT value AS "company"
        FROM (
          SELECT NULLIF(btrim(COALESCE(alf."companyOverride", alf."companySource")), '') AS value
          FROM "AssetLedgerFields" alf
          JOIN "Asset" a ON a.uuid = alf."assetUuid"
          WHERE a.status <> 'merged'
        ) t
        WHERE value IS NOT NULL
        ORDER BY value
        LIMIT ${TAKE_LIMIT}
      `,
      prisma.$queryRaw<DepartmentRow[]>`
        SELECT DISTINCT value AS "department"
        FROM (
          SELECT NULLIF(btrim(COALESCE(alf."departmentOverride", alf."departmentSource")), '') AS value
          FROM "AssetLedgerFields" alf
          JOIN "Asset" a ON a.uuid = alf."assetUuid"
          WHERE a.status <> 'merged'
        ) t
        WHERE value IS NOT NULL
        ORDER BY value
        LIMIT ${TAKE_LIMIT}
      `,
      prisma.$queryRaw<SystemCategoryRow[]>`
        SELECT DISTINCT value AS "systemCategory"
        FROM (
          SELECT NULLIF(btrim(COALESCE(alf."systemCategoryOverride", alf."systemCategorySource")), '') AS value
          FROM "AssetLedgerFields" alf
          JOIN "Asset" a ON a.uuid = alf."assetUuid"
          WHERE a.status <> 'merged'
        ) t
        WHERE value IS NOT NULL
        ORDER BY value
        LIMIT ${TAKE_LIMIT}
      `,
      prisma.$queryRaw<SystemLevelRow[]>`
        SELECT DISTINCT value AS "systemLevel"
        FROM (
          SELECT NULLIF(btrim(COALESCE(alf."systemLevelOverride", alf."systemLevelSource")), '') AS value
          FROM "AssetLedgerFields" alf
          JOIN "Asset" a ON a.uuid = alf."assetUuid"
          WHERE a.status <> 'merged'
        ) t
        WHERE value IS NOT NULL
        ORDER BY value
        LIMIT ${TAKE_LIMIT}
      `,
      prisma.$queryRaw<BizOwnerRow[]>`
        SELECT DISTINCT value AS "bizOwner"
        FROM (
          SELECT NULLIF(btrim(COALESCE(alf."bizOwnerOverride", alf."bizOwnerSource")), '') AS value
          FROM "AssetLedgerFields" alf
          JOIN "Asset" a ON a.uuid = alf."assetUuid"
          WHERE a.status <> 'merged'
        ) t
        WHERE value IS NOT NULL
        ORDER BY value
        LIMIT ${TAKE_LIMIT}
      `,
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
