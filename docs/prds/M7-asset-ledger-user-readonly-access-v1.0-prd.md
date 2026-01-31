# M7：资产台账系统 - 普通用户（user）只读访问 - 产品需求文档（PRD）

> 目标：在不扩大敏感面（凭证/raw/治理写操作）的前提下，支持普通用户（user）只读访问资产与运行结果，满足 SRS 的角色模型，并保证“无入口 + 强制鉴权 + 可回归”的验收口径。

## Requirements Description

### Background

- **现状问题**：当前 API/UI 基本为 admin-only，无法满足“普通用户只读查看资产与运行结果”的需求。
- **目标用户**：普通用户（user）、管理员（admin）。
- **价值**：
  - 扩大台账可用范围（读权限），降低“信息只在管理员手里”的协作成本。
  - 保持敏感面最小化：user 不可触达凭证、raw、治理写操作与导出。

### Scope / Out of Scope

**In Scope（user 可访问，只读）**

- 资产：
  - `/assets` 列表与筛选/搜索（只读）
  - `/assets/[uuid]` 详情（含 canonical、关系链、来源明细 normalized、台账字段只读展示）
  - 资产历史（M12）：`/assets/[uuid]` 的历史入口（只读）
- 运行结果：
  - `/runs` 列表与 `/runs/[id]` 详情（含错误码与统计；不含 raw 入口）
- 只读所需的辅助数据（避免暴露 config/凭证）：
  - 提供“来源摘要列表”用于筛选（不返回 endpoint/config/credential 信息）

**admin-only（保持不变）**

- Source/凭证/调度组管理（创建/编辑/删除/启停/绑定调度组/更新凭证）
- 手动触发 Run（以及任何会改变系统状态的操作）
- raw payload 查看（SourceRecord raw）
- 重复中心/合并
- 台账字段维护（单资产/批量写入）
- 导出（M8 导出 CSV，下载即失效）

**Out of Scope**

- 组织/多租户隔离。
- 行级/字段级精细权限（一期仅角色级）。

### Success Metrics

- user 可正常浏览资产与运行结果（不依赖管理员代查）。
- user 无法通过任何 UI/URL/API 获取凭证/raw/治理写操作/导出能力（403 + 无入口）。

## Feature Overview

### Core Requirements

1. **鉴权策略（服务端强制）**

- 引入 `requireUser`（或等价）用于只读接口：`user/admin` 均可通过。
- 保持 `requireAdmin` 用于敏感/写接口：凭证、raw、治理写操作、导出、触发 Run 等。
- 严禁“仅靠前端隐藏按钮”的安全策略：所有敏感接口必须服务端校验并返回 403。

2. **UI 可见性（无入口）**

- user 登录后：
  - 导航仅展示可用页面（Assets、Runs）
  - 隐藏/禁用所有 admin-only 操作入口（触发 Run、编辑、导出、重复中心、来源管理等）

3. **数据脱敏与边界**

- user 可见数据必须不包含：
  - 任何凭证信息（明文/密文/credentialId 等敏感引用均不得泄露业务可用信息）
  - raw payload（包括 source_record.raw、relation_record.raw）
  - 来源 config 中的 endpoint 等敏感基础设施信息（见 4.3）

## Detailed Requirements

### 1) 角色模型（对齐 SRS）

以 SRS 为准：`docs/requirements/asset-ledger-srs.md`（2.1 角色定义、2.2 验收标准）。

- admin：管理来源、触发采集、治理（重复/合并）、维护台账字段、导出、查看 raw（脱敏且审计）
- user：只读查看资产列表/详情/关系/历史；可读查看 runs（本 PRD 额外明确），不可触达敏感面

### 2) UI 路由访问矩阵（只读）

| 路由 | admin | user | 说明 |
|---|---:|---:|---|
| `/assets` | ✅ | ✅ | 列表只读 |
| `/assets/[uuid]` | ✅ | ✅ | 详情只读（user 不可编辑任何字段） |
| `/assets/[uuid]` 历史入口（M12） | ✅ | ✅ | 只读时间线（仅展示变化事件） |
| `/runs` | ✅ | ✅ | 列表只读（失败可定位） |
| `/runs/[id]` | ✅ | ✅ | 详情只读（errors/warnings/stats 可见） |
| `/sources` | ✅ | ❌ | user 无入口 |
| `/schedule-groups` | ✅ | ❌ | user 无入口 |
| `/duplicate-center` | ✅ | ❌ | user 无入口 |
| `/exports`（导出） | ✅ | ❌ | user 无入口 |
| raw 查看入口 | ✅ | ❌ | user 无入口 |

> 对 user 访问 admin-only 页面：前端应重定向到 `/assets` 或展示“无权限”页面；后端接口必须返回 403。

### 3) API 权限矩阵（强约束）

> 说明：以下路径以 `docs/design/asset-ledger-api-spec.md` 为基线；本 PRD 仅补齐“谁能访问”的硬约束，并为 user-only 体验新增“来源摘要列表”接口。

#### 3.1 user/admin 均可访问（requireUser）

- `GET /api/v1/auth/me`
- `GET /api/v1/assets`
- `GET /api/v1/assets/:assetUuid`
- `GET /api/v1/assets/:assetUuid/source-records`（仅 normalized；不含 raw）
- `GET /api/v1/assets/:assetUuid/relations`
- `GET /api/v1/runs`
- `GET /api/v1/runs/:runId`
- `GET /api/v1/sources/summary`（新增：用于筛选；不返回 config/endpoint/credential）

#### 3.2 仅 admin 可访问（requireAdmin）

