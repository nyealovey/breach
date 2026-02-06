import { Prisma } from '@prisma/client';
import { ErrorCode } from '@/lib/errors/error-codes';
import {
  ASSET_LEDGER_EXPORT_V1_COLUMNS,
  ASSET_LEDGER_EXPORT_V1_FORMAT,
  ASSET_LEDGER_EXPORT_V1_VERSION,
  buildAssetLedgerExportV1Row,
  sha256Hex,
  toCsvLine,
} from '@/lib/exports/asset-ledger-export-v1';
import { logEvent } from '@/lib/logging/logger';

import type { AssetLedgerExport, PrismaClient } from '@prisma/client';
import type { AppError } from '@/lib/errors/error';

type AssetLedgerExportParamsV1 = {
  format: typeof ASSET_LEDGER_EXPORT_V1_FORMAT;
  version: typeof ASSET_LEDGER_EXPORT_V1_VERSION;
};

function parseParams(params: unknown): AssetLedgerExportParamsV1 {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw {
      code: ErrorCode.CONFIG_INVALID_REQUEST,
      category: 'config',
      message: 'Invalid export params',
      retryable: false,
    } satisfies AppError;
  }

  const obj = params as Record<string, unknown>;
  if (obj.format !== ASSET_LEDGER_EXPORT_V1_FORMAT || obj.version !== ASSET_LEDGER_EXPORT_V1_VERSION) {
    throw {
      code: ErrorCode.CONFIG_INVALID_REQUEST,
      category: 'config',
      message: 'Unsupported export version',
      retryable: false,
      redacted_context: {
        format: typeof obj.format === 'string' ? obj.format : null,
        version: typeof obj.version === 'string' ? obj.version : null,
      },
    } satisfies AppError;
  }

  return { format: ASSET_LEDGER_EXPORT_V1_FORMAT, version: ASSET_LEDGER_EXPORT_V1_VERSION };
}

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function formatFileTimestampUtc(d: Date) {
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}-${pad2(d.getUTCHours())}${pad2(
    d.getUTCMinutes(),
  )}${pad2(d.getUTCSeconds())}`;
}

function buildCsvHeaderLine() {
  return toCsvLine([...ASSET_LEDGER_EXPORT_V1_COLUMNS]);
}

function buildExportFileName(now: Date) {
  return `asset-ledger-export-${formatFileTimestampUtc(now)}.csv`;
}

async function buildAssetLedgerExportCsvV1(args: {
  prisma: PrismaClient;
  batchSize: number;
  now: Date;
}): Promise<{ bytes: Uint8Array; rowCount: number; fileName: string; fileSizeBytes: number; fileSha256: string }> {
  let cursor: string | null = null;
  let rowCount = 0;

  const lines: string[] = [];
  lines.push(buildCsvHeaderLine());

  while (true) {
    let assets: Array<{
      uuid: string;
      assetType: 'vm' | 'host' | 'cluster';
      status: 'in_service' | 'offline' | 'merged';
      displayName: string | null;
      lastSeenAt: Date | null;
      ledgerFields: {
        regionSource: string | null;
        regionOverride: string | null;
        companySource: string | null;
        companyOverride: string | null;
        departmentSource: string | null;
        departmentOverride: string | null;
        systemCategorySource: string | null;
        systemCategoryOverride: string | null;
        systemLevelSource: string | null;
        systemLevelOverride: string | null;
        bizOwnerSource: string | null;
        bizOwnerOverride: string | null;
        maintenanceDueDateSource: Date | null;
        maintenanceDueDateOverride: Date | null;
        purchaseDateSource: Date | null;
        purchaseDateOverride: Date | null;
        bmcIpSource: string | null;
        bmcIpOverride: string | null;
        cabinetNoSource: string | null;
        cabinetNoOverride: string | null;
        rackPositionSource: string | null;
        rackPositionOverride: string | null;
        managementCodeSource: string | null;
        managementCodeOverride: string | null;
        fixedAssetNoSource: string | null;
        fixedAssetNoOverride: string | null;
      } | null;
      sourceLinks: Array<{ sourceId: string; source: { sourceType: string } }>;
    }>;

    try {
      assets = await args.prisma.asset.findMany({
        where: {
          assetType: { in: ['vm', 'host'] },
          status: { in: ['in_service', 'offline'] },
          ...(cursor ? { uuid: { gt: cursor } } : {}),
        },
        orderBy: { uuid: 'asc' },
        take: args.batchSize,
        select: {
          uuid: true,
          assetType: true,
          status: true,
          displayName: true,
          lastSeenAt: true,
          ledgerFields: {
            select: {
              regionSource: true,
              regionOverride: true,
              companySource: true,
              companyOverride: true,
              departmentSource: true,
              departmentOverride: true,
              systemCategorySource: true,
              systemCategoryOverride: true,
              systemLevelSource: true,
              systemLevelOverride: true,
              bizOwnerSource: true,
              bizOwnerOverride: true,
              maintenanceDueDateSource: true,
              maintenanceDueDateOverride: true,
              purchaseDateSource: true,
              purchaseDateOverride: true,
              bmcIpSource: true,
              bmcIpOverride: true,
              cabinetNoSource: true,
              cabinetNoOverride: true,
              rackPositionSource: true,
              rackPositionOverride: true,
              managementCodeSource: true,
              managementCodeOverride: true,
              fixedAssetNoSource: true,
              fixedAssetNoOverride: true,
            },
          },
          sourceLinks: {
            select: {
              sourceId: true,
              source: { select: { sourceType: true } },
            },
          },
        },
      });
    } catch (err) {
      throw {
        code: ErrorCode.DB_READ_FAILED,
        category: 'db',
        message: 'Failed to read assets for export',
        retryable: true,
        redacted_context: { cause: err instanceof Error ? err.message : String(err) },
      } satisfies AppError;
    }

    if (assets.length === 0) break;

    for (const asset of assets) {
      const row = buildAssetLedgerExportV1Row({
        asset: {
          uuid: asset.uuid,
          assetType: asset.assetType === 'vm' || asset.assetType === 'host' ? asset.assetType : 'host',
          status: asset.status === 'in_service' || asset.status === 'offline' ? asset.status : 'offline',
          displayName: asset.displayName,
          lastSeenAt: asset.lastSeenAt,
        },
        sourceLinks: asset.sourceLinks.map((l) => ({ sourceId: l.sourceId, sourceType: l.source.sourceType })),
        ledgerFields: asset.ledgerFields,
      });

      lines.push(toCsvLine(ASSET_LEDGER_EXPORT_V1_COLUMNS.map((col) => row[col])));
      rowCount += 1;
    }

    const last = assets[assets.length - 1];
    if (last) cursor = last.uuid;
  }

  const csv = `${lines.join('\n')}\n`;
  const bytes = Buffer.from(csv, 'utf8');
  const fileSha256 = sha256Hex(bytes);
  const fileSizeBytes = bytes.length;

  return { bytes, rowCount, fileName: buildExportFileName(args.now), fileSizeBytes, fileSha256 };
}

export async function processAssetLedgerExport(args: {
  prisma: PrismaClient;
  exportRow: Pick<AssetLedgerExport, 'id' | 'requestedByUserId' | 'params' | 'requestId'>;
}) {
  const exportId = args.exportRow.id;
  const params = parseParams(args.exportRow.params);

  const startedAt = new Date();
  const batchSize = 1000;

  try {
    const { bytes, rowCount, fileName, fileSizeBytes, fileSha256 } = await buildAssetLedgerExportCsvV1({
      prisma: args.prisma,
      batchSize,
      now: startedAt,
    });

    await args.prisma.assetLedgerExport.update({
      where: { id: exportId },
      data: {
        status: 'Succeeded',
        finishedAt: new Date(),
        rowCount,
        fileName,
        fileSizeBytes,
        fileSha256,
        fileBytes: Buffer.from(bytes),
        error: Prisma.DbNull,
      },
    });

    await args.prisma.auditEvent.create({
      data: {
        eventType: 'asset.ledger_exported',
        actorUserId: args.exportRow.requestedByUserId,
        payload: {
          requestId: args.exportRow.requestId,
          exportId,
          params,
          rowCount,
          fileName,
          fileSizeBytes,
          fileSha256,
        },
      },
    });

    logEvent({
      level: 'info',
      service: 'worker',
      event_type: 'export.task_completed',
      export_id: exportId,
      row_count: rowCount,
      file_size_bytes: fileSizeBytes,
      duration_ms: Date.now() - startedAt.getTime(),
    });

    return { ok: true as const, rowCount };
  } catch (err) {
    const appError: AppError =
      typeof err === 'object' && err && 'code' in err && 'category' in err && 'message' in err
        ? (err as AppError)
        : {
            code: ErrorCode.INTERNAL_ERROR,
            category: 'unknown',
            message: 'Export task failed',
            retryable: true,
            redacted_context: { cause: err instanceof Error ? err.message : String(err) },
          };

    await args.prisma.assetLedgerExport.update({
      where: { id: exportId },
      data: {
        status: 'Failed',
        finishedAt: new Date(),
        error: appError as Prisma.InputJsonValue,
        fileBytes: null,
      },
    });

    logEvent({
      level: 'error',
      service: 'worker',
      event_type: 'export.task_failed',
      export_id: exportId,
      error: appError,
      duration_ms: Date.now() - startedAt.getTime(),
    });

    return { ok: false as const, error: appError };
  }
}
