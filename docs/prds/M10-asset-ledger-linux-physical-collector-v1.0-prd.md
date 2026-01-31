# M10：资产台账系统 - Linux 普通物理机采集 - 产品需求文档（PRD）

> 目标：新增 Linux 普通物理机采集能力（作为 Host 资产入账），补齐最小盘点字段集与可追溯 raw；与虚拟化关系解耦（默认不输出 runs_on/member_of），并遵循“插件化 + inventory complete + 可定位”的验收口径。

## Requirements Description

### Background

- **现状问题**：Linux 物理机无法进入统一资产视图，盘点与治理不完整。
- **目标用户**：管理员（admin）、资产盘点人员。
- **价值**：
  - 补齐物理机资产面，支撑重复治理/合并（M5）与台账字段治理（M8）。
  - raw 永久保留，支持排障与审计回放。

### Scope / Out of Scope

**In Scope**

- 插件化采集：`healthcheck/detect/collect`（遵循 `docs/design/asset-ledger-collector-reference.md`）。
- 接入方式：优先 **远程协议**（SSH）；同一类 Source 未来允许扩展第二种方式（例如 Agent/CMDB 同步），但本期仅实现远程协议。
- 采集对象：单台 Linux 物理机（Source 一般对应 1 台主机）。
- 最小字段集：identity/os/hardware/network（best-effort + 明确缺失策略）。
- raw 永久保留、脱敏查看（admin-only）与访问审计。

**Out of Scope**

- 软件清单/包管理列表/漏洞扫描结果。
- 与机房/交换机等关系建模。
- 自动装 agent/自动修改目标系统配置（只输出错误码与建议动作）。

### Success Metrics

- 在权限与网络满足前提下：
  - `healthcheck` 成功率 = 100%
  - `detect` 成功率 = 100%
  - `collect` 成功率 ≥ 99%
- `collect` 成功后：Host 资产可在 `/assets` 可浏览，且 normalized schema 校验通过率 = 100%（对成功写入的记录）。

## Feature Overview

### Core Requirements

1. **Collector 契约与 inventory complete（强约束）**

- `mode=collect` 输出必须代表该 Source 的“完整资产清单快照”（inventory complete）。
- Linux 物理机 Source 的“清单”语义：单台主机（必须输出 1 个 Host 资产）。
- 若因权限/远程执行失败导致无法获取“必需字段”或无法保证该主机清单可靠：Run 必须失败（不得 warnings 伪成功）。

2. **最小字段集（normalized-v1）**

- Host（kind=host）：
  - identity：
    - hostname（必须）
    - machine_uuid（best-effort：system UUID）
    - serial_number/vendor/model（best-effort）
  - os：
    - name/version（best-effort）
    - fingerprint（best-effort：kernel/发行版指纹）
  - hardware：
    - cpu_count、memory_bytes（best-effort）
  - network：
    - management_ip（best-effort）
    - ip_addresses[]（best-effort）
    - bmc_ip（不强制从采集获取；通常由 M8 台账字段补录）

3. **关系策略**

- 默认不输出 `runs_on/member_of`。
- relations 为空允许。

## Detailed Requirements

### 1) Source 类型与插件选择

SourceType：`third_party`

Source config 必须包含：

- `collector_kind`: `linux_physical`
- `connection_method`: `ssh`（v1 固定；未来可扩展 `agent`/`cmdb_sync` 等）

核心侧插件选择（建议）：

- `source_type=third_party` → `ASSET_LEDGER_THIRD_PARTY_PLUGIN_PATH`
- 插件内部按 `collector_kind` 路由到对应 collector

### 2) Source 配置（非敏感）与凭证（敏感）

建议 config（非敏感）字段：

- `endpoint`：string（Linux 主机 hostname/IP）
- `port`：number（默认 22）
- `timeout_ms`：number（默认 60_000）
- `host_key_verify`：boolean（默认 true；允许显式关闭用于快速接入内网测试环境，关闭需 UI 风险提示）
- `auth_type`：`ssh_key|ssh_password`（默认 ssh_key）

凭证（敏感，存 credential；运行时注入）：

- `auth_type=ssh_key`：
  - `username`
  - `private_key_pem`（或 keyRef；实现侧择一）
  - `passphrase?`（可选）
- `auth_type=ssh_password`：
  - `username`
  - `password`

### 3) healthcheck（连通性 + 权限基线）

healthcheck 必须检查：

- SSH 可达（端口/网络）
- 认证成功（可执行一个只读命令）
- 最小权限满足读取：
  - hostname
  - OS 基本信息（/etc/os-release 或等价）
  - CPU/内存（/proc）

失败口径（建议，与 Windows 物理机复用同一套 `PHYSICAL_*`）：

- 配置错误：`PHYSICAL_CONFIG_INVALID`
- 认证失败：`PHYSICAL_AUTH_FAILED`
- 权限不足：`PHYSICAL_PERMISSION_DENIED`
- 网络/超时：`PHYSICAL_NETWORK_ERROR`（retryable=true）
- 解析失败：`PHYSICAL_PARSE_ERROR`

### 4) detect（版本/指纹/能力探测）

detect 输出（示例）：

- `target_version`：发行版 + 版本（best-effort）
- `capabilities`：
  - `can_read_dmi`: boolean（是否可读 /sys/class/dmi/id）
  - `can_read_ip`: boolean
- `driver`：例如 `linux-physical-ssh-v1`

