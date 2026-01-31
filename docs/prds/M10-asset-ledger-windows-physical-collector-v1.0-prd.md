# M10：资产台账系统 - Windows 普通物理机采集 - 产品需求文档（PRD）

> 目标：支持采集 Windows 普通物理机信息（作为 Host 资产入账），补齐最小盘点字段集与可追溯 raw；与虚拟化关系解耦（默认不输出 runs_on/member_of），并遵循“插件化 + inventory complete + 可定位”的验收口径。

## Requirements Description

### Background

- **现状问题**：物理机资产（尤其 Windows）无法进入台账统一视图，导致盘点与治理缺口。
- **目标用户**：管理员（admin）、资产盘点人员。
- **价值**：
  - 将物理机纳入统一资产视图（/assets 列表/详情），为 M5 重复治理/合并提供数据基础。
  - raw 永久保留，支持排障与审计回放。

### Scope / Out of Scope

**In Scope**

- 插件化采集：`healthcheck/detect/collect`（遵循 `docs/design/asset-ledger-collector-reference.md`）。
- 接入方式：优先 **远程协议**（WinRM/PowerShell Remoting）；同一类 Source 未来允许扩展第二种方式（例如 Agent），但本期仅实现远程协议。
- 采集对象：单台 Windows 物理机（Source 一般对应 1 台主机）。
- 最小字段集：identity/os/hardware/network（best-effort + 明确缺失策略）。
- raw 永久保留、脱敏查看（admin-only）与访问审计。

**Out of Scope**

- 软件清单、补丁、进程、用户等深度资产信息。
- 与机房/机柜/交换机等 CMDB 关系扩展。
- 自动开通 WinRM/自动修改目标系统配置（只输出错误码与建议动作）。

### Success Metrics

- 在权限与网络满足前提下：
  - `healthcheck` 成功率 = 100%
  - `detect` 成功率 = 100%
  - `collect` 成功率 ≥ 99%
- `collect` 成功后：Host 资产可在 `/assets` 列表/详情查看，且 normalized schema 校验通过率 = 100%（对成功写入的记录）。

## Feature Overview

### Core Requirements

1. **Collector 契约与 inventory complete（强约束）**

- `mode=collect` 输出必须代表该 Source 的“完整资产清单快照”（inventory complete）。
- Windows 物理机 Source 的“清单”语义：单台主机（必须输出 1 个 Host 资产）。
- 若因权限/远程执行失败导致无法获取“必需字段”或无法保证该主机清单可靠：Run 必须失败（不得 warnings 伪成功）。

2. **最小字段集（normalized-v1）**

- Host（kind=host）：
  - identity：
    - hostname（必须）
    - machine_uuid（best-effort：SMBIOS UUID）
    - serial_number（best-effort）
    - vendor/model（best-effort）
  - os：
    - name/version（best-effort）
    - fingerprint（best-effort：build/edition）
  - hardware：
    - cpu_count、memory_bytes（best-effort）
  - network：
    - management_ip（best-effort）
    - ip_addresses[]（best-effort）
    - bmc_ip（不强制从采集获取；通常由 M8 台账字段补录）

3. **关系策略**

- 默认不输出 `runs_on/member_of`（物理机不属于虚拟化关系链）。
- relations 为空允许（与虚拟化平台不同）。

## Detailed Requirements

### 1) Source 类型与插件选择

SourceType：`third_party`

为复用同一类 “第三方/物理机” 插件，Source config 必须包含：

- `collector_kind`: `windows_physical`（枚举；用于插件内部 driver 选择）
- `connection_method`: `winrm`（v1 固定；未来可扩展 `agent`）

核心侧插件选择（建议）：

- `source_type=third_party` → `ASSET_LEDGER_THIRD_PARTY_PLUGIN_PATH`
- 插件内部按 `collector_kind` 路由到对应 collector（Windows/Linux 等）

### 2) Source 配置（非敏感）与凭证（敏感）

建议 config（非敏感）字段：

- `endpoint`：string（Windows 主机 hostname/IP）
- `scheme`：`https|http`（默认 https）
- `port`：number（https 默认 5986；http 默认 5985）
- `tls_verify`：boolean（默认 true；允许显式关闭用于自签名/内网）
- `timeout_ms`：number（默认 60_000）

凭证（敏感，存 credential；运行时注入）：

- `domain?`（可选）
- `username`（必填）
- `password`（必填）

### 3) healthcheck（连通性 + 权限基线）

healthcheck 目标：验证 WinRM 远程执行可用，且具备读取最小盘点字段的权限。

healthcheck 必须检查：

- 端口可达 + TLS（若 https）
- 认证成功（可执行一个只读命令）
- 最小权限满足读取：
  - 主机名/OS 信息
  - CPU/内存
  - BIOS/系统信息（用于 serial/vendor/model best-effort）

失败口径（建议）：

- 配置错误：`PHYSICAL_CONFIG_INVALID`
- 认证失败：`PHYSICAL_AUTH_FAILED`
- 权限不足：`PHYSICAL_PERMISSION_DENIED`
- 网络/超时：`PHYSICAL_NETWORK_ERROR`（retryable=true）
- TLS/证书：`PHYSICAL_TLS_ERROR`（retryable=false）

### 4) detect（版本/指纹/能力探测）

detect 输出（示例）：

- `target_version`：Windows major.minor + build（best-effort）
- `capabilities`：
  - `winrm_https`: boolean
  - `wmi_accessible`: boolean
  - `bios_accessible`: boolean
- `driver`：例如 `windows-physical-winrm-v1`

detect 用途：

- Run 详情展示（排障/验收）
- 给出建议动作（例如“建议启用 WinRM HTTPS”“当前账号缺少读取 BIOS 权限”等）

