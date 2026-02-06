#!/usr/bin/env bun

import { createSwisClient } from './client';
import { buildCollectNodesSwql, buildDetectNodesCountSwql } from './collect-query';
import { normalizeNode } from './normalize';
import type { CollectorError, CollectorRequestV1, CollectorResponseV1, SolarWindsConfig } from './types';

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

function coerceTimeoutMs(value: unknown, defaultMs: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.trunc(value);
  return defaultMs;
}

function coercePageSize(value: unknown, defaultSize: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0)
    return Math.max(1, Math.min(5000, Math.trunc(value)));
  return defaultSize;
}

function normalizeConfig(raw: SolarWindsConfig): {
  endpoint: string;
  tlsVerify: boolean;
  timeoutMs: number;
  pageSize: number;
  includeUnmanaged: boolean;
} {
  const endpoint = cleanString(raw.endpoint);
  if (!endpoint) throw new Error('missing endpoint');

  const tlsVerify = toBooleanValue(raw.tls_verify) ?? true;
  const timeoutMs = coerceTimeoutMs(raw.timeout_ms, 60_000);
  const pageSize = coercePageSize(raw.page_size, 500);
  const includeUnmanaged = toBooleanValue(raw.include_unmanaged) ?? true;

  return { endpoint, tlsVerify, timeoutMs, pageSize, includeUnmanaged };
}

function toAuthError(status: number | undefined): CollectorError {
  if (status === 401) {
    return { code: 'SOLARWINDS_AUTH_FAILED', category: 'auth', message: 'authentication failed', retryable: false };
  }
  if (status === 403) {
    return {
      code: 'SOLARWINDS_PERMISSION_DENIED',
      category: 'permission',
      message: 'permission denied',
      retryable: false,
    };
  }
  if (status === 429) {
    return { code: 'SOLARWINDS_RATE_LIMIT', category: 'rate_limit', message: 'rate limited', retryable: true };
  }
  return {
    code: 'SOLARWINDS_NETWORK_ERROR',
    category: 'network',
    message: 'solarwinds request failed',
    retryable: true,
  };
}

function toSolarWindsError(err: unknown, stage: string): CollectorError {
  const status = typeof err === 'object' && err && 'status' in err ? (err as { status?: number }).status : undefined;
  const bodyText =
    typeof err === 'object' && err && 'bodyText' in err ? (err as { bodyText?: string }).bodyText : undefined;

  const base = toAuthError(status);
  return {
    ...base,
    redacted_context: {
      stage,
      ...(status ? { status } : {}),
      ...(bodyText ? { body_excerpt: bodyText.slice(0, 500) } : {}),
      cause: err instanceof Error ? err.message : String(err),
    },
  };
}

async function healthcheck(request: CollectorRequestV1): Promise<{ response: CollectorResponseV1; exitCode: number }> {
  try {
    const cfg = normalizeConfig(request.source.config);
    const username = cleanString(request.source.credential?.username);
    const password = cleanString(request.source.credential?.password);
    if (!username || !password) throw new Error('missing username/password');

    const client = createSwisClient({
      endpoint: cfg.endpoint,
      tlsVerify: cfg.tlsVerify,
      timeoutMs: cfg.timeoutMs,
      username,
      password,
    });

    await client.query('SELECT TOP 1 NodeID FROM Orion.Nodes');

    return { response: makeResponse({ errors: [] }), exitCode: 0 };
  } catch (err) {
    const error =
      err instanceof Error && err.message.startsWith('missing ')
        ? ({
            code: 'SOLARWINDS_CONFIG_INVALID',
            category: 'config',
            message: err.message,
            retryable: false,
          } satisfies CollectorError)
        : toSolarWindsError(err, 'healthcheck');
    return { response: makeResponse({ errors: [error] }), exitCode: 1 };
  }
}

