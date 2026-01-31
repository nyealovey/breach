# M12：资产台账系统 - 资产历史追溯（按资产）- 产品需求文档（PRD）

> 目标：在资产详情页提供“历史/时间线”入口，按**资产维度**展示“变化与事件”的时间线（**不按 Run 列表展示**），满足“永久可追溯”的验收要求，并降低排障成本。

## Requirements Description

### Background

- **现状问题**：当前资产详情主要展示 latest snapshot 与来源明细，但缺少“资产发生过哪些变化/何时发生/由什么触发”的可读时间线。
- **目标用户**：管理员（admin）、普通用户（user）。
- **价值**：
  - 审计可追溯：知道“什么时候变了、变了什么、是谁改的（如台账字段）、来自哪次采集（如采集变化）”。
  - 排障可定位：减少翻 Run/日志的成本，将关键变化直接呈现为事件摘要。

### Scope / Out of Scope

**In Scope**

- 资产详情新增“历史/时间线”入口（tab/区块/独立页面均可）：
  - 时间线单位为 **事件（event）**，而不是 Run 列表；默认只展示“发生变化/发生操作”的事件（不展示“采集成功但无变化”的事件）。
  - 事件至少覆盖：
    - **采集变化事件**：某次采集导致 canonical 关键字段或关系发生变化（事件可引用 runId 作为证据/跳转，但不以 Run 作为列表单位）。
    - **台账字段审计事件**：台账字段写入/批量写入等审计事件（来自 `audit_event`）。
    - **治理事件**：合并（Merge）事件（来自 `merge_audit`），以及资产状态变化（in_service/offline）。
  - 支持事件筛选（按事件类型）与分页加载。
- 合并后的历史不丢失：当资产 B 合并进 A 时，A 的历史需能（至少）追溯到 B 的历史事件，并标注“来源于被合并资产 B”。

**Out of Scope（一期开口径）**

- 全字段 diff 引擎（仅做“关键字段 + 关系”的变化摘要；可后续增强）。
- 变更原因自动归因（仅展示事实与来源证据）。
- 全局历史检索（跨资产的历史搜索/报表）。
- “重复候选忽略/取消忽略”等重复中心操作事件不纳入 M12 时间线（后续若需要可再扩展）。

### Success Metrics

- 用户可在资产详情快速定位：
  - “某字段从 A 变到 B 发生在何时/由什么触发（采集/人工）”
  - “该资产发生过合并/下线/恢复等关键治理事件”

## Feature Overview

### Core Requirements

1. **历史入口（按资产）**

- 在 `/assets/[uuid]` 中提供“历史/时间线”入口（默认对 admin/user 可见；敏感信息仍受控）。

2. **事件时间线（不是 Run 列表）**

- 时间线按 `occurredAt` 倒序展示事件卡片。
- 每个事件必须包含：事件类型、发生时间、摘要（人类可读）、证据引用（可选：runId/auditEventId/mergeId）。

3. **采集变化事件（collect-driven）**

- 当某次成功采集导致该资产 canonical **关键字段**或**关系**发生变化时，生成一条“采集变化事件”：
  - VM：IP/电源状态/CPU/内存/OS（最小集合）
  - Host：管理 IP/CPU/内存/磁盘总量/序列号/厂商型号（最小集合）
  - Cluster：名称/成员数量（best-effort）
- 关系变化摘要（最小集合）：
  - `runs_on` / `member_of` 的新增/移除/目标变化（best-effort）

4. **台账字段审计事件（audit-driven）**

- 若该资产发生过台账字段写入/批量写入：
  - 必须可在历史中看到“谁在何时改了哪些台账字段”（至少展示字段 key、新值摘要、requestId；若有旧值则展示旧值摘要）。
  - 数据来源以审计事件为准（不要求全字段 diff 引擎）。

5. **治理事件（governance-driven）**

- 合并事件：展示主/从资产、策略摘要，并提供跳转到相关资产的入口。
- 状态变化事件：展示 offline/in_service/merged 的变化与发生时间（来源于治理流程/汇总计算的结果）。

## Detailed Requirements

### 1) 事件数据契约（API 输出）

建议统一输出结构 `AssetHistoryEvent`（示例字段）：

- `eventId`：string
- `assetUuid`：string
- `sourceAssetUuid`：string | null（当事件来自“被合并资产”时填写，用于 UI 标注）
- `eventType`：枚举（见下）
- `occurredAt`：datetime（事件发生时间；采集事件可取 run.finishedAt 或 snapshot.computedAt）
- `title`：string（短标题）
- `summary`：object（结构化摘要，便于 UI 渲染）
- `refs`：object
  - `runId`?: string
  - `auditEventId`?: string
  - `mergeId`?: string

