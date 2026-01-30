# M8：资产台账系统 - 导出全量台账（CSV）- 产品需求文档（PRD）

> 目标：支持管理员导出全量台账 CSV，用于盘点与离线分析；导出需权限受控并写入审计。

## Requirements Description

### Background

- **现状问题**：缺少导出能力，盘点需要手工抄录或直连 DB，不可控。
- **目标用户**：管理员（admin）。
- **价值**：支持离线盘点、审计留档与跨系统对账。

### Scope / Out of Scope

**In Scope**

- 导出入口（admin-only）：
  - 发起导出任务（可同步/异步，按规模决定）
  - 下载 CSV 文件
  - 导出动作审计（谁、何时、导出范围/参数）
- 导出字段（最小集合）：
  - `asset_uuid`、`asset_type`、`status`、`display_name`、`last_seen_at`、来源摘要（source_id/source_type）

**Out of Scope**

- 大规模报表系统与自助分析。
- 导出格式多样化（JSON/XLSX）。

### Success Metrics

- 管理员可在 UI 完成导出并下载；普通用户无入口且 403。

## Acceptance Criteria

- [ ] 管理员可导出全量台账 CSV 并下载成功。
- [ ] 导出动作写入审计事件（含 requestId/操作者/参数摘要）。
- [ ] 普通用户无入口且访问导出 API 返回 403。

---

**Document Version**: 1.0  
**Created**: 2026-01-30  
**Quality Score**: 55/100
