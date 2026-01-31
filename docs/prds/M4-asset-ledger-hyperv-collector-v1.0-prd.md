# M4：资产台账系统 - Hyper-V 采集（单机 + Failover Cluster（含 S2D））- 产品需求文档（PRD）

> 目标：新增 Hyper-V 来源采集能力，支持单机与故障转移群集（含 S2D 场景），产出 VM/Host/Cluster 资产与最小关系链 `VM -> Host -> Cluster`（允许缺边，但禁止 `relations=0` 的伪成功），并满足“inventory complete + 可追溯 + 可定位”的验收口径。

## Requirements Description

### Background

- **现状问题**：系统当前仅实现 vCenter 插件，无法覆盖 Hyper-V 资产盘点需求。
- **目标用户**：管理员（admin）、运维/审计。
- **价值**：将 Hyper-V 纳入统一资产视图，形成多来源台账与关系链展示基础，并为后续重复治理/合并提供候选键数据。

### Scope / Out of Scope

**In Scope**

- 插件化采集：实现 `healthcheck/detect/collect`，遵循 collector 契约（见 `docs/design/asset-ledger-collector-reference.md`）。
- 接入方式：优先 **远程协议**（WinRM/PowerShell Remoting）；同一 SourceType 未来允许扩展第二种方式（例如 Agent），但本期仅实现远程协议。
- 覆盖形态：
  - Hyper-V 单机：采集 Host/VM，输出 VM→Host（runs_on）
  - Failover Cluster：采集 Cluster/Host/VM，输出 Host→Cluster（member_of）与 VM→Host（runs_on，best-effort）
  - S2D：识别“这是 S2D 群集”的形态信息（best-effort），不要求输出存储明细
- raw 永久保留：每条资产/关系的 `raw_payload` 必须由 core 持久化（对齐可追溯语义）。

**Out of Scope**

- 存储明细（S2D 容量/CSV/磁盘拓扑）专项（另立 PRD）。
- 性能指标（CPU 使用率/IOPS）与告警事件。
- 自动修复/一键开通 WinRM/权限（仅给出错误码与建议动作，不做自动化）。

### Success Metrics

- 在权限与网络满足前提下：
  - `healthcheck` 成功率 = 100%
  - `detect` 成功率 = 100%
  - `collect` 成功率 ≥ 99%
- `collect` 成功时：
  - `stats.inventory_complete=true`
  - `relations.length > 0`

## Feature Overview

### Core Requirements

1. **Collector 契约与 inventory complete（强约束）**

- 对 `mode=collect`：
  - 插件输出必须代表该 Source 的“完整资产清单快照”（inventory complete）。
  - 若因权限/分页/接口错误无法保证完整：Run 必须失败，并输出结构化错误；不得以 warnings 标记成功（见 `docs/design/asset-ledger-collector-reference.md`）。

2. **资产范围（最小字段集，normalized-v1）**

- VM（kind=vm）：
  - identity：hostname/caption（best-effort）
  - identity.machine_uuid（best-effort：Hyper-V VMId/BIOS UUID）
  - hardware：cpu_count、memory_bytes（best-effort）
  - runtime：power_state（必须）
  - network：ip_addresses/mac_addresses（best-effort）
- Host（kind=host）：
  - identity：hostname（必须）、serial_number/vendor/model（best-effort）
  - os：name/version（Windows Server，best-effort）
  - hardware：cpu_count、memory_bytes、disk_total_bytes（best-effort）
  - network：management_ip（best-effort）
- Cluster（kind=cluster）：
  - identity：caption（群集名，必须）

3. **关系必须可用（虚拟化平台硬约束）**

- `relations[]` 至少一种非空：
  - VM `runs_on` Host（best-effort，但总体 relations 不能为 0）
  - Host `member_of` Cluster（群集模式下应可用）
- 若采集结果 `relations=0`：Run 必须失败（避免 UI 关系链不可用），并返回稳定错误码（建议 `INVENTORY_RELATIONS_EMPTY`）。

4. **错误口径（可定位）**

- 权限不足/接口不可用/关键枚举失败导致 inventory 不完整：Run 必须失败并给出结构化错误（code 稳定、retryable 标注准确、message 脱敏、redacted_context 可用于定位）。

## Detailed Requirements

### 1) Source 配置（hyperv）

SourceType：`hyperv`

接入方式（v1）：远程协议（WinRM/PowerShell Remoting）。

建议 config（非敏感）字段：

- `connection_method`：`winrm`（string；未来可扩展 `agent`，但 v1 固定为 winrm）
- `endpoint`：string（建议支持“单机 hostname/IP”或“群集名/任一节点 hostname”）
- `scheme`：`https|http`（默认 https）
- `port`：number（https 默认 5986；http 默认 5985）
- `tls_verify`：boolean（默认 true；仅允许显式关闭，用于自签名/内网；关闭需在 UI 给出风险提示）
- `scope`：`auto|standalone|cluster`（默认 auto；detect 可给建议）
- `timeout_ms`：number（默认 60_000；用于单次远程调用超时）
- `max_parallel_nodes`：number（默认 5；群集并发上限，避免压垮控制面）