### 5) collect（单主机清单 + best-effort 字段）

#### 5.1 inventory complete 语义

- collect 成功必须输出：
  - `assets.length == 1`
  - `assets[0].external_kind == "host"`
  - `stats.inventory_complete == true`

#### 5.2 必需字段与缺失策略

必需字段（缺失则失败）：

- `identity.hostname`

best-effort 字段（缺失则 warning，不阻断成功）：

- `identity.machine_uuid/serial_number/vendor/model`
- `os.name/os.version/os.fingerprint`
- `hardware.cpu_count/memory_bytes`
- `network.management_ip/ip_addresses[]`

### 6) normalized-v1 字段落点（示例）

> 以 `docs/design/asset-ledger-json-schema.md` 为准；以下用于实现与验收对齐。

- `kind="host"`
- `identity.hostname`：`hostname`（或等价）
- `identity.machine_uuid`：`/sys/class/dmi/id/product_uuid`（best-effort；不可得则缺失）
- `identity.serial_number`：`/sys/class/dmi/id/product_serial`（best-effort）
- `identity.vendor/model`：`/sys/class/dmi/id/sys_vendor`、`/sys/class/dmi/id/product_name`（best-effort）
- `os.name/os.version`：`/etc/os-release`（best-effort）
- `os.fingerprint`：`uname -r`（best-effort）
- `hardware.cpu_count`：`nproc`（best-effort）
- `hardware.memory_bytes`：`/proc/meminfo:MemTotal`（best-effort）
- `network.management_ip`：优先取 config.endpoint（若为 IP）；否则从网卡枚举 best-effort
- `network.ip_addresses[]`：`ip addr` 枚举（best-effort）

### 7) external_id 选择（同一 Source 内稳定）

- Host：优先使用 machine_uuid；若不可得则使用 hostname（并在 detect 中提示“主机改名会导致重新入账”）。

### 8) 错误码（需注册、需稳定）

复用 physical 插件错误码（需注册到 `docs/design/asset-ledger-error-codes.md`）：

- `PHYSICAL_CONFIG_INVALID`
- `PHYSICAL_AUTH_FAILED`
- `PHYSICAL_PERMISSION_DENIED`
- `PHYSICAL_NETWORK_ERROR`（retryable=true）
- `PHYSICAL_PARSE_ERROR`

## Design Decisions

### Technical Approach

- v1 选择远程协议（SSH）：
  - 覆盖成本低（无需部署 agent）
  - 通过“远程执行命令/脚本 → 输出 JSON”实现薄插件适配层
- 以“可入账的最小字段集”为目标：
  - hostname 必须可得；其它字段 best-effort + warnings（避免因为缺 root 权限导致无法入账）

### Constraints

- 不做任何写入目标系统的操作（不安装依赖、不修改 sshd 配置）。
- 不强依赖 root 权限：DMI/序列号等可因权限缺失而为空（warning）。

### Risk Assessment

- **环境差异风险**：发行版/权限差异会导致部分命令不可用。缓解：优先使用通用路径（/proc、/etc/os-release）；不可用时 best-effort 降级并 warning。
- **信息泄露风险**：远程命令输出可能包含敏感信息。缓解：插件 raw 输出前清洗；raw 查看 admin-only 且脱敏。

## Acceptance Criteria

### Functional Acceptance

- [ ] 插件遵循 `collector-response-v1` 契约，输出 `assets[]/stats.inventory_complete/errors[]`。
- [ ] `collect` 成功时：输出 1 个 Host 资产，`stats.inventory_complete=true`，relations 可为空。
- [ ] 输出 normalized 符合 `normalized-v1` schema。
- [ ] raw 永久保留；管理员可脱敏查看 raw，并记录审计事件。

### Error Handling Acceptance

- [ ] 认证失败返回 `PHYSICAL_AUTH_FAILED`（retryable=false）。
- [ ] 权限不足返回 `PHYSICAL_PERMISSION_DENIED`（retryable=false）。
- [ ] 网络/超时返回 `PHYSICAL_NETWORK_ERROR`（retryable=true）。

### Quality Standards

- [ ] 文档同步：补充错误码到 `docs/design/asset-ledger-error-codes.md`（如未注册）；补充 physical 插件示例到 `docs/design/asset-ledger-collector-reference.md`（如需要）。
- [ ] 回归清单：至少 1 套真实 Linux 物理机环境回归（手工步骤 + 期望输出摘要）。

## Execution Phases

### Phase 1: 契约与配置定稿

- [ ] 定稿 `third_party + collector_kind=linux_physical + connection_method=ssh` 的 Source config
- [ ] 明确最小权限集与 SSH 前置条件（验收清单）

### Phase 2: healthcheck/detect/collect 最小闭环

- [ ] healthcheck：连通性 + 权限基线
- [ ] detect：版本/能力探测
- [ ] collect：Host 最小字段集 + raw 留存

### Phase 3: 错误码与审计

- [ ] 注册/补齐 `PHYSICAL_*` 错误码与 retryable/category 口径
- [ ] raw 查看的脱敏与审计事件（对齐 SRS）

### Phase 4: 回归与文档

- [ ] 按验收清单回归（至少 1 套环境）
- [ ] 更新 runbook/README（如有新增前置条件或限制）

---

**Document Version**: 1.0
**Created**: 2026-01-30
**Clarification Rounds**: 0
**Quality Score**: 100/100
