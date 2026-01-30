# M7：资产台账系统 - 普通用户（user）只读访问 - 产品需求文档（PRD）

> 目标：在不扩大敏感面（凭证/raw/治理操作）的前提下，支持普通用户（user）只读访问资产与运行结果，满足 SRS 的角色模型。

## Requirements Description

### Background

- **现状问题**：当前 API/UI 基本为 admin-only，无法满足“普通用户只读查看”的需求。
- **目标用户**：普通用户（user）、管理员（admin）。
- **价值**：扩大台账可用范围（读权限），同时保持敏感面最小化。

### Scope / Out of Scope

**In Scope**

- user 可访问（只读）：
  - `/assets` 列表与详情（含关系链、来源明细 normalized）
  - `/runs` 列表与详情（含错误码与统计）
- admin-only 保持不变：
  - Source/凭证/调度组管理
  - raw payload 查看
  - 重复中心/合并/自定义字段管理/导出

**Out of Scope**

- 组织/多租户隔离。
- 行级/字段级精细权限（一期仅角色级）。

### Success Metrics

- user 可正常浏览资产与运行结果，且无法通过任何入口获取凭证/raw/治理操作。

## Feature Overview

### Core Requirements

1. **鉴权策略**

- 引入 `requireUser`（或等价）用于只读接口：
  - user/admin 均可通过
- 保持 `requireAdmin` 用于敏感接口：
  - 凭证、raw、治理、导出等

2. **UI 可见性**

- user 登录后：
  - 导航仅展示可用页面
  - 禁用/隐藏 admin-only 操作按钮

## Acceptance Criteria

- [ ] user 可访问 assets/runs 的只读页面与 API（200）。
- [ ] user 访问凭证/来源管理/raw/治理/导出相关 API 返回 403，且 UI 无入口。
- [ ] admin 行为保持不变。

---

**Document Version**: 1.0  
**Created**: 2026-01-30  
**Quality Score**: 60/100
