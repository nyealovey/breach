# M9：资产台账系统 - 批量维护台账字段（批量编辑自定义字段 + 资产详情一键保存）- 产品需求文档（PRD）

> 目标：为自定义字段系统补齐“可持续治理”的维护能力：
>
> 1. 管理员在资产列表中可选中一批资产，并一次性设置 **1 个**启用的自定义字段（用于资产归类：分级/负责人/地区/公司等）。
> 2. 管理员在资产详情中可一次保存多个台账字段变更（自定义字段 + `machineNameOverride` + `ipOverride`），替代原有“编辑机器名”的列表弹窗。

## Requirements Description

### Background

- **现状问题**：
  - 自定义字段一旦开放给业务侧使用，“按资产逐个维护”会成为主要瓶颈（尤其是新起一批服务器时的归类补录）。
  - 即使首次可用 SQL 补齐，后续新增资产仍需要可重复的批量维护入口，否则治理不可持续。
- **目标用户**：管理员（admin）。
- **价值**：降低台账治理的人力成本，确保分类字段能在资产生命周期持续被维护、可追溯。

### Feature Overview

**Core Features（MVP）**

1. **资产列表页批量编辑入口（admin-only）**
   - 在 `/assets` 列表中支持“当前页勾选”资产，并批量设置 1 个启用的自定义字段。

2. **类型感知输入与校验**
   - 支持对所有“启用中的自定义字段定义”进行批量设置，并根据字段类型提供对应输入控件与校验。

3. **资产详情一键保存（单资产多字段）**
   - 在 `/assets/[uuid]` 资产详情页提供“编辑模式”，支持一次提交并保存：
     - 多个自定义字段
     - `machineNameOverride`（覆盖机器名）
     - `ipOverride`（覆盖 IP，仅 IPv4）

4. **辅助定位新资产**
   - `/assets` 增加“最近入账 7 天”筛选，用于快速定位新起服务器（后续自定义字段筛选另立需求/后续版本实现）。

5. **审计**
   - 批量变更必须落审计事件（操作者/时间/字段/新值摘要/影响资产清单/请求号）。
   - 资产详情“一键保存”也必须落审计事件（操作者/时间/变更项摘要/请求号）。

**Feature Boundaries / Out of Scope（一期不做）**

- 跨分页选择 / “对筛选结果全量应用”（一次性覆盖 N>100 的资产）。
- **多资产批量**一次操作修改多个字段（仍不支持；单资产详情页允许一次修改多个字段）。
- “仅当为空才设置”等条件更新策略（一期总是覆盖）。
- 字段级权限与字段值版本化（字段值历史依赖审计事件；值表仅存当前值）。

### User Scenarios

- 场景 A：管理员选择“最近入账 7 天”，勾选当前页 80 台新 VM，将字段“公司”批量设置为“研发一部”。
- 场景 B：管理员在资产列表中搜索某业务关键字，勾选目标资产，将字段“分级”批量设置为“P1”。

## Detailed Requirements

### 1) 入口与交互（/assets）

- 列表页新增勾选列（checkbox）：
  - 支持逐行勾选。
  - 支持“全选当前页”。
  - 选择范围仅限当前页数据（不保留跨分页选择）。
- 分页：
  - 列表默认分页大小调整为 **100 行/页**（MVP 固定即可；后续可扩展成可配置 pageSize）。
- 新增筛选：
  - “最近入账”：`全部 / 最近 7 天`
  - “最近入账”的口径以 **Asset.createdAt（首次入账时间）** 为准。
- 批量编辑按钮：
  - 当 `selectedCount > 0` 时显示/启用“批量编辑字段”按钮。
  - 点击后打开批量编辑弹窗。
- 覆盖值展示（延续既有“机器名覆盖”交互）：
  - 机器名：维持现状（优先展示 `machineNameOverride`；当覆盖≠采集时展示差异 badge）。
  - IP：新增 `ipOverride` 展示（仅 IPv4）：
    - IP 列优先展示 `ipOverride`；若 `ipOverride` 存在，则展示“覆盖”/“覆盖≠采集” badge（规则见下）。
    - “覆盖≠采集”判定：当采集到的 IP 列表不包含 `ipOverride` 时视为不一致（若采集为空则视为不一致）。
  - 列表不再提供“编辑机器名”弹窗入口（改为在资产详情统一编辑）。

### 2) 单资产编辑（/assets/[uuid]）

- 资产详情页提供“编辑模式”（admin-only）：
  - 以表单形式展示可编辑的“台账字段”：
    - `machineNameOverride`（机器名覆盖）
    - `ipOverride`（IP 覆盖，仅 IPv4）
    - 所有启用中的自定义字段（按字段定义渲染输入控件）
  - 允许一次修改多个字段，并通过一个“保存”按钮一次性提交。
  - 原有“编辑机器名”模态框取消；其能力迁移到该表单。

- 字段展示建议：
  - 对 `machineNameOverride`、`ipOverride` 展示“采集值（只读）”用于对比（类似现有模态框中的“采集到的机器名”）。

