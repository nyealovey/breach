import { AssetType, Prisma } from '@prisma/client';

export type AssetListQuery = {
  assetType: AssetType | undefined;
  excludeAssetType: AssetType | undefined;
  sourceId: string | undefined;
  q: string | undefined;
  company: string | undefined;
  department: string | undefined;
  systemCategory: string | undefined;
  systemLevel: string | undefined;
  vmPowerState: 'poweredOn' | 'poweredOff' | 'suspended' | undefined;
  ipMissing: boolean | undefined;
};

function parseAssetType(input: string | null): AssetType | undefined {
  if (!input) return undefined;
  if ((Object.values(AssetType) as string[]).includes(input)) return input as AssetType;
  return undefined;
}

function parseOptionalString(input: string | null): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseVmPowerState(input: string | null): AssetListQuery['vmPowerState'] {
  if (input === 'poweredOn' || input === 'poweredOff' || input === 'suspended') return input;
  return undefined;
}

function parseIpMissing(input: string | null): boolean | undefined {
  if (input === 'true') return true;
  return undefined;
}

export function parseAssetListQuery(params: URLSearchParams): AssetListQuery {
  return {
    assetType: parseAssetType(params.get('asset_type')),
    excludeAssetType: parseAssetType(params.get('exclude_asset_type')),
    sourceId: parseOptionalString(params.get('source_id')),
    q: parseOptionalString(params.get('q')),
    company: parseOptionalString(params.get('company')),
    department: parseOptionalString(params.get('department')),
    systemCategory: parseOptionalString(params.get('system_category')),
    systemLevel: parseOptionalString(params.get('system_level')),
    vmPowerState: parseVmPowerState(params.get('vm_power_state')),
    ipMissing: parseIpMissing(params.get('ip_missing')),
  };
}

export function isUuid(input: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input);
}

function parseIsoDateOnly(input: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year) return null;
  if (d.getUTCMonth() + 1 !== month) return null;
  if (d.getUTCDate() !== day) return null;

  return d;
}

