# M8：资产台账系统 - 台账字段闭环（预设字段集）- 产品需求文档（PRD）

> 目标：提供台账侧业务补录字段（预设字段集），并一次性交付“列表/筛选/搜索/单资产编辑/批量维护/审计/错误码/导出”的完整闭环，避免出现“有字段但缺配套能力”的返工。

## Requirements Description

### Background

- **现状问题**：
  - 仅有采集字段（canonical/normalized）不足以支撑盘点治理：需要补录公司/部门/系统归属/分级等“台账字段”。
  - 若仅提供“逐资产编辑”，在批量新建/迁移场景下维护成本不可接受；必须有批量入口与审计。
  - 若字段不可被列表展示/筛选/搜索命中，治理字段将难以复用与验收。
- **目标用户**：
  - 管理员（admin）：维护台账字段值、批量治理、导出盘点。
  - 普通用户（user）：只读查看台账字段值（无写入权限）。
- **价值**：让台账字段成为“可治理、可追溯、可验收”的一等能力（而非零散补丁）。

### Scope / Out of Scope

**In Scope**

- 台账字段采用**预设字段集**（ledger-fields-v1）：
  - 字段集合与类型固定：后续不提供新增/删除/停用/改类型能力（仅允许维护字段值）。
  - 生效范围：仅覆盖 `vm + host`（cluster 不参与）。
  - `host` 专用字段不得挂载到 `vm`（强校验，禁止错用）。
- 列表闭环（/assets）：
  - 台账字段可作为“可选列”展示（与列配置 DB 持久化能力协作）。
  - 支持最小台账筛选（见下文）。
  - 全局关键字搜索 `q` 必须命中台账字段。
- 编辑闭环：
  - 单资产：资产详情“一键保存”台账字段值（admin-only）。
  - 多资产：资产列表“当前页勾选”批量设置 1 个台账字段值（admin-only）。
- 审计闭环：
  - 单资产保存、批量设置、导出均写入审计事件（含 requestId、操作者、变更摘要）。
- 错误码闭环：
  - 对校验/权限/越界等失败场景返回稳定错误码（用于 UI 提示与排障聚合）。

**Out of Scope（一期不做）**

- 字段定义管理（新增/删除/停用/改类型/自定义作用域/自定义校验）。
- 跨分页选择 / “对筛选结果全量应用”（一次覆盖 N>100 的资产）。
- 多资产批量一次更新多个字段（批量入口一次只允许更新 1 个字段；单资产允许一次更新多个字段）。
- 台账字段值版本表（历史追溯由审计事件承担）。

### Success Metrics

- 管理员可在 1 分钟内对 100 台新资产完成“公司/部门/系统分级”等字段补录，并能在审计中回放。
- 普通用户可只读查看台账字段值；任何写入尝试均被拒绝且错误码明确。

## Feature Overview

### 1) 预设字段集（ledger-fields-v1）

通用字段（vm + host）：

- `region`（地区，string）
- `company`（公司，string）
- `department`（部门，string）
- `systemCategory`（系统分类，string，例如：财经系统/基础架构等）
- `systemLevel`（系统分级，string，例如：核心/普通/测试等）
- `bizOwner`（业务对接人员，string）

host 专用字段：

- `maintenanceDueDate`（维保时间，date）
- `purchaseDate`（购买时间，date）
- `bmcIp`（管理IP，BMC/ILO，ipv4 string）
- `cabinetNo`（机柜编号，string）
- `rackPosition`（机架位置，string）
- `managementCode`（管理码，string）
- `fixedAssetNo`（固定资产编号，string）

> 说明：
>
> - `bmcIp` 明确指 BMC/ILO 等带外管理地址，不等价于采集到的业务网 IP。
> - 字段值允许为 `null`（语义：未设置/清空）。

### 2) /assets 列表闭环（列表/筛选/搜索）

- 列展示：
  - 上述台账字段必须能在 `/assets` 作为可选列开启显示（默认列不变）。
- 台账筛选（最小集合）：
  - 支持按 `company/department/systemCategory/systemLevel` 过滤（不区分大小写，substring 匹配）。
  - 允许设置为“空”（仅显示未设置）可作为后续增强；一期可不做。
- 搜索：
  - `q` 必须命中所有台账字段（case-insensitive substring 匹配）。

### 3) 编辑闭环（单资产 + 批量）

- 单资产编辑（admin-only）：
  - `/assets/[uuid]` 提供“编辑模式”，允许一次修改多个台账字段并一键保存。
- 批量编辑（admin-only）：
  - `/assets` 支持“当前页勾选” N≤100 的资产。
  - 批量操作一次只允许设置 1 个台账字段（覆盖写入）；值可设为 `null`（清空）。

