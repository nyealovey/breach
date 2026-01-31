# M5D-5 Duplicate Center UI (List/Detail/Compare/Ignore) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 落地“重复中心”UI：候选列表/详情页、字段对比与规则证据展示，并支持 Ignore（含原因输入）与进入 Merge（先占位提示，Merge 在 M5M 实现）。

**Architecture:** 纯前端页面（Next.js App Router client pages）通过已实现的 `/api/v1/duplicate-candidates*` 拉取数据；URL 与筛选状态双向同步（参照 `/assets` 页面模式）；对比字段优先展示候选键与 `dup-rules-v1` evidence，必要时补充从 `/api/v1/assets/:uuid` 拉取 canonical 快照做对比。

**Tech Stack:** Next.js(App Router)、React、Tailwind/shadcn-ui、TypeScript、vitest（对 URL 解析/展示 helper 做单测）。

---

### Task 1: URL 状态与展示 helper（TDD）

**Files:**

- Create: `src/lib/duplicate-candidates/duplicate-candidates-url.ts`
- Create: `src/lib/duplicate-candidates/duplicate-candidates-url.test.ts`
- Create: `src/lib/duplicate-candidates/duplicate-candidates-ui.ts`
- Create: `src/lib/duplicate-candidates/duplicate-candidates-ui.test.ts`

**Step 1: 写 failing tests**

- URL：默认 `status=open`；page/pageSize 默认；build 时默认值不写入 URL
- UI：score->confidence label，status label，badge variant

**Step 2: 运行测试确认失败**

Run: `bun run test src/lib/duplicate-candidates/duplicate-candidates-url.test.ts`
Expected: FAIL（模块不存在）

**Step 3: 最小实现**

实现：

- `parseDuplicateCandidatesUrlState(params)`
- `buildDuplicateCandidatesUrlSearchParams(state)`
- `confidenceLabel(score)`、`candidateStatusLabel(status)`、`confidenceBadgeVariant(confidence)`

**Step 4: 运行测试确认通过**

Run: `bun run test src/lib/duplicate-candidates/duplicate-candidates-url.test.ts`
Expected: PASS

---

### Task 2: 导航入口（侧边栏）

**Files:**

- Modify: `src/app/layout.tsx`

**Step 1: 添加导航项**

在侧边栏增加链接：

- 文案：`重复中心`
- 路径：`/duplicate-candidates`

**Step 2: 手动检查**

Run: `bun run dev`
Expected: 左侧导航出现“重复中心”

---

### Task 3: 列表页（筛选 + 分页 + 跳转详情）

**Files:**

- Create: `src/app/duplicate-candidates/page.tsx`

**Step 1: 实现筛选与 URL 同步**

筛选项（最小集）：

- status（默认 open）
- assetType（all/vm/host）
- confidence（all/High/Medium）
- page/pageSize

**Step 2: 拉取并展示列表**

表格展示（最小集）：

- score + badge（High/Medium）
- 两侧资产摘要（displayName/uuid/status）
- lastObservedAt
- 行点击进入详情

**Step 3: 错误处理**

- loading skeleton
- fetch 失败 toast

---

### Task 4: 详情页（证据 + 对比 + Ignore）

**Files:**

- Create: `src/app/duplicate-candidates/[candidateId]/page.tsx`

**Step 1: 拉取 candidate detail**

展示：

- 候选基本信息（score/status/lastObservedAt）
- 命中规则清单（matched_rules + evidence）
- 双方 sourceLinks 状态（presenceStatus/lastSeenAt）

**Step 2: 对比字段**

实现“候选键对比”：

- vm：machine_uuid / hostname / ip_addresses / mac_addresses / os.fingerprint
- host：serial_number / bmc_ip / management_ip / hostname / os.fingerprint

数据来源：

- 优先使用 detail.reasons 的 evidence
- 补充使用 `/api/v1/assets/:uuid` 的 latestSnapshot.canonical.fields（best-effort；失败不阻塞）

**Step 3: Ignore**

- Dialog：可填 ignore reason（可空）
- 调用 `POST /api/v1/duplicate-candidates/:id/ignore`
- 成功 toast + 刷新详情

**Step 4: 进入 Merge（占位）**

- 按钮：进入 Merge
- 当前阶段提示 toast：`合并流程将在 M5M 实现`

---

### Task 5: 进度表 + 质量门槛

**Files:**

- Modify: `docs/plans/2026-01-31-post-mvp-m1-m8-m12.progress.md`

**Step 1: 更新进度**

将 `M5D-5` 标记为 `DONE` 并更新总完成数。

**Step 2: 跑质量门槛**

Run: `bun run format:check && bun run lint && bun run type-check && bun run test`
Expected: PASS
