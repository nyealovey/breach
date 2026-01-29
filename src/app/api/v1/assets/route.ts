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
  const managementIp = getCanonicalFieldValue(fields, ['network', 'management_ip']);
  if (typeof managementIp === 'string' && managementIp.trim().length > 0) return managementIp.trim();

  const ips = getCanonicalFieldValue(fields, ['network', 'ip_addresses']);
  if (Array.isArray(ips)) {
    const first = ips.find((ip) => typeof ip === 'string' && ip.trim().length > 0);
    if (typeof first === 'string') return first.trim();
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

      return {
        assetUuid: asset.uuid,
        assetType: asset.assetType,
        status: asset.status,
        hostName: asset.assetType === 'vm' ? pickRunsOnHostName(canonical) : (asset.displayName ?? asset.uuid),
        vmName: asset.assetType === 'vm' ? (asset.displayName ?? asset.uuid) : null,
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
