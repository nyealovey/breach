export type SuggestedAction = {
  title: string;
  steps: string[];
  links?: Array<{ label: string; href: string }>;
};

export type RunErrorUiMeta = {
  title: string;
  actions: SuggestedAction[];
};

const GENERIC_ACTIONS: SuggestedAction[] = [
  {
    title: '通用排查',
    steps: ['查看本页错误码与上下文（已脱敏）', '确认来源启用且网络可达', '修复后重新触发该 Run（或等待下次调度）'],
  },
];

const ERROR_CODE_META: Record<string, RunErrorUiMeta> = {
  // ===== Auth / Permission =====
  VCENTER_AUTH_FAILED: {
    title: '认证失败（vCenter）',
    actions: [
      {
        title: '检查凭据与账号状态',
        steps: ['在 Credentials 检查用户名/密码是否正确', '确认账号未锁定/未过期', '回到 Sources 先跑一次 healthcheck'],
        links: [
          { label: '打开 Credentials', href: '/credentials' },
          { label: '打开 Sources', href: '/sources' },
        ],
      },
    ],
  },
  PVE_AUTH_FAILED: {
    title: '认证失败（PVE）',
    actions: [
      {
        title: '检查 API Token / 用户密码',
        steps: ['确认 tokenId/secret 或用户名/密码正确', '确认 token 未被撤销', '回到 Sources 先跑一次 healthcheck'],
        links: [{ label: '打开 Sources', href: '/sources' }],
      },
    ],
  },
  HYPERV_AUTH_FAILED: {
    title: '认证失败（Hyper-V）',
    actions: [
      {
        title: '检查 WinRM 凭据',
        steps: [
          '确认 domain/username/password 正确',
          '确认目标主机允许该账号远程只读查询',
          '回到 Sources 先跑一次 healthcheck',
        ],
        links: [{ label: '打开 Sources', href: '/sources' }],
      },
    ],
  },
  ALIYUN_AUTH_FAILED: {
    title: '认证失败（阿里云）',
    actions: [
      {
        title: '检查 AK/SK 与 RAM 授权',
        steps: [
          '确认 AccessKey 未失效',
          '确认 RAM 权限包含 ECS/Region 枚举所需最小权限',
          '回到 Sources 先跑一次 healthcheck',
        ],
        links: [{ label: '打开 Sources', href: '/sources' }],
      },
    ],
  },
  VCENTER_PERMISSION_DENIED: {
    title: '权限不足（vCenter）',
    actions: [
      {
        title: '补齐只读权限',
        steps: [
          '确认账号具备枚举 VM/Host/Cluster 的权限',
          '确认可读取 VM 关键字段与 VM->Host 关联字段',
          '修复后重新触发 collect',
        ],
        links: [{ label: '打开 Sources', href: '/sources' }],
      },
    ],
  },
  PVE_PERMISSION_DENIED: {
    title: '权限不足（PVE）',
    actions: [
      { title: '补齐只读权限', steps: ['确认可列出 nodes 与 VMs（inventory 枚举）', '修复后重新触发 collect'] },
    ],
  },
  HYPERV_PERMISSION_DENIED: {
    title: '权限不足（Hyper-V）',
    actions: [
      {
        title: '补齐只读权限',
        steps: ['确认账号可读取 Hyper-V/Failover Cluster 的只读信息', '修复后重新触发 collect'],
      },
    ],
  },
  ALIYUN_PERMISSION_DENIED: {
    title: '权限不足（阿里云）',
    actions: [
      { title: '补齐 RAM 权限', steps: ['确认 RAM Policy 允许 ECS/Region/分页读取', '修复后重新触发 collect'] },
    ],
  },

  // ===== Network / TLS / Timeout =====
  VCENTER_NETWORK_ERROR: {
    title: '网络错误（vCenter）',
    actions: [
      {
        title: '检查网络连通性',
        steps: [
          '确认 endpoint 可达（DNS/TCP/防火墙）',
          '确认目标服务未限流/未维护',
          '若标记 retryable，可直接重试该 Run',
        ],
      },
    ],
  },
  PVE_NETWORK_ERROR: {
    title: '网络错误（PVE）',
    actions: [
      {
        title: '检查网络与限流',
        steps: ['确认 endpoint 可达（DNS/TCP/防火墙）', '若遇到 429/限流，请降低并发或稍后重试'],
      },
    ],
  },
  HYPERV_NETWORK_ERROR: {
    title: '网络错误（Hyper-V）',
    actions: [{ title: '检查 WinRM 连通性', steps: ['确认 5985/5986 可达', '确认 WinRM 已启用且允许远程'] }],
  },
  VCENTER_TLS_ERROR: {
    title: 'TLS/证书错误（vCenter）',
    actions: [
      {
        title: '检查证书链与时间',
        steps: ['确认系统时间正确', '若为自签名证书，请按部署策略导入信任或调整 Source 的 tls_verify（如实现支持）'],
      },
    ],
  },
  PVE_TLS_ERROR: {
    title: 'TLS/证书错误（PVE）',
    actions: [
      {
        title: '检查证书链',
        steps: ['确认系统时间正确', '若为自签名证书，请在 Source 中关闭 tls_verify（仅内网，需理解风险）'],
      },
    ],
  },
  HYPERV_TLS_ERROR: {
    title: 'TLS/证书错误（Hyper-V）',
    actions: [
      {
        title: '检查 WinRM HTTPS 证书',
        steps: ['确认 WinRM HTTPS 证书有效且链路可信', '必要时切换为 HTTP（仅内网）或修复证书'],
      },
    ],
  },
  PLUGIN_TIMEOUT: {
    title: '插件执行超时',
    actions: [
      {
        title: '降低规模或提高超时',
        steps: [
          '确认目标系统规模（资产数/节点数）与并发配置匹配',
          '必要时提高 ASSET_LEDGER_PLUGIN_TIMEOUT_MS',
          '重试该 Run',
        ],
      },
    ],
  },

  // ===== Version / Capability =====
  VCENTER_API_VERSION_UNSUPPORTED: {
    title: 'vCenter 版本范围不匹配/不支持',
    actions: [
      {
        title: '调整 Source 的版本范围',
        steps: ['若目标为 vCenter 6.5，请选择 preferred_vcenter_version=6.5-6.7', '重新执行 detect/collect 以验证'],
        links: [{ label: '打开 Sources', href: '/sources' }],
      },
    ],
  },

  // ===== Inventory / Schema / Plugin output =====
  INVENTORY_INCOMPLETE: {
    title: '采集清单不完整（inventory_complete=false）',
    actions: [
      {
        title: '优先修复导致清单不完整的根因',
        steps: ['检查权限/分页/限流/节点不可达等错误', '修复后重新执行 collect（清单完整后才会推进 missing/offline）'],
      },
    ],
  },
  INVENTORY_RELATIONS_EMPTY: {
    title: '关系缺失（relations=0）',
    actions: [
      {
        title: '检查关系构建所需字段/权限',
        steps: [
          '确认可读取 VM->Host、Host->Cluster 的关联信息',
          '修复后重新执行 collect',
          '若持续出现，请导出 Run 信息交给开发排查',
        ],
      },
    ],
  },
  SCHEMA_VALIDATION_FAILED: {
    title: 'Schema 校验失败',
    actions: [
      {
        title: '检查插件与核心版本/契约',
        steps: ['确认插件输出符合 normalized-v1/schema_version=collector-response-v1', '升级/回退插件版本后重试'],
      },
    ],
  },
  PLUGIN_OUTPUT_INVALID_JSON: {
    title: '插件输出不是有效 JSON',
    actions: [{ title: '检查插件日志与版本', steps: ['确认插件未崩溃/未输出额外日志到 stdout', '修复后重试'] }],
  },
  PLUGIN_EXEC_FAILED: {
    title: '插件启动失败',
    actions: [
      {
        title: '检查插件可执行路径与依赖',
        steps: ['确认插件路径配置正确（例如 ASSET_LEDGER_*_PLUGIN_PATH）', '确认运行环境依赖（bun/node/权限）满足'],
      },
    ],
  },
  PLUGIN_EXIT_NONZERO: {
    title: '插件异常退出（exit code != 0）',
    actions: [{ title: '查看错误详情并重试', steps: ['查看主错误 code/message', '修复后重试'] }],
  },
};

export function getRunErrorUiMeta(code: string | null | undefined): RunErrorUiMeta {
  if (!code) return { title: '未知错误', actions: GENERIC_ACTIONS };
  const meta = ERROR_CODE_META[code];
  if (meta) return meta;
  return { title: `未知错误（${code}）`, actions: GENERIC_ACTIONS };
}
