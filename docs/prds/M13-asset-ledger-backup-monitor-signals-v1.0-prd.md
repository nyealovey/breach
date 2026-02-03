# M13：资产台账系统 - 备份/监控覆盖采集（Veeam VBR + SolarWinds）- 产品需求文档（PRD）

> 版本：v1.0  
> 日期：2026-02-03  
> 目标：在现有资产台账“库存（inventory）采集”基础上新增“运行状态信号（signals）采集”能力：采集 Veeam 备份覆盖情况与 SolarWinds 监控覆盖情况，用于补齐资产是否已备份/是否已纳入监控的状态；支持多套 VBR 实例，SolarWinds 单实例。

## Requirements Description

### Background

- **现状问题**：
  - 台账目前聚焦“资产盘点/库存”（vCenter/PVE/Hyper-V/阿里云等），但无法回答“资产是否已备份/是否已纳入监控”。
  - 备份/监控系统通常是独立域：其对象模型与台账资产并非 1:1，且不能用来推导资产是否“下线/缺失”。
- **目标用户**：平台管理员（admin）、运维/安全/审计同学（user 只读）。
- **价值**：
  - 资产视图补齐关键运维状态（backup/monitor coverage），支持缺口治理（哪些资产未纳入备份/监控）。
  - 为后续合规审计与告警（可选）打基础。

### Scope / Out of Scope

**In Scope**

- 新增两类采集插件（Collector Plugins）：
  - `veeam`（面向 Veeam Backup & Replication，VBR；支持多套实例）
  - `solarwinds`（面向 SolarWinds 监控；单实例）
- 复用现有调度/Run/插件契约（stdin 输入、stdout 输出 `collector-response-v1`），每日一次定时采集（按 ScheduleGroup 触发）。
- 新增“信号数据入库与资产补齐”的核心逻辑：将采集到的备份/监控状态映射到已有资产，并在资产列表/详情中展示。
- 提供“未匹配对象清单”（至少后端可查询）用于后续治理（手工绑定/规则补齐）。

**Out of Scope（本期不做）**

- 备份作业/策略全量建模（job 级别报表、SLA 计算、跨仓库/多目标策略解析等）。
- SolarWinds 告警事件流/通知（只采集覆盖与当前状态；告警/趋势后续单独拆）。
- 自动下发/自动修复（例如自动把资产纳入备份/监控）。

### Success Metrics

- 在满足网络与权限前提下：
  - `healthcheck` 成功率 = 100%
  - `detect` 成功率 = 100%
  - `collect` 成功率 ≥ 99%
- 资产列表（`/assets`）可展示：
  - 备份状态图标（分档：最近 1 天 / 最近 1 周 / 超过 1 周未成功 / 未备份 / 未知）
  - 监控状态图标（Up/Down/Warning/Unmanaged/未纳入/未知；Unmanaged 视为“已纳入监控”，但用不同颜色区分）
- 信号采集不得影响库存语义：
  - 不得推进 `asset.status(in_service/offline)` 推导
  - 不得推进 `asset_source_link.presence_status(present/missing)` 推导

## Feature Overview

### Core Requirements

1) **信号来源（Signal Source）与库存来源（Inventory Source）语义隔离（强约束）**

- 系统必须区分两类来源：
  - `inventory`：用于资产盘点与“在/不在”语义（现有 vcenter/pve/hyperv/aliyun 等）
  - `signal`：用于补齐“状态信号”（veeam/solarwinds）
- `signal` 来源的 `collect` Run：
  - 允许写入信号事实（backup/monitor）
  - 但不得影响 `asset.status`、`asset_source_link.presence_status`、关系 `active/inactive` 等库存相关派生语义

2) **多套 VBR 支持方式（强约束）**

- 一个 VBR 实例对应一个 `Source`（推荐做法，便于隔离凭据、排障、权限分域）。
- 多套 VBR 的聚合口径：
  - `backupCovered = 任一 VBR 认为该资产处于备份覆盖`（逻辑 OR）
  - `backupLastSuccessAt = 多套 VBR 中该资产最近一次成功备份时间的最大值（best-effort）`

3) **采集插件化（强约束）**

- Veeam 与 SolarWinds 必须以插件形式接入（与 vCenter/PVE/Hyper-V 一致），禁止在插件内再“调用其他插件进程”进行编排。
- 可复用逻辑应以**共享模块 import** 的方式实现（例如 `plugins/_shared/*`），避免多层进程与不可控超时。

