# 资产台账系统 - 凭据模块与调度组手动运行 - 产品需求文档（PRD）

> 本 PRD 用于补齐 vCenter MVP 的两项增量能力：
>
> 1. **凭据模块**：凭据独立于 Source，可复用到多个来源（一个 Source 至多绑定一个凭据）。
> 2. **调度组手动运行**：每个调度组在列表行提供「运行」按钮，一键为该组下可运行的来源批量创建 `collect` Run。
>
> 完整需求口径仍以 `docs/requirements/asset-ledger-srs.md` 为准；本 PRD 仅定义本次新增/变更点。

## Requirements Description

### Background

- **Business Problem**：当前 MVP 将凭据“内嵌在 Source”中，无法复用；同时调度组缺少“手动一键运行”入口，管理员操作成本高。
- **Target Users**：仅管理员（admin）。
- **Value Proposition**：降低配置与重复维护成本（凭据复用/统一管理），提升运维效率（调度组一键批量触发采集）。

### Feature Overview

#### Core Features（本次增量）

1. **凭据模块（Credentials）**

- 新增凭据实体：管理员可创建/编辑/删除凭据。
- 一个凭据可关联多个来源（Source）；一个来源至多绑定一个凭据（可为空）。
- 凭据按 `SourceType` 多类型，字段随类型变化；凭据内容加密存储，UI 与 API 均不回显明文。

2. **调度组手动运行（Schedule Group Manual Run）**

- 调度组列表每一行提供「运行」按钮。
- 点击后为该调度组下所有 **enabled 且满足条件** 的 Source 批量创建 `collect` Run（`triggerType=manual`）。
- 遵循单飞：若某 Source 已存在 `Queued/Running` Run，则跳过该 Source（不重复入队）。

#### Feature Boundaries（明确不做什么）

- 不引入“多凭据绑定同一 Source”的能力（一个 Source 仅 0/1 个 Credential）。
- 不提供“查看/导出明文凭据”的能力（安全要求）。
- 不做历史数据迁移：不将旧的 `Source.credentialCiphertext` 迁移为 `Credential`，且新实现不再读取旧字段（管理员需在新模块中重新创建凭据并绑定）。

### User Scenarios

1. 管理员在「凭据」页面创建 vCenter 凭据（username/password），命名为“生产 vCenter 账号”。
2. 管理员在多个 vCenter Source 上选择该凭据进行绑定（复用）。
3. 管理员在「调度组」列表对某调度组点击「运行」：系统为该组下可运行的 Source 批量创建 `collect` Run。
4. 管理员在「运行」列表/详情查看本次批量触发的 Run，并在「资产」页查看采集结果。

## Detailed Requirements

### 1) 凭据模块（Credentials）

#### 1.1 凭据类型与字段（按 SourceType 对齐）

- `vcenter` / `pve` / `hyperv`：`username` + `password`
- `aliyun`：`accessKeyId` + `accessKeySecret`
- `third_party`：`token`

约束：

- `Credential.type` 必须与被绑定的 `Source.sourceType` **一致**（UI 仅展示同类型凭据；API 必须校验）。

#### 1.2 安全与存储

- 凭据明文字段仅在“创建/更新”时由管理员输入；任何查询接口均不返回明文 secret。
- 持久化时将 payload（按 type 的字段集合）序列化为 JSON 后，用 AES-256-GCM 加密写入数据库。
- `PASSWORD_ENCRYPTION_KEY` 为 **base64 的 32 bytes key**（base64 解码后长度必须为 32 字节），且要求长期固定值；本期不支持 key 轮换，否则将无法解密已保存凭据。

#### 1.3 CRUD 行为

- 创建凭据：需要 `name`（表内唯一）+ `type` + `payload`（按类型字段）。
  - **唯一性约束**：`Credential.name` 在凭据表内全局唯一，不区分 `type`（不做跨资源/跨表重名限制）。
- 编辑凭据：允许修改 `name`；允许"更新密钥/密码"（输入新的 payload 覆盖旧值），不回显旧 secret。
  - **生效时机**：凭据更新后立即生效；已绑定的 Source 在下次采集时自动使用新凭据（无需重新绑定）。
- 删除凭据：
  - 若仍有任何未删除 Source（`Source.deletedAt IS NULL`）引用该凭据：**禁止删除**（返回 409，错误码 `CONFIG_RESOURCE_CONFLICT`）。
  - 仅当 `usageCount=0`（无引用，且仅统计 `Source.deletedAt IS NULL`）时允许删除。

#### 1.4 Source 绑定行为

