# M7 User Readonly Access (RBAC + No-Entry UI) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 支持普通用户（user）只读访问资产与 Runs，同时确保敏感面（Sources/Credentials/Raw/治理写/导出/触发 Run）对 user “无入口 + 服务端强制 403”。

**Architecture:** 服务端以 `requireUser/requireAdmin` 做 RBAC 强制；前端按 `GET /api/v1/auth/me` 的 role 控制导航与页面入口，并对 user 深链访问 admin-only 页面执行重定向。

**Tech Stack:** Next.js App Router、Prisma、Vitest、Bun。

## Task 1: API 权限收敛（requireUser/requireAdmin）

**Files:**

- Modify: `src/app/api/v1/assets/route.ts`
- Modify: `src/app/api/v1/assets/[uuid]/route.ts`
- Modify: `src/app/api/v1/assets/[uuid]/relations/route.ts`
- Modify: `src/app/api/v1/assets/[uuid]/source-records/route.ts`
- Modify: `src/app/api/v1/runs/route.ts`
- Modify: `src/app/api/v1/runs/[id]/route.ts`

**Steps:**

1. 将只读接口切换到 `requireUser`（assets/runs/source-records/relations 的 GET）。
2. 保持写/敏感接口为 `requireAdmin`（如 `PUT /api/v1/assets/:uuid`、raw、sources 管理、导出、ledger-fields 写入等）。
3. 运行：`bun run type-check`，确保类型与路由编译通过。

## Task 2: 新增 sources/summary（脱敏）

**Files:**

- Create: `src/app/api/v1/sources/summary/route.ts`

**Steps:**

1. `GET /api/v1/sources/summary` 使用 `requireUser`。
2. 查询仅返回 `enabled=true && deletedAt=null` 的 sources；字段仅包含 `sourceId/name/sourceType/enabled`。
3. 运行：`bun run type-check`。

## Task 3: UI 无入口（导航/首页/深链拦截/Raw 隐藏）

**Files:**

- Modify: `src/app/layout.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/assets/page.tsx`
- Modify: `src/app/assets/[uuid]/page.tsx`
- Modify: `src/app/schedule-groups/page.tsx`
- Modify: `src/app/sources/page.tsx`
- Modify: `src/app/credentials/page.tsx`
- Modify: `src/app/duplicate-candidates/page.tsx`
- Modify: `src/app/api/docs/page.tsx`
- Create: `src/components/auth/require-admin-client.tsx`

**Steps:**

1. RootLayout 读取 server session（`getServerSession()`）按 role 渲染导航：user 仅展示 Assets/Runs（可保留概览）。
2. 首页（`/`）对 user 隐藏 admin-only 卡片入口（schedule-groups/sources），或直接引导到 assets/runs。
3. admin-only 页面（client 页面）统一使用 `RequireAdminClient`：role!=admin 时 `router.replace('/assets')`。
4. `/assets` 的来源筛选改用 `GET /api/v1/sources/summary`。
5. `/assets/[uuid]` 隐藏 raw 查看入口（仅 admin 可见）。
6. 运行：`bun run lint && bun run format:check`。

## Task 4: 测试用例（越权/只读）

**Files:**

- Modify: `src/app/api/v1/assets/route.test.ts`
- Modify: `src/app/api/v1/assets/[uuid]/route.test.ts`
- Modify: `src/app/api/v1/assets/[uuid]/relations/route.test.ts`
- Modify: `src/app/api/v1/assets/[uuid]/source-records/route.test.ts`
- Create: `src/app/api/v1/sources/summary/route.test.ts`
- Create: `src/app/api/v1/runs/route.test.ts`
- Create: `src/app/api/v1/runs/[id]/route.test.ts`

**Steps:**

1. 将只读接口测试 mock 从 `requireAdmin` 改为 `requireUser`。
2. 为 `sources/summary`、`runs`、`runs/:id` 补齐 happy-path 测试（200 + 数据结构）。
3. 运行：`bun run test`。

## Task 5: 文档与进度同步

**Files:**

- Modify: `docs/plans/2026-01-31-post-mvp-m1-m8-m12.progress.md`
- Modify: `README.md`
- Modify: `docs/design/asset-ledger-api-spec.md`

**Steps:**

1. 进度表：将 M7-1~M7-4 状态更新为 DONE，并更新总完成数。
2. README：补充 user 只读入口（Assets/Runs）、admin-only 清单（Sources/Credentials/Raw/导出/治理写/触发 Run）、以及资产历史/导出入口说明。
3. API spec：补齐 `GET /api/v1/assets/:uuid/history`（M12）与 M7 关键接口权限口径（user/admin vs admin-only）。

## Task 6: 验证与提交

**Steps:**

1. 运行：`bun run lint && bun run format:check && bun run type-check && bun run test`
2. 提交：`git commit -am "feat(auth): allow user readonly access (M7)"`（如涉及新增文件，需先 `git add`）
