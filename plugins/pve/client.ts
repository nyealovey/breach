type PveHttpError = Error & { status?: number; bodyText?: string };

function joinUrl(base: string, path: string) {
  return `${base.replace(/\/+$/, '')}${path}`;
}

function makeHttpError(input: { op: string; status: number; bodyText: string }): PveHttpError {
  const err = new Error(`${input.op} failed with status ${input.status}`) as PveHttpError;
  err.status = input.status;
  err.bodyText = input.bodyText;
  return err;
}

function unwrapData<T>(data: unknown, op: string): T {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !('data' in (data as Record<string, unknown>))) {
    throw new Error(`${op} returned unexpected response`);
  }
  return (data as Record<string, unknown>).data as T;
}

async function fetchTextWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  tlsVerify: boolean,
): Promise<{ ok: true; status: number; bodyText: string } | { ok: false; status: number; bodyText: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Bun fetch supports a non-standard `tls` option; keep it typed as `any` for compatibility.
    const res = await fetch(url, { ...init, signal: controller.signal, tls: { rejectUnauthorized: tlsVerify } } as any);
    const bodyText = await res.text();
    return { ok: res.ok, status: res.status, bodyText };
  } finally {
    clearTimeout(timeout);
  }
}

function parseJson(text: string, op: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    const e = new Error(`${op} returned invalid json: ${err instanceof Error ? err.message : String(err)}`);
    (e as { bodyText?: string }).bodyText = text.slice(0, 2000);
    throw e;
  }
}

export type PveAuth =
  | { type: 'api_token'; headers: Record<string, string> }
  | { type: 'user_password'; headers: Record<string, string> };

export async function createPveAuth(input: {
  endpoint: string;
  tlsVerify: boolean;
  timeoutMs: number;
  credential: unknown;
}): Promise<PveAuth> {
  const cred = input.credential as Record<string, unknown>;
  const authType = typeof cred.auth_type === 'string' ? cred.auth_type : undefined;

  const tokenId = typeof cred.api_token_id === 'string' ? cred.api_token_id : undefined;
  const tokenSecret = typeof cred.api_token_secret === 'string' ? cred.api_token_secret : undefined;
  if (authType === 'api_token' || (tokenId && tokenSecret)) {
    if (!tokenId || !tokenSecret) throw new Error('missing api_token_id/api_token_secret');
    return {
      type: 'api_token',
      headers: { Authorization: `PVEAPIToken=${tokenId}=${tokenSecret}` },
    };
  }

  const username = typeof cred.username === 'string' ? cred.username : undefined;
  const password = typeof cred.password === 'string' ? cred.password : undefined;
  if (authType === 'user_password' || (username && password)) {
    if (!username || !password) throw new Error('missing username/password');

    const url = joinUrl(input.endpoint, '/api2/json/access/ticket');
    const body = new URLSearchParams({ username, password });
    const res = await fetchTextWithTimeout(
      url,
      {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body,
      },
      input.timeoutMs,
      input.tlsVerify,
    );

    if (!res.ok) throw makeHttpError({ op: 'pve.login', status: res.status, bodyText: res.bodyText });

    const parsed = parseJson(res.bodyText, 'pve.login');
    const data = unwrapData<Record<string, unknown>>(parsed, 'pve.login');
    const ticketRaw = typeof data.ticket === 'string' ? data.ticket.trim() : '';
    if (!ticketRaw) throw new Error('pve.login returned empty ticket');

    const cookiePair = ticketRaw.startsWith('PVEAuthCookie=') ? ticketRaw : `PVEAuthCookie=${ticketRaw}`;
    return { type: 'user_password', headers: { Cookie: cookiePair } };
  }

  throw new Error('unsupported credential payload');
}

export async function pveGet<T>(input: {
  endpoint: string;
  path: string;
  authHeaders: Record<string, string>;
  tlsVerify: boolean;
  timeoutMs: number;
}): Promise<T> {
  const url = joinUrl(input.endpoint, input.path);
  const res = await fetchTextWithTimeout(
    url,
    { method: 'GET', headers: { accept: 'application/json', ...input.authHeaders } },
    input.timeoutMs,
    input.tlsVerify,
  );

  if (!res.ok) throw makeHttpError({ op: `GET ${input.path}`, status: res.status, bodyText: res.bodyText });
  const parsed = parseJson(res.bodyText, `GET ${input.path}`);
  return unwrapData<T>(parsed, `GET ${input.path}`);
}