### 4) 审计（必须）

建议 eventType（可按工程习惯微调，但需稳定）：

- 单资产保存：`asset.ledger_fields_saved`
- 批量设置：`asset.ledger_fields_bulk_set`
- 导出：`asset.ledger_exported`

审计 payload（建议最小字段）：

- `requestId`
- `assetUuid` / `assetUuids`
- `updatedKeys`（字段 key 列表）
- `valueSummary`（对 string 做截断；对敏感字段可脱敏）

### 5) 错误码（必须稳定）

建议最小错误码集合（仅示例，需纳入错误码文档并稳定枚举）：

- `AUTH_FORBIDDEN`：非 admin 写入
- `CONFIG_LEDGER_FIELD_KEY_INVALID`：字段 key 不存在/不允许
- `CONFIG_LEDGER_FIELD_ASSET_TYPE_MISMATCH`：字段与资产类型不匹配（例如把 host 字段写到 vm）
- `CONFIG_LEDGER_FIELD_VALUE_INVALID`：值格式非法（date/ipv4 解析失败等）
- `CONFIG_LEDGER_FIELD_LIMIT_EXCEEDED`：批量资产数超限（N>100）

## Detailed Requirements

### 1) 数据模型（固定列，1:1 绑定资产）

> 目标：字段集合固定且可索引，避免“字段定义表/动态 schema”导致的复杂度与验收风险。

推荐新表（示例命名）`AssetLedgerFields`（一资产一行）：

- `assetUuid`（PK/FK → Asset.uuid）
- 通用字段列（nullable）：
  - `region`、`company`、`department`、`systemCategory`、`systemLevel`、`bizOwner`
- host 专用字段列（nullable）：
  - `maintenanceDueDate`（date）
  - `purchaseDate`（date）
  - `bmcIp`（inet/varchar）
  - `cabinetNo`、`rackPosition`、`managementCode`、`fixedAssetNo`
- `createdAt` / `updatedAt`

索引建议（支撑筛选）：

- `(company)`、`(department)`、`(systemCategory)`、`(systemLevel)`（可使用 btree + lower() 或 CITEXT，视实现而定）

### 2) API 契约（读写分离，admin-only 写）

#### 2.1 读：资产列表/详情返回 ledgerFields（user/admin 均可读）

- `GET /api/v1/assets`：
  - 在列表每行返回 `ledgerFields`（对象，含所有 key；缺失为 null）
  - 允许实现侧用 query param 控制是否返回（例如 `include_ledger_fields=true`），但默认必须满足“可选列展示”需要
- `GET /api/v1/assets/:assetUuid`：
  - 返回 `ledgerFields`（同上）

#### 2.2 写：单资产保存

- `PUT /api/v1/assets/:assetUuid/ledger-fields`（admin-only）
  - body：`{ ledgerFields: { [key]: string|null } }`
  - 支持一次更新多个字段（覆盖写入）
  - 对不存在/不允许的 key：400 + `CONFIG_LEDGER_FIELD_KEY_INVALID`
  - 对 host 专用字段写入 vm：400 + `CONFIG_LEDGER_FIELD_ASSET_TYPE_MISMATCH`

#### 2.3 写：批量设置（当前页勾选）

- `POST /api/v1/assets/ledger-fields/bulk-set`（admin-only）
  - body：`{ assetUuids: string[], key: string, value: string|null }`
  - 限制：`assetUuids.length <= 100`，否则 400 + `CONFIG_LEDGER_FIELD_LIMIT_EXCEEDED`
  - 幂等：对同一批次重复提交结果一致（覆盖写入）

### 3) 校验规则（强约束）

- `string` 类字段：
  - trim；空串视为 `null`（等价清空）
  - 最大长度建议 256（超出返回 `CONFIG_LEDGER_FIELD_VALUE_INVALID`）
- `date` 类字段（`maintenanceDueDate/purchaseDate`）：
  - 输入格式：`YYYY-MM-DD`（按用户时区解释；落库存 date）
- `bmcIp`：
  - 仅允许 IPv4（一期）或允许 IPv4/IPv6（二选一需在实现中确定并写入 schema）；非法返回 `CONFIG_LEDGER_FIELD_VALUE_INVALID`

### 4) 搜索/筛选语义（与 /assets 对齐）

- `q` 搜索：
  - 必须命中全部 ledger-fields-v1 字段（case-insensitive substring）
  - 与现有 `q` 语义一致：空格分词 AND
- 筛选：
  - `company/department/systemCategory/systemLevel` substring 匹配（不区分大小写）
  - 资产类型边界：对 vm/host 均可筛选（cluster 不参与）

