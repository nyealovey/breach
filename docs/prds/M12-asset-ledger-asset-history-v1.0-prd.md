# M12：资产台账系统 - 资产历史追溯（按 Run）- 产品需求文档（PRD）

> 目标：在资产详情页提供“历史/时间线”入口，允许用户按 Run 查看资产快照与关键字段/关系变化摘要，满足“永久可追溯”的验收要求。

## Requirements Description

### Background

- **现状问题**：当前资产详情主要展示 latest snapshot 与来源明细，缺少“按 Run 的变化历史”入口。
- **目标用户**：管理员（admin）、普通用户（user）。
- **价值**：支撑审计与排障：知道“什么时候变了、变了什么、来自哪次采集”。

### Scope / Out of Scope

**In Scope**

- 资产详情新增 “历史” 区块/页面：
  - 列出该资产的 Run 时间线（runId/时间/mode/status）
  - 展示每次 Run 的 canonical 快照（可折叠）
  - 展示关键字段变化摘要（Top N 字段）与关系变化摘要（outgoing）

**Out of Scope**

- 全字段 diff 引擎（一期只做关键字段摘要；可后续增强）。
- 审计与变更原因自动归因（仅展示事实与来源）。

### Success Metrics

- 用户可在资产详情快速定位“某字段从 A 变到 B 发生在何时/哪次 Run”。

## Feature Overview

### Core Requirements

1. **历史时间线**

- 按时间倒序展示该资产关联的 `AssetRunSnapshot` 列表（或等价实体）。

2. **变化摘要（最小集合）**

- VM：IP/电源状态/CPU/内存/OS
- Host：管理 IP/CPU/内存/磁盘总量/ESXi build（如适用）
- Cluster：成员数量/名称（best-effort）

## Acceptance Criteria

- [ ] 资产详情提供历史入口，按 Run 展示时间线。
- [ ] 至少展示每次 Run 的 canonical 快照（折叠）与关键字段变化摘要。

---

**Document Version**: 1.0  
**Created**: 2026-01-30  
**Quality Score**: 55/100
