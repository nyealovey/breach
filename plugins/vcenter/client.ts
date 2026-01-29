/**
 * vSphere Automation API Client
 * @see https://developer.broadcom.com/xapis/vsphere-automation-api/v7.0U2/
 */

type SessionToken = string;

function joinUrl(base: string, path: string) {
  return `${base.replace(/\/+$/, '')}${path}`;
}

function makeHttpError(input: { op: string; status: number; bodyText: string }) {
  const err = new Error(`${input.op} failed with status ${input.status}`);
  (err as { status?: number; bodyText?: string }).status = input.status;
  (err as { status?: number; bodyText?: string }).bodyText = input.bodyText;
  return err;
}

async function fetchJson<T>(
  input: string,
  init: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; status: number; bodyText: string }> {
  const res = await fetch(input, init);
  const bodyText = await res.text();
  if (!res.ok) return { ok: false, status: res.status, bodyText };
  return { ok: true, data: JSON.parse(bodyText) as T };
}

export async function createSession(endpoint: string, username: string, password: string): Promise<SessionToken> {
  const url = joinUrl(endpoint, '/api/session');
  const auth = Buffer.from(`${username}:${password}`).toString('base64');

  const result = await fetchJson<unknown>(url, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}` },
  });

  if (!result.ok) {
    throw makeHttpError({ op: 'createSession', status: result.status, bodyText: result.bodyText });
  }

  // vSphere REST typically returns the session id as a JSON string.
  if (typeof result.data === 'string') return result.data;
  throw new Error('createSession returned unexpected response');
}

export async function listVMs(endpoint: string, token: SessionToken): Promise<Array<{ vm: string }>> {
  const url = joinUrl(endpoint, '/api/vcenter/vm');
  const result = await fetchJson<Array<{ vm: string }>>(url, {
    method: 'GET',
    headers: { 'vmware-api-session-id': token },
  });
  if (!result.ok) throw makeHttpError({ op: 'listVMs', status: result.status, bodyText: result.bodyText });
  return result.data;
}

/**
 * List VMs filtered by host
 * @see https://developer.broadcom.com/xapis/vsphere-automation-api/v7.0U2/vcenter/api/vcenter/vm/get/
 * @param hostId - Host identifier to filter VMs by
 * @returns Array of VM summaries on the specified host
 */
export async function listVMsByHost(
  endpoint: string,
  token: SessionToken,
  hostId: string,
): Promise<Array<{ vm: string }>> {
  const url = joinUrl(endpoint, `/api/vcenter/vm?hosts=${encodeURIComponent(hostId)}`);
  const result = await fetchJson<Array<{ vm: string }>>(url, {
    method: 'GET',
    headers: { 'vmware-api-session-id': token },
  });
  if (!result.ok) throw makeHttpError({ op: 'listVMsByHost', status: result.status, bodyText: result.bodyText });
  return result.data;
}

export async function getVmDetail(
  endpoint: string,
  token: SessionToken,
  vmId: string,
): Promise<Record<string, unknown>> {
  const url = joinUrl(endpoint, `/api/vcenter/vm/${encodeURIComponent(vmId)}`);
  const result = await fetchJson<Record<string, unknown>>(url, {
    method: 'GET',
    headers: { 'vmware-api-session-id': token },
  });
  if (!result.ok) throw makeHttpError({ op: 'getVmDetail', status: result.status, bodyText: result.bodyText });
  return result.data;
}

/** Host summary from list API */
export type HostSummary = {
  host: string;
  name?: string;
  connection_state?: string;
  power_state?: string;
};

export async function listHosts(endpoint: string, token: SessionToken): Promise<HostSummary[]> {
  const url = joinUrl(endpoint, '/api/vcenter/host');
  const result = await fetchJson<HostSummary[]>(url, {
    method: 'GET',
    headers: { 'vmware-api-session-id': token },
  });
  if (!result.ok) throw makeHttpError({ op: 'listHosts', status: result.status, bodyText: result.bodyText });
  return result.data;
}

/**
 * List Hosts filtered by cluster
 * @see https://developer.broadcom.com/xapis/vsphere-automation-api/v7.0U2/vcenter/api/vcenter/host/get/
 */
export async function listHostsByCluster(
  endpoint: string,
  token: SessionToken,
  clusterId: string,
): Promise<HostSummary[]> {
  const url = joinUrl(endpoint, `/api/vcenter/host?clusters=${encodeURIComponent(clusterId)}`);
  const result = await fetchJson<HostSummary[]>(url, {
    method: 'GET',
    headers: { 'vmware-api-session-id': token },
  });
  if (!result.ok) throw makeHttpError({ op: 'listHostsByCluster', status: result.status, bodyText: result.bodyText });
  return result.data;
}

export async function getHostDetail(
  endpoint: string,
  token: SessionToken,
  hostId: string,
): Promise<Record<string, unknown>> {
  const url = joinUrl(endpoint, `/api/vcenter/host/${encodeURIComponent(hostId)}`);
  const result = await fetchJson<Record<string, unknown>>(url, {
    method: 'GET',
    headers: { 'vmware-api-session-id': token },
  });
  if (!result.ok) throw makeHttpError({ op: 'getHostDetail', status: result.status, bodyText: result.bodyText });
  return result.data;
}

export async function listClusters(endpoint: string, token: SessionToken): Promise<Array<{ cluster: string }>> {
  const url = joinUrl(endpoint, '/api/vcenter/cluster');
  const result = await fetchJson<Array<{ cluster: string }>>(url, {
    method: 'GET',
    headers: { 'vmware-api-session-id': token },
  });
  if (!result.ok) throw makeHttpError({ op: 'listClusters', status: result.status, bodyText: result.bodyText });
  return result.data;
}

/**
 * Guest networking interface info
 * @see https://developer.broadcom.com/xapis/vsphere-automation-api/v7.0U2/vcenter/api/vcenter/vm/vm/guest/networking/interfaces/get/
 */
export type GuestNetworkInterface = {
  /** MAC address of the interface */
  mac_address?: string;
  /** NIC device key */
  nic?: string;
  /** IP configuration */
  ip?: {
    ip_addresses?: Array<{
      /** IP address (IPv4 or IPv6) */
      ip_address: string;
      /** Subnet prefix length */
      prefix_length?: number;
      /** Origin of the IP address (DHCP, STATIC, etc.) */
      origin?: string;
      /** State of the IP address */
      state?: string;
    }>;
  };
};

/**
 * Guest networking info (includes hostname)
 * @see https://developer.broadcom.com/xapis/vsphere-automation-api/v7.0U2/vcenter/api/vcenter/vm/vm/guest/networking/get/
 */
export type GuestNetworkingInfo = {
  dns_values?: {
    /** Guest hostname */
    host_name?: string;
    /** Guest domain name */
    domain_name?: string;
  };
  dns?: {
    ip_addresses?: string[];
    search_domains?: string[];
  };
};

export async function getVmGuestNetworking(
  endpoint: string,
  token: SessionToken,
  vmId: string,
): Promise<GuestNetworkInterface[]> {
  const url = joinUrl(endpoint, `/api/vcenter/vm/${encodeURIComponent(vmId)}/guest/networking/interfaces`);
  const result = await fetchJson<GuestNetworkInterface[]>(url, {
    method: 'GET',
    headers: { 'vmware-api-session-id': token },
  });
  if (!result.ok) {
    // VMware Tools not running or other errors - return empty array instead of throwing
    return [];
  }
  return result.data;
}

/**
 * Get guest networking info including hostname
 * @see https://developer.broadcom.com/xapis/vsphere-automation-api/v7.0U2/vcenter/api/vcenter/vm/vm/guest/networking/get/
 */
export async function getVmGuestNetworkingInfo(
  endpoint: string,
  token: SessionToken,
  vmId: string,
): Promise<GuestNetworkingInfo | null> {
  const url = joinUrl(endpoint, `/api/vcenter/vm/${encodeURIComponent(vmId)}/guest/networking`);
  const result = await fetchJson<GuestNetworkingInfo>(url, {
    method: 'GET',
    headers: { 'vmware-api-session-id': token },
  });
  if (!result.ok) {
    // VMware Tools not running or other errors - return null
    return null;
  }
  return result.data;
}

/**
 * VMware Tools info
 * @see https://developer.broadcom.com/xapis/vsphere-automation-api/v7.0U2/vcenter/api/vcenter/vm/vm/tools/get/
 */
export type VmToolsInfo = {
  /** Whether VMware Tools is running in the guest */
  run_state?: 'NOT_RUNNING' | 'RUNNING' | 'EXECUTING_SCRIPTS';
  /** Version status of VMware Tools */
  version_status?: 'NOT_INSTALLED' | 'CURRENT' | 'UNMANAGED' | 'TOO_OLD_UNSUPPORTED' | 'TOO_OLD' | 'TOO_NEW' | 'BLACKLISTED' | 'SUPPORTED_OLD' | 'SUPPORTED_NEW';
  /** VMware Tools version number */
  version_number?: number;
  /** VMware Tools version string */
  version?: string;
};

/**
 * Get VMware Tools status for a VM
 * @see https://developer.broadcom.com/xapis/vsphere-automation-api/v7.0U2/vcenter/api/vcenter/vm/vm/tools/get/
 */
export async function getVmTools(
  endpoint: string,
  token: SessionToken,
  vmId: string,
): Promise<VmToolsInfo | null> {
  const url = joinUrl(endpoint, `/api/vcenter/vm/${encodeURIComponent(vmId)}/tools`);
  const result = await fetchJson<VmToolsInfo>(url, {
    method: 'GET',
    headers: { 'vmware-api-session-id': token },
  });
  if (!result.ok) {
    // Tools API not available - return null
    return null;
  }
  return result.data;
}
