# Root Layout Hydration 修复（2026-02-09）

## 背景

在 Next.js 16.1.4（Turbopack 开发模式）下，首页出现可恢复错误：

- `Hydration failed because the server rendered HTML didn't match the client`
- 差异点定位到 `src/app/layout.tsx` 的主内容容器（`<main>` 内部）

排查后发现，根布局顶部导航 `AppTopNav`（Client Component）被 `Suspense` 包裹时，服务端首屏结构与客户端首次水合树在部分场景下出现不一致，导致根布局层级被判定为 hydration mismatch。

## 变更

- 文件：`src/app/layout.tsx`
- 调整：
  - 移除根布局中 `AppTopNav` 外层的 `Suspense` 包裹与 fallback 组件；
  - 恢复为直接渲染 `<AppTopNav isAdmin={isAdmin} />`。

## 影响说明

- 导航功能与权限展示逻辑（admin/user）不变。
- 主要收益是消除开发态下该路径的 hydration mismatch 噪音，避免页面首屏被客户端整树重建。
- 本次不涉及接口、鉴权规则、数据库模型与业务数据变更。
