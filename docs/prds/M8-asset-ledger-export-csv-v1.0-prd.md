# M8：资产台账系统 - 导出全量台账（CSV）- 产品需求文档（PRD）

> 目标：支持管理员导出全量台账 CSV，用于盘点与离线分析；导出需权限受控并写入审计。
>
> 关联：
>
> - SRS（FR-11 资产浏览、查询与导出）：`docs/requirements/asset-ledger-srs.md`
> - 台账字段闭环（ledger-fields-v1）：`docs/prds/M8-asset-ledger-ledger-fields-closed-loop-v1.0-prd.md`
> - API 规范（需补充 export API）：`docs/design/asset-ledger-api-spec.md`
> - 错误码规范：`docs/design/asset-ledger-error-codes.md`

## Requirements Description

### Background

- **现状问题**：缺少导出能力，盘点需要手工抄录或直连 DB，不可控且难审计。
- **目标用户**：管理员（admin）。
- **价值**：
  - 支持离线盘点、审计留档与跨系统对账。
  - 与台账字段（ledger-fields-v1）联动：把业务补录字段带出系统，形成可交付的“盘点材料”。

### Scope / Out of Scope

**In Scope**

- 导出入口（admin-only）：
  - 发起导出任务（导出任务的执行可同步/异步，需明确口径）
  - 下载 CSV 文件
  - 导出动作审计（谁、何时、导出参数与结果摘要）
- 导出字段（最小集合，SRS 强约束）：
  - 基础列：`asset_uuid`、`asset_type`、`status`、`display_name`、`last_seen_at`、来源摘要（source_id/source_type）
  - 台账字段列：包含 `ledger-fields-v1` 的全部字段（vm 不适用的 host 专用字段留空）

**Out of Scope**

- 大规模报表系统与自助分析（透视表、聚合统计、图表）。
- 导出格式多样化（JSON/XLSX）。
- 对“筛选结果全量导出”的复杂能力（一期只做全量导出；如需按筛选导出，后续另立 PRD）。

### Success Metrics

- 管理员可在 UI 完成导出并下载；普通用户无入口且 403。
- 导出动作可在审计中追溯（含 requestId、操作者、参数摘要与行数）。

## Feature Overview

### Core Requirements

1. **权限与可见性**

- admin-only：仅管理员可见导出入口与调用导出 API。
- user：无入口；调用导出 API 返回 403（`AUTH_FORBIDDEN`）。

2. **导出任务生命周期**

- 导出至少包含三个阶段：创建任务 → 生成文件 → 下载文件。
- UI 必须可见导出进度（Queued/Running/Succeeded/Failed）。

3. **CSV 契约稳定**

- 列名、顺序、数据格式必须稳定（便于对账/自动导入）。
- 对空值、日期、包含逗号/换行的字段必须有明确转义策略。

4. **审计（必须）**

- 导出动作必须写入审计事件（建议 eventType=`asset.ledger_exported`，与台账字段闭环 PRD 对齐）。

## Detailed Requirements

### 1) 导出范围（全量口径）

> 目标：明确“全量”包含什么、不包含什么，避免实现与验收分歧。

导出范围（v1，已确认）：

- 资产类型：`vm + host`（cluster 不导出）
- 资产状态：导出 `in_service + offline`，排除 `merged`

### 2) CSV 格式规范（稳定契约）

#### 2.1 编码与分隔符

- 编码：UTF-8（不带 BOM）
- 分隔符：`,`（逗号）
- 换行：`\n`（实现可用 `\r\n`，但必须保持一致）

#### 2.2 转义与引用（RFC 4180 风格）

- 当字段值包含 `,`、`"`、`\n` 时：
  - 该字段必须用 `"` 包裹
  - 字段内的 `"` 必须转义为 `""`（双引号加倍）

#### 2.3 空值与类型

- `null/undefined`：导出为空字符串
- 日期时间：ISO 8601（UTC，带 `Z`），例如 `2026-01-31T12:34:56Z`
- string：原样输出（必要时按 2.2 转义）

### 3) 列定义（v1）

> 注意：列名与顺序必须稳定；如未来扩展，新增列仅允许追加到末尾（不改名/不换序）。

#### 3.1 基础列（SRS 强约束）

