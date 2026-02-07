import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { SessionModel, TaskSessionModel } from './normalize';

type VeeamHttpError = Error & { status?: number; bodyText?: string };

function joinUrl(base: string, path: string) {
  return `${base.replace(/\/+$/, '')}${path}`;
}

function normalizeVeeamEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, '');
  const lower = trimmed.toLowerCase();
  // Allow users to paste ".../api" as the endpoint.
  if (lower.endsWith('/api')) return trimmed.slice(0, -4);
  return trimmed;
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

const VEEAM_DEBUG =
  toBooleanValue(process.env.ASSET_LEDGER_VEEAM_DEBUG) ?? toBooleanValue(process.env.ASSET_LEDGER_DEBUG) ?? false;

function debugLog(message: string, data?: unknown) {
  if (!VEEAM_DEBUG) return;
  try {
    const logsDir = join(process.cwd(), 'logs');
    mkdirSync(logsDir, { recursive: true });
    const logFile = join(logsDir, `veeam-debug-${new Date().toISOString().slice(0, 10)}.log`);
    const payload = {
      ts: new Date().toISOString(),
      level: 'debug',
      component: 'veeam.rest',
      message,
      ...(data !== undefined ? { data } : {}),
    };
    appendFileSync(logFile, `${JSON.stringify(payload)}\n`);
  } catch {
    // ignore
  }
}

function makeHttpError(input: { op: string; status: number; bodyText: string }): VeeamHttpError {
  const err = new Error(`${input.op} failed with status ${input.status}`) as VeeamHttpError;
  err.status = input.status;
  err.bodyText = input.bodyText;
  return err;
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
      ...(res.ok ? {} : { body_excerpt: bodyText.slice(0, 1000) }),
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
    const e = new Error(`${op} returned invalid json: ${err instanceof Error ? err.message : String(err)}`);
    (e as { bodyText?: string }).bodyText = text.slice(0, 2000);
    throw e;
  }
}

function appendQuery(url: URL, params: Record<string, unknown>) {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value) {
        if (v === undefined || v === null) continue;
        url.searchParams.append(key, String(v));
      }
      continue;
    }
    url.searchParams.set(key, String(value));
  }
}

type TokenModel = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
};

type PaginationResult = {
  total: number;
  count: number;
  skip?: number;
  limit?: number;
};

export type ServerInfoModel = {
  vbrId?: string;
  name?: string;
  buildVersion?: string;
  patches?: string[];
  platform?: string;
  databaseVendor?: string;
};

export type VeeamClient = {
  getServerInfo: () => Promise<ServerInfoModel>;
  listSessions: (params: {
    skip?: number;
    limit?: number;
    orderColumn?: string;
    orderAsc?: boolean;
    typeFilter?: string[];
  }) => Promise<{ data: SessionModel[]; pagination: PaginationResult }>;
  listTaskSessions: (
    sessionId: string,
    params: {
      skip?: number;
      limit?: number;
      orderColumn?: string;
      orderAsc?: boolean;
    },
  ) => Promise<{ data: TaskSessionModel[]; pagination: PaginationResult }>;
};

