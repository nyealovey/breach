# 资产台账系统（vCenter MVP）- 产品需求文档（PRD）

> 本 PRD 基于 `docs/requirements/*` 与需求澄清结果生成；若与 SRS/概念模型存在冲突，以本 PRD 的 v1.0 决策为准。

## Requirements Description

### Background

- **Business Problem**：当前资产信息分散在多个系统/平台中，存在重复、口径不一致、难以追溯的问题；需要一个可持续采集、可追溯的资产台账。
- **Target Users**：仅管理员（admin）。
- **Value Proposition**：提供 vCenter 资产（VM/Host/Cluster）的统一台账视图、可追溯来源与采集批次，支持日常盘点与排障定位。

### Feature Overview

#### Core Features（v1.0）

- vCenter Source 管理：创建/编辑/启停（调度/时区自动处理，不做 per-source 配置）。
- vCenter 凭据管理：凭据加密存储；UI 不回显；支持更新。
- Run 管理：每日一次定时采集 + 管理员手动触发；Run 列表与详情（状态、错误、统计、driver、日志摘要）。
- 插件化采集（子进程）：支持 `healthcheck/detect/collect`；支持目标能力探测并选择 driver。
- 资产入账与统一视图：以 `Asset(asset_uuid)` 为统一资产实体；展示 unified fields（带来源证据/冲突标记）与来源明细（normalized）。
- 关系链展示：VM → Host → Cluster（允许缺边）。
- OpenAPI/Swagger：提供 API 规范与可视化文档（作为交付物）。
- 日志系统：结构化 JSON 日志 + “宽事件/Canonical Log Lines”模式，覆盖 Web 请求与后台采集流程。

#### Feature Boundaries

- **In Scope（v1.0）**：`FR-01~FR-05` + Web UI（Source/Run/Asset/关系链）+ OpenAPI/Swagger + 日志系统。
- **Out of Scope（v1.0）**：`FR-06~FR-11`（自定义字段、重复中心/候选、人工合并、导出、历史时间线等）；多来源（仅 vCenter）；旧台账导入；对象存储 raw；备份/恢复方案（暂不纳入验收）。

#### 与 SRS 的差异（v1.0 决策）

- 角色：仅 admin（SRS 中的 user 角色推后）。
- 来源：仅 vCenter（SRS 的多来源推后）。
- raw 存储：raw 统一存 PostgreSQL（jsonb + 分区表），不使用对象存储（SRS/NFR-07 推后）。
- raw 可见性：不提供 UI/API 的 raw 查看/下载入口（仅内部排障）。

### User Scenarios

1. 管理员创建 vCenter Source（仅填写 endpoint/账号密码；其余默认），执行 healthcheck 验证连通性与权限。
2. 管理员手动触发 collect Run，观察 Run 状态流转，查看错误与统计。
3. 管理员在资产列表检索/过滤资产，进入资产详情查看 unified fields（含来源证据/冲突）与 VM→Host→Cluster 关系链。

## Detailed Requirements

### Input/Output

#### 管理员初始化与登录

- 首次启动：从 `.env` 读取管理员初始密码（及用户名/邮箱，若需要），若 DB 中不存在 admin 账号则自动创建并写入 DB。
- 后续启动：不重复创建；管理员可在 UI 修改密码。

#### Web UI（必须）

- Source 管理页：列表/创建/编辑/启停；展示最近一次 Run 状态/时间。（调度/时区自动处理，不做 per-source 配置）
- 凭据管理：仅可设置/更新，不回显明文；更新需审计（事件级别）。
- Run 列表页：按 Source 过滤；展示 `mode`、`trigger_type`、`status`、开始/结束时间、driver、统计摘要。
- Run 详情页：展示 detect 结果、统计、errors/warnings（脱敏）、（可选）插件 stdout/stderr 摘要。
- 资产列表页：分页；支持关键字搜索（至少 `asset_uuid/hostname/external_id`）；支持过滤（至少 `asset_type/status/source_id`）；支持排序（至少 `last_seen_at/display_name`）。
- 资产详情页：
  - unified fields（canonical-v1 结构，含 sources/alternatives/conflict）
  - 关联来源明细（normalized-v1）
  - 关系链：VM→Host→Cluster（允许缺边，需明确展示缺失原因/不可得）

#### API（必须，配套 OpenAPI/Swagger）

- 需覆盖 UI 所需的最小 API：Source/Run/Asset 查询与管理、登录与改密。
- OpenAPI/Swagger 作为交付物：
  - 提供 OpenAPI JSON（例如 `/api/openapi.json`）
  - 提供 Swagger UI（例如 `/api/docs`），建议仅管理员可访问（生产环境）。

#### 插件接口（核心 → 子进程插件；插件 → 核心）

