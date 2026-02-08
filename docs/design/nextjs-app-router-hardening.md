# Next.js App Router 体验与稳定性加固

## 背景

本仓库基于 Next.js App Router。为贴近 Next.js 最佳实践并降低线上不确定性，本次对以下方向做了加固：

- RSC/Client 边界相关的渲染稳定性（Suspense 边界）
- 全局错误与 404 兜底（error/not-found/loading）
- 原始 SQL 查询安全性（减少 `$queryRawUnsafe`）
- 后台管理页鉴权入口收敛（Server Wrapper，避免 Client 二次鉴权闪烁）
- 清理未引用的静态资源与样式文件

## 变更点

### 1) 顶部导航增加 Suspense 边界

`AppTopNav` 是 Client Component 且使用 `usePathname()`，在某些路由形态下需要 Suspense 边界以避免渲染优化退化。

- 在根布局中将 `<AppTopNav />` 包裹在 `<Suspense>` 内，并提供轻量 fallback（保持 header 高度与基础信息）。

### 2) 补齐 App Router 兜底文件

新增根级兜底，覆盖常见异常与 404：

- `src/app/error.tsx`：路由段错误边界（Client Component，提供 reset 重试）
- `src/app/global-error.tsx`：根布局错误兜底（Client Component，包含 `<html>`/`<body>`）
- `src/app/not-found.tsx`：404 页面
- `src/app/loading.tsx`：根级 loading UI

目的：

- 统一异常用户体验
- 给错误恢复（reset）与跳转提供标准入口

### 3) 首页 Top 字段统计：减少 `$queryRawUnsafe`

首页使用原始 SQL 做 Top 统计时，需要动态选择 allowlist 内的列名（source/override）。为降低误用风险：

- 将 `$queryRawUnsafe` 替换为 `$queryRaw(Prisma.sql\`\`)` 的形态
- 仅对列名使用 `Prisma.raw(...)`（列名来自硬编码 allowlist）

> 说明：标识符（列名）无法参数化，`Prisma.raw` 仍要求输入必须来自可信 allowlist；本项目通过常量表保证这一点。

### 4) 清理未引用文件

移除未发现引用的脚手架残留文件，减少噪音：

- `public/next.svg`
- `src/app/page.module.css`

### 5) 后台管理页鉴权：从 Client 收敛到 Server Wrapper

此前部分后台页采用“整页 Client + `RequireAdminClient`”的方式做管理员拦截，容易导致：

- 首屏/水合后才发现无权限，出现 UI 闪烁；
- 与服务端鉴权职责重复；
- 每次进入页面额外网络请求与复杂度。

本次将后台页统一改为 **Server Wrapper** 模式：

- `page.tsx`（Server Component）中调用 `requireServerAdminSession()`
- 页面交互仍由 `page.client.tsx`（Client Component）承载，但不再包含 `RequireAdminClient`

涉及路由（示例）：

- `/users`
- `/duplicate-candidates/**`
- `/schedule-groups/**`

### 6) `useSearchParams/usePathname`：在页面入口补齐 Suspense

对依赖 `useSearchParams()` / `usePathname()` 的页面，采用“Server Wrapper + Client 子组件”的方式在入口补齐 `<Suspense>`，避免缺失 Suspense 边界导致的渲染退化/告警。

涉及路由（示例）：

- `/assets`
- `/duplicate-candidates`
- `/source-records/[recordId]`

## 后续建议（未在本次改动中完成）

当前仍有多条路由是“整页 Client Component + useEffect 拉取 /api/v1/\*”的数据模式。若要进一步发挥 App Router（RSC/SSR/Streaming）的优势，建议按页面分批改造为：

- Server Component 负责读取数据（直接 Prisma 查询）
- Client Component 仅承载交互（筛选、按钮、对话框等）
