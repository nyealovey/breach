# Schedule Groups 后台页鉴权收敛（Server Wrapper 模式）

## 背景

`/schedule-groups/**` 的“新建/编辑”页面属于后台管理能力，需要管理员权限才能访问。

此前实现中，页面可能通过 Client Component 内的 `RequireAdminClient` 在浏览器侧二次发起鉴权（通常是调用 `/api/v1/auth/me`），这会带来：

- 首屏/水合后才拦截，可能产生 UI 闪烁；
- 与服务端（middleware / server component）鉴权职责重复；
- 每次进入页面多一次网络往返与额外复杂度。

## 目标

将后台页鉴权入口统一为 **Server Wrapper**：

- 入口文件保持为 App Router 标准的 `page.tsx`（Server Component）
- 在 `page.tsx` 中调用 `requireServerAdminSession()` 做鉴权
- 真实 UI 仍由 `page.client.tsx`（Client Component）承载，但不再包含 `RequireAdminClient`

## 变更范围

- `/schedule-groups/new`
  - Server：`src/app/schedule-groups/new/page.tsx`
  - Client：`src/app/schedule-groups/new/page.client.tsx`（移除 `RequireAdminClient`）
- `/schedule-groups/[id]/edit`
  - Server：`src/app/schedule-groups/[id]/edit/page.tsx`（新增 wrapper）
  - Client：`src/app/schedule-groups/[id]/edit/page.client.tsx`（由原 `page.tsx` 迁移而来）

## 行为约定

- 未登录：由全局 `src/middleware.ts` 统一拦截并重定向到 `/login`（页面）或返回 401 JSON（API）。
- 已登录但非管理员：由 `requireServerAdminSession()` 在服务端直接拒绝（具体响应策略以其实现为准）。
- 业务 API：仍需在对应 Route Handler 内做权限校验（不要依赖仅页面层鉴权）。
