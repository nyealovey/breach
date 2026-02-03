# Hyper-V PowerShell Plugin Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 Hyper-V 采集插件从 TypeScript 方案迁移为 **PowerShell（pwsh）实现**，在不改 Hyper-V 服务器 WinRM 配置的前提下，覆盖 **Failover Cluster**（含 VM owner 关系），并输出符合 `collector-response-v1` + `normalized-v1` 的 assets/relations。

**Architecture:**

- 保留现有 TS 插件不删（便于回滚），新增 `plugins/hyperv/index.ps1` 作为新插件入口。
- Worker 侧支持执行 `.ps1`（用 `pwsh -File` 调起），避免依赖 \*nix 可执行位/Shebang。
- PowerShell 插件：stdin 读 `collector-request-v1` → 远程 WinRM 执行 PowerShell（healthcheck/detect/collect）→ stdout 输出 `collector-response-v1` JSON。
- Cluster：先 cluster discovery（cluster name + nodes），再对每个 node 采集 Host + VM；用 `Get-ClusterGroup` best-effort 获取 VM owner node，构建 `VM -> Host -> Cluster`。

**Tech Stack:** Node/Bun（worker）、PowerShell 7+（pwsh）、WinRM/WSMan（服务器侧）、vitest（仅用于 TS 侧纯函数/runner 单测）。

---

### Task 0: 先把“运行环境”定死（阻塞项）

**Files:**

- Modify: `docs/runbooks/hyperv-collector-checklist.md`

**Step 1: 确认 worker 运行 OS 与可装依赖**

- 结论：开发/测试在 **macOS**；生产在 **Linux + Docker**。
- 要求：Docker 镜像内需要具备 `pwsh`（PowerShell 7+）与 `curl`。

**Step 2: 确认可用认证方式（不改服务器配置）**

- 结论：使用 **NTLM** + **FQDN**（endpoint 用 FQDN）。
- 备注：若提供 `credential.domain`，则 NTLM 用户名用 `DOMAIN\\username`；否则用 `username`。

**Step 3: 在 runbook 补充“PowerShell 插件依赖/限制”**

- 增加一节：PowerShell 插件依赖（`pwsh`、支持 NTLM 的 `curl`、以及 docker 镜像如何安装）。

---

### Task 1: Worker 支持 `.ps1` 插件执行（不影响现有 `.ts`）

**Files:**

- Modify: `src/bin/worker.ts`
- Create: `src/bin/worker-plugin-runner.test.ts` (vitest)

**Step 1: 抽一个纯函数做“插件命令行解析”**

- 新增函数（示例签名）：

```ts
export function buildPluginCommand(pluginPath: string): { cmd: string; args: string[] } {
  // .ps1 → pwsh -NoProfile -NonInteractive -File <pluginPath>
  // others → <pluginPath>
}
```

**Step 2: 写 failing test**

- `plugins/hyperv/index.ps1` → `cmd=pwsh` 且 args 包含 `-File`。
- `plugins/hyperv/index.ts` → `cmd=plugins/hyperv/index.ts` 且 args 为空。

Run: `bun run test src/bin/worker-plugin-runner.test.ts`
Expected: FAIL（函数不存在）。

**Step 3: 最小实现 + 接入 `runPlugin()`**

- `runPlugin()` 改为：`spawn(cmd, args, { stdio: ... })`。

**Step 4: 跑单测**
Run: `bun run test src/bin/worker-plugin-runner.test.ts`
Expected: PASS。

---

### Task 2: 新增 PowerShell 插件骨架（stdin→stdout 契约打通）

**Files:**

- Create: `plugins/hyperv/index.ps1`
- Modify: `README.md`

**Step 1: 建立最小可运行脚本（只处理输入合法性）**

- 行为：
  - stdin 读 JSON
  - 校验 `schema_version=collector-request-v1` + `source.source_type=hyperv`
  - 输出 `collector-response-v1`（空 assets/relations、errors 填充）

代码骨架（示例）：

