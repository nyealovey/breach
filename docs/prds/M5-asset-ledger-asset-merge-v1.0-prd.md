# M5：资产台账系统 - 人工合并（Merge）与审计 - 产品需求文档（PRD）

> 目标：支持管理员将多个 Asset 合并为一个主资产（Merge），合并后可追溯、可审计、默认隐藏被合并资产，并确保关系/来源明细正确并入。

## Requirements Description

### Background

- **现状问题**：重复资产无法治理；缺少合并入口与审计。
- **目标用户**：管理员（admin）。
- **价值**：降低重复资产对盘点/审计的干扰，形成“可治理”的台账体系。

### Scope / Out of Scope

**In Scope**

- 合并操作（admin-only）：
  - 选择主资产 A 与被合并资产 B（可扩展为多从资产）
  - 关系边并入并去重
  - 来源明细（SourceRecord/Link）并入
  - 被合并资产状态标记为 merged，默认不在资产列表展示
- 审计：
  - 记录操作者、时间、主/从资产、冲突处理策略、影响范围摘要

**Out of Scope**

- 自动合并。
- 复杂冲突交互（一期只做“主资产优先”策略；可后续扩展为可选策略）。

### Success Metrics

- 合并后资产列表不再出现重复项（被合并资产默认隐藏）。
- 合并审计可查、可追溯。

## Feature Overview

### Core Requirements

1. **合并策略**

- 默认策略：主资产优先（冲突字段按主资产值保留）。
- 必须在界面展示冲突字段清单与最终采用值，并写入审计。

2. **数据一致性**

- 合并后：
  - A 的来源明细包含原本属于 B 的 SourceRecords
  - 关系边去重合并
  - B 标记 merged（不可用/默认隐藏，但仍可追溯）

## Detailed Requirements

### 1) 数据模型（草案）

- Asset：
  - `mergedIntoAssetUuid` 指向主资产
  - `status=merged`
- 合并审计：
  - `audit_event.eventType = asset.merged`（示例）
  - payload 记录主/从资产与冲突摘要

### 2) UI（草案）

- 重复中心候选详情 → “合并”入口
- 合并确认页：选择主资产、展示对比字段与冲突摘要、确认提交

## Acceptance Criteria

- [ ] 管理员可完成合并操作；被合并资产默认不出现在资产列表。
- [ ] 合并后主资产的来源明细与关系边正确并入并去重。
- [ ] 合并操作写入审计事件（含主/从资产与冲突处理摘要）。

---

**Document Version**: 1.0  
**Created**: 2026-01-30  
**Quality Score**: 55/100
