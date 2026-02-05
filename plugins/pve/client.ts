import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

type PveHttpError = Error & { status?: number; bodyText?: string };

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

const PVE_DEBUG =
  toBooleanValue(process.env.ASSET_LEDGER_PVE_DEBUG) ?? toBooleanValue(process.env.ASSET_LEDGER_DEBUG) ?? false;

const PVE_DEBUG_EXCERPT_LIMIT = 2000;

function excerpt(text: string, limit = PVE_DEBUG_EXCERPT_LIMIT): string {
  return text.length > limit ? text.slice(0, limit) : text;
}

function shouldLogBodyExcerpt(url: string): boolean {
  try {
    const u = new URL(url);
    // Never log the /access/ticket response body excerpt to avoid leaking auth cookies.
    return !u.pathname.endsWith('/api2/json/access/ticket');
  } catch {
    return true;
  }
}

function debugLog(message: string, data?: unknown) {
  if (!PVE_DEBUG) return;
  try {
    const logsDir = join(process.cwd(), 'logs');
    mkdirSync(logsDir, { recursive: true });
    const logFile = join(logsDir, `pve-rest-debug-${new Date().toISOString().slice(0, 10)}.log`);
    const payload = {
      ts: new Date().toISOString(),
      level: 'debug',
      component: 'pve.rest',
      message,
      ...(data !== undefined ? { data } : {}),
    };
    appendFileSync(logFile, `${JSON.stringify(payload)}\n`);
  } catch {
    // ignore
  }
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
  const start = Date.now();
  try {
    // Bun fetch supports a non-standard `tls` option; keep it typed as `any` for compatibility.
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      tls: { rejectUnauthorized: tlsVerify },
    } as any);
    const bodyText = await res.text();
    debugLog('http.response', {
      method: init.method ?? 'GET',
      url,
      status: res.status,
      ok: res.ok,
      duration_ms: Date.now() - start,
      body_length: bodyText.length,
      ...(res.ok || !shouldLogBodyExcerpt(url) ? {} : { body_excerpt: excerpt(bodyText) }),
    });
    return { ok: res.ok, status: res.status, bodyText };
  } catch (err) {
    debugLog('http.fetch_error', {
      method: init.method ?? 'GET',
      url,
      tls_verify: tlsVerify,
      timeout_ms: timeoutMs,
      duration_ms: Date.now() - start,
      cause: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function parseJson(text: string, op: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    debugLog('http.json_parse_error', {
      op,
      cause: err instanceof Error ? err.message : String(err),
      body_length: text.length,
      body_excerpt: excerpt(text),
    });
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
    debugLog('auth.api_token', { token_id: tokenId });
    return {
      type: 'api_token',
      headers: { Authorization: `PVEAPIToken=${tokenId}=${tokenSecret}` },
    };
  }

  const rawUsername = typeof cred.username === 'string' ? cred.username : undefined;
  const password = typeof cred.password === 'string' ? cred.password : undefined;
  if (authType === 'user_password' || (rawUsername && password)) {
    if (!rawUsername || !password) throw new Error('missing username/password');

    const hasRealm = rawUsername.includes('@');
    const realmRaw = typeof cred.realm === 'string' ? cred.realm.trim() : '';
    const realm = realmRaw.length > 0 ? realmRaw : 'pam';
    const username = hasRealm ? rawUsername : `${rawUsername}@${realm}`;
    debugLog('auth.user_password', {
      raw_username: rawUsername,
      username,
      ...(hasRealm
        ? { username_has_realm: true }
        : { username_has_realm: false, realm, used_default_realm: realmRaw.length === 0 }),
    });

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
