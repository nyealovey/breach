# 资产台账系统（vCenter MVP）- 产品需求文档（PRD）

> 本 PRD 仅用于描述 vCenter MVP 的范围与验收；完整需求口径请以 `docs/requirements/asset-ledger-srs.md` 为准。

## Requirements Description

### Background

- **Business Problem**：当前资产信息分散在多个系统/平台中，存在重复、口径不一致、难以追溯的问题；需要一个可持续采集、可追溯的资产台账。
- **Target Users**：仅管理员（admin）。
- **Value Proposition**：提供 vCenter 资产（VM/Host/Cluster）的统一台账视图、可追溯来源与采集批次，支持日常盘点与排障定位。

### Feature Overview

#### Core Features（v1.0）

- 调度组（采集任务）管理：创建/编辑/启停；配置时区 + 固定触发时间（`HH:mm`）；Source 绑定调度组；错过触发点不补跑。
- vCenter Source 管理：创建/编辑/启停/删除（软删除）；绑定调度组。
- vCenter 凭据管理：凭据加密存储；UI 不回显；支持更新。
- Run 管理：每日一次定时采集 + 管理员手动触发；Run 列表与详情（状态、错误、统计、driver、日志摘要）。
- 插件化采集（子进程）：支持 `healthcheck/detect/collect`；支持目标能力探测并选择 driver。
- 资产入账与统一视图：以 `Asset(asset_uuid)` 为统一资产实体；展示 unified fields（带来源证据/冲突标记）与来源明细（normalized）。
- 关系链展示：VM → Host → Cluster（允许缺边）。
- OpenAPI/Swagger：提供 API 规范与可视化文档（作为交付物；OpenAPI 由 Zod schema 生成，避免手写漂移）。
- 日志系统：结构化 JSON 日志 + “宽事件/Canonical Log Lines”模式，覆盖 Web 请求与后台采集流程（字段规范见 `docs/design/asset-ledger-logging-spec.md`）。

#### Feature Boundaries

- **In Scope（v1.0）**：`FR-01~FR-05` + Web UI（Source/Run/Asset/关系链）+ OpenAPI/Swagger + 日志系统。
- **Out of Scope（v1.0）**：`FR-06~FR-11`（自定义字段、重复中心/候选、人工合并、导出、历史时间线等）；多来源（仅 vCenter）；旧台账导入；对象存储 raw；备份/恢复方案（暂不纳入验收）。

### User Scenarios

1. 管理员创建调度组（配置时区 + 固定触发时间），并创建 vCenter Source 绑定到该调度组；执行 healthcheck 验证连通性与权限。
2. 管理员手动触发 collect Run，观察 Run 状态流转，查看错误与统计。
3. 到达调度组触发点时系统自动创建定时 Run；管理员查看 Run 列表与资产列表。
4. 管理员在资产列表检索/过滤资产，进入资产详情查看 unified fields（含来源证据/冲突）与 VM→Host→Cluster 关系链。

## Detailed Requirements

### Input/Output

#### 管理员初始化与登录

- 首次启动：若 DB 中不存在管理员账号，则使用环境变量 `ASSET_LEDGER_ADMIN_PASSWORD` 创建默认管理员账号（用户名固定为 `admin`）。
  - 若 `ASSET_LEDGER_ADMIN_PASSWORD` 未设置/为空：服务启动必须失败并给出可读错误（避免产生默认弱口令）。
- 后续启动：若 admin 已存在，则不再读取 `ASSET_LEDGER_ADMIN_PASSWORD`；管理员可在 UI 修改密码。
- 认证方式（v1.0）：使用 session（HttpOnly Cookie）维持登录态；`SECRET_KEY` 用于会话签名；v1.0 不使用 JWT（`JWT_SECRET_KEY` 预留给后续迭代）。

#### Web UI（必须）

