# Aliyun ECS + RDS Collector Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 新增阿里云 inventory 插件，在一次 `collect` 中同时输出 ECS+RDS（均入账为 VM），字段映射对齐现有 vCenter/Hyper-V/PVE 的 `normalized-v1` 语义，并补齐 UI/worker/env/文档。

**Architecture:** 新增 `plugins/aliyun`（bun 可执行脚本）实现：`healthcheck/detect/collect`；collector 输出 `collector-response-v1`，assets 的 `external_kind` 使用 core 允许的 `vm`；通过 `external_id` 前缀避免 ECS/RDS 冲突；Sources UI 增加阿里云 config（regions 等）与 include 开关；core 增加 Aliyun plugin path env 并接入 worker 路由。

**Tech Stack:** Next.js + Prisma + bun + vitest；阿里云 Node SDK v2（ECS/RDS）。

## Public APIs / Interfaces 变更点

### 1) 新增 server env

- `ASSET_LEDGER_ALIYUN_PLUGIN_PATH`（default：`plugins/aliyun/index.ts`）

### 2) Aliyun Source config（Source.config，非敏感；snake_case）

- `endpoint`: string（必填占位；UI 默认填 `https://ecs.aliyuncs.com`；插件忽略）
- `regions`: string[]（必填）
- `timeout_ms`: number（default `60_000`）
- `max_parallel_regions`: number（default `3`）
- `include_stopped`: boolean（default `true`；仅影响 ECS）
- `include_ecs`: boolean（default `true`）
- `include_rds`: boolean（default `true`）

### 3) Aliyun Credential payload（已存在；camelCase）

- `accessKeyId`, `accessKeySecret`
- v1 明确：不支持 `stsToken`

### 4) Aliyun 插件 assets 外部键（避免冲突）

- ECS：`external_kind='vm'`，`external_id='ecs:<InstanceId>'`
- RDS：`external_kind='vm'`，`external_id='rds:<DBInstanceId>'`

## Tasks

### Task 1: PRD 对齐并加入 RDS（含字段映射表）

**Files:**

- Modify: `docs/prds/M11-asset-ledger-aliyun-collector-v1.0-prd.md`

**Validation:**

- Run: `bun run format:check`

### Task 2: 设计文档同步（collector reference + UI spec）

**Files:**

- Modify: `docs/design/asset-ledger-collector-reference.md`
- Modify: `docs/design/asset-ledger-ui-spec.md`

**Validation:**

- Run: `bun run format:check`

### Task 3: Core 接线（env + worker 路由）

**Files:**

- Modify: `src/lib/env/server.ts`
- Modify: `src/bin/worker.ts`

**Validation:**

- Run: `bun run type-check`
- Run: `bun test`

### Task 4: Sources UI 增加 Aliyun 配置（含 include_ecs/include_rds）

**Files:**

- Modify: `src/app/sources/new/page.tsx`
- Modify: `src/app/sources/[id]/edit/page.tsx`

**Validation:**

- Run: `bun run lint`
- Run: `bun run type-check`

### Task 5: 新增 plugins/aliyun（ECS+RDS 同一 collect 输出）

**Files:**

- Create: `plugins/aliyun/index.ts`（`#!/usr/bin/env bun`）
- Create: `plugins/aliyun/types.ts`
- Create: `plugins/aliyun/ecs-client.ts`
- Create: `plugins/aliyun/rds-client.ts`
- Create: `plugins/aliyun/normalize.ts`
- Create: `plugins/aliyun/__tests__/normalize-ecs.test.ts`
- Create: `plugins/aliyun/__tests__/normalize-rds.test.ts`
- Create: `plugins/aliyun/__tests__/errors.test.ts`
- Modify: `package.json`（root deps）
- Modify: `bun.lock`

**Validation:**

- Run: `bun test`

### Task 6: 手工验收清单

- UI：`/sources/new`、`/sources/[id]/edit` 对 aliyun 的 regions/include 等可回填/可保存
- Run：`healthcheck/detect/collect` 可跑通（需真实账号手工回归）
