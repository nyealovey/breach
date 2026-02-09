# Next 核心一致性加固（2026-02-09）

## 背景

在资产模块完成 Server-first 重构后，继续收敛项目的核心一致性：

- 构建默认链路与 Next 16 默认方向对齐。
- 登录与个人中心页面减少不必要的首屏客户端请求。
- 补充基础 metadata 文件约定。
- 恢复对 `<img>` 的 lint 防回归保护。

## 变更内容

### 1) 构建脚本对齐 Turbopack

- `package.json`
  - `build` 改为 `next build --turbo`
  - 保留 `build:webpack` 作为显式兼容入口

目标：默认构建路径与 Next 16 一致，同时保留 Webpack 回退命令用于排障。

### 2) 登录页改为 Server 包装 + Client 交互

- 新增 `src/app/login/page.client.tsx`（保留原表单交互）
- `src/app/login/page.tsx` 改为 Server Page：
  - 已登录用户直接 `redirect('/assets')`
  - 未登录渲染 Client 表单

目标：避免已登录用户进入登录页后再走一轮客户端流程。

### 3) 个人中心改为 Server 注入用户态

- 新增 `src/app/profile/page.client.tsx`
- `src/app/profile/page.tsx` 改为 Server Page：
  - 无会话 `redirect('/login')`
  - 有会话时将用户信息作为 `initialUser` 注入 Client

目标：去除 profile 首屏 `useEffect -> getMeAction()` 的额外往返。

### 4) 恢复 no-img-element 规则

- `eslint.config.mjs`
  - `@next/next/no-img-element` 从关闭改为 `error`

目标：避免未来误用原生 `<img>` 造成优化回退。

### 5) 增加 robots 文件约定

- 新增 `src/app/robots.ts`
  - 当前策略为 `disallow: '/'`（项目未上线，默认禁止索引）

目标：明确当前阶段的搜索引擎索引策略。

## 验证

- `bun run lint`
- `bun run type-check`
- `bun run build`
