# 资产台账 - 凭据模块与调度组手动运行 v1.0 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 新增可复用的 Credential 模块（加密存储、CRUD、不回显明文）+ Source 绑定 Credential（0/1）+ 调度组列表一键手动运行（批量创建 collect/manual Run，单飞+跳过缺凭据），并补齐 OpenAPI/测试/文档。

**Architecture:** Next.js App Router（`src/app/api/v1/*`）+ Prisma/PostgreSQL；Credential payload 以 AES-256-GCM（`src/lib/crypto/aes-gcm.ts`）加密落库；Worker 执行 Run 时按 `Source.credentialId -> Credential.payloadCiphertext` 解密并注入插件输入；调度组手动运行用 DB 事务 + `FOR UPDATE SKIP LOCKED` 做并发安全批量入队。

**Tech Stack:** Next.js 16 + React 19、Bun、Prisma + PostgreSQL、Zod v4、Vitest、Playwright、zod-to-openapi。

## 范围与验收入口（v1.0）

计划需求来源：`docs/prds/asset-ledger-credential-module-and-schedule-group-manual-run-v1.0-prd.md`

本次增量的验收重点（摘自 PRD Acceptance Criteria）：

- Credential：admin 可创建/编辑/删除；CRUD 全程不回显明文 secret
- 复用：Credential 可被多个 Source 绑定；Source 至多绑定 0/1 个 Credential
- 一致性：`Credential.type` 必须与 `Source.sourceType` 一致（UI + API 双校验）
- 删除限制：仍被未删除 Source 引用时禁止删除（409 + `CONFIG_RESOURCE_CONFLICT`）
- 调度组手动运行：列表行「运行」按钮；批量创建 `collect`/`manual` Run
- 跳过规则：缺凭据跳过；存在活动 Run（Queued/Running）跳过；无可入队时返回 200 且 queued=0
- 质量门槛：`bun run lint`、`bun run format:check`、`bun run type-check` 通过；新增 API/核心逻辑有 Vitest；E2E 覆盖新路径；OpenAPI/Swagger + 文档更新

## 关键约束（执行中保持一致）

- **不做历史数据迁移**：不将旧 `Source.credentialCiphertext` 迁移为 Credential；新实现也**不再读取**旧字段（管理员需在新模块重新创建并绑定）。
- **不回显明文**：任何 API 响应、日志、UI 都不得出现明文 secret（password/token/AK/SK）。
- **删除口径**：Credential 的 `usageCount` 仅统计 `Source.deletedAt IS NULL` 的引用；建议在 Source 软删除时将 `credentialId` 置空，以匹配口径并避免 DB 外键阻塞删除。
- **并发安全**：调度组手动运行必须在同一事务内完成“检查活动 Run + 创建新 Run”，并用 `FOR UPDATE SKIP LOCKED` 避免竞态重复入队。

---

### Task 1: 扩展错误码（Credential Not Found）

**Files:**
- Modify: `docs/design/asset-ledger-error-codes.md`
- Modify: `src/lib/errors/error-codes.ts`
- Test: `src/lib/errors/error-codes.test.ts`

**Step 1: 写一个会失败的单测（新错误码尚不存在）**

Create `src/lib/errors/error-codes.test.ts`：

```ts
import { describe, expect, it } from 'vitest';

import { ErrorCode } from '@/lib/errors/error-codes';

describe('ErrorCode', () => {
  it('includes CONFIG_CREDENTIAL_NOT_FOUND', () => {
    expect(ErrorCode.CONFIG_CREDENTIAL_NOT_FOUND).toBe('CONFIG_CREDENTIAL_NOT_FOUND');
  });
});
```

**Step 2: 运行测试确认失败**

Run: `bun test src/lib/errors/error-codes.test.ts`  
Expected: FAIL（`CONFIG_CREDENTIAL_NOT_FOUND` 不存在）

