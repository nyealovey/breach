# M5：资产台账系统 - 人工合并（Merge）与审计 - 产品需求文档（PRD）

> 目标：支持管理员将多个 Asset 合并为一个主资产（Merge），合并后**可追溯、可审计**、默认隐藏被合并资产，并确保关系/来源明细正确并入，满足“可治理”的台账体系。

## Requirements Description

### Background

- **现状问题**：多来源/迁移会造成重复资产；系统需要“可解释的治理入口”以满足盘点与审计。
- **目标用户**：管理员（admin）。
- **价值**：
  - 让资产视图“可治理”：重复资产可被合并为单一主资产，减少盘点干扰。
  - 让治理“可追溯”：任何合并操作都可在审计中回放，且历史数据不丢失。

### Scope / Out of Scope

**In Scope**

- 合并操作（admin-only）：
  - 选择主资产 A 与被合并资产 B（支持一次合并 N 个从资产到 1 个主资产）。
  - 合并后：
    - 被合并资产标记为 `merged`，并指向主资产 `merged_into_asset_uuid=A`。
    - 主资产在查询层能够看到被合并资产的来源明细与关系（去重后）。
    - 资产列表默认隐藏 `merged` 资产（直接访问 merged 资产需引导跳转到主资产）。
- 冲突策略（一期固定）：
  - `primary_wins`：冲突字段按主资产优先（不做手工逐字段 pick）。
- 审计（必须）：
  - 合并写入 `merge_audit`（永久保留，见 `docs/design/asset-ledger-data-model.md`）。
  - 同时写入通用审计 `audit_event`（event_type=`asset.merged`）。

**Out of Scope**

- 自动合并。
- 撤销合并（unmerge/rollback）：仅保留 `snapshot_ref` 作为未来预留。
- 复杂冲突交互（手工逐字段选择）：后续版本再扩展 `manual_pick`。

### Success Metrics

- 合并后资产列表不再出现重复项（被合并资产默认隐藏）。
- 合并审计可查、可追溯（可按主/从资产追溯到操作者/时间/策略/影响摘要）。

## Feature Overview

### Core Requirements

1. **合并合法性**

- 仅 admin 可合并。
- 仅允许同 `asset_type` 的资产合并（dup-rules-v1 也仅会产生同类候选）。
- 被合并资产不能已处于 `merged` 状态；主资产也不能是 `merged` 资产。
- 不能产生合并环（A 合并到 B，同时 B 合并到 A）。

2. **合并不变量（强约束）**

以 `docs/design/asset-ledger-data-model.md` 的“合并语义与不变量”为准：

- 被合并资产必须：`asset.status=merged` 且 `merged_into_asset_uuid=primary_asset_uuid`。
- 被合并资产的 `asset_source_link` 必须迁移/重绑定到主资产，并保持 `(source_id, external_kind, external_id)` 唯一约束（冲突时去重合并）。
- 历史不丢：`source_record`、关系边与 `audit_event` 在查询层必须可追溯（通过实体迁移实现）。

3. **冲突策略（一期固定 primary_wins）**

- UI 必须展示“关键冲突字段”对比与最终采用值（主资产值）。
- 合并审计必须记录冲突摘要（哪些字段冲突、采用了哪个策略）。

## Detailed Requirements

### 1) 数据模型（概念 + 关键字段）

以 `docs/design/asset-ledger-data-model.md` 为准：

- `asset`：
  - `status=in_service|offline|merged`
  - `merged_into_asset_uuid`（当 status=merged 时必填）
- `merge_audit`（永久保留）：
  - `merge_id`
  - `primary_asset_uuid`
  - `merged_asset_uuid`（若一次合并 N 个，从资产应写 N 条 merge_audit，或用一条记录 + 数组字段；实现可选，但必须可追溯到每个 merged_asset_uuid）
  - `performed_by_user_id` / `performed_at`
  - `conflict_strategy=primary_wins`
  - `summary`（JSON：影响范围摘要）
  - `snapshot_ref`（可选：未来 unmerge 预留）
- `audit_event`：
  - `event_type=asset.merged`
  - `subject_type=asset` / `subject_id=primary_asset_uuid`
  - `context.request_id`

### 2) 合并流程（语义与校验）

#### 2.1 输入