```powershell
#!/usr/bin/env pwsh
$ErrorActionPreference = 'Stop'

function New-Response([hashtable]$Partial) {
  return @{
    schema_version = 'collector-response-v1'
    assets = @()
    relations = @()
    stats = @{ assets = 0; relations = 0; inventory_complete = $false; warnings = @() }
    errors = @()
  } + $Partial
}

$inputText = [Console]::In.ReadToEnd()
try { $req = $inputText | ConvertFrom-Json -Depth 20 } catch {
  $resp = New-Response @{ errors = @(@{ code='HYPERV_PARSE_ERROR'; category='parse'; message='invalid input json'; retryable=$false }) }
  $resp | ConvertTo-Json -Compress -Depth 20
  exit 1
}

if ($req.schema_version -ne 'collector-request-v1') {
  (New-Response @{ errors = @(@{ code='HYPERV_CONFIG_INVALID'; category='config'; message='unsupported schema_version'; retryable=$false }) }) | ConvertTo-Json -Compress -Depth 20
  exit 1
}
```

**Step 2: README 增加“如何切换 Hyper-V 插件实现”**

- 说明：通过 `ASSET_LEDGER_HYPERV_PLUGIN_PATH` 指向 `plugins/hyperv/index.ps1`。
- 说明：需要 `pwsh` 在 PATH。

---

### Task 3: PowerShell 侧统一的配置解析 + 错误映射

**Files:**

- Modify: `plugins/hyperv/index.ps1`

**Step 1: 解析 config/credential（严格校验，缺失即 HYPERV_CONFIG_INVALID）**

- 必填：`endpoint/username/password`
- 可选：`scheme/port/tls_verify/timeout_ms/auth_method/scope/max_parallel_nodes/domain`

**Step 2: 实现错误映射 helper（对齐现有错误码）**

- 输出 `errors[]` 结构：`code/category/message/retryable/redacted_context`。
- 规则最低要求：
  - config 缺失 → `HYPERV_CONFIG_INVALID`
  - 401/Unauthorized → `HYPERV_AUTH_FAILED`
  - 403/Access denied → `HYPERV_PERMISSION_DENIED`
  - timeout/DNS/TCP → `HYPERV_NETWORK_ERROR`（retryable=true）
  - TLS/cert → `HYPERV_TLS_ERROR`
  - JSON/解析 → `HYPERV_PARSE_ERROR`

---

### Task 4: 远程执行层（WinRM 运行 PowerShell）

**Files:**

- Modify: `plugins/hyperv/index.ps1`
- Modify: `docs/runbooks/hyperv-collector-checklist.md`

**Step 1: 实现路径（已定）**

- worker=Linux（Docker），不走 Windows 原生 remoting；采用 **curl + WSMan SOAP** 方案。
- 认证：使用 `curl --ntlm`。
  - 为避免 argv 泄露明文凭证：用临时 `curl` config file（`--config <file>`）承载 `user = "..."`，并在请求后删除。
- endpoint：FQDN；URL 形如：`http(s)://<host>:<port>/wsman`。

**Step 2: 实现 `Invoke-HypervRemote`（统一入口）**

- 输入：host/port/scheme/tls_verify/timeout/auth_method/credential/script
- 输出：字符串或对象（建议直接在远程 `ConvertTo-Json -Compress`，本地再 `ConvertFrom-Json`）

**Step 3: 在 runbook 写清楚依赖安装与排障**

- 例如：`pwsh` 安装、是否需要额外模块、证书校验开关含义。

---

### Task 5: healthcheck（最小可用）

**Files:**

- Modify: `plugins/hyperv/index.ps1`

**Step 1: 远程执行最小脚本**

- 目标：验证 WinRM 可用 + 账号可执行 PowerShell + 能发现 `Get-VM` cmdlet。

远程脚本建议：

```powershell
$ErrorActionPreference = 'Stop'
$canList = $false
try { if (Get-Command Get-VM -ErrorAction Stop) { $canList = $true } } catch { $canList = $false }
[pscustomobject]@{ ok = $true; can_list_vms = $canList } | ConvertTo-Json -Compress
```

**Step 2: 成功时返回 exitCode=0**

- `errors=[]`

**Step 3: 失败时返回 exitCode=1**

- `errors=[mappedError]`

---

### Task 6: detect（cluster 识别 + 能力探测）

**Files:**

- Modify: `plugins/hyperv/index.ps1`