- 调度组管理页：列表/创建/编辑/启停；配置时区 + 触发时间（`HH:mm`）；展示该组下 Source 数量。
- Source 管理页：列表/创建/编辑/启停；绑定调度组；展示最近一次 Run 状态/时间。
- 凭据管理：仅可设置/更新，不回显明文；更新需审计（事件级别）。
- Run 列表页：按 Source 过滤；展示 `mode`、`trigger_type`、`status`、开始/结束时间、driver、统计摘要。
- Run 详情页：展示 detect 结果、统计、errors/warnings（脱敏）、（可选）插件 stdout/stderr 摘要。
- 资产列表页：分页；支持关键字搜索（至少 `asset_uuid/hostname/external_id`）；支持过滤（至少 `asset_type/source_id`）；支持排序（至少 `display_name`）。
- 资产详情页：
  - unified fields（canonical-v1 结构，含 sources/alternatives/conflict）
  - 关联来源明细（normalized-v1）
  - 关系链：VM→Host→Cluster（允许缺边，需明确展示缺失原因/不可得）

#### API（必须，配套 OpenAPI/Swagger）

- 需覆盖 UI 所需的最小 API：Source/Run/Asset 查询与管理、登录与改密。
- OpenAPI/Swagger 作为交付物：
  - OpenAPI JSON 由 Zod schema 生成（单一真相），避免实现与文档漂移。
  - 提供 OpenAPI JSON（例如 `/api/openapi.json`）
  - 提供 Swagger UI（例如 `/api/docs`），建议仅管理员可访问（生产环境）。

#### 插件接口（核心 → 子进程插件；插件 → 核心）

- 契约沿用 `docs/design/asset-ledger-collector-reference.md`：
  - 输入：`collector-request-v1`，含 source/config/credential/request(run_id/mode/now)
  - 输出：`collector-response-v1`，含 detect/assets/relations/stats/errors
- v1.0 插件范围：仅 vCenter。
- `mode=collect` 必须保证完整清单：无法保证时必须失败（`errors[]`），不得以 warnings 伪成功。

### User Interaction

#### 创建 Source（vCenter）

- 管理员填写（必填）：endpoint、用户名、密码。
- endpoint 输入：支持填写 `https://<host>`（系统内部可自行规范化为实际 SDK endpoint）；允许自签名证书（内部自行处理，不要求额外配置项）。
- 管理员填写（可选）：名称（默认可从 endpoint 自动生成）。
- 管理员选择：绑定到某个调度组（该组决定时区与触发时间）。
- 系统自动处理：启用状态默认启用。
- 采集范围：v1.0 默认全量采集；预留 scope 能力但不在 v1.0 验收范围内。
- 保存后可立即执行 healthcheck（可按钮触发），healthcheck 生成 Run（`mode=healthcheck`）。

#### 触发采集

- 定时触发：按调度组配置的固定触发时间（`HH:mm`，按调度组 `timezone` 解释）创建 Run；允许存在 ≤ scheduler tick 间隔的触发延迟；若服务在触发点宕机/停止，错过的触发点不补跑。
  - **Scheduler Tick 配置**：环境变量 `ASSET_LEDGER_SCHEDULER_TICK_MS`，默认值 `30000`（30 秒），可配置范围 `10000~120000`（10 秒~2 分钟）；tick 间隔越小触发越精准，但 CPU 开销越高。
- 手动触发：管理员可对单个 Source 触发。
- 并发策略：同一 Source 同时最多 1 个活动 Run；重复触发需返回当前活动 run_id 并记录审计（`run.trigger_suppressed`）。

### Data Requirements

#### 数据模型（v1.0 最小集合）

- `user`：仅 admin。
- `schedule_group`：调度组（采集任务）。
- `source` / `run`
- `asset` / `asset_source_link`
- `source_record`：含 `normalized`（schema 校验）+ `raw`（每条一份 raw，永久保留）。
- `relation` / `relation_record`：关系边与每次关系 raw 快照。
- `audit_event`：只增不改，永久保留。

#### 数据校验

- 插件输出 `assets[].normalized` 必须满足 `normalized-v1` schema（见 `docs/design/asset-ledger-json-schema.md`）。
- 统一视图输出需满足 `canonical-v1` schema。

### Edge Cases

- 插件崩溃/超时：Run 标记 Failed；记录结构化错误与可读摘要（脱敏）。
- 采集不完整：必须 Failed；失败 Run 仅用于排障证据沉淀，不得影响 v1.0 的资产展示口径（v1.0 不实现 FR-09/下线语义）。
- vCenter 能力差异：必须通过 detect + driver 选择体现；不允许静默采集不完整字段。
- 关系缺边：允许 VM 无 Host/Cluster；UI 必须可解释（例如“来源不提供/权限不足/采集失败”等）。

