import type { NormalizedAsset, Relation } from './normalize';

export type CollectorMode = 'healthcheck' | 'detect' | 'collect';

export type HypervWinrmConfig = {
  // 默认：winrm（保持兼容；旧配置可不填 connection_method）
  connection_method?: 'winrm';

  // 主机名/IP 或群集名（在 scheme/port 下拼接成 WinRM endpoint）
  endpoint: string;

  scheme?: 'https' | 'http';
  port?: number;
  tls_verify?: boolean;
  timeout_ms?: number;

  /**
   * Kerberos SPN service class（仅对 auth_method=auto|kerberos 生效）：
   * - WSMAN：WinRM 常见 SPN（推荐；默认）
   * - HTTP：部分环境仅注册 HTTP/<host>（curl/requests 默认）
   * - HOST：机器账户兜底（少数环境可用）
   */
  kerberos_service_name?: 'WSMAN' | 'HTTP' | 'HOST';

  /**
   * Kerberos SPN 兼容模式（默认关闭）：
   * - false：严格模式，仅尝试一次（service=kerberos_service_name；hostname_override=kerberos_hostname_override）
   * - true：兼容模式，按顺序尝试多个 service candidates，并在未显式设置 hostname_override 时额外尝试 short hostname
   */
  kerberos_spn_fallback?: boolean;

  /**
   * requests-kerberos 的 kerberos_hostname_override（高级选项）。
   * 仅当 WinRM URL host 与 Kerberos 需要匹配的 SPN hostname 不一致（例如 CNAME）时使用。
   */
  kerberos_hostname_override?: string;

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

export type HypervAgentConfig = {
  connection_method: 'agent';
  agent_url: string;
  agent_tls_verify?: boolean;
  agent_timeout_ms?: number;
  scope?: 'auto' | 'standalone' | 'cluster';
  max_parallel_nodes?: number;

  // 兼容：旧 UI/配置可能仍带 endpoint，但 agent 路径不使用它。
  endpoint?: string;
};

export type HypervConfig = HypervWinrmConfig | HypervAgentConfig;

export type HypervWinrmCredential = {
  auth?: 'winrm';
  // 可选：用于构造 DOMAIN\\user（触发 NTLM auth）
  domain?: string;
  username: string;
  password: string;
};

export type HypervAgentCredential = {
  auth: 'agent';
  token: string;
};

export type HypervCredential = HypervWinrmCredential | HypervAgentCredential;

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