建议最小 `eventType` 枚举：

- `collect.changed`：采集导致变化
- `ledger_fields.changed`：台账字段变更（单资产/批量写入均归一）
- `asset.merged`：资产被合并/发生合并
- `asset.status_changed`：资产状态变化（offline/in_service/merged）

### 2) API 设计（示例）

- `GET /api/v1/assets/{assetUuid}/history?cursor={cursor}&limit=20&types=collect.changed,ledger_fields.changed`
  - 返回：`{ items: AssetHistoryEvent[], nextCursor?: string }`
- 可选（用于详情抽屉/跳转）：
  - `GET /api/v1/assets/{assetUuid}/history/{eventId}`：返回更完整的 `summary`（例如 TopN 字段变化、关系变化详情）。

> 权限：对 user 开放只读；admin 额外可见更多调试字段（但禁止包含 raw payload 明文）。

### 3) 事件生成策略（物化优先）

为避免“读时 diff/读时扫描”带来的性能与一致性风险，建议在写入侧物化事件：

1. **采集变化事件**
   - 在每次 `collect` Run 成功并完成 ingest 后：
     - 取该资产“上一份 canonical 快照”与“本次 canonical 快照”做对比（字段 + 关系）。
     - 若差异为空：不生成任何采集事件；时间线不展示该次采集。
     - 若差异非空：写入一条 `collect.changed` 事件，payload 存：
       - `changedFieldsTopN`（字段 path + old/new 摘要）
       - `changedRelations`（runs_on/member_of 的新增/移除摘要）
       - `runId`/`sourceId`/`collector_plugin`（脱敏）
2. **台账字段事件**
   - 直接从 `audit_event` 投影（或同步写入 history event 表），保证 requestId/actor 可追溯。
3. **治理事件**
   - 合并：从 `merge_audit` 投影（或同步写入）。
   - 状态变化：在状态变化发生处写入事件（或在汇总任务中检测状态变化并写入）。

> 存储建议：新增 `asset_history_event` 表（或等价），按 `asset_uuid + occurred_at desc` 索引，payload 为 JSON（必须可脱敏/可裁剪）。

### 4) UI 交互（资产详情页）

- “历史/时间线”默认展示：
  - 事件卡片列表（时间倒序）
  - 顶部筛选：事件类型（多选）
- 若现有资产详情页存在“采集事件（按 Run）列表”视图：需调整为本 PRD 的“按事件（仅变化）”口径，避免把历史时间线退化为 Run 列表。
- 事件卡片最小信息：
  - 时间 + 标题 + 2~5 条摘要（例如“IP: 10.0.0.1 -> 10.0.0.2”）
  - 证据跳转：
    - 采集变化：跳转 `/runs/[id]`（若 user 可见则开放）
    - 台账字段：跳转审计事件详情（若有页面；否则详情抽屉展示）
    - 合并：跳转相关资产
- 空状态：若无事件，展示“暂无历史事件（可能尚未发生变化/尚无审计操作）”。

### 5) 性能与约束（最小预算）

- 首屏：`GET history` p95 ≤ 500ms（limit=20，单资产）。
- 事件分页：cursor based pagination（避免 deep offset）。
- payload 控制：
  - 事件摘要必须可控（TopN 字段，避免超大 JSON）。
  - 严禁写入敏感信息（凭证、raw 明文）；必要时对值做截断/脱敏。

### 6) 边界条件

- **合并后的历史**：当 B 合并进 A，A 的 history 查询需合并 B（递归）事件，并在 UI 标注 `sourceAssetUuid=B`。
- **资产状态为 merged**：被合并资产默认不可在列表访问，但其历史需可被主资产追溯。
- **来源消失/恢复**：当 M5 下线语义落地后，应能产生 `asset.status_changed`（offline/in_service）。

## Design Decisions

### Technical Approach

- 采用“事件时间线（event-driven）”作为产品呈现形态；采集变化事件通过 ingest 时 diff 物化生成，避免读时 diff。
- 事件统一为同一 API 输出结构，UI 以“事件卡片 + 详情抽屉”渲染，Run/audit/merge 仅作为证据引用。

### Constraints

- 不引入全字段 diff 引擎；仅做关键字段与关系的 TopN 摘要。
- 永久保留语义：事件与其引用的 run/audit/merge 记录必须可追溯，不得因清理导致断链。