### 5) collect（单主机清单 + best-effort 字段）

#### 5.1 inventory complete 语义

- collect 成功必须输出：
  - `assets.length == 1`
  - `assets[0].external_kind == "host"`
  - `stats.inventory_complete == true`

#### 5.2 必需字段与缺失策略

必需字段（缺失则失败）：

- `identity.hostname`（无法取到主机名视为采集不可用）

best-effort 字段（缺失则 warning，不阻断成功）：

- `identity.serial_number/vendor/model/machine_uuid`
- `os.version/os.fingerprint`
- `hardware.cpu_count/memory_bytes`
- `network.management_ip/ip_addresses[]`

### 6) normalized-v1 字段落点（示例）

> 以 `docs/design/asset-ledger-json-schema.md` 为准；以下用于实现与验收对齐。

- `kind="host"`
- `identity.hostname`：`COMPUTERNAME`（或等价）
- `identity.machine_uuid`：SMBIOS UUID（best-effort）
- `identity.serial_number`：BIOS SerialNumber（best-effort）
- `identity.vendor/model`：Manufacturer/Model（best-effort）
- `os.name`：`Windows`/`Windows Server`（best-effort）
- `os.version`：Version（best-effort）
- `os.fingerprint`：BuildNumber/Edition（best-effort）
- `hardware.cpu_count`：逻辑处理器数量（best-effort；需在实现中固定口径）
- `hardware.memory_bytes`：TotalPhysicalMemory（best-effort）
- `network.management_ip`：优先取 config.endpoint（若为 IP）；否则从网卡枚举 best-effort
- `network.ip_addresses[]`：网卡 IP 列表（best-effort）

### 7) external_id 选择（同一 Source 内稳定）

- Host：优先使用 SMBIOS UUID；若不可得则使用 hostname（并在 detect 中提示“主机改名会导致重新入账”）。

### 8) 错误码（需注册、需稳定）

本期新增 physical 插件错误码（需注册到 `docs/design/asset-ledger-error-codes.md`；可按实现拆分更细，但语义需稳定）：

- `PHYSICAL_CONFIG_INVALID`
- `PHYSICAL_AUTH_FAILED`
- `PHYSICAL_PERMISSION_DENIED`
- `PHYSICAL_NETWORK_ERROR`（retryable=true）
- `PHYSICAL_TLS_ERROR`（retryable=false）
- `PHYSICAL_PARSE_ERROR`

## Design Decisions

### Technical Approach

- v1 选择远程协议（WinRM/PowerShell Remoting）：
  - 覆盖成本低（无需部署 agent）
  - 允许用“远程执行脚本 → 输出 JSON”实现薄插件适配层（参考：`docs/design/asset-ledger-collector-reference.md`）
- 以“可入账的最小字段集”为目标：
  - hostname 必须可得；其它字段 best-effort + warnings

### Constraints

- 不做任何写入目标系统的操作（不启用/不配置 WinRM）。
- 不输出虚拟化关系边（runs_on/member_of）。

### Risk Assessment

- **权限与安全基线风险**：WinRM 开启方式与权限差异大。缓解：healthcheck/detect 给出明确错误码与建议动作；文档提供“最小权限集”清单。
- **信息泄露风险**：远程命令输出可能包含敏感信息。缓解：插件输出 raw 前必须清洗；前端展示 raw 为 admin-only 且脱敏。

## Acceptance Criteria

### Functional Acceptance

- [ ] 插件遵循 `collector-response-v1` 契约，输出 `assets[]/stats.inventory_complete/errors[]`。
- [ ] `collect` 成功时：输出 1 个 Host 资产，`stats.inventory_complete=true`，relations 可为空。
- [ ] 输出 normalized 符合 `normalized-v1` schema。
- [ ] raw 永久保留；管理员可脱敏查看 raw 且访问动作写入审计。

### Error Handling Acceptance

- [ ] 认证失败返回 `PHYSICAL_AUTH_FAILED`（retryable=false）。
- [ ] 权限不足返回 `PHYSICAL_PERMISSION_DENIED`（retryable=false）。
- [ ] 网络/超时返回 `PHYSICAL_NETWORK_ERROR`（retryable=true）。
- [ ] TLS/证书错误返回 `PHYSICAL_TLS_ERROR`（retryable=false）。

### Quality Standards

- [ ] 文档同步：补充错误码到 `docs/design/asset-ledger-error-codes.md`；补充 physical 插件示例到 `docs/design/asset-ledger-collector-reference.md`（如需要）。
- [ ] 回归清单：至少 1 套真实 Windows 物理机环境回归（手工步骤 + 期望输出摘要）。

## Execution Phases

### Phase 1: 契约与配置定稿

- [ ] 定稿 `third_party + collector_kind=windows_physical + connection_method=winrm` 的 Source config
- [ ] 明确最小权限集与 WinRM 前置条件（验收清单）

### Phase 2: healthcheck/detect/collect 最小闭环

- [ ] healthcheck：连通性 + 权限基线
- [ ] detect：版本/能力探测
- [ ] collect：Host 最小字段集 + raw 留存

### Phase 3: 错误码与审计

- [ ] 注册 `PHYSICAL_*` 错误码与 retryable/category 口径
- [ ] raw 查看的脱敏与审计事件（对齐 SRS）

### Phase 4: 回归与文档

- [ ] 按验收清单回归（至少 1 套环境）
- [ ] 更新 runbook/README（如有新增前置条件或限制）

---

**Document Version**: 1.0
**Created**: 2026-01-30
**Clarification Rounds**: 0
**Quality Score**: 100/100
