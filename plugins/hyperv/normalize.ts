type NormalizedV1 = {
  version: 'normalized-v1';
  kind: 'vm' | 'host' | 'cluster';
  identity?: {
    hostname?: string;
    caption?: string;
    machine_uuid?: string;
    serial_number?: string;
    vendor?: string;
    model?: string;
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
  storage?: {
    datastores?: Array<{ name: string; capacity_bytes: number }>;
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

function mapPowerState(state?: string): 'poweredOn' | 'poweredOff' | 'suspended' | undefined {
  const v = (state ?? '').trim().toLowerCase();
  if (!v) return undefined;
  if (v.includes('running')) return 'poweredOn';
  if (v.includes('off')) return 'poweredOff';
  if (v.includes('paused') || v.includes('saved') || v.includes('suspended')) return 'suspended';
  return undefined;
}

export function normalizeHost(raw: {
  hostname: string;
  host_uuid?: string | null;
  serial_number?: string | null;
  vendor?: string | null;
  model?: string | null;
  os_name?: string | null;
  os_version?: string | null;
  cpu_count?: number | null;
  memory_bytes?: number | null;
  management_ip?: string | null;
  disk_total_bytes?: number | null;
}): NormalizedAsset {
  const cpuCount = toFiniteNumber(raw.cpu_count ?? undefined);
  const memoryBytes = toFiniteNumber(raw.memory_bytes ?? undefined);

  return {
    external_kind: 'host',
    external_id: (raw.host_uuid ?? '').trim() || raw.hostname,
    normalized: {
      version: 'normalized-v1',
      kind: 'host',
      identity: {
        hostname: raw.hostname,
        ...(raw.serial_number ? { serial_number: raw.serial_number } : {}),
        ...(raw.vendor ? { vendor: raw.vendor } : {}),
        ...(raw.model ? { model: raw.model } : {}),
      },
      ...(raw.os_name || raw.os_version
        ? {
            os: {
              ...(raw.os_name ? { name: raw.os_name } : {}),
              ...(raw.os_version ? { version: raw.os_version } : {}),
            },
          }
        : {}),
      ...(cpuCount !== undefined || memoryBytes !== undefined
        ? { hardware: { cpu_count: cpuCount, memory_bytes: memoryBytes } }
        : {}),
      ...(raw.management_ip ? { network: { management_ip: raw.management_ip } } : {}),
      ...(typeof raw.disk_total_bytes === 'number' && Number.isFinite(raw.disk_total_bytes)
        ? { attributes: { disk_total_bytes: raw.disk_total_bytes } }
        : {}),
    },
    raw_payload: raw,
  };
}

export function normalizeVm(raw: {
  vm_id: string;
  name?: string | null;
  state?: string | null;
  cpu_count?: number | null;
  memory_bytes?: number | null;
  hostname?: string | null;
  machine_uuid?: string | null;
  ip_addresses?: string[] | null;
  mac_addresses?: string[] | null;
}): NormalizedAsset {
  const cpuCount = toFiniteNumber(raw.cpu_count ?? undefined);
  const memoryBytes = toFiniteNumber(raw.memory_bytes ?? undefined);
  const powerState = mapPowerState(raw.state ?? undefined);

  const ipAddresses = Array.isArray(raw.ip_addresses)
    ? raw.ip_addresses.map((v) => (typeof v === 'string' ? v.trim() : '')).filter((v) => v.length > 0)
    : [];
  const macAddresses = Array.isArray(raw.mac_addresses)
    ? raw.mac_addresses.map((v) => (typeof v === 'string' ? v.trim() : '')).filter((v) => v.length > 0)
    : [];

  return {
    external_kind: 'vm',
    external_id: raw.vm_id,
    normalized: {
      version: 'normalized-v1',
      kind: 'vm',
      identity: {
        ...(raw.hostname ? { hostname: raw.hostname } : {}),
        ...(raw.name ? { caption: raw.name } : {}),
        ...(raw.machine_uuid ? { machine_uuid: raw.machine_uuid } : {}),
      },
      ...(cpuCount !== undefined || memoryBytes !== undefined
        ? { hardware: { cpu_count: cpuCount, memory_bytes: memoryBytes } }
        : {}),
      ...(powerState ? { runtime: { power_state: powerState } } : {}),
      ...(ipAddresses.length > 0 || macAddresses.length > 0
        ? { network: { ip_addresses: ipAddresses, mac_addresses: macAddresses } }
        : {}),
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
