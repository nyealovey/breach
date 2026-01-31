# M3：资产台账系统 - UI 优化（/runs：失败可定位（错误码 + 建议动作））- 产品需求文档（PRD）

> 目标：优先提升 `/runs` 列表与详情页的“失败可定位”能力——把结构化错误（error.code/message/retryable/redacted_context）以统一口径呈现，并提供可执行的建议动作。
>
> 说明：
>
> - 本 PRD 仅覆盖 **A：错误码 → 可读原因 + 建议动作**；统计展示与 raw 入口不在本期范围。
> - raw payload 仍仅在资产详情页按 SourceRecord 查看（admin-only），不在 `/runs` 增加入口。

## Requirements Description

### Background

- **现状问题**：
  - `/runs` 详情目前以 JSON 方式展示 `errors/warnings`，排障需要“读结构/猜原因”，缺少行动建议。
  - 不同错误码在 UI 上缺少统一文案与“下一步怎么办”的口径，导致排障成本高。
- **目标用户**：管理员（admin），值班/运维同学。
- **价值**：Run 失败后，用户无需翻日志即可：
  - 知道“为什么失败”（可读原因）
  - 知道“下一步做什么”（建议动作）

### Scope / Out of Scope

**In Scope**

- `/runs` 列表页：每条 Run 展示“失败摘要”（首要 error.code + 简短原因）。
- `/runs/[id]` 详情页：
  - 结构化展示 errors/warnings（按错误码分组/首要错误突出）
  - 展示 `retryable` 与建议动作（如：检查凭证/检查网络/调整版本范围/重新触发 healthcheck）

**Out of Scope**

- 从 `/runs` 直接打开 raw payload 的入口（仍仅资产详情可看 raw）。
- 统计图表/趋势分析（错误码分布、耗时分位数等）。
- 自动重试/一键修复（仅给建议，不做自动化）。

### Success Metrics

- “Run 失败 → 定位原因”平均耗时显著下降（以用户反馈为准）。
- 同类错误码的处理口径一致（同一 error.code 在不同页面展示一致）。

## Feature Overview

### Core Requirements

1. **错误摘要（列表可读）**

- `/runs` 列表中，Failed 的 Run 必须展示：
  - `primary_error.code`
  - `primary_error.message`（可读短句）
  - `primary_error.retryable`

2. **建议动作（可执行）**

- UI 必须为常见错误码提供“建议动作”：
  - 以 **error.code** 为主键映射（不依赖 message 文本匹配）。
  - 建议动作至少包含 1~3 条可执行步骤（例如：去 Sources 页面检查 endpoint/凭证、先 healthcheck、调整版本范围等）。

3. **展示一致性**

- 错误展示形式遵循 `docs/design/asset-ledger-ui-spec.md` 的约定（Toast/Modal/Banner/内联）。
- 错误码含义与枚举遵循 `docs/design/asset-ledger-error-codes.md`。

## Detailed Requirements

### 1) 错误摘要规则

- `primary_error` 选择规则：
  - 优先取 `errors[0]`（若存在）
  - 若 errors 为空但 status=Failed：展示 `errorSummary`（若有）并提示“缺少结构化 errors”（视为实现缺陷）

### 2) 建议动作映射（建议实现方式）

- 建议在 UI 层维护一个 `Record<ErrorCode, SuggestedAction[]>` 映射表：
  - `SuggestedAction = { title: string; steps: string[]; links?: { label: string; href: string }[] }`
- 映射表需覆盖至少以下类别：
  - 认证/权限（AUTH*\* / VCENTER_AUTH*_ / CONFIG*CREDENTIAL*_）
  - 网络连通（_*NETWORK*_ / \*\_TIMEOUT）
  - 版本/能力不兼容（例如 vCenter 版本范围不匹配）
  - schema 校验失败（SCHEMA_VALIDATION_FAILED）

### 3) /runs 列表展示（可扫描、可筛查）

列表每条 Run（最小展示列）：

