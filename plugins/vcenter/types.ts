import type { NormalizedAsset, Relation } from './normalize';

export type CollectorMode = 'healthcheck' | 'detect' | 'collect' | 'collect_hosts' | 'collect_vms';

export type VCenterConfig = {
  endpoint: string;
  inventory_scope?: unknown;
};

export type VCenterCredential = {
  username: string;
  password: string;
};

export type CollectorRequestV1 = {
  schema_version: 'collector-request-v1';
  source: {
    source_id: string;
    source_type: 'vcenter';
    config: VCenterConfig;
    credential: VCenterCredential;
  };
  request: {
    run_id: string;
    mode: CollectorMode;
    now: string;
  };
};

export type CollectorError = {
  code: string;
  category: 'auth' | 'permission' | 'network' | 'rate_limit' | 'parse' | 'config' | 'unknown';
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
