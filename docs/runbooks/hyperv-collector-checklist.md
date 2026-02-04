# Hyper-V 采集验收清单（WinRM / Agent）

> 适用范围：M4（Hyper-V 采集 v1.0）  
> 对齐 PRD：`docs/prds/M4-asset-ledger-hyperv-collector-v1.0-prd.md`

## 1. 前置条件（必须满足，否则采集将失败）

### 1.0 选择采集方式（connection_method）

- `connection_method=winrm`：Linux worker 直连 WinRM（旧方案；兼容保留）
- `connection_method=agent`：Linux 插件仅调用 Windows Agent，由 Agent（入域 + gMSA）在域内完成 Kerberos/Negotiate（推荐）

### 1.1 Agent / 网络（connection_method=agent）

- 在入域 Windows 上部署 Hyper-V Agent（建议直接部署在 Hyper-V 节点上）
- core/worker 能访问 `agent_url`（端口放行、仅内网；ping 通不代表端口可用）
- Agent 以 gMSA 运行（推荐）：无需保存密码即可获得域身份与 Kerberos 票据
- 也支持普通域账号运行（可选）：由 Windows Service 保存密码，但需自行处理密码到期/轮换

#### 1.1.1 gMSA 落地步骤（推荐）

> 目标：让 Agent 以 **域身份**运行，但 **不需要保存密码**，从而在域内自然获取 Kerberos 票据。

AD 侧（域管执行）：

1. 创建 gMSA（示例：`breachHypervAgent$`）
2. 绑定允许使用该 gMSA 的机器（建议就是部署 Agent 的那几台 Hyper-V 节点）

Windows 侧（部署 Agent 的机器）：

1. 安装并验证 gMSA（需要 RSAT/AD 模块）：
   - `Install-ADServiceAccount breachHypervAgent`
   - `Test-ADServiceAccount breachHypervAgent`
2. 安装/配置 Agent 为 Windows Service，且满足：
   - Service 的 Log On Account = `DOMAIN\\breachHypervAgent$`
   - 配置 Agent 配置文件 `hyperv-agent.config.json`（含 `token/bind/port/ps_timeout_ms/log`；与 exe 同目录或通过 `--config <path>` 指定）
3. 权限（最小化授权）：
   - Hyper-V 只读枚举权限（等价 Hyper-V Administrators 或更细粒度授权）
   - Failover Cluster 读取权限（能执行 `Get-Cluster*`）
4. 网络：
   - core/worker 能访问 Agent 监听的 `agent_url`（仅内网放行）

> Agent 构建/启动方式与 API 契约：见 `agents/hyperv-windows-agent/README.md`。

#### 1.1.2 普通域账号运行（可选）

如果你不想上 gMSA，也可以先用普通域账号跑通链路（本质：让采集在 Windows 域内完成 SSPI 协商，避免 Linux 侧 Kerberos 环境复杂度）：

1. 将 Agent 安装为 Windows Service
2. Service 的 Log On Account = `DOMAIN\\someUser`（普通域用户）
3. 赋予该账号 Hyper-V / Failover Cluster 只读枚举权限（同 1.1.1）
4. 关注密码到期与轮换：避免服务因密码过期突然停止

### 1.2 WinRM / 网络（connection_method=winrm）

- WinRM 已启用（示例：`winrm quickconfig`）
- 防火墙允许 WinRM 端口（HTTP `5985` / HTTPS `5986`）
- 采集侧可直连目标端口（**ping 通不代表 WinRM 端口可用**）
- 若使用 HTTPS 且 `tls_verify=true`：证书必须有效且链路可被采集侧信任

### 1.3 Kerberos（WinRM 模式推荐，默认路径）

本项目默认 `auth_method=auto`，会优先走 Kerberos/Negotiate（不要求改服务器默认 WinRM 配置；WinRM 默认通常禁用 Basic）。

要求：

- `endpoint` 建议填写 **hostname/FQDN**；若填写 IP，则最好具备 PTR 反解到 FQDN（用于匹配 Kerberos SPN）
- 采集 worker 环境需要具备：
  - `kinit`（Kerberos client）
  - 支持 `--negotiate` 的 `curl`（带 GSSAPI/SPNEGO）

### 1.4 账号权限（WinRM/Agent 通用）

- 账号具备 Hyper-V 只读枚举权限（例如 Hyper-V Administrators 组或等价只读权限）
- 群集场景还需具备 Failover Cluster 读取权限（能执行 `Get-Cluster` / `Get-ClusterNode` / `Get-ClusterGroup`）

## 2. 配置检查（Sources / Credentials）

### 2.1 Credential（hyperv）

- Agent（connection_method=agent）：
  - 必填：`{ auth: 'agent', token }`
- WinRM（connection_method=winrm）：
  - 必填：`{ auth: 'winrm', username, password }`
  - 可选：`domain`
    - 当 Source 选择 `auto/kerberos` 时：`domain` 可用于 Kerberos realm 推导
    - 当 Source 选择 `ntlm/basic`（legacy）或 `auto` 降级时：会以 `DOMAIN\username` 形式走 NTLM（legacy）
  - 建议：如已知 UPN，直接在 `username` 填写 `user@upnSuffix`（多域环境更稳定）

### 2.2 Source（hyperv）

最小必填（Agent）：

- `connection_method`：`agent`
- `agent_url`：例如 `http://hyperv-agent01:8787`

推荐配置（Agent）：

- `agent_tls_verify`：默认 `true`（仅 https 生效；自签名/内网才考虑关闭）
- `agent_timeout_ms`：默认 `60000`（群集/慢环境可适当调大）
- `scope`：`auto|standalone|cluster`（默认 `auto`；生产建议显式填写以减少误判）
- `max_parallel_nodes`：默认 `5`（群集并发上限；由 Agent 在域内并发调用节点）