**Step 1: 远程探测 OS 版本（best-effort）**

- `Get-CimInstance Win32_OperatingSystem | Select -First 1`

**Step 2: 远程探测 cluster（best-effort）**

- 若可执行 `Get-Cluster`：取 cluster name、node count。
- 可选：`Get-ClusterS2D` 判断 S2D。

**Step 3: 组装 detectResult**

- 字段尽量对齐 PRD：`capabilities.is_cluster/cluster_name/node_count/is_s2d/can_list_vms/recommended_scope/configured_scope`

---

### Task 7: collect（standalone）

**Files:**

- Modify: `plugins/hyperv/index.ps1`

**Step 1: 远程采集 host 基础信息**

- `Win32_BIOS/Win32_ComputerSystem/Win32_ComputerSystemProduct/Win32_OperatingSystem`

**Step 2: 远程采集 VM 列表（必须能列举完整清单，否则失败）**

- `Get-VM` 输出：VMId/Name/State/ProcessorCount/MemoryStartup

**Step 3: 规范化输出（normalized-v1）**

- Host external_id：优先 host_uuid，否则 hostname。
- VM external_id：VMId（GUID string）。
- power_state 映射：Running→poweredOn；Off→poweredOff；Paused/Saved→suspended。

**Step 4: 关系输出 + 硬失败规则**

- 对每个 VM 输出 `runs_on` + `hosts_vm`。
- 若 `relations.length==0`：返回 `INVENTORY_RELATIONS_EMPTY` 且 exitCode=1。

---

### Task 8: collect（Failover Cluster，含 VM owner 关系）

**Files:**

- Modify: `plugins/hyperv/index.ps1`

**Step 1: cluster discovery（必须）**

- `Get-Cluster` + `Get-ClusterNode` 得到 clusterName + nodes。
- 注意：`Get-ClusterNode` 可能返回短名；若节点名不含 `.`，则用入口 `endpoint` 的域后缀补全为 FQDN（best-effort），否则在 Linux 容器里可能无法解析。
- discovery 失败：`HYPERV_CONFIG_INVALID` + exitCode=1。

**Step 2: best-effort 获取 VM owner 映射**

- `Get-ClusterGroup` 过滤 VirtualMachine 类型，得到 `vmName -> ownerNode`。

**Step 3: 对每个 node 采集 host + vms（inventory complete 强约束）**

- 任一 node 失败：
  - errors：node 级错误（mapped） + `INVENTORY_INCOMPLETE`
  - exitCode=1

**Step 4: VM 去重与 owner 优先**

- 同一 VMId 可能在多个 node 被观察到：优先选择 `ownerNode` 对应的那份记录。

**Step 5: 输出资产与关系**

- Assets：1 cluster + M hosts + N vms。
- Relations：
  - host `member_of` cluster（必须可用）
  - vm `runs_on` host（优先 owner node）
  - hosts_vm 反向边
- 若 `relations==0`：`INVENTORY_RELATIONS_EMPTY` + exitCode=1。

---

### Task 9: 切换与回滚策略（文档与默认值）

**Files:**

- Modify: `README.md`
- Modify: `docs/runbooks/hyperv-collector-checklist.md`

**Step 1: 文档写清楚“如何启用新插件/如何回滚”**

- 新插件：`ASSET_LEDGER_HYPERV_PLUGIN_PATH=plugins/hyperv/index.ps1`
- 回滚：改回 `plugins/hyperv/index.ts`

**Step 2: 文档写清楚依赖差异**

- TS 插件依赖（`winrm-client`；Kerberos 模式还需 `kinit` + `curl --negotiate`） vs pwsh 插件依赖（`pwsh` + 支持 NTLM 的 `curl`）。

---

### Task 10: 验证（必须）

**Step 1: TS 侧检查**

- Run: `bun run format:check`
- Run: `bun run lint`
- Run: `bun run type-check`

Expected: 全部通过。

**Step 2: 真实环境验证（按 runbook 验收路径）**

- `healthcheck` 成功
- `detect` 能识别 cluster/standalone
- `collect(cluster)`：`stats.inventory_complete=true` 且 `relations>0` 且包含 `member_of` +（尽力）`runs_on`

---