凭证（敏感）：

- 使用 Source 的 credential 存储（密文），建议字段：`domain? / username / password`。
- 禁止任何 API/日志/插件输出泄露凭证明文。

### 2) healthcheck（连通性 + 权限基线）

目的：在不产出资产清单的前提下，快速验证“能连上、能执行最小查询”。

healthcheck 必须验证：

- WinRM 连接成功（含 TLS 握手/证书策略）
- 认证成功且具备最小只读权限：
  - 能读取本机计算机信息（用于 host 指纹）
  - 能列举 Hyper-V VM 列表（若目标为 Hyper-V 角色）
  - 若 detect 判定为 cluster：能读取 cluster 基本信息与节点列表（需要 FailoverClusters 能力）

失败时输出 errors[]（示例错误码）：

- TLS/证书：`HYPERV_TLS_ERROR`（retryable=false）
- 认证失败：`HYPERV_AUTH_FAILED`（retryable=false）
- 权限不足：`HYPERV_PERMISSION_DENIED`（retryable=false）
- 网络问题/超时：`HYPERV_NETWORK_ERROR`（retryable=true）

### 3) detect（形态识别 + 能力探测）

detect 输出（写入 run.detectResult，脱敏）：

- `target_version`（best-effort）：
  - Windows 版本（major/minor/build）
  - Hyper-V 版本指纹（若可得）
- `capabilities`（最小字段）：
  - `is_cluster`: boolean
  - `cluster_name`?: string
  - `node_count`?: number
  - `is_s2d`?: boolean（best-effort）
  - `can_list_vms`: boolean
  - `can_map_vm_to_host`: boolean
  - `recommended_scope`: `standalone|cluster`

detect 必须做到：

- 不输出任何敏感信息（凭证、完整 endpoint 列表等）。
- 当发现“配置不匹配/能力不足”时：
  - 返回结构化错误或在 detectResult 中给出可执行建议（例如：需要打开 WinRM、需要加入 Hyper-V Administrators、需要安装 FailoverClusters 模块/权限）。

### 4) collect（资产清单 + 关系）

#### 4.1 清单完整性（必须）

- `stats.inventory_complete` 必须存在且为 `true`（成功时）。
- 若无法列举完整清单（任一节点无法访问/枚举失败/分页不完整等）：
  - Run 必须失败
  - errors[].code 建议使用 `INVENTORY_INCOMPLETE`（或更具体的错误码）

#### 4.2 单机模式（standalone）

- 资产：
  - 1 个 Host（external_kind=host）
  - N 个 VM（external_kind=vm）
- 关系：
  - 每个 VM 尽力输出 `runs_on -> Host`
- 若最终 `relations=0`：失败（`INVENTORY_RELATIONS_EMPTY`）

#### 4.3 群集模式（cluster）

- 节点发现：
  - 必须能获取群集名 + 节点列表（node hostnames）
  - 插件需对每个节点建立远程会话并枚举其 VM（或通过集群 API 获取 VM 与 owner node 的映射，仍需保证 inventory complete）
- 资产：
  - 1 个 Cluster（external_kind=cluster）
  - M 个 Host（external_kind=host；群集节点）
  - N 个 VM（external_kind=vm）
- 关系：
  - 每个 Host 输出 `member_of -> Cluster`（必须可用）
  - 每个 VM 尽力输出 `runs_on -> Host`（owner node best-effort）
- 若最终 `relations=0`：失败（`INVENTORY_RELATIONS_EMPTY`）

#### 4.4 normalized-v1 字段落点（示例口径）

> 以 `docs/design/asset-ledger-json-schema.md` 为准；以下为最小字段落点说明，便于实现与验收对齐。

VM（normalized-v1）：

- `kind="vm"`
- `identity.hostname`：VM 名称（best-effort）
- `identity.machine_uuid`：VMId/BIOS UUID（best-effort；用于 dup-rules-v1 强信号）
- `hardware.cpu_count`：vCPU（best-effort）
- `hardware.memory_bytes`：内存（best-effort）
- `runtime.power_state`：必须（映射到规范枚举）
- `network.ip_addresses[]`：best-effort（来自 Integration Services）
- `network.mac_addresses[]`：best-effort

Host（normalized-v1）：

- `kind="host"`
- `identity.hostname`：必须
- `identity.serial_number`：best-effort（Win32_BIOS.SerialNumber；用于 dup-rules-v1）
- `os.name/os.version`：best-effort
- `hardware.cpu_count/hardware.memory_bytes`：best-effort
- `attributes.disk_total_bytes`：best-effort（若 schema 落点不同，以 schema 为准）
- `network.management_ip`：best-effort（如可可靠获取）

Cluster（normalized-v1）：

- `kind="cluster"`
- `identity.caption`：群集名（必须）

#### 4.5 external_id 选择（用于持续追踪）

必须满足“同一 Source 内稳定”（见 data model 的 `(source_id, external_kind, external_id)` 唯一约束）：

