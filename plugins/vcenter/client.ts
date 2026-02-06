/**
 * vSphere Automation API Client
 * @see https://developer.broadcom.com/xapis/vsphere-automation-api/v7.0U2/
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

type SessionToken = string;

function joinUrl(base: string, path: string) {
  return `${base.replace(/\/+$/, '')}${path}`;
}

function toBooleanValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  return undefined;
}

const VCENTER_DEBUG =
  toBooleanValue(process.env.ASSET_LEDGER_VCENTER_DEBUG) ?? toBooleanValue(process.env.ASSET_LEDGER_DEBUG) ?? false;

const REST_DEBUG_EXCERPT_LIMIT = 2000;

function excerpt(text: string, limit = REST_DEBUG_EXCERPT_LIMIT): string {
  return text.length > limit ? text.slice(0, limit) : text;
}

function debugLog(message: string, data?: unknown) {
  if (!VCENTER_DEBUG) return;
  try {
    const logsDir = join(process.cwd(), 'logs');
    mkdirSync(logsDir, { recursive: true });
    const logFile = join(logsDir, `vcenter-rest-debug-${new Date().toISOString().slice(0, 10)}.log`);
    const payload = {
      ts: new Date().toISOString(),
      level: 'debug',
      component: 'vcenter.rest',
      message,
      ...(data !== undefined ? { data } : {}),
    };
    appendFileSync(logFile, `${JSON.stringify(payload)}\n`);
  } catch {
    // ignore
  }
}

function makeHttpError(input: { op: string; status: number; bodyText: string }) {
  const err = new Error(`${input.op} failed with status ${input.status}`);
  (err as { status?: number; bodyText?: string }).status = input.status;
  (err as { status?: number; bodyText?: string }).bodyText = input.bodyText;
  return err;
}

function unwrapValue<T>(data: unknown): T {
  // Some vSphere Automation API deployments wrap payloads as `{ value: ... }`.
  if (data && typeof data === 'object' && !Array.isArray(data) && 'value' in (data as Record<string, unknown>)) {
    return (data as Record<string, unknown>).value as T;
  }
  return data as T;
}

function unwrapArray<T>(data: unknown, op: string): T[] {
  const unwrapped = unwrapValue<unknown>(data);
  if (Array.isArray(unwrapped)) return unwrapped as T[];
  debugLog(`${op}.unexpected_response`, {
    data_type: typeof data,
    keys: data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data as Record<string, unknown>) : [],
  });
  throw new Error(`${op} returned unexpected response`);
}

function unwrapObject<T extends Record<string, unknown>>(data: unknown, op: string): T {
  const unwrapped = unwrapValue<unknown>(data);
  if (unwrapped && typeof unwrapped === 'object' && !Array.isArray(unwrapped)) return unwrapped as T;
  debugLog(`${op}.unexpected_response`, {
    data_type: typeof data,
    keys: data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data as Record<string, unknown>) : [],
  });
  throw new Error(`${op} returned unexpected response`);
}

async function fetchJson<T>(
  input: string,
  init: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; status: number; bodyText: string }> {
  const start = Date.now();
  const res = await fetch(input, init);
  const bodyText = await res.text();
  debugLog('http.response', {
    method: init.method ?? 'GET',
    url: input,
    status: res.status,
    ok: res.ok,
    duration_ms: Date.now() - start,
    body_length: bodyText.length,
    ...(res.ok ? {} : { body_excerpt: excerpt(bodyText) }),
  });
  if (!res.ok) return { ok: false, status: res.status, bodyText };
  try {
    return { ok: true, data: JSON.parse(bodyText) as T };
  } catch (err) {
    debugLog('http.json_parse_error', {
      method: init.method ?? 'GET',
      url: input,
      cause: err instanceof Error ? err.message : String(err),
      body_length: bodyText.length,
      body_excerpt: excerpt(bodyText),
    });
    throw err;
  }
}

export type VcenterApiRoot = 'api' | 'rest';
export type VmByHostFilter = 'hosts' | 'filter.hosts';

export type VcenterPlan = {
  apiRoot: VcenterApiRoot;
  sessionPath: string;
  vmByHostFilter: VmByHostFilter;
};

export function resolveVcenterPlan(preferred: '6.5-6.7' | '7.0-8.x'): VcenterPlan {
  if (preferred === '6.5-6.7') {
    return { apiRoot: 'rest', sessionPath: '/rest/com/vmware/cis/session', vmByHostFilter: 'filter.hosts' };
  }
  return { apiRoot: 'api', sessionPath: '/api/session', vmByHostFilter: 'hosts' };
}

function plannedApiPath(plan: VcenterPlan, apiPath: string): string {
  if (plan.apiRoot === 'api') return apiPath;
  return apiPath.replace(/^\/api\//, '/rest/');
}

async function fetchJsonPlanned<T>(
  endpoint: string,
  plan: VcenterPlan,
  apiPath: string,
  init: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; status: number; bodyText: string }> {
  const url = joinUrl(endpoint, plannedApiPath(plan, apiPath));
  return await fetchJson<T>(url, init);
}

function unwrapValueDeep(data: unknown, maxDepth = 3): unknown {
  let current: unknown = data;
  for (let i = 0; i < maxDepth; i++) {
    if (
      current &&
      typeof current === 'object' &&
      !Array.isArray(current) &&
      'value' in (current as Record<string, unknown>)
    ) {
      current = (current as Record<string, unknown>).value;
      continue;
    }
    break;
  }
  return current;
}

function parseSessionToken(data: unknown): SessionToken | null {
  const unwrapped = unwrapValueDeep(data);
  if (typeof unwrapped === 'string' && unwrapped.trim().length > 0) return unwrapped;
  return null;
}

function getSessionTokenFromHeaders(headers: Headers): SessionToken | null {
  const value = headers.get('vmware-api-session-id');
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function createSession(
  endpoint: string,
  username: string,
  password: string,
  plan: VcenterPlan,
): Promise<SessionToken> {
  const auth = Buffer.from(`${username}:${password}`).toString('base64');
  const headers = {
    Authorization: `Basic ${auth}`,
    // Some deployments/proxies require Content-Type for POST even with an empty body.
    'content-type': 'application/json',
    accept: 'application/json',
  };

  async function postSession(path: string) {
    const url = joinUrl(endpoint, path);
    const start = Date.now();
    const res = await fetch(url, { method: 'POST', headers });
    const bodyText = await res.text();
    debugLog('http.response', {
      method: 'POST',
      url,
      status: res.status,
      ok: res.ok,
      duration_ms: Date.now() - start,
      body_length: bodyText.length,
      ...(res.ok ? {} : { body_excerpt: excerpt(bodyText) }),
    });

    const headerToken = getSessionTokenFromHeaders(res.headers);
    if (!res.ok) return { ok: false as const, status: res.status, bodyText, headerToken };

    if (bodyText.trim().length === 0) {
      return { ok: true as const, status: res.status, bodyText, data: null as unknown, headerToken };
    }

    try {
      return { ok: true as const, status: res.status, bodyText, data: JSON.parse(bodyText) as unknown, headerToken };
    } catch (err) {
      debugLog('http.json_parse_error', {
        method: 'POST',
        url,
        cause: err instanceof Error ? err.message : String(err),
        body_length: bodyText.length,
        body_excerpt: excerpt(bodyText),
      });

      // Some older setups can still succeed but return a non-JSON body, while providing the session id in headers.
      if (headerToken) {
        return { ok: true as const, status: res.status, bodyText, data: null as unknown, headerToken };
      }
      throw err;
    }
  }

  const result = await postSession(plan.sessionPath);
  if (!result.ok) {
    throw makeHttpError({
      op: `createSession(${plan.apiRoot})`,
      status: result.status,
      bodyText: result.bodyText,
    });
  }

  const token = parseSessionToken(result.data) ?? result.headerToken;
  if (token) return token;

  debugLog('createSession.unexpected_response', {
    endpoint: plan.sessionPath,
    data_type: typeof result.data,
    keys:
      result.data && typeof result.data === 'object' && !Array.isArray(result.data)
        ? Object.keys(result.data as Record<string, unknown>)
        : [],
  });

  const err = new Error('createSession returned unexpected response') as Error & { status?: number; bodyText?: string };
  err.status = result.status;
  err.bodyText = result.bodyText;
  throw err;
}

export async function listVMs(
  endpoint: string,
  token: SessionToken,
  plan: VcenterPlan,
): Promise<Array<{ vm: string }>> {
  const result = await fetchJsonPlanned<Array<{ vm: string }>>(endpoint, plan, '/api/vcenter/vm', {
    method: 'GET',
    headers: { 'vmware-api-session-id': token },
  });
  if (!result.ok) throw makeHttpError({ op: 'listVMs', status: result.status, bodyText: result.bodyText });
  return unwrapArray<{ vm: string }>(result.data, 'listVMs');
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
  plan: VcenterPlan,
): Promise<Array<{ vm: string }>> {
  const headers = { 'vmware-api-session-id': token };

  const apiPath =
    plan.vmByHostFilter === 'hosts'
      ? `/api/vcenter/vm?hosts=${encodeURIComponent(hostId)}`
      : `/api/vcenter/vm?filter.hosts=${encodeURIComponent(hostId)}`;

  const result = await fetchJsonPlanned<Array<{ vm: string }>>(endpoint, plan, apiPath, {
    method: 'GET',
    headers,
  });
  if (!result.ok) throw makeHttpError({ op: 'listVMsByHost', status: result.status, bodyText: result.bodyText });
  return unwrapArray<{ vm: string }>(result.data, 'listVMsByHost');
}

export async function getVmDetail(
  endpoint: string,
  token: SessionToken,
  vmId: string,
  plan: VcenterPlan,
): Promise<Record<string, unknown>> {
  const apiPath = `/api/vcenter/vm/${encodeURIComponent(vmId)}`;
  const result = await fetchJsonPlanned<Record<string, unknown>>(endpoint, plan, apiPath, {
    method: 'GET',
    headers: { 'vmware-api-session-id': token },
  });
  if (!result.ok) throw makeHttpError({ op: 'getVmDetail', status: result.status, bodyText: result.bodyText });
  return unwrapObject<Record<string, unknown>>(result.data, 'getVmDetail');
}

/** Host summary from list API */
export type HostSummary = {
  host: string;
  name?: string;
  connection_state?: string;
  power_state?: string;
};