4) **资产映射（matching）可解释 + 可治理**

- 系统必须提供稳定、可追溯的“外部对象 → 台账资产”映射：
  - 自动匹配（基于 hostname/ip/uuid/serial 等）
  - 手工确认/覆盖（后续 UI 可做；本期至少预留后端数据结构与 API）
- 必须保留“未匹配对象”（unmatched）用于缺口治理与排障。

## Detailed Requirements

### 1) Source 类型与配置

#### 1.1 SourceType

新增 SourceType：

- `veeam`
- `solarwinds`

#### 1.2 Source 角色（role）

Source 必须支持配置角色：

- `role=inventory`（默认；兼容现有来源）
- `role=signal`（Veeam/SolarWinds 使用）

> 说明：若实现侧暂不引入 role 字段，至少需要在核心逻辑中硬编码把 `sourceType in (veeam, solarwinds)` 排除出库存派生逻辑；但这是临时方案，后续接更多 signal 会变得不可维护。

#### 1.3 Veeam（veeam）Source config（非敏感）

建议 config 字段（可根据实际 API 能力调整，但口径需稳定）：

- `endpoint`：string（必填；例如 `https://vbr.example.com:9419`）
- `timeout_ms`：number（默认 60_000）
- `insecure_tls`：boolean（默认 true；允许自签名证书/跳过证书校验，遵循现有 vCenter 插件策略）
- `include_types`：string[]（默认 `["vm","agent"]`；表示采集对象范围；本期允许 best-effort）
- `stale_after_hours`：number（默认 48；信号过期阈值，用于 UI 展示“未知”）

凭证（敏感，存 Credential；运行时注入）：

- `username`（必填）
- `password`（必填）

#### 1.4 SolarWinds（solarwinds）Source config（非敏感）

建议 config 字段：

- `endpoint`：string（必填；例如 `https://orion.example.com:17778` 或 SWIS/REST 入口）
- `timeout_ms`：number（默认 60_000）
- `insecure_tls`：boolean（默认 true）
- `include_unmanaged`：boolean（默认 true；Unmanaged 节点是否计入“已纳入监控”——本期产品口径为 true）
- `stale_after_hours`：number（默认 24）

凭证（敏感，存 Credential；运行时注入）：

- `username`（必填）
- `password`（必填）

### 2) 插件模式（healthcheck/detect/collect）

两类插件均需支持：

#### 2.1 healthcheck（连通性 + 权限基线）

healthcheck 必须检查：

- endpoint 可达（DNS/TCP/TLS）
- 凭证有效（能完成一次轻量认证/查询）
- 权限基线满足（能列出对象清单或执行最小查询）

healthcheck 成功时：

- `collector-response-v1` 中 `errors=[]`
- `assets=[]`（允许为空）
- `stats.inventory_complete` 可为 `true/false`（建议 true；表示“健康检查完成”，不代表 collect 完整）

#### 2.2 detect（能力探测 + 配置校验）

detect 输出（写入 Run.detectResult）建议包含：

- `driver`：例如 `veeam@v1` / `solarwinds@v1`
- `target_version`：best-effort（产品版本/Build）
- `capabilities`：回显关键开关与最终生效配置（例如 include_types/include_unmanaged 等）

detect 必须做 config 的强校验（缺少 endpoint/非法值直接失败）。

#### 2.3 collect（信号采集）

collect 的目标是“采集该系统视角下的对象覆盖清单 + 状态信号”，并将其映射到台账资产。

对 `signal` 来源，inventory_complete 语义调整为：

- Veeam：该 VBR 下“可枚举的受保护对象清单”已完成枚举（分页/过滤条件明确）
- SolarWinds：可枚举的 Nodes（或等价对象）清单已完成枚举
- 若无法保证完整（分页失败/权限不足/错误导致漏数）：Run 必须失败（避免把缺口误判为“未备份/未纳入监控”）

### 3) 信号字段口径（normalized-v1 承载）

为最大化复用现有 schema 校验，本期信号字段统一落在：

- `normalized.version = "normalized-v1"`
- `normalized.kind = "vm" | "host" | "cluster"`（best-effort；不强制 100% 准确）
- **信号字段写入 `normalized.attributes.*`**（避免扩展 normalized-v1 schema）

#### 3.1 Veeam 信号字段（attributes.*）

