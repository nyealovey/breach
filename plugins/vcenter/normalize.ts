/**
 * vSphere VM API response types
 * @see https://developer.broadcom.com/xapis/vsphere-automation-api/v7.0U2/vcenter/api/vcenter/vm/vm/get/
 */

/** VM detail from GET /api/vcenter/vm/{vm} */
type VmRaw = {
  /** VM identifier (injected by collector, not from API) */
  vm: string;
  /** VM display name */
  name?: string;
  /** Guest operating system identifier (e.g., "RHEL_8_64", "WINDOWS_9_64") */
  guest_OS?: string;
  /** Power state: POWERED_ON | POWERED_OFF | SUSPENDED */
  power_state?: 'POWERED_ON' | 'POWERED_OFF' | 'SUSPENDED';
  /** VM identity information */
  identity?: {
    name?: string;
    bios_uuid?: string;
    instance_uuid?: string;
  };
  /** CPU configuration */
  cpu?: {
    count?: number;
    cores_per_socket?: number;
    hot_add_enabled?: boolean;
    hot_remove_enabled?: boolean;
  };
  /** Memory configuration */
  memory?: {
    size_MiB?: number;
    hot_add_enabled?: boolean;
    hot_add_increment_size_MiB?: number;
    hot_add_limit_MiB?: number;
  };
  /** Virtual disks (keyed by disk ID, e.g., "2000") */
  disks?: Record<
    string,
    {
      label?: string;
      type?: string;
      capacity?: number;
      backing?: { type?: string; vmdk_file?: string };
    }
  >;
  /** Network adapters (keyed by NIC ID, e.g., "4000") */
  nics?: Record<
    string,
    {
      label?: string;
      type?: string;
      mac_type?: string;
      mac_address?: string;
      state?: string;
      start_connected?: boolean;
      backing?: { type?: string; network?: string; network_name?: string };
    }
  >;
  /** Host running this VM (from list API, not detail) */
  host?: string;
  /**
   * Guest networking interfaces (injected from separate API call)
   * @see https://developer.broadcom.com/xapis/vsphere-automation-api/v7.0U2/vcenter/api/vcenter/vm/vm/guest/networking/interfaces/get/
   */
  guest_networking?: Array<{
    mac_address?: string;
    nic?: string;
    ip?: {
      ip_addresses?: Array<{
        ip_address: string;
        prefix_length?: number;
        origin?: string;
        state?: string;
      }>;
    };
  }>;
  /**
   * Guest networking info including hostname (injected from separate API call)
   * @see https://developer.broadcom.com/xapis/vsphere-automation-api/v7.0U2/vcenter/api/vcenter/vm/vm/guest/networking/get/
   */
  guest_networking_info?: {
    dns_values?: {
      /** Guest hostname (the actual machine name inside the VM) */
      host_name?: string;
      domain_name?: string;
    };
  };
  /**
   * VMware Tools status (injected from separate API call)
   * @see https://developer.broadcom.com/xapis/vsphere-automation-api/v7.0U2/vcenter/api/vcenter/vm/vm/tools/get/
   */
  tools?: {
    run_state?: 'NOT_RUNNING' | 'RUNNING' | 'EXECUTING_SCRIPTS';
    version_status?: string;
  };
};

/**
 * vSphere Host API response types
 * @see https://developer.broadcom.com/xapis/vsphere-automation-api/v7.0U2/vcenter/api/vcenter/host/get/
 *
 * Note: vSphere REST API has limited Host information.
 * For full Host details (ESXi version, hardware model, CPU type),
 * SOAP API (govmomi/pyVmomi) is required.
 */
import type { HostSoapDetails } from './soap';

type HostRaw = {
  /** Host identifier */
  host: string;
  /** Host display name */
  name?: string;
  /** Cluster this host belongs to (from list API filter or injected) */
  cluster?: string;
  /** Connection state: CONNECTED | DISCONNECTED | NOT_RESPONDING */
  connection_state?: string;
  /** Power state: POWERED_ON | POWERED_OFF | STANDBY */
  power_state?: string;
  /** Hardware information (from detail API, may not be available) */
  hardware?: {
    system_info?: {
      serial_number?: string;
      vendor?: string;
      model?: string;
    };
  };
  /** Virtual NICs for management network (from detail API, may not be available) */
  vnics?: Array<{
    ip?: {
      ip_address?: string;
    };
  }>;

  /** Host details collected via vSphere SOAP (vim25). */
  soap?: HostSoapDetails;
};

