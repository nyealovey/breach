#!/usr/bin/env bun

import { createVeeamClient } from './client';
import { normalizeBackupSignals } from './normalize';
import type { CollectorError, CollectorRequestV1, CollectorResponseV1, VeeamConfig } from './types';

function makeResponse(partial: Partial<CollectorResponseV1>): CollectorResponseV1 {
  return {
    schema_version: 'collector-response-v1',
    assets: [],
    relations: [],
    stats: { assets: 0, relations: 0, inventory_complete: false, warnings: [] },
    errors: [],
    ...partial,
  };
}

async function readStdinJson(): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(text);
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

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function clampPositiveInt(value: unknown, fallback: number, max: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0) {
    return Math.max(1, Math.min(max, value));
  }
  return fallback;
}

function normalizeConfig(raw: VeeamConfig): {
  endpoint: string;
  tlsVerify: boolean;
  timeoutMs: number;
  apiVersion: string;
  sessionsLimit: number;
  taskSessionsLimit: number;
} {
  const endpoint = cleanString(raw.endpoint);
  if (!endpoint) throw new Error('missing endpoint');

  const tlsVerify = toBooleanValue(raw.tls_verify) ?? true;
  const timeoutMs = clampPositiveInt(raw.timeout_ms, 60_000, 600_000);
  const apiVersion = cleanString(raw.api_version) ?? '1.3-rev1';
  const sessionsLimit = clampPositiveInt(raw.sessions_limit, 200, 5000);
  const taskSessionsLimit = clampPositiveInt(raw.task_sessions_limit, 2000, 50_000);

  return { endpoint, tlsVerify, timeoutMs, apiVersion, sessionsLimit, taskSessionsLimit };
}

function toAuthError(status: number | undefined): CollectorError {
  if (status === 400 || status === 401) {
    return { code: 'VEEAM_AUTH_FAILED', category: 'auth', message: 'authentication failed', retryable: false };
  }
  if (status === 403) {
    return { code: 'VEEAM_PERMISSION_DENIED', category: 'permission', message: 'permission denied', retryable: false };
  }
  if (status === 429) {
    return { code: 'VEEAM_RATE_LIMIT', category: 'rate_limit', message: 'rate limited', retryable: true };
  }
  return { code: 'VEEAM_NETWORK_ERROR', category: 'network', message: 'veeam request failed', retryable: true };
}

function toVeeamError(err: unknown, stage: string): CollectorError {
  const status = typeof err === 'object' && err && 'status' in err ? (err as { status?: number }).status : undefined;
  const bodyText =
    typeof err === 'object' && err && 'bodyText' in err ? (err as { bodyText?: string }).bodyText : undefined;
  const cause = err instanceof Error ? err.message : String(err);

  const lower = cause.toLowerCase();

  if (lower.includes('missing endpoint') || lower.includes('missing username/password')) {
    return {
      code: 'VEEAM_CONFIG_INVALID',
      category: 'config',
      message: 'invalid veeam credential/config',
      retryable: false,
      redacted_context: { stage, cause },
    };
  }

  if (lower.includes('invalid json') || lower.includes('unexpected response')) {
    return {
      code: 'VEEAM_PARSE_ERROR',
      category: 'parse',
      message: 'veeam response parse error',
      retryable: false,
      redacted_context: {
        stage,
        ...(status ? { status } : {}),
        ...(bodyText ? { body_excerpt: bodyText.slice(0, 500) } : {}),
        cause,
      },
    };
  }

  const base = toAuthError(status);
  const tlsLike = lower.includes('certificate') || lower.includes('tls');
  return {
    ...base,
    ...(tlsLike
      ? {
          code: 'VEEAM_TLS_ERROR',
          message: 'tls error',
          retryable: false,
        }
      : {}),
    redacted_context: {
      stage,
      ...(status ? { status } : {}),
      ...(bodyText ? { body_excerpt: bodyText.slice(0, 500) } : {}),
      cause,
    },
  };
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let nextIdx = 0;

  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    for (;;) {
      const idx = nextIdx;
      nextIdx += 1;
      const item = items[idx];
      if (item === undefined) return;
      out[idx] = await fn(item);
    }
  });

  await Promise.all(workers);
  return out;
}

async function fetchTaskSessionsAll(args: {
  client: Awaited<ReturnType<typeof createVeeamClient>>;
  sessionId: string;
  maxTotal: number;
}): Promise<any[]> {
  const out: any[] = [];
  const pageSize = Math.max(1, Math.min(200, args.maxTotal));
  let skip = 0;

  for (;;) {
    const remaining = args.maxTotal - out.length;
    if (remaining <= 0) break;

    const page = await args.client.listTaskSessions(args.sessionId, {
      skip,
      limit: Math.min(pageSize, remaining),
      orderColumn: 'EndTime',
      orderAsc: false,
    });

    out.push(...page.data);
    const got = page.data.length;
    if (got === 0) break;
    skip += got;
    if (got < pageSize) break;
  }

  return out;
}

