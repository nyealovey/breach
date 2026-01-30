# vCenter Split Collect (Hosts + VMs) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将调度/采集流程拆成两条独立 run：第一条专注采集 ESXi/Host 信息（包含 SOAP 详情），第二条专注采集 VM 信息；两条 run 互不影响，任一失败不阻塞另一条落库。

**Architecture:**

- 扩展 `RunMode`：新增 `collect_hosts` / `collect_vms`。
- Scheduler：对 vCenter source 在触发时分别 enqueue 两条 run（Host→VM 的创建顺序固定）。active-run 抑制从“按 source”改为“按 (source, mode)”。
- Worker：把 `collect_hosts` / `collect_vms` 视为 collect-run，成功后各自 ingest 到 DB。
- vCenter 插件：新增两条采集入口：`collect_hosts`（hosts+clusters+member_of + SOAP）与 `collect_vms`（vms + runs_on/hosts_vm）。保留旧 `collect`（兼容）走全量（hosts+clusters+vms）。
- Ingest：关系端点缺失时，允许从 DB（AssetSourceLink）回查端点，避免 VM-run 因未包含 host assets 导致关系全部被跳过。

**Tech Stack:** TypeScript, Bun, Next.js, Prisma(Postgres), Vitest

---

### Task 1: 扩展 RunMode（Prisma + API + UI）

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_collect_hosts_collect_vms/migration.sql`
- Modify: `src/lib/openapi/spec.ts`
- Modify: `src/app/api/v1/runs/route.ts`
- Modify: `src/app/runs/page.tsx`
- Modify: `src/app/api/v1/sources/[id]/runs/route.ts`
- Test: `src/app/api/v1/sources/[id]/runs/route.test.ts`

**Step 1: Prisma enum 增加新值**

- `RunMode` 增加：`collect_hosts`、`collect_vms`

**Step 2: 新增 migration（Postgres enum ALTER）**

- `ALTER TYPE "RunMode" ADD VALUE collect_hosts;`
- `ALTER TYPE "RunMode" ADD VALUE collect_vms;`

**Step 3: 更新 OpenAPI + runs API 过滤白名单 + UI 下拉**

- `RunModeSchema`/`SUPPORTED_MODE`/下拉选项都包含新值

**Step 4: 手动触发接口支持新 mode（不改变现有 collect 语义）**

- BodySchema 放开 `collect_hosts`/`collect_vms`
- active-run 抑制改为按 `(sourceId, mode)`

**Step 5: 运行单测**
Run: `bun run test`
Expected: PASS

---

### Task 2: Scheduler 拆分 enqueue（Host-run 与 VM-run 独立）

**Files:**

- Modify: `src/bin/scheduler.ts`

**Step 1: source 查询补充 sourceType**

- `select: { id: true, sourceType: true }`

**Step 2: active-run 抑制改为按 (sourceId, mode)**

- 查询 active：`select: { sourceId, mode }` + `distinct: [sourceId,mode]`

**Step 3: 对 vCenter source enqueue 两条 run（先 hosts 后 vms）**

- 先 `createMany` hosts，再 `createMany` vms（确保 createdAt 顺序）
- 非 vCenter source 仍 enqueue `collect`

**Step 4: logEvent 增加 queued_by_mode**

**Step 5: 运行 lint + type-check**
Run: `bun run lint`
Expected: PASS

Run: `bun run type-check`
Expected: PASS

---

### Task 3: Worker 识别新 collect modes 并落库

**Files:**

- Modify: `src/bin/worker.ts`

**Step 1: 将 collect 判断扩展到 collect_hosts/collect_vms**

- `if (run.mode === collect || run.mode === collect_hosts || run.mode === collect_vms)`

**Step 2: inventory_complete 校验同样适用**

- 对三种 collect 模式都要求 `inventory_complete === true`

**Step 3: 运行 type-check**
Run: `bun run type-check`
Expected: PASS

---

### Task 4: vCenter 插件新增 collect_hosts / collect_vms

**Files:**

- Modify: `plugins/vcenter/types.ts`
- Modify: `plugins/vcenter/index.ts`
- Test: `plugins/vcenter/__tests__/integration.test.ts`

**Step 1: 扩展 CollectorMode union**

- 增加 `collect_hosts`/`collect_vms`

**Step 2: 实现 collect_hosts**

- REST: `listHosts` + `listClusters` + `listHostsByCluster` 组 host→cluster
- SOAP: `collectHostSoapDetails`（best-effort）
- Assets: hosts + clusters
- Relations: host→cluster(member_of)

**Step 3: 实现 collect_vms**

- REST: `listHosts` → per-host `listVMsByHost` → per-vm `getVmDetail`/guest networking/tools
- Assets: vms
- Relations: vm→host(runs_on) + host→vm(hosts_vm)

**Step 4: collect（兼容）保持原行为**

- 仍返回 hosts + clusters + vms + 全量 relations

**Step 5: 更新集成测试**

- 新增两条断言：mode=collect_hosts 与 mode=collect_vms
- 保留 mode=collect 的旧断言（兼容）

**Step 6: 运行单测**
Run: `bun run test`
Expected: PASS

---

### Task 5: Ingest 支持“关系端点从 DB 回查”

**Files:**

- Modify: `src/lib/ingest/ingest-run.ts`
- Create: `src/lib/ingest/ingest-run.test.ts`

**Step 1: 在关系写入阶段，缺失端点时从 DB 查 AssetSourceLink**

- 基于 `(sourceId, externalKind, externalId)` 查 link + asset（uuid/type/displayName）
- 本次 run 不创建缺失端点的 SourceRecord/AssetRunSnapshot

**Step 2: 增加缓存避免 N+1**

- `Map<externalKey, linkInfo|null>`

**Step 3: 单测覆盖**

- 场景：本次 run 只包含 VM asset，但 DB 已存在 host link → 关系不应被跳过，canonical 中应包含 runs_on

**Step 4: 运行单测**
Run: `bun run test`
Expected: PASS

---

### Task 6: 文档同步

**Files:**

- Modify: `README.md`
- Modify: `docs/design/asset-ledger-collector-reference.md`

**Step 1: 补充 run modes 说明**

- 说明 scheduler 会对 vCenter source 生成两条 run：`collect_hosts` / `collect_vms`
- 说明失败互不影响，且 hosts-run 成功会先写入 host 资产

---

### Task 7: 最终验证

Run:

- `bun run format:check`
- `bun run lint`
- `bun run type-check`
- `bun run test`

Expected: 全部 PASS
