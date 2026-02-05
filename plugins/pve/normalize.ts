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
    disks?: Array<{
      name?: string;
      size_bytes?: number;
    }>;
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

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = typeof raw === 'string' ? raw.trim() : '';
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function mapPowerState(status?: string): 'poweredOn' | 'poweredOff' | 'suspended' | undefined {
  const v = (status ?? '').trim().toLowerCase();
  if (!v) return undefined;
  if (v === 'running') return 'poweredOn';
  if (v === 'stopped') return 'poweredOff';
  if (v === 'paused' || v === 'suspended') return 'suspended';
  return undefined;
}

export function normalizeHost(raw: {
  node: string;
  status?: unknown;
  version?: string | null;
  ip_addresses?: string[];
  management_ip?: string;
  power_state?: 'poweredOn' | 'poweredOff' | 'suspended';
  datastores?: Array<{ name: string; capacity_bytes: number }>;
}): NormalizedAsset {
  const status = raw.status && typeof raw.status === 'object' ? (raw.status as Record<string, unknown>) : null;
  const cpuinfo =
    status?.cpuinfo && typeof status.cpuinfo === 'object' ? (status.cpuinfo as Record<string, unknown>) : null;
  const memory =
    status?.memory && typeof status.memory === 'object' ? (status.memory as Record<string, unknown>) : null;
  const rootfs =
    status?.rootfs && typeof status.rootfs === 'object' ? (status.rootfs as Record<string, unknown>) : null;

  const cpuCount = toFiniteNumber(cpuinfo?.cpus) ?? toFiniteNumber(cpuinfo?.cores);
  const memoryBytes = toFiniteNumber(memory?.total);
  const diskTotalBytes = toFiniteNumber(rootfs?.total);

  const datastores =
    raw.datastores
      ?.map((ds) => ({ name: ds.name.trim(), capacity_bytes: ds.capacity_bytes }))
      .filter((ds) => ds.name.length > 0 && Number.isFinite(ds.capacity_bytes) && ds.capacity_bytes >= 0) ?? [];
  const datastoreTotalBytes = datastores.reduce((acc, ds) => acc + ds.capacity_bytes, 0);

  const attributes: Record<string, string | number | boolean | null> = {};
  if (diskTotalBytes !== undefined) attributes.disk_total_bytes = diskTotalBytes;
  if (datastores.length > 0) attributes.datastore_total_bytes = datastoreTotalBytes;
  const hasAttributes = Object.keys(attributes).length > 0;

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
      ...(raw.ip_addresses && raw.ip_addresses.length > 0
        ? {
            network: {
              ip_addresses: raw.ip_addresses,
              management_ip: raw.management_ip,
            },
          }
        : raw.management_ip
          ? { network: { management_ip: raw.management_ip } }
          : {}),
      ...(cpuCount !== undefined || memoryBytes !== undefined
        ? { hardware: { cpu_count: cpuCount, memory_bytes: memoryBytes } }
        : {}),
      ...(raw.power_state ? { runtime: { power_state: raw.power_state } } : {}),
      ...(datastores.length > 0 ? { storage: { datastores } } : {}),
      ...(hasAttributes ? { attributes } : {}),
    },
    raw_payload: raw,
  };
}

export function normalizeVm(raw: {
  node: string;
  vmid: number;
  name?: string;
  status?: string;
  hostname?: string;
  maxmem?: number;
  maxcpu?: number;
  cpus?: number;
  type: 'qemu' | 'lxc';
  ip_addresses?: string[];
  mac_addresses?: string[];
  disks?: Array<{ name?: string; size_bytes?: number }>;
}): NormalizedAsset {
  const cpuCount = toFiniteNumber(raw.maxcpu) ?? toFiniteNumber(raw.cpus);
  const memoryBytes = toFiniteNumber(raw.maxmem);
  const powerState = mapPowerState(raw.status);

  const ipAddresses = raw.ip_addresses ? uniqueStrings(raw.ip_addresses) : [];
  const macAddresses = raw.mac_addresses ? uniqueStrings(raw.mac_addresses) : [];
  const disks = Array.isArray(raw.disks) ? raw.disks : [];

  return {
    external_kind: 'vm',
    external_id: `${raw.node}:${raw.vmid}`,
    normalized: {
      version: 'normalized-v1',
      kind: 'vm',
      identity: {
        cloud_native_id: String(raw.vmid),
        ...(raw.hostname ? { hostname: raw.hostname } : {}),
        ...(raw.name ? { caption: raw.name } : {}),
      },
      ...(ipAddresses.length > 0 || macAddresses.length > 0
        ? {
            network: {
              ...(ipAddresses.length > 0 ? { ip_addresses: ipAddresses } : {}),
              ...(macAddresses.length > 0 ? { mac_addresses: macAddresses } : {}),
            },
          }
        : {}),
      ...(cpuCount !== undefined || memoryBytes !== undefined
        ? {
            hardware: {
              ...(cpuCount !== undefined ? { cpu_count: cpuCount } : {}),
              ...(memoryBytes !== undefined ? { memory_bytes: memoryBytes } : {}),
              ...(disks.length > 0 ? { disks } : {}),
            },
          }
        : disks.length > 0
          ? { hardware: { disks } }
          : {}),
      ...(powerState ? { runtime: { power_state: powerState } } : {}),
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