- `primaryAssetUuid`：主资产 UUID
- `mergedAssetUuids[]`：被合并资产 UUID 列表（N>=1）
- `conflictStrategy`：一期固定为 `primary_wins`（接口可接受但只能为该值）

#### 2.2 校验（必须）

- 权限：非 admin 返回 403（`AUTH_FORBIDDEN`）。
- 存在性：任一 asset 不存在返回 404（`CONFIG_ASSET_NOT_FOUND` 或等价）。
- 类型一致：`asset_type` 不一致返回 400（建议新增错误码 `CONFIG_ASSET_MERGE_ASSET_TYPE_MISMATCH` 并注册到错误码文档）。
- 状态约束：
  - primary 不能是 merged（否则无法作为主资产）
  - mergedAsset 不能是 merged（避免“合并已合并资产”）
  - primary 不能出现在 mergedAssetUuids 中
- 环检测：若 mergedAsset 已经通过链条合并到 primary（或 primary 合并到 mergedAsset）必须拒绝，避免环（建议错误码 `CONFIG_ASSET_MERGE_CYCLE_DETECTED`）。

### 3) 数据迁移：asset_source_link / source_record

#### 3.1 asset_source_link 迁移（必须）

目标：被合并资产的持续追踪 link 迁移到主资产，保证后续采集仍归属到主资产。

- 对于每条从资产的 `asset_source_link`：
  - 尝试迁移到主资产（更新 `asset_uuid=primary_asset_uuid`）。
  - 若触发 `(source_id, external_kind, external_id)` 唯一冲突（主资产已存在同 link）：
    - 采取“去重合并”：保留主资产 link，删除/归档重复 link（实现可选，但必须保证后续 source_record 可追溯）。

#### 3.2 source_record 迁移（必须）

目标：历史来源明细在主资产下可追溯。

- 将从资产相关的 `source_record.asset_uuid` 更新为主资产 UUID。
- 若 source_record 以 `link_id` 为主关联（推荐），则同时更新为迁移后的 link_id（或保留原 link_id 并在查询层通过 merge 映射归并；实现可选，但必须保证资产详情“来源明细”能展示合并后的全集）。

### 4) 数据迁移：关系边（relation）

目标：合并后关系链可用且去重。

- 将所有指向从资产的关系边重定向到主资产：
  - `from_asset_uuid = merged_asset_uuid` → 改为 `primary_asset_uuid`
  - `to_asset_uuid = merged_asset_uuid` → 改为 `primary_asset_uuid`
- 去重规则（与 `relation` 唯一建议一致）：
  - `(relation_type, from_asset_uuid, to_asset_uuid, source_id)` 唯一
- 自环处理：
  - 重定向后形成 `from=primary` 且 `to=primary` 的自环必须删除/忽略。

> 说明：`relation_record` 为历史 raw 快照，是否迁移可按实现选择，但最终查询层必须保证“主资产关系视图”包含从资产的关系历史（不丢）。

### 5) 被合并资产的可见性与跳转

- 资产列表默认隐藏 `status=merged` 的资产（避免重复展示）。
- 若用户通过直接 URL 访问 merged 资产：
  - UI 应展示“已合并提示”并跳转到 `merged_into_asset_uuid` 指向的主资产（保留可追溯入口）。
  - API 可返回 `status=merged` + `mergedIntoAssetUuid`（建议），便于前端处理跳转。

### 6) 与 DuplicateCandidate 联动

- 合并完成后：
  - 将涉及主/从资产的 DuplicateCandidate `status` 置为 `merged`（终态），避免继续提示。

### 7) 审计与摘要（必须可验收）

#### 7.1 merge_audit.summary（建议最小字段）

- `requestId`
- `primaryAssetUuid`
- `mergedAssetUuids`
- `conflictStrategy`
- `migrated`：
  - `sourceLinksMovedCount`
  - `sourceRecordsMovedCount`
  - `relationsRewrittenCount`
  - `dedupedSourceLinksCount`
  - `dedupedRelationsCount`
- `conflicts`：
  - `conflictFieldsTopN`（字段 path 列表 + 主/从摘要）

#### 7.2 audit_event

- 必须记录操作者与 requestId（`X-Request-ID`）。
- 审计记录只增不改（append-only）。

