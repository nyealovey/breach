# Veeam 信号采集 + 资产备份状态展示 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 新增 Veeam（VBR）信号采集来源，并在资产列表/详情页展示备份状态与最近 7 次备份。

**Architecture:** Worker 通过 `plugins/veeam` 直连 VBR REST API 拉取最近 Sessions/TaskSessions，生成 normalized-v1 信号并落库到 `SignalRecord`；`ingestSignalRun` 将备份聚合字段写入 `AssetOperationalState.backup*`；Assets API 将备份字段与最近 7 次备份历史下发到 UI；资产列表“监控”列同时显示 SolarWinds 与 Veeam 两个来源图标（按状态染色）。

**Tech Stack:** Next.js App Router、Prisma、Bun、Vitest、Veeam VBR REST API（OAuth2 password grant）。

---

### Task 1: 实现 `plugins/veeam`（VBR REST API -> collector-response-v1）

**Files:**

- Create: `plugins/veeam/index.ts`
- Create: `plugins/veeam/client.ts`
- Create: `plugins/veeam/normalize.ts`
- Create: `plugins/veeam/types.ts`
- Create: `plugins/veeam/package.json`
- Test: `plugins/veeam/__tests__/normalize.test.ts`

**Steps:**

1. 写 normalize 单测（覆盖：backup attributes、history_last7 截断、ISO 时间字段、normalized-v1 校验）。
2. 运行 `bun run test plugins/veeam/__tests__/normalize.test.ts`，确认先红（函数未实现）。
3. 实现 `normalize.ts`：把 VBR task sessions 聚合为 signal asset（external_id 需稳定；raw_payload 仅存 “最近 7 次”）。
4. 实现 `client.ts`：OAuth2 token + sessions/taskSessions 请求（支持 `tls_verify/timeout_ms/x-api-version/limit`）。
5. 实现 `index.ts`：healthcheck/detect/collect 三模式；collect 输出 `stats.inventory_complete=true`。
6. 再跑测试确认绿。

---

### Task 2: 扩展 `ingestSignalRun` 支持 Veeam，并写入 `backup*` 聚合字段

**Files:**

- Modify: `src/lib/ingest/ingest-signal-run.ts`
- Test: `src/lib/ingest/ingest-signal-run.test.ts`

**Steps:**

1. 写单测（纯函数）：从 normalized.attributes 推导 backupState/lastSuccessAt/lastResult，覆盖 Success/Warning/Failed/Unknown。
2. 运行对应测试先红。
3. 实现：允许 `sourceType in ['solarwinds','veeam']`；对 veeam 解析 backup attributes 并在 transaction 中 upsert `AssetOperationalState.backup*`。
4. 再跑测试确认绿。

---

### Task 3: Assets API 下发备份字段；详情返回最近 7 次备份

**Files:**

- Modify: `src/app/api/v1/assets/route.ts`
- Modify: `src/app/api/v1/assets/[uuid]/route.ts`
- Test: `src/app/api/v1/assets/[uuid]/route.test.ts`（新增）
- Modify: `src/lib/openapi/spec.ts`
- Modify: `src/lib/openapi/spec.test.ts`

**Steps:**

1. 写 API route 单测（mock prisma + mock raw 解压），先红。
2. 实现：assets list item 增加 backup 字段；asset detail 返回 `backupLast7`（从最近的 veeam SignalRecord.raw 解压并裁剪）。
3. 更新 OpenAPI schema：AssetOperationalState/AssetListItem/AssetDetail response。
4. 再跑 `bun run test` 确认全绿。

---

### Task 4: 资产列表“监控”列 UI：SolarWinds 图标调整 + 新增 Veeam 图标

**Files:**

- Create: `src/components/icons/signal-sources.tsx`
- Modify: `src/app/assets/page.tsx`
- (Optional) Create: `src/lib/assets/backup-state.ts`

**Steps:**

1. 实现两个来源小图标（SVG，`currentColor`，支持 `title`）。
2. assets list：monitor 列改为同一单元格渲染两枚图标（SolarWinds: monitor；Veeam: backup），按状态映射颜色，tooltip 展示更新时间/状态细节。
3. 去掉现有“✅/❌”语义作为 SolarWinds 主图标。

---

### Task 5: 资产详情页展示最近 7 次备份

**Files:**

- Modify: `src/app/assets/[uuid]/page.tsx`

**Steps:**

1. 盘点摘要表新增“备份”行（Badge 展示 success/warning/failed/unknown/not_covered）。
2. 新增“最近 7 次备份”表格（时间/结果/作业名/大小/耗时等；缺失显示 `-`）。

---

### Task 6: 文档

**Files:**

- Create: `docs/design/veeam-signal-collector-and-ui.md`
- Modify: `docs/design/asset-ledger-api-spec.md`（如存在）
- Modify: `docs/design/asset-ledger-ui-spec.md`（如存在）

**Steps:**

1. 记录：Veeam Source 配置、normalized/raw 契约、聚合/去重策略、UI 展示规则、后续扩展点。

---

### Task 7: 验证（提交前必须）

Run:

- `bun run type-check`
- `bun run lint`
- `bun run format:check`
- `bun run test`
