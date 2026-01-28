type SessionToken = string;

function joinUrl(base: string, path: string) {
  return `${base.replace(/\/+$/, '')}${path}`;
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
    const err = new Error(`createSession failed with status ${result.status}`);
    (err as { status?: number; bodyText?: string }).status = result.status;
    (err as { status?: number; bodyText?: string }).bodyText = result.bodyText;
    throw err;
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
  if (!result.ok) throw new Error(`listVMs failed with status ${result.status}`);
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
  if (!result.ok) throw new Error(`getVmDetail failed with status ${result.status}`);
  return result.data;
}

export async function listHosts(endpoint: string, token: SessionToken): Promise<Array<{ host: string }>> {
  const url = joinUrl(endpoint, '/api/vcenter/host');
  const result = await fetchJson<Array<{ host: string }>>(url, {
    method: 'GET',
    headers: { 'vmware-api-session-id': token },
  });
  if (!result.ok) throw new Error(`listHosts failed with status ${result.status}`);
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
  if (!result.ok) throw new Error(`getHostDetail failed with status ${result.status}`);
  return result.data;
}

export async function listClusters(endpoint: string, token: SessionToken): Promise<Array<{ cluster: string }>> {
  const url = joinUrl(endpoint, '/api/vcenter/cluster');
  const result = await fetchJson<Array<{ cluster: string }>>(url, {
    method: 'GET',
    headers: { 'vmware-api-session-id': token },
  });
  if (!result.ok) throw new Error(`listClusters failed with status ${result.status}`);
  return result.data;
}
