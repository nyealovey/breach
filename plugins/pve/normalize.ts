type NormalizedV1 = {
  version: 'normalized-v1';
  kind: 'vm' | 'host' | 'cluster';
  identity?: {
    hostname?: string;
    cloud_native_id?: string;
    caption?: string;
  };
  network?: {
    ip_addresses?: string[];
    mac_addresses?: string[];
    management_ip?: string;
  };
  hardware?: {
    cpu_count?: number;
    memory_bytes?: number;
  };
  os?: {
    name?: string;
    version?: string;
    fingerprint?: string;
  };
  runtime?: {
    power_state?: 'poweredOn' | 'poweredOff' | 'suspended';
  };
  attributes?: Record<string, string | number | boolean | null>;
};

export type NormalizedAsset = {
  external_kind: 'vm' | 'host' | 'cluster';
  external_id: string;
  normalized: NormalizedV1;
  raw_payload: unknown;
};

export type Relation = {
  type: 'runs_on' | 'member_of' | 'hosts_vm';
  from: { external_kind: 'vm' | 'host' | 'cluster'; external_id: string };
  to: { external_kind: 'vm' | 'host' | 'cluster'; external_id: string };
  raw_payload: unknown;
};

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function mapPowerState(status?: string): 'poweredOn' | 'poweredOff' | 'suspended' | undefined {
  const v = (status ?? '').trim().toLowerCase();
  if (!v) return undefined;
  if (v === 'running') return 'poweredOn';
  if (v === 'stopped') return 'poweredOff';
  if (v === 'paused' || v === 'suspended') return 'suspended';
  return undefined;
}

export function normalizeHost(raw: { node: string; status?: unknown; version?: string | null }): NormalizedAsset {
  const status = raw.status && typeof raw.status === 'object' ? (raw.status as Record<string, unknown>) : null;
  const cpuinfo =
    status?.cpuinfo && typeof status.cpuinfo === 'object' ? (status.cpuinfo as Record<string, unknown>) : null;
  const memory =
    status?.memory && typeof status.memory === 'object' ? (status.memory as Record<string, unknown>) : null;

  const cpuCount = toFiniteNumber(cpuinfo?.cpus) ?? toFiniteNumber(cpuinfo?.cores);
  const memoryBytes = toFiniteNumber(memory?.total);

  return {
    external_kind: 'host',
    external_id: raw.node,
    normalized: {
      version: 'normalized-v1',
      kind: 'host',
      identity: { hostname: raw.node },
      ...(raw.version
        ? {
            os: { name: 'Proxmox VE', version: raw.version },
          }
        : {}),
      ...(cpuCount !== undefined || memoryBytes !== undefined
        ? { hardware: { cpu_count: cpuCount, memory_bytes: memoryBytes } }
        : {}),
    },
    raw_payload: raw,
  };
}

export function normalizeVm(raw: {
  node: string;
  vmid: number;
  name?: string;
  status?: string;
  maxmem?: number;
  maxcpu?: number;
  cpus?: number;
  type: 'qemu' | 'lxc';
}): NormalizedAsset {
  const cpuCount = toFiniteNumber(raw.maxcpu) ?? toFiniteNumber(raw.cpus);
  const memoryBytes = toFiniteNumber(raw.maxmem);

  return {
    external_kind: 'vm',
    external_id: `${raw.node}:${raw.vmid}`,
    normalized: {
      version: 'normalized-v1',
      kind: 'vm',
      identity: {
        cloud_native_id: String(raw.vmid),
        ...(raw.name ? { caption: raw.name } : {}),
      },
      ...(cpuCount !== undefined || memoryBytes !== undefined
        ? { hardware: { cpu_count: cpuCount, memory_bytes: memoryBytes } }
        : {}),
      runtime: { power_state: mapPowerState(raw.status) },
    },
    raw_payload: raw,
  };
}

export function normalizeCluster(raw: { name: string }): NormalizedAsset {
  return {
    external_kind: 'cluster',
    external_id: raw.name,
    normalized: {
      version: 'normalized-v1',
      kind: 'cluster',
      identity: { caption: raw.name },
    },
    raw_payload: raw,
  };
}