/**
 * vSphere Cluster API response types
 * @see https://developer.broadcom.com/xapis/vsphere-automation-api/v7.0U2/vcenter/api/vcenter/cluster/cluster/get/
 */
type ClusterRaw = {
  /** Cluster identifier */
  cluster: string;
  /** Cluster display name */
  name?: string;
};

type NormalizedV1 = {
  version: 'normalized-v1';
  kind: 'vm' | 'host' | 'cluster';
  identity?: {
    hostname?: string;
    machine_uuid?: string;
    serial_number?: string;
    vendor?: string;
    model?: string;
    caption?: string;
  };
  network?: {
    mac_addresses?: string[];
    ip_addresses?: string[];
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
    /** Whether VMware Tools is running (only for VMs) */
    tools_running?: boolean;
    /** VMware Tools version status (only for VMs) */
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

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

// Check if an IP address is IPv4
function isIPv4(ip: string): boolean {
  // IPv4 pattern: x.x.x.x where x is 0-255
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  return ipv4Pattern.test(ip);
}

// Map vCenter power state to normalized format
function mapPowerState(vcenterState?: string): 'poweredOn' | 'poweredOff' | 'suspended' | undefined {
  if (!vcenterState) return undefined;
  const normalized = vcenterState.trim();

  // Already normalized.
  if (normalized === 'poweredOn' || normalized === 'poweredOff' || normalized === 'suspended') return normalized;

  const map: Record<string, 'poweredOn' | 'poweredOff' | 'suspended'> = {
    POWERED_ON: 'poweredOn',
    POWERED_OFF: 'poweredOff',
    SUSPENDED: 'suspended',
  };

  // Support case/format differences.
  const upper = normalized.toUpperCase();
  if (upper in map) return map[upper];

  const lower = normalized.toLowerCase();
  if (lower === 'poweredon') return 'poweredOn';
  if (lower === 'poweredoff') return 'poweredOff';

  return undefined;
}

export function normalizeVM(raw: VmRaw): NormalizedAsset {
  // Extract MAC addresses from nics (object format from vSphere API)
  const nicValues = raw.nics ? Object.values(raw.nics) : [];
  const macAddresses = uniqueStrings(nicValues.map((nic) => nic.mac_address));

  // Extract IPv4 addresses only from guest networking interfaces
  const ipAddresses: string[] = [];
  if (raw.guest_networking) {
    for (const iface of raw.guest_networking) {
      if (iface.ip?.ip_addresses) {
        for (const addr of iface.ip.ip_addresses) {
          // Only include IPv4 addresses
          if (addr.ip_address && isIPv4(addr.ip_address) && !ipAddresses.includes(addr.ip_address)) {
            ipAddresses.push(addr.ip_address);
          }
        }
      }
    }
  }

  // Build disks array
  const disks: Array<{ name?: string; size_bytes?: number }> = [];
  if (raw.disks) {
    for (const [key, disk] of Object.entries(raw.disks)) {
      if (disk.capacity) {
        disks.push({
          name: disk.label ?? key,
          size_bytes: disk.capacity,
        });
      }
    }
  }

  // Get guest hostname (the actual machine name inside the VM)
  // Priority: guest_networking_info.dns_values.host_name (actual guest hostname)
  // Fallback: VM name (only if guest hostname not available)
  const guestHostname = raw.guest_networking_info?.dns_values?.host_name;

  // Get VMware Tools status
  const toolsRunning = raw.tools?.run_state === 'RUNNING' || raw.tools?.run_state === 'EXECUTING_SCRIPTS';
  const toolsStatus = raw.tools?.version_status;

  // vCenter 6.5 compatibility: tolerate older/alternate field shapes.
  const cpuCount =
    toFiniteNumber(raw.cpu?.count) ??
    toFiniteNumber((raw as unknown as Record<string, unknown>).cpu_count) ??
    toFiniteNumber((raw as unknown as Record<string, unknown>).cpuCount) ??
    toFiniteNumber((raw.cpu as unknown as Record<string, unknown> | undefined)?.cpu_count);

  const memoryMiB =
    toFiniteNumber(raw.memory?.size_MiB) ??
    toFiniteNumber((raw as unknown as Record<string, unknown>).memory_size_MiB) ??
    toFiniteNumber((raw as unknown as Record<string, unknown>).memory_size_mib) ??
    toFiniteNumber((raw as unknown as Record<string, unknown>).memoryMiB) ??
    toFiniteNumber((raw.memory as unknown as Record<string, unknown> | undefined)?.size_mib);

  const memoryBytes = memoryMiB !== undefined ? memoryMiB * 1024 * 1024 : undefined;

  return {
    external_kind: 'vm',
    external_id: raw.vm,
    normalized: {
      version: 'normalized-v1',
      kind: 'vm',
      identity: {
        machine_uuid: raw.identity?.instance_uuid ?? raw.identity?.bios_uuid,
        // VM display name (platform name). This is different from the guest hostname.
        caption: raw.name ?? raw.identity?.name ?? raw.vm,
        // Use guest hostname (actual machine name) if available, otherwise undefined
        hostname: guestHostname || undefined,
      },
      network: {
        mac_addresses: macAddresses.length > 0 ? macAddresses : undefined,
        ip_addresses: ipAddresses.length > 0 ? ipAddresses : undefined,
      },
      hardware: {
        cpu_count: cpuCount,
        memory_bytes: memoryBytes,
        disks: disks.length > 0 ? disks : undefined,
      },
      os: raw.guest_OS ? { fingerprint: raw.guest_OS } : undefined,
      runtime: {
        power_state: mapPowerState(raw.power_state),
        tools_running: raw.tools ? toolsRunning : undefined,
        tools_status: toolsStatus,
      },
    },
    raw_payload: raw,
  };
}

export function normalizeHost(raw: HostRaw): NormalizedAsset {
  const soap = raw.soap;
  const vnicIps = raw.vnics?.map((vnic) => vnic.ip?.ip_address) ?? [];
  const ipAddresses = uniqueStrings([...(soap?.ipAddresses ?? []), soap?.managementIp, ...vnicIps]);
  const mgmtIp = getFirstString([getFirstString(vnicIps), soap?.managementIp, ipAddresses[0]]);

  const datastores =
    soap?.datastores
      ?.map((ds) => ({ name: ds.name.trim(), capacity_bytes: ds.capacityBytes }))
      .filter((ds) => ds.name.length > 0 && Number.isFinite(ds.capacity_bytes) && ds.capacity_bytes >= 0) ?? [];

  const attributes: Record<string, string | number | boolean | null> = {};
  if (soap?.diskTotalBytes !== undefined) attributes.disk_total_bytes = soap.diskTotalBytes;
  if (soap?.datastoreTotalBytes !== undefined) attributes.datastore_total_bytes = soap.datastoreTotalBytes;
  if (soap?.cpuModel !== undefined) attributes.cpu_model = soap.cpuModel;
  if (soap?.cpuMhz !== undefined) attributes.cpu_mhz = soap.cpuMhz;
  if (soap?.cpuPackages !== undefined) attributes.cpu_packages = soap.cpuPackages;
  if (soap?.cpuThreads !== undefined) attributes.cpu_threads = soap.cpuThreads;

  const hasAttributes = Object.keys(attributes).length > 0;

  return {
    external_kind: 'host',
    external_id: raw.host,
    normalized: {
      version: 'normalized-v1',
      kind: 'host',
      identity: {
        hostname: raw.name,
        serial_number: getFirstString([raw.hardware?.system_info?.serial_number, soap?.systemSerialNumber]),
        vendor: getFirstString([raw.hardware?.system_info?.vendor, soap?.systemVendor]),
        model: getFirstString([raw.hardware?.system_info?.model, soap?.systemModel]),
      },
      network: {
        management_ip: mgmtIp,
        ip_addresses: ipAddresses.length > 0 ? ipAddresses : undefined,
      },
      os:
        soap?.esxiVersion || soap?.esxiBuild
          ? {
              name: 'ESXi',
              ...(soap.esxiVersion ? { version: soap.esxiVersion } : {}),
              ...(soap.esxiBuild ? { fingerprint: soap.esxiBuild } : {}),
            }
          : undefined,
      hardware:
        soap?.cpuCores !== undefined || soap?.memoryBytes !== undefined
          ? { cpu_count: soap?.cpuCores, memory_bytes: soap?.memoryBytes }
          : undefined,
      storage: datastores.length > 0 || soap?.datastores ? { datastores } : undefined,
      attributes: hasAttributes ? attributes : undefined,
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

    // VM → Host (runs_on)
    relations.push({
      type: 'runs_on',
      from: { external_kind: 'vm', external_id: vm.vm },
      to: { external_kind: 'host', external_id: vm.host },
      raw_payload: { vm: vm.vm, host: vm.host },
    });

    // Host → VM (hosts_vm) - reverse relation for Host to show its VMs
    relations.push({
      type: 'hosts_vm',
      from: { external_kind: 'host', external_id: vm.host },
      to: { external_kind: 'vm', external_id: vm.vm },
      raw_payload: { host: vm.host, vm: vm.vm },
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
