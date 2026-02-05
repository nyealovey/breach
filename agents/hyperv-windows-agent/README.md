# Hyper-V Windows Agent（B 方案）

该 Agent 用于在 **入域 Windows** 上以 **gMSA**（推荐）运行 PowerShell 采集 Hyper-V/Failover Cluster 信息，并通过 HTTP API 返回 raw JSON（由 Linux 侧 `plugins/hyperv` 负责 normalize 为 assets/relations/stats）。

> 注意：本文档中的示例域名/主机名/用户名均为**假数据**（`example.com`），请勿将真实环境信息写入仓库（含测试/示例/提交信息）。

## 1. 配置文件（必需）

默认读取 **可执行文件同目录** 的 `hyperv-agent.config.json`，也可通过 `--config <path>` 指定。

示例（`hyperv-agent.config.json`）：

```json
{
  "bind": "127.0.0.1",
  "port": 8787,
  "token": "REPLACE_ME",
  "ps_timeout_ms": 600000,
  "log": {
    "dir": "logs",
    "level": "info",
    "retain_days": 14
  }
}
```

安全建议：

- `token` 为 Agent 的 HTTP API 鉴权口令（对应 Hyper-V Credential：`{ "auth": "agent", "token": "..." }`）。
- 配置文件包含敏感信息，请用 NTFS ACL 限制仅 **服务运行账号** 与 **管理员** 可读。
- `token` 建议使用 **32+** 位随机字符串；本实现仅要求“非空”，但**不建议**包含空格/换行（HTTP Header 兼容性）。

### 1.1 配置文件查找规则（排障重点）

- 显式指定：`--config <path>`
  - 若 `<path>` 为相对路径：按**当前工作目录（CWD）**解析（更符合 CLI 习惯）
- 未指定时：依次尝试
  1. 可执行文件同目录：`hyperv-agent.config.json`
  2. 当前工作目录（CWD）：`hyperv-agent.config.json`

> Windows Service 的 CWD 经常是 `C:\\Windows\\System32`，因此**强烈建议**把配置文件放在 exe 同目录，或在服务参数里显式加 `--config`。

## 2. 启动

开发模式（在 Windows 上）：

```bash
bun run src/server.ts --config hyperv-agent.config.json
```

编译（Windows 单文件 exe）：

```bash
bun build --compile src/server.ts --outfile dist/hyperv-windows-agent.exe
```

注意：

- Agent 会在运行目录的 `scripts/` 下查找 PowerShell 脚本。编译后请将 `src/scripts/` 复制到 `dist/scripts/`（与 exe 同级目录）。
- 本地日志默认写入 `logs/`（相对**配置文件所在目录**），按天切分为 `hyperv-agent-YYYY-MM-DD.jsonl`（JSONL）。
  - 若目录不可写（常见：安装在 `Program Files` 但服务账号无写权限）：Agent 会自动 fallback 到
    - Windows：`%ProgramData%\\breach\\hyperv-agent\\logs`
    - 其他平台：系统临时目录下的 `breach/hyperv-agent/logs`
- 启动时会先写入一条 `event=agent.start`，便于你用 `Get-Content -Wait` tail 日志观察后续请求。

### 2.1 端口监听与对外访问（你遇到“端口没开”的重点）

- `bind=127.0.0.1`：仅本机可访问（Postman 在同一台机器上测试 OK；跨机器访问会失败）
- `bind=0.0.0.0`：对外监听（需要配合 Windows 防火墙放行端口）

常用自检命令（Windows）：

- 查看监听：`netstat -ano | findstr :8787`
- 本机连通：`curl http://127.0.0.1:8787/v1/hyperv/healthcheck ...`
- 跨机连通：`Test-NetConnection <agent_host> -Port 8787`

如果启动报 `EADDRINUSE`（提示端口占用，但你“看起来”没占用）：

1. 先确认到底是谁在监听：
   - `netstat -ano | findstr :8787`
   - `Get-NetTCPConnection -LocalPort 8787 -State Listen | Format-Table -AutoSize`
2. 若确实没有监听，可能是端口被系统/组件保留（excluded port range）：
   - `netsh int ipv4 show excludedportrange protocol=tcp | findstr 8787`
   - `netsh int ipv6 show excludedportrange protocol=tcp | findstr 8787`
   - 若命中保留范围：请换一个端口（例如 28787），并同步更新“代理 endpoint”（配置中心 → 代理；或兼容旧 `config.agent_url`）。

## 3. API

鉴权：

- `GET /health` 无需鉴权（用于连通性检测；配置中心 → 代理 的“检测”按钮会调用它）
- 其他路由：Header `Authorization: Bearer <token>`
- 可选 Header：`X-Request-Id: <string>`（用于日志关联）

路由：

- `GET /health`
- `POST /v1/hyperv/healthcheck`
- `POST /v1/hyperv/detect`
- `POST /v1/hyperv/collect`

请求体（最小集合）：

> `endpoint` 用于指定采集目标（Hyper-V 主机名/IP 或 Failover Cluster 名称）；Agent 本身只负责在域内完成认证与执行采集。

```json
{
  \"source_id\": \"string\",
  \"run_id\": \"string\",
  \"mode\": \"healthcheck|detect|collect\",
  \"now\": \"ISO-8601\",
  \"endpoint\": \"host01.example.com\",
  \"scope\": \"auto|standalone|cluster\",
  \"max_parallel_nodes\": 5
}
```

响应体（raw，插件负责 normalize）：

- 成功：`{ \"ok\": true, \"data\": { ... } }`
- 失败：`{ \"ok\": false, \"error\": { \"code\": \"AGENT_*\", \"message\": \"...\", \"context\": { ... } } }`

