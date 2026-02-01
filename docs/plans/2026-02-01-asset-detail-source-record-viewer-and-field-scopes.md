# Asset Detail: Source Record Viewer + Field Scopes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在资产详情页中，“查看 normalized/查看 raw”不再在页面内/弹窗内展示，而是跳转到独立页面查看；并且资产详情页按资产类型隐藏不适用字段（VM 不展示 Host 专用字段，Host 不展示 VM 专用字段）。

**Architecture:** 新增只读 API `GET /api/v1/source-records/:recordId/normalized`；新增页面路由 `/source-records/:recordId`（通过 query `tab=normalized|raw` 切换）；资产详情页将两个按钮改为链接跳转，并对“台账字段”和“字段（结构化）”按 assetType 做过滤。

**Tech Stack:** Next.js(App Router)、React、TypeScript、Prisma、vitest（API route 单测）。

---

### Task 1: 新增 normalized 查看 API（TDD）

**Files:**

- Create: `src/app/api/v1/source-records/[recordId]/normalized/route.ts`
- Create: `src/app/api/v1/source-records/[recordId]/normalized/route.test.ts`

**Step 1: 写 failing test**

- 未登录：透传 `requireUser` 的失败响应
- 已登录：
  - 记录不存在：返回 404（`CONFIG_SOURCE_RECORD_NOT_FOUND`）
  - 记录存在：返回 200 + `X-Request-ID`，data 包含 `normalizedPayload` 与 meta（recordId/assetUuid/sourceId/runId/collectedAt/externalKind/externalId）

**Step 2: 运行测试确认失败**
Run: `bun run test src/app/api/v1/source-records/[recordId]/normalized/route.test.ts`
Expected: FAIL（route 不存在）

**Step 3: 最小实现 route**

- `requireUser` 校验
- Prisma `sourceRecord.findFirst`（按 `collectedAt desc`）查找 record
- `ok()` 返回

**Step 4: 运行测试确认通过**
Run: `bun run test src/app/api/v1/source-records/[recordId]/normalized/route.test.ts`
Expected: PASS

---

### Task 2: 新增 Source Record 查看页面（跳出模态框）

**Files:**

- Create: `src/app/source-records/[recordId]/page.tsx`

**Step 1: UI/交互**

- 顶部显示 recordId + 返回按钮（优先返回资产详情 `assetUuid` query，其次返回 `/assets`）
- Tabs：`tab=normalized|raw`（默认 normalized）
- normalized：调用 `GET /api/v1/source-records/:recordId/normalized`
- raw：调用 `GET /api/v1/source-records/:recordId/raw`（沿用 admin-only 权限）
- 两种视图都提供“复制 JSON”按钮

**Step 2: 手动冒烟**
Run: `bun run dev`
Expected: 从资产详情点击两按钮可跳转打开并正常展示

---

### Task 3: 资产详情页改造：按钮跳转 + 按资产类型隐藏字段

**Files:**

- Modify: `src/app/assets/[uuid]/page.tsx`

**Step 1: 来源明细**

- “查看 normalized/查看 raw”改为 `Link` 跳转 `/source-records/:recordId?assetUuid=:uuid&tab=...`
- 删除页面内的 normalized 预览区域与 raw Dialog 的 state/组件

**Step 2: 字段范围**

- “台账字段”：只渲染 `isLedgerFieldAllowedForAssetType(meta, asset.assetType)` 为 true 的字段行
- “字段（结构化）”：按 `asset.assetType` 过滤 groupA：VM 仅展示 common/vm/attributes/unknown；Host 仅展示 common/host/attributes/unknown；Cluster 仅展示 common/cluster/attributes/unknown

---

### Task 4: 文档同步（README）

**Files:**

- Modify: `README.md`

**Step 1: 补充说明**

- 资产详情页的 normalized/raw 查看已改为页面跳转（不再在弹窗/页面内展开）

---

### Task 5: 全量校验

**Step 1: 单测**
Run: `bun run test`
Expected: PASS

**Step 2: TypeScript 类型检查**
Run: `bun run type-check`
Expected: PASS

**Step 3: Lint + 格式**
Run: `bun run lint`
Expected: PASS

Run: `bun run format:check`
Expected: PASS