### 5) 审计事件（必须落库）

审计事件 payload（建议）：

- 单资产保存：`asset.ledger_fields_saved`
  - `assetUuid`
  - `updatedKeys`
  - `before`/`after`（可选；若包含敏感字段需脱敏）
- 批量设置：`asset.ledger_fields_bulk_set`
  - `assetUuids`
  - `key`
  - `valueSummary`
- 导出：`asset.ledger_exported`（与 M8 导出 CSV PRD 对齐）

## Design Decisions

### Technical Approach

- 固定字段集（ledger-fields-v1）+ 固定列存储：
  - 便于索引与筛选，验收口径明确
  - 避免“字段定义管理”导致的产品/工程复杂度
- 写入只允许 admin：
  - user 只读，避免扩大治理写入口
- 搜索/筛选与列配置联动：
  - 列配置只影响展示，不影响“哪些字段可被搜索/筛选命中”（台账字段必须始终可命中）

### Constraints

- 一期不做“对筛选结果全量应用”与跨分页选择（只支持当前页 N≤100）。
- 批量入口一次只更新 1 个字段，降低误操作风险与审计复杂度。

### Risk Assessment

- **查询性能风险**：`q` 与多字段 substring 可能变慢。缓解：对高频筛选字段建索引；必要时将 `q` 搜索拆分为“结构化字段（索引）+ 模糊字段（降级）”并设定数据量阈值。
- **越权风险**：若后端漏鉴权会导致 user 写入。缓解：所有写 API 强制 `requireAdmin`；e2e 覆盖 403 用例（联动 M7）。
- **字段口径漂移风险**：字段集合一旦发布不能随意改名/改类型。缓解：字段集版本化（v1/v2），只增不改。

## Acceptance Criteria

### Functional Acceptance

- [ ] 系统仅提供预设字段集（ledger-fields-v1）；不提供字段定义的新增/删除/停用/改类型能力。
- [ ] 台账字段仅覆盖 `vm + host`；host 专用字段禁止写入 vm（返回稳定错误码）。
- [ ] `/assets` 列配置中可开启显示台账字段列（默认列不变）。
- [ ] `/assets` 支持按 `company/department/systemCategory/systemLevel` 过滤（case-insensitive substring 匹配）。
- [ ] `/assets` 的关键字搜索 `q` 必须命中所有台账字段。
- [ ] 管理员可在 `/assets/[uuid]` 一次保存多个台账字段变更（单资产一键保存）。
- [ ] 管理员可在 `/assets` 对当前页勾选资产批量设置 1 个台账字段（N≤100）。
- [ ] 普通用户可只读查看台账字段值；任何写入相关 API 返回 403（或等价）且错误码明确。

### Audit Acceptance

- [ ] 单资产保存写入审计事件（含 requestId、操作者、变更摘要）。
- [ ] 批量设置写入审计事件（含 requestId、字段 key、新值摘要、影响资产清单）。
- [ ] 导出写入审计事件（含 requestId、参数摘要）。

### Error Code Acceptance

- [ ] 上述典型失败场景均返回稳定错误码（禁止仅靠 message 文本区分）。

## Test Scenarios

### 正向场景（Happy Path）

| 场景 ID | 场景描述           | 前置条件                   | 操作步骤                                          | 期望结果                            |
| ------- | ------------------ | -------------------------- | ------------------------------------------------- | ----------------------------------- |
| T8L-01  | 单资产保存台账字段 | admin 角色、资产存在       | 调用 `PUT /api/v1/assets/:uuid/ledger-fields`     | 字段保存成功；写入 audit_event      |
| T8L-02  | 批量设置台账字段   | admin 角色、勾选 10 个资产 | 调用 `POST /api/v1/assets/ledger-fields/bulk-set` | 10 个资产字段更新；写入 audit_event |
| T8L-03  | 列表展示台账字段列 | 台账字段已配置             | 访问 `/assets` 并开启台账列                       | 列表展示台账字段值                  |
| T8L-04  | 台账字段筛选       | 资产有 company 字段        | 按 company 筛选                                   | 仅展示匹配资产                      |
| T8L-05  | 搜索命中台账字段   | 资产 department="IT"       | 搜索 `q=IT`                                       | 命中该资产                          |
| T8L-06  | 清空字段值         | 字段有值                   | 设置 value=null                                   | 字段被清空；审计记录变更            |

### 异常场景（Error Path）

