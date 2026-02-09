# Duplicate Candidates / Source Record 服务端首屏与瀑布优化（2026-02-09）

## 背景

在扫描中发现以下问题：

- 重复候选详情页与合并页首屏存在多段客户端请求瀑布（候选 -> canonical -> relations）。
- 重复候选列表页与 Source Record 页面是纯客户端首屏拉取，首屏需要额外等待一次 API。
- Source Record 的 Raw 入口前端始终展示，非管理员点击会触发可预期失败请求。
- 部分 Server Page 与 Route Handler 存在可并行 IO 的串行 await。

## 目标

- 将关键页面改为“服务端首屏注水 + 客户端增量交互”。
- 消除可避免的首屏请求瀑布。
- 让权限可见性和服务端权限策略保持一致。
- 在不改变现有 API 语义的前提下，降低 TTFB 与首屏等待。

## 方案

### 1) 重复候选详情/合并页：服务端一次性读取

新增 `src/lib/duplicate-candidates/server-data.ts`：

- `readDuplicateCandidatePageInitialData(candidateId)`
  - 读取候选基础信息与 source links。
  - 并行读取 A/B 最新 canonical 快照并提取 `fields`。
  - VM 场景下并行读取 A/B active relations 并计算 `runs_on` 宿主机。

页面改造：

- `src/app/duplicate-candidates/[candidateId]/page.tsx`
- `src/app/duplicate-candidates/[candidateId]/merge/page.tsx`

以上页面改为服务端准备 `initialData` 并传给 client。客户端移除首屏候选/canonical/relations 的 fetch effect，避免多段瀑布。

### 2) 重复候选列表页：服务端首屏 + 客户端后续筛选

新增：

- `readDuplicateCandidatesListInitialData(searchParams)`（同文件）
- `src/lib/duplicate-candidates/page-data.ts`（列表与详情共享类型）

页面改造：

- `src/app/duplicate-candidates/page.tsx`：服务端读取首屏列表。
- `src/app/duplicate-candidates/page.client.tsx`：
  - 用 `initialData` 初始化列表。
  - 通过 `skipInitialFetchRef` 跳过首屏重复请求。
  - 后续 URL 变更仍走客户端请求（保留交互体验）。

### 3) Source Record：服务端首屏 + Raw 权限可见性对齐

新增：

- `src/lib/source-records/page-data.ts`
  - `parseSourceRecordTab(raw, isAdmin)`：非管理员强制归一到 `normalized`。

页面改造：

- `src/app/source-records/[recordId]/page.tsx`
  - 服务端读取 session 与角色。
  - 按 tab 在服务端调用 `getSourceRecordNormalizedAction / getSourceRecordRawAction` 提供首屏数据。
- `src/app/source-records/[recordId]/page.client.tsx`
  - 使用 `initialData` 初始化并跳过首屏重复请求。
  - 非管理员不展示 Raw tab。

### 4) 串行 await 并行化与无效 state 清理

- 并行化：
  - `src/app/assets/page.tsx`
  - `src/app/runs/page.tsx`
  - `src/app/runs/[id]/page.tsx`
  - `src/app/assets/[uuid]/page.tsx`
  - `src/app/api/v1/assets/[uuid]/route.ts`（snapshot 与 veeam signal 并行读取）
- 清理无效状态：
  - `src/app/assets/[uuid]/page.client.tsx` 移除恒为 `false` 的 `loading` state 与死分支。

## 影响与兼容性

- 不变更现有 API 的 URL 与返回结构。
- 仅调整页面首屏数据来源与请求时机。
- 权限控制更严格对齐：非管理员不再暴露 Raw 快捷入口。

## 验证

已执行：

- `bun run lint`
- `bun run type-check`
- `bun run build`

均通过。
