import { ErrorCode } from '@/lib/errors/error-codes';
import { validateNormalizedV1 } from '@/lib/schema/validate';

import type { AppError, JsonValue } from '@/lib/errors/error';

export type CollectorResponseV1 = {
  schema_version: 'collector-response-v1';
  detect?: unknown;
  assets?: Array<{
    external_kind: string;
    external_id: string;
    normalized: unknown;
    raw_payload?: unknown;
  }>;
  relations?: unknown[];
  stats?: unknown;
  errors?: unknown[];
};

export type CollectorParseResult = { ok: true; response: CollectorResponseV1 } | { ok: false; error: AppError };

function schemaError(message: string, redacted_context?: Record<string, JsonValue>): AppError {
  return { code: ErrorCode.SCHEMA_VALIDATION_FAILED, category: 'schema', message, retryable: false, redacted_context };
}

export function parseCollectorResponse(stdout: string): CollectorParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return {
      ok: false,
      error: {
        code: ErrorCode.PLUGIN_OUTPUT_INVALID_JSON,
        category: 'parse',
        message: 'failed to parse plugin stdout as json',
        retryable: false,
        redacted_context: { stdout_excerpt: stdout.slice(0, 2000) },
      },
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: schemaError('plugin response must be an object') };
  }

  const schemaVersion = (parsed as { schema_version?: unknown }).schema_version;
  if (schemaVersion !== 'collector-response-v1') {
    return {
      ok: false,
      error: {
        code: ErrorCode.PLUGIN_SCHEMA_VERSION_UNSUPPORTED,
        category: 'schema',
        message: 'unsupported collector-response schema_version',
        retryable: false,
        redacted_context: { schema_version: typeof schemaVersion === 'string' ? schemaVersion : null },
      },
    };
  }

  return { ok: true, response: parsed as CollectorResponseV1 };
}

export function validateCollectorResponse(response: unknown): { ok: true } | { ok: false; error: AppError } {
  if (!response || typeof response !== 'object')
    return { ok: false, error: schemaError('plugin response must be an object') };
  const schemaVersion = (response as { schema_version?: unknown }).schema_version;
  if (schemaVersion !== 'collector-response-v1') {
    return {
      ok: false,
      error: {
        code: ErrorCode.PLUGIN_SCHEMA_VERSION_UNSUPPORTED,
        category: 'schema',
        message: 'unsupported collector-response schema_version',
        retryable: false,
        redacted_context: { schema_version: typeof schemaVersion === 'string' ? schemaVersion : null },
      },
    };
  }

  const assetsRaw = (response as CollectorResponseV1).assets;
  const assets = Array.isArray(assetsRaw) ? assetsRaw : [];
  for (const asset of assets) {
    const result = validateNormalizedV1(asset.normalized);
    if (result.ok) continue;
    return {
      ok: false,
      error: {
        code: ErrorCode.SCHEMA_VALIDATION_FAILED,
        category: 'schema',
        message: 'normalized-v1 schema validation failed',
        retryable: false,
        redacted_context: {
          external_kind: asset.external_kind,
          external_id: asset.external_id,
          issues: result.issues.slice(0, 20),
        },
      },
    };
  }

  return { ok: true };
}
