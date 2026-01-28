import type { ErrorCodeType } from '@/lib/errors/error-codes';

/**
 * JSON value type that is compatible with Prisma `InputJsonValue`.
 *
 * NOTE: Keep this type Prisma-free so it can be shared by both Web and Worker code.
 */
export type JsonValue = string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[];

export type ErrorCategory =
  | 'auth'
  | 'permission'
  | 'config'
  | 'network'
  | 'rate_limit'
  | 'parse'
  | 'schema'
  | 'db'
  | 'raw'
  | 'unknown';

export type ErrorDetail = {
  field?: string;
  issue?: string;
  message?: string;
};

export type AppError = {
  code: ErrorCodeType;
  category: ErrorCategory;
  message: string;
  retryable: boolean;
  redacted_context?: Record<string, JsonValue>;
  details?: ErrorDetail[];
};

export function isAppError(err: unknown): err is AppError {
  if (!err || typeof err !== 'object') return false;
  // Minimal structural check; we don't validate codes here to avoid circular deps on constants.
  return (
    'code' in err &&
    'category' in err &&
    'message' in err &&
    'retryable' in err &&
    typeof (err as { code: unknown }).code === 'string' &&
    typeof (err as { category: unknown }).category === 'string' &&
    typeof (err as { message: unknown }).message === 'string' &&
    typeof (err as { retryable: unknown }).retryable === 'boolean'
  );
}

export function toPublicError(err: unknown): AppError {
  if (isAppError(err)) return err;
  return { code: 'INTERNAL_ERROR', category: 'unknown', message: 'Internal error', retryable: false };
}