## 技术设计（另附）

为避免“需求/设计”混写，本 PRD 不再包含实现方式、库选型、索引/分区等技术细节；对应的技术设计与选型建议见：`docs/design/asset-ledger-vcenter-mvp-design.md`。

## Acceptance Criteria

### Functional Acceptance

- [ ] 管理员初始化：首次启动可使用 `ASSET_LEDGER_ADMIN_PASSWORD` 初始化默认管理员（用户名 `admin`），并可在 UI 修改密码。
- [ ] FR-01 Source 管理：可创建/编辑/启停/删除（软删除） Source；列表展示最近一次 Run 信息。
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
- [ ] 数据分区：`source_record` 与 `relation_record` 使用按月分区表。

### Test Strategy

#### 单元测试

- **覆盖率目标**：≥ 80%（核心业务逻辑）
- **框架**：Vitest
- **重点覆盖**：
  - [ ] Schema 校验（normalized-v1/canonical-v1）
  - [ ] 时区计算与 DST 处理
  - [ ] 凭证加密/解密
  - [ ] 错误码映射与脱敏

#### 集成测试

- **框架**：Vitest + Prisma Test Environment
- **重点覆盖**：
  - [ ] Source CRUD + 凭证更新
  - [ ] Run 状态机流转
  - [ ] 资产入账与 asset_source_link 绑定
  - [ ] 关系边 upsert

#### E2E 测试

- **框架**：Playwright
- **场景覆盖**：
  - [ ] 管理员登录 → 创建调度组 → 创建 Source → healthcheck
  - [ ] 手动触发 collect → Run 状态流转 → 查看 Run 详情
  - [ ] 资产列表搜索/过滤 → 资产详情 → 关系链展示
  - [ ] 冲突字段展示 → 来源明细对比
  - [ ] 修改密码 → 重新登录

#### 性能测试

- **工具**：k6 或 Artillery
- **场景**：
  - [ ] 10 并发用户访问资产列表（10,000 资产）
  - [ ] 5 个 Source 并发采集
  - [ ] API P95 响应时间验证

### User Acceptance

- [ ] 管理员能在 UI 完成“配置 Source → healthcheck → 触发采集 → 查看 Run → 浏览资产 → 查看关系链”的闭环。

## Execution Phases

### Phase 1: Preparation

**Goal**：确定 MVP 范围与技术基座

- [ ] 明确 vCenter Source 必填字段仅 endpoint/username/password + 调度组；其余（名称默认、TLS 等）自动处理。
- [ ] 明确调度组能力：可配置时区 + 固定触发时间（HH:mm），Source 绑定调度组；错过触发点不补跑。
- [ ] 设计 DB 最小表结构与分区策略（source_record/relation_record）。
- [ ] 定义 OpenAPI 基础结构与生成/维护方式（Zod 生成）。
- [ ] 设计日志字段规范（wide events + 采集域事件，见 `docs/design/asset-ledger-logging-spec.md`）。
- **Deliverables**：DB schema 草案、OpenAPI 草案、日志字段规范。
- **Time**：0.5-1 周

### Phase 2: Core Development

**Goal**：实现 FR-01~FR-05 核心链路

- [ ] Source/凭据管理（加密存储、UI 不回显）。
- [ ] 调度组管理 + 调度器（按组定时触发、错过不补跑）+ Run Orchestrator（定时/手动/单飞）。
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

- [ ] 配置环境变量：`ASSET_LEDGER_ADMIN_PASSWORD`、`PASSWORD_ENCRYPTION_KEY`、`SECRET_KEY`（可选 `JWT_SECRET_KEY`），见 `README.md`。
- [ ] 上线后首轮 Run 执行与观测（Run 状态、错误、日志）。
- [ ] 容量基线：记录 raw 增长速度与分区策略可用性。
- **Deliverables**：上线手册（最小）、容量基线。
- **Time**：0.5 周

---

**Document Version**: 1.0
**Created**: 2026-01-26T08:06:58Z
**Clarification Rounds**: 3
**Quality Score**: 97/100