async function loginWithPassword(args: {
  baseUrl: string;
  tlsVerify: boolean;
  timeoutMs: number;
  apiVersion: string;
  username: string;
  password: string;
}): Promise<TokenModel> {
  const op = 'veeam.oauth2.token';
  const url = joinUrl(args.baseUrl, '/api/oauth2/token');

  const form = new URLSearchParams();
  form.set('grant_type', 'password');
  form.set('username', args.username);
  form.set('password', args.password);

  const res = await fetchTextWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
        'x-api-version': args.apiVersion,
      },
      body: form.toString(),
    },
    args.timeoutMs,
    args.tlsVerify,
  );

  if (!res.ok) throw makeHttpError({ op, status: res.status, bodyText: res.bodyText });

  const parsed = parseJson(res.bodyText, op);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${op} returned unexpected response`);
  }

  const obj = parsed as Record<string, unknown>;
  const accessToken = typeof obj.access_token === 'string' ? obj.access_token : null;
  const tokenType = typeof obj.token_type === 'string' ? obj.token_type : null;
  const expiresIn =
    typeof obj.expires_in === 'number' && Number.isFinite(obj.expires_in) ? Math.trunc(obj.expires_in) : null;

  if (!accessToken || !tokenType || expiresIn === null) {
    throw new Error(`${op} returned unexpected response`);
  }

  return {
    access_token: accessToken,
    token_type: tokenType,
    expires_in: expiresIn,
    refresh_token: typeof obj.refresh_token === 'string' ? obj.refresh_token : undefined,
  };
}

export async function createVeeamClient(args: {
  endpoint: string;
  tlsVerify: boolean;
  timeoutMs: number;
  apiVersion: string;
  username: string;
  password: string;
}): Promise<VeeamClient> {
  const baseUrl = normalizeVeeamEndpoint(args.endpoint);

  const token = await loginWithPassword({
    baseUrl,
    tlsVerify: args.tlsVerify,
    timeoutMs: args.timeoutMs,
    apiVersion: args.apiVersion,
    username: args.username,
    password: args.password,
  });

  const authHeader = `${token.token_type} ${token.access_token}`;

  const requestJson = async (op: string, path: string, query: Record<string, unknown> = {}) => {
    const url = new URL(joinUrl(baseUrl, path));
    appendQuery(url, query);

    const res = await fetchTextWithTimeout(
      url.toString(),
      {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: authHeader,
          'x-api-version': args.apiVersion,
        },
      },
      args.timeoutMs,
      args.tlsVerify,
    );

    if (!res.ok) throw makeHttpError({ op, status: res.status, bodyText: res.bodyText });
    return parseJson(res.bodyText, op);
  };

  const getServerInfo = async (): Promise<ServerInfoModel> => {
    const parsed = await requestJson('veeam.serverInfo', '/api/v1/serverInfo');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('veeam.serverInfo returned unexpected response');
    }
    return parsed as ServerInfoModel;
  };

  const listSessions: VeeamClient['listSessions'] = async (params) => {
    const parsed = await requestJson('veeam.sessions', '/api/v1/sessions', params as Record<string, unknown>);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('veeam.sessions returned unexpected response');
    }
    const obj = parsed as Record<string, unknown>;
    const dataRaw = obj.data;
    const paginationRaw = obj.pagination;
    const data = Array.isArray(dataRaw)
      ? dataRaw.filter((v) => v && typeof v === 'object' && !Array.isArray(v)).map((v) => v as SessionModel)
      : [];
    const pagination =
      paginationRaw && typeof paginationRaw === 'object' && !Array.isArray(paginationRaw)
        ? (paginationRaw as PaginationResult)
        : ({ total: data.length, count: data.length } satisfies PaginationResult);
    return { data, pagination };
  };

  const listTaskSessions: VeeamClient['listTaskSessions'] = async (sessionId, params) => {
    const parsed = await requestJson(
      'veeam.taskSessions',
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/taskSessions`,
      params as Record<string, unknown>,
    );
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('veeam.taskSessions returned unexpected response');
    }
    const obj = parsed as Record<string, unknown>;
    const dataRaw = obj.data;
    const paginationRaw = obj.pagination;
    const data = Array.isArray(dataRaw)
      ? dataRaw.filter((v) => v && typeof v === 'object' && !Array.isArray(v)).map((v) => v as TaskSessionModel)
      : [];
    const pagination =
      paginationRaw && typeof paginationRaw === 'object' && !Array.isArray(paginationRaw)
        ? (paginationRaw as PaginationResult)
        : ({ total: data.length, count: data.length } satisfies PaginationResult);
    return { data, pagination };
  };

  return { getServerInfo, listSessions, listTaskSessions };
}