最小集合（必须输出）：

- `attributes.backup_covered`：boolean（是否处于备份覆盖）

推荐集合（best-effort）：

- `attributes.backup_last_result`：string（例如 `success|warning|failed|unknown`）
- `attributes.backup_last_success_at`：string（ISO8601）
- `attributes.backup_job_name`：string
- `attributes.backup_repository`：string

##### 3.1A 备份状态分档（用于 UI 图标）

以聚合后的 `backupCovered` 与 `backupLastSuccessAt` 计算（以 UTC 时间差为准）：

- `backup_state=no_backup`：`backupCovered=false`
- `backup_state=covered_1d`：`backupCovered=true` 且 `backupLastSuccessAt` 距今 `<= 24h`
- `backup_state=covered_7d`：`backupCovered=true` 且 `backupLastSuccessAt` 距今 `> 24h && <= 7d`
- `backup_state=covered_stale`：`backupCovered=true` 且 `backupLastSuccessAt` 距今 `> 7d`
- `backup_state=unknown`：无可用信号（未采集/过期/仅覆盖但无成功时间等）

> 注：本期口径使用“最近一次成功备份时间（last_success）”来分档；若仅有失败/告警但无成功时间，需落入 unknown（避免把“未成功”误判为“超过一周未备份成功”）。

#### 3.2 SolarWinds 信号字段（attributes.*）

最小集合（必须输出）：

- `attributes.monitor_covered`：boolean（是否纳入监控；受 include_unmanaged 影响）

推荐集合（best-effort）：

- `attributes.monitor_status`：string（例如 `up|down|warning|unknown|unmanaged`）
- `attributes.monitor_last_seen_at`：string（ISO8601；或最后一次轮询时间）
- `attributes.monitor_node_id`：string（外部对象 ID，便于追溯）

##### 3.2A 监控覆盖与状态口径（用于 UI 图标）

- `monitorCovered=true`：在 SolarWinds 中存在对应节点（Node），且：
  - 本期固定认为 `unmanaged` 也计入覆盖（等价于 `include_unmanaged=true`）
- `monitor_state` 建议枚举：
  - `not_covered`：未匹配到 SolarWinds 节点
  - `up` / `warning` / `down` / `unmanaged` / `unknown`

### 4) 资产匹配（matching）与映射持久化

#### 4.1 自动匹配优先级（建议口径）

对每条信号对象（Veeam protected object / SolarWinds node），系统尝试匹配到已有资产（Asset）：

1. `identity.machine_uuid`（若两侧都具备且稳定）
2. `identity.serial_number`（物理机场景）
3. `identity.cloud_native_id`（云资源）
4. `identity.hostname`（大小写不敏感；可支持去域名后匹配）
5. `network.ip_addresses[]`（任一 IP 命中）
6. Host 场景补充：`ledgerFields.bmcIp` / `normalized.network.bmc_ip` / `normalized.network.management_ip`（best-effort）

自动匹配必须输出：

- `match_confidence`（例如 High/Medium/Low）
- `match_reason`（命中的键类型，如 `hostname+ip`）

#### 4.2 手工映射（本期要求：数据结构预留）

系统需要支持 admin 将“外部对象”绑定到某个 `assetUuid`，并覆盖自动匹配结果（以便修正歧义/别名/多 IP 变化）。

本期验收不要求完整 UI，但需要：

- 有持久化结构记录手工映射
- 有最小 API 支持写入/查询（或至少实现侧预留并在后续 PRD/任务中落地）

#### 4.3 未匹配对象（unmatched）

无法匹配到资产的对象必须保留：

- 用于“缺口排查”：到底是资产未入台账，还是匹配键缺失/不一致
- 后续支持手工绑定/规则完善

### 5) 数据模型（建议）

> 目标：信号入库不污染现有 `asset_source_link/source_record` 语义，且支持 unmatched。

建议新增表（命名可调整）：

1. `AssetSignalLink`

- `id`：string (PK)
- `assetUuid`：uuid（可为空；为空表示 unmatched）
- `sourceId`：string（veeam/solarwinds Source）
- `externalId`：string（外部对象唯一标识）
- `externalKind`：string（vm/host/... best-effort）
- `firstSeenAt/lastSeenAt`：datetime
- `lastSeenRunId`：string?
- `matchType`：string?（auto/manual）
- `matchConfidence`：int?（0-100 或枚举）
- 唯一约束：`(sourceId, externalId)`