- 契约沿用 `docs/requirements/asset-ledger-collector-reference.md`：
  - 输入：`collector-request-v1`，含 source/config/credential/request(run_id/mode/now)
  - 输出：`collector-response-v1`，含 detect/assets/relations/stats/errors
- v1.0 插件范围：仅 vCenter。
- `mode=collect` 必须保证完整清单：无法保证时必须失败（`errors[]`），不得以 warnings 伪成功。

### User Interaction

#### 创建 Source（vCenter）

- 管理员填写（必填）：endpoint、用户名、密码。
- 管理员填写（可选）：名称（默认可从 endpoint 自动生成）。
- 系统自动处理：启用状态默认启用；调度/时区采用系统默认（每天一次，不做 per-source 配置）。
- 保存后可立即执行 healthcheck（可按钮触发），healthcheck 生成 Run（`mode=healthcheck`）。

#### 触发采集

- 定时触发：每天一次（全局调度；具体时刻/时区由服务端默认值决定，不做 per-source 配置）。
- 手动触发：管理员可对单个 Source 触发。
- 并发策略：同一 Source 同时最多 1 个活动 Run；重复触发需返回当前活动 run_id 并记录审计（`run.trigger_suppressed`）。

### Data Requirements

#### 数据模型（v1.0 最小集合）

- `user`：仅 admin。
- `source` / `run`
- `asset` / `asset_source_link`
- `source_record`：含 `normalized jsonb` + `raw jsonb`（每条一份 raw），永久保留。
- `relation` / `relation_record`：关系边与每次关系 raw 快照。
- `audit_event`：只增不改，永久保留。

#### Raw 与分区策略（v1.0 决策）

- raw 统一存 PostgreSQL（jsonb），永久保留。
- `source_record` / `relation_record` 必须为分区表（按月或等价策略）。
- raw 不提供 UI/API 入口；仅用于内部排障。

#### 数据校验

- 插件输出 `assets[].normalized` 必须满足 `normalized-v1` schema（见 `docs/requirements/asset-ledger-json-schema.md`）。
- 统一视图输出需满足 `canonical-v1` schema。

### Edge Cases

- 插件崩溃/超时：Run 标记 Failed；记录结构化错误与可读摘要（脱敏）。
- 采集不完整：必须 Failed；不得推进 missing/offline/关系失活语义。
- vCenter 能力差异：必须通过 detect + driver 选择体现；不允许静默采集不完整字段。
- 关系缺边：允许 VM 无 Host/Cluster；UI 必须可解释（例如“来源不提供/权限不足/采集失败”等）。

## Design Decisions

### Technical Approach

- 核心应用：Next.js（App Router）+ API（供 UI 与 OpenAPI）。
- 存储：PostgreSQL。
- 采集：以子进程方式调用 vCenter 插件（stdin 输入 JSON，stdout 输出 JSON）。
- 调度：应用内定时任务或等价 worker（每天一次；全局调度配置/固定默认）；需保证单 Source 单飞。

### Key Components

- Source Service（管理 config/credential/enabled；schedule 使用系统默认）
- Run Orchestrator（创建 Run、调用插件、落库、状态机）
- Plugin Runner（子进程执行、超时控制、stdout/stderr 捕获、退出码处理）
- Ingest Pipeline（raw+normalized 落库、schema 校验、统计生成）
- Asset Binder（基于 `asset_source_link` 的持续追踪；生成 unified view）
- Relation Upserter（关系边归并与 last_seen 维护）
- API + OpenAPI（面向 UI 的最小 API + 文档）
- Logging（wide events + 关键域事件日志）

### Data Storage

- 关键表建议索引：
  - `asset_source_link(source_id, external_kind, external_id)` 唯一
  - `run(source_id, status, started_at desc)`
  - `source_record(run_id)`、`source_record(asset_uuid)`、分区键（按月）
  - `relation(relation_type, from_asset_uuid, to_asset_uuid, source_id)` 唯一
- raw 存 jsonb：以 `source_id/run_id/external_kind/external_id` 等字段可快速定位。

### Interface Design

- 插件契约与错误模型沿用 `collector-reference`：`errors[]` 需包含 code/category/message/retryable。
- OpenAPI 必须覆盖所有对外 API（至少 UI 调用的 API）。

### Constraints

#### 性能/可靠性

- 采集 Run 不阻塞 Web 请求：UI 查看应尽量读取 Run 落库结果。
- 同一 Source 单飞，避免并发写入竞态。

#### 安全

- 凭据加密存储；不得出现在 API 响应、页面渲染、日志中。
- 脱敏规则：仅凭证脱敏（其余字段不额外清洗）；但日志与错误信息必须避免意外泄漏凭证。

#### 可观测性（日志系统，必须）

