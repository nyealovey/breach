# M5D-3 Duplicate Candidates (dup-rules-v1) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为“重复中心”落地后端基础：新增 `DuplicateCandidate` 表与 `dup-rules-v1` 规则计算，并在每次成功且 inventory_complete 的 collect Run 后通过异步 job 生成/更新候选（幂等 + 降噪）。

**Architecture:** 在 Postgres 中新增 `DuplicateCandidate` 与 `DuplicateCandidateJob`（简单队列）。worker 在 collect Run 成功入库后 enqueue job；当 worker 空闲时（无 queued runs）消费 job，读取最近快照（`SourceRecord.normalized`），按 `dup-rules-v1` 规则生成候选并 upsert 到 `DuplicateCandidate`。

**Tech Stack:** Next.js/TypeScript、Prisma(Postgres)、bun、vitest。

---

### Task 1: Prisma 数据模型与迁移（DuplicateCandidate + DuplicateCandidateJob）

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260131xxxxxx_add_duplicate_candidate_and_job/migration.sql`

**Step 1: 为 DuplicateCandidate / Job 增加 failing type-check（占位）**

新增一个最小测试文件，先引用（但此时还不存在）`DuplicateCandidateStatus` 枚举（或 Prisma model type），确保当前状态会在 type-check 或 test 阶段失败。

**Step 2: 运行验证，确认失败原因正确**

Run: `bun run type-check`
Expected: FAIL（原因：缺少 DuplicateCandidate 相关类型/枚举）

**Step 3: 修改 Prisma schema**

- 新增 enum：
  - `DuplicateCandidateStatus { open ignored merged }`
  - `DuplicateCandidateJobStatus { Queued Running Succeeded Failed }`
- 新增 model：
  - `DuplicateCandidate`：字段按 PRD 最小集合（`assetUuidA/B`、`score`、`reasons`、`status`、`lastObservedAt`、ignored 字段）+ `(assetUuidA, assetUuidB)` 唯一约束 + 常用索引（status/lastObservedAt）
  - `DuplicateCandidateJob`：`runId` 唯一、status/attempts/startedAt/finishedAt/errorSummary 等

**Step 4: 写 migration.sql**

按 Prisma 迁移风格写：

- CreateEnum(s)
- CreateTable(s)
- AddForeignKey(s)
- CreateIndex(s)

**Step 5: 生成 Prisma Client 并验证通过**

Run: `bun run db:generate && bun run type-check`
Expected: PASS

---

### Task 2: 实现 dup-rules-v1 规则引擎（纯函数 + 单测）

**Files:**

- Create: `src/lib/duplicate-candidates/dup-rules-v1.ts`
- Create: `src/lib/duplicate-candidates/dup-rules-v1.test.ts`

**Step 1: 写 failing tests（覆盖核心规则 + placeholder/normalize）**

在 `dup-rules-v1.test.ts` 先写：

- `vm.machine_uuid_match`（大小写/连字符不敏感）
- `vm.mac_overlap`（支持 `:` / `-` / 无分隔）
- `vm.hostname_ip_overlap`（hostname trim/lower；ip trim）
- `host.serial_match`（trim/upper）
- `host.bmc_ip_match` / `host.mgmt_ip_match`
- placeholder：`00:00:00:00:00:00` / `00000000-0000-...` 视为缺失不命中
- score cap = 100

**Step 2: 运行测试，确认失败**

Run: `bun run test src/lib/duplicate-candidates/dup-rules-v1.test.ts`
Expected: FAIL（原因：模块/导出不存在）

**Step 3: 写最小实现**

实现：

- placeholder 判定（raw + compact 形式）
- normalize 函数（uuid/mac/ip/hostname/serial）
- `calculateDupScoreV1(a, b, assetType)` 返回 `{ score, reasons }`

**Step 4: 运行测试，确认通过**

Run: `bun run test src/lib/duplicate-candidates/dup-rules-v1.test.ts`
Expected: PASS

---

### Task 3: 生成候选对（blocking + 去重）逻辑（纯函数 + 单测）

**Files:**

- Create: `src/lib/duplicate-candidates/generate-candidates.ts`
- Create: `src/lib/duplicate-candidates/generate-candidates.test.ts`

**Step 1: 写 failing tests**

用小数据集验证：

- 只会产出同 assetType 的候选
- 同一对资产多规则命中只产出 1 条候选
- 规范化顺序 a<b
- 不会产出 (a,a)

**Step 2: 运行测试确认失败**

Run: `bun run test src/lib/duplicate-candidates/generate-candidates.test.ts`
Expected: FAIL

**Step 3: 实现最小逻辑**

实现：

- 从 normalized 抽取 candidate keys
- 为每条规则建立 key -> assetUuid[] 的 index
- 仅对“本次 run 中出现的资产”生成 pair（与 pool 资产比对）
- 对每对 pair 调用 `calculateDupScoreV1`，过滤 `score >= 70`

**Step 4: 运行测试确认通过**

Run: `bun run test src/lib/duplicate-candidates/generate-candidates.test.ts`
Expected: PASS

---

### Task 4: Job 处理与幂等 upsert（单测驱动）

**Files:**

- Create: `src/lib/duplicate-candidates/upsert-duplicate-candidate.ts`
- Create: `src/lib/duplicate-candidates/upsert-duplicate-candidate.test.ts`

**Step 1: 写 failing tests**

用 mock prisma（`vi.fn()`）覆盖：

- 不存在则 create(open)
- status=open 则 update(score/reasons/lastObservedAt)
- status=ignored/merged 仅 update(lastObservedAt)

**Step 2: 运行测试确认失败**

Run: `bun run test src/lib/duplicate-candidates/upsert-duplicate-candidate.test.ts`
Expected: FAIL

**Step 3: 实现最小实现**

实现 `upsertDuplicateCandidate()`（内部做 pair 规范化、调用 prisma 的 `findUnique/create/update`）。

**Step 4: 运行测试确认通过**

Run: `bun run test src/lib/duplicate-candidates/upsert-duplicate-candidate.test.ts`
Expected: PASS

---

### Task 5: Worker 接入异步 job（enqueue + idle consume）

**Files:**

- Modify: `src/bin/worker.ts`
- Create: `src/lib/duplicate-candidates/job.ts`
- Test: `src/lib/duplicate-candidates/job.test.ts`

**Step 1: 写 failing tests（只测纯函数）**

至少覆盖：

- `inferDupScopeFromRunMode()`：collect/collect_hosts/collect_vms -> assetTypes

**Step 2: 运行测试确认失败**

Run: `bun run test src/lib/duplicate-candidates/job.test.ts`
Expected: FAIL

**Step 3: 实现 enqueue + claim + process（最小可用）**

- collect run 成功后 `create DuplicateCandidateJob`（unique(runId)；冲突忽略）
- worker loop：当 `claimQueuedRuns()` 无结果时，`claimQueuedDuplicateCandidateJobs()` 并处理
- 处理逻辑：
  - 读取本 run 的 `SourceRecord.normalized` 作为 runAssets
  - 构建候选 pool（最近 7 天离线 + 全部 in_service；排除 merged；仅 vm/host）
  - 调用 generateCandidates + upsert
  - job 状态置 Succeeded/Failed（失败不影响 run）

**Step 4: 运行所有测试**

Run: `bun run test`
Expected: PASS

---

### Task 6: 文档/进度同步 + 质量门槛

**Files:**

- Modify: `docs/plans/2026-01-31-post-mvp-m1-m8-m12.progress.md`

**Step 1: 更新进度**

将 `M5D-3` 标记为 `DONE`，并更新总完成数。

**Step 2: 跑质量门槛**

Run: `bun run format:check && bun run lint && bun run type-check && bun run test`
Expected: PASS
