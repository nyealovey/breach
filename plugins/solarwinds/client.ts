import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

type SolarWindsHttpError = Error & { status?: number; bodyText?: string };

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

const SOLARWINDS_DEBUG =
  toBooleanValue(process.env.ASSET_LEDGER_SOLARWINDS_DEBUG) ?? toBooleanValue(process.env.ASSET_LEDGER_DEBUG) ?? false;

const SOLARWINDS_DEBUG_EXCERPT_LIMIT = 2000;

function excerpt(text: string, limit = SOLARWINDS_DEBUG_EXCERPT_LIMIT): string {
  return text.length > limit ? text.slice(0, limit) : text;
}

function debugLog(message: string, data?: unknown) {
  if (!SOLARWINDS_DEBUG) return;
  try {
    const logsDir = join(process.cwd(), 'logs');
    mkdirSync(logsDir, { recursive: true });
    const logFile = join(logsDir, `solarwinds-swis-debug-${new Date().toISOString().slice(0, 10)}.log`);
    const payload = {
      ts: new Date().toISOString(),
      level: 'debug',
      component: 'solarwinds.swis',
      message,
      ...(data !== undefined ? { data } : {}),
    };
    appendFileSync(logFile, `${JSON.stringify(payload)}\n`);
  } catch {
    // ignore
  }
}

function makeHttpError(input: { op: string; status: number; bodyText: string }): SolarWindsHttpError {
  const err = new Error(`${input.op} failed with status ${input.status}`) as SolarWindsHttpError;
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
      ...(res.ok ? {} : { body_excerpt: excerpt(bodyText) }),
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

function encodeBasicAuth(username: string, password: string): string {
  return Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
}

export type SwisClient = {
  query: (
    swql: string,
    parameters?: Record<string, unknown>,
  ) => Promise<{ results: Array<Record<string, unknown>>; raw: unknown }>;
};

export function createSwisClient(input: {
  endpoint: string;
  tlsVerify: boolean;
  timeoutMs: number;
  username: string;
  password: string;
}): SwisClient {
  const queryUrl = joinUrl(input.endpoint, '/SolarWinds/InformationService/v3/Json/Query');
  const auth = `Basic ${encodeBasicAuth(input.username, input.password)}`;

  const query = async (swql: string, parameters: Record<string, unknown> = {}) => {
    const op = 'swis.query';
    const res = await fetchTextWithTimeout(
      queryUrl,
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: auth,
        },
        body: JSON.stringify({ query: swql, parameters }),
      },
      input.timeoutMs,
      input.tlsVerify,
    );

    if (!res.ok) throw makeHttpError({ op, status: res.status, bodyText: res.bodyText });

    const parsed = parseJson(res.bodyText, op);
    const obj =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    const resultsRaw = obj ? obj.results : null;
    const results = Array.isArray(resultsRaw)
      ? resultsRaw
          .filter((r) => r && typeof r === 'object' && !Array.isArray(r))
          .map((r) => r as Record<string, unknown>)
      : [];

    return { results, raw: parsed };
  };

  return { query };
}
