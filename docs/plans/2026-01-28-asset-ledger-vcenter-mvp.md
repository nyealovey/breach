# 资产台账 vCenter MVP v1.0（含增量：凭据模块 + 调度组手动运行）Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 vCenter MVP（PRD v1.0）端到端闭环，并补齐增量能力（Credential 模块复用 + 调度组一键手动运行）：管理员登录 → 配置 Credential → 配置 Source（无需选择调度组）→ 创建调度组（选择来源，多选）→ healthcheck/collect → 查看 Run → 浏览 Asset（统一视图/来源明细）→ 查看 VM→Host→Cluster 关系链，并交付 OpenAPI/Swagger。

**Architecture:** Next.js Web/API（App Router）+ 独立 Scheduler/Worker 进程（PG 队列：Run 表）+ 子进程 Collector Plugin（stdin/stdout JSON 契约）；采集落库为 SourceRecord/RelationRecord（raw zstd 压缩永久保留）→ 绑定到 Asset（asset_source_link）→ 生成 canonical-v1（用于 UI 展示）。

**Tech Stack:** Next.js 16 + React 19、Bun、Prisma + PostgreSQL、Zod（API 入参）、Ajv（JSON Schema 校验）、AES-256-GCM（凭证加密）、bcrypt（密码哈希）、zstd（raw 压缩）、Vitest（单测/集成）、Playwright（E2E）、Swagger UI（OpenAPI 展示）。

## 范围与验收入口（v1.0）

以 `docs/requirements/asset-ledger-v1.0-traceability.md` 的 AC-01~AC-08 为主线，落地到任务拆解：

- AC-01：管理员初始化 + 登录/会话 + 改密
- AC-02：Source CRUD + 软删除 + 凭据更新（加密存储、UI 不回显）+ 列表展示最近一次 Run
- AC-03：调度组定时触发 + 手动触发 Run + 同 Source 单飞 + 触发抑制审计
- AC-04：插件化采集（healthcheck/detect/collect）+ driver 可追溯 + inventory 不完整必须失败
- AC-05：Asset 统一视图（canonical-v1）+ 来源明细（normalized-v1）
- AC-06：关系链展示 VM→Host→Cluster（允许缺边）
- AC-07：Web UI 可用且仅 admin
- AC-08：OpenAPI JSON + Swagger UI
- AC-09：raw 查看入口 + 审计（SourceRecord raw payload；admin-only）

> 注：本次 MVP **需要**提供 raw 查看入口（admin-only + 审计），同时满足 raw 永久保留 + zstd 压缩 + 元数据齐全；raw 展示侧需做防御性脱敏（避免意外包含凭证/Token）。

增量需求（补充到 vCenter MVP 的实现）：`docs/prds/asset-ledger-vcenter-mvp-credentials-sg-manual-run-v1.0-prd.md`（本计划 Task 18~Task 26 覆盖）。

---

### Task 1: 建立错误码/错误响应的最小闭环（Web + Worker 共用）

**Files:**

- Create: `src/lib/errors/error-codes.ts`
- Create: `src/lib/errors/error.ts`
- Create: `src/lib/http/response.ts`
- Create: `src/lib/http/request-id.ts`
- Test: `src/lib/errors/error.test.ts`

**Step 1: 新增 ErrorCode 常量与类型（从错误码规范复制）**

创建 `src/lib/errors/error-codes.ts`（以 `docs/design/asset-ledger-error-codes.md` 第 4 节 TypeScript 为单一来源）：

```ts
export const ErrorCode = {
  AUTH_UNAUTHORIZED: 'AUTH_UNAUTHORIZED',
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_FORBIDDEN: 'AUTH_FORBIDDEN',
  CONFIG_INVALID_REQUEST: 'CONFIG_INVALID_REQUEST',
  CONFIG_RESOURCE_CONFLICT: 'CONFIG_RESOURCE_CONFLICT',
  CONFIG_SOURCE_NOT_FOUND: 'CONFIG_SOURCE_NOT_FOUND',
  PLUGIN_NOT_CONFIGURED: 'PLUGIN_NOT_CONFIGURED',
  PLUGIN_FAILED: 'PLUGIN_FAILED',
  PLUGIN_OUTPUT_INVALID_JSON: 'PLUGIN_OUTPUT_INVALID_JSON',
  SCHEMA_INVALID: 'SCHEMA_INVALID',
  RAW_PERSIST_FAILED: 'RAW_PERSIST_FAILED',
  DB_WRITE_FAILED: 'DB_WRITE_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];
```

**Step 2: 定义统一 error 对象结构（对齐 API spec + logging spec）**

创建 `src/lib/errors/error.ts`：

```ts
import type { ErrorCodeType } from '@/lib/errors/error-codes';

export type ErrorCategory =
  | 'auth'
  | 'permission'
  | 'config'
  | 'network'
  | 'rate_limit'
  | 'parse'
  | 'schema'
  | 'db'
  | 'raw'
  | 'unknown';

export type AppError = {
  code: ErrorCodeType;
  category: ErrorCategory;
  message: string;
  retryable: boolean;
  redacted_context?: Record<string, unknown>;
  details?: Array<{ field?: string; issue?: string; message?: string }>;
};

export function toPublicError(err: unknown): AppError {
  if (typeof err === 'object' && err && 'code' in err && 'category' in err) return err as AppError;
  return { code: 'INTERNAL_ERROR', category: 'unknown', message: 'Internal error', retryable: false };
}
```

**Step 3: 统一 API 响应封装（data/meta + error/meta）**

创建 `src/lib/http/response.ts`：

