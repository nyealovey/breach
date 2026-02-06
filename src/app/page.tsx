import Link from 'next/link';

import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { buildAssetListWhere } from '@/lib/assets/asset-list-query';
import { prisma } from '@/lib/db/prisma';

type LedgerTopItem = { value: string; count: number };

const TOP_LEDGER_FIELD_COLUMNS = {
  region: { source: 'regionSource', override: 'regionOverride' },
  company: { source: 'companySource', override: 'companyOverride' },
  department: { source: 'departmentSource', override: 'departmentOverride' },
  systemCategory: { source: 'systemCategorySource', override: 'systemCategoryOverride' },
  systemLevel: { source: 'systemLevelSource', override: 'systemLevelOverride' },
  bizOwner: { source: 'bizOwnerSource', override: 'bizOwnerOverride' },
} as const;

async function topLedgerField(
  field: 'region' | 'company' | 'department' | 'systemCategory' | 'systemLevel' | 'bizOwner',
) {
  const columns = TOP_LEDGER_FIELD_COLUMNS[field];
  const effectiveExpr = `COALESCE(lf."${columns.override}", lf."${columns.source}")`;
  const sql = `
    SELECT t.value, COUNT(*)::bigint AS count
    FROM (
      SELECT ${effectiveExpr} AS value
      FROM "AssetLedgerFields" lf
      JOIN "Asset" a ON a.uuid = lf."assetUuid"
      WHERE a.status <> 'merged'
    ) t
    WHERE t.value IS NOT NULL AND btrim(t.value) <> ''
    GROUP BY t.value
    ORDER BY COUNT(*) DESC, t.value ASC
    LIMIT 10
  `;
  const rows = await prisma.$queryRawUnsafe<Array<{ value: string; count: bigint }>>(sql);

  return rows
    .map((r) => ({ value: String(r.value ?? '').trim(), count: Number(r.count) }))
    .filter((r): r is LedgerTopItem => r.value.length > 0)
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.value.localeCompare(b.value, 'zh-CN')))
    .slice(0, 10);
}

