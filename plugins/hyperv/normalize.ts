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
    disks?: Array<{ name?: string; size_bytes?: number; type?: 'thin' | 'thick' | 'eagerZeroedThick' }>;
  };
  os?: {
    name?: string;
    version?: string;
    fingerprint?: string;
  };
  runtime?: {
    power_state?: 'poweredOn' | 'poweredOff' | 'suspended';
    tools_running?: boolean;
    tools_status?: string;
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
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const v = typeof raw === 'string' ? raw.trim() : '';
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function mapPowerState(state?: string): 'poweredOn' | 'poweredOff' | 'suspended' | undefined {
  const v = (state ?? '').trim().toLowerCase();
  if (!v) return undefined;
  if (v.includes('running')) return 'poweredOn';
  if (v.includes('off')) return 'poweredOff';
  if (v.includes('paused') || v.includes('saved') || v.includes('suspended')) return 'suspended';
  return undefined;
}

function mapHostPowerState(state?: string | null): 'poweredOn' | 'poweredOff' | 'suspended' | undefined {
  const v = (state ?? '').trim();
  if (!v) return undefined;
  if (v === 'poweredOn' || v === 'poweredOff' || v === 'suspended') return v;

  const lower = v.toLowerCase();
  if (lower === 'up' || lower.includes('up')) return 'poweredOn';
  if (lower === 'down' || lower.includes('down')) return 'poweredOff';
  if (lower.includes('paused') || lower.includes('pause')) return 'suspended';
  return undefined;
}

function isDiskProvisioningType(value: unknown): value is 'thin' | 'thick' | 'eagerZeroedThick' {
  return value === 'thin' || value === 'thick' || value === 'eagerZeroedThick';
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
  ip_addresses?: string[] | null;
  management_ip?: string | null;
  power_state?: string | null;
  datastores?: Array<{ name?: string | null; capacity_bytes?: number | null }> | null;
  disk_total_bytes?: number | null;
}): NormalizedAsset {
  const cpuCount = toFiniteNumber(raw.cpu_count ?? undefined);
  const memoryBytes = toFiniteNumber(raw.memory_bytes ?? undefined);

  const ipAddresses = Array.isArray(raw.ip_addresses) ? uniqueStrings(raw.ip_addresses) : [];
  const mgmtIpRaw = typeof raw.management_ip === 'string' ? raw.management_ip.trim() : '';
  const mgmtIp = mgmtIpRaw.length > 0 ? mgmtIpRaw : null;

  const datastores = Array.isArray(raw.datastores)
    ? raw.datastores
        .map((ds) => {
          if (!ds || typeof ds !== 'object') return null;
          const name = typeof ds.name === 'string' ? ds.name.trim() : '';
          const capRaw = (ds as Record<string, unknown>).capacity_bytes;
          const capacity =
            typeof capRaw === 'number' && Number.isFinite(capRaw) && capRaw >= 0 ? Math.trunc(capRaw) : undefined;
          if (!name || capacity === undefined) return null;
          return { name, capacity_bytes: capacity };
        })
        .filter((ds): ds is NonNullable<typeof ds> => !!ds)
    : [];
  const datastoreTotalBytes = datastores.reduce((acc, ds) => acc + ds.capacity_bytes, 0);

  const powerState = mapHostPowerState(raw.power_state);

  const attributes: Record<string, string | number | boolean | null> = {};
  if (typeof raw.disk_total_bytes === 'number' && Number.isFinite(raw.disk_total_bytes))
    attributes.disk_total_bytes = raw.disk_total_bytes;
  if (datastores.length > 0) attributes.datastore_total_bytes = datastoreTotalBytes;
  const hasAttributes = Object.keys(attributes).length > 0;

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
      ...(ipAddresses.length > 0 || mgmtIp
        ? {
            network: {
              ...(ipAddresses.length > 0 ? { ip_addresses: ipAddresses } : {}),
              ...(mgmtIp ? { management_ip: mgmtIp } : {}),
            },
          }
        : {}),
      ...(powerState ? { runtime: { power_state: powerState } } : {}),
      ...(datastores.length > 0 ? { storage: { datastores } } : {}),
      ...(hasAttributes ? { attributes } : {}),
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
  disks?: Array<{
    name?: string | null;
    size_bytes?: number | null;
    type?: 'thin' | 'thick' | 'eagerZeroedThick' | string | null;
    file_size_bytes?: number | null;
  }> | null;
  disk_file_size_bytes_total?: number | null;
  tools_running?: boolean | null;
  tools_status?: string | null;
}): NormalizedAsset {
  const cpuCount = toFiniteNumber(raw.cpu_count ?? undefined);
  const memoryBytes = toFiniteNumber(raw.memory_bytes ?? undefined);
  const powerState = mapPowerState(raw.state ?? undefined);

  const ipAddresses = Array.isArray(raw.ip_addresses) ? uniqueStrings(raw.ip_addresses) : [];
  const macAddresses = Array.isArray(raw.mac_addresses) ? uniqueStrings(raw.mac_addresses) : [];

  const disks = Array.isArray(raw.disks)
    ? raw.disks
        .map((d) => {
          if (!d || typeof d !== 'object') return null;
          const name = typeof d.name === 'string' && d.name.trim().length > 0 ? d.name.trim() : undefined;
          const sizeRaw = (d as Record<string, unknown>).size_bytes;
          const sizeBytes =
            typeof sizeRaw === 'number' && Number.isFinite(sizeRaw) && sizeRaw >= 0 ? Math.trunc(sizeRaw) : undefined;
          if (!name && sizeBytes === undefined) return null;
          const typeRaw = (d as Record<string, unknown>).type;
          const type = isDiskProvisioningType(typeRaw) ? typeRaw : undefined;

          const out: { name?: string; size_bytes?: number; type?: 'thin' | 'thick' | 'eagerZeroedThick' } = {};
          if (name) out.name = name;
          if (sizeBytes !== undefined) out.size_bytes = sizeBytes;
          if (type) out.type = type;
          return out;
        })
        .filter((d): d is NonNullable<typeof d> => !!d)
    : [];

  const attributes: Record<string, string | number | boolean | null> = {};
  const diskFileTotalRaw = raw.disk_file_size_bytes_total;
  if (typeof diskFileTotalRaw === 'number' && Number.isFinite(diskFileTotalRaw) && diskFileTotalRaw >= 0)
    attributes.disk_file_size_bytes_total = Math.trunc(diskFileTotalRaw);
  const hasAttributes = Object.keys(attributes).length > 0;

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
        ? { hardware: { cpu_count: cpuCount, memory_bytes: memoryBytes, ...(disks.length > 0 ? { disks } : {}) } }
        : disks.length > 0
          ? { hardware: { disks } }
          : {}),
      ...(powerState ||
      typeof raw.tools_running === 'boolean' ||
      (raw.tools_status && raw.tools_status.trim().length > 0)
        ? {
            runtime: {
              ...(powerState ? { power_state: powerState } : {}),
              ...(typeof raw.tools_running === 'boolean' ? { tools_running: raw.tools_running } : {}),
              ...(raw.tools_status && raw.tools_status.trim().length > 0 ? { tools_status: raw.tools_status } : {}),
            },
          }
        : {}),
      ...(ipAddresses.length > 0 || macAddresses.length > 0
        ? { network: { ip_addresses: ipAddresses, mac_addresses: macAddresses } }
        : {}),
      ...(hasAttributes ? { attributes } : {}),
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