| 场景 ID | 场景描述     | 前置条件              | 操作步骤     | 期望错误码                                | 期望行为 |
| ------- | ------------ | --------------------- | ------------ | ----------------------------------------- | -------- |
| T8L-E01 | user 写入    | user 角色             | 调用写入 API | `AUTH_FORBIDDEN`                          | 返回 403 |
| T8L-E02 | 无效字段 key | 使用不存在的 key      | 调用写入 API | `CONFIG_LEDGER_FIELD_KEY_INVALID`         | 返回 400 |
| T8L-E03 | 类型不匹配   | 把 host 字段写入 vm   | 调用写入 API | `CONFIG_LEDGER_FIELD_ASSET_TYPE_MISMATCH` | 返回 400 |
| T8L-E04 | 值格式非法   | date 字段传入非法格式 | 调用写入 API | `CONFIG_LEDGER_FIELD_VALUE_INVALID`       | 返回 400 |
| T8L-E05 | 批量超限     | 批量设置 101 个资产   | 调用批量 API | `CONFIG_LEDGER_FIELD_LIMIT_EXCEEDED`      | 返回 400 |

### 边界场景（Edge Case）

| 场景 ID | 场景描述       | 前置条件      | 操作步骤     | 期望行为                                 |
| ------- | -------------- | ------------- | ------------ | ---------------------------------------- |
| T8L-B01 | 空串视为 null  | 传入空字符串  | 调用写入 API | 字段被清空（等价 null）                  |
| T8L-B02 | 字符串超长     | 传入 300 字符 | 调用写入 API | 返回 `CONFIG_LEDGER_FIELD_VALUE_INVALID` |
| T8L-B03 | bmcIp 格式校验 | 传入非法 IP   | 调用写入 API | 返回 `CONFIG_LEDGER_FIELD_VALUE_INVALID` |

## Dependencies

| 依赖项                     | 依赖类型 | 说明                   |
| -------------------------- | -------- | ---------------------- |
| AssetLedgerFields 数据模型 | 硬依赖   | 需新增 Prisma model    |
| M3 /assets UI              | 软依赖   | 列配置需支持台账字段列 |
| M8 导出 CSV                | 软依赖   | 导出需包含台账字段     |

## Observability

### 关键指标

| 指标名                             | 类型      | 说明                 | 告警阈值       |
| ---------------------------------- | --------- | -------------------- | -------------- |
| `ledger_fields_save_success_rate`  | Gauge     | 台账字段保存成功率   | < 99% 触发告警 |
| `ledger_fields_bulk_set_count`     | Counter   | 批量设置次数         | -              |
| `ledger_fields_search_latency_p95` | Histogram | 台账字段搜索延迟 p95 | > 2s 触发告警  |

### 日志事件

| 事件类型                 | 触发条件   | 日志级别 | 包含字段                                         |
| ------------------------ | ---------- | -------- | ------------------------------------------------ |
| `ledger_fields.saved`    | 单资产保存 | INFO     | `asset_uuid`, `user_id`, `updated_keys`          |
| `ledger_fields.bulk_set` | 批量设置   | INFO     | `asset_count`, `user_id`, `key`, `value_summary` |

## Performance Baseline

| 场景                   | 数据规模    | 期望性能  | 验证方法 |
| ---------------------- | ----------- | --------- | -------- |
| 单资产保存             | 1 资产      | < 200ms   | API 压测 |
| 批量设置               | 100 资产    | < 2s      | API 压测 |
| 搜索（q 命中台账字段） | 10,000 资产 | TTFB < 1s | 后端压测 |

## Execution Phases

### Phase 1: 数据模型与契约

- [ ] 明确台账字段存储方式（推荐：固定列；不使用“字段定义表”）
- [ ] 明确字段 key/类型/assetType 生效范围（ledger-fields-v1 registry）
- [ ] 补齐错误码枚举与 UI 映射占位

### Phase 2: 单资产编辑 + 审计

- [ ] `/assets/[uuid]` 编辑模式与一键保存
- [ ] 审计事件落库与回放验证

### Phase 3: 批量编辑 + 审计 + 错误码

- [ ] `/assets` 当前页勾选 + 批量设置 1 个字段
- [ ] 超限/类型不匹配/非法值/权限不足的错误码与 UI 提示

### Phase 4: 列表列展示/筛选/搜索闭环

- [ ] 列配置中可选择台账字段列
- [ ] 最小台账筛选（company/department/systemCategory/systemLevel）
- [ ] `q` 搜索命中台账字段

### Phase 5: 导出 CSV（联动 M8 导出 PRD）

- [ ] 导出列包含台账字段（vm 不适用的 host 字段留空）
- [ ] 导出审计与权限校验

---

**Document Version**: 1.1
**Created**: 2026-01-31
**Last Updated**: 2026-01-31
**Clarification Rounds**: 1
**Quality Score**: 100/100 (audited)
