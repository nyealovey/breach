# M5：资产台账系统 - 重复资产治理（重复中心 + 下线语义）- 产品需求文档（PRD）

> 目标：
>
> 1. 实现疑似重复候选（DuplicateCandidate）的生成与展示，让管理员可解释地处理“可能重复的资产”（忽略/合并入口）。
> 2. 补齐“来源消失即下线”的语义：当某来源在最新成功 Run 中未发现之前存在的对象时，对该来源维度标记为未发现/下线，并在资产总体层面汇总为在管/下线。

## Requirements Description

### Background

- **现状问题**：迁移/多来源会导致同一资产出现多份记录，当前系统缺少“重复提示与治理入口”。
- **现状问题（下线语义缺失）**：当前仅更新“本轮出现”的 lastSeenAt，缺少“本轮未出现”的明确语义，导致资产下线无法验收，也会影响重复治理的可解释性（例如“最近一次出现时间”的口径不稳定）。
- **目标用户**：管理员（admin）。
- **价值**：通过固定规则生成候选，降低重复资产的人工排查成本，并为合并提供入口。

### Scope / Out of Scope

**In Scope**

- 候选生成：
  - 按固定规则（`dup-rules-v1`）生成候选
  - 候选需可解释（命中原因/置信度/关键字段对比）
- 下线语义（来源消失）：
  - per-source 维度：对“本轮未出现”的对象标记未发现/下线，并保留 last_seen_at（上轮可见时间）与 missing_run_id（缺失发生在哪次 Run）
  - overall 维度：若资产在所有来源均未发现 → Asset.status=offline；任一来源再次出现 → 恢复为 in_service
- UI：
  - 重复中心列表：候选列表、筛选、排序（按置信度/最近出现时间）
  - 候选详情：命中原因、字段对比、最近出现时间、操作入口（忽略/进入合并）
- 忽略：
  - 管理员可将候选标记为“非重复/忽略”，避免反复提示

**Out of Scope**

- 自动合并（无论置信度多高均不自动合并）。
- 候选规则配置化（规则固定，不提供 UI 配置）。

### Success Metrics

- 重复候选可解释展示（原因/置信度/对比字段齐全）。
- 被忽略的候选不会反复出现（按既定降噪策略）。
- 在成功 Run 后，“本轮未出现”的对象会被标记为下线，且 UI 可见。

## Feature Overview

### Core Requirements

1. **规则口径**

- 规则以 `docs/design/asset-ledger-dup-rules-v1.md` 为准。

2. **候选生命周期**

- 状态至少包含：open/ignored/merged（以数据模型设计为准）。
- 必须记录：命中原因、置信度、最近出现时间、涉及资产集合。

3. **下线语义（来源消失）**

- Given 某对象上轮可见、本轮成功 Run 未出现  
  Then 该来源维度标记为未发现，并保留 last_seen_at（上轮可见时间）
- Given 资产在所有来源均未发现  
  Then Asset.status=offline（或等价语义）

## Detailed Requirements

### 1) 数据模型（草案）

- 引入 `duplicate_candidate`（或等价）表：
  - candidate_id、状态、置信度、命中原因、涉及 asset_uuid 列表/对
  - created_at/updated_at

### 2) 下线语义（数据模型草案）

- 在 `AssetSourceLink` 或新增表中落地“可见性状态/缺失 Run”：
  - `visibility_status = active | missing`
  - `missing_since_run_id`（best-effort）

### 3) 触发时机（草案）

- Run 成功结束后触发候选生成（可异步任务/定时任务）。
- 在每次成功 `collect` Run ingest 完成后，执行“未出现对象”计算与状态更新（建议与候选生成同一条异步流水线，避免重复扫描）。

## Acceptance Criteria

- [ ] 可生成候选并在 UI 的重复中心查看。
- [ ] 候选详情可解释：展示命中原因、置信度、关键字段对比、最近出现时间。
- [ ] 支持忽略；同一对候选后续命中不应反复提示。
- [ ] 成功 Run 后：来源维度可识别“未出现/下线”对象。
- [ ] 当资产在所有来源均未发现时：资产总体状态汇总为 offline。
- [ ] 资产再次出现时：状态可恢复为 in_service，并记录 last_seen_at 更新。

---

**Document Version**: 1.0  
**Created**: 2026-01-30  
**Quality Score**: 55/100