### Risk Assessment

- **性能风险**：事件物化/回填会增加写入侧成本；需控制 TopN 与 payload 大小。
- **一致性风险**：字段/关系“重要性列表”若频繁变动，会导致历史摘要口径不一致；需先固化最小集合并谨慎演进。
- **合并追溯复杂度**：合并链递归查询需要防循环与性能保护（最大深度/去重）。

## Clarified Decisions（已确认）

1. 治理事件范围：仅合并、下线/恢复（offline/in_service）纳入时间线。
2. 不展示“采集成功但无变化”的事件（不生成 `collect.noop`）。
3. 合并后历史默认自动合并展示被合并资产的历史事件，并标注来源于被合并资产。

## Acceptance Criteria

### Functional Acceptance

- [ ] `/assets/[uuid]` 提供“历史/时间线”入口，按资产维度展示事件列表（不按 Run 列表展示）。
- [ ] 时间线支持按事件类型筛选与分页加载（cursor）。
- [ ] 当采集导致 canonical 关键字段或关系发生变化时，生成并展示 `collect.changed` 事件（含 TopN 字段变化摘要 + 关系变化摘要）。
- [ ] 采集成功但无任何变化时：不生成、不展示任何采集事件（避免时间线退化为 Run 列表）。
- [ ] 台账字段变更（单资产保存/批量设置）会在历史中以 `ledger_fields.changed` 事件可见（含 actor/时间/字段 key/新值摘要/requestId）。
- [ ] 合并发生时，历史中可见 `asset.merged` 事件，并可跳转相关资产。
- [ ] 资产 offline/in_service 状态变化可在历史中以 `asset.status_changed` 事件可见（在 M5 语义落地后生效）。
- [ ] 合并后主资产的历史可追溯到被合并资产的历史事件，并对“来源于被合并资产”的事件做标注。

### Quality Standards

- [ ] history API 支持 cursor 分页；`limit=20` 时 p95 ≤ 500ms（本地/测试环境可用日志或简单压测验证）。
- [ ] 事件摘要 payload 有大小上限（TopN），且不会因单次变化导致超大响应。
- [ ] 事件与 API 响应不得包含任何敏感信息（凭证/raw 明文）；必要值做截断/脱敏。

### User Acceptance

- [ ] 时间线默认信息"可读、可行动"：采集变化事件可跳转到 `/runs/[id]`；合并事件可跳转到相关资产。
- [ ] 无事件时有明确空状态文案，不误导为"系统故障"。

## Test Scenarios

### 正向场景（Happy Path）

| 场景 ID | 场景描述         | 前置条件                     | 操作步骤              | 期望结果                                                  |
| ------- | ---------------- | ---------------------------- | --------------------- | --------------------------------------------------------- |
| T12-01  | 历史入口可见     | 资产存在                     | 访问 `/assets/[uuid]` | 展示"历史/时间线"入口                                     |
| T12-02  | 采集变化事件展示 | 资产字段发生变化             | 查看历史              | 展示 `collect.changed` 事件；含 TopN 字段变化摘要         |
| T12-03  | 台账字段变更事件 | 台账字段被修改               | 查看历史              | 展示 `ledger_fields.changed` 事件；含 actor/时间/字段 key |
| T12-04  | 合并事件展示     | 资产发生合并                 | 查看历史              | 展示 `asset.merged` 事件；可跳转相关资产                  |
| T12-05  | 状态变化事件     | 资产 offline/in_service 变化 | 查看历史              | 展示 `asset.status_changed` 事件                          |
| T12-06  | 事件筛选         | 存在多种事件                 | 按类型筛选            | 仅展示选中类型事件                                        |
| T12-07  | 分页加载         | 事件数量 > 20                | 滚动加载              | cursor 分页正常；无重复                                   |

### 异常场景（Error Path）

| 场景 ID | 场景描述 | 前置条件       | 操作步骤 | 期望行为                     |
| ------- | -------- | -------------- | -------- | ---------------------------- |
| T12-E01 | 无事件   | 资产无任何变化 | 查看历史 | 展示空状态文案"暂无历史事件" |

### 边界场景（Edge Case）

