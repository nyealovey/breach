import { normalizeCluster, normalizeHost, normalizeVm } from './normalize';

import type { NormalizedAsset, Relation } from './normalize';
import type { CollectorError } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function invalidPayloadError(cause: string): CollectorError {
  return {
    code: 'HYPERV_PARSE_ERROR',
    category: 'parse',
    message: 'invalid hyperv payload',
    retryable: false,
    redacted_context: { mode: 'collect', cause },
  };
}

export function buildStandaloneInventory(payload: unknown): {
  assets: NormalizedAsset[];
  relations: Relation[];
  stats: { assets: number; relations: number; inventory_complete: boolean; warnings: unknown[] };
  errors: CollectorError[];
  exitCode: number;
} {
  if (!isRecord(payload)) {
    const errors = [invalidPayloadError('payload not object')];
    return {
      assets: [],
      relations: [],
      stats: { assets: 0, relations: 0, inventory_complete: false, warnings: [] },
      errors,
      exitCode: 1,
    };
  }

  const host = isRecord(payload.host) ? (payload.host as any) : null;
  const hostname = host ? nonEmptyString(host.hostname) : null;
  if (!host || !hostname) {
    const errors = [invalidPayloadError('missing host.hostname')];
    return {
      assets: [],
      relations: [],
      stats: { assets: 0, relations: 0, inventory_complete: false, warnings: [] },
      errors,
      exitCode: 1,
    };
  }

  const vms = Array.isArray(payload.vms) ? (payload.vms as any[]) : [];

  const hostAsset = normalizeHost(host);
  const vmAssets = vms.map((vm) => normalizeVm(vm));

  const assets = [hostAsset, ...vmAssets];
  const relations = vmAssets.flatMap((vm) => [
    {
      type: 'runs_on' as const,
      from: { external_kind: 'vm' as const, external_id: vm.external_id },
      to: { external_kind: 'host' as const, external_id: hostAsset.external_id },
      raw_payload: { type: 'runs_on', vm_external_id: vm.external_id, host_external_id: hostAsset.external_id },
    },
    {
      type: 'hosts_vm' as const,
      from: { external_kind: 'host' as const, external_id: hostAsset.external_id },
      to: { external_kind: 'vm' as const, external_id: vm.external_id },
      raw_payload: { type: 'hosts_vm', vm_external_id: vm.external_id, host_external_id: hostAsset.external_id },
    },
  ]);

  return {
    assets,
    relations,
    stats: { assets: assets.length, relations: relations.length, inventory_complete: true, warnings: [] },
    errors: [],
    exitCode: 0,
  };
}

