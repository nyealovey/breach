import { requireAdmin } from '@/lib/auth/require-admin';
import { parseAssetListQuery, buildAssetListWhere } from '@/lib/assets/asset-list-query';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { buildPagination, parsePagination } from '@/lib/http/pagination';
import { fail, okPaginated } from '@/lib/http/response';

function getCanonicalFieldValue(fields: unknown, path: string[]): unknown {
  let cursor: unknown = fields;
  for (const key of path) {
    if (!cursor || typeof cursor !== 'object') return null;
    cursor = (cursor as Record<string, unknown>)[key];
  }

  // canonical-v1 leaf nodes are FieldValue objects: { value, sources, ... }
  if (!cursor || typeof cursor !== 'object') return null;
  const leafValue = (cursor as Record<string, unknown>).value;
  return leafValue === undefined ? null : leafValue;
}

function pickPrimaryIp(fields: unknown): string | null {
  const ips = getCanonicalFieldValue(fields, ['network', 'ip_addresses']);
  if (Array.isArray(ips)) {
    const cleaned = ips
      .filter((ip) => typeof ip === 'string')
      .map((ip) => ip.trim())
      .filter((ip) => ip.length > 0);

    if (cleaned.length > 0) return Array.from(new Set(cleaned)).join(', ');
  }

  return null;
}

function sumDiskBytes(fields: unknown): number | null {
  const disks = getCanonicalFieldValue(fields, ['hardware', 'disks']);
  if (!Array.isArray(disks)) return null;

  let sum = 0;
  let seen = false;
  for (const disk of disks) {
    if (!disk || typeof disk !== 'object') continue;
    const sizeBytes = (disk as Record<string, unknown>).size_bytes;
    if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes)) continue;
    sum += sizeBytes;
    seen = true;
  }

  return seen ? sum : null;
}

function pickRunsOnHostName(canonical: unknown): string | null {
  if (!canonical || typeof canonical !== 'object') return null;

  const relations = (canonical as Record<string, unknown>).relations;
  if (!relations || typeof relations !== 'object') return null;

  const outgoing = (relations as Record<string, unknown>).outgoing;
  if (!Array.isArray(outgoing)) return null;

  const runsOn = outgoing.find(
    (rel) => rel && typeof rel === 'object' && (rel as Record<string, unknown>).type === 'runs_on',
  );
  if (!runsOn || typeof runsOn !== 'object') return null;

  const to = (runsOn as Record<string, unknown>).to;
  if (!to || typeof to !== 'object') return null;

  const displayName = (to as Record<string, unknown>).display_name;
  return typeof displayName === 'string' && displayName.trim().length > 0 ? displayName.trim() : null;
}

function pickVmName(fields: unknown): string | null {
  const caption = getCanonicalFieldValue(fields, ['identity', 'caption']);
  if (typeof caption === 'string' && caption.trim().length > 0) return caption.trim();
  return null;
}

function pickMachineNameCollected(fields: unknown): string | null {
  const hostname = getCanonicalFieldValue(fields, ['identity', 'hostname']);
  if (typeof hostname === 'string' && hostname.trim().length > 0) return hostname.trim();
  return null;
}

function pickOs(fields: unknown): string | null {
  const name = getCanonicalFieldValue(fields, ['os', 'name']);
  const version = getCanonicalFieldValue(fields, ['os', 'version']);
  const fingerprint = getCanonicalFieldValue(fields, ['os', 'fingerprint']);

  const nameStr = typeof name === 'string' ? name.trim() : '';
  const versionStr = typeof version === 'string' ? version.trim() : '';
  const fingerprintStr = typeof fingerprint === 'string' ? fingerprint.trim() : '';

  if (nameStr && versionStr) return `${nameStr} ${versionStr}`;
  if (nameStr) return nameStr;
  if (versionStr) return versionStr;
  if (fingerprintStr) return fingerprintStr;
  return null;
}

function pickVmPowerState(fields: unknown): string | null {
  const powerState = getCanonicalFieldValue(fields, ['runtime', 'power_state']);
  if (typeof powerState === 'string' && powerState.trim().length > 0) return powerState.trim();
  return null;
}

function pickToolsRunning(fields: unknown): boolean | null {
  const toolsRunning = getCanonicalFieldValue(fields, ['runtime', 'tools_running']);
  if (typeof toolsRunning === 'boolean') return toolsRunning;
  return null;
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(url.searchParams);
  const query = parseAssetListQuery(url.searchParams);
  const where = buildAssetListWhere(query);

  try {
    const totalPromise = prisma.asset.count({ where });
    const itemsPromise = prisma.asset.findMany({
      where,
      orderBy: [{ displayName: 'asc' }, { createdAt: 'desc' }],
      skip,
      take,
      include: {
        runSnapshots: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { canonical: true },
        },
      },
    });

    const [total, items] = await prisma.$transaction([totalPromise, itemsPromise]);

    const data = items.map((asset) => {
      const canonical = asset.runSnapshots?.[0]?.canonical ?? null;
      const fields = canonical && typeof canonical === 'object' ? (canonical as Record<string, unknown>).fields : null;

      const cpuCount = getCanonicalFieldValue(fields, ['hardware', 'cpu_count']);
      const memoryBytes = getCanonicalFieldValue(fields, ['hardware', 'memory_bytes']);

      const machineNameOverride = asset.machineNameOverride?.trim() ? asset.machineNameOverride.trim() : null;
      const machineNameCollected = pickMachineNameCollected(fields);
      const machineName = machineNameOverride ?? machineNameCollected;
      const machineNameMismatch =
        machineNameOverride !== null && machineNameCollected !== null && machineNameOverride !== machineNameCollected;

      const vmName = asset.assetType === 'vm' ? (pickVmName(fields) ?? asset.displayName ?? asset.uuid) : null;
      const hostName = asset.assetType === 'vm' ? pickRunsOnHostName(canonical) : null;

      return {
        assetUuid: asset.uuid,
        assetType: asset.assetType,
        status: asset.status,
        machineName,
        machineNameOverride,
        machineNameCollected,
        machineNameMismatch,
        vmName,
        hostName,
        os: pickOs(fields),
        vmPowerState: asset.assetType === 'vm' ? pickVmPowerState(fields) : null,
        toolsRunning: asset.assetType === 'vm' ? pickToolsRunning(fields) : null,
        ip: pickPrimaryIp(fields),
        cpuCount: typeof cpuCount === 'number' ? cpuCount : null,
        memoryBytes: typeof memoryBytes === 'number' ? memoryBytes : null,
        totalDiskBytes: sumDiskBytes(fields),
      };
    });

    return okPaginated(data, buildPagination(total, page, pageSize), { requestId: auth.requestId });
  } catch {
    return fail(
      { code: ErrorCode.DB_READ_FAILED, category: 'db', message: 'Failed to load assets', retryable: false },
      500,
      { requestId: auth.requestId },
    );
  }
}