**Step 3: 在错误码规范与代码枚举中新增错误码**

- 在 `docs/design/asset-ledger-error-codes.md` 的注册表中新增一行（web/config/404）：
  - `CONFIG_CREDENTIAL_NOT_FOUND`：凭据不存在
- 在 `src/lib/errors/error-codes.ts` 中新增：

```ts
  CONFIG_CREDENTIAL_NOT_FOUND: 'CONFIG_CREDENTIAL_NOT_FOUND',
```

**Step 4: 运行测试确认通过**

Run: `bun test src/lib/errors/error-codes.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add docs/design/asset-ledger-error-codes.md src/lib/errors/error-codes.ts src/lib/errors/error-codes.test.ts
git commit -m "feat: add CONFIG_CREDENTIAL_NOT_FOUND error code"
```

---

### Task 2: 数据模型（Credential 实体 + Source 绑定）

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/*`（由 Prisma 生成）

**Step 1: 为 Prisma Schema 增加 Credential 模型与 Source.credentialId**

修改 `prisma/schema.prisma`（示例；以现有模型为准合并）：

```prisma
model Credential {
  id               String    @id @default(cuid())
  name             String    @unique
  type             SourceType
  payloadCiphertext String
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  sources Source[]
}

model Source {
  // ...
  credentialId String?
  credential   Credential? @relation(fields: [credentialId], references: [id], onDelete: Restrict)

  @@index([credentialId])
}
```

> 注意：保留旧字段 `Source.credentialCiphertext`（仅做历史遗留存储），但后续实现不得读取/写入它。

**Step 2: 生成迁移并更新 Prisma Client**

Run: `bun run db:migrate`  
Expected: 生成新 migration、数据库新增 `Credential` 表及 `Source.credentialId` 列

Run: `bun run db:generate`  
Expected: Prisma Client 更新成功

**Step 3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add credential model and source credentialId"
```

---

### Task 3: 定义 Credential Zod Schema（按 SourceType 字段变化）

**Files:**
- Create: `src/lib/credentials/schema.ts`
- Test: `src/lib/credentials/schema.test.ts`

**Step 1: 写一个会失败的单测（schema 文件尚不存在）**

Create `src/lib/credentials/schema.test.ts`：

```ts
import { describe, expect, it } from 'vitest';

import { CredentialCreateSchema } from '@/lib/credentials/schema';

describe('CredentialCreateSchema', () => {
  it('rejects missing payload field for vcenter', () => {
    const result = CredentialCreateSchema.safeParse({ name: 'c1', type: 'vcenter', payload: { username: 'u' } });
    expect(result.success).toBe(false);
  });
});
```

**Step 2: 运行测试确认失败**

Run: `bun test src/lib/credentials/schema.test.ts`  
Expected: FAIL（模块不存在）

**Step 3: 实现 schema（按 PRD 1.1 字段集合）**

Create `src/lib/credentials/schema.ts`：

```ts
import { z } from 'zod/v4';
import { SourceType } from '@prisma/client';

const VcenterPayload = z.object({ username: z.string().min(1), password: z.string().min(1) });
const AliyunPayload = z.object({ accessKeyId: z.string().min(1), accessKeySecret: z.string().min(1) });
const ThirdPartyPayload = z.object({ token: z.string().min(1) });

export const CredentialTypeSchema = z.nativeEnum(SourceType);

export const CredentialCreateSchema = z.object({
  name: z.string().min(1),
  type: CredentialTypeSchema,
  payload: z.union([
    VcenterPayload, // vcenter/pve/hyperv 复用同结构
    AliyunPayload,
    ThirdPartyPayload,
  ]),
});

export const CredentialUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  // 允许“更新密钥/密码”：不回显旧 secret，仅覆盖写入
  payload: z.unknown().optional(),
});

export function payloadSchemaByType(type: SourceType) {
  if (type === 'aliyun') return AliyunPayload;
  if (type === 'third_party') return ThirdPartyPayload;
  // vcenter/pve/hyperv：username/password
  return VcenterPayload;
}
```

> 注：这里把 payload 字段校验拆成 `payloadSchemaByType(type)`，在 API 层按 type 精确校验，避免 union 误配。

**Step 4: 运行测试确认通过**

Run: `bun test src/lib/credentials/schema.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/credentials/schema.ts src/lib/credentials/schema.test.ts
git commit -m "feat: add credential payload schemas"
```

---

### Task 4: Credentials API（CRUD + usageCount + 删除限制）

**Files:**
- Create: `src/app/api/v1/credentials/route.ts`
- Create: `src/app/api/v1/credentials/route.test.ts`
- Create: `src/app/api/v1/credentials/[id]/route.ts`
- Create: `src/app/api/v1/credentials/[id]/route.test.ts`

**Step 1: 写会失败的 API 单测（先定义期望的响应形状）**

Create `src/app/api/v1/credentials/[id]/route.test.ts`（示例：删除冲突）：

```ts
import { describe, expect, it, vi } from 'vitest';

import { DELETE } from '@/app/api/v1/credentials/[id]/route';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    credential: { findUnique: vi.fn(), delete: vi.fn() },
    source: { count: vi.fn() },
  },
}));

describe('DELETE /api/v1/credentials/:id', () => {
  it('returns 409 when usageCount>0', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ ok: true, requestId: 'req_test', session: { user: { id: 'u1' } } } as any);
    vi.mocked(prisma.credential.findUnique).mockResolvedValue({ id: 'c1' } as any);
    vi.mocked(prisma.source.count).mockResolvedValue(1);

    const req = new Request('http://localhost/api/v1/credentials/c1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1' }) } as any);

    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('CONFIG_RESOURCE_CONFLICT');
  });
});
```

**Step 2: 运行测试确认失败**

Run: `bun test src/app/api/v1/credentials/[id]/route.test.ts`  
Expected: FAIL（route 不存在）

**Step 3: 实现 `GET/POST /api/v1/credentials`**

Create `src/app/api/v1/credentials/route.ts`（要点）：

- `GET`：
  - query：`type`/`q`/`page`/`pageSize`/`sortBy`/`sortOrder`
  - 列表 item：`credentialId/name/type/usageCount/createdAt/updatedAt`（不含 payload）
  - `usageCount`：只统计未删除 Source（建议 Source 软删除时清空 `credentialId`，则可用 relation _count）
- `POST`：
  - body：`name/type/payload`（按 `payloadSchemaByType(type)` 校验）
  - 存储：`payloadCiphertext = encryptJson(payload)`
  - 处理唯一性：P2002 -> 409 + `CONFIG_DUPLICATE_NAME`

**Step 4: 实现 `GET/PUT/DELETE /api/v1/credentials/:id`**

Create `src/app/api/v1/credentials/[id]/route.ts`（要点）：

- `GET`：
  - 404：`CONFIG_CREDENTIAL_NOT_FOUND`
  - 返回含 `usageCount`，不含 payload
- `PUT`：
  - 允许改 `name`
  - 允许覆盖更新 `payload`（如果请求带 payload，就重新加密覆盖；不回显旧 secret）
- `DELETE`：
  - `usageCount>0`（只统计 `Source.deletedAt IS NULL`）-> 409 + `CONFIG_RESOURCE_CONFLICT`

**Step 5: 运行单测并补齐遗漏**

Run: `bun test src/app/api/v1/credentials/[id]/route.test.ts`  
Expected: PASS

（按需补充 `route.test.ts` 覆盖 list/create/update/not-found）

**Step 6: Commit**

```bash
git add src/app/api/v1/credentials
git commit -m "feat: add credentials crud api"
```

---

### Task 5: Source API 改造（绑定 credentialId + 返回摘要 + 移除旧凭据入口）

**Files:**
- Modify: `src/app/api/v1/sources/route.ts`
- Modify: `src/app/api/v1/sources/[id]/route.ts`
- Delete or Modify: `src/app/api/v1/sources/[id]/credential/route.ts`
- Test: `src/app/api/v1/sources/route.test.ts`
- Test: `src/app/api/v1/sources/[id]/route.test.ts`

**Step 1: 写会失败的单测（credentialId 校验）**

Create `src/app/api/v1/sources/route.test.ts`（示例：credential 不存在 -> 404）：

```ts
import { describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/v1/sources/route';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    source: { findFirst: vi.fn(), create: vi.fn() },
    scheduleGroup: { findUnique: vi.fn() },
    credential: { findUnique: vi.fn() },
  },
}));

describe('POST /api/v1/sources', () => {
  it('returns 404 when credentialId does not exist', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ ok: true, requestId: 'req_test', session: { user: { id: 'u1' } } } as any);
    vi.mocked(prisma.source.findFirst).mockResolvedValue(null as any);
    vi.mocked(prisma.scheduleGroup.findUnique).mockResolvedValue({ id: 'g1' } as any);
    vi.mocked(prisma.credential.findUnique).mockResolvedValue(null as any);

    const req = new Request('http://localhost/api/v1/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 's1',
        sourceType: 'vcenter',
        scheduleGroupId: 'g1',
        enabled: true,
        config: { endpoint: 'https://example.invalid' },
        credentialId: 'c1',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('CONFIG_CREDENTIAL_NOT_FOUND');
  });
});
```

**Step 2: 修改 Source create/update schema**

在 `src/app/api/v1/sources/route.ts` 与 `src/app/api/v1/sources/[id]/route.ts` 中：

- 删除 `credential: {username,password}` 的输入与加密逻辑
- 增加 `credentialId`（可空）：`z.string().min(1).nullable().optional()`
- 若 `credentialId` 非空：
  - 校验 Credential 存在，否则 404 + `CONFIG_CREDENTIAL_NOT_FOUND`
  - 校验 Credential.type === Source.sourceType，否则 400 + `CONFIG_INVALID_REQUEST`

**Step 3: Source list/detail 返回 credential 摘要**

在查询中 include `credential: { select: { id: true, name: true, type: true } }`，并返回：

```ts
credential: source.credential
  ? { credentialId: source.credential.id, name: source.credential.name, type: source.credential.type }
  : null
```

**Step 4: 移除旧 “更新凭据” API**

按 PRD 3.2：

- 删除 `src/app/api/v1/sources/[id]/credential/route.ts`，或改为固定返回 410（Gone）并提示迁移到 `/credentials`。
- 同步更新任何引用（尤其是 `e2e/admin.spec.ts`）。

**Step 5: Source 软删除时清空 credentialId**

在 `src/app/api/v1/sources/[id]/route.ts` 的 `DELETE` 分支：

- `data: { deletedAt: new Date(), enabled: false, credentialId: null }`

**Step 6: 运行单测并补齐**

Run: `bun test src/app/api/v1/sources/route.test.ts`  
Expected: PASS

**Step 7: Commit**

```bash
git add src/app/api/v1/sources
git commit -m "feat: support source credential binding"
```

---

### Task 6: Worker/Scheduler 使用新 Credential（不再读取旧字段）

**Files:**
- Modify: `src/bin/worker.ts`
- Modify: `src/bin/scheduler.ts`

**Step 1: worker：按 Source.credentialId 解密 payload**

在 `src/bin/worker.ts`：

- 不再读取 `source.credentialCiphertext`
- 改为在读取 source 时 include credential（或额外查一次）：
  - `source.credentialId` 为空：`credential = {}`
  - 否则：`credential = decryptJson(source.credential.payloadCiphertext)`

> 注意：失败日志/错误对象不得包含明文 secret；仅允许记录 `cause` 的安全片段（例如“解密失败”）。

**Step 2: scheduler：跳过未绑定凭据的 enabled Source**

在 `src/bin/scheduler.ts` 获取 sources 时增加过滤：

- `where: { enabled: true, scheduleGroupId: group.id, deletedAt: null, credentialId: { not: null } }`

（可选增强：日志事件增加 `skipped_missing_credential`）

**Step 3: 手工验证（最小）**

Run: `bun run type-check`  
Expected: PASS

**Step 4: Commit**

```bash
git add src/bin/worker.ts src/bin/scheduler.ts
git commit -m "feat: use credential table in worker and scheduler"
```

---

### Task 7: 调度组手动运行 API（批量 collect/manual）

**Files:**
- Create: `src/app/api/v1/schedule-groups/[id]/runs/route.ts`
- Create: `src/app/api/v1/schedule-groups/[id]/runs/route.test.ts`

**Step 1: 写会失败的单测（queued/skipped 计数）**

Create `src/app/api/v1/schedule-groups/[id]/runs/route.test.ts`（示例：全部缺凭据 -> queued=0）：

```ts
import { describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/v1/schedule-groups/[id]/runs/route';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    scheduleGroup: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

describe('POST /api/v1/schedule-groups/:id/runs', () => {
  it('returns queued=0 when all enabled sources missing credential', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ ok: true, requestId: 'req_test', session: { user: { id: 'u1' } } } as any);
    vi.mocked(prisma.scheduleGroup.findUnique).mockResolvedValue({ id: 'g1' } as any);
    vi.mocked(prisma.$transaction).mockResolvedValue({ queued: 0, skipped_active: 0, skipped_missing_credential: 2, message: 'no eligible sources' });

    const req = new Request('http://localhost/api/v1/schedule-groups/g1/runs', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: 'g1' }) } as any);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.queued).toBe(0);
  });
});
```

**Step 2: 实现 route（事务 + FOR UPDATE SKIP LOCKED）**

Create `src/app/api/v1/schedule-groups/[id]/runs/route.ts`（要点）：

- 404：调度组不存在 -> `CONFIG_SCHEDULE_GROUP_NOT_FOUND`
- 手动运行不受 group.enabled 限制（PRD 2.1），但只处理 `Source.deletedAt IS NULL AND enabled=true`
- 对每个 Source：
  - `credentialId IS NULL` -> `skipped_missing_credential++`
  - 存在活动 Run（Queued/Running）-> `skipped_active++`
  - 否则创建 Run：`mode=collect`、`triggerType=manual`、`status=Queued`，并带上 `scheduleGroupId`
- 并发控制：
  - 在同一事务内完成：锁源（`FOR UPDATE SKIP LOCKED`）→ 查活动 Run → createMany

**Step 3: 运行单测并补齐**

Run: `bun test src/app/api/v1/schedule-groups/[id]/runs/route.test.ts`  
Expected: PASS

**Step 4: Commit**

```bash
git add src/app/api/v1/schedule-groups/[id]/runs
git commit -m "feat: add schedule group manual run api"
```

---

### Task 8: Web UI（Credentials 页面 + Source 表单绑定 + 调度组运行按钮）

**Files:**
- Modify: `src/app/layout.tsx`
- Create: `src/app/credentials/page.tsx`
- Create: `src/app/credentials/new/page.tsx`
- Create: `src/app/credentials/[id]/edit/page.tsx`
- Modify: `src/app/sources/new/page.tsx`
- Modify: `src/app/sources/[id]/edit/page.tsx`
- Modify: `src/app/schedule-groups/page.tsx`

**Step 1: 左侧导航新增「凭据」入口**

Modify `src/app/layout.tsx`：新增 `/credentials` 链接。

**Step 2: 凭据列表页**

Create `src/app/credentials/page.tsx`：

- fetch `/api/v1/credentials?pageSize=100`
- Table 列：name / type / usageCount / updatedAt
- 操作：编辑、删除（删除失败 toast 展示 error.message）

**Step 3: 新建凭据页（按 type 动态表单）**

Create `src/app/credentials/new/page.tsx`：

- 字段：name、type、payload（按 type 渲染）
- 提交：POST `/api/v1/credentials`
- 成功后跳转 `/credentials`

**Step 4: 编辑凭据页（不回显 secret，可覆盖更新）**

Create `src/app/credentials/[id]/edit/page.tsx`：

- GET `/api/v1/credentials/:id` 获取 name/type/usageCount
- 提交 PUT `/api/v1/credentials/:id`
- “更新密钥/密码”做成显式开关：开启才要求填写 payload

**Step 5: Source 表单改造（选择凭据下拉 + 移除旧更新凭据卡片）**

Modify `src/app/sources/new/page.tsx` 与 `src/app/sources/[id]/edit/page.tsx`：

- 增加 credential 下拉：
  - 根据 `sourceType` fetch `/api/v1/credentials?type=${sourceType}&pageSize=100`
  - 可选空（credentialId=null）
- 删除旧的 “更新凭据” 表单（原调用 `/sources/:id/credential`）
- 当 `enabled=true && credentialId 为空`：显示明显提示（文案参照 PRD 4.2）

**Step 6: 调度组列表行新增「运行」按钮**

Modify `src/app/schedule-groups/page.tsx`：

- 每行新增按钮「运行」
- 点击后 POST `/api/v1/schedule-groups/:id/runs`
- toast 展示 `queued/skipped_active/skipped_missing_credential`，queued=0 时展示 message

**Step 7: 手工验证（最小）**

Run: `bun run dev`  
Checklist:
- 能打开 `/credentials`、`/credentials/new`、`/credentials/:id/edit`
- Source 新建/编辑页能选择凭据且不再出现“更新凭据”卡片
- `/schedule-groups` 行内按钮可触发并 toast 显示结果

**Step 8: Commit**

```bash
git add src/app
git commit -m "feat: add credentials ui and schedule group run button"
```

---

### Task 9: OpenAPI/Docs/E2E 更新（交付收尾）

**Files:**
- Modify: `src/lib/openapi/spec.ts`
- Modify: `README.md`
- Modify: `docs/index.md`
- Modify: `e2e/admin.spec.ts`

**Step 1: OpenAPI 注册新接口**

Modify `src/lib/openapi/spec.ts`：

- 新增 tags：`credentials`、`schedule-groups`
- 注册 paths：
  - `GET/POST /api/v1/credentials`
  - `GET/PUT/DELETE /api/v1/credentials/{id}`
  - `POST /api/v1/schedule-groups/{id}/runs`

**Step 2: 文档链接更新**

- 在 `README.md` 与 `docs/index.md` 增加本计划与进度文件的链接
-（实现落地时）同步更新 README 中 `PASSWORD_ENCRYPTION_KEY` 描述：由 “Source 凭据密文” 调整为 “Credential 凭据密文”

**Step 3: 更新 Playwright E2E 覆盖新路径**

Modify `e2e/admin.spec.ts`：

- 不再调用 `/api/v1/sources/:id/credential`
- 改为：
  - POST `/api/v1/credentials` 创建凭据（若环境变量提供 vCenter 凭据则使用；否则可创建 dummy 并验证 skip_missing_credential）
  - Source create/update 绑定 `credentialId`
  - 触发：优先覆盖 `/api/v1/schedule-groups/:id/runs`（或 UI 点击行内「运行」）

**Step 4: 全量质量门槛**

Run:

```bash
bun run format:check
bun run lint
bun run type-check
bun test
```

Optional:

```bash
bun run e2e
```

**Step 5: Commit**

```bash
git add src/lib/openapi/spec.ts README.md docs/index.md e2e/admin.spec.ts
git commit -m "docs: update docs and openapi for credentials and schedule-group manual run"
```

