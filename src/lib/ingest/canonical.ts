type FieldProvenance = {
  source_id: string;
  run_id: string;
  record_id?: string;
  collected_at?: string;
};

type FieldValue = {
  value: unknown;
  sources: FieldProvenance[];
  conflict?: boolean;
  alternatives?: FieldValue[];
};

type CanonicalNode = FieldValue | { [key: string]: CanonicalNode };

export type CanonicalOutgoingRelation = {
  type: 'runs_on' | 'member_of';
  to: { asset_uuid: string; display_name: string; asset_type?: 'vm' | 'host' | 'cluster' };
  source_id?: string;
  last_seen_at?: string | null;
};

export type CanonicalV1 = {
  version: 'canonical-v1';
  asset_uuid: string;
  asset_type: 'vm' | 'host' | 'cluster';
  status: 'in_service' | 'offline' | 'merged';
  display_name: string;
  last_seen_at: string | null;
  fields: Record<string, CanonicalNode>;
  relations: { outgoing: CanonicalOutgoingRelation[] };
};

function toCanonicalNode(value: unknown, provenance: FieldProvenance): CanonicalNode {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out: Record<string, CanonicalNode> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = toCanonicalNode(child, provenance);
    }
    return out;
  }

  return { value, sources: [provenance] };
}

function deriveDisplayName(normalized: Record<string, unknown>, fallback: string) {
  const identity = normalized.identity;
  if (identity && typeof identity === 'object') {
    const hostname = (identity as Record<string, unknown>).hostname;
    if (typeof hostname === 'string' && hostname.trim().length > 0) return hostname;
    const caption = (identity as Record<string, unknown>).caption;
    if (typeof caption === 'string' && caption.trim().length > 0) return caption;
  }
  return fallback;
}

export function buildCanonicalV1(input: {
  assetUuid: string;
  assetType: 'vm' | 'host' | 'cluster';
  status?: 'in_service' | 'offline' | 'merged';
  sourceId: string;
  runId: string;
  recordId?: string;
  collectedAt: string;
  normalized: Record<string, unknown>;
  outgoingRelations: CanonicalOutgoingRelation[];
}): CanonicalV1 {
  const fields = { ...input.normalized };
  delete (fields as Record<string, unknown>).version;
  delete (fields as Record<string, unknown>).kind;

  const provenance: FieldProvenance = {
    source_id: input.sourceId,
    run_id: input.runId,
    ...(input.recordId ? { record_id: input.recordId } : {}),
    collected_at: input.collectedAt,
  };

  return {
    version: 'canonical-v1',
    asset_uuid: input.assetUuid,
    asset_type: input.assetType,
    status: input.status ?? 'in_service',
    display_name: deriveDisplayName(input.normalized, input.assetUuid),
    last_seen_at: input.collectedAt,
    fields: toCanonicalNode(fields, provenance) as Record<string, CanonicalNode>,
    relations: { outgoing: input.outgoingRelations },
  };
}
