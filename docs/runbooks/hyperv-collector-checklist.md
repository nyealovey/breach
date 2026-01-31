# Hyper-V 采集验收清单（WinRM）

> 适用范围：M4（Hyper-V 采集 v1.0）  
> 对齐 PRD：`docs/prds/M4-asset-ledger-hyperv-collector-v1.0-prd.md`

## 1. 前置条件（必须满足，否则采集将失败）

### 1.1 单机（standalone）

- WinRM 已启用（示例：`winrm quickconfig`）
- 防火墙允许 WinRM 端口（HTTP 5985 / HTTPS 5986）
- 账号具备 Hyper-V 只读枚举权限（例如 Hyper-V Administrators 组或等价）
- 若使用 HTTPS 且 `tls_verify=true`：证书必须有效且链路可被采集侧信任

### 1.2 群集（Failover Cluster）

- 所有节点满足「单机」前置条件
- 账号具备 Failover Cluster 读取权限（可执行 `Get-Cluster` / `Get-ClusterNode` / `Get-ClusterGroup`）
- **强约束**：collect 时任一节点不可达/不可枚举，Run 必须失败（避免产生不完整清单推进治理语义）

## 2. 配置检查（Sources / Credentials）

### 2.1 Credential（hyperv）

- 必填：`username` / `password`
- 可选：`domain`
  - 填写后会以 `DOMAIN\username` 形式认证（触发 NTLM）

### 2.2 Source（hyperv）

最小必填：

- `endpoint`：建议填写 **任一节点** hostname/IP（也可尝试群集名，但若 WinRM 不在群集名上监听会连接失败）

推荐配置：

- `scheme`：`https`（默认）或 `http`
- `port`：默认 `https=5986`、`http=5985`
- `tls_verify`：默认 `true`（仅自签名/内网才考虑关闭）
- `timeout_ms`：默认 `60000`
- `scope`：`auto|standalone|cluster`（默认 `auto`；生产建议显式填写以减少误判）
- `max_parallel_nodes`：默认 `5`（群集并发上限）

## 3. 手工验收步骤（UI）

### 3.1 healthcheck（连通性 + 基线能力）

1. 打开 `/sources`，进入对应 Hyper-V Source
2. 手动触发 `healthcheck`

期望：

- Run 成功
- 无 errors

### 3.2 detect（形态识别）

1. 手动触发 `detect`

期望（best-effort）：

- `detectResult.capabilities.is_cluster` 能反映是否为群集
- `detectResult.capabilities.recommended_scope` 为 `standalone|cluster`

### 3.3 collect（清单 + 关系）

1. 手动触发 `collect`

期望（成功时）：

- `stats.inventory_complete=true`
- `relations.length > 0`
- standalone：至少包含 `VM -> Host`（runs_on）
- cluster：至少包含 `Host -> Cluster`（member_of）；`VM -> Host` 尽力输出（best-effort）

失败时常见错误码（示例）：

- 网络/端口/WinRM 未启用：`HYPERV_NETWORK_ERROR`（retryable=true）
- 认证失败：`HYPERV_AUTH_FAILED`（retryable=false）
- 权限不足：`HYPERV_PERMISSION_DENIED`（retryable=false）
- TLS/证书：`HYPERV_TLS_ERROR`（retryable=false）
- 群集节点不可达导致清单不完整：`INVENTORY_INCOMPLETE`（同时会包含底层 node 错误上下文）
