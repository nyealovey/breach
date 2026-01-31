export type RunIssue = {
  code: string;
  category?: string;
  message?: string;
  retryable?: boolean;
  redacted_context?: Record<string, unknown>;
};

export type PrimaryRunIssue = RunIssue & {
  code: string;
  message: string;
  retryable: boolean;
  missingStructuredErrors?: boolean;
};

function toStringOrUndefined(input: unknown): string | undefined {
  return typeof input === 'string' && input.trim().length > 0 ? input : undefined;
}

function toBooleanOrUndefined(input: unknown): boolean | undefined {
  return typeof input === 'boolean' ? input : undefined;
}

function toRecordOrUndefined(input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  return input as Record<string, unknown>;
}

export function parseRunIssues(input: unknown): RunIssue[] {
  if (!Array.isArray(input)) return [];

  const out: RunIssue[] = [];
  for (const item of input) {
    const obj = toRecordOrUndefined(item);
    const code = toStringOrUndefined(obj?.code);
    if (!code) continue;

    out.push({
      code,
      category: toStringOrUndefined(obj?.category),
      message: toStringOrUndefined(obj?.message),
      retryable: toBooleanOrUndefined(obj?.retryable),
      redacted_context: toRecordOrUndefined(obj?.redacted_context),
    });
  }

  return out;
}

export function getPrimaryRunIssue(params: {
  status: string;
  errors: unknown;
  errorSummary?: unknown;
}): PrimaryRunIssue | null {
  const errors = parseRunIssues(params.errors);
  if (errors.length > 0) {
    const first = errors[0];
    if (!first) return null;
    return {
      ...first,
      code: first.code,
      message: first.message ?? '-',
      retryable: first.retryable ?? false,
    };
  }

  const errorSummary = toStringOrUndefined(params.errorSummary);
  if (params.status === 'Failed' && errorSummary) {
    return {
      code: 'INTERNAL_ERROR',
      category: 'unknown',
      message: errorSummary,
      retryable: false,
      missingStructuredErrors: true,
    };
  }

  return null;
}

function redactUrlsAndIps(input: string): string {
  // URL (http/https) redaction
  const withoutUrls = input.replace(/https?:\/\/[^\s"']+/gi, '[REDACTED_URL]');
  // IPv4 redaction (best-effort)
  return withoutUrls.replace(/\b(\d{1,3}\.){3}\d{1,3}\b/g, '[REDACTED_IP]');
}

function sanitizeContextValue(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  if (typeof value === 'string') {
    const redacted = redactUrlsAndIps(value);
    return redacted.length > 500 ? `${redacted.slice(0, 500)}…` : redacted;
  }

  try {
    const json = redactUrlsAndIps(JSON.stringify(value));
    return json.length > 500 ? `${json.slice(0, 500)}…` : json;
  } catch {
    return '[unserializable]';
  }
}

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();

  // Short keys should match exactly to reduce false positives.
  if (k === 'ak' || k === 'sk') return true;

  return (
    k.includes('password') ||
    k.includes('secret') ||
    k.includes('token') ||
    k.includes('access_key') ||
    k.includes('accesskey') ||
    k.includes('credential') ||
    k.includes('cipher') ||
    k.includes('jwt') ||
    k.includes('cookie') ||
    k.includes('session') ||
    k.includes('endpoint') ||
    k.includes('url') ||
    k.includes('uri') ||
    k.includes('username') ||
    k === 'user'
  );
}

function isAllowedKey(key: string): boolean {
  if (isSensitiveKey(key)) return false;

  const k = key.toLowerCase();
  if (k === 'stage') return true;
  if (k === 'status') return true;
  if (k === 'op') return true;
  if (k === 'mode') return true;
  if (k === 'driver') return true;
  if (k === 'field') return true;
  if (k === 'cause') return true;
  if (k === 'preferred_vcenter_version') return true;
  if (k === 'missing_capability') return true;
  if (k === 'missing_endpoint') return true;
  if (k === 'body_excerpt') return true;
  if (k === 'stderr_excerpt') return true;
  if (k === 'stdout_excerpt') return true;

  if (k.endsWith('_id') || k.endsWith('_uuid')) return true;
  if (k.endsWith('_count')) return true;
  if (k.endsWith('_ms') || k.endsWith('_bytes')) return true;

  return false;
}

export function sanitizeRedactedContext(input: unknown): Record<string, unknown> | null {
  const obj = toRecordOrUndefined(input);
  if (!obj) return null;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!isAllowedKey(key)) continue;
    out[key] = sanitizeContextValue(value);
  }

  return Object.keys(out).length > 0 ? out : null;
}

export function groupRunIssuesByCode(issues: RunIssue[]): Array<{ code: string; issues: RunIssue[] }> {
  const groups = new Map<string, RunIssue[]>();

  for (const issue of issues) {
    const bucket = groups.get(issue.code) ?? [];
    bucket.push(issue);
    groups.set(issue.code, bucket);
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, items]) => ({ code, issues: items }));
}