export async function listHosts(endpoint: string, token: SessionToken, plan: VcenterPlan): Promise<HostSummary[]> {
  const result = await fetchJsonPlanned<HostSummary[]>(endpoint, plan, '/api/vcenter/host', {
    method: 'GET',
    headers: { 'vmware-api-session-id': token },
  });
  if (!result.ok) throw makeHttpError({ op: 'listHosts', status: result.status, bodyText: result.bodyText });
  return unwrapArray<HostSummary>(result.data, 'listHosts');
}

/**
 * List Hosts filtered by cluster
 * @see https://developer.broadcom.com/xapis/vsphere-automation-api/v7.0U2/vcenter/api/vcenter/host/get/
 */
export async function listHostsByCluster(
  endpoint: string,
  token: SessionToken,
  clusterId: string,
  plan: VcenterPlan,
): Promise<HostSummary[]> {
  const apiPath = `/api/vcenter/host?clusters=${encodeURIComponent(clusterId)}`;
  const result = await fetchJsonPlanned<HostSummary[]>(endpoint, plan, apiPath, {
    method: 'GET',
    headers: { 'vmware-api-session-id': token },
  });
  if (!result.ok) throw makeHttpError({ op: 'listHostsByCluster', status: result.status, bodyText: result.bodyText });
  return unwrapArray<HostSummary>(result.data, 'listHostsByCluster');
}