export function buildClusterInventory(payload: unknown): {
  assets: NormalizedAsset[];
  relations: Relation[];
  stats: { assets: number; relations: number; inventory_complete: boolean; warnings: unknown[] };
  errors: CollectorError[];
  exitCode: number;
} {
  if (!isRecord(payload)) {
    const errors = [invalidPayloadError('payload not object')];
    return {
      assets: [],
      relations: [],
      stats: { assets: 0, relations: 0, inventory_complete: false, warnings: [] },
      errors,
      exitCode: 1,
    };
  }

  const clusterName = nonEmptyString(payload.cluster_name);
  if (!clusterName) {
    const errors = [invalidPayloadError('missing cluster_name')];
    return {
      assets: [],
      relations: [],
      stats: { assets: 0, relations: 0, inventory_complete: false, warnings: [] },
      errors,
      exitCode: 1,
    };
  }

  const nodes = Array.isArray(payload.nodes) ? (payload.nodes as any[]) : [];
  const ownerRows = Array.isArray(payload.owner_rows) ? (payload.owner_rows as any[]) : [];

  const ownerByName = new Map<string, string>();
  for (const row of ownerRows) {
    if (!isRecord(row)) continue;
    const name = nonEmptyString(row.name);
    const owner = nonEmptyString(row.owner_node);
    if (name && owner) ownerByName.set(name, owner);
  }

  const nodeResults: Array<{ node: string; hostAsset: NormalizedAsset; vmEntries: any[] }> = [];
  for (const row of nodes) {
    if (!isRecord(row)) continue;
    const node = nonEmptyString(row.node);
    const host = isRecord(row.host) ? (row.host as any) : null;
    const hostname = host ? nonEmptyString(host.hostname) : null;
    if (!node || !host || !hostname) continue;

    const vmEntries = Array.isArray(row.vms) ? (row.vms as any[]) : [];
    nodeResults.push({ node, hostAsset: normalizeHost(host), vmEntries });
  }

  if (nodeResults.length === 0) {
    const errors = [invalidPayloadError('no valid nodes')];
    return {
      assets: [],
      relations: [],
      stats: { assets: 0, relations: 0, inventory_complete: false, warnings: [] },
      errors,
      exitCode: 1,
    };
  }

  const clusterAsset = normalizeCluster({ name: clusterName });
  const hostAssets = nodeResults.map((r) => r.hostAsset);

  // Build a key->hostExternalId mapping for best-effort VM owner mapping.
  const hostIdByNode = new Map<string, string>();
  for (const r of nodeResults) {
    hostIdByNode.set(r.node, r.hostAsset.external_id);
    const hn =
      r.hostAsset.normalized.identity?.hostname && r.hostAsset.normalized.identity.hostname.trim().length > 0
        ? r.hostAsset.normalized.identity.hostname.trim()
        : null;
    if (hn) hostIdByNode.set(hn, r.hostAsset.external_id);
  }

  // Flatten VM entries with their observed node; then dedupe by vm_id (prefer owner node when available).
  const vmCandidates = nodeResults.flatMap((r) =>
    (Array.isArray(r.vmEntries) ? r.vmEntries : []).map((vm) => ({ node: r.node, vm })),
  );
  const picked = new Map<string, { node: string; vm: any }>();
  for (const c of vmCandidates) {
    const vmId = c && c.vm && typeof c.vm.vm_id === 'string' ? c.vm.vm_id : '';
    if (!vmId) continue;

    const vmName = typeof c.vm.name === 'string' ? c.vm.name : '';
    const preferredNode = vmName && ownerByName.has(vmName) ? ownerByName.get(vmName)! : null;

    if (!picked.has(vmId)) {
      picked.set(vmId, c);
      continue;
    }
    if (preferredNode && c.node === preferredNode) {
      picked.set(vmId, c);
    }
  }

  const vmAssets = Array.from(picked.values()).map((c) => normalizeVm(c.vm));

  const memberOfRelations = hostAssets.map((host) => ({
    type: 'member_of' as const,
    from: { external_kind: 'host' as const, external_id: host.external_id },
    to: { external_kind: 'cluster' as const, external_id: clusterAsset.external_id },
    raw_payload: { type: 'member_of', host_external_id: host.external_id, cluster: clusterAsset.external_id },
  }));

  const runsOnRelations = Array.from(picked.values())
    .map((c) => {
      const vmId = typeof c.vm?.vm_id === 'string' ? c.vm.vm_id : null;
      if (!vmId) return null;
      const vmName = typeof c.vm?.name === 'string' ? c.vm.name : null;
      const ownerNode = vmName && ownerByName.has(vmName) ? ownerByName.get(vmName)! : c.node;
      const hostExternalId = hostIdByNode.get(ownerNode) ?? hostIdByNode.get(c.node) ?? null;
      if (!hostExternalId) return null;
      return {
        type: 'runs_on' as const,
        from: { external_kind: 'vm' as const, external_id: vmId },
        to: { external_kind: 'host' as const, external_id: hostExternalId },
        raw_payload: { type: 'runs_on', vm_external_id: vmId, owner_node: ownerNode },
      };
    })
    .filter((r): r is NonNullable<typeof r> => !!r);

  const hostsVmRelations = runsOnRelations.map((r) => ({
    type: 'hosts_vm' as const,
    from: { external_kind: 'host' as const, external_id: r.to.external_id },
    to: { external_kind: 'vm' as const, external_id: r.from.external_id },
    raw_payload: { type: 'hosts_vm', vm_external_id: r.from.external_id, host_external_id: r.to.external_id },
  }));

  const assets = [clusterAsset, ...hostAssets, ...vmAssets];
  const relations = [...memberOfRelations, ...runsOnRelations, ...hostsVmRelations];

  return {
    assets,
    relations,
    stats: { assets: assets.length, relations: relations.length, inventory_complete: true, warnings: [] },
    errors: [],
    exitCode: 0,
  };
}
