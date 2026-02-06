type NormalizedV1 = {
  version: 'normalized-v1';
  kind: 'vm' | 'host' | 'cluster';
  identity?: {
    hostname?: string;
    caption?: string;
  };
  network?: {
    ip_addresses?: string[];
  };
  os?: {
    name?: string;
    version?: string;
    fingerprint?: string;
  };
  attributes?: Record<string, string | number | boolean | null>;
};

export type NormalizedAsset = {
  external_kind: 'vm' | 'host' | 'cluster';
  external_id: string;
  normalized: NormalizedV1;
  raw_payload: unknown;
};

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseNodeId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    // SWIS should return NodeID as a number, but be defensive: accept numeric strings.
    const n = Number(trimmed);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

function parseSwisDateToIso(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  // SWIS commonly uses /Date(1700000000000)/ format.
  const m = /^\/Date\((\d+)([+-]\d{4})?\)\/$/.exec(trimmed);
  if (m) {
    const ms = Number(m[1]);
    if (!Number.isFinite(ms)) return null;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }

  const d = new Date(trimmed);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function mapMonitorStatus(raw: {
  status?: unknown;
  unmanaged?: unknown;
}): 'up' | 'down' | 'warning' | 'unmanaged' | 'unknown' {
  if (raw.unmanaged === true) return 'unmanaged';
  const status = raw.status;
  if (typeof status === 'number') {
    if (status === 1) return 'up';
    if (status === 2) return 'down';
    if (status === 3) return 'warning';
  }
  if (typeof status === 'string') {
    const s = status.trim().toLowerCase();
    if (s === 'up') return 'up';
    if (s === 'down') return 'down';
    if (s === 'warning') return 'warning';
    if (s === 'unmanaged') return 'unmanaged';
  }
  return 'unknown';
}

export function normalizeNode(row: Record<string, unknown>): NormalizedAsset | null {
  const nodeIdRaw = row.NodeID ?? row.nodeId ?? row.node_id;
  const nodeId = parseNodeId(nodeIdRaw);
  if (nodeId === null) return null;

  const caption = cleanString(row.Caption ?? row.caption);
  const sysName = cleanString(row.SysName ?? row.sysName ?? row.systemName);
  const dns = cleanString(row.DNS ?? row.dns);
  const ip = cleanString(row.IPAddress ?? row.ipAddress ?? row.ip);

  const hostname = sysName ?? dns ?? null;
  const displayCaption = caption ?? sysName ?? dns ?? null;

  const unmanaged = row.UnManaged ?? row.unmanaged ?? row.unManaged;
  const status = row.Status ?? row.status;
  const statusDesc = cleanString(row.StatusDescription ?? row.statusDescription);
  const lastSyncIso = parseSwisDateToIso(row.LastSync ?? row.lastSync ?? row.LastSeen ?? row.lastSeen);

  const monitorStatus = mapMonitorStatus({ status, unmanaged });

  const attributes: Record<string, string | number | boolean | null> = {
    monitor_covered: true,
    monitor_status: monitorStatus,
    monitor_node_id: String(nodeId),
    ...(lastSyncIso ? { monitor_last_seen_at: lastSyncIso } : {}),
    ...(statusDesc ? { monitor_status_raw: statusDesc } : {}),
  };

  return {
    external_kind: 'host',
    external_id: String(nodeId),
    normalized: {
      version: 'normalized-v1',
      kind: 'host',
      ...(hostname || displayCaption
        ? {
            identity: {
              ...(hostname ? { hostname } : {}),
              ...(displayCaption ? { caption: displayCaption } : {}),
            },
          }
        : {}),
      ...(ip
        ? {
            network: { ip_addresses: [ip] },
          }
        : {}),
      attributes,
    },
    raw_payload: row,
  };
}