2. `SignalRecord`（类似 SourceRecord，但允许 assetUuid 为空）

- `id`：string (PK)
- `collectedAt`：datetime
- `runId/sourceId`：string
- `linkId`：string（关联 AssetSignalLink）
- `assetUuid`：uuid?（nullable）
- `normalized`：json（normalized-v1）
- `raw`：bytes（压缩后）
- `rawHash/rawSizeBytes/rawMimeType/rawCompression/rawInlineExcerpt`（同 SourceRecord 口径）

3. `AssetOperationalState`（每资产一行的聚合态，便于列表查询/过滤）

- `assetUuid`：uuid (PK)
- `backupCovered`：boolean?（null 表示未知）
- `backupState`：string?（`covered_1d|covered_7d|covered_stale|no_backup|unknown`；用于列表图标）
- `backupLastSuccessAt`：datetime?
- `backupLastResult`：string?
- `backupUpdatedAt`：datetime?
- `monitorCovered`：boolean?（null 表示未知）
- `monitorState`：string?（`up|warning|down|unmanaged|not_covered|unknown`；用于列表图标）
- `monitorStatus`：string?（可选：保留原始/更细状态码，供详情/tooltip 展示）
- `monitorUpdatedAt`：datetime?
- `updatedAt`：datetime

聚合规则：

- 来自同类信号的多来源（多 VBR）按 Core Requirements 的聚合口径合并。
- 若超过 `stale_after_hours` 未更新：对应字段置为 `null`（未知），避免“旧信号”误导。

### 6) API 需求（最小集合）

#### 6.1 资产列表返回字段（/api/v1/assets）

在现有资产列表响应中新增字段（对 user/admin 可见）：

- `backupCovered: boolean | null`
- `backupState: string | null`（`covered_1d|covered_7d|covered_stale|no_backup|unknown`；用于图标）
- `backupLastSuccessAt: string | null`（可选；ISO）
- `monitorCovered: boolean | null`
- `monitorState: string | null`（`up|warning|down|unmanaged|not_covered|unknown`；用于图标）
- `monitorStatus: string | null`（可选；更细状态/原始码，供 tooltip）

#### 6.2 资产列表筛选（/api/v1/assets）

新增 query 参数（可选）：

- `backup_covered=true|false`（过滤已覆盖/未覆盖；`null` 不参与过滤）
- `monitor_covered=true|false`
- `backup_state=covered_1d|covered_7d|covered_stale|no_backup|unknown`（可选；按分档过滤）
- `monitor_state=up|warning|down|unmanaged|not_covered|unknown`（可选；按状态过滤）

> 说明：当字段为 `null`（未知）时不应被误判为 false；过滤 `false` 时仅匹配明确 false 的资产。

#### 6.3 资产详情（/api/v1/assets/:assetUuid）

新增返回字段：

- `operationalState`：包含 backup/monitor 聚合态 + 更新时间
- （可选）`signalLinks[]`：展示来自哪些 VBR/Orion 的外部对象引用（便于追溯）

### 7) UI 需求（最小集合）

#### 7.1 /assets 列表

- 新增两列：
  - “备份”：用图标 + 颜色表示分档（tooltip 展示最近成功时间/来源）
    - 已备份且最近 1 天有成功备份：`backup_state=covered_1d`
    - 已备份且最近 1 周有成功备份：`backup_state=covered_7d`
    - 已备份但超过 1 周无成功备份：`backup_state=covered_stale`
    - 未备份：`backup_state=no_backup`
    - 未知：`backup_state=unknown`
  - “监控”：用图标 + 颜色表示状态（tooltip 展示 SolarWinds 状态/来源）
    - `up|warning|down|unmanaged|not_covered|unknown`
    - 其中 `unmanaged` 计入“已纳入监控”，但必须用不同颜色与 `up` 区分
- 新增筛选项：
  - 仅看“未纳入备份”
  - 仅看“未纳入监控”
  - （可选）按备份分档/监控状态筛选

#### 7.2 /assets/:id 详情

- 增加“运行状态”区块：
  - 备份：状态图标（分档）、最近成功时间、来源（哪个 VBR）
  - 监控：状态图标（含 unmanaged 区分）、当前状态、来源（SolarWinds）
- 若存在未匹配/歧义：至少在 admin 侧可看到“信号来源原始对象信息”（用于排障）

