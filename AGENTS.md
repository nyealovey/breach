# 仓库贡献指南

## 项目结构与模块组织

- `src/app/`：Next.js App Router 路由（如 `page.tsx`、`layout.tsx`）及页面级样式。
- `src/lib/`：通用工具与封装（环境变量校验在 `src/lib/env/{server,client}.ts`）。
- `public/`：静态资源（以 `/` 路径提供）。
- 根目录配置：`next.config.ts`（含 CSP）、`redirects.ts`、`eslint.config.mjs`、`tsconfig.json`。

推荐使用 `@/` 路径别名引用 `src` 下代码，例如：`import { serverEnv } from '@/lib/env/server'`。

## 构建、检查与本地开发命令

本仓库使用 Node `24`（见 `.nvmrc`），并统一使用 `bun` 管理依赖与运行脚本（锁文件为 `bun.lock`）。

- `bun install`：安装依赖（CI 使用 `bun install --frozen-lockfile`）
- `bun run dev`：本地开发（默认 `http://localhost:3000`）
- `bun run build` / `bun run start`：生产构建并启动
- `bun run type-check`：Next typegen + `tsc --noEmit`
- `bun run lint` / `bun run lint:fix`：ESLint 检查/自动修复 `src/**/*.{ts,tsx,js}`
- `bun run format` / `bun run format:check`：Prettier 格式化/校验

## 代码风格与命名约定

- 缩进：2 空格（见 `.editorconfig`）。
- TypeScript：开启严格模式；尽量避免 `any`（除非有明确理由）。
- 约定：App Router 文件放在 `src/app/**`；CSS Modules 使用 `*.module.css`。
- 提交前建议先跑：`bun run lint` + `bun run format:check` + `bun run type-check`。

## 测试指南

当前未配置独立测试框架（暂无 `tests/` 目录）。请将 `bun run type-check`、`bun run lint`、`bun run format:check` 视为必须通过的质量门槛（CI 亦会执行）。

## 测试数据与脱敏要求（必须遵守）

- **禁止**在测试用例、fixture、示例文档、提交信息中写入任何真实环境信息（例如：真实主机名/FQDN、域名、用户名、邮箱、IP、内网 URL、token、密码、工单号、客户标识等）。
- 测试数据请使用**约定的假数据**：
  - 域名：`example.com` / `example.net` / `example.org`
  - 邮箱/UPN：`user@example.com`
  - 主机名：`host01.example.com`
  - IP：使用 RFC5737 保留段（如 `192.0.2.10` / `198.51.100.10` / `203.0.113.10`）
- 提交前请自查：避免把“看似无害但可溯源”的真实信息带入仓库历史（必要时通过 rebase/amend 重写未推送历史）。

## 提交与 PR 规范

- Commit：采用 Conventional Commits（如 `feat: ...` / `fix: ...` / `chore: ...`），`commit-msg` 阶段会运行 commitlint。
- Pre-commit（可选）：执行 `echo 'HUSKY_ENABLED=true' > .husky/_/pre-commit.options` 启用 lint-staged。
- PR：写清楚“做了什么/为什么”，关联 Issue；涉及 UI 变更请附截图/录屏。新增环境变量时同步更新 `src/lib/env/*` 的 schema，并在文档中说明使用方式。

## Agent/自动化写作要求

- 永远使用中文回复。
- 每次输出信息前必须加称谓：以「金主大人」开头。
- 任何用户可见改动都要同步写文档：默认写入 `docs/design/*`（按主题归档），**一般情况下禁止更新 `README.md`**。
- 仅当变更影响“项目总览/快速上手/全局稳定入口”时，才允许更新 `README.md`。
