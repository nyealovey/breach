# 资产台账 vCenter MVP v1.0 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 vCenter MVP（PRD v1.0）端到端闭环：管理员登录 → 配置调度组/Source/凭据 → healthcheck/collect → 查看 Run → 浏览 Asset（统一视图/来源明细）→ 查看 VM→Host→Cluster 关系链，并交付 OpenAPI/Swagger。

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
  return NextResponse.json(
    { data, meta: { timestamp: new Date().toISOString() } },
    { status: 200, ...init },
  );
}

export function created<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(
    { data, meta: { timestamp: new Date().toISOString() } },
    { status: 201, ...init },
  );
}

export function fail(error: AppError, status: number, init?: ResponseInit) {
  return NextResponse.json(
    { error, meta: { timestamp: new Date().toISOString() } },
    { status, ...init },
  );
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
- `POST /api/v1/schedule-groups`：创建（校验 timezone IANA、HH:mm）
- `GET /api/v1/schedule-groups/:id`
- `PUT /api/v1/schedule-groups/:id`
- `DELETE /api/v1/schedule-groups/:id`：若仍绑定 Source 返回 409

**Step 2: UI 页面**

- 列表：name/enabled/timezone/runAtHhmm/sourceCount
- 新建/编辑：表单校验；启停开关

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
- `POST /api/v1/sources`：必填 name/sourceType/scheduleGroupId/config.endpoint；不允许回显 credential
- `PUT /api/v1/sources/:id`：更新非敏感字段
- `DELETE /api/v1/sources/:id`：软删除；若存在活动 Run（Queued/Running）返回 409

**Step 2: 凭据更新 API**

实现 `PUT /api/v1/sources/:id/credential`：

- body: `{ username, password }`
- 使用 Task 6 的 AES-GCM 加密后写入 `Source.credentialCiphertext`
- 响应不返回密文；UI 显示 “已设置/已更新”

**Step 3: UI 页面**

- Source 列表：name/type/enabled/scheduleGroup/最新 Run 状态
- 新建/编辑：endpoint + schedule group 选择 + enable 开关
- 凭据更新：单独表单；不回显 password；提交前二次确认
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
  case 'healthcheck': response = await healthcheck(request); break;
  case 'detect': response = await detect(request); break;
  case 'collect': response = await collect(request); break;
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
  - 写入 `SourceRecord`（含 normalized + raw bytes + raw_* 元数据 + collectedAt/runId/sourceId/linkId）

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

- 登录 → 创建调度组 → 创建 Source → 更新凭据 → healthcheck → 手动 collect → 进入 Run 详情 → Asset 列表/详情 → 关系链展示

**Step 3: Commit**

```bash
git add playwright.config.ts e2e
git commit -m "test: add playwright e2e for vcenter mvp happy path"
```

---

## 执行顺序建议（最快跑通闭环）

**完整顺序**：

```
Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7 → Task 8 → Task 9 → Task 10 → Task 11 → Task 12 → Task 13 → Task 14 → Task 16 → Task 15 → Task 17
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

> **注**：Task 16（日志）放在 Task 15（OpenAPI）之前，因为日志事件可在 E2E 中验证；OpenAPI 依赖所有 API 稳定后再生成。