- 结构化 JSON 日志；禁止纯字符串 `console.log`。
- Web 请求采用“宽事件/Canonical Log Line”：每个请求结束时输出一条 context-rich 日志。
- 必须包含的高基数字段（示例）：`request_id`、`user_id`、`source_id`、`run_id`、`asset_uuid`（按场景）。
- 必须包含环境字段（示例）：`service_version`、`commit_sha`、`env`。
- 采集流程需有关键域事件：`run.created`、`run.started`、`run.finished`、`plugin.invoked`、`plugin.failed`、`ingest.completed` 等。

### Risk Assessment

- raw 永久存 PG 会带来容量与性能风险；虽不要求备份恢复，但长期需要容量告警与运维策略。
- vCenter API/权限差异可能导致字段缺失或关系缺边，需要在 UI/日志中可解释。
- 子进程执行的可控性（超时/资源/失败重试策略）需要设计清楚，避免僵尸进程与 Run 卡死。

## Acceptance Criteria

### Functional Acceptance

- [ ] 管理员初始化：首次启动可从 `.env` 创建 admin，并可在 UI 修改密码。
- [ ] FR-01 Source 管理：可创建/编辑/启停 Source；列表展示最近一次 Run 信息。
- [ ] FR-02 Run：支持每日一次定时采集与手动触发；同 Source 单飞 + 触发抑制可审计。
- [ ] FR-03 插件化采集：支持 `healthcheck/detect/collect`；driver 选择可追溯；inventory 不完整必须失败。
- [ ] FR-04 资产统一视图：资产详情包含 unified fields（含来源证据/冲突）与关联来源明细（normalized）。
- [ ] FR-05 关系链：资产详情可展示 VM→Host→Cluster 关系链（允许缺边）。
- [ ] Web UI：Source/凭据/Run 列表与详情/资产列表与详情均可用，权限仅 admin。
- [ ] OpenAPI/Swagger：提供 OpenAPI JSON 与 Swagger UI，并覆盖 UI 所需 API。

### Quality Standards

- [ ] 代码质量：通过 `bun run lint`、`bun run format:check`、`bun run type-check`。
- [ ] 日志：所有 Web 请求有宽事件日志；采集流程有关键域事件日志；日志中不出现任何明文凭证。
- [ ] 数据校验：插件输出 normalized 必须通过 schema 校验；不通过则 Run 失败并记录错误。
- [ ] 数据分区：`source_record` 与 `relation_record` 使用分区表（按月或等价）。

### User Acceptance

- [ ] 管理员能在 UI 完成“配置 Source → healthcheck → 触发采集 → 查看 Run → 浏览资产 → 查看关系链”的闭环。

## Execution Phases

### Phase 1: Preparation

**Goal**：确定 MVP 范围与技术基座

- [ ] 明确 vCenter Source 必填字段仅 endpoint/username/password；其余（名称默认、TLS、调度/时区）自动处理。
- [ ] 设计 DB 最小表结构与分区策略（source_record/relation_record）。
- [ ] 定义 OpenAPI 基础结构与生成/维护方式。
- [ ] 设计日志字段规范（wide events + 采集域事件）。
- **Deliverables**：DB schema 草案、OpenAPI 草案、日志字段规范。
- **Time**：0.5-1 周

### Phase 2: Core Development

**Goal**：实现 FR-01~FR-05 核心链路

- [ ] Source/凭据管理（加密存储、UI 不回显）。
- [ ] Run Orchestrator + 调度（定时/手动/单飞）。
- [ ] vCenter 插件子进程执行与契约对齐（healthcheck/detect/collect）。
- [ ] 入账：asset_source_link 绑定、asset 生成、canonical 聚合、relation upsert。
- [ ] Web UI：Source/Run/Asset 页面与关系链展示。
- **Deliverables**：可跑通端到端闭环。
- **Time**：1-2 周

### Phase 3: Integration & Testing

**Goal**：与真实/模拟 vCenter 联调与稳定性验证

- [ ] 在至少一个 vCenter 环境跑通多次 Run（成功/失败/权限不足/超时）。
- [ ] 验证 schema 校验、错误落库、触发抑制审计、关系链缺边解释。
- [ ] 验证日志：请求宽事件、采集域事件字段完整，且无凭证泄漏。
- **Deliverables**：联调记录、验收清单通过。
- **Time**：0.5-1 周

### Phase 4: Deployment

**Goal**：发布与最小运维

- [ ] 配置 `.env` 的 admin 初始化参数与加密密钥。
- [ ] 上线后首轮 Run 执行与观测（Run 状态、错误、日志）。
- [ ] 容量基线：记录 raw 增长速度与分区策略可用性。
- **Deliverables**：上线手册（最小）、容量基线。
- **Time**：0.5 周

---

**Document Version**: 1.0
**Created**: 2026-01-26T08:06:58Z
**Clarification Rounds**: 3
**Quality Score**: 97/100
