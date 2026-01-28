type VmRaw = {
  vm: string;
  instance_uuid?: string;
  guest?: { host_name?: string };
  nics?: Array<{ mac_address?: string }>;
  host?: string;
};

type HostRaw = {
  host: string;
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
    management_ip?: string;
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
  return {
    external_kind: 'vm',
    external_id: raw.vm,
    normalized: {
      version: 'normalized-v1',
      kind: 'vm',
      identity: {
        machine_uuid: raw.instance_uuid,
        hostname: raw.guest?.host_name,
      },
      network: {
        mac_addresses: uniqueStrings(raw.nics?.map((nic) => nic.mac_address) ?? []),
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