### 8) 调度与并发

- 本期仅需要“每日一次”采集（复用 ScheduleGroup 的 `runAtHhmm`）。
- 多套 VBR：
  - 可放在同一个 ScheduleGroup，保证每天同一时间触发；
  - worker 并发策略沿用现有（`ASSET_LEDGER_WORKER_BATCH_SIZE`），避免短时间对 VBR/Orion 造成压力。

### 9) 错误码（需注册、需稳定）

新增错误码（示例；最终需注册到 `docs/design/asset-ledger-error-codes.md` 并在 UI 提供建议动作）：

Veeam：

- `VEEAM_CONFIG_INVALID`（config）
- `VEEAM_AUTH_FAILED`（auth）
- `VEEAM_PERMISSION_DENIED`（permission）
- `VEEAM_NETWORK_ERROR`（network，retryable=true）
- `VEEAM_RATE_LIMIT`（rate_limit，retryable=true）
- `VEEAM_PARSE_ERROR`（parse）

SolarWinds：

- `SOLARWINDS_CONFIG_INVALID`（config）
- `SOLARWINDS_AUTH_FAILED`（auth）
- `SOLARWINDS_PERMISSION_DENIED`（permission）
- `SOLARWINDS_NETWORK_ERROR`（network，retryable=true）
- `SOLARWINDS_RATE_LIMIT`（rate_limit，retryable=true）
- `SOLARWINDS_PARSE_ERROR`（parse）

## Design Decisions

### Technical Approach（建议）

- 仍采用“插件薄、核心厚”：
  - 插件负责：拉取对象清单 + 状态字段映射到 normalized-v1（attributes 承载）+ raw 永久保留
  - 核心负责：匹配到资产、聚合 operational state、权限控制、审计、UI 展示
- 语义隔离优先：
  - signal 数据绝不参与 `asset.status` 推导
  - 需要独立的数据表/聚合逻辑承载（避免复用 `asset_source_link` 产生副作用）

### Risk Assessment

- **匹配误判风险**：hostname/ip 可能复用或变更导致错绑。缓解：匹配置信度 + 可追溯证据 + 支持手工映射覆盖。
- **多套 VBR 对象重复风险**：同一资产在多套出现。缓解：聚合口径为 OR；详情展示“来自哪些 VBR”。
- **信号过期误导风险**：调度失败或停跑会导致旧数据。缓解：`stale_after_hours` 过期后展示未知。
- **API/权限差异风险**：VBR/Orion 版本差异导致字段缺失。缓解：detect 回显 capabilities；关键字段缺失导致失败，避免 silent bad data。

## Acceptance Criteria

### Functional Acceptance

- [ ] 支持创建多套 `veeam` Source（每套 VBR 一个 Source），以及一个 `solarwinds` Source。
- [ ] 两类 Source 均可加入某个 ScheduleGroup，每日一次触发 `mode=collect` 的 Run。
- [ ] collect 成功后：
  - [ ] `/assets` 列表可看到备份/监控状态图标：
    - [ ] 备份分档：`covered_1d|covered_7d|covered_stale|no_backup|unknown`
    - [ ] 监控状态：`up|warning|down|unmanaged|not_covered|unknown`（其中 `unmanaged` 计入已纳入监控）
  - [ ] `/assets/:id` 详情可看到对应信号的来源与时间（best-effort），并与列表分档口径一致
- [ ] 信号采集不影响：
  - [ ] `asset.status` 推导
  - [ ] `asset_source_link.presence_status` 推导

### Error Handling Acceptance

- [ ] 凭证无效：返回 `*_AUTH_FAILED`（retryable=false）。
- [ ] 权限不足：返回 `*_PERMISSION_DENIED`（retryable=false）。
- [ ] 网络/超时：返回 `*_NETWORK_ERROR`（retryable=true）。
- [ ] 限流：返回 `*_RATE_LIMIT`（retryable=true）。

### Quality Standards

- [ ] 插件 stdout 必须是合法 JSON 且符合 `collector-response-v1`。
- [ ] `normalized` 必须通过 `normalized-v1` schema 校验（信号字段只写入 `attributes.*`）。
- [ ] raw 永久保留且不得包含明文凭证；插件日志必须脱敏。
- [ ] 核心侧对信号聚合与过滤具备幂等性（重复运行不产生重复/漂移）。