```ts
import { NextResponse } from 'next/server';

import type { AppError } from '@/lib/errors/error';

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data, meta: { timestamp: new Date().toISOString() } }, { status: 200, ...init });
}

export function created<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data, meta: { timestamp: new Date().toISOString() } }, { status: 201, ...init });
}

export function fail(error: AppError, status: number, init?: ResponseInit) {
  return NextResponse.json({ error, meta: { timestamp: new Date().toISOString() } }, { status, ...init });
}
```

**Step 4: 加 requestId（先通过 header 透传；后续在 middleware 全站统一）**

创建 `src/lib/http/request-id.ts`：

```ts
import { randomUUID } from 'node:crypto';

export function getOrCreateRequestId(input: string | null | undefined) {
  return input && input.trim().length > 0 ? input : `req_${randomUUID()}`;
}
```

**Step 5: 写一个最小单测（跑通 Vitest 之前先占位，Task 2 会引入 Vitest）**

创建 `src/lib/errors/error.test.ts`（先写内容，待 Task 2 配好测试框架后执行）：

```ts
import { describe, expect, it } from 'vitest';

import { toPublicError } from '@/lib/errors/error';

describe('toPublicError', () => {
  it('returns INTERNAL_ERROR for unknown input', () => {
    expect(toPublicError('x').code).toBe('INTERNAL_ERROR');
  });
});
```

**Step 6: Commit**

```bash
git add src/lib/errors src/lib/http
git commit -m "feat: add shared error model and api response helpers"
```

---

### Task 2: 建立测试基座（Vitest）并接入最小单测

**Files:**

- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`
- Test: `src/lib/timezone.test.ts`

**Step 1: 安装 Vitest（以及必要的 types）**

Run: `bun add -D vitest @vitest/coverage-v8`

Expected: `package.json` devDependencies 出现 `vitest`，`bun.lock` 更新。

**Step 2: 增加 scripts**

修改 `package.json`：

- 新增：`"test": "vitest"`
- 新增：`"test:ci": "vitest run --coverage"`

**Step 3: 添加 vitest 配置**

创建 `vitest.config.ts`：

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
  },
});
```

**Step 4: 添加测试 setup（别泄漏 env 校验）**

创建 `src/test/setup.ts`：

```ts
process.env.SKIP_ENV_VALIDATION = 'true';
```

**Step 5: 给 timezone 写一个单测**

创建 `src/lib/timezone.test.ts`：

```ts
import { describe, expect, it } from 'vitest';

import { getLocalParts, localDateToUtcDateOnly } from '@/lib/timezone';

describe('timezone helpers', () => {
  it('formats localDate + hhmm in target tz', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const parts = getLocalParts(now, 'Asia/Shanghai');
    expect(parts.localDate).toBe('2026-01-01');
    expect(parts.hhmm).toBe('08:00');
  });

  it('stores date-only as utc midnight', () => {
    const d = localDateToUtcDateOnly('2026-01-01');
    expect(d.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});
```

**Step 6: 跑测试**

Run: `bun test`
Expected: PASS

**Step 7: Commit**

```bash
git add package.json bun.lock vitest.config.ts src/test src/lib/timezone.test.ts
git commit -m "chore: set up vitest"
```

---

### Task 3: UI 基座（Tailwind + shadcn/ui）与通用组件选型落地

**Files:**

- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`
- Create: `components.json`
- Create: `src/components/ui/*`
- Create: `src/lib/ui/cn.ts`

> **前置检查**：若项目已通过 `create-next-app` 初始化且选择了 Tailwind，则 `tailwind.config.*` 和 `postcss.config.*` 已存在，可跳过 Step 1-3，直接从 Step 4 (shadcn) 开始。

**Step 1: 检查 Tailwind 是否已配置**

Run: `ls tailwind.config.* postcss.config.* 2>/dev/null || echo "not found"`

- 若已存在：跳过 Step 2-3，直接到 Step 4
- 若不存在：继续 Step 2

**Step 2: 引入 Tailwind CSS（仅当 Step 1 未找到配置时）**

Run: `bun add -D tailwindcss postcss autoprefixer`

Expected: `package.json` devDependencies 出现 tailwind 相关依赖。

**Step 3: 初始化 Tailwind 配置（仅当 Step 1 未找到配置时）**

Run: `bunx tailwindcss init -p`

Expected: 生成 `tailwind.config.*` 与 `postcss.config.*`（以实际生成文件名为准）。

**Step 4: 配置 content 与全局样式（仅当 Step 1 未找到配置时）**

修改 `tailwind.config.*` 的 content 覆盖：

- `./src/app/**/*.{ts,tsx}`
- `./src/components/**/*.{ts,tsx}`

修改 `src/app/globals.css` 加入 Tailwind 指令：

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

**Step 5: 初始化 shadcn/ui**

Run: `bunx shadcn@latest init`

选择建议：

- style: `new-york`
- base color: `slate`
- css: `src/app/globals.css`
- components dir: `src/components`

Expected: 生成 `components.json`，并创建 `src/components/ui/*` 与 `src/lib/utils`（或等价文件）。

**Step 6: 安装推荐组件/依赖（列表页/表单/图标/Toast）**

Run:

- `bun add lucide-react`
- `bun add @tanstack/react-table`
- `bun add react-hook-form @hookform/resolvers`
- `bun add sonner`
- `bun add clsx tailwind-merge class-variance-authority`

**Step 7: 统一 cn() 工具（若 shadcn 已生成则复用）**

创建 `src/lib/ui/cn.ts`：

```ts
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: Array<unknown>) {
  return twMerge(clsx(inputs));
}
```

**Step 8: 全局布局预留导航区（后续页面复用）**

修改 `src/app/layout.tsx`：

- 预留 header/sidebar 区域（后续用 shadcn `Button/DropdownMenu` 做导航）
- 页面内容区域使用 Tailwind 布局（替换 starter 的样式依赖）

**Step 9: Commit**

```bash
git add src/app/globals.css src/app/layout.tsx src/components src/lib/ui components.json tailwind.config.* postcss.config.*
git commit -m "chore: add tailwind and shadcn ui foundation"
```

---

### Task 4: Prisma 数据模型补齐 v1.0（User/Session/Audit/Asset/Record/Relation）与分区迁移脚手架

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/*`（Prisma 自动生成 + 手写 SQL 分区）
- Create: `src/lib/auth/password.ts`

**Step 1: 引入 User/Session/AuditEvent 最小模型**

修改 `prisma/schema.prisma`：新增

- `User { id, username(unique), role, passwordHash, createdAt, updatedAt }`
- `Session { id, userId, expiresAt, createdAt }`
- `AuditEvent { id, eventType, actorUserId?, payload(Json), createdAt }`

**Step 2: 给 Source 增加软删除字段 + 凭据密文引用**

修改 `Source`：

- 新增 `deletedAt DateTime?`
- 新增 `credentialCiphertext String?`（或单独 `SourceCredential` 表；二选一，建议单表字段减少 join）
- Source 列表默认 where `deletedAt: null`

**Step 3: 引入采集落库核心表**

在 `prisma/schema.prisma` 新增（字段名对齐 `docs/design/asset-ledger-data-model.md` 概念模型）：

- `Asset`
- `AssetSourceLink`（唯一：`(sourceId, externalKind, externalId)`）
- `SourceRecord`（高增长，后续分区）
- `RelationRecord`（高增长，后续分区）
- `Relation`（唯一：`(relationType, fromAssetUuid, toAssetUuid, sourceId)`）
- `AssetRunSnapshot`（存 canonical-v1；v1.0 也可先按需存最新快照）

**Step 4: 生成迁移**

Run: `bun run db:migrate`
Expected: Prisma 生成基础表结构迁移文件。

**Step 5: 为 source_record / relation_record 增加按月分区（手写 SQL 迁移）**

在 Prisma 迁移 SQL 末尾追加（示例，具体按最终表名/列名调整）：

- 将 `SourceRecord`、`RelationRecord` 改为 `PARTITION BY RANGE (collected_at)`
- 创建当月分区（例如 `source_record_202601`、`relation_record_202601`）
- 创建 next 月分区（避免跨月写入失败）

**Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: extend prisma schema for vcenter mvp domain"
```

---

### Task 5: 认证与会话（AC-01 / FR-00）：admin 初始化、登录、登出、改密

**Files:**

- Create: `src/lib/auth/bootstrap-admin.ts`
- Create: `src/lib/auth/session.ts`
- Create: `src/lib/auth/password.ts`
- Create: `src/app/api/v1/auth/login/route.ts`
- Create: `src/app/api/v1/auth/logout/route.ts`
- Create: `src/app/api/v1/auth/me/route.ts`
- Create: `src/app/api/v1/auth/password/route.ts`
- Create: `src/app/login/page.tsx`
- Create: `src/middleware.ts`

**Step 1: 密码哈希工具（bcrypt）**

安装：`bun add bcryptjs`

实现 `src/lib/auth/password.ts`：

- `hashPassword(plain: string): Promise<string>`
- `verifyPassword(plain: string, hash: string): Promise<boolean>`
- rounds 使用 `serverEnv.BCRYPT_LOG_ROUNDS`

**Step 2: admin 自举（仅当 DB 无 admin 才读取 env）**

实现 `src/lib/auth/bootstrap-admin.ts`：

- 查询 `User where username='admin'`
- 不存在则要求 `ASSET_LEDGER_ADMIN_PASSWORD` 必须存在且非空：为空则 throw（生产环境用 fatal 日志 + 终止进程；开发环境至少返回 500 并打印清晰错误）
- 创建 admin（role=admin, passwordHash=bcrypt）

**Step 3: Session 机制（DB session + HttpOnly cookie）**

实现 `src/lib/auth/session.ts`：

- `createSession(userId): { sessionId, cookieValue }`
- `getSessionFromRequest(req): session | null`
- `destroySession(sessionId)`
- cookie 名：`session`；HttpOnly；SameSite=Lax；Secure=production
- cookieValue 建议为随机 token（DB 主键即可），并可加签名（使用 `SECRET_KEY`）

**Step 4: Auth API（对齐 `docs/design/asset-ledger-api-spec.md`）**

实现：

- `POST /api/v1/auth/login`：校验用户名/密码（v1.0 用户名固定 admin）；成功 set-cookie
- `POST /api/v1/auth/logout`：清 cookie + 删除 session
- `GET /api/v1/auth/me`：返回当前用户（id/username/role）
- `PUT /api/v1/auth/password`：校验 currentPassword，更新 hash，踢掉旧 session（可选：全部 session 失效）

**Step 5: 中间件路由守卫（仅 admin）**

实现 `src/middleware.ts`：

- 对 `/login` 放行
- 对 `/api/v1/auth/*` 放行（login/logout/me/password）
- 其余页面路由/管理 API：无 session → redirect `/login`；API 返回 401

**Step 6: 登录页**

实现 `src/app/login/page.tsx`：

- 表单：username/password（username 可默认 admin 或隐藏）
- 调用 `/api/v1/auth/login`，成功后跳转 `/`

**Step 7: Commit**

```bash
git add src/lib/auth src/app/api/v1/auth src/app/login src/middleware.ts package.json bun.lock
git commit -m "feat: add admin auth session and login page"
```

---

### Task 6: 凭据加密（AES-256-GCM）工具（AC-02 前置）

**Files:**

- Create: `src/lib/crypto/aes-gcm.ts`
- Test: `src/lib/crypto/aes-gcm.test.ts`

> 注：本 Task 仅实现加密工具和单测；凭据更新 API 在 Task 8 中实现（依赖本 Task 的加密工具）。

**Step 1: 实现 AES-256-GCM 加解密工具**

创建 `src/lib/crypto/aes-gcm.ts`：

- key 来自 `serverEnv.PASSWORD_ENCRYPTION_KEY`（base64url 32 bytes）
- 每次加密生成随机 nonce（12 bytes）
- 存储格式：`v1:<nonce_b64url>:<cipher_b64url>:<tag_b64url>`

**Step 2: 单测（加密后可解密、错误 key 失败）**

写 `src/lib/crypto/aes-gcm.test.ts`（用固定 key）：

- encrypt → decrypt roundtrip
- 错误 key decrypt throws

**Step 3: Commit**

```bash
git add src/lib/crypto src/lib/crypto/aes-gcm.test.ts
git commit -m "feat: add aes-256-gcm helper for credential encryption"
```

---

### Task 7: 调度组 API + UI（AC-03 部分）

**Files:**

- Create: `src/app/api/v1/schedule-groups/route.ts`
- Create: `src/app/api/v1/schedule-groups/[id]/route.ts`
- Create: `src/app/schedule-groups/page.tsx`
- Create: `src/app/schedule-groups/new/page.tsx`
- Create: `src/app/schedule-groups/[id]/edit/page.tsx`
- Modify: `src/bin/scheduler.ts`（接入结构化日志 + 触发事件）

**Step 1: ScheduleGroup CRUD API（对齐 API spec 第 3 章）**

- `GET /api/v1/schedule-groups`：分页列表
- `POST /api/v1/schedule-groups`：创建（校验 timezone IANA、HH:mm；`sourceIds` 多选且必填；仅允许 `enabled=true` 的 Source；创建后批量将所选 Source 绑定到该调度组）
- `GET /api/v1/schedule-groups/:id`
- `PUT /api/v1/schedule-groups/:id`：更新（同样支持 `sourceIds` 多选；若传入则按选择结果调整该组下 Source 归属；仅管理 `enabled=true` 的来源，disabled 来源不自动解绑）
- `DELETE /api/v1/schedule-groups/:id`：若仍绑定 Source 返回 409

**Step 2: UI 页面**

- 列表：name/enabled/timezone/runAtHhmm/sourceCount
- 新建/编辑：表单校验；启停开关；选择来源（多选，创建时必选 1+ 个，且仅展示 `enabled=true` 的来源）

**Step 3: Scheduler 日志事件对齐（schedule_group.triggered）**

改造 `src/bin/scheduler.ts` 输出 1 条 JSON 事件（字段对齐 `docs/design/asset-ledger-logging-spec.md` 2.2）。

**Step 4: Commit**

```bash
git add src/app/api/v1/schedule-groups src/app/schedule-groups src/bin/scheduler.ts
git commit -m "feat: add schedule group api and pages"
```

---

### Task 8: Source API + UI（AC-02）含软删除、最近 Run 摘要、凭据更新

**Files:**

- Create: `src/app/api/v1/sources/route.ts`
- Create: `src/app/api/v1/sources/[id]/route.ts`
- Create: `src/app/api/v1/sources/[id]/credential/route.ts`
- Create: `src/app/sources/page.tsx`
- Create: `src/app/sources/new/page.tsx`
- Create: `src/app/sources/[id]/edit/page.tsx`

**Step 1: Source CRUD API（对齐 API spec 第 4 章）**

- `GET /api/v1/sources`：默认排除 deleted；返回 `latestRun` 摘要（status/finishedAt/mode）
- `POST /api/v1/sources`：必填 name/sourceType/config.endpoint；`scheduleGroupId` 可空/可不传（默认不绑定调度组）；不允许回显凭据明文
- `PUT /api/v1/sources/:id`：更新非敏感字段
- `DELETE /api/v1/sources/:id`：软删除；若存在活动 Run（Queued/Running）返回 409

**Step 2:（历史/已废弃）Source 凭据更新 API**

`PUT /api/v1/sources/:id/credential` 在增量“凭据模块”上线后被废弃：

- 当前实现返回 410（Gone），提示使用 `/api/v1/credentials` 创建凭据并在 Source 上绑定 `credentialId`
- 备注：保留 route 仅用于兼容旧 UI/旧调用路径，避免 silent failure

**Step 3: UI 页面**

- Source 列表：name/type/enabled/scheduleGroup/最新 Run 状态
- 新建/编辑：endpoint + 凭据下拉选择 + enable 开关（**不**在 Source 表单里选择调度组；调度组成员关系在 Task 7 的调度组新建/编辑页管理）
- 删除：确认弹窗（对齐 UI spec 操作确认）

**Step 4: Commit**

```bash
git add src/app/api/v1/sources src/app/sources
git commit -m "feat: add source api and pages with encrypted credential update"
```

---

### Task 9: Run API + UI（AC-03/AC-04）：手动触发、列表/详情、单飞抑制审计（不做 cancel）

**Files:**

- Create: `src/app/api/v1/runs/route.ts`
- Create: `src/app/api/v1/runs/[id]/route.ts`
- Create: `src/app/api/v1/sources/[id]/runs/route.ts`
- Create: `src/app/runs/page.tsx`
- Create: `src/app/runs/[id]/page.tsx`
- Modify: `src/bin/worker.ts`

**Step 1: 手动触发 Run（按 Source）**

实现 `POST /api/v1/sources/:id/runs`：

- body: `{ mode: "collect" | "healthcheck" }`
- 若该 Source 存在活动 Run（Queued/Running）：
  - 返回 200 + 当前活动 `run_id`
  - 写 `AuditEvent`：`run.trigger_suppressed`

**Step 2: Run 列表/详情 API**

- `GET /api/v1/runs`：支持按 sourceId/status/mode/triggerType 过滤 + 分页
- `GET /api/v1/runs/:id`：返回 detectResult、stats、errors/warnings、driver/plugin 追溯字段

**Step 3: 取消 Run**

本次 MVP 不提供取消能力（不实现 `POST /api/v1/runs/:id/cancel`）。

**Step 4: UI 页面**

- Run 列表：过滤、状态标签（对齐 UI spec 6.1）
- Run 详情：errors/warnings 展示、detect/driver、统计摘要

**Step 5: Worker：记录 run.finished 宽事件 + 错误结构化**

改造 `src/bin/worker.ts`：

- 结束时输出 `run.finished` JSON 事件（对齐 logging spec）
- errors/warnings 结构化落库（对齐 error codes）

**Step 6: Commit**

```bash
git add src/app/api/v1/runs src/app/api/v1/sources src/app/runs src/bin/worker.ts
git commit -m "feat: add run api pages and worker run finished events"
```

---

### Task 10: vCenter Collector Plugin 实现（TypeScript）

> **技术选型决策**：选择 TypeScript + vSphere REST API，理由见 `docs/design/asset-ledger-collector-reference.md` 第 10 节。

**Files:**

- Create: `plugins/vcenter/index.ts`
- Create: `plugins/vcenter/client.ts`
- Create: `plugins/vcenter/normalize.ts`
- Create: `plugins/vcenter/types.ts`
- Create: `plugins/vcenter/package.json`
- Test: `plugins/vcenter/__tests__/normalize.test.ts`
- Test: `plugins/vcenter/__tests__/integration.test.ts`

**Step 1: 创建插件目录结构**

```bash
mkdir -p plugins/vcenter/__tests__
```

**Step 2: 初始化插件 package.json**

创建 `plugins/vcenter/package.json`：

```json
{
  "name": "@breach/vcenter-collector",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "index.ts",
  "scripts": {
    "start": "bun run index.ts",
    "test": "vitest run"
  }
}
```

**Step 3: 实现类型定义**

创建 `plugins/vcenter/types.ts`：

- `CollectorRequest`（对齐 collector-request-v1）
- `CollectorResponse`（对齐 collector-response-v1）
- `VCenterConfig`、`VCenterCredential`
- `NormalizedAsset`、`Relation`

**Step 4: 实现 vSphere REST API Client**

创建 `plugins/vcenter/client.ts`：

- `createSession(endpoint, username, password): sessionToken`
- `listVMs(endpoint, token): VmSummary[]`
- `listHosts(endpoint, token): HostSummary[]`
- `listClusters(endpoint, token): ClusterSummary[]`
- `getVmDetail(endpoint, token, vmId): VmDetail`
- `getHostDetail(endpoint, token, hostId): HostDetail`
- TLS：跳过证书校验（v1.0 允许自签名）

vSphere REST API 端点：

- `POST /api/session` → session token
- `GET /api/vcenter/vm` → VM 列表
- `GET /api/vcenter/vm/{vm}` → VM 详情
- `GET /api/vcenter/host` → Host 列表
- `GET /api/vcenter/host/{host}` → Host 详情
- `GET /api/vcenter/cluster` → Cluster 列表

**Step 5: 实现 normalize 转换**

创建 `plugins/vcenter/normalize.ts`：

- `normalizeVM(raw): { external_kind, external_id, normalized, raw_payload }`
- `normalizeHost(raw): ...`
- `normalizeCluster(raw): ...`
- `buildRelations(vms, hosts, clusters): Relation[]`

normalized 字段映射（对齐 `docs/design/asset-ledger-json-schema.md`）：

- VM: `identity.machine_uuid` ← `instance_uuid`，`identity.hostname` ← `guest.host_name`，`network.mac_addresses` ← `nics[].mac_address`
- Host: `identity.serial_number` ← `hardware.system_info.serial_number`，`network.management_ip` ← 从 vnics 提取

**Step 6: 实现入口（healthcheck/detect/collect）**

创建 `plugins/vcenter/index.ts`：

```typescript
// 1. 读取 stdin
const input = await Bun.stdin.text();
const request = JSON.parse(input);

// 2. 根据 mode 分发
switch (request.request.mode) {
  case 'healthcheck':
    response = await healthcheck(request);
    break;
  case 'detect':
    response = await detect(request);
    break;
  case 'collect':
    response = await collect(request);
    break;
}

// 3. 输出到 stdout
console.log(JSON.stringify(response));
```

- `healthcheck`：尝试创建 session，成功返回空 assets/errors
- `detect`：获取 vCenter About 信息，返回 `target_version`/`driver`
- `collect`：拉取全量 VM/Host/Cluster，normalize，构建 relations

**Step 7: 单元测试（normalize）**

创建 `plugins/vcenter/__tests__/normalize.test.ts`：

- 测试 `normalizeVM` 字段映射
- 测试缺失字段处理
- 测试 `buildRelations` 正确构建 VM→Host→Cluster

**Step 8: 集成测试（Mock vCenter）**

创建 `plugins/vcenter/__tests__/integration.test.ts`：

- 使用 Bun 内置 HTTP server 模拟 vSphere REST API
- 测试 healthcheck 成功/失败
- 测试 collect 输出符合 collector-response-v1

**Step 9: 配置环境变量**

更新 `src/lib/env/server.ts`：

- `ASSET_LEDGER_VCENTER_PLUGIN_PATH`：默认值 `plugins/vcenter/index.ts`（开发环境）

**Step 10: Commit**

```bash
git add plugins/vcenter src/lib/env/server.ts
git commit -m "feat: add vcenter collector plugin (typescript)"
```

---

### Task 11: Collector 契约对齐（collector-request/response v1）+ Schema 校验（AC-04 / Q-04）

**Files:**

- Create: `src/lib/schema/normalized-v1.schema.json`
- Create: `src/lib/schema/canonical-v1.schema.json`
- Create: `src/lib/schema/validate.ts`
- Modify: `src/bin/worker.ts`

**Step 1: 从文档抽取 JSON Schema 文件**

从 `docs/design/asset-ledger-json-schema.md` 复制 code block：

- `normalized-v1` → `src/lib/schema/normalized-v1.schema.json`
- `canonical-v1` → `src/lib/schema/canonical-v1.schema.json`

**Step 2: 引入 Ajv 并实现校验函数**

安装：`bun add ajv`

创建 `src/lib/schema/validate.ts`：

- `validateNormalizedV1(input): { ok: true } | { ok:false, issues:[...] }`
- `validateCanonicalV1(input): ...`

**Step 3: Worker：校验 plugin 输出**

在 `src/bin/worker.ts`：

- parse stdout 后校验 `schema_version === 'collector-response-v1'`
- 遍历 `assets[].normalized`：必须满足 `normalized-v1`
- 不通过：Run=Failed，错误码 `SCHEMA_INVALID`，并写明校验 issue（脱敏 + 截断）

**Step 4: Commit**

```bash
git add src/lib/schema src/bin/worker.ts
git commit -m "feat: validate collector output with json schema"
```

---

### Task 12: Ingest Pipeline（AC-05/AC-06）：入账、绑定、关系 upsert、生成 canonical-v1

**Files:**

- Create: `src/lib/ingest/ingest-run.ts`
- Create: `src/lib/ingest/raw.ts`
- Create: `src/lib/ingest/canonical.ts`
- Modify: `src/bin/worker.ts`

**Step 1: raw zstd 压缩工具**

安装 zstd lib（示例：`bun add @napi-rs/zstd`，以实际可用包为准）。

实现 `src/lib/ingest/raw.ts`：

- `compressRaw(json): { bytes, sizeBytes, hash, compression: 'zstd' }`
- hash 用 `sha256`（hex 或 base64）

**Step 2: SourceRecord 写入（按 (source, external_kind, external_id) 绑定 Asset）**

实现 `src/lib/ingest/ingest-run.ts`：

- 事务内处理：对每个 plugin asset
  - upsert `AssetSourceLink`（不存在则创建新 Asset + link）
  - 写入 `SourceRecord`（含 normalized + raw bytes + raw\_\* 元数据 + collectedAt/runId/sourceId/linkId）

**Step 3: RelationRecord + Relation upsert**

- 将 plugin relations 的 `from/to external` 通过 link 映射成 asset_uuid（找不到则记 warning 并跳过）
- 写入 `RelationRecord`（raw+元数据）
- upsert `Relation`（更新 lastSeenAt；首次写 firstSeenAt；status=active）

**Step 4: canonical-v1 生成（v1.0 可先单来源简化，但结构要兼容冲突）**

实现 `src/lib/ingest/canonical.ts`：

- 对每个 Asset 聚合该次 Run 的最新 SourceRecord（v1.0 单来源：直接映射）
- 输出 canonical-v1：fields 叶子为 `{ value, sources:[{source_id, run_id, record_id, collected_at}] }`
- relations.outgoing：从 Relation 表读取（VM→Host→Cluster）
- 校验 canonical-v1 schema（Task 10 的 validate）
- 写入 `AssetRunSnapshot`（assetUuid/runId/canonical）

**Step 5: Worker 串起来**

在 `src/bin/worker.ts`：

- mode=collect：plugin 成功且 inventory_complete=true 才允许 ingest + 推进 relation/asset last_seen
- mode=healthcheck：不 ingest，Run 仅记录 errors/stats/detect
- 任一步失败：Run=Failed，错误码对齐（RAW_PERSIST_FAILED/DB_WRITE_FAILED/SCHEMA_INVALID）

**Step 6: Commit**

```bash
git add src/lib/ingest src/bin/worker.ts
git commit -m "feat: ingest assets relations and generate canonical snapshots"
```

---

### Task 13: Asset API + UI（AC-05/AC-06）

**Files:**

- Create: `src/app/api/v1/assets/route.ts`
- Create: `src/app/api/v1/assets/[uuid]/route.ts`
- Create: `src/app/api/v1/assets/[uuid]/relations/route.ts`
- Create: `src/app/api/v1/assets/[uuid]/source-records/route.ts`
- Create: `src/app/assets/page.tsx`
- Create: `src/app/assets/[uuid]/page.tsx`

**Step 1: Asset 列表 API（最小分页/搜索/过滤/排序）**

实现 `GET /api/v1/assets`：

- filters: `asset_type`、`source_id`
- search: `q` 覆盖 `asset_uuid/hostname/external_id`（v1.0 最小）
- sort: `display_name`
- 返回：asset_uuid/asset_type/status/display_name/last_seen_at/source 摘要

**Step 2: Asset 详情 API**

实现 `GET /api/v1/assets/:uuid`：

- 返回最新 `AssetRunSnapshot.canonical`（或按需生成）

**Step 3: 来源明细与关系 API**

- `GET /assets/:uuid/source-records`：返回关联 SourceRecord（normalized + collectedAt + sourceId/runId）
- `GET /assets/:uuid/relations`：返回 outgoing 关系（runs_on/member_of）

**Step 4: UI 页面**

- Asset 列表：分页、搜索、过滤
- Asset 详情：渲染 canonical.fields（冲突标记按 UI spec 4）+ 来源明细（normalized 对比）+ 关系链（UI spec 5）

**Step 5: Commit**

```bash
git add src/app/api/v1/assets src/app/assets
git commit -m "feat: add asset api and pages"
```

---

### Task 14: Raw 查看入口（SourceRecord raw payload）+ 审计（admin-only）

**Files:**

- Create: `src/app/api/v1/source-records/[recordId]/raw/route.ts`
- Modify: `src/app/assets/[uuid]/page.tsx`
- Create: `src/components/raw/raw-dialog.tsx`
- Modify: `src/lib/ingest/raw.ts`（增加 decompress）

**Step 1: 提供 raw 查询 API（仅 admin）**

实现 `GET /api/v1/source-records/:recordId/raw`：

- 校验 session + admin
- 从 DB 读取 SourceRecord：`raw`(bytea) + `raw_hash/raw_size_bytes/raw_compression` + `runId/sourceId/collectedAt`
- zstd 解压 + JSON.parse
- 响应包含：
  - `rawPayload`（JSON）
  - `meta`（hash/size/compression/collectedAt/runId/sourceId）

**Step 2: 防御性脱敏**

对 `rawPayload` 做递归脱敏（最小策略即可）：

- key 命中 `password|secret|token|access_key|accessKey|ak|sk` → value 替换为 `"***"`

**Step 3: 写审计事件**

写入 `AuditEvent`：

- `eventType = "source_record.raw_viewed"`
- `actorUserId = currentUser.id`
- payload 包含 `recordId/runId/sourceId/assetUuid?`（可选）+ `requestId`

**Step 4: UI 入口（Asset 详情的来源明细）**

在 `src/app/assets/[uuid]/page.tsx` 的来源明细表格中增加 “查看 raw” 按钮：

- 点击后打开 `Dialog`（shadcn）展示 JSON（可加 copy/download）
- 失败按 UI spec 错误展示规范提示（403/500）

**Step 5: Commit**

```bash
git add src/app/api/v1/source-records src/app/assets src/components/raw src/lib/ingest/raw.ts
git commit -m "feat: add admin raw viewer with audit"
```

---

### Task 15: OpenAPI/Swagger 交付物（AC-08）

**Files:**

- Create: `src/lib/openapi/spec.ts`
- Create: `src/app/api/openapi.json/route.ts`
- Create: `src/app/api/docs/page.tsx`（或 `src/app/api/docs/route.ts`）

**Step 1: 选型并接入 zod → openapi 生成**

安装（示例）：`bun add @asteasolutions/zod-to-openapi`

**Step 2: 定义 OpenAPI spec 生成器**

实现 `src/lib/openapi/spec.ts`：

- API 入参/出参 Zod schema 为单一真相
- routes 覆盖 v1.0 UI 所需 API（auth/schedule-groups/sources/runs/assets）

**Step 3: 暴露 openapi.json**

实现 `GET /api/openapi.json`

**Step 4: Swagger UI 页面**

实现 `/api/docs`：加载 openapi.json 并渲染；仅 admin 可访问（middleware 保护）。

**Step 5: Commit**

```bash
git add src/lib/openapi src/app/api/v1/openapi.json src/app/api/docs
git commit -m "feat: add openapi json and swagger ui"
```

---

### Task 16: 日志规范落地（Q-02）：http.request / schedule_group.triggered / run.finished

**Files:**

- Create: `src/lib/logging/logger.ts`
- Modify: `src/middleware.ts`
- Modify: `src/bin/scheduler.ts`
- Modify: `src/bin/worker.ts`

**Step 1: 实现 JSON logger（event envelope）**

实现 `src/lib/logging/logger.ts`（字段对齐 `docs/design/asset-ledger-logging-spec.md` 1/2/3）：

- `logEvent({ event_type, level, request_id?, user_id?, ... })` → `console.log(JSON.stringify(...))`
- 默认截断 `*_excerpt` 字段（≤ 2000 chars）

**Step 2: middleware 记录 http.request**

- 每个请求结束输出 1 条 `http.request`
- 关联 request_id（从 `X-Request-ID` 或生成）

**Step 3: scheduler/worker 事件标准化**

- scheduler：每次触发输出 1 条 `schedule_group.triggered`
- worker：每个 Run 完成输出 1 条 `run.finished`

**Step 4: Commit**

```bash
git add src/lib/logging src/middleware.ts src/bin/scheduler.ts src/bin/worker.ts
git commit -m "feat: add wide event logging"
```

---

### Task 17: E2E 闭环验收（Playwright）与最小集成测试

**Files:**

- Create: `playwright.config.ts`
- Create: `e2e/admin.spec.ts`
- (Optional) Create: `src/test/db.ts`（测试库创建/清理）

**Step 1: 安装 Playwright**

Run: `bun add -D @playwright/test`

**Step 2: 写最小 E2E**

`e2e/admin.spec.ts` 覆盖：

- 登录 → 创建凭据 → 创建 Source（不绑定调度组） → 创建调度组并选择来源（多选） → 调度组手动运行（批量 collect） → 进入 Run 详情 → Asset 列表/详情 → 关系链展示

**Step 3: Commit**

```bash
git add playwright.config.ts e2e
git commit -m "test: add playwright e2e for vcenter mvp happy path"
```

---

## 增量：凭据模块 + 调度组手动运行（PRD v1.0）

PRD：`docs/prds/asset-ledger-vcenter-mvp-credentials-sg-manual-run-v1.0-prd.md`

关键约束（执行中保持一致）：

- **不做历史数据迁移**：不将旧 `Source.credentialCiphertext` 迁移为 Credential；新实现也**不再读取**旧字段（管理员需在新模块重新创建并绑定）。
- **不回显明文**：任何 API 响应、日志、UI 都不得出现明文 secret（password/token/AK/SK）。
- **删除口径**：Credential 的 `usageCount` 仅统计 `Source.deletedAt IS NULL` 的引用；建议在 Source 软删除时将 `credentialId` 置空，以匹配口径并避免 DB 外键阻塞删除。
- **并发安全**：调度组手动运行必须在同一事务内完成“检查活动 Run + 创建新 Run”，并用 `FOR UPDATE SKIP LOCKED` 避免竞态重复入队。

---

### Task 18: 扩展错误码（Credential Not Found）

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

### Task 19: 数据模型（Credential 实体 + Source 绑定）

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/*`（由 Prisma 生成）

**Step 1: 为 Prisma Schema 增加 Credential 模型与 Source.credentialId**

修改 `prisma/schema.prisma`（示例；以现有模型为准合并）：

```prisma
model Credential {
  id                String    @id @default(cuid())
  name              String    @unique
  type              SourceType
  payloadCiphertext String
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

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

### Task 20: 定义 Credential Zod Schema（按 SourceType 字段变化）

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

**Step 3: 实现 schema（按 PRD 字段集合）**

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

### Task 21: Credentials API（CRUD + usageCount + 删除限制）

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
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);
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
  - `usageCount`：只统计未删除 Source（建议 Source 软删除时清空 `credentialId`，则可用 relation \_count）
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

### Task 22: Source API 改造（绑定 credentialId + 返回摘要 + 移除旧凭据入口）

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
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);
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
  : null;
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

### Task 23: Worker/Scheduler 使用新 Credential（不再读取旧字段）

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

### Task 24: 调度组手动运行 API（批量 collect/manual）

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
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);
    vi.mocked(prisma.scheduleGroup.findUnique).mockResolvedValue({ id: 'g1' } as any);
    vi.mocked(prisma.$transaction).mockResolvedValue({
      queued: 0,
      skipped_active: 0,
      skipped_missing_credential: 2,
      message: 'no eligible sources',
    });

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

### Task 25: Web UI（Credentials 页面 + Source 表单绑定 + 调度组运行按钮）

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
  - 允许不选择（credentialId=null）
- 删除旧的 “更新凭据” 表单（原调用 `/sources/:id/credential`）
- 若 Source `enabled=true` 且 `credentialId` 为空：显示明显提示（文案参照 PRD 4.2）

**Step 6: 调度组列表行新增「运行」按钮**

Modify `src/app/schedule-groups/page.tsx`：

- 每行新增按钮「运行」
- 点击后 POST `/api/v1/schedule-groups/:id/runs`
- toast 展示 `queued/skipped_active/skipped_missing_credential`；queued=0 时展示 message

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

### Task 26: OpenAPI/Docs/E2E 更新（交付收尾）

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

**Step 2: 文档更新**

- 更新 `README.md` 与 `docs/index.md`：补充增量 PRD 链接与实现要点
- 同步更新 README 中 `PASSWORD_ENCRYPTION_KEY` 描述：由 “Source 凭据密文” 调整为 “Credential 凭据密文”

**Step 3: 更新 Playwright E2E 覆盖新路径**

Modify `e2e/admin.spec.ts`：

- 不再调用 `/api/v1/sources/:id/credential`
- 改为：
  - POST `/api/v1/credentials` 创建凭据（若环境变量提供 vCenter 凭据则使用；否则可创建 dummy 并验证 skip_missing_credential）
  - Source create/update 绑定 `credentialId`（不要求/不提交 `scheduleGroupId`）
  - POST `/api/v1/schedule-groups` 创建调度组时传 `sourceIds` 多选绑定来源
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

---

## 执行顺序建议（最快跑通闭环）

**完整顺序**：

```
Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7 → Task 8 → Task 9 → Task 10 → Task 11 → Task 12 → Task 13 → Task 14 → Task 16 → Task 15 → Task 17 → Task 18 → Task 19 → Task 20 → Task 21 → Task 22 → Task 23 → Task 24 → Task 25 → Task 26
```

**分阶段说明**：

1. **基础设施**（Task 1-3）：错误码/响应封装 → Vitest 测试基座 → UI 基座（Tailwind + shadcn）
2. **数据模型**（Task 4）：Prisma schema 补齐 + 分区迁移
3. **认证与加密**（Task 5-6）：admin 登录/会话 → AES-GCM 凭据加密工具
4. **配置管理**（Task 7-8）：调度组 API/UI → Source API/UI（含凭据更新）
5. **采集核心**（Task 9-12）：Run API/UI → **vCenter Plugin** → Collector Schema 校验 → Ingest Pipeline
6. **Asset 展示**（Task 13-14）：Asset API/UI → raw 查看 + 审计
7. **日志规范**（Task 16）：结构化日志事件
8. **交付物**（Task 15, 17）：OpenAPI/Swagger → E2E 测试
9. **增量能力**（Task 18-26）：Credential 模块（CRUD/加密/复用）→ Source 绑定改造 → 调度组一键手动运行 → UI/E2E/OpenAPI 更新

> **注**：Task 16（日志）放在 Task 15（OpenAPI）之前，因为日志事件可在 E2E 中验证；OpenAPI 依赖所有 API 稳定后再生成。增量部分的 OpenAPI/Docs/E2E 更新集中在 Task 26。
