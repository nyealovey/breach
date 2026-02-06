import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

type SolarWindsHttpError = Error & { status?: number; bodyText?: string };

function normalizeSwisQueryUrl(endpoint: string): string {
  const trimmed = endpoint.trim();
  const normalized = trimmed.replace(/\/+$/, '');
  const path = '/SolarWinds/InformationService/v3/Json/Query';
  const lower = normalized.toLowerCase();
  const pathLower = path.toLowerCase();
  if (lower.endsWith(pathLower)) return normalized;
  return `${normalized}${path}`;
}

function encodeBasicAuth(username: string, password: string): string {
  return Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
}

function makeHttpError(input: { op: string; status: number; bodyText: string }): SolarWindsHttpError {
  const err = new Error(`${input.op} failed with status ${input.status}`) as SolarWindsHttpError;
  err.status = input.status;
  err.bodyText = input.bodyText;
  return err;
}

async function postJsonText(args: {
  url: string;
  payload: unknown;
  headers: Record<string, string>;
  timeoutMs: number;
  tlsVerify: boolean;
}): Promise<{ status: number; bodyText: string }> {
  const url = new URL(args.url);
  const isHttps = url.protocol === 'https:';
  const reqFn = isHttps ? httpsRequest : httpRequest;

  const body = Buffer.from(JSON.stringify(args.payload), 'utf8');

  return new Promise((resolve, reject) => {
    const req = reqFn(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port ? Number(url.port) : undefined,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          ...args.headers,
          'content-type': 'application/json',
          'content-length': String(body.length),
        },
        ...(isHttps ? { rejectUnauthorized: args.tlsVerify } : {}),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
        res.on('end', () => {
          const bodyText = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode ?? 0, bodyText });
        });
      },
    );

    req.on('error', (err) => reject(err));
    req.setTimeout(args.timeoutMs, () => {
      req.destroy(new Error('timeout'));
    });
    req.write(body);
    req.end();
  });
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
  const queryUrl = normalizeSwisQueryUrl(input.endpoint);
  const auth = `Basic ${encodeBasicAuth(input.username, input.password)}`;

  const query = async (swql: string, parameters: Record<string, unknown> = {}) => {
    const op = 'swis.query';
    const res = await postJsonText({
      url: queryUrl,
      payload: { query: swql, parameters },
      timeoutMs: input.timeoutMs,
      tlsVerify: input.tlsVerify,
      headers: {
        accept: 'application/json',
        authorization: auth,
      },
    });

    if (res.status < 200 || res.status >= 300) throw makeHttpError({ op, status: res.status, bodyText: res.bodyText });

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