| 场景 ID | 场景描述             | 前置条件             | 操作步骤      | 期望行为                                    |
| ------- | -------------------- | -------------------- | ------------- | ------------------------------------------- |
| T12-B01 | 采集无变化不生成事件 | 采集成功但无字段变化 | 查看历史      | 不展示该次采集事件                          |
| T12-B02 | 合并后历史归并       | 资产 B 合并进 A      | 查看 A 的历史 | 包含 B 的历史事件；标注 `sourceAssetUuid=B` |
| T12-B03 | 大量事件             | 资产有 500+ 事件     | 查看历史      | cursor 分页正常；p95 < 500ms                |
| T12-B04 | 合并链递归           | A←B←C 合并链         | 查看 A 的历史 | 包含 B 和 C 的历史事件                      |

## Dependencies

| 依赖项         | 依赖类型 | 说明                                |
| -------------- | -------- | ----------------------------------- |
| M5 下线语义    | 硬依赖   | `asset.status_changed` 事件依赖 M5  |
| M5 合并        | 硬依赖   | `asset.merged` 事件依赖 M5          |
| M8 台账字段    | 硬依赖   | `ledger_fields.changed` 事件依赖 M8 |
| audit_event 表 | 硬依赖   | 台账字段事件来源                    |
| merge_audit 表 | 硬依赖   | 合并事件来源                        |

## Observability

### 关键指标

| 指标名                               | 类型      | 说明              | 告警阈值         |
| ------------------------------------ | --------- | ----------------- | ---------------- |
| `asset_history_api_latency_p95`      | Histogram | 历史 API 延迟 p95 | > 500ms 触发告警 |
| `asset_history_event_generation_lag` | Gauge     | 事件生成延迟      | > 5min 触发告警  |

### 日志事件

| 事件类型                        | 触发条件       | 日志级别 | 包含字段                                      |
| ------------------------------- | -------------- | -------- | --------------------------------------------- |
| `history.event_generated`       | 事件物化完成   | INFO     | `asset_uuid`, `event_type`, `run_id`          |
| `history.merge_chain_traversed` | 合并链递归查询 | DEBUG    | `primary_uuid`, `chain_depth`, `merged_uuids` |

## Performance Baseline

| 场景       | 数据规模 | 期望性能             | 验证方法 |
| ---------- | -------- | -------------------- | -------- |
| 首屏加载   | 20 事件  | p95 < 500ms          | API 压测 |
| 大历史资产 | 500 事件 | 分页加载 p95 < 500ms | API 压测 |
| 合并链查询 | 深度 5   | < 1s                 | 压测     |

## Data Migration Strategy

> 存量数据的事件回填方案。

### 回填范围

- **采集变化事件**：对存量资产，基于 `source_record` 历史做 diff 回填（可选，建议仅回填最近 N 天）
- **台账字段事件**：从 `audit_event` 投影（已有数据，无需回填）
- **合并事件**：从 `merge_audit` 投影（已有数据，无需回填）
- **状态变化事件**：从 M5 落地后开始生成（不回填历史）

### 回填策略

| 阶段    | 操作                         | 说明                     |
| ------- | ---------------------------- | ------------------------ |
| Phase 1 | 部署事件生成逻辑             | 新增事件开始物化         |
| Phase 2 | 投影 audit_event/merge_audit | 历史审计事件可见         |
| Phase 3 | （可选）回填采集变化事件     | 离线任务，按资产分批处理 |

### 回填约束

- 回填任务不阻塞主流程
- 回填期间历史 API 可用（返回已有事件）
- 回填完成后无需重启服务

## Execution Phases

### Phase 1: 事件模型与口径定稿

- [ ] 定义 `AssetHistoryEvent` 的 eventType 枚举与 payload schema（TopN 字段清单/关系清单）
- [ ] 明确 `occurredAt` 取值口径（run.finishedAt vs snapshot.computedAt）

### Phase 2: 事件生成（写入侧物化）+ 回填策略

- [ ] 在 ingest 后生成 `collect.changed` 事件（diff 物化）
- [ ] 将 `audit_event/merge_audit` 投影到 history（或实现联表聚合）
- [ ] 对存量数据提供 backfill 方案（可离线任务/一次性脚本）

### Phase 3: UI 落地

- [ ] `/assets/[uuid]` 增加 History tab + 事件列表 + 筛选 + 详情抽屉
- [ ] 实现 run/asset/audit 的跳转与权限控制（user/admin）

### Phase 4: 治理联动与打磨

- [ ] 合并链历史归并与标注（sourceAssetUuid）
- [ ] 状态变化事件接入（M5 下线语义落地后）
- [ ] 性能与 payload 控制回归（大历史资产）

---

**Document Version**: 1.1
**Created**: 2026-01-31
**Last Updated**: 2026-01-31
**Clarification Rounds**: 3
**Quality Score**: 100/100 (audited)