最小必填（WinRM / legacy）：

- `connection_method`：`winrm`（或不填，默认 winrm）
- `endpoint`：建议填写 **任一节点** hostname/FQDN（也可尝试群集名，但若 WinRM 不在群集名上监听会连接失败）

推荐配置（WinRM / legacy）：

- `auth_method`：`auto`（默认，优先 Kerberos）或 `kerberos`（强制）
- `kerberos_service_name`：Kerberos SPN service class（默认 `WSMAN`；多数 WinRM 环境为 `WSMAN/<host>`）
- `kerberos_spn_fallback`：是否启用兼容 fallback（默认 `false`；仅在少数环境排障时再开启）
- `kerberos_hostname_override`：高级选项（默认不填；仅当 URL host 与 Kerberos SPN hostname 不一致时使用，例如 CNAME）
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

### 4.0 Agent 常见失败（connection_method=agent）

- `HYPERV_AGENT_UNREACHABLE`：agent 不可达/超时；检查 `agent_url`、端口放行、Agent 配置里的 `bind/port` 是否对外监听
- 若你在另一台机器（core/worker 或 Postman）访问 Agent：确保 `bind=0.0.0.0`（或绑定到具体网卡 IP），并放行 Windows 防火墙端口；`bind=127.0.0.1` 仅本机可访问
- `HYPERV_AGENT_AUTH_FAILED`：token 错误；确认 Hyper-V Credential 使用 `{ auth: 'agent', token }` 且与 Agent 配置文件里的 `token` 一致
- `HYPERV_AGENT_PERMISSION_DENIED`：权限不足；检查 Agent 运行身份（推荐 gMSA）及其 Hyper-V / Failover Cluster 读取权限
- `HYPERV_AGENT_PS_ERROR`：PowerShell 执行失败；优先查看 `errors[].redacted_context` 的 `stderr_excerpt/exit_code`，并在 Agent 机器上手工运行 `scripts/*.ps1` 复现
- Agent 启动后没有日志/端口未监听：常见原因是 `log.dir` 无写权限（例如安装在 `Program Files`）；优先按 `agents/hyperv-windows-agent/README.md` 调整 `log.dir`（推荐写到 `%ProgramData%`）

### 4.1 超时（timeout）

- ping 通只说明 ICMP 可达；WinRM 需要 TCP 5985/5986 可达
- 可能原因：端口被防火墙/ACL 拦截、代理/中间设备丢包、WinRM 服务未就绪

### 4.2 认证失败（401 / authentication failed）

1. 在 worker 侧开启 debug：
   - `ASSET_LEDGER_HYPERV_DEBUG=1`
2. 复现一次 `healthcheck`
3. 查看 `logs/hyperv-winrm-debug-YYYY-MM-DD.log`：
   - 若走 Kerberos（`auth_method=auto|kerberos`）：优先看 `winrm.pywinrm.*` 事件
     - `winrm.pywinrm.debug` 的 `python_stderr` 会包含 `[pywinrm-debug]` 行（`kinit.*` / `session.create` / `error`）
     - 若出现 `authGSSClientInit()` 失败：通常表示凭据缓存（ccache）不可用/不可读，或 principal/realm 归一化不一致；优先使用 UPN（`user@REALM`）+ FQDN endpoint 复现
   - 仅当 `auth_method=auto` 且发生降级时，才会出现 `winrm.curl` 事件：
     - 关注 `headers.www_authenticate_schemes`（只记录 scheme，不记录 token）
     - 若 401：对照 `service_name`（SPN service class）与 `stderr_excerpt` 判断是 Kerberos 协商失败还是服务器仅支持 NTLM/Basic

> 注意：`logs/` 可能包含敏感基础设施信息，已加入 `.gitignore`，请勿提交。

### 4.3 HTTP 500（CreateShell failed）

现象：

- debug 日志出现 `CreateShell failed with status 500`（常见于 `hyperv.healthcheck.CreateShell`）

常见原因（按优先级）：

- WinRM/WinRS 远程 shell 被策略关闭或服务端拒绝创建 shell
- 账号缺少 WinRM/WinRS 远程执行权限（即使 Kerberos 协商成功，也可能在 CreateShell 阶段被拒绝）
- endpoint/端口并非 WinRM（或被中间设备/代理接管），导致 WSMan SOAP 不兼容

建议动作（不要求由采集侧自动改目标配置）：

- 在目标机本地检查 WinRM/WinRS 配置：
  - `winrm quickconfig`
  - `winrm get winrm/config/winrs`
  - `winrm get winrm/config/service`
  - `winrm enumerate winrm/config/listener`
- 查看事件日志：`Microsoft-Windows-WinRM/Operational`

### 4.4 HTTP 503（Service Unavailable / Bad HTTP response Code 503）

现象（常见于 pywinrm 路径）：

- debug 日志出现：`Bad HTTP response returned from server. Code 503`

常见原因（按优先级）：

- 目标机 WinRM 服务未运行/未就绪（HTTP.sys 仍返回 503）
- 目标端口被非 WinRM 服务接管（中间件/安全设备/代理/自定义服务），返回 503
- WinRM 监听存在但服务端组件异常（需结合事件日志确认）

建议动作（不要求由采集侧自动修复）：

- 在目标机本地执行：
  - `Get-Service WinRM`
  - `winrm quickconfig`
  - `winrm enumerate winrm/config/listener`
- 查看事件日志：`Microsoft-Windows-WinRM/Operational`