- ScheduleGroup：`/api/v1/schedule-groups*`（全部）
- Source 管理：`POST/PUT/DELETE /api/v1/sources*`、`PUT /api/v1/sources/:sourceId/credential`
- 手动触发采集：`POST /api/v1/sources/:sourceId/runs`
- raw：`GET /api/v1/source-records/:recordId/raw`
- 重复中心：`/api/v1/duplicate-candidates*`（M5）
- 合并：`POST /api/v1/assets/:primaryAssetUuid/merge`（M5）
- 台账字段写入（M8）：所有写接口
- 导出（M8）：`/api/v1/exports/asset-ledger*`
- 资产写接口（例如机器名覆盖等）：`PUT /api/v1/assets/:assetUuid`

### 4) 来源摘要列表（user 可用、无敏感信息）

为满足 SRS “按 source 过滤”且不暴露来源 endpoint/config，新增只读接口：

- `GET /api/v1/sources/summary`

返回（示例）：

```json
{
  "data": [
    { "sourceId": "src_123", "name": "vcenter-prod", "sourceType": "vcenter", "enabled": true }
  ],
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

约束：

- 不返回 `config`（尤其是 endpoint）、不返回 `scheduleGroupId`、不返回任何 credential 信息。
- 默认仅返回 `enabled=true` 且 `deletedAt=null` 的来源（避免 user 看到已删除来源）。

### 5) 只读数据的“敏感字段红线”

#### 5.1 禁止 user 看到的内容（必须）

- 任意凭证相关字段（明文/密文/credentialId 的可用推断信息）
- raw payload（包括 `source_record.raw`、`relation_record.raw`）
- 来源 endpoint（host/URL）等基础设施信息（避免扩大暴露面）

#### 5.2 user 可见但需脱敏/约束的内容（建议）

- `run.errors[].redacted_context`：允许展示“脱敏上下文”（如 http_status、trace_id、mode、source_id），但不得包含 endpoint/host/账号等敏感内容。

## Design Decisions

### Technical Approach

- 采用“服务端 RBAC + 前端无入口”的双保险：
  - 服务端：`requireUser/requireAdmin` 统一封装，所有敏感接口强制 403
  - 前端：根据 `me.role` 控制路由与按钮可见性
- 增加 `GET /sources/summary` 满足 user 侧按来源过滤，同时避免暴露 config/endpoint。

### Constraints

- 一期仅角色级权限（admin/user）；不做多租户、不做字段级权限。
- user 不允许任何写操作（包括触发采集、编辑资产覆盖字段、写台账字段、合并/忽略、导出）。

### Risk Assessment

- **越权风险**：仅隐藏按钮不够。缓解：服务端统一中间件校验 + e2e 覆盖 403 用例。
- **信息泄露风险**：Source API 可能包含 endpoint/config。缓解：user 仅使用 `sources/summary`；`sources` 保持 admin-only。
- **回归风险**：后续新增 API 忘记加权限。缓解：在 API spec 中强制标注权限，并在 lint/测试中加入“默认 requireAdmin，显式放开”策略（工程落地项）。

## Acceptance Criteria

### Functional Acceptance

- [ ] user 可访问 `/assets` 与 `/assets/[uuid]`（只读），并可查看关系链与来源明细（normalized）。
- [ ] user 可访问 `/runs` 与 `/runs/[id]`（只读），可查看 errors/warnings/stats（脱敏）。
- [ ] user 可调用 `GET /api/v1/sources/summary` 获取来源列表用于筛选（不含 config/endpoint/credential）。
- [ ] user 不能触发采集（`POST /api/v1/sources/:sourceId/runs` 返回 403）。
- [ ] user 不能编辑资产（`PUT /api/v1/assets/:assetUuid` 返回 403）。

### Security Acceptance（必须为 403 + 无入口）

- [ ] user 访问 Source 管理相关 API（create/update/delete/credential）均返回 403，且 UI 无入口。
- [ ] user 访问 raw API（`GET /api/v1/source-records/:recordId/raw`）返回 403，且 UI 无入口。
- [ ] user 访问重复中心/合并/台账字段写入/导出相关 API 均返回 403，且 UI 无入口。

### Quality Standards

- [ ] 所有 403 均返回稳定错误码 `AUTH_FORBIDDEN`（不依赖 message 文本判断）。
- [ ] 文档同步：在 `docs/design/asset-ledger-api-spec.md` 补充 `sources/summary`，并标注主要接口的权限口径。

## Execution Phases

### Phase 1: API 权限收敛（requireUser/requireAdmin）

- [ ] 为只读接口切换到 `requireUser`（assets/runs 等）
- [ ] 为敏感/写接口强制 `requireAdmin`（sources/credential/raw/trigger/duplicate/merge/ledger-fields/export）

### Phase 2: sources/summary（最小接口）

- [ ] 新增 `GET /api/v1/sources/summary`（无 config/endpoint/credential）
- [ ] 前端 `/assets` 使用该接口提供“按来源过滤”UI

### Phase 3: 前端无入口 + 深链处理

- [ ] user 导航隐藏 admin-only 页面入口
- [ ] user 直接访问 admin-only 页面时：前端友好提示并跳转；后端接口保持 403

### Phase 4: 回归用例（越权为主）

- [ ] e2e：user 访问 assets/runs 正常；访问 sources/raw/export/duplicate/merge/trigger 均为 403
- [ ] 回归：admin 行为不变

---

**Document Version**: 1.0
**Created**: 2026-01-30
**Clarification Rounds**: 0
**Quality Score**: 100/100