async function healthcheck(request: CollectorRequestV1): Promise<{ response: CollectorResponseV1; exitCode: number }> {
  try {
    const cfg = normalizeConfig(request.source.config);
    const username = cleanString(request.source.credential?.username);
    const password = cleanString(request.source.credential?.password);
    if (!username || !password) throw new Error('missing username/password');

    const client = await createVeeamClient({
      endpoint: cfg.endpoint,
      tlsVerify: cfg.tlsVerify,
      timeoutMs: cfg.timeoutMs,
      apiVersion: cfg.apiVersion,
      username,
      password,
    });

    await client.getServerInfo();

    return { response: makeResponse({ errors: [] }), exitCode: 0 };
  } catch (err) {
    const error =
      err instanceof Error && err.message.startsWith('missing ')
        ? ({
            code: 'VEEAM_CONFIG_INVALID',
            category: 'config',
            message: err.message,
            retryable: false,
          } satisfies CollectorError)
        : toVeeamError(err, 'healthcheck');
    return { response: makeResponse({ errors: [error] }), exitCode: 1 };
  }
}

async function detect(request: CollectorRequestV1): Promise<{ response: CollectorResponseV1; exitCode: number }> {
  try {
    const cfg = normalizeConfig(request.source.config);
    const username = cleanString(request.source.credential?.username);
    const password = cleanString(request.source.credential?.password);
    if (!username || !password) throw new Error('missing username/password');

    const client = await createVeeamClient({
      endpoint: cfg.endpoint,
      tlsVerify: cfg.tlsVerify,
      timeoutMs: cfg.timeoutMs,
      apiVersion: cfg.apiVersion,
      username,
      password,
    });

    const serverInfo = await client.getServerInfo();

    return {
      response: makeResponse({
        detect: {
          driver: 'veeam@v1',
          target_version: serverInfo.buildVersion ?? 'unknown',
          capabilities: {
            api_version: cfg.apiVersion,
            sessions_limit: cfg.sessionsLimit,
            task_sessions_limit: cfg.taskSessionsLimit,
            ...(serverInfo.vbrId ? { vbr_id: serverInfo.vbrId } : {}),
          },
        },
        errors: [],
      }),
      exitCode: 0,
    };
  } catch (err) {
    const error =
      err instanceof Error && err.message.startsWith('missing ')
        ? ({
            code: 'VEEAM_CONFIG_INVALID',
            category: 'config',
            message: err.message,
            retryable: false,
          } satisfies CollectorError)
        : toVeeamError(err, 'detect');
    return { response: makeResponse({ errors: [error] }), exitCode: 1 };
  }
}

async function collect(request: CollectorRequestV1): Promise<{ response: CollectorResponseV1; exitCode: number }> {
  try {
    const cfg = normalizeConfig(request.source.config);
    const username = cleanString(request.source.credential?.username);
    const password = cleanString(request.source.credential?.password);
    if (!username || !password) throw new Error('missing username/password');

    const client = await createVeeamClient({
      endpoint: cfg.endpoint,
      tlsVerify: cfg.tlsVerify,
      timeoutMs: cfg.timeoutMs,
      apiVersion: cfg.apiVersion,
      username,
      password,
    });

    const sessionsPage = await client.listSessions({
      skip: 0,
      limit: cfg.sessionsLimit,
      orderColumn: 'EndTime',
      orderAsc: false,
      typeFilter: ['BackupJob'],
    });

    const sessions = sessionsPage.data;

    const taskSessionsList = await mapWithConcurrency(sessions, 5, async (s) => {
      const sessionId = cleanString(s.id);
      if (!sessionId) return { sessionId: null as string | null, tasks: [] as any[] };
      const tasks = await fetchTaskSessionsAll({ client, sessionId, maxTotal: cfg.taskSessionsLimit });
      return { sessionId, tasks };
    });

    const taskSessionsBySessionId = new Map<string, any[]>();
    for (const row of taskSessionsList) {
      if (!row.sessionId) continue;
      taskSessionsBySessionId.set(row.sessionId, row.tasks);
    }

    const assets = normalizeBackupSignals({
      sessions: sessions as any[],
      taskSessionsBySessionId: taskSessionsBySessionId as any,
    });

    return {
      response: makeResponse({
        assets,
        relations: [],
        stats: { assets: assets.length, relations: 0, inventory_complete: true, warnings: [] },
        errors: [],
      }),
      exitCode: 0,
    };
  } catch (err) {
    const error =
      err instanceof Error && err.message.startsWith('missing ')
        ? ({
            code: 'VEEAM_CONFIG_INVALID',
            category: 'config',
            message: err.message,
            retryable: false,
          } satisfies CollectorError)
        : toVeeamError(err, 'collect');
    return { response: makeResponse({ errors: [error] }), exitCode: 1 };
  }
}

async function main(): Promise<{ response: CollectorResponseV1; exitCode: number }> {
  const raw = await readStdinJson();
  const request = raw as CollectorRequestV1;
  const mode = request?.request?.mode;

  if (mode === 'healthcheck') return healthcheck(request);
  if (mode === 'detect') return detect(request);
  if (mode === 'collect') return collect(request);

  return {
    response: makeResponse({
      errors: [
        {
          code: 'VEEAM_CONFIG_INVALID',
          category: 'config',
          message: 'unsupported mode',
          retryable: false,
          redacted_context: { mode: typeof mode === 'string' ? mode : null },
        },
      ],
    }),
    exitCode: 1,
  };
}

main()
  .then(({ response, exitCode }) => {
    process.stdout.write(`${JSON.stringify(response)}\n`);
    process.exit(exitCode);
  })
  .catch((err) => {
    const response = makeResponse({
      errors: [
        {
          code: 'VEEAM_PARSE_ERROR',
          category: 'parse',
          message: err instanceof Error ? err.message : 'unexpected error',
          retryable: false,
        },
      ],
    });
    process.stdout.write(`${JSON.stringify(response)}\n`);
    process.exit(1);
  });
