type NormalizedV1 = {
  version: 'normalized-v1';
  kind: 'vm' | 'host' | 'cluster';
  identity?: {
    hostname?: string;
    caption?: string;
    machine_uuid?: string;
    serial_number?: string;
    cloud_native_id?: string;
    vendor?: string;
    model?: string;
    product_name?: string;
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
  location?: {
    region?: string;
    city?: string;
    cabinet?: string;
    position?: string;
  };
  ownership?: {
    department?: string;
    owner_name?: string;
    owner_email?: string;
    cc_emails?: string[];
  };
  service?: {
    system_name?: string;
    applications?: string[];
    service_level?: string;
  };
  physical?: {
    cpu_model?: string;
    cpu_cores?: number;
    cpu_threads?: number;
    cpu_sockets?: number;
    cpu_base_hz?: number;
    cpu_max_hz?: number;
    cpu_features?: string[];
    bios_vendor?: string;
    bios_version?: string;
    bios_date?: string;
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

export type EcsInstanceRaw = {
  instanceId?: string;
  instanceName?: string;
  hostName?: string;
  cpu?: number;
  memory?: number;
  status?: string;
  OSName?: string;
  OSNameEn?: string;
  OSType?: string;
  publicIpAddress?: { ipAddress?: string[] } | null;
  innerIpAddress?: { ipAddress?: string[] } | null;
  networkInterfaces?: {
    networkInterface?: Array<{
      macAddress?: string;
      primaryIpAddress?: string;
      privateIpSets?: { privateIpSet?: Array<{ privateIpAddress?: string }> } | null;
    }>;
  } | null;
};

export type RdsInstanceRaw = {
  DBInstanceId?: string;
  DBInstanceDescription?: string;
  DBInstanceStatus?: string;
  connectionMode?: string;
  connectionString?: string;
  engine?: string;
  engineVersion?: string;
  DBInstanceClass?: string;
  DBInstanceCPU?: string;
  DBInstanceMemory?: number;
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

function isIpAddress(input: string): boolean {
  // Good enough for v1 (IPv4 only).
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(input);
}

function mapPowerState(input?: string): 'poweredOn' | 'poweredOff' | 'suspended' | undefined {
  const v = (input ?? '').trim().toLowerCase();
  if (!v) return undefined;
  if (v === 'running') return 'poweredOn';
  if (v === 'stopped') return 'poweredOff';
  // ECS/RDS do not have a reliable suspended state in list APIs.
  return undefined;
}

export function normalizeEcsVm(args: { raw: EcsInstanceRaw; regionId: string }): NormalizedAsset {
  const instanceId = typeof args.raw.instanceId === 'string' ? args.raw.instanceId.trim() : '';
  if (!instanceId) {
    throw new Error('missing instanceId');
  }

  const cpuCount = toFiniteNumber(args.raw.cpu);
  const memoryMiB = toFiniteNumber(args.raw.memory);
  const memoryBytes = memoryMiB !== undefined ? Math.trunc(memoryMiB * 1024 * 1024) : undefined;

  const caption = typeof args.raw.instanceName === 'string' ? args.raw.instanceName.trim() : '';
  const hostname = typeof args.raw.hostName === 'string' ? args.raw.hostName.trim() : '';

  const ipAddresses = uniqueStrings([
    ...(args.raw.innerIpAddress?.ipAddress ?? []),
    ...(args.raw.publicIpAddress?.ipAddress ?? []),
    ...(args.raw.networkInterfaces?.networkInterface?.map((nic) => nic.primaryIpAddress) ?? []),
    ...(args.raw.networkInterfaces?.networkInterface?.flatMap(
      (nic) => nic.privateIpSets?.privateIpSet?.map((row) => row.privateIpAddress) ?? [],
    ) ?? []),
  ]);

  const macAddresses = uniqueStrings(args.raw.networkInterfaces?.networkInterface?.map((nic) => nic.macAddress) ?? []);

  const osName = typeof args.raw.OSName === 'string' ? args.raw.OSName.trim() : '';
  const osNameEn = typeof args.raw.OSNameEn === 'string' ? args.raw.OSNameEn.trim() : '';
  const osType = typeof args.raw.OSType === 'string' ? args.raw.OSType.trim() : '';
  const osResolved = osName || osNameEn || osType;

  const powerState = mapPowerState(args.raw.status);

  return {
    external_kind: 'vm',
    external_id: `ecs:${instanceId}`,
    normalized: {
      version: 'normalized-v1',
      kind: 'vm',
      identity: {
        cloud_native_id: instanceId,
        ...(hostname ? { hostname } : {}),
        ...(caption ? { caption } : {}),
      },
      ...(args.regionId ? { location: { region: args.regionId } } : {}),
      ...(osResolved
        ? {
            os: {
              name: osResolved,
            },
          }
        : {}),
      ...(cpuCount !== undefined || memoryBytes !== undefined
        ? {
            hardware: {
              ...(cpuCount !== undefined ? { cpu_count: cpuCount } : {}),
              ...(memoryBytes !== undefined ? { memory_bytes: memoryBytes } : {}),
            },
          }
        : {}),
      ...(ipAddresses.length > 0 || macAddresses.length > 0
        ? {
            network: {
              ...(ipAddresses.length > 0 ? { ip_addresses: ipAddresses } : {}),
              ...(macAddresses.length > 0 ? { mac_addresses: macAddresses } : {}),
            },
          }
        : {}),
      ...(powerState ? { runtime: { power_state: powerState } } : {}),
    },
    raw_payload: args.raw,
  };
}

function parseHostFromConnectionString(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';

  // Most RDS connection strings do not include scheme; best-effort parse.
  const noScheme = trimmed.replace(/^[a-z]+:\/\//i, '');
  const hostPort = noScheme.split('/')[0] ?? '';
  const host = hostPort.split(':')[0] ?? '';
  return host.trim();
}

export function normalizeRdsVm(args: { raw: RdsInstanceRaw; regionId: string }): NormalizedAsset {
  const id = typeof args.raw.DBInstanceId === 'string' ? args.raw.DBInstanceId.trim() : '';
  if (!id) {
    throw new Error('missing DBInstanceId');
  }

  const description = typeof args.raw.DBInstanceDescription === 'string' ? args.raw.DBInstanceDescription.trim() : '';
  const connectionString = typeof args.raw.connectionString === 'string' ? args.raw.connectionString.trim() : '';
  const host = connectionString ? parseHostFromConnectionString(connectionString) : '';

  const powerState = mapPowerState(args.raw.DBInstanceStatus);

  const cpuCountRaw = typeof args.raw.DBInstanceCPU === 'string' ? Number(args.raw.DBInstanceCPU) : undefined;
  const cpuCount =
    typeof cpuCountRaw === 'number' && Number.isFinite(cpuCountRaw) && cpuCountRaw > 0 ? cpuCountRaw : undefined;
  const memoryMb = toFiniteNumber(args.raw.DBInstanceMemory);
  const memoryBytes = memoryMb !== undefined ? Math.trunc(memoryMb * 1024 * 1024) : undefined;

  const ipAddresses = host && isIpAddress(host) ? [host] : [];

  const attributes: Record<string, string | number | boolean | null> = {};
  if (args.raw.engine) attributes.rds_engine = args.raw.engine;
  if (args.raw.engineVersion) attributes.rds_engine_version = args.raw.engineVersion;
  if (args.raw.DBInstanceClass) attributes.rds_instance_class = args.raw.DBInstanceClass;
  if (args.raw.connectionMode) attributes.rds_connection_mode = args.raw.connectionMode;
  if (connectionString) attributes.rds_connection_string = connectionString;
  const hasAttributes = Object.keys(attributes).length > 0;

  return {
    external_kind: 'vm',
    external_id: `rds:${id}`,
    normalized: {
      version: 'normalized-v1',
      kind: 'vm',
      identity: {
        cloud_native_id: id,
        ...(host ? { hostname: host } : {}),
        ...(description ? { caption: description } : { caption: id }),
      },
      ...(args.regionId ? { location: { region: args.regionId } } : {}),
      ...(cpuCount !== undefined || memoryBytes !== undefined
        ? {
            hardware: {
              ...(cpuCount !== undefined ? { cpu_count: cpuCount } : {}),
              ...(memoryBytes !== undefined ? { memory_bytes: memoryBytes } : {}),
            },
          }
        : {}),
      ...(powerState ? { runtime: { power_state: powerState } } : {}),
      ...(ipAddresses.length > 0 ? { network: { ip_addresses: ipAddresses } } : {}),
      ...(hasAttributes ? { attributes } : {}),
    },
    raw_payload: args.raw,
  };
}