- `status`（Succeeded/Failed/Running/Queued）
- `source.name` + `source.source_type`
- `mode`（collect/detect/healthcheck/collect_hosts/collect_vms）
- `startedAt/finishedAt/duration`
- `primary_error.code`（仅 Failed）
- `primary_error_title`（由映射表给出）
- `retryable`（仅 Failed）

交互：

- 点击 Run 进入详情页
- 对 Failed 行可在行内展开“建议动作（1 行摘要）”，避免必须进详情页

### 4) /runs/[id] 详情展示（结构化 + 可执行）

#### 4.1 errors/warnings 展示结构

- 顶部摘要：
  - 状态、来源、mode、时间、driver（若有 `detect_result.driver`）、`inventory_complete`（若有 `stats.inventory_complete`）
  - 主错误：code + 标题 + message（脱敏）
  - retryable 标识与建议动作（steps）
- 详细区块（折叠）：
  - `errors[]` 列表（按出现顺序；支持按 `code` 分组折叠）
  - `warnings[]` 列表（按出现顺序；默认折叠）
  - `redacted_context`（仅展示白名单字段；见 5.2）

#### 4.2 建议动作内容规范（可验收）

每个建议动作必须满足：

- `title`：一句话概括（例如“检查凭证配置”“检查网络连通性”“调整 vCenter 版本范围”）
- `steps[]`：1~3 条可执行步骤（动词开头），避免“请检查一下”这种空话
- `links[]`（可选）：指向系统内页面或文档（例如 Sources、相关 PRD、SRS）

### 5) 边界条件与安全

#### 5.1 未知/未注册 error.code 的兜底

- 若 `error.code` 不在映射表：
  - 标题：`未知错误（{code}）`
  - 建议动作：提供通用步骤（查看 message；检查网络/权限/配置；必要时联系管理员）
  - 仍展示 `message` 与安全的 `redacted_context`

#### 5.2 redacted_context 展示白名单（防泄露）

> 仅展示“不会扩大敏感面”的字段；其余字段即使存在也不展示（避免插件/后端误填泄露）。

允许展示的 key（建议最小集）：

- `source_id` / `run_id` / `mode`
- `http_status` / `endpoint_path`（仅 path，不展示 host/URL）
- `trace_id`
- `stderr_excerpt`（必须截断，且不得包含凭证/Token/AK/SK）
- `missing_capability`

禁止展示：

- endpoint host/URL、账号、密钥、密码、Token、AK/SK、明文输出的命令参数等

## Design Decisions

### Technical Approach

- 错误展示与建议动作采用“error.code 为主键”的稳定映射：
  - 映射表与 `docs/design/asset-ledger-error-codes.md` 对齐（只增不改）
  - 任何 UI 文案变化不影响错误码统计与排障聚合
- 组件复用：
  - 列表行内摘要、详情页主错误、错误列表使用同一套 `RunErrorPanel`/`ErrorBadge` 组件，避免多处口径漂移
- i18n 策略：
  - 默认中文；结构化字段（code/category/retryable）不翻译
  - 可选为 `SuggestedAction` 预留英文文案字段（不作为一期交付）

### Constraints

- 不新增 raw 入口；不展示插件 stdout/stderr 全量日志（仅允许展示受控的 `redacted_context` 摘要）。
- 本期不做错误码分布统计、趋势图与告警订阅。

### Risk Assessment

- **错误码覆盖不足导致“建议动作”价值打折**：缓解：先覆盖 Top error.code（见下方 Execution Phase 1），并在后续 PRD（新插件）迭代时同步补齐映射。
- **信息泄露风险**：插件或后端可能误把敏感信息放到 message/context。缓解：前端展示白名单 + 截断；后端/插件侧继续承担脱敏责任。
- **主错误选择不准**：errors 顺序若不稳定会误导用户。缓解：后端/插件约定“最重要错误放 errors[0]”；前端允许用户查看完整 errors 列表。