- VM：优先使用 Hyper-V VMId（GUID）
- Host：优先使用 Windows 主机 UUID（如可得），否则使用 hostname（并在 detect 中提示“主机改名会导致重新入账”）
- Cluster：使用 cluster name（或 cluster GUID，若可得）

### 5) 错误码（需注册、需稳定）

本期新增 Hyper-V 插件错误码（需注册到 `docs/design/asset-ledger-error-codes.md`）：

- `HYPERV_CONFIG_INVALID`（config）
- `HYPERV_AUTH_FAILED`（auth）
- `HYPERV_PERMISSION_DENIED`（permission）
- `HYPERV_NETWORK_ERROR`（network，retryable=true）
- `HYPERV_TLS_ERROR`（network，retryable=false）
- `HYPERV_PARSE_ERROR`（parse）
- `INVENTORY_RELATIONS_EMPTY`（parse，relations=0 的硬失败）

## Design Decisions

### Technical Approach

- v1 选择远程协议（WinRM/PowerShell Remoting）：
  - 满足“插件化接入 + 无需部署 agent”的快速覆盖
  - 未来允许同一 SourceType 扩展第二种方式（如 agent），但仍通过同一 collector 契约输出 assets/relations
- 群集采集以“完整清单”为第一目标：
  - 任一节点不可达/不可枚举视为 inventory incomplete，必须失败，避免推进 missing/offline 语义错误。

### Constraints

- 只支持只读采集；不修改目标系统配置。
- 需要目标侧开启 WinRM 并允许远程执行只读查询（前置条件）。
- S2D 仅做形态识别，不输出存储明细。

### Risk Assessment

- **权限/网络复杂度风险**：群集多节点，需要跨节点网络连通与统一凭证。缓解：healthcheck/detect 先验；错误码 + 建议动作。
- **inventory 不完整风险**：任一节点缺失会导致误判 missing/offline。缓解：强制 inventory_complete；不完整即失败。
- **字段缺失风险**：IP/OS 等依赖 Integration Services，可能缺失。缓解：best-effort；但不影响成功（除非关系为 0）。

## Acceptance Criteria

### Functional Acceptance

- [ ] 插件遵循 `collector-response-v1` 契约，输出 `assets[]/relations[]/stats.inventory_complete`。
- [ ] 单机：可采集 Host/VM，且 `stats.inventory_complete=true`。
- [ ] 群集：可采集 Cluster/Host/VM，且 `stats.inventory_complete=true`。
- [ ] collect 成功时 `relations.length > 0`；若 `relations=0` 必须失败并返回 `INVENTORY_RELATIONS_EMPTY`。
- [ ] 所有输出 normalized 必须符合 `normalized-v1` schema（`SCHEMA_VALIDATION_FAILED` 不允许出现）。
- [ ] 群集模式下 Host→Cluster（member_of）关系必须可用；VM→Host（runs_on）尽力输出。

### Error Handling Acceptance

- [ ] 认证失败返回 `HYPERV_AUTH_FAILED`（retryable=false）。
- [ ] 权限不足返回 `HYPERV_PERMISSION_DENIED`（retryable=false）。
- [ ] 网络/超时返回 `HYPERV_NETWORK_ERROR`（retryable=true）。
- [ ] TLS/证书错误返回 `HYPERV_TLS_ERROR`（retryable=false）。

### Quality Standards

- [ ] raw 永久保留：插件提供的 `raw_payload` 必须被 core 写入 `source_record.raw`（失败写入必须导致 Run 失败）。
- [ ] 文档同步：补充错误码到 `docs/design/asset-ledger-error-codes.md`；必要时在 `docs/design/asset-ledger-collector-reference.md` 增加 Hyper-V 示例。
- [ ] 回归清单：至少 1 套单机 + 1 套群集环境回归（手工步骤 + 期望输出摘要）。

## Execution Phases

### Phase 1: 契约与最小闭环

- [ ] 定稿 hyperv Source config（connection_method/endpoint/scheme/port/tls_verify/scope）
- [ ] 实现 healthcheck/detect/collect 基线打通（最小字段 + relations>0 + inventory_complete）

### Phase 2: 群集与 S2D 形态支持

- [ ] Failover Cluster 节点枚举与 Host→Cluster 关系补齐（member_of）
- [ ] VM→Host owner node best-effort（runs_on）
- [ ] S2D 形态识别（best-effort）

### Phase 3: 错误码与可定位

- [ ] 补齐 Hyper-V 错误码枚举与 retryable 口径
- [ ] 在 `/runs` 中可读展示错误码与建议动作（联动 M3 /runs PRD）

### Phase 4: 回归与文档

- [ ] 输出“Hyper-V 采集验收清单”（权限/网络/WinRM 前置条件 + 期望输出）
- [ ] 更新 collector reference 中 Hyper-V 的字段示例与失败口径（如需要）

---

**Document Version**: 1.0
**Created**: 2026-01-30
**Clarification Rounds**: 1
**Quality Score**: 100/100