async function detect(request: CollectorRequestV1): Promise<{ response: CollectorResponseV1; exitCode: number }> {
  try {
    const cfg = normalizeConfig(request.source.config);
    const username = cleanString(request.source.credential?.username);
    const password = cleanString(request.source.credential?.password);
    if (!username || !password) throw new Error('missing username/password');

    const client = createSwisClient({
      endpoint: cfg.endpoint,
      tlsVerify: cfg.tlsVerify,
      timeoutMs: cfg.timeoutMs,
      username,
      password,
    });

    const nodeCount = await client.query(buildDetectNodesCountSwql({ includeUnmanaged: cfg.includeUnmanaged }));
    const total =
      nodeCount.results.length > 0 && typeof nodeCount.results[0]?.total === 'number'
        ? Math.trunc(nodeCount.results[0]!.total as number)
        : null;

    return {
      response: makeResponse({
        detect: {
          driver: 'solarwinds@v1',
          target_version: 'unknown',
          capabilities: {
            include_unmanaged: cfg.includeUnmanaged,
            page_size: cfg.pageSize,
            ...(total !== null ? { nodes_total: total } : {}),
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
            code: 'SOLARWINDS_CONFIG_INVALID',
            category: 'config',
            message: err.message,
            retryable: false,
          } satisfies CollectorError)
        : toSolarWindsError(err, 'detect');
    return { response: makeResponse({ errors: [error] }), exitCode: 1 };
  }
}

async function collect(request: CollectorRequestV1): Promise<{ response: CollectorResponseV1; exitCode: number }> {
  try {
    const cfg = normalizeConfig(request.source.config);
    const username = cleanString(request.source.credential?.username);
    const password = cleanString(request.source.credential?.password);
    if (!username || !password) throw new Error('missing username/password');

    const client = createSwisClient({
      endpoint: cfg.endpoint,
      tlsVerify: cfg.tlsVerify,
      timeoutMs: cfg.timeoutMs,
      username,
      password,
    });

    const assets: CollectorResponseV1['assets'] = [];
    const warnings: unknown[] = [];

    let lastId = 0;
    for (;;) {
      const swql = buildCollectNodesSwql({
        pageSize: cfg.pageSize,
        includeUnmanaged: cfg.includeUnmanaged,
      });

      const page = await client.query(swql, { lastId });
      if (page.results.length === 0) break;

      let maxId = lastId;
      for (const row of page.results) {
        const normalized = normalizeNode(row);
        if (!normalized) {
          warnings.push({ type: 'solarwinds.node_skipped_missing_id', row: { ...row, password: undefined } });
          continue;
        }

        const idNum = Number(normalized.external_id);
        if (Number.isFinite(idNum)) maxId = Math.max(maxId, Math.trunc(idNum));
        assets.push({
          external_kind: normalized.external_kind,
          external_id: normalized.external_id,
          normalized: normalized.normalized,
          raw_payload: normalized.raw_payload,
        });
      }

      if (maxId <= lastId) {
        return {
          response: makeResponse({
            errors: [
              {
                code: 'SOLARWINDS_PARSE_ERROR',
                category: 'parse',
                message: 'pagination cursor did not advance',
                retryable: false,
                redacted_context: { last_id: lastId },
              },
            ],
          }),
          exitCode: 1,
        };
      }

      lastId = maxId;
      if (page.results.length < cfg.pageSize) break;
    }

    return {
      response: makeResponse({
        assets,
        relations: [],
        stats: { assets: assets.length, relations: 0, inventory_complete: true, warnings },
        errors: [],
      }),
      exitCode: 0,
    };
  } catch (err) {
    const error =
      err instanceof Error && err.message.startsWith('missing ')
        ? ({
            code: 'SOLARWINDS_CONFIG_INVALID',
            category: 'config',
            message: err.message,
            retryable: false,
          } satisfies CollectorError)
        : toSolarWindsError(err, 'collect');
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
          code: 'SOLARWINDS_CONFIG_INVALID',
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
          code: 'SOLARWINDS_PARSE_ERROR',
          category: 'parse',
          message: err instanceof Error ? err.message : 'unexpected error',
          retryable: false,
        },
      ],
    });
    process.stdout.write(`${JSON.stringify(response)}\n`);
    process.exit(1);
  });