### 8) API 契约（建议）

> 注：当前 `docs/design/asset-ledger-api-spec.md` 未覆盖 merge API；本 PRD 定义最小契约，后续需补充到 API spec。

- `POST /api/v1/assets/:primaryAssetUuid/merge`
  - body: `{ mergedAssetUuids: string[], conflictStrategy?: "primary_wins" }`
  - 200: 返回主资产 UUID 与合并摘要（merge_id 列表或 job_id）

权限：

- admin-only；user 访问返回 403（`AUTH_FORBIDDEN`）。

## Design Decisions

### Technical Approach

- 采用“数据迁移 + 主键不变”的合并模型：
  - 主资产 UUID 不变
  - 从资产标记 merged 并指向主资产
  - 通过迁移 `asset_source_link` 保证后续持续追踪正确归属
- 合并操作要求原子性：建议 DB transaction 包裹关键更新（asset/link/records/relations/audit）。

### Constraints

- 冲突策略一期固定 `primary_wins`，不做手工逐字段 pick。
- 不提供 unmerge/rollback（仅保留 snapshot_ref 预留）。
- 不允许跨 asset_type 合并。

### Risk Assessment

- **数据一致性风险**：迁移过程中若部分失败可能造成“link 迁移了但 relation 没迁移”。缓解：事务 + 幂等设计 + merge_audit 摘要可回放核对。
- **性能风险**：单次合并若牵涉大量 source_record/relations，事务可能过大。缓解：限制一次合并的从资产数量上限（建议 N<=20），并在 UI 引导分批；或引入异步 job（后续）。
- **环/链复杂度**：多次合并形成链条，历史归并/查询复杂。缓解：写入时做环检测；查询时做去重与最大深度保护。

## Acceptance Criteria

### Functional Acceptance

- [ ] admin-only：只有管理员可发起合并；user 发起返回 403（AUTH_FORBIDDEN）。
- [ ] 支持一次合并多个从资产到一个主资产（N>=1）。
- [ ] 合并后从资产：`status=merged` 且 `merged_into_asset_uuid=primary`；资产列表默认隐藏 merged 资产。
- [ ] 主资产可在资产详情查看“合并提示/合并历史摘要”（至少能追溯 merge_audit）。
- [ ] 合并后 `asset_source_link` 迁移到主资产，并保持 `(source_id, external_kind, external_id)` 唯一约束；冲突时去重合并。
- [ ] 合并后主资产来源明细（source_records）可看到从资产历史（不丢）。
- [ ] 合并后关系边重定向到主资产且去重；不得产生自环关系。
- [ ] 直接访问 merged 资产时 UI 引导/跳转到主资产（可追溯，不迷路）。

### Audit Acceptance

- [ ] 每次合并写入 `merge_audit`（含操作者/时间/策略/影响摘要/requestId）。
- [ ] 同时写入 `audit_event`（event_type=asset.merged），可按主资产追溯。

### Quality Standards

- [ ] 合并操作具备幂等性：重复请求不会造成重复迁移/重复关系。
- [ ] 文档同步：如新增 merge API，需补充到 `docs/design/asset-ledger-api-spec.md`；如新增错误码，需注册到 `docs/design/asset-ledger-error-codes.md`。

## Execution Phases

### Phase 1: 数据模型与审计落库

- [ ] 实现 merge_audit + audit_event 写入
- [ ] 明确并实现 `primary_wins` 冲突摘要结构

### Phase 2: 合并核心逻辑（数据迁移）

- [ ] asset 状态与 merged_into_asset_uuid 更新
- [ ] asset_source_link 迁移与去重
- [ ] source_record 迁移（asset_uuid/link_id）
- [ ] relation 重定向与去重、自环处理

### Phase 3: UI 合并流程

- [ ] 从重复中心进入合并确认页
- [ ] 展示冲突字段对比与策略说明
- [ ] 合并成功后的提示与跳转（包含 merge_audit 可追溯入口）

### Phase 4: 联动与回归

- [ ] 合并后 DuplicateCandidate 置为 merged
- [ ] 回归用例：合并前后 assets/sourceLinks/source-records/relations 一致性核对

---

**Document Version**: 1.0
**Created**: 2026-01-30
**Clarification Rounds**: 0
**Quality Score**: 100/100
