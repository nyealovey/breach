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
  directory?: {
    domains?: unknown[];
    users?: unknown[];
  };
  stats?: unknown;
  errors?: unknown[];
};

export type CollectorParseResult = { ok: true; response: CollectorResponseV1 } | { ok: false; error: AppError };

const STDOUT_EXCERPT_LIMIT = 2000;

function schemaError(message: string, redacted_context?: Record<string, JsonValue>): AppError {
  return { code: ErrorCode.SCHEMA_VALIDATION_FAILED, category: 'schema', message, retryable: false, redacted_context };
}

function stripUtf8Bom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function extractBalancedJsonObjects(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (!ch) continue;

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }

    if (ch !== '}' || depth === 0) continue;
    depth -= 1;
    if (depth === 0 && start >= 0) {
      out.push(text.slice(start, i + 1));
      start = -1;
    }
  }

  return out;
}

function recoverCollectorJson(stdout: string): unknown | null {
  const normalized = stripUtf8Bom(stdout).trim();
  if (!normalized) return null;

  const candidates: string[] = [];
  const lines = normalized
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length > 0) candidates.push(lines[lines.length - 1]!);

  const firstBrace = normalized.indexOf('{');
  const lastBrace = normalized.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(normalized.slice(firstBrace, lastBrace + 1));

  candidates.push(...extractBalancedJsonObjects(normalized));

  const dedupedCandidates: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    dedupedCandidates.push(trimmed);
  }

  for (let i = dedupedCandidates.length - 1; i >= 0; i -= 1) {
    const candidate = dedupedCandidates[i];
    if (!candidate) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;

    const obj = parsed as Record<string, unknown>;
    if (typeof obj.schema_version === 'string') return obj;
  }

  return null;
}

function parseCollectorJson(stdout: string): { parsed: unknown | null; parseMode: 'strict' | 'recovered' | 'failed' } {
  const normalized = stripUtf8Bom(stdout).trim();

  try {
    return { parsed: JSON.parse(normalized), parseMode: 'strict' };
  } catch {
    const recovered = recoverCollectorJson(stdout);
    if (recovered !== null) return { parsed: recovered, parseMode: 'recovered' };
    return { parsed: null, parseMode: 'failed' };
  }
}

export function parseCollectorResponse(stdout: string): CollectorParseResult {
  const { parsed, parseMode } = parseCollectorJson(stdout);
  if (parsed === null) {
    return {
      ok: false,
      error: {
        code: ErrorCode.PLUGIN_OUTPUT_INVALID_JSON,
        category: 'parse',
        message: 'failed to parse plugin stdout as json',
        retryable: false,
        redacted_context: {
          parse_attempt: 'strict_then_recovery',
          stdout_length: stdout.length,
          stdout_excerpt: stdout.slice(0, STDOUT_EXCERPT_LIMIT),
        },
      },
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: schemaError('plugin response must be an object', { parse_mode: parseMode }) };
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
        redacted_context: {
          parse_mode: parseMode,
          schema_version: typeof schemaVersion === 'string' ? schemaVersion : null,
        },
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

  const directory = (response as CollectorResponseV1).directory;
  if (directory !== undefined) {
    if (!directory || typeof directory !== 'object' || Array.isArray(directory)) {
      return {
        ok: false,
        error: schemaError('directory must be an object when provided'),
      };
    }

    if (directory.domains !== undefined && !Array.isArray(directory.domains)) {
      return {
        ok: false,
        error: schemaError('directory.domains must be an array when provided'),
      };
    }

    if (directory.users !== undefined && !Array.isArray(directory.users)) {
      return {
        ok: false,
        error: schemaError('directory.users must be an array when provided'),
      };
    }
  }

  return { ok: true };
}
