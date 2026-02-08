# 认证请求门禁（Middleware）设计

## 背景与目标

本项目需要在进入应用路由前，对“是否已登录”做统一门禁：

- **未登录访问页面**：重定向到 `/login`
- **未登录访问 API（`/api/**`）**：直接返回 `401` JSON（不重定向）
- **过期 session cookie**：不应被当作已登录（避免重定向循环/页面闪烁）

仓库历史上曾同时存在两套入口（`proxy.ts` 与 `src/middleware.ts`）。为避免逻辑漂移与不可预测行为，现统一为 **`src/middleware.ts` 单入口**。

## 为什么选择 `src/middleware.ts` 作为唯一入口

- Next.js 对 `middleware.ts`（或 `src/middleware.ts`）有明确的加载约定，行为更可预测。
- 收敛入口后，鉴权/重定向/请求 ID 注入/日志规则都有单一事实来源，降低维护成本。

## Middleware 职责与策略

### 1) matcher（拦截范围）

当前 matcher：

- 拦截：除静态资源与公共 SEO 文件以外的所有路径
- 排除：
  - `_next/static`
  - `_next/image`
  - `favicon.ico`
  - `robots.txt`
  - `sitemap.xml`

**新增公共路径规则**：如果未来添加新的公共静态文件/SEO 文件，需要同时：

1. 把路径加入 `config.matcher` 的排除列表
2. 在本文档中补充说明（确保可审计）

### 2) 放行路径（无需登录也必须可访问）

无需登录即可放行的路径：

- `/login`
- `/api/v1/auth/*`（登录/登出/会话检查等）

### 3) 登录态判断（session cookie）

Cookie 名称：`session`

判断逻辑：

- 若 cookie 为空：未登录
- 若 cookie 为 `v1:<sessionId>:<expiresMs>:<sig>`：
  - **只使用 `expiresMs` 判断是否过期**
  - `expiresMs <= now` 视为未登录（避免过期 cookie 造成的重定向循环）
  - **不在 middleware 中验签**（Edge 环境下不使用 Node `crypto`；本判断仅用于“是否重定向”的用户体验兜底）
- 其他格式：按 legacy/dev 模式，仅判非空

> 安全边界：middleware 的 cookie 解析是“体验兜底”，**最终鉴权以服务端会话校验为准**（API/Server 侧仍会校验 session 是否真实存在且未过期）。

### 4) 页面与 API 的未登录行为

- **页面（非 `/api/**`）**：未登录 → `NextResponse.redirect('/login')`
- **API（`/api/**`）**：未登录 → `401` JSON，响应体形如：
  - `error`：包含 `code/category/message/retryable`
  - `meta`：包含 `requestId/timestamp`

### 5) Request ID 注入（`x-request-id` / `X-Request-ID`）

- 若请求头存在 `x-request-id`：沿用
- 否则生成：`req_<uuid>`
- 放行（pass）时：
  - 向下游请求注入 `x-request-id`
  - 在响应头写入 `X-Request-ID`
- 拦截（401/redirect）时：
  - 仅在响应头写入 `X-Request-ID`（无下游请求）

### 6) 日志（避免“伪 200”）

middleware 不等于最终响应，因此：

- **放行（NextResponse.next）**：
  - `event_type: 'http.middleware'`
  - `middleware_action: 'pass'`
  - 记录 `http.method`、`http.path`
  - **不记录 `http.status_code`**
- **拦截（401 JSON / redirect）**：
  - `event_type: 'http.request'`
  - 记录真实 `http.status_code`（如 401、307）

## 代码位置

- 唯一入口：`src/middleware.ts`