export default async function Home() {
  const [
    totalAssets,
    byType,
    byStatus,
    recentCreatedCount,
    ipMissingVmCount,
    machineNameMissingVmCount,
    machineNameVmNameMismatchVmCount,
    topRegions,
    topCompanies,
    topDepartments,
    topSystemCategories,
    topSystemLevels,
    topBizOwners,
  ] = await Promise.all([
    prisma.asset.count({ where: { status: { not: 'merged' } } }),
    prisma.asset.groupBy({ by: ['assetType'], where: { status: { not: 'merged' } }, _count: { _all: true } }),
    prisma.asset.groupBy({ by: ['status'], where: { status: { not: 'merged' } }, _count: { _all: true } }),
    prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count
        FROM "Asset"
        WHERE status <> 'merged' AND "createdAt" >= NOW() - interval '7 days'
      `.then((rows) => Number(rows[0]?.count ?? 0)),
    prisma.asset.count({ where: buildAssetListWhere({ assetType: 'vm', ipMissing: true }) }),
    prisma.asset.count({
      where: {
        AND: [
          { status: { not: 'merged' } },
          { assetType: 'vm' },
          { OR: [{ machineNameOverride: null }, { machineNameOverride: '' }] },
          { OR: [{ collectedHostname: null }, { collectedHostname: '' }] },
        ],
      },
    }),
    prisma.asset.count({ where: { status: { not: 'merged' }, assetType: 'vm', machineNameVmNameMismatch: true } }),
    topLedgerField('region'),
    topLedgerField('company'),
    topLedgerField('department'),
    topLedgerField('systemCategory'),
    topLedgerField('systemLevel'),
    topLedgerField('bizOwner'),
  ]);

  type OsRow = { osName: string | null; count: bigint };
  const osRows = await prisma.$queryRaw<OsRow[]>`
    SELECT os_name AS "osName", COUNT(*) AS "count"
    FROM (
      SELECT DISTINCT ON (ars."assetUuid")
        ars.canonical #>> '{fields,os,name,value}' AS os_name
      FROM "AssetRunSnapshot" ars
      JOIN "Asset" a ON a.uuid = ars."assetUuid"
      WHERE a.status <> 'merged'
      ORDER BY ars."assetUuid", ars."createdAt" DESC
    ) t
    WHERE os_name IS NOT NULL AND btrim(os_name) <> ''
    GROUP BY os_name
    ORDER BY COUNT(*) DESC, os_name ASC
    LIMIT 20
  `;

  type SourceRow = { sourceId: string; sourceName: string; count: bigint };
  const sourceRows = await prisma.$queryRaw<SourceRow[]>`
    SELECT s.id AS "sourceId", s.name AS "sourceName", COUNT(*) AS "count"
    FROM (
      SELECT DISTINCT ON (ars."assetUuid")
        ars."assetUuid",
        ars."runId"
      FROM "AssetRunSnapshot" ars
      JOIN "Asset" a ON a.uuid = ars."assetUuid"
      WHERE a.status <> 'merged'
      ORDER BY ars."assetUuid", ars."createdAt" DESC
    ) latest
    JOIN "Run" r ON r.id = latest."runId"
    JOIN "Source" s ON s.id = r."sourceId"
    GROUP BY s.id, s.name
    ORDER BY COUNT(*) DESC, s.name ASC
    LIMIT 20
  `;

  const assetTypeCount = new Map(byType.map((r) => [r.assetType, r._count._all]));
  const assetStatusCount = new Map(byStatus.map((r) => [r.status, r._count._all]));

  const assetListHref = (params: Record<string, string>) => {
    const qs = new URLSearchParams(params);
    const s = qs.toString();
    return `/assets${s ? `?${s}` : ''}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader title="资产统计" description="按多个维度统计资产，并可一键跳转到资产清单筛选结果。" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">总资产（非 merged）</CardTitle>
          </CardHeader>
          <CardContent>
            <Link className="text-3xl font-semibold text-primary underline-offset-4 hover:underline" href="/assets">
              {totalAssets}
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">最近新增（7 天）</CardTitle>
          </CardHeader>
          <CardContent>
            <Link
              className="text-3xl font-semibold text-primary underline-offset-4 hover:underline"
              href={assetListHref({ created_within_days: '7' })}
            >
              {recentCreatedCount}
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">仅 IP 缺失（VM）</CardTitle>
          </CardHeader>
          <CardContent>
            <Link
              className="text-3xl font-semibold text-primary underline-offset-4 hover:underline"
              href={assetListHref({ asset_type: 'vm', ip_missing: 'true' })}
            >
              {ipMissingVmCount}
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">机器名缺失（VM）</CardTitle>
          </CardHeader>
          <CardContent>
            <Link
              className="text-3xl font-semibold text-primary underline-offset-4 hover:underline"
              href={assetListHref({ asset_type: 'vm', machine_name_missing: 'true' })}
            >
              {machineNameMissingVmCount}
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">机器名≠虚拟机名（VM）</CardTitle>
          </CardHeader>
          <CardContent>
            <Link
              className="text-3xl font-semibold text-primary underline-offset-4 hover:underline"
              href={assetListHref({ asset_type: 'vm', machine_name_vmname_mismatch: 'true' })}
            >
              {machineNameVmNameMismatchVmCount}
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">按类型</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead>类型</TableHead>
                  <TableHead className="text-right">数量</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(['vm', 'host', 'cluster'] as const).map((t) => (
                  <TableRow key={t}>
                    <TableCell className="font-mono text-xs">{t.toUpperCase()}</TableCell>
                    <TableCell className="text-right">
                      <Link
                        className="text-primary underline-offset-4 hover:underline"
                        href={assetListHref({ asset_type: t })}
                      >
                        {assetTypeCount.get(t) ?? 0}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">按状态</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">数量</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(['in_service', 'offline'] as const).map((s) => (
                  <TableRow key={s}>
                    <TableCell className="font-mono text-xs">{s}</TableCell>
                    <TableCell className="text-right">{assetStatusCount.get(s) ?? 0}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">操作系统 Top 20（按最新快照）</CardTitle>
          </CardHeader>
          <CardContent>
            {osRows.length === 0 ? (
              <div className="text-sm text-muted-foreground">暂无数据。</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow>
                    <TableHead>OS</TableHead>
                    <TableHead className="text-right">数量</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {osRows.map((r) => (
                    <TableRow key={r.osName ?? '-'}>
                      <TableCell className="text-sm">{r.osName ?? '-'}</TableCell>
                      <TableCell className="text-right">
                        {r.osName ? (
                          <Link
                            className="text-primary underline-offset-4 hover:underline"
                            href={assetListHref({ os: r.osName })}
                          >
                            {Number(r.count)}
                          </Link>
                        ) : (
                          Number(r.count)
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">来源 Top 20（按最新快照）</CardTitle>
          </CardHeader>
          <CardContent>
            {sourceRows.length === 0 ? (
              <div className="text-sm text-muted-foreground">暂无数据。</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow>
                    <TableHead>来源</TableHead>
                    <TableHead className="text-right">数量</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sourceRows.map((r) => (
                    <TableRow key={r.sourceId}>
                      <TableCell className="text-sm">{r.sourceName}</TableCell>
                      <TableCell className="text-right">
                        <Link
                          className="text-primary underline-offset-4 hover:underline"
                          href={assetListHref({ source_id: r.sourceId })}
                        >
                          {Number(r.count)}
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">台账字段 Top 10</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-3">
          {(
            [
              ['地区', 'region', topRegions],
              ['公司', 'company', topCompanies],
              ['部门', 'department', topDepartments],
              ['系统分类', 'system_category', topSystemCategories],
              ['系统分级', 'system_level', topSystemLevels],
              ['业务对接人员', 'biz_owner', topBizOwners],
            ] as const
          ).map(([label, key, rows]) => (
            <div key={key} className="rounded-md border bg-background p-3">
              <div className="text-sm font-medium">{label}</div>
              <div className="mt-2">
                {rows.length === 0 ? (
                  <div className="text-sm text-muted-foreground">暂无</div>
                ) : (
                  <Table>
                    <TableHeader className="bg-muted/30">
                      <TableRow>
                        <TableHead>值</TableHead>
                        <TableHead className="text-right">数量</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={r.value}>
                          <TableCell className="text-sm">{r.value}</TableCell>
                          <TableCell className="text-right">
                            <Link
                              className="text-primary underline-offset-4 hover:underline"
                              href={assetListHref({ [key]: r.value })}
                            >
                              {r.count}
                            </Link>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