| 列名           | 类型   | 说明                                                   |
| -------------- | ------ | ------------------------------------------------------ | ------------------------- |
| `asset_uuid`   | string | 资产 UUID                                              |
| `asset_type`   | string | `vm                                                    | host`                     |
| `status`       | string | `in_service                                            | offline`（不导出 merged） |
| `display_name` | string | 展示名（可为空）                                       |
| `last_seen_at` | string | 资产最后一次出现时间（ISO 8601 UTC；可为空）           |
| `source_id`    | string | 来源摘要（多来源时用 `;` 拼接，顺序按 source_id 升序） |
| `source_type`  | string | 来源摘要（与 source_id 对齐，用 `;` 拼接）             |

> 说明：由于一个资产可绑定多个 Source，本 PRD 将 `source_id/source_type` 定义为“摘要列”，允许多值 `;` 拼接，避免一资产多行导致对账困难。

#### 3.2 台账字段列（ledger-fields-v1，全量）

通用（vm + host）：

- `region`
- `company`
- `department`
- `systemCategory`
- `systemLevel`
- `bizOwner`

host 专用（vm 留空）：

- `maintenanceDueDate`（date）
- `purchaseDate`（date）
- `bmcIp`（ipv4 string）
- `cabinetNo`
- `rackPosition`
- `managementCode`
- `fixedAssetNo`

### 4) 导出任务 API（建议契约）

> 注：当前 `docs/design/asset-ledger-api-spec.md` 未包含导出 API；本 PRD 先定义最小契约，后续需同步到 API spec。

#### 4.1 创建导出任务

- `POST /api/v1/exports/asset-ledger`
- 权限：admin-only
- body（v1 最小集合）：
  - `format`: `"csv"`
  - `version`: `"asset-ledger-export-v1"`

返回（200/201）：

- `exportId`
- `status`（Queued/Running/Succeeded/Failed）

#### 4.2 查询导出任务状态

- `GET /api/v1/exports/asset-ledger/:exportId`
- 返回：
  - `status`
  - `createdAt/startedAt/finishedAt`
  - `rowCount`（Succeeded 时必有）
  - `fileName` / `fileSizeBytes`（Succeeded 时必有）
  - `error`（Failed 时必有：code/message/retryable/redacted_context）

#### 4.3 下载

- `GET /api/v1/exports/asset-ledger/:exportId/download`
- 权限：admin-only
- 响应：
  - `Content-Type: text/csv; charset=utf-8`
  - `Content-Disposition: attachment; filename="asset-ledger-export-YYYYMMDD-HHmmss.csv"`

### 5) 数据模型与存储（建议）

> 目标：保证可追溯与可运维（可查任务状态、可定位失败原因）。

建议引入 `asset_ledger_export`（或等价）表：

- `id`（exportId）
- `requestedByUserId`
- `status`（Queued/Running/Succeeded/Failed/Expired）
- `params`（JSON：format/version/filters 预留）
- `rowCount`（Succeeded）
- `fileName` / `fileSizeBytes` / `fileSha256`（Succeeded）
- `fileRef`（文件定位：可为本地路径/对象存储 key/DB blob id；实现自选）
- `error`（Failed：结构化错误）
- `createdAt/startedAt/finishedAt/expiresAt`

> 文件留存策略：下载即失效（见 Clarified Decisions）；不要求永久保留导出文件，但要求审计永久可追溯。

### 6) 审计（必须）

建议 eventType：

- `asset.ledger_exported`

payload（建议最小字段）：

- `requestId`
- `exportId`
- `requestedByUserId`
- `version`（asset-ledger-export-v1）
- `filtersSummary`（v1 为空或默认全量）
- `rowCount`（若创建时未知，可在任务完成后补写一条审计或在 payload 中标注 pending）

### 7) 错误处理（必须稳定）

- 非 admin：403 `AUTH_FORBIDDEN`
- 未登录：401 `AUTH_UNAUTHORIZED`
- 参数非法：400 `CONFIG_INVALID_REQUEST`
- 导出任务不存在：404（建议新增 `CONFIG_EXPORT_NOT_FOUND` 并注册到错误码文档）
- 导出文件已下载失效：410（建议新增 `CONFIG_EXPORT_EXPIRED` 并注册到错误码文档）
- 导出生成失败：
  - DB 读取失败：`DB_READ_FAILED`
  - 未分类：`INTERNAL_ERROR`

## Clarified Decisions（已确认）

