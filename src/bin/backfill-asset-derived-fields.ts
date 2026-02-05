import { prisma } from '@/lib/db/prisma';

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

function cleanString(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function joinIps(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const cleaned = value
    .filter((ip) => typeof ip === 'string')
    .map((ip) => ip.trim())
    .filter((ip) => ip.length > 0);

  return cleaned.length > 0 ? Array.from(new Set(cleaned)).join(', ') : null;
}

async function main() {
  const batchSize = 500;

  let cursor: string | null = null;
  let processed = 0;

  // Use uuid cursor pagination to avoid slow skip on large tables.
  // Note: uuid is random, but cursor-based pagination still keeps memory bounded.
  for (;;) {
    const assets: Array<{ uuid: string }> = await prisma.asset.findMany({
      where: cursor ? { uuid: { gt: cursor } } : undefined,
      orderBy: { uuid: 'asc' },
      take: batchSize,
      select: { uuid: true },
    });
    if (assets.length === 0) break;

    const uuids = assets.map((a) => a.uuid);
    const snapshots =
      uuids.length > 0
        ? await prisma.assetRunSnapshot.findMany({
            where: { assetUuid: { in: uuids } },
            orderBy: { createdAt: 'desc' },
            distinct: ['assetUuid'],
            select: { assetUuid: true, canonical: true },
          })
        : [];

    const canonicalByUuid = new Map(snapshots.map((s) => [s.assetUuid, s.canonical]));

    const updates = assets.map((a) => {
      const canonical = canonicalByUuid.get(a.uuid) as any;
      const fields = canonical && typeof canonical === 'object' ? canonical.fields : null;

      const hostname = cleanString(getCanonicalFieldValue(fields, ['identity', 'hostname']));
      const caption = cleanString(getCanonicalFieldValue(fields, ['identity', 'caption']));
      const ipText = joinIps(getCanonicalFieldValue(fields, ['network', 'ip_addresses']));
      const mismatch = hostname !== null && caption !== null && hostname !== caption;

      return prisma.asset.update({
        where: { uuid: a.uuid },
        data: {
          collectedHostname: hostname,
          collectedVmCaption: caption,
          collectedIpText: ipText,
          machineNameVmNameMismatch: mismatch,
        },
        select: { uuid: true },
      });
    });

    await prisma.$transaction(updates);

    processed += assets.length;
    cursor = assets[assets.length - 1]?.uuid ?? null;
    console.log(`[backfill] processed=${processed}`);
  }

  console.log('[backfill] done');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
