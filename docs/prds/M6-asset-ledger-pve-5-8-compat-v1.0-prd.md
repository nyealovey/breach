# M6：资产台账系统 - PVE 采集（兼容 5.0 ～ 8.0）- 产品需求文档（PRD）

> 目标：新增 PVE 来源采集能力，并确保 **PVE 5.0～8.0** 环境的关键路径稳定可用（detect/collect；字段解析健壮；错误口径一致）。

## Requirements Description

### Background

- **现状问题**：系统未实现 PVE 插件，无法覆盖 PVE 资产盘点。
- **目标用户**：管理员（admin）。
- **价值**：将 PVE 纳入统一资产视图与关系链展示，形成多来源台账基础。

### Scope / Out of Scope

**In Scope**

- 插件化采集：`healthcheck/detect/collect`。
- 覆盖 PVE 5.0～8.0 的 API 差异（字段缺失/结构差异 best-effort 兼容）。
- 资产类型：VM/Host/Cluster（best-effort）。
- 关系：VM→Host（runs_on）、Host→Cluster（member_of）best-effort；禁止 relations=0 伪成功（对虚拟化平台）。

**Out of Scope**

- 性能指标/告警事件/日志采集。
- 存储/网络拓扑专项（另立 PRD）。

### Success Metrics

- `detect` 成功率 = 100%
- `collect` 成功率 ≥ 99%
- `collect` 成功时：`relations.length > 0`

## Feature Overview

### Core Requirements

1. **版本兼容策略**

- 以 driver + capability probe 方式兼容 5.0～8.0：
  - 对可选字段缺失应健壮解析
  - 对关键枚举失败/权限不足导致 inventory 不完整必须失败（不可用即失败）

2. **最小字段集**

- VM：cpu_count/memory_bytes/power_state/IP（best-effort）
- Host：hostname/os/version/cpu/mem（best-effort）
- Cluster：cluster 名称（best-effort）

## Detailed Requirements

### 1) Source 类型（草案）

- SourceType：`pve`
- config：endpoint/认证方式（token/user+password）等（待细化）

### 2) 验收清单（必须输出）

- 形成 PVE 5.x/6.x/7.x/8.x 的最小回归清单（手工步骤 + 期望输出摘要）。

## Acceptance Criteria

- [ ] PVE 5.0～8.0：`detect` 可成功并输出版本/能力摘要。
- [ ] PVE 5.0～8.0：`collect` 可成功并产出 VM/Host（Cluster best-effort），且成功时 `relations.length > 0`。
- [ ] 关键能力缺失/权限不足导致 inventory 不完整时：Run 必须失败（结构化错误 + 建议动作）。

---

**Document Version**: 1.0  
**Created**: 2026-01-30  
**Quality Score**: 65/100
