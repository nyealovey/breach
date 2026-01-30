# M8：资产台账系统 - 自定义字段（台账字段扩展）- 产品需求文档（PRD）

> 目标：支持管理员定义自定义字段（字段定义/停用/作用域/类型），并在资产上维护字段值；满足 SRS 的“可扩展”与“可治理”要求。

## Requirements Description

### Background

- **现状问题**：当前系统仅支持采集字段（canonical/normalized），缺少台账侧自定义字段管理。
- **目标用户**：管理员（admin）；普通用户（user）只读查看字段值（若允许）。
- **价值**：支持业务补录与治理（负责人/系统归属/合规标签等）。

### Scope / Out of Scope

**In Scope**

- 字段定义管理（admin-only）：
  - 新增/停用字段
  - 字段类型：string/int/float/bool/date/datetime/enum/json
  - 字段作用域：vm/host/cluster/全局
- 字段值管理：
  - 资产详情页编辑字段值（admin-only）
  - 资产详情/导出可展示字段值

**Out of Scope**

- 字段级权限（一期不做）。
- 复杂校验（正则/依赖关系）与公式字段。

### Success Metrics

- 管理员可配置字段并为资产赋值；字段停用不丢历史值。

## Acceptance Criteria

- [ ] 管理员可新增字段定义并在资产详情编辑字段值。
- [ ] 字段停用后默认不再可编辑/可见（策略可选），但历史值不物理删除。
- [ ] 普通用户无字段定义管理入口且 403（若启用 user 只读）。

---

**Document Version**: 1.0  
**Created**: 2026-01-30  
**Quality Score**: 55/100
