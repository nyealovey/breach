export type LogLevel = 'info' | 'error';
export type ServiceName = 'web' | 'scheduler' | 'worker';

export type LogEventInput = {
  event_type: string;
  level: LogLevel;
  service: ServiceName;
  message?: string;
} & Record<string, unknown>;

const EXCERPT_LIMIT = 2000;

function getEnv() {
  const env = process.env.NODE_ENV;
  if (env === 'production' || env === 'test' || env === 'development') return env;
  return 'development';
}

function getVersion() {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ??
    process.env.GIT_SHA ??
    'unknown'
  );
}

function truncateExcerptsDeep(input: unknown): unknown {
  if (Array.isArray(input)) return input.map((v) => truncateExcerptsDeep(v));
  if (!input || typeof input !== 'object') return input;

  const obj = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (key.endsWith('_excerpt') && typeof value === 'string') {
      out[key] = value.length > EXCERPT_LIMIT ? value.slice(0, EXCERPT_LIMIT) : value;
      continue;
    }

    out[key] = truncateExcerptsDeep(value);
  }

  return out;
}

export function logEvent(input: LogEventInput) {
  const base = {
    ts: new Date().toISOString(),
    env: getEnv(),
    version: getVersion(),
    ...input,
  };

  const event = truncateExcerptsDeep(base);
  console.log(JSON.stringify(event));
}
