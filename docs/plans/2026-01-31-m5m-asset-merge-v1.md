# M5M Asset Merge (Manual Merge + Audit) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现管理员人工合并（Merge）：同类资产合并、VM 合并门槛（primary in_service + secondary offline）、数据迁移（source_link/source_record/relation）、审计（merge_audit + audit_event）、并完成 UI 合并确认页（从重复中心进入）。

**Architecture:** 以 `POST /api/v1/assets/:primaryAssetUuid/merge` 为唯一写入口；后端在单个 DB transaction 中完成校验与迁移，并写入 `merge_audit` + `audit_event`；前端从重复中心候选详情进入合并确认页，展示对比与策略说明后发起合并。

**Tech Stack:** Next.js(App Router)、React、Tailwind/shadcn-ui、Prisma(PostgreSQL)、TypeScript、vitest。

---

### Task 1: Prisma 数据模型（merge_audit + enum）+ 迁移脚本（TDD）

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_merge_audit/migration.sql`
- Create: `src/lib/merge/prisma-schema.test.ts`

**Step 1: 写 failing test（enum 存在）**

`src/lib/merge/prisma-schema.test.ts`

```ts
import { expect, it } from 'vitest';
import { MergeConflictStrategy } from '@prisma/client';

it('exports MergeConflictStrategy enum (merge schema)', () => {
  expect(MergeConflictStrategy.primary_wins).toBe('primary_wins');
});
```

**Step 2: 运行测试确认失败**

Run: `bun run test src/lib/merge/prisma-schema.test.ts`
Expected: FAIL（@prisma/client 不存在 MergeConflictStrategy 导出）

**Step 3: 最小实现（schema + migration）**

- 在 `prisma/schema.prisma` 新增：
  - enum `MergeConflictStrategy`：`primary_wins` / `latest_wins` / `manual_pick`
  - model `MergeAudit`（至少包含：primary_asset_uuid / merged_asset_uuid / performed_by / performed_at / conflict_strategy / summary / snapshot_ref）
- 增加必要索引（primary/merged + performed_at）
- 新增 migration.sql（CREATE TYPE / CREATE TABLE / indexes / FKs）

**Step 4: 生成 Prisma Client**

Run: `bun run db:generate`
Expected: SUCCESS（node_modules/@prisma/client 更新，类型包含 MergeAudit / MergeConflictStrategy）

**Step 5: 运行测试确认通过**

Run: `bun run test src/lib/merge/prisma-schema.test.ts`
Expected: PASS

---

### Task 2: 合并 API 路由（校验/错误码/日志）骨架（TDD）

**Files:**

- Create: `src/app/api/v1/assets/[uuid]/merge/route.ts`
- Create: `src/app/api/v1/assets/[uuid]/merge/route.test.ts`
- Modify (如需要): `src/lib/errors/error-codes.ts`

**Step 1: 写 failing tests（核心校验分支）**

覆盖最小错误分支：

- 404：primary 不存在（`CONFIG_ASSET_NOT_FOUND`）
- 400：asset_type 不一致（`CONFIG_ASSET_MERGE_ASSET_TYPE_MISMATCH`）
- 400：VM 门槛不满足（`CONFIG_ASSET_MERGE_VM_REQUIRES_OFFLINE`）
- 400：环检测（`CONFIG_ASSET_MERGE_CYCLE_DETECTED`）

**Step 2: 运行测试确认失败**

Run: `bun run test src/app/api/v1/assets/[uuid]/merge/route.test.ts`
Expected: FAIL（模块不存在）

**Step 3: 最小实现（只做 auth + body 校验 + 基本 404/400 返回）**

- `requireAdmin` 校验
- body schema：`{ mergedAssetUuids: string[], conflictStrategy?: 'primary_wins' }`
- 校验 mergedAssetUuids 非空、去重、禁止包含 primary

**Step 4: 运行测试确认通过**

Run: `bun run test src/app/api/v1/assets/[uuid]/merge/route.test.ts`
Expected: PASS（至少上述 error-path 测试通过）

---

### Task 3: 合并事务（数据迁移 + merge_audit + audit_event + 候选联动）（TDD）

**Files:**

- Modify: `src/app/api/v1/assets/[uuid]/merge/route.ts`
- Modify: `src/lib/openapi/spec.ts`
- Modify: `docs/design/asset-ledger-api-spec.md`

**Step 1: 扩充测试（Happy Path：vm/host）**

在 `route.test.ts` 增加：

- 成功合并：primary 更新保持、secondary 变 merged + merged_into_asset_uuid 指向 primary
- asset_source_link 迁移：secondary links 更新 asset_uuid=primary
- source_record 迁移：secondary records 更新 asset_uuid=primary
- relation 重定向：from/to 指向 secondary 的关系都改成 primary；并去重；自环删除
- duplicate_candidate：涉及 primary/secondary 的候选 status=merged
- merge_audit + audit_event 写入（包含 requestId、primary/secondary 列表、migrated counts）

**Step 2: 跑测试确认失败**

Run: `bun run test src/app/api/v1/assets/[uuid]/merge/route.test.ts`
Expected: FAIL（未实现对应 prisma 调用）

**Step 3: 最小实现（transaction）**

- 使用 `prisma.$transaction(async (tx) => { ... })`
- 读取 primary + secondaries（包含 assetType/status/mergedIntoAssetUuid/lastSeenAt）
- 执行约束校验（类型一致、状态合法、VM 门槛、环检测）
- 执行迁移（按 PRD）：
  - 更新 secondary asset：status=merged + mergedIntoAssetUuid
  - updateMany：AssetSourceLink.assetUuid -> primary
  - updateMany：SourceRecord.assetUuid -> primary
  - 关系：findMany 受影响 relation -> 逐条 upsert (unique: relationType+from+to+sourceId) + 删除旧行 + 删除自环
  - duplicateCandidate.updateMany：OR (assetUuidA in set) OR (assetUuidB in set) -> status=merged
  - mergeAudit.createMany / create：记录每个 merged_asset_uuid（或单条记录 + summary 内含数组）
  - auditEvent.create：eventType=`asset.merged`
- 记录日志 wide-event：`asset.merge_started` / `asset.merge_completed` / `asset.merge_failed`（建议复用 `logEvent`）

**Step 4: 跑测试确认通过**

Run: `bun run test src/app/api/v1/assets/[uuid]/merge/route.test.ts`
Expected: PASS

**Step 5: OpenAPI + docs**

- `src/lib/openapi/spec.ts` 注册 `POST /api/v1/assets/{uuid}/merge`
- `docs/design/asset-ledger-api-spec.md` 增补 merge API 章节

---

### Task 4: merged 资产默认隐藏 + 直接访问跳转

**Files:**

- Modify: `src/lib/assets/asset-list-query.ts`（默认 where 排除 `status=merged`）
- Modify: `src/app/api/v1/assets/[uuid]/route.ts`（返回 mergedIntoAssetUuid）
- Modify: `src/app/assets/[uuid]/page.tsx`（检测 merged 并提示/跳转到主资产）

**Step 1: 增加单测（where 默认排除 merged）**

Run: `bun run test src/lib/assets/asset-list-query.test.ts`
Expected: FAIL（新增断言）

**Step 2: 最小实现 + 通过测试**

---

### Task 5: Merge UI（从重复中心进入）

**Files:**

- Create: `src/app/duplicate-candidates/[candidateId]/merge/page.tsx`
- Modify: `src/app/duplicate-candidates/[candidateId]/page.tsx`（进入 merge 改为跳转）

**Step 1: 页面加载 candidate detail**

- 展示：候选基础信息、两侧资产摘要（status/lastSeen）
- 选择 primary（默认：若 VM 且一方 in_service/另一方 offline，则自动选 in_service 为 primary）
- 展示关键字段对比（复用候选详情的 compare 思路）

**Step 2: 合并确认**

- 提示策略：`primary_wins`
- 调用：`POST /api/v1/assets/:primary/merge` body `{ mergedAssetUuids: [secondary], conflictStrategy: 'primary_wins' }`
- 成功：toast + 跳转到主资产详情 `/assets/:primary`
- 失败：toast（展示后端错误 message + VM 门槛提示“仅关机不等于下线”）

---

### Task 6: 进度表 + 质量门槛

**Files:**

- Modify: `docs/plans/2026-01-31-post-mvp-m1-m8-m12.progress.md`（M5M-1~M5M-5 DONE）
- Modify (如需要): `README.md`（补充 merge UI 路径说明）

**Step 1: 更新进度**

**Step 2: 跑质量门槛**

Run: `bun run format:check && bun run lint && bun run type-check && bun run test`
Expected: PASS