- 校验：
  - `ipOverride`：
    - 仅支持单个 IPv4（例如 `192.168.1.10`）；不允许逗号/空格分隔的多值。
    - 空字符串等价于 `null`（未设置）。
  - 自定义字段：
    - 与批量编辑弹窗一致（类型感知输入 + 前置校验）；空值等价于 `null`（未设置）。

### 3) 批量编辑弹窗（MVP）

弹窗信息结构（建议）：

- 顶部摘要：
  - 已选择资产数量 `N`（1 ≤ N ≤ 100）
- 字段选择：
  - 下拉选择“启用中的自定义字段定义”（按名称排序；可显示 scope/type）
  - 若字段 scope 不匹配所选资产类型，需阻止提交并提示（见“边界/错误处理”）
- 值输入（按字段类型渲染控件，必须做前置校验）：
  - `string`：单行文本；输入为空视为 `null`（等价于“未设置/清空”）
  - `int/float`：数字输入；输入为空视为 `null`
  - `bool`：三态（true/false/未设置）
  - `date`：日期选择；可清空（清空视为 `null`）
  - `datetime`：日期时间选择；可清空（清空视为 `null`）
  - `enum`：下拉选择枚举项；包含“未设置”选项（值为 `null`）
  - `json`：文本域输入 JSON；必须可 `JSON.parse`；输入为空视为 `null`
- 提交确认：
  - 提交前展示“字段名 + 新值（摘要）+ 影响资产数量 N”
  - 提交按钮文案建议：“确认批量更新”

### 4) API（后端契约）

> 说明：接口命名可按实际工程习惯微调；MVP 重点是契约清晰、可审计、可回放。

- 单资产一键保存（admin-only）：
  - `PUT /api/v1/assets/:uuid`
  - Request body（JSON）：
    - `machineNameOverride?: string | null`
    - `ipOverride?: string | null`（仅 IPv4；空字符串视为 null）
    - `customFieldValues?: Array<{ fieldId: string; value: unknown | null }>`（允许一次提交多条）
  - Response body（JSON）：
    - `assetUuid: string`
    - `updated: { machineNameOverride?: string | null; ipOverride?: string | null; customFieldUpdatedCount?: number }`
    - `requestId: string`

- `POST /api/v1/assets/bulk-set-custom-field`（admin-only）
- Request body（JSON）：
  - `assetUuids: string[]`（min=1，max=100）
  - `fieldId: string`（自定义字段定义 ID）
  - `value: unknown | null`（与字段类型匹配；`null` 表示“未设置/清空”）
- Response body（JSON）：
  - `updatedCount: number`
  - `fieldId: string`
  - `requestId: string`
- 权限：
  - 非 admin：403（无 UI 入口 + API 强制校验）

### 5) 数据与落库语义（依赖 M8）

依赖与假设（来自 M8：自定义字段）：

- 存在“字段定义表”与“字段值表”（或等价结构）：
  - 字段定义包含：`id / name / type / scope / enabled`
  - 字段值表按 `(assetUuid, fieldId)` 唯一，存储“当前值”

MVP 的字段值落库语义：

- 当 `value !== null`：对每个 `assetUuid` 执行 upsert（写入/覆盖当前值）。
- 当 `value === null`：对每个 `assetUuid` 执行 **删除该字段值记录**（语义为“未设置”）。
  - 字段值的“历史变化”由审计事件承担，一期不做字段值版本表。

资产覆盖字段（本期新增）：

- `Asset.ipOverride: string | null`（仅 IPv4）
- 机器名覆盖字段 `Asset.machineNameOverride` 已存在；本期仅调整编辑入口与联动展示。

### 6) 审计（必须）

单资产一键保存审计（建议 eventType）：

- `eventType`: `asset.ledger_fields_saved`
- `payload`（建议最小字段）：
  - `assetUuid`
  - `updatedKeys`（例如：`["machineNameOverride","ipOverride","customFieldValues"]`）
  - `customFieldChanges?: Array<{ fieldId: string; valueSummary: string | null }>`（可选；需截断）
  - `machineNameOverride?: string | null`
  - `ipOverride?: string | null`
  - `requestId`

在批量更新成功后写入审计事件（建议 eventType）：

- `eventType`: `custom_field.bulk_set`
- `payload`（建议最小字段）：
  - `fieldId`
  - `fieldType`
  - `fieldScope`
  - `valueSummary`（对 string/json 做截断；对敏感内容按后续策略脱敏）
  - `assetUuids`（由于 N≤100，可直接存全量；若未来扩展到全量应用需改为存 query 摘要）
  - `selectedCount`
  - `requestId`

### 7) 边界与错误处理

- **字段不存在/未启用**：返回 404/400（建议复用 `CONFIG_INVALID_REQUEST` 或新增细分错误码），不产生任何写入。
- **字段 scope 不匹配**：
  - scope=global：允许任意资产类型
  - scope=vm/host/cluster：所选资产必须全部匹配，否则拒绝并返回 `mismatchedAssetUuids[]`
