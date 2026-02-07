import type { CollectorError } from './types';

function readStringField(obj: unknown, field: string): string | null {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const value = (obj as Record<string, unknown>)[field];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNumberField(obj: unknown, field: string): number | null {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const value = (obj as Record<string, unknown>)[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function extractStatusCode(err: unknown): number | null {
  // darabonba/openapi-core typically uses statusCode; some callers may attach status.
  const statusCode = readNumberField(err, 'statusCode');
  if (statusCode !== null) return statusCode;
  const status = readNumberField(err, 'status');
  return status !== null ? status : null;
}

function extractAliyunErrorCode(err: unknown): string | null {
  const code = readStringField(err, 'code');
  if (code) return code;
  return readStringField(err, 'Code');
}

function extractMessage(err: unknown): string {
  if (err instanceof Error) return err.message || 'unknown error';
  const msg = readStringField(err, 'message');
  if (msg) return msg;
  return String(err);
}

function looksLikeNetworkError(err: unknown): boolean {
  const code = readStringField(err, 'code') ?? '';
  if (code === 'ENOTFOUND' || code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'EAI_AGAIN') return true;
  const message = extractMessage(err).toLowerCase();
  if (message.includes('etimedout') || message.includes('timeout')) return true;
  if (message.includes('econnreset') || message.includes('socket hang up')) return true;
  if (message.includes('enotfound') || message.includes('eai_again')) return true;
  return false;
}

function looksLikeAuthError(code: string, statusCode: number | null): boolean {
  if (statusCode === 401) return true;
  const c = code.toLowerCase();
  if (c.includes('invalidaccesskeyid')) return true;
  if (c.includes('signaturedoesnotmatch')) return true;
  if (c.includes('invalidsecuritytoken')) return true;
  if (c.includes('missingaccesskeyid')) return true;
  if (c.includes('accesskeyidnotfound')) return true;
  return false;
}

function looksLikePermissionError(code: string, statusCode: number | null): boolean {
  if (statusCode === 403) return true;
  const c = code.toLowerCase();
  if (c.includes('forbidden')) return true;
  if (c.includes('accessdenied')) return true;
  if (c.includes('unauthorizedoperation')) return true;
  return false;
}

function looksLikeRateLimitError(code: string, statusCode: number | null): boolean {
  if (statusCode === 429) return true;
  const c = code.toLowerCase();
  if (c.includes('throttling')) return true;
  if (c.includes('ratelimit') || c.includes('rate_limit')) return true;
  return false;
}

export function toAliyunError(err: unknown, stage: string, extra?: Record<string, unknown>): CollectorError {
  const statusCode = extractStatusCode(err);
  const errorCode = extractAliyunErrorCode(err) ?? '';
  const message = extractMessage(err);

  const redacted_context: Record<string, unknown> = {
    stage,
    ...(statusCode !== null ? { http_status: statusCode } : {}),
    ...(errorCode ? { error_code: errorCode } : {}),
    ...(extra ? extra : {}),
  };

  if (looksLikeRateLimitError(errorCode, statusCode)) {
    return { code: 'ALIYUN_RATE_LIMIT', category: 'rate_limit', message, retryable: true, redacted_context };
  }

  if (looksLikeNetworkError(err)) {
    return { code: 'ALIYUN_NETWORK_ERROR', category: 'network', message, retryable: true, redacted_context };
  }

  if (looksLikeAuthError(errorCode, statusCode)) {
    return { code: 'ALIYUN_AUTH_FAILED', category: 'auth', message, retryable: false, redacted_context };
  }

  if (looksLikePermissionError(errorCode, statusCode)) {
    return { code: 'ALIYUN_PERMISSION_DENIED', category: 'permission', message, retryable: false, redacted_context };
  }

  return { code: 'ALIYUN_PARSE_ERROR', category: 'parse', message, retryable: false, redacted_context };
}

export function retryDelaysMsForErrorCode(code: string): number[] {
  if (code === 'ALIYUN_RATE_LIMIT') return [1000, 2000, 4000, 8000, 16000];
  if (code === 'ALIYUN_NETWORK_ERROR') return [1000, 2000, 4000];
  return [];
}
