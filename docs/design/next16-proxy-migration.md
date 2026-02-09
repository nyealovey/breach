# Next.js 16：`middleware.ts` → `proxy.ts` 迁移记录

## 背景

Next.js 16+ 弃用了 `middleware.ts` 文件约定，并引入 `proxy.ts` 作为替代。为消除构建告警并保持未来兼容性，本仓库已将全局请求门禁入口迁移到 `src/proxy.ts`。

## 迁移内容

### 1) 文件名

- 旧：`src/middleware.ts`
- 新：`src/proxy.ts`

### 2) 导出约定

按 Next.js 16+ 约定：

- 旧：`export function middleware(request)`
- 新：`export function proxy(request)`

以及 matcher 配置：

- 旧：`export const config = { matcher: [...] }`
- 新：`export const proxyConfig = { matcher: [...] }`

## 行为不变（仍在 Edge 环境执行）

本次迁移仅变更文件约定与导出名，不改变既有行为，包括：

- 未登录访问页面：重定向到 `/login`
- 未登录访问 API：返回 `401` JSON
- 注入/透传 `x-request-id`，并在响应头写入 `X-Request-ID`
- 记录结构化日志（`http.middleware` / `http.request`）

## 验证方式

1. 运行 `bun run build`，确认不再出现 `middleware` 约定弃用告警。
2. 确认仓库内不再存在 `src/middleware.ts`（同时存在会导致 Next.js 检测冲突或出现告警）。