Source 创建/编辑时可选绑定 `credentialId`（可为空）。

- 绑定时校验：
  - Credential 必须存在；
  - Credential.type 必须等于 Source.sourceType；
- 解绑：将 Source.credentialId 置空。

### 2) 调度组手动运行（Schedule Group Manual Run）

#### 2.1 入口与默认行为

- 入口：`/schedule-groups` 列表页，每行一个「运行」按钮。
- 点击后执行批量入队：
  - 仅对该组下 `deletedAt IS NULL AND enabled=true` 的 Source 进行处理；
  - 仅创建 `collect` Run（mode 固定为 `collect`）；
  - `triggerType=manual`；
  - 调度组本身 `enabled=false` 时也允许手动运行（但仍只处理 Source.enabled=true 的来源）。

#### 2.2 跳过规则（必须明确）

对每个候选 Source：

- 若 `credentialId` 为空：**跳过**（不创建 Run），计入 `skipped_missing_credential`；
- 若存在活动 Run（`Queued/Running`）：**跳过**，计入 `skipped_active`；
- 其余：创建 `Queued` 的 Run，计入 `queued`。

当没有任何可入队 Source 时：

- API 返回 200，并返回 `queued=0`；同时给出可读 `message`（例如“无可入队来源：可能均未配置凭据或存在活动 Run”）。

### 3) API（配套 OpenAPI/Swagger）

> 本节只定义关键行为与约束；具体 schema 以实现时的 Zod 为单一来源，并纳入 OpenAPI 生成。

#### 3.1 Credentials API（admin-only）

- `GET /api/v1/credentials`：列表
  - **查询参数**：
    - `type`：按凭据类型过滤（vcenter/pve/hyperv/aliyun/third_party）
    - `q`：按 `name` 模糊搜索（不区分大小写，包含匹配）
    - `page`：页码，默认 `1`（从 1 开始）
    - `pageSize`：每页条数，默认 `20`（最大 100）
    - `sortBy`：排序字段，默认 `updatedAt`（可选：`name`/`type`/`usageCount`/`createdAt`/`updatedAt`）
    - `sortOrder`：排序方向，默认 `desc`（可选：`asc`/`desc`）
  - **响应**：返回不含明文 secret；包含 `pagination` 对象
- `POST /api/v1/credentials`：创建（写入加密 payload）
- `GET /api/v1/credentials/:id`：详情（包含 `usageCount`，仅统计 `Source.deletedAt IS NULL` 的引用；不含明文）
- `PUT /api/v1/credentials/:id`：更新（可改 `name`；可覆盖更新 payload）
- `DELETE /api/v1/credentials/:id`：删除（usageCount>0 返回 409，错误码 `CONFIG_RESOURCE_CONFLICT`）

#### 3.2 Source API 变更（admin-only）

- Source create/update 需要支持传入 `credentialId`（可空）。
- Source list/detail 需要返回 credential 摘要（`credentialId/name/type`，不含明文）。
- 原 `PUT /api/v1/sources/:id/credential` 与旧 UI 的“更新凭据”入口将不再作为对外能力（以新模块为准）。

#### 3.3 Schedule Group 手动运行 API（admin-only）

- `POST /api/v1/schedule-groups/:id/runs`
  - 批量创建 Run（collect/manual）
  - **并发控制**：使用数据库事务 + `FOR UPDATE SKIP LOCKED` 确保并发安全；同一 Source 的活动 Run 检查与新 Run 创建在同一事务内完成，避免竞态条件导致重复入队。
  - 返回：`queued`、`skipped_active`、`skipped_missing_credential`、`message?`

### 4) Web UI

#### 4.1 导航与页面

- 左侧导航新增「凭据」入口：
  - `/credentials`：凭据列表（展示 name/type/usageCount/updatedAt；支持删除与进入编辑）
  - `/credentials/new`：新建凭据（按 type 渲染不同表单字段）
  - `/credentials/[id]/edit`：编辑凭据（不回显 secret；支持“更新密钥/密码”）

#### 4.2 Source 表单改造

- `/sources/new` 与 `/sources/[id]/edit` 增加“选择凭据”下拉：
  - 仅展示与 SourceType 一致的凭据
  - 允许不选择（credentialId=null）
- 移除旧的“更新凭据”表单区域（避免与新模块并存造成混乱）。
- 若 Source.enabled=true 且未绑定凭据：
  - 在 UI 给出明显提示（例如“未配置凭据，无法参与运行/调度”）。

#### 4.3 调度组列表运行按钮