- **资产不存在**：拒绝并返回 `missingAssetUuids[]`，不做部分成功（保持原子性）。
- **类型校验失败**：400（例如 enum 值不在 options 内、json 解析失败、number 非法）。
- **ipOverride 非法**：400（仅接受 IPv4；不接受多值）。
- **超限**：`assetUuids.length > 100` 时 400。

## Design Decisions

### Technical Approach

- 由于本期选择范围限制为 N≤100，后端可同步处理并在单次请求内完成（不引入异步任务系统）。
- 批量更新需使用 DB 事务确保原子性（成功则全量生效，失败则不产生部分写入）。

### Key Components

- UI：
  - `/assets` 列表：勾选能力 + 最近入账筛选 + 批量编辑弹窗 + IP 覆盖展示
  - `/assets/[uuid]` 详情：台账字段编辑模式（自定义字段 + machineNameOverride + ipOverride）
- API：
  - 字段定义列表接口（来自 M8，供 UI 渲染字段下拉）
  - `PUT /api/v1/assets/:uuid`（扩展：支持一键保存多个台账字段 + 审计）
  - `bulk-set-custom-field` 批量写入接口
- 数据：
  - 字段定义表、字段值表（来自 M8）
  - 审计表 AuditEvent（已存在）

### Constraints

- **性能**：N≤100；目标 2s 内完成（DB 慢查询需可定位）。
- **兼容性**：不改变现有 canonical/normalized 口径，仅新增台账侧数据。
- **安全**：admin-only；审计必做；valueSummary 避免落库超大 payload。

### Risk Assessment

- **依赖风险**：M9 依赖 M8（字段定义/字段值基础能力）。若 M8 落库模型/接口未确定，会影响 M9 实现节奏。
- **可用性风险**：若缺少“定位新资产”的筛选，批量编辑可用性会下降；因此将“最近入账 7 天”纳入本期范围。

## Acceptance Criteria

### Functional Acceptance

- [ ] `/assets` 支持当前页勾选资产（含全选当前页）。
- [ ] `/assets` 默认分页大小为 100 行/页。
- [ ] `/assets` 支持“最近入账 7 天”筛选（口径：Asset.createdAt）。
- [ ] `/assets` IP 列支持 `ipOverride` 展示与“覆盖/覆盖≠采集”标识（仅 IPv4）。
- [ ] 管理员可对所选资产批量设置 1 个启用的自定义字段（支持所有字段类型的输入与校验）。
- [ ] 批量设置支持将值设为 `null`（语义：未设置/清空），后端按“删除字段值记录”执行。
- [ ] 批量更新动作写入审计事件 `custom_field.bulk_set`，包含操作者、字段、新值摘要、影响资产清单与 requestId。
- [ ] 管理员可在资产详情 `/assets/[uuid]` 一次保存多个台账字段变更（自定义字段 + `machineNameOverride` + `ipOverride`）。
- [ ] 资产详情一键保存写入审计事件 `asset.ledger_fields_saved`（含 requestId 与变更摘要）。
- [ ] 非管理员无 UI 入口且调用相关 API 返回 403。

### Quality Standards

- [ ] 输入校验失败时返回 400 且不产生部分写入。
- [ ] 事务失败时返回 500 且不产生部分写入。

## Execution Phases

### Phase 1: Preparation

**Goal**：对齐 M8 依赖与接口契约

- [ ] 明确字段定义/字段值的数据模型与 API（如已完成则跳过）
- [ ] 明确字段 scope/type 的校验口径
- **Deliverables**：接口契约与字段类型映射清单
- **Time**：0.5 天

### Phase 2: Core Development

**Goal**：实现批量编辑能力

- [ ] 后端：`POST /api/v1/assets/bulk-set-custom-field` + 事务写入 + 审计
- [ ] 后端：扩展 `PUT /api/v1/assets/:uuid` 支持一键保存（自定义字段 + machineNameOverride + ipOverride）+ 审计
- [ ] 前端：`/assets` 勾选列 + 批量编辑弹窗 + 类型感知输入
- [ ] 前端：新增“最近入账 7 天”筛选；分页默认 100
- [ ] 前端：`/assets/[uuid]` 台账字段编辑模式；移除列表“编辑机器名”模态框入口；新增 IP 覆盖编辑
- **Deliverables**：可在 UI 完成批量归类与单资产一键维护
- **Time**：1～2 天

### Phase 3: Integration & Testing

**Goal**：验证关键路径与审计

- [ ] API 单测（至少覆盖：成功/字段不存在/scope 不匹配/json 非法/超限）
- [ ] 手工回归：选择 1/50/100 条资产更新字段；检查审计落库
- **Deliverables**：回归记录与可复现测试用例
- **Time**：0.5～1 天

---

**Document Version**: 1.0  
**Created**: 2026-01-30  
**Clarification Rounds**: 3  
**Quality Score**: 94/100
