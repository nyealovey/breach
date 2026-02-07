import type { NormalizedAsset } from './normalize';

export type CollectorMode = 'healthcheck' | 'detect' | 'collect';

export type VeeamConfig = {
  // Base URL, e.g. "https://vbr.example.com:9419"
  endpoint: string;
  tls_verify?: boolean;
  timeout_ms?: number;
  // Veeam REST API version header: x-api-version
  api_version?: string;
  // Soft limits to bound collection cost.
  sessions_limit?: number;
  task_sessions_limit?: number;
};

export type VeeamCredential = {
  username: string;
  password: string;
};

export type CollectorRequestV1 = {
  schema_version: 'collector-request-v1';
  source: {
    source_id: string;
    source_type: 'veeam';
    config: VeeamConfig;
    credential: VeeamCredential;
  };
  request: {
    run_id: string;
    mode: CollectorMode;
    now: string;
  };
};

export type CollectorError = {
  code: string;
  category: 'auth' | 'permission' | 'network' | 'rate_limit' | 'parse' | 'schema' | 'config' | 'unknown';
  message: string;
  retryable: boolean;
  redacted_context?: Record<string, unknown>;
};

export type CollectorResponseV1 = {
  schema_version: 'collector-response-v1';
  detect?: unknown;
  assets: NormalizedAsset[];
  relations: unknown[];
  stats: { assets: number; relations: number; inventory_complete: boolean; warnings: unknown[] };
  errors: CollectorError[];
};
