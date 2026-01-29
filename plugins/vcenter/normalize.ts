type VmRaw = {
  vm: string;
  instance_uuid?: string;
  identity?: { instance_uuid?: string; bios_uuid?: string; name?: string };
  name?: string;
  guest_OS?: string;
  power_state?: string;
  cpu?: { count?: number; cores_per_socket?: number };
  memory?: { size_MiB?: number };
  disks?: Record<string, { capacity?: number; label?: string }>;
  nics?: Record<string, { mac_address?: string; label?: string }>;
  host?: string;
  // Injected from guest networking API
  guest_networking?: Array<{
    mac_address?: string;
    ip?: { ip_addresses?: Array<{ ip_address: string; state?: string }> };
  }>;
};

type HostRaw = {
  host: string;
  name?: string;
  cluster?: string;
  hardware?: { system_info?: { serial_number?: string } };
  vnics?: Array<{ ip?: { ip_address?: string } }>;
};

type ClusterRaw = {
  cluster: string;
  name?: string;
};

type NormalizedV1 = {
  version: 'normalized-v1';
  kind: 'vm' | 'host' | 'cluster';
  identity?: {
    hostname?: string;
    machine_uuid?: string;
    serial_number?: string;
    caption?: string;
  };
  network?: {
    mac_addresses?: string[];
    ip_addresses?: string[];
    management_ip?: string;
  };
  hardware?: {
    cpu_count?: number;
    memory_mib?: number;
    disk_capacity_bytes?: number;
  };
  state?: {
    power_state?: string;
    guest_os?: string;
  };
};

export type NormalizedAsset = {
  external_kind: 'vm' | 'host' | 'cluster';
  external_id: string;
  normalized: NormalizedV1;
  raw_payload: unknown;
};

export type Relation = {
  type: 'runs_on' | 'member_of';
  from: { external_kind: 'vm' | 'host' | 'cluster'; external_id: string };
  to: { external_kind: 'vm' | 'host' | 'cluster'; external_id: string };
  raw_payload: unknown;
};

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function getFirstString(values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (value && value.trim().length > 0) return value;
  }
  return undefined;
}

export function normalizeVM(raw: VmRaw): NormalizedAsset {
  // Extract MAC addresses from nics (object format from vSphere API)
  const nicValues = raw.nics ? Object.values(raw.nics) : [];
  const macAddresses = uniqueStrings(nicValues.map((nic) => nic.mac_address));

  // Extract IP addresses from guest networking interfaces
  const ipAddresses: string[] = [];
  if (raw.guest_networking) {
    for (const iface of raw.guest_networking) {
      if (iface.ip?.ip_addresses) {
        for (const addr of iface.ip.ip_addresses) {
          if (addr.ip_address && !ipAddresses.includes(addr.ip_address)) {
            ipAddresses.push(addr.ip_address);
          }
        }
      }
    }
  }

  // Calculate total disk capacity
  let totalDiskBytes = 0;
  if (raw.disks) {
    for (const disk of Object.values(raw.disks)) {
      if (disk.capacity) {
        totalDiskBytes += disk.capacity;
      }
    }
  }

  return {
    external_kind: 'vm',
    external_id: raw.vm,
    normalized: {
      version: 'normalized-v1',
      kind: 'vm',
      identity: {
        machine_uuid: raw.identity?.instance_uuid ?? raw.identity?.bios_uuid,
        hostname: raw.name ?? raw.identity?.name,
      },
      network: {
        mac_addresses: macAddresses.length > 0 ? macAddresses : undefined,
        ip_addresses: ipAddresses.length > 0 ? ipAddresses : undefined,
      },
      hardware: {
        cpu_count: raw.cpu?.count,
        memory_mib: raw.memory?.size_MiB,
        disk_capacity_bytes: totalDiskBytes > 0 ? totalDiskBytes : undefined,
      },
      state: {
        power_state: raw.power_state,
        guest_os: raw.guest_OS,
      },
    },
    raw_payload: raw,
  };
}

export function normalizeHost(raw: HostRaw): NormalizedAsset {
  const mgmtIp = getFirstString(raw.vnics?.map((vnic) => vnic.ip?.ip_address) ?? []);
  return {
    external_kind: 'host',
    external_id: raw.host,
    normalized: {
      version: 'normalized-v1',
      kind: 'host',
      identity: {
        hostname: raw.name,
        serial_number: raw.hardware?.system_info?.serial_number,
      },
      network: {
        management_ip: mgmtIp,
      },
    },
    raw_payload: raw,
  };
}

export function normalizeCluster(raw: ClusterRaw): NormalizedAsset {
  return {
    external_kind: 'cluster',
    external_id: raw.cluster,
    normalized: {
      version: 'normalized-v1',
      kind: 'cluster',
      identity: {
        caption: raw.name,
      },
    },
    raw_payload: raw,
  };
}

export function buildRelations(vms: VmRaw[], hosts: HostRaw[], clusters: ClusterRaw[]): Relation[] {
  const hostIds = new Set(hosts.map((host) => host.host));
  const clusterIds = new Set(clusters.map((cluster) => cluster.cluster));

  const relations: Relation[] = [];

  for (const vm of vms) {
    if (!vm.host) continue;
    if (!hostIds.has(vm.host)) continue;
    relations.push({
      type: 'runs_on',
      from: { external_kind: 'vm', external_id: vm.vm },
      to: { external_kind: 'host', external_id: vm.host },
      raw_payload: { vm: vm.vm, host: vm.host },
    });
  }

  for (const host of hosts) {
    if (!host.cluster) continue;
    if (!clusterIds.has(host.cluster)) continue;
    relations.push({
      type: 'member_of',
      from: { external_kind: 'host', external_id: host.host },
      to: { external_kind: 'cluster', external_id: host.cluster },
      raw_payload: { host: host.host, cluster: host.cluster },
    });
  }

  return relations;
}
