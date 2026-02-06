import { AssetType, Prisma, SourceType } from '@prisma/client';

export type AssetListQuery = {
  assetType: AssetType | undefined;
  excludeAssetType: AssetType | undefined;
  sourceId: string | undefined;
  sourceType: SourceType | undefined;
  q: string | undefined;
  status: 'in_service' | 'offline' | undefined;
  brand: string | undefined;
  model: string | undefined;
  region: string | undefined;
  company: string | undefined;
  department: string | undefined;
  systemCategory: string | undefined;
  systemLevel: string | undefined;
  bizOwner: string | undefined;
  os: string | undefined;
  vmPowerState: 'poweredOn' | 'poweredOff' | 'suspended' | undefined;
  ipMissing: boolean | undefined;
  machineNameMissing: boolean | undefined;
  machineNameVmNameMismatch: boolean | undefined;
  createdWithinDays: number | undefined;
};

function parseAssetType(input: string | null): AssetType | undefined {
  if (!input) return undefined;
  if ((Object.values(AssetType) as string[]).includes(input)) return input as AssetType;
  return undefined;
}

function parseSourceType(input: string | null): SourceType | undefined {
  if (!input) return undefined;
  if ((Object.values(SourceType) as string[]).includes(input)) return input as SourceType;
  return undefined;
}

function parseOptionalString(input: string | null): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseAssetStatus(input: string | null): AssetListQuery['status'] {
  if (input === 'in_service' || input === 'offline') return input;
  return undefined;
}

function parseVmPowerState(input: string | null): AssetListQuery['vmPowerState'] {
  if (input === 'poweredOn' || input === 'poweredOff' || input === 'suspended') return input;
  return undefined;
}

function parseIpMissing(input: string | null): boolean | undefined {
  if (input === 'true') return true;
  return undefined;
}

function parseMachineNameMissing(input: string | null): boolean | undefined {
  if (input === 'true') return true;
  return undefined;
}

function parseMachineNameVmNameMismatch(input: string | null): boolean | undefined {
  if (input === 'true') return true;
  return undefined;
}

function parseCreatedWithinDays(input: string | null): number | undefined {
  if (!input) return undefined;
  const raw = Number(input);
  if (!Number.isFinite(raw) || raw <= 0) return undefined;
  return Math.min(365, Math.floor(raw));
}

export function parseAssetListQuery(params: URLSearchParams): AssetListQuery {
  return {
    assetType: parseAssetType(params.get('asset_type')),
    excludeAssetType: parseAssetType(params.get('exclude_asset_type')),
    sourceId: parseOptionalString(params.get('source_id')),
    sourceType: parseSourceType(params.get('source_type')),
    q: parseOptionalString(params.get('q')),
    status: parseAssetStatus(params.get('status')),
    brand: parseOptionalString(params.get('brand')),
    model: parseOptionalString(params.get('model')),
    region: parseOptionalString(params.get('region')),
    company: parseOptionalString(params.get('company')),
    department: parseOptionalString(params.get('department')),
    systemCategory: parseOptionalString(params.get('system_category')),
    systemLevel: parseOptionalString(params.get('system_level')),
    bizOwner: parseOptionalString(params.get('biz_owner')),
    os: parseOptionalString(params.get('os')),
    vmPowerState: parseVmPowerState(params.get('vm_power_state')),
    ipMissing: parseIpMissing(params.get('ip_missing')),
    machineNameMissing: parseMachineNameMissing(params.get('machine_name_missing')),
    machineNameVmNameMismatch: parseMachineNameVmNameMismatch(params.get('machine_name_vmname_mismatch')),
    createdWithinDays: parseCreatedWithinDays(params.get('created_within_days')),
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
  sourceType?: SourceType;
  q?: string;
  status?: AssetListQuery['status'];
  brand?: string;
  model?: string;
  region?: string;
  company?: string;
  department?: string;
  systemCategory?: string;
  systemLevel?: string;
  bizOwner?: string;
  os?: string;
  vmPowerState?: AssetListQuery['vmPowerState'];
  ipMissing?: boolean;
  machineNameMissing?: boolean;
  machineNameVmNameMismatch?: boolean;
  createdWithinDays?: number;
}): Prisma.AssetWhereInput {
  const and: Prisma.AssetWhereInput[] = [];

  // Default: hide merged assets (merge targets remain accessible via direct URL and redirect).
  and.push({ status: { not: 'merged' } });

  if (query.assetType) and.push({ assetType: query.assetType });
  if (query.excludeAssetType) and.push({ assetType: { not: query.excludeAssetType } });
  if (query.sourceId) and.push({ sourceLinks: { some: { sourceId: query.sourceId } } });
  if (query.sourceType) and.push({ sourceLinks: { some: { source: { sourceType: query.sourceType } } } });

  if (query.status) and.push({ status: query.status });

  if (query.createdWithinDays && query.createdWithinDays > 0) {
    const cutoffMs = Date.now() - query.createdWithinDays * 24 * 60 * 60 * 1000;
    and.push({ createdAt: { gte: new Date(cutoffMs) } });
  }

  // Host-only filters (from canonical fields).
  if (query.brand || query.model) {
    and.push({ assetType: AssetType.host });
  }
  if (query.brand) {
    and.push({
      runSnapshots: {
        some: {
          canonical: {
            path: ['fields', 'identity', 'vendor', 'value'],
            string_contains: query.brand,
            mode: 'insensitive',
          },
        },
      },
    });
  }
  if (query.model) {
    and.push({
      runSnapshots: {
        some: {
          canonical: {
            path: ['fields', 'identity', 'model', 'value'],
            string_contains: query.model,
            mode: 'insensitive',
          },
        },
      },
    });
  }

  // Ledger-fields-v1 filters (case-insensitive substring).
  if (query.region) and.push({ ledgerFields: { is: { region: { contains: query.region, mode: 'insensitive' } } } });
  if (query.company) and.push({ ledgerFields: { is: { company: { contains: query.company, mode: 'insensitive' } } } });
  if (query.department)
    and.push({ ledgerFields: { is: { department: { contains: query.department, mode: 'insensitive' } } } });
  if (query.systemCategory)
    and.push({
      ledgerFields: { is: { systemCategory: { contains: query.systemCategory, mode: 'insensitive' } } },
    });
  if (query.systemLevel)
    and.push({ ledgerFields: { is: { systemLevel: { contains: query.systemLevel, mode: 'insensitive' } } } });
  if (query.bizOwner)
    and.push({ ledgerFields: { is: { bizOwner: { contains: query.bizOwner, mode: 'insensitive' } } } });

  if (query.os) {
    and.push({
      runSnapshots: {
        some: {
          canonical: { path: ['fields', 'os', 'name', 'value'], string_contains: query.os, mode: 'insensitive' },
        },
      },
    });
  }

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

  if (query.assetType === AssetType.vm && query.machineNameMissing === true) {
    and.push({
      AND: [
        { OR: [{ machineNameOverride: null }, { machineNameOverride: '' }] },
        { OR: [{ collectedHostname: null }, { collectedHostname: '' }] },
      ],
    });
  }

  if (query.assetType === AssetType.vm && query.machineNameVmNameMismatch === true) {
    and.push({ machineNameVmNameMismatch: true });
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
        { collectedHostname: { contains: token, mode: 'insensitive' } },
        { collectedVmCaption: { contains: token, mode: 'insensitive' } },
        { collectedIpText: { contains: token, mode: 'insensitive' } },
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