export async function getHostDetail(
  endpoint: string,
  token: SessionToken,
  hostId: string,
  plan: VcenterPlan,
): Promise<Record<string, unknown>> {
  const apiPath = `/api/vcenter/host/${encodeURIComponent(hostId)}`;
  const result = await fetchJsonPlanned<Record<string, unknown>>(endpoint, plan, apiPath, {
    method: 'GET',
    headers: { 'vmware-api-session-id': token },
  });
  if (!result.ok) throw makeHttpError({ op: 'getHostDetail', status: result.status, bodyText: result.bodyText });
  return unwrapObject<Record<string, unknown>>(result.data, 'getHostDetail');
}

export async function listClusters(
  endpoint: string,
  token: SessionToken,
  plan: VcenterPlan,
): Promise<Array<{ cluster: string }>> {
  const result = await fetchJsonPlanned<Array<{ cluster: string }>>(endpoint, plan, '/api/vcenter/cluster', {
    method: 'GET',
    headers: { 'vmware-api-session-id': token },
  });
  if (!result.ok) throw makeHttpError({ op: 'listClusters', status: result.status, bodyText: result.bodyText });
  return unwrapArray<{ cluster: string }>(result.data, 'listClusters');
}

/**
 * vCenter system version info
 * @see https://developer.broadcom.com/xapis/vsphere-automation-api/latest/vcenter/api/vcenter/system/version/get/
 */
