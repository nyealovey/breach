# Hyper-V 采集验收清单（WinRM）

> 适用范围：M4（Hyper-V 采集 v1.0）  
> 对齐 PRD：`docs/prds/M4-asset-ledger-hyperv-collector-v1.0-prd.md`

## 1. 前置条件（必须满足，否则采集将失败）

### 1.1 WinRM / 网络

- WinRM 已启用（示例：`winrm quickconfig`）
- 防火墙允许 WinRM 端口（HTTP `5985` / HTTPS `5986`）
- 采集侧可直连目标端口（**ping 通不代表 WinRM 端口可用**）
- 若使用 HTTPS 且 `tls_verify=true`：证书必须有效且链路可被采集侧信任

### 1.2 Kerberos（推荐，默认路径）

本项目默认 `auth_method=auto`，会优先走 Kerberos/Negotiate（不要求改服务器默认 WinRM 配置；WinRM 默认通常禁用 Basic）。

要求：

- `endpoint` 建议填写 **hostname/FQDN**；若填写 IP，则最好具备 PTR 反解到 FQDN（用于匹配 Kerberos SPN）
- 采集 worker 环境需要具备：
  - `kinit`（Kerberos client）
  - 支持 `--negotiate` 的 `curl`（带 GSSAPI/SPNEGO）

### 1.3 账号权限

- 账号具备 Hyper-V 只读枚举权限（例如 Hyper-V Administrators 组或等价只读权限）
- 群集场景还需具备 Failover Cluster 读取权限（能执行 `Get-Cluster` / `Get-ClusterNode` / `Get-ClusterGroup`）

## 2. 配置检查（Sources / Credentials）

### 2.1 Credential（hyperv）

- 必填：`username` / `password`
- 可选：`domain`
  - 当 Source 选择 `auto/kerberos` 时：`domain` 可用于 Kerberos realm 推导
  - 当 Source 选择 `ntlm/basic`（legacy）或 `auto` 降级时：会以 `DOMAIN\username` 形式走 NTLM（legacy）
- 建议：如已知 UPN，直接在 `username` 填写 `user@upnSuffix`（多域环境更稳定）

### 2.2 Source（hyperv）

最小必填：

- `endpoint`：建议填写 **任一节点** hostname/FQDN（也可尝试群集名，但若 WinRM 不在群集名上监听会连接失败）

推荐配置：

- `auth_method`：`auto`（默认，优先 Kerberos）或 `kerberos`（强制）
- `scheme`：默认建议 `http`
- `port`：默认 `http=5985`、`https=5986`
- `tls_verify`：默认 `true`（仅自签名/内网才考虑关闭）
- `timeout_ms`：默认 `60000`
- `scope`：`auto|standalone|cluster`（默认 `auto`；生产建议显式填写以减少误判）
- `max_parallel_nodes`：默认 `5`（群集并发上限）

## 3. 手工验收步骤（UI / API）

> 建议流程：先 `healthcheck` / `detect`，确认连通性与能力无误后再 `collect`。

### 3.1 healthcheck（连通性 + 基线能力）

方式一（UI）：

1. 打开 `/schedule-groups`
2. 选择对应调度组，点击「运行」并选择 `healthcheck`

方式二（API）：

- `POST /api/v1/sources/:id/runs`，body：`{ "mode": "healthcheck" }`

期望：

- Run 成功
- 无 errors

### 3.2 detect（形态识别）

触发方式同上（`mode=detect`）。

期望（best-effort）：

- `detectResult.capabilities.is_cluster` 能反映是否为群集
- `detectResult.capabilities.recommended_scope` 为 `standalone|cluster`

### 3.3 collect（清单 + 关系）

触发方式同上（`mode=collect`）。

期望（成功时）：

- `stats.inventory_complete=true`
- `relations.length > 0`
- standalone：至少包含 `VM -> Host`（runs_on）
- cluster：至少包含 `Host -> Cluster`（member_of）；`VM -> Host` 尽力输出（best-effort）

## 4. 常见失败与排障（不要求改服务器设置）

### 4.1 超时（timeout）

- ping 通只说明 ICMP 可达；WinRM 需要 TCP 5985/5986 可达
- 可能原因：端口被防火墙/ACL 拦截、代理/中间设备丢包、WinRM 服务未就绪

### 4.2 认证失败（401 / authentication failed）

1. 在 worker 侧开启 debug：
   - `ASSET_LEDGER_HYPERV_DEBUG=1`
2. 复现一次 `healthcheck`
3. 查看 `logs/hyperv-winrm-debug-YYYY-MM-DD.log`：
   - 关注 `winrm.curl` 事件里的 `headers.www_authenticate_schemes`（只记录 scheme，不记录 token）
   - 若 401：对照 `service_name`（SPN service class）与 `stderr_excerpt` 判断是 Kerberos 协商失败还是服务器仅支持 NTLM/Basic

> 注意：`logs/` 可能包含敏感基础设施信息，已加入 `.gitignore`，请勿提交。
