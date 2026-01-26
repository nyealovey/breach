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

## 提交与 PR 规范

- Commit：采用 Conventional Commits（如 `feat: ...` / `fix: ...` / `chore: ...`），`commit-msg` 阶段会运行 commitlint。
- Pre-commit（可选）：执行 `echo 'HUSKY_ENABLED=true' > .husky/_/pre-commit.options` 启用 lint-staged。
- PR：写清楚“做了什么/为什么”，关联 Issue；涉及 UI 变更请附截图/录屏。新增环境变量时同步更新 `src/lib/env/*` 的 schema，并在文档中说明使用方式。

## Agent/自动化写作要求

- 永远使用中文回复。
- 每次输出信息前必须加称谓：以「金主大人」开头。
- 任何用户可见改动都要同步写文档：优先更新 `README.md`，必要时补充到仓库内的说明文档（例如新增配置、运行方式或变更原因）。