## Acceptance Criteria

### Functional Acceptance

- [ ] `/runs` 列表页：Failed 的 Run 可直接看到 error.code 与简短原因。
- [ ] `/runs/[id]` 详情页：errors/warnings 可读展示，并对主错误提供建议动作清单。
- [ ] 建议动作以 error.code 映射实现，不依赖 message 文本匹配。
- [ ] 不新增从 `/runs` 直接打开 raw 的入口。
- [ ] 未知 error.code 有兜底展示（标题 + 通用建议动作），且不影响页面可用性。
- [ ] `redacted_context` 仅展示白名单字段（不得出现 endpoint host/URL、账号、密钥、密码、Token、AK/SK）。

### Quality Standards

- [ ] 文档同步：在 `docs/roadmap.md` 标记本 PRD 已创建，并补充实现依赖（若新增错误码映射表/组件）。
- [ ] 建议动作映射表必须与 `docs/design/asset-ledger-error-codes.md` 同步演进（新增错误码必须补齐映射或明确兜底策略）。

## Test Scenarios

### 正向场景（Happy Path）

| 场景 ID | 场景描述 | 前置条件 | 操作步骤 | 期望结果 |
|---------|----------|----------|----------|----------|
| T3R-01 | 列表展示失败摘要 | 存在 Failed 状态的 Run | 访问 `/runs` | Failed Run 行展示 `error.code`、简短原因、`retryable` 标识 |
| T3R-02 | 详情展示建议动作 | Failed Run 的 error.code 在映射表中 | 访问 `/runs/[id]` | 展示主错误 + 建议动作清单（title + steps） |
| T3R-03 | 行内展开建议动作 | 同上 | 在列表页点击 Failed 行展开 | 可在行内看到建议动作摘要（1 行） |
| T3R-04 | errors/warnings 分组展示 | Run 有多个 errors/warnings | 访问 `/runs/[id]` | errors 按 code 分组折叠；warnings 默认折叠 |

### 异常场景（Error Path）

| 场景 ID | 场景描述 | 前置条件 | 操作步骤 | 期望行为 |
|---------|----------|----------|----------|----------|
| T3R-E01 | 未知 error.code 兜底 | error.code 不在映射表中 | 访问 `/runs/[id]` | 标题显示"未知错误（{code}）"；展示通用建议动作；页面不崩溃 |
| T3R-E02 | errors 为空但 Failed | Run status=Failed 但 errors=[] | 访问 `/runs/[id]` | 展示 `errorSummary`（若有）；提示"缺少结构化 errors" |

### 边界场景（Edge Case）

| 场景 ID | 场景描述 | 前置条件 | 操作步骤 | 期望行为 |
|---------|----------|----------|----------|----------|
| T3R-B01 | redacted_context 脱敏 | error 包含 `redacted_context` | 访问 `/runs/[id]` | 仅展示白名单字段；不展示 endpoint host/URL/账号/密钥 |
| T3R-B02 | 大量 errors（>20） | Run 有 20+ errors | 访问 `/runs/[id]` | 支持折叠/分页展示；不卡顿 |

### 安全场景（Security）

| 场景 ID | 场景描述 | 前置条件 | 操作步骤 | 期望行为 |
|---------|----------|----------|----------|----------|
| T3R-S01 | 敏感信息不泄露 | error.message 或 context 误含敏感信息 | 访问 `/runs/[id]` | 前端仅展示白名单字段；敏感信息被过滤 |

## Dependencies

| 依赖项 | 依赖类型 | 说明 |
|--------|----------|------|
| 错误码注册表 | 硬依赖 | 映射表需与 `docs/design/asset-ledger-error-codes.md` 对齐 |
| UI 组件库 | 软依赖 | `RunErrorPanel`/`ErrorBadge` 组件需统一设计 |
| 后端 errors 输出规范 | 硬依赖 | 后端/插件需保证 `errors[0]` 为最重要错误 |

## Observability

### 关键指标

