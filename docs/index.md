# 资产台账文档总览（为什么既有 PRD 又有 SRS）

本仓库把“需求”拆成两层：**SRS（系统级需求规格）** + **PRD（迭代/专题级产品需求）**。

这样做的原因：同一产品在不同阶段会有不同的范围（MVP/增强/重构），如果只维护一份需求文档，容易把“全量远期目标”和“当期可交付范围”混在一起，导致实现与验收不断跑偏。

## 1) 文档分层与定位

### `docs/requirements/`：SRS（System Requirements Specification）

定位：系统级“必须做什么/不做什么/做到什么程度”的合同。

- 面向：产品/研发/测试/运维/评审
- 内容：FR/NFR、术语表、角色权限、可验收条款
- 特点：覆盖面更全、更稳定；尽量不写“怎么做”

当前：`docs/requirements/asset-ledger-srs.md`

### `docs/prds/`：PRD（Product Requirements Document）

定位：某个迭代或专题（例如 vCenter MVP）的“当期范围 + 决策 + 验收闭环”。

- 面向：交付/实现团队（让当期目标不含糊）
- 内容：In/Out of scope、关键决策、最小可用闭环、与 SRS 的差异声明
- 特点：可以比 SRS 更“窄”，并明确“哪些 SRS 条款本迭代不验收”

当前：

- `docs/prds/asset-ledger-v1.0-prd.md`（vCenter MVP）
- `docs/prds/asset-ledger-host-field-model-v1.0-prd.md`（Host 字段模型专题）

### `docs/design/`：设计文档（Design）

定位：承载“怎么做”的技术方案（架构/数据模型落库细化/实现策略/库选型）。

- 设计应引用 PRD/SRS，不重复定义需求

### `docs/plans/`：计划（Plan）

定位：实现任务拆分与执行步骤（偏工程过程）。

## 2) 优先级规则（发生冲突时谁说了算）

一般规则：

1. 当期 PRD（`docs/prds/...`）
2. SRS（`docs/requirements/...`）
3. Design（`docs/design/...`，仅解释“怎么做”，不应推翻 PRD/SRS）

示例（vCenter MVP v1.0）：

- PRD 明确 v1.0 不提供 raw 的 UI/API 入口（仅内部排障），因此 SRS 中关于 raw 可下载/下载审计的条款对 v1.0 不作为验收项。

## 3) 维护建议（避免重复与漂移）

- 新增“全局性需求”（角色/权限/长期保留/FR/NFR）优先改 SRS。
- 新增“当期迭代范围/关键取舍”优先改 PRD，并在 PRD 中写清与 SRS 的差异。
- 设计文档只写实现方案与可选方案对比，不引入新的需求口径；若必须新增需求口径，先回写 PRD/SRS。
