import { getAssetFieldMeta } from '@/lib/assets/asset-field-registry';

type ChangeItem = { path: string; labelZh: string; before: string; after: string };
type RelationChangeItem = { type: string; before: string; after: string };

function getLeafValue(fields: unknown, path: string[]): unknown {
  let cursor: unknown = fields;
  for (const key of path) {
    if (!cursor || typeof cursor !== 'object') return null;
    cursor = (cursor as Record<string, unknown>)[key];
  }

  // canonical-v1 leaf: { value, sources, ... }
  if (!cursor || typeof cursor !== 'object') return null;
  return (cursor as Record<string, unknown>).value ?? null;
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${k}:${stableStringify(v)}`).join(',')}}`;
  }
  return String(value);
}

function summarizeValue(value: unknown): string {
  if (value === null || value === undefined) return '';

  // Common canonical values
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  // IP list, etc.
  if (Array.isArray(value)) {
    const strings = value
      .filter((v) => typeof v === 'string')
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
    if (strings.length > 0) return Array.from(new Set(strings)).sort().join(';');
    return stableStringify(value);
  }

  const raw = stableStringify(value);
  return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
}

function equalForCompare(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return stableStringify(a) === stableStringify(b);
}

function extractOutgoingTargets(canonical: unknown): Array<{ type: string; toUuid: string }> {
  if (!canonical || typeof canonical !== 'object') return [];
  const relations = (canonical as Record<string, unknown>).relations;
  if (!relations || typeof relations !== 'object') return [];
  const outgoing = (relations as Record<string, unknown>).outgoing;
  if (!Array.isArray(outgoing)) return [];

  const targets: Array<{ type: string; toUuid: string }> = [];
  for (const item of outgoing) {
    if (!item || typeof item !== 'object') continue;
    const type = (item as Record<string, unknown>).type;
    if (typeof type !== 'string') continue;
    const to = (item as Record<string, unknown>).to;
    if (!to || typeof to !== 'object') continue;
    const toUuid = (to as Record<string, unknown>).asset_uuid;
    if (typeof toUuid !== 'string' || toUuid.trim().length === 0) continue;
    targets.push({ type, toUuid });
  }
  return targets;
}

const KEY_PATHS_BY_ASSET_TYPE: Record<'vm' | 'host' | 'cluster', string[]> = {
  vm: [
    'identity.hostname',
    'identity.caption',
    'network.ip_addresses',
    'os.name',
    'os.version',
    'os.fingerprint',
    'hardware.cpu_count',
    'hardware.memory_bytes',
    'runtime.power_state',
  ],
  host: [
    'identity.hostname',
    'network.ip_addresses',
    'os.name',
    'os.version',
    'hardware.cpu_count',
    'attributes.cpu_threads',
    'hardware.memory_bytes',
    'attributes.disk_total_bytes',
    'attributes.datastore_total_bytes',
  ],
  cluster: ['identity.hostname'],
};

export function computeCollectChangedSummary(args: {
  assetType: string;
  prevCanonical: unknown;
  nextCanonical: unknown;
  maxFields?: number;
  maxRelations?: number;
}): { changes: ChangeItem[]; relationChanges: RelationChangeItem[] } | null {
  const maxFields = args.maxFields ?? 5;
  const maxRelations = args.maxRelations ?? 3;

  const prevFields =
    args.prevCanonical && typeof args.prevCanonical === 'object'
      ? (args.prevCanonical as Record<string, unknown>).fields
      : null;
  const nextFields =
    args.nextCanonical && typeof args.nextCanonical === 'object'
      ? (args.nextCanonical as Record<string, unknown>).fields
      : null;

  const key = args.assetType === 'host' || args.assetType === 'cluster' ? args.assetType : 'vm';
  const paths = KEY_PATHS_BY_ASSET_TYPE[key];

  const changes: ChangeItem[] = [];
  for (const p of paths) {
    const before = getLeafValue(prevFields, p.split('.'));
    const after = getLeafValue(nextFields, p.split('.'));
    if (equalForCompare(before, after)) continue;
    const meta = getAssetFieldMeta(p);
    changes.push({ path: p, labelZh: meta.labelZh, before: summarizeValue(before), after: summarizeValue(after) });
    if (changes.length >= maxFields) break;
  }

  const prevTargets = extractOutgoingTargets(args.prevCanonical);
  const nextTargets = extractOutgoingTargets(args.nextCanonical);

  const relTypes = ['runs_on', 'member_of'];
  const relationChanges: RelationChangeItem[] = [];
  for (const t of relTypes) {
    const before = prevTargets
      .filter((r) => r.type === t)
      .map((r) => r.toUuid)
      .sort()
      .join(';');
    const after = nextTargets
      .filter((r) => r.type === t)
      .map((r) => r.toUuid)
      .sort()
      .join(';');
    if (before === after) continue;
    relationChanges.push({ type: t, before, after });
    if (relationChanges.length >= maxRelations) break;
  }

  if (changes.length === 0 && relationChanges.length === 0) return null;
  return { changes, relationChanges };
}