export function buildAssetListWhere(query: {
  assetType?: AssetType;
  excludeAssetType?: AssetType;
  sourceId?: string;
  q?: string;
  company?: string;
  department?: string;
  systemCategory?: string;
  systemLevel?: string;
  vmPowerState?: AssetListQuery['vmPowerState'];
  ipMissing?: boolean;
}): Prisma.AssetWhereInput {
  const and: Prisma.AssetWhereInput[] = [];

  // Default: hide merged assets (merge targets remain accessible via direct URL and redirect).
  and.push({ status: { not: 'merged' } });

  if (query.assetType) and.push({ assetType: query.assetType });
  if (query.excludeAssetType) and.push({ assetType: { not: query.excludeAssetType } });
  if (query.sourceId) and.push({ sourceLinks: { some: { sourceId: query.sourceId } } });

  // Ledger-fields-v1 filters (case-insensitive substring).
  if (query.company) and.push({ ledgerFields: { is: { company: { contains: query.company, mode: 'insensitive' } } } });
  if (query.department)
    and.push({ ledgerFields: { is: { department: { contains: query.department, mode: 'insensitive' } } } });
  if (query.systemCategory)
    and.push({
      ledgerFields: { is: { systemCategory: { contains: query.systemCategory, mode: 'insensitive' } } },
    });
  if (query.systemLevel)
    and.push({ ledgerFields: { is: { systemLevel: { contains: query.systemLevel, mode: 'insensitive' } } } });

  if (query.assetType === AssetType.vm && query.vmPowerState) {
    and.push({
      runSnapshots: {
        some: { canonical: { path: ['fields', 'runtime', 'power_state', 'value'], equals: query.vmPowerState } },
      },
    });
  }

  if (query.assetType === AssetType.vm && query.ipMissing === true) {
    and.push({
      OR: [
        {
          runSnapshots: {
            some: { canonical: { path: ['fields', 'network', 'ip_addresses', 'value'], equals: Prisma.AnyNull } },
          },
        },
        { runSnapshots: { some: { canonical: { path: ['fields', 'network', 'ip_addresses', 'value'], equals: [] } } } },
      ],
    });
  }

  if (query.q) {
    const tokens = query.q
      .split(/\s+/g)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    for (const token of tokens) {
      const tokenDate = parseIsoDateOnly(token);

      const or: Prisma.AssetWhereInput[] = [
        { displayName: { contains: token, mode: 'insensitive' } },
        { machineNameOverride: { contains: token, mode: 'insensitive' } },
        { sourceLinks: { some: { externalId: { contains: token, mode: 'insensitive' } } } },
        // Ledger-fields-v1: must always be searchable (case-insensitive substring).
        { ledgerFields: { is: { region: { contains: token, mode: 'insensitive' } } } },
        { ledgerFields: { is: { company: { contains: token, mode: 'insensitive' } } } },
        { ledgerFields: { is: { department: { contains: token, mode: 'insensitive' } } } },
        { ledgerFields: { is: { systemCategory: { contains: token, mode: 'insensitive' } } } },
        { ledgerFields: { is: { systemLevel: { contains: token, mode: 'insensitive' } } } },
        { ledgerFields: { is: { bizOwner: { contains: token, mode: 'insensitive' } } } },
        { ledgerFields: { is: { bmcIp: { contains: token, mode: 'insensitive' } } } },
        // Date-only ledger fields are searchable via exact `YYYY-MM-DD` token.
        ...(tokenDate ? [{ ledgerFields: { is: { maintenanceDueDate: tokenDate } } }] : []),
        ...(tokenDate ? [{ ledgerFields: { is: { purchaseDate: tokenDate } } }] : []),
        { ledgerFields: { is: { cabinetNo: { contains: token, mode: 'insensitive' } } } },
        { ledgerFields: { is: { rackPosition: { contains: token, mode: 'insensitive' } } } },
        { ledgerFields: { is: { managementCode: { contains: token, mode: 'insensitive' } } } },
        { ledgerFields: { is: { fixedAssetNo: { contains: token, mode: 'insensitive' } } } },

        // 宿主机名：VM --runs_on--> Host 的 displayName
        {
          outgoingRelations: {
            some: { relationType: 'runs_on', toAsset: { displayName: { contains: token, mode: 'insensitive' } } },
          },
        },
        // 操作系统/机器名/虚拟机名（caption）：从 canonical JSON 中做简单 substring 匹配（任意历史快照命中即可）
        {
          runSnapshots: {
            some: {
              canonical: { path: ['fields', 'os', 'name', 'value'], string_contains: token, mode: 'insensitive' },
            },
          },
        },
        {
          runSnapshots: {
            some: {
              canonical: { path: ['fields', 'os', 'version', 'value'], string_contains: token, mode: 'insensitive' },
            },
          },
        },
        {
          // NOTE: Host 的 os.fingerprint 用于承接 ESXi build（不纳入 q 搜索）。
          // VM 的 os.fingerprint 仍用于承接 guest_OS 等指纹（需可搜索）。
          assetType: AssetType.vm,
          runSnapshots: {
            some: {
              canonical: {
                path: ['fields', 'os', 'fingerprint', 'value'],
                string_contains: token,
                mode: 'insensitive',
              },
            },
          },
        },
        {
          runSnapshots: {
            some: {
              canonical: {
                path: ['fields', 'identity', 'hostname', 'value'],
                string_contains: token,
                mode: 'insensitive',
              },
            },
          },
        },
        {
          runSnapshots: {
            some: {
              canonical: {
                path: ['fields', 'identity', 'caption', 'value'],
                string_contains: token,
                mode: 'insensitive',
              },
            },
          },
        },
      ];

      // Avoid UUID contains search; UUID columns do not support LIKE without casting.
      if (isUuid(token)) or.push({ uuid: token });

      and.push({ OR: or });
    }
  }

  return and.length > 0 ? { AND: and } : {};
}