1. **导出范围（v1）**：仅导出 `vm+host`；包含 `in_service+offline`；排除 `merged` 与 `cluster`。
2. **导出模式（v1）**：仅支持异步任务（不提供同步直出）。
3. **文件留存（v1）**：下载即失效（首次下载成功后，后续下载应返回 410 + `CONFIG_EXPORT_EXPIRED`）。

## Design Decisions

### Technical Approach

建议优先采用“异步任务”生成 CSV（避免大查询导致 HTTP 超时/页面卡死），并提供状态查询 + 下载接口。

### Constraints

- v1 仅支持“全量导出”（不支持按筛选导出）。
- CSV 列名与顺序必须稳定；扩展只能追加列。
- 导出文件不要求永久保留，但导出审计必须永久保留（对齐 SRS NFR-01）。
- 文件留存：下载即失效（安全优先）。

### Risk Assessment

- **性能风险**：全量导出可能数据量大，影响 DB。缓解：异步任务、分批读取（cursor）、限流/并发控制。
- **数据泄露风险**：CSV 可能被外传。缓解：admin-only、审计、（可选）文件 TTL、避免包含 raw/凭证/敏感字段。
- **一致性风险**：导出过程中数据变化导致结果不一致。缓解：导出定义为“任务开始时刻的 best-effort 快照”，实现可用事务快照或按批次读取并记录任务时间。

## Acceptance Criteria

### Functional Acceptance

- [ ] admin 可发起导出任务、查看状态、下载 CSV。
- [ ] user 无入口，且调用导出 API 返回 403（`AUTH_FORBIDDEN`）。
- [ ] CSV 每行至少包含 SRS 要求的基础列：`asset_uuid/asset_type/status/display_name/last_seen_at/source_id/source_type`。
- [ ] CSV 包含 `ledger-fields-v1` 的全部列；vm 的 host 专用字段留空。
- [ ] `source_id/source_type` 作为“来源摘要列”可表达多来源（使用 `;` 拼接，顺序稳定）。
- [ ] 导出动作写入审计事件（`asset.ledger_exported`），包含 requestId 与参数摘要；任务完成后可追溯行数。

### Quality Standards

- [ ] CSV 转义符合 2.2 规则（含逗号/换行/双引号字段不破坏 CSV 结构）。
- [ ] 任务失败时返回/落库结构化错误（code/message/retryable/redacted_context），便于 UI 展示与聚合。
- [ ] 文档同步：补充导出 API 到 `docs/design/asset-ledger-api-spec.md`；新增错误码需注册到 `docs/design/asset-ledger-error-codes.md`。

### Security Standards

- [ ] 导出结果不得包含任何 raw payload 或凭证明文。
- [ ] 导出文件下载需鉴权（不得产生可匿名下载的 URL）。
- [ ] 下载即失效：导出文件首次下载成功后应立刻失效，后续下载返回 410 + `CONFIG_EXPORT_EXPIRED`。

## Test Scenarios

### 正向场景（Happy Path）

| 场景 ID | 场景描述         | 前置条件           | 操作步骤                                             | 期望结果                                                                          |
| ------- | ---------------- | ------------------ | ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| T8E-01  | 创建导出任务     | admin 角色         | 调用 `POST /api/v1/exports/asset-ledger`             | 返回 exportId；status=Queued                                                      |
| T8E-02  | 查询导出状态     | 导出任务已创建     | 调用 `GET /api/v1/exports/asset-ledger/:id`          | 返回 status/rowCount/fileName                                                     |
| T8E-03  | 下载 CSV         | 导出任务 Succeeded | 调用 `GET /api/v1/exports/asset-ledger/:id/download` | 返回 CSV 文件；Content-Type 正确                                                  |
| T8E-04  | CSV 包含基础列   | 导出成功           | 检查 CSV 内容                                        | 包含 asset_uuid/asset_type/status/display_name/last_seen_at/source_id/source_type |
| T8E-05  | CSV 包含台账字段 | 导出成功           | 检查 CSV 内容                                        | 包含 ledger-fields-v1 全部列；vm 的 host 专用字段留空                             |
| T8E-06  | 审计记录         | 导出成功           | 查询 audit_event                                     | 存在 `asset.ledger_exported` 事件                                                 |

### 异常场景（Error Path）