export type VcenterSystemVersion = {
  product?: string;
  type?: string;
  version?: string;
  build?: string;
  install_time?: string;
};

export async function getVcenterSystemVersion(
  endpoint: string,
  token: SessionToken,
  plan: VcenterPlan,
): Promise<VcenterSystemVersion | null> {
  const result = await fetchJsonPlanned<VcenterSystemVersion>(endpoint, plan, '/api/vcenter/system/version', {
    method: 'GET',
    headers: { 'vmware-api-session-id': token },
  });
  if (!result.ok) return null;
  return unwrapObject<VcenterSystemVersion>(result.data, 'getVcenterSystemVersion');
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
  plan: VcenterPlan,
): Promise<GuestNetworkInterface[]> {
  const apiPath = `/api/vcenter/vm/${encodeURIComponent(vmId)}/guest/networking/interfaces`;
  const result = await fetchJsonPlanned<GuestNetworkInterface[]>(endpoint, plan, apiPath, {
    method: 'GET',
    headers: { 'vmware-api-session-id': token },
  });
  if (!result.ok) {
    // VMware Tools not running or other errors - return empty array instead of throwing
    return [];
  }
  return unwrapArray<GuestNetworkInterface>(result.data, 'getVmGuestNetworking');
}

/**
 * Get guest networking info including hostname
 * @see https://developer.broadcom.com/xapis/vsphere-automation-api/v7.0U2/vcenter/api/vcenter/vm/vm/guest/networking/get/
 */
export async function getVmGuestNetworkingInfo(
  endpoint: string,
  token: SessionToken,
  vmId: string,
  plan: VcenterPlan,
): Promise<GuestNetworkingInfo | null> {
  const apiPath = `/api/vcenter/vm/${encodeURIComponent(vmId)}/guest/networking`;
  const result = await fetchJsonPlanned<GuestNetworkingInfo>(endpoint, plan, apiPath, {
    method: 'GET',
    headers: { 'vmware-api-session-id': token },
  });
  if (!result.ok) {
    // VMware Tools not running or other errors - return null
    return null;
  }
  return unwrapObject<GuestNetworkingInfo>(result.data, 'getVmGuestNetworkingInfo');
}

/**
 * VMware Tools info
 * @see https://developer.broadcom.com/xapis/vsphere-automation-api/v7.0U2/vcenter/api/vcenter/vm/vm/tools/get/
 */
export type VmToolsInfo = {
  /** Whether VMware Tools is running in the guest */
  run_state?: 'NOT_RUNNING' | 'RUNNING' | 'EXECUTING_SCRIPTS';
  /** Version status of VMware Tools */
  version_status?:
    | 'NOT_INSTALLED'
    | 'CURRENT'
    | 'UNMANAGED'
    | 'TOO_OLD_UNSUPPORTED'
    | 'TOO_OLD'
    | 'TOO_NEW'
    | 'BLACKLISTED'
    | 'SUPPORTED_OLD'
    | 'SUPPORTED_NEW';
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
  plan: VcenterPlan,
): Promise<VmToolsInfo | null> {
  const apiPath = `/api/vcenter/vm/${encodeURIComponent(vmId)}/tools`;
  const result = await fetchJsonPlanned<VmToolsInfo>(endpoint, plan, apiPath, {
    method: 'GET',
    headers: { 'vmware-api-session-id': token },
  });
  if (!result.ok) {
    // Tools API not available - return null
    return null;
  }
  return unwrapObject<VmToolsInfo>(result.data, 'getVmTools');
}
