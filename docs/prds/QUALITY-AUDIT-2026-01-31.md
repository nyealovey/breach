# docs/prds 需求质量审计（2026-01-31）

范围：本报告审计 `docs/prds/` 下的全部 PRD（含已废弃文档），以便用统一口径将每份 PRD 的 `Quality Score` 推升到 **100/100**。

## 评分口径（100 分制）

以 `requirements-clarity` 的四象限 rubric 为主，并结合本仓库 PRD 模板做“结构化补齐”：

**Functional Clarity（30）**

- 输入/输出与数据落点清晰（字段/schema/API 契约）
- 用户交互清晰（页面/流程/权限差异）
- 成功标准清晰（Success Metrics + 可勾选验收条款）

**Technical Specificity（25）**

- 技术方案/组件边界清晰（服务端/前端/插件/异步任务）
- 集成点清晰（依赖的 schema、API、设计文档、Run 口径）
- 约束清晰（性能/兼容/权限/安全/数据保留）

**Implementation Completeness（25）**

- 边界条件清晰（缺失/空状态/best-effort vs fail-fast）
- 错误处理清晰（稳定错误码、retryable、建议动作）
- 校验清晰（schema 校验 + 业务校验）

**Business Context（20）**

- 问题陈述清晰（现状问题与要解决的痛点）
- 目标用户清晰（admin/user/运维/审计等）
- 成功指标清晰（可验收/可度量）

> 本仓库的“100/100”还要求：PRD 必须具备并实质填写以下章节：
>
> - Requirements Description（Background/Scope/Success Metrics）
> - Feature Overview
> - Detailed Requirements
> - Design Decisions（Technical Approach/Constraints/Risk Assessment）
> - Acceptance Criteria（Functional + Quality + Security/Perf where applicable）
> - Execution Phases

## Scorecard（现状：已达 100/100）

> 说明：此处“现有分”来自各 PRD 文末的 `Quality Score` 字段（不是本报告重新打分的结果）。

| PRD | 状态 | 现有分 | 备注 |
|---|---|---:|---|
| `docs/prds/M1-asset-ledger-vcenter-6.5-compat-v1.0-prd.md` | active | 100 | 已补齐 Design Decisions/Risk、错误码同步项与可执行回归清单 |
| `docs/prds/M2-asset-ledger-collector-optimizations-v1.0-prd.md` | active | 100 | 已补齐一致性口径（list vs sum）、性能/风险与回归 |
| `docs/prds/M3-asset-ledger-ui-optimizations-v1.0-prd.md` | active | 100 | 已落地到 API/DB/边界条件级别，并补齐风险与验收 |
| `docs/prds/M3-asset-ledger-runs-ui-optimizations-v1.0-prd.md` | active | 100 | 已固化 Top error.code 映射、兜底、脱敏白名单与组件复用策略 |
| `docs/prds/M4-asset-ledger-hyperv-collector-v1.0-prd.md` | active | 100 | 已明确远程协议接入、最小权限、字段/关系落点与失败口径 |
| `docs/prds/M5-asset-ledger-duplicate-center-v1.0-prd.md` | active | 100 | 无 |
| `docs/prds/M5-asset-ledger-asset-merge-v1.0-prd.md` | active | 100 | 无 |
| `docs/prds/M6-asset-ledger-pve-5-8-compat-v1.0-prd.md` | active | 100 | 已补齐 config/权限/兼容矩阵/错误码与回归 |
| `docs/prds/M7-asset-ledger-user-readonly-access-v1.0-prd.md` | active | 100 | 已补齐 API/UI 权限矩阵、敏感面红线与越权验收 |
| `docs/prds/M8-asset-ledger-ledger-fields-closed-loop-v1.0-prd.md` | active | 100 | 已补齐 DB schema/索引/校验/API 与风险 |
| `docs/prds/M8-asset-ledger-export-csv-v1.0-prd.md` | active | 100 | 无 |
| `docs/prds/M10-asset-ledger-windows-physical-collector-v1.0-prd.md` | active | 100 | 已按“远程协议优先 + 未来可扩展第二方式”补齐 WinRM 口径与权限/错误码/回归 |
| `docs/prds/M10-asset-ledger-linux-physical-collector-v1.0-prd.md` | active | 100 | 已按 SSH 口径补齐权限/错误码/回归与缺失策略 |
| `docs/prds/M11-asset-ledger-aliyun-collector-v1.0-prd.md` | active | 100 | 已补齐 regions/分页/限流/最小 RAM 权限/错误码与回归 |
| `docs/prds/M12-asset-ledger-asset-history-v1.0-prd.md` | active | 100 | 已按“按资产事件时间线（仅变化事件）”口径对齐 |

## 本轮共性改进（已完成）

1. 全量补齐 `Design Decisions / Constraints / Risk Assessment`，让实现侧“怎么做/怎么验收/怎么回滚”有统一口径。
2. 采集类 PRD 全量补齐“最小权限集 + failure strategy（warning vs fail-fast）+ 回归清单 + 错误码”。
3. 权限/治理/导出类 PRD 全量补齐“接口/页面白名单 + 越权用例 + 审计事件枚举”。
4. UI/历史/导出类 PRD 补齐性能与边界条件（分页/数据量阈值/脱敏白名单/兜底策略）。

## 已删除的历史 PRD（不再纳入评分推进）

按最新决策：`deprecated` PRD 不保留在仓库内，已于 **2026-01-31** 删除：

- M8（旧）：自定义字段定义（可新增/停用）
- M9（旧）：批量编辑自定义字段（已并入 M8 闭环）

## Round 1 已确认的全局口径（2026-01-31）

1. `deprecated` PRD 不保留：直接删除（用 git history 追溯）。
2. 采集接入：优先 **远程协议**；允许同一类 Source 未来同时支持“两种方式”（仍以插件形式）。
3. M12 方向调整：不按 Run 展示，改为按 **资产维度** 的历史。

## Round 2 已确认的口径（2026-01-31）

1. M12 时间线事件集合包含：
   - 采集导致的字段变化/关系变化事件
   - 台账字段审计事件
   - 治理事件：合并、下线/恢复
2. M12 **仅展示变化事件**：不展示“采集成功但无变化”的事件（并同步约束资产侧采集事件展示口径）。
3. 合并后的历史口径：当资产 B 合并进 A 后，A 的历史 **默认合并展示** B 的历史（并标注来源）。
