import type { NormalizedAsset, Relation } from './normalize';

export type CollectorMode = 'healthcheck' | 'detect' | 'collect';

export type PveConfig = {
  endpoint: string;
  tls_verify?: boolean;
  timeout_ms?: number;
  scope?: 'auto' | 'standalone' | 'cluster';
  max_parallel_nodes?: number;
  auth_type?: 'api_token' | 'user_password';
};

export type PveCredential =
  | { auth_type: 'api_token'; api_token_id: string; api_token_secret: string }
  | { auth_type?: 'user_password'; username: string; password: string };

export type CollectorRequestV1 = {
  schema_version: 'collector-request-v1';
  source: {
    source_id: string;
    source_type: 'pve';
    config: PveConfig;
    credential: PveCredential;
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
  relations: Relation[];
  stats: { assets: number; relations: number; inventory_complete: boolean; warnings: unknown[] };
  errors: CollectorError[];
};