| 场景 ID | 场景描述       | 前置条件      | 操作步骤         | 期望错误码                | 期望行为 |
| ------- | -------------- | ------------- | ---------------- | ------------------------- | -------- |
| T8E-E01 | user 导出      | user 角色     | 调用导出 API     | `AUTH_FORBIDDEN`          | 返回 403 |
| T8E-E02 | 未登录导出     | 未登录        | 调用导出 API     | `AUTH_UNAUTHORIZED`       | 返回 401 |
| T8E-E03 | 导出任务不存在 | 无效 exportId | 调用查询 API     | `CONFIG_EXPORT_NOT_FOUND` | 返回 404 |
| T8E-E04 | 重复下载       | 已下载过一次  | 再次调用下载 API | `CONFIG_EXPORT_EXPIRED`   | 返回 410 |

### 边界场景（Edge Case）

| 场景 ID | 场景描述     | 前置条件                 | 操作步骤       | 期望行为                          |
| ------- | ------------ | ------------------------ | -------------- | --------------------------------- |
| T8E-B01 | 字段含逗号   | 资产 display_name 含逗号 | 导出并检查 CSV | 字段被双引号包裹；CSV 结构正确    |
| T8E-B02 | 字段含换行   | 资产字段含换行符         | 导出并检查 CSV | 字段被双引号包裹；CSV 结构正确    |
| T8E-B03 | 字段含双引号 | 资产字段含双引号         | 导出并检查 CSV | 双引号转义为 `""`；CSV 结构正确   |
| T8E-B04 | 多来源资产   | 资产绑定 3 个 Source     | 导出并检查 CSV | source_id/source_type 用 `;` 拼接 |
| T8E-B05 | 大数据量导出 | 10,000 资产              | 创建导出任务   | 异步完成；不超时                  |

## Dependencies

| 依赖项       | 依赖类型 | 说明                            |
| ------------ | -------- | ------------------------------- |
| M8 台账字段  | 硬依赖   | CSV 需包含 ledger-fields-v1 列  |
| 异步任务框架 | 硬依赖   | 需支持异步导出任务              |
| 文件存储     | 硬依赖   | 需存储导出文件（本地/对象存储） |

## Observability

### 关键指标

| 指标名                     | 类型      | 说明             | 告警阈值        |
| -------------------------- | --------- | ---------------- | --------------- |
| `export_task_success_rate` | Gauge     | 导出任务成功率   | < 95% 触发告警  |
| `export_task_duration_p95` | Histogram | 导出任务耗时 p95 | > 5min 触发告警 |
| `export_download_count`    | Counter   | 导出下载次数     | -               |

### 日志事件

| 事件类型                | 触发条件     | 日志级别 | 包含字段                                             |
| ----------------------- | ------------ | -------- | ---------------------------------------------------- |
| `export.task_created`   | 创建导出任务 | INFO     | `export_id`, `user_id`, `params`                     |
| `export.task_completed` | 导出任务完成 | INFO     | `export_id`, `row_count`, `file_size`, `duration_ms` |
| `export.downloaded`     | 文件被下载   | INFO     | `export_id`, `user_id`                               |

## Performance Baseline

| 场景       | 数据规模    | 期望性能 | 验证方法         |
| ---------- | ----------- | -------- | ---------------- |
| 小规模导出 | 1,000 资产  | < 30s    | 压测             |
| 中规模导出 | 10,000 资产 | < 3min   | 压测             |
| 大规模导出 | 50,000 资产 | < 10min  | 压测（分批读取） |

## Execution Phases

### Phase 1: 契约定稿（CSV + API + 错误码 + 审计）

- [ ] 确认导出范围/异步模式/下载即失效（已确认）
- [ ] 定稿 CSV 列名与顺序（asset-ledger-export-v1）
- [ ] 补齐 API spec 与错误码注册表

### Phase 2: 导出任务实现（后端）

- [ ] 数据模型：export 任务表
- [ ] 异步 worker：分批读取资产 + 拼接来源摘要 + 输出 CSV
- [ ] 下载接口（鉴权 + Content-Disposition）
- [ ] 审计：asset.ledger_exported

### Phase 3: UI 落地

- [ ] UI 入口（admin-only）：发起导出、展示进度、下载按钮
- [ ] Failed 状态展示结构化错误与建议动作

### Phase 4: 性能与安全回归

- [ ] 大数据量导出压测（分批/并发/限流）
- [ ] 越权用例回归（user 403、未登录 401）
- [ ] CSV 可用性回归（Excel/脚本读取）

---

**Document Version**: 1.1
**Created**: 2026-01-30
**Last Updated**: 2026-01-31
**Clarification Rounds**: 3
**Quality Score**: 100/100 (audited)