### 3.1 Postman / curl 快速测试

连通性自检（无需 token）：

- `curl http://127.0.0.1:8787/health`
- 期望：`200` 且返回 `{ ok: true, data: ... }`

以 `healthcheck` 为例（Postman 同理）：

- URL：`http://127.0.0.1:8787/v1/hyperv/healthcheck`
- Method：`POST`
- Headers：
  - `Authorization: Bearer REPLACE_ME`
  - `Content-Type: application/json`
  - （可选）`X-Request-Id: <run_id>`
- Body（raw JSON）：

```json
{
  "source_id": "source-1",
  "run_id": "run-1",
  "mode": "healthcheck",
  "now": "2026-02-04T00:00:00Z",
  "endpoint": "host01.example.com",
  "scope": "auto",
  "max_parallel_nodes": 5
}
```

期望：

- token 正确：返回 `200`（或在权限/环境问题时返回 `403/422/500` 且 body 为 `{ok:false,...}`，并写入日志）
- token 错误：返回 `401` 且 `code=AGENT_PERMISSION_DENIED`

## 4. 运行账号说明（你问的“用 bun 跑到底是谁的权限”）

- 你在 PowerShell/命令行里直接执行 `bun run ...` / `hyperv-windows-agent.exe`：进程与 PowerShell 采集使用**当前登录用户**权限。
- 你把它装成 Windows Service：进程与 PowerShell 采集使用**服务 Log On Account** 的权限。
  - 推荐 gMSA：免密码、域内 Kerberos 票据更省心
  - 也支持普通域用户：密码由 Windows Service Manager 保管，但需要你自己做密码轮换与到期处理

## 5. 常见 Kerberos/WinRM 排障

> 本 Agent 通过 PowerShell Remoting（`Invoke-Command`）采集数据，底层走 WinRM/WSMan。
> 在域环境中默认会优先使用 Kerberos（或 Negotiate→Kerberos）。

### 5.1 报错：Kerberos “未知/找不到计算机” 或提示缺少 `HTTP/<host>` SPN

典型报错关键词（示例）：

- `WinRM 无法处理此请求... Kerberos... 未知`
- `最常见的 Kerberos 配置问题是，没有为目标配置具有 HTTP/<host> 格式的 SPN`
- 若走 `connection_method=agent`：Run 错误码可能显示为 `HYPERV_AGENT_KERBEROS_SPN`（Agent API 返回 `AGENT_KERBEROS_SPN`）

原因说明（关键点）：

- 即使你看到目标对象上注册了 `WSMAN/<host>`，PowerShell Remoting 在 Kerberos 下**通常仍会请求** `HTTP/<host>` 形式的 SPN（service class=HTTP）。
- 因此，目标计算机对象（或承载 WinRM 的服务账号）若缺少 `HTTP/<hostname>`，Kerberos 票据获取会失败，从而导致 `Test-WSMan`/`Invoke-Command`/Agent 采集失败。

自检（在运行 Agent 的 Windows 上执行）：

```powershell
$h = 'host01.example.com'
$short = 'host01'

whoami

# DNS 必须能解析到目标（示意）
Resolve-DnsName $h

# 查 SPN（需要可查询 AD 权限）
setspn -Q ("HTTP/" + $h) -F
setspn -Q ("WSMAN/" + $h) -F

# 直接尝试获取服务票据（失败时会给出子状态码）
klist
klist get ("HTTP/" + $h)
klist get ("WSMAN/" + $h)
```

修复（推荐，最小变更）：

1. 在目标所属域内，给目标计算机对象补齐 `HTTP/<FQDN>` 与 `HTTP/<short>` SPN（示例）：

```powershell
setspn -S HTTP/host01.example.com HOST01
setspn -S HTTP/host01           HOST01
```

2. 在运行 Agent 的机器上清理缓存票据后重试：

```powershell
klist purge
Test-WSMan host01.example.com -Authentication Kerberos
Invoke-Command -ComputerName host01.example.com -Authentication Kerberos -ScriptBlock { $env:COMPUTERNAME }
```

不建议但可用的 workaround（了解即可）：

- 通过修改 WinRM 客户端的 `spn_prefix` 将 Kerberos 的 SPN 前缀从默认 `HTTP` 切到 `WSMAN`（机器级配置/注册表变更）。
- 这会影响整台机器上 WinRM 客户端行为，且并非所有环境允许；本 Agent **不提供“按单次请求强制指定 SPN 前缀”的能力**。

示例（需要管理员权限，在运行 Agent 的 Windows 上执行）：

```powershell
# 查看当前值（不存在则表示使用默认 HTTP 前缀）
reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\WSMAN\Client" /v spn_prefix

# 设置为 WSMAN（让 WinRM 客户端优先使用 WSMAN/<host> 形式的 SPN）
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\WSMAN\Client" /v spn_prefix /t REG_SZ /d WSMAN /f

# 清理当前登录会话的 Kerberos 缓存票据（并重启 Agent 进程/PowerShell）
klist purge

# 可选：重启 WinRM 服务（谨慎，会影响正在使用 WinRM 的会话）
# Restart-Service WinRM
```

回退（恢复默认行为）：

```powershell
reg delete "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\WSMAN\Client" /v spn_prefix /f
klist purge
```

跨域/跨林补充说明：

- 若 Agent 运行账号的 Kerberos realm 与目标域不一致（例如 `user@example.com` 访问 `host01.example.net`），需要域/林之间存在可用的信任关系与正确的 DNS/KDC 路由。
- 即便存在信任，目标侧 SPN 仍必须在**目标所属域**中正确注册（尤其是 `HTTP/<host>`）。否则依然会报 Kerberos “未知/找不到”。