| 指标名 | 类型 | 说明 | 告警阈值 |
|--------|------|------|----------|
| `runs_ui_unknown_error_code_count` | Counter | 未知 error.code 出现次数 | > 10/天 触发告警（需补齐映射） |
| `runs_ui_error_display_latency_p95` | Histogram | 错误详情页加载耗时 p95 | > 2s 触发告警 |

### 日志事件

| 事件类型 | 触发条件 | 日志级别 | 包含字段 |
|----------|----------|----------|----------|
| `runs_ui.unknown_error_code` | 遇到未映射的 error.code | WARN | `error_code`, `run_id` |
| `runs_ui.sensitive_field_filtered` | 过滤了敏感字段 | INFO | `run_id`, `filtered_keys` |

## Error Code Mapping Table (Minimum Viable)

> 以下为一期必须覆盖的错误码映射，后续新增错误码需同步补齐。

| error.code | 标题 | 建议动作 |
|------------|------|----------|
| `AUTH_UNAUTHORIZED` | 认证失败 | 1. 检查凭证是否正确；2. 检查凭证是否过期；3. 重新配置凭证后重试 |
| `AUTH_FORBIDDEN` | 权限不足 | 1. 检查账号是否具备所需权限；2. 联系管理员授权 |
| `CONFIG_CREDENTIAL_NOT_FOUND` | 凭证未配置 | 1. 前往 Sources 页面配置凭证；2. 配置完成后重新触发采集 |
| `VCENTER_AUTH_FAILED` | vCenter 认证失败 | 1. 检查 vCenter 账号密码；2. 检查账号是否被锁定；3. 检查 vCenter 服务状态 |
| `VCENTER_API_VERSION_UNSUPPORTED` | vCenter 版本不兼容 | 1. 检查 Source 配置的版本范围；2. 调整为匹配的版本范围；3. 若版本过旧，考虑升级 vCenter |
| `PLUGIN_EXECUTION_FAILED` | 插件执行失败 | 1. 查看 Run 详情中的错误信息；2. 检查插件日志；3. 联系管理员排查 |
| `SCHEMA_VALIDATION_FAILED` | 数据格式校验失败 | 1. 检查插件输出是否符合 schema；2. 联系插件开发者修复 |
| `INVENTORY_INCOMPLETE` | 资产清单不完整 | 1. 检查网络连通性；2. 检查权限是否足够枚举所有资产；3. 重试采集 |
| `INVENTORY_RELATIONS_EMPTY` | 关系链为空 | 1. 检查权限是否足够获取关系字段；2. 检查目标环境是否有关系数据 |
| `*_NETWORK_ERROR` | 网络错误 | 1. 检查网络连通性；2. 检查防火墙规则；3. 稍后重试 |
| `*_TIMEOUT` | 请求超时 | 1. 检查目标服务状态；2. 检查网络延迟；3. 稍后重试 |

## Execution Phases

### Phase 1: 口径与映射表

- [ ] 明确 primary_error 的选择规则
- [ ] 梳理 Top error.code → 建议动作（最小可用集合，建议至少覆盖：AUTH_*/CONFIG_CREDENTIAL_NOT_FOUND/VCENTER_* /PLUGIN_* /SCHEMA_VALIDATION_FAILED/INVENTORY_INCOMPLETE/RAW_PERSIST_FAILED）

### Phase 2: UI 落地

- [ ] `/runs` 列表：失败摘要展示
- [ ] `/runs/[id]` 详情：错误分组/建议动作展示

### Phase 3: 回归

- [ ] 用 3~5 个典型失败场景回归（认证失败/网络失败/schema 失败/版本不兼容）
- [ ] 越权与脱敏回归：确保页面不展示敏感信息（尤其是 message/context 的误填场景）

---

**Document Version**: 1.1
**Created**: 2026-01-30
**Last Updated**: 2026-01-31
**Clarification Rounds**: 1
**Quality Score**: 100/100 (audited)
