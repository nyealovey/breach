# M5D-4 Duplicate Center API (List/Detail/Ignore + Audit) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现“重复中心”后端 API：候选列表/详情/忽略（含审计事件写入），并补齐 OpenAPI/文档与进度表。

**Architecture:** 在 Next.js App Router 下新增 `duplicate-candidates` API 路由；读取 `DuplicateCandidate`/`Asset`/`AssetSourceLink` 组合数据用于列表与详情；Ignore 通过 `updateMany(where: {id, status:'open'})` 实现幂等并保证审计事件只写一次。

**Tech Stack:** Next.js(App Router)、TypeScript、Prisma(Postgres)、zod、vitest。

---

### Task 1: 错误码扩展（DuplicateCandidate not found）

**Files:**

- Modify: `src/lib/errors/error-codes.ts`
- Modify: `docs/design/asset-ledger-error-codes.md`

**Step 1: 写 failing test（引用新错误码常量）**

在 `src/lib/errors/error-codes.test.ts` 增加断言：

```ts
expect(ErrorCode.CONFIG_DUPLICATE_CANDIDATE_NOT_FOUND).toBe('CONFIG_DUPLICATE_CANDIDATE_NOT_FOUND');
```

**Step 2: 运行测试确认失败**

Run: `bun run test src/lib/errors/error-codes.test.ts`
Expected: FAIL（缺少新错误码）

**Step 3: 实现错误码 + 文档注册**

- 在 `src/lib/errors/error-codes.ts` 增加 `CONFIG_DUPLICATE_CANDIDATE_NOT_FOUND`
- 在 `docs/design/asset-ledger-error-codes.md` 注册该错误码（web/config/404）

**Step 4: 运行测试确认通过**

Run: `bun run test src/lib/errors/error-codes.test.ts`
Expected: PASS

---

### Task 2: GET /api/v1/duplicate-candidates（列表 + 过滤 + 分页）

**Files:**

- Create: `src/app/api/v1/duplicate-candidates/route.ts`
- Create: `src/app/api/v1/duplicate-candidates/route.test.ts`

**Step 1: 写 failing tests**

覆盖最小行为：

- 未 admin → 返回 requireAdmin 的响应（401/403）
- 默认 `status=open`
- `confidence=High` → `score >= 90`；`confidence=Medium` → `70 <= score < 90`
- 返回 okPaginated + `X-Request-ID`

**Step 2: 运行测试确认失败**

Run: `bun run test src/app/api/v1/duplicate-candidates/route.test.ts`
Expected: FAIL（route 不存在）

**Step 3: 写最小实现**

实现查询参数：

- `page/pageSize`：复用 `parsePagination`
- `status`：`open|ignored|merged`（默认 open）
- `assetType`：`vm|host`（可选）
- `confidence`：`High|Medium`（可选）

查询：

- `DuplicateCandidate.count/findMany`（transaction）
- include `assetA/assetB` 的最小摘要字段（uuid/displayName/assetType/status/lastSeenAt）
- 排序：`lastObservedAt desc` + `score desc`

**Step 4: 运行测试确认通过**

Run: `bun run test src/app/api/v1/duplicate-candidates/route.test.ts`
Expected: PASS

---

### Task 3: GET /api/v1/duplicate-candidates/:candidateId（详情）

**Files:**

- Create: `src/app/api/v1/duplicate-candidates/[candidateId]/route.ts`
- Create: `src/app/api/v1/duplicate-candidates/[candidateId]/route.test.ts`

**Step 1: 写 failing tests**

- 404：candidate 不存在 → `CONFIG_DUPLICATE_CANDIDATE_NOT_FOUND`
- 200：返回 candidate（含 reasons）+ 双方 asset 概要 + 双方 sourceLinks（presenceStatus/lastSeenAt/lastSeenRunId）

**Step 2: 运行测试确认失败**

Run: `bun run test src/app/api/v1/duplicate-candidates/[candidateId]/route.test.ts`
Expected: FAIL

**Step 3: 写最小实现**

- `DuplicateCandidate.findUnique` include assetA/assetB
- `AssetSourceLink.findMany` where assetUuid in [A,B]，select sourceId/source.name/presenceStatus/lastSeenAt/lastSeenRunId/externalKind/externalId
- 分组拼装为 detail 响应

**Step 4: 运行测试确认通过**

Run: `bun run test src/app/api/v1/duplicate-candidates/[candidateId]/route.test.ts`
Expected: PASS

---

### Task 4: POST /api/v1/duplicate-candidates/:candidateId/ignore（幂等 Ignore + 审计）

**Files:**

- Create: `src/app/api/v1/duplicate-candidates/[candidateId]/ignore/route.ts`
- Create: `src/app/api/v1/duplicate-candidates/[candidateId]/ignore/route.test.ts`

**Step 1: 写 failing tests**

覆盖：

- 404：candidate 不存在
- 400：body 非法（不是 JSON / reason 非 string）
- 200：status=open → ignored（updateMany count=1）并写 `auditEvent.create`（eventType=`duplicate_candidate.ignored`，payload 包含 candidateId/assetUuidA/assetUuidB/ignoreReason/requestId）
- 幂等：已 ignored 时 updateMany count=0，不再写审计

**Step 2: 运行测试确认失败**

Run: `bun run test src/app/api/v1/duplicate-candidates/[candidateId]/ignore/route.test.ts`
Expected: FAIL

**Step 3: 写最小实现**

- `requireAdmin`
- Zod body：`{ reason?: string }`（trim，空串→null）
- 先 `findUnique`；若不存在 → 404
- `updateMany(where: {id, status:'open'})`；count=1 才写审计
- 返回 `ok({ candidateId, status, ignoredAt, ignoreReason })`

**Step 4: 运行测试确认通过**

Run: `bun run test src/app/api/v1/duplicate-candidates/[candidateId]/ignore/route.test.ts`
Expected: PASS

---

### Task 5: OpenAPI + 文档同步

**Files:**

- Modify: `src/lib/openapi/spec.ts`
- Modify: `docs/design/asset-ledger-api-spec.md`

**Step 1: OpenAPI 增加 3 个路径**

- `GET /api/v1/duplicate-candidates`
- `GET /api/v1/duplicate-candidates/{candidateId}`
- `POST /api/v1/duplicate-candidates/{candidateId}/ignore`

**Step 2: 文档补齐**

在 `docs/design/asset-ledger-api-spec.md` 增加 “Duplicate Candidates” 小节，描述 query/body/响应字段与权限。

**Step 3: 运行 OpenAPI 测试**

Run: `bun run test src/lib/openapi/spec.test.ts`
Expected: PASS

---

### Task 6: 进度表 + 质量门槛

**Files:**

- Modify: `docs/plans/2026-01-31-post-mvp-m1-m8-m12.progress.md`

**Step 1: 更新进度**

将 `M5D-4` 标记为 `DONE` 并更新总完成数。

**Step 2: 跑质量门槛**

Run: `bun run format:check && bun run lint && bun run type-check && bun run test`
Expected: PASS