- `/schedule-groups` 列表每行新增按钮「运行」：
  - 点击后调用 `POST /api/v1/schedule-groups/:id/runs`
  - 以 toast 显示结果（queued / skipped_active / skipped_missing_credential）

## Acceptance Criteria

### Functional Acceptance

- [ ] 凭据：管理员可创建/编辑/删除 Credential；CRUD 全程不回显明文 secret。
- [ ] 复用：同一个 Credential 可被多个 Source 绑定；一个 Source 至多绑定一个 Credential（可为空）。
- [ ] 一致性：SourceType 与 CredentialType 必须一致（UI 与 API 均校验）。
- [ ] 删除限制：Credential 仍被 Source 引用时禁止删除（409）。
- [ ] 调度组手动运行：调度组列表每行有「运行」按钮；点击后批量创建 `collect` Run（manual）。
- [ ] 跳过规则：enabled Source 未绑定凭据则跳过；存在活动 Run 则跳过；无可入队时返回 200 且 queued=0。

### Quality Standards

- [ ] 代码质量：通过 `bun run lint`、`bun run format:check`、`bun run type-check`。
- [ ] 测试：新增 API/核心逻辑均有 Vitest 覆盖；E2E 流程更新覆盖新“凭据模块 + 调度组运行按钮”路径。
- [ ] 安全：日志与 API 响应中不出现任何明文凭据；UI 不提供明文查看能力。
- [ ] 文档：README 与 `docs/index.md` 增加本 PRD 链接；OpenAPI/Swagger 包含新增接口。

## Execution Phases

### Phase 1: Data Model & Migration Decisions

**Goal**：引入 Credential 实体与 Source 关联，明确不迁移策略与兼容边界。

- [ ] Prisma：新增 `Credential` 模型 + `Source.credentialId`
- [ ] 明确废弃 `Source.credentialCiphertext` 的读取路径（不迁移、不 fallback）
- **Deliverables**：迁移文件、数据模型更新、文档说明

### Phase 2: API & UI

**Goal**：交付凭据模块 UI + Source 绑定 + 调度组手动运行入口。

- [ ] Credentials API（含 usageCount / 删除限制）
- [ ] Source 表单增加 credential 选择；移除旧更新凭据入口
- [ ] Schedule group 手动运行 API + 列表按钮
- **Deliverables**：页面与 API 完整可用

### Phase 3: Tests & Docs

**Goal**：补齐测试、更新 OpenAPI/Swagger 与文档。

- [ ] Vitest：credentials + schedule group runs + source binding
- [ ] Playwright：更新 happy path（使用凭据模块、调度组一键运行）
- [ ] 文档与 OpenAPI 更新

---

**Document Version**: 1.2
**Created**: 2026-01-28
**Updated**: 2026-01-28
**Clarification Rounds**: 7
**Quality Score**: 100/100

### Appendix: Clarification Summary

本次补充澄清了以下细节：

#### v1.0 → v1.1

| 维度             | 原状态           | 补充内容                                                                       |
| ---------------- | ---------------- | ------------------------------------------------------------------------------ |
| 凭据名称唯一性   | 仅说明"唯一"     | 明确为"全局唯一"，与 `schedule_group.name` 一致                                |
| 凭据更新生效时机 | 未说明           | 明确"立即生效，已绑定 Source 下次采集自动使用新凭据"                           |
| API 分页参数     | 仅说明"建议支持" | 明确 `page=1`、`pageSize=20`（最大 100）、`sortBy=updatedAt`、`sortOrder=desc` |
| API 排序字段     | 未说明           | 明确可选字段：`name/type/usageCount/createdAt/updatedAt`                       |
| 并发控制         | 未说明           | 明确使用事务 + `FOR UPDATE SKIP LOCKED` 避免竞态条件                           |
| 错误码           | 仅说明"返回 409" | 明确错误码为 `CONFIG_RESOURCE_CONFLICT`，与 API 规范对齐                       |

#### v1.1 → v1.2

| 维度                    | v1.1 状态                   | v1.2 补充内容                                                              |
| ----------------------- | --------------------------- | -------------------------------------------------------------------------- |
| 凭据名称唯一性口径      | 误写为“跨表全局唯一”        | 更正为“仅 Credential 表内唯一，不做跨资源/跨表重名限制”                    |
| usageCount/删除限制口径 | 未说明是否排除软删除 Source | 明确只统计 `Source.deletedAt IS NULL` 的引用                               |
| 加密 key 规格           | 仅说明“长期固定”            | 明确 `PASSWORD_ENCRYPTION_KEY` 为 base64 的 32 bytes key，且本期不支持轮换 |
