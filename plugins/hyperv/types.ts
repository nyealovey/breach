import type { NormalizedAsset, Relation } from './normalize';

export type CollectorMode = 'healthcheck' | 'detect' | 'collect';

export type HypervConfig = {
  // v1 固定为 winrm；预留未来扩展 agent 等方式
  connection_method?: 'winrm';

  // 主机名/IP 或群集名（在 scheme/port 下拼接成 WinRM endpoint）
  endpoint: string;

  scheme?: 'https' | 'http';
  port?: number;
  tls_verify?: boolean;
  timeout_ms?: number;

  /**
   * WinRM 认证方式：
   * - auto：有 domain 时优先 Kerberos（默认 WinRM 配置），否则使用 basic
   * - kerberos：强制 Kerberos（依赖 worker 环境具备 Kerberos client/curl negotiate）
   * - ntlm/basic：legacy（仅用于特殊环境；默认 WinRM 通常禁用 basic）
   */
  auth_method?: 'auto' | 'kerberos' | 'ntlm' | 'basic';

  // auto 会在 detect 阶段给出建议；collect 时仍以配置为准
  scope?: 'auto' | 'standalone' | 'cluster';
  max_parallel_nodes?: number;
};

export type HypervCredential = {
  // 可选：用于构造 DOMAIN\\user（触发 NTLM auth）
  domain?: string;
  username: string;
  password: string;
};

export type CollectorRequestV1 = {
  schema_version: 'collector-request-v1';
  source: {
    source_id: string;
    source_type: 'hyperv';
    config: HypervConfig;
    credential: HypervCredential;
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
