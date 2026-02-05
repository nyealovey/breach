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
        steps: [
          '在 Credentials 检查用户名/密码是否正确',
          '确认账号未锁定/未过期',
          '在调度组页面点击「运行」并选择 healthcheck（或在 /api/docs 调用 POST /api/v1/sources/:id/runs）',
        ],
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
        steps: [
          '确认 tokenId/secret 或用户名/密码正确',
          '确认 token 未被撤销',
          '在调度组页面点击「运行」并选择 healthcheck（或在 /api/docs 调用 POST /api/v1/sources/:id/runs）',
        ],
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
          '在调度组页面点击「运行」并选择 healthcheck（或在 /api/docs 调用 POST /api/v1/sources/:id/runs）',
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
          '在调度组页面点击「运行」并选择 healthcheck（或在 /api/docs 调用 POST /api/v1/sources/:id/runs）',
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
  PVE_RATE_LIMIT: {
    title: 'API 限流（PVE）',
    actions: [
      {
        title: '降低并发并重试',
        steps: ['降低 Source 的 max_parallel_nodes', '稍后重试该 Run（或等待下次调度）'],
        links: [{ label: '打开 Sources', href: '/sources' }],
      },
    ],
  },
  PVE_GUEST_AGENT_UNAVAILABLE: {
    title: 'Guest Agent 不可用（PVE）',
    actions: [
      {
        title: '启用 QEMU Guest Agent（用于采集 VM IP）',
        steps: [
          '在目标 VM 内安装并启动 qemu-guest-agent（或确保该服务处于 running 状态）',
          '在 PVE 中为该 VM 启用 QEMU Guest Agent（硬件/选项中相关开关）',
          '修复后重新触发 collect（无 agent 的 VM 将保留空 IP，但不影响 inventory complete）',
        ],
        links: [{ label: '打开 Sources', href: '/sources' }],
      },
    ],
  },
  HYPERV_VM_IP_UNAVAILABLE: {
    title: 'VM IP 未采集（Hyper-V）',
    actions: [
      {
        title: '启用/修复来宾集成服务（用于采集 VM IP）',
        steps: [
          '确认 VM 处于 Running（poweredOn）状态',
          '在 VM 内确保集成服务/驱动可用（Windows 建议检查 Integration Services；Linux 建议检查 Hyper-V 集成组件）',
          '确认网络适配器已连接且 VM 内实际拿到 IPv4 地址',
          '修复后重新触发 collect（缺 IP 的 VM 将保留空 IP，但不影响 inventory complete）',
        ],
        links: [{ label: '打开 Sources', href: '/sources' }],
      },
    ],
  },
  HYPERV_HOST_IP_UNAVAILABLE: {
    title: 'Host IP 未采集（Hyper-V）',
    actions: [
      {
        title: '检查主机网络信息读取能力',
        steps: [
          '确认目标节点可执行 Get-NetIPAddress（AddressFamily=IPv4）并返回管理口 IP',
          '确认采集账号具备读取网络配置的权限（WinRM/Agent 模式均需）',
          '修复后重新触发 collect',
        ],
        links: [{ label: '打开 Sources', href: '/sources' }],
      },
    ],
  },
  HYPERV_HOST_DATASTORES_MISSING: {
    title: 'Host 存储明细缺失（Hyper-V）',
    actions: [
      {
        title: '检查卷/CSV 枚举能力',
        steps: [
          '确认目标节点可读取 Win32_LogicalDisk（本地卷容量）',
          '群集场景确认可读取 Get-ClusterSharedVolume + Win32_Volume（CSV 容量，best-effort）',
          '修复后重新触发 collect（缺明细不影响 inventory complete，但会影响对齐展示）',
        ],
        links: [{ label: '打开 Sources', href: '/sources' }],
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
  HYPERV_AGENT_KERBEROS_SPN: {
    title: 'Kerberos SPN 问题（Hyper-V Agent）',
    actions: [
      {
        title: '切换 WinRM Client SPN 前缀为 WSMAN',
        steps: [
          '查看错误详情里的 stderr_excerpt：若包含 Kerberos “找不到计算机/未知” 或提到 HTTP/<host> SPN，通常是 WinRM 客户端在请求 HTTP SPN',
          '若不允许在 AD 中添加 HTTP/<host> SPN，可在运行 Agent 的 Windows 上将 WinRM Client spn_prefix 设置为 WSMAN（机器级注册表变更）',
          '执行 reg query/reg add 后，运行 klist purge 并重启 Agent 进程/服务，再重试 collect',
        ],
        links: [
          { label: '打开 Agents', href: '/agents' },
          { label: '打开 Sources', href: '/sources' },
        ],
      },
    ],
  },
  HYPERV_AGENT_PS_ERROR: {
    title: 'PowerShell 执行失败（Hyper-V Agent）',
    actions: [
      {
        title: '按 stderr 排查',
        steps: [
          '在错误详情中查看 stderr_excerpt/exit_code（已脱敏）',
          '若 stderr 提到 Kerberos/SPN：优先按 Kerberos SPN 排障（常见修复：设置 WinRM Client spn_prefix=WSMAN）',
          '在 Agent 机器上手工运行 dist/scripts/*.ps1 复现，并结合 WinRM/WinRM Operational 事件日志定位',
        ],
        links: [
          { label: '打开 Agents', href: '/agents' },
          { label: '打开 Sources', href: '/sources' },
        ],
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
  PVE_PARSE_ERROR: {
    title: '解析失败（PVE）',
    actions: [
      {
        title: '确认 PVE 版本与接口返回',
        steps: [
          '查看 Run 详情中的错误上下文（已脱敏）',
          '确认 PVE 版本在支持范围内（5.x～8.x）',
          '升级/回退插件版本后重试',
        ],
      },
    ],
  },
  PVE_CONFIG_INVALID: {
    title: '配置错误（PVE）',
    actions: [
      {
        title: '检查 Source 与 Credential 配置',
        steps: [
          '确认 endpoint 正确（含 https:// 与端口）',
          '确认 Credential 的认证方式与字段完整',
          '修复后重试 detect/collect',
        ],
        links: [
          { label: '打开 Sources', href: '/sources' },
          { label: '打开 Credentials', href: '/credentials' },
        ],
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
