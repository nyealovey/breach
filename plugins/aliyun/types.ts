import type { NormalizedAsset, Relation } from './normalize';

export type CollectorMode = 'healthcheck' | 'detect' | 'collect';

export type AliyunConfig = {
  // Placeholder field required by core validation; the plugin does not rely on it.
  endpoint: string;
  regions: string[];
  timeout_ms?: number;
  max_parallel_regions?: number;
  include_stopped?: boolean;
  include_ecs?: boolean;
  include_rds?: boolean;
};

export type AliyunCredential = { accessKeyId: string; accessKeySecret: string };

export type CollectorRequestV1 = {
  schema_version: 'collector-request-v1';
  source: {
    source_id: string;
    source_type: 'aliyun';
    config: AliyunConfig;
    credential: AliyunCredential;
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
