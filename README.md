# 资产台账系统（Breach）

一个用于统一采集与管理虚拟化资产的系统，当前覆盖 vCenter、PVE、Hyper-V 等来源，支持来源管理、调度运行、资产清单与数据导出。

## 30 秒上手

```bash
bun install
# 创建并编辑 .env（至少包含 DATABASE_URL、ASSET_LEDGER_ADMIN_PASSWORD、PASSWORD_ENCRYPTION_KEY）
bun run db:migrate
bun run dev
```

- 打开 `http://localhost:3000`
- 完整配置示例见：`docs/runbooks/local-dev.md`

## 项目概览

- Web 控制台：资产、来源、调度组、运行记录、凭据等管理页面
- 资产编辑交互：列表页仅保留“编辑/查看”；SolarWinds 同步统一在“编辑资产字段”弹窗内手动触发，且支持“清空覆盖值”（需点击保存后生效）
- API 能力：基于 OpenAPI 的接口与在线文档
- 采集链路：Scheduler 触发任务，Worker 调用插件执行采集并入库
- 数据底座：PostgreSQL + Prisma
- 工程质量：TypeScript 严格模式、Lint/Format/Type Check、E2E 测试

## UI 说明（资产列表）

- 「监控」列：用图标 + 颜色展示 SolarWinds 监控覆盖与状态；悬停可查看原始状态/更新时间。
- 「机器名 / 操作系统 / IP」列左侧边框：灰=未覆盖，红=覆盖≠采集，蓝=覆盖空值（采集为空时的覆盖），绿=覆盖值=采集值。

## 技术栈

- 前端：Next.js 16（App Router）、React 19、TypeScript、Tailwind CSS、Radix UI
- 后端：Next.js Route Handlers、Prisma、Zod
- 数据库：PostgreSQL
- 任务执行：`src/bin/scheduler.ts`、`src/bin/worker.ts`、`plugins/*`
- 工具链：Bun、ESLint、Prettier、Husky、Commitlint、Playwright、Vitest

## 目录结构（简版）

- `src/app/`：页面与 API 路由
- `src/lib/`：核心业务逻辑与基础能力
- `src/bin/`：命令行入口（worker、scheduler、seed 等）
- `plugins/`：采集插件（vCenter / PVE / Hyper-V）
- `prisma/`：Schema 与迁移
- `docs/`：需求、设计与运行手册

## 首次完整启动（补充）

- `30 秒上手` 已覆盖最小可运行路径；本节仅补充完整链路所需信息
- 环境要求：Node.js 24（见 `.nvmrc`）、Bun 1.3+、PostgreSQL
- `.env` 建议至少包含：`DATABASE_URL`、`ASSET_LEDGER_ADMIN_PASSWORD`、`PASSWORD_ENCRYPTION_KEY`、`SECRET_KEY`
- 可选初始化测试数据：`bun run db:seed:dev`
- 需要完整采集链路时，额外启动：

```bash
bun run worker
bun run scheduler
```

## 常用命令

```bash
# 开发/构建
bun run dev
bun run build
bun run start

# 质量检查
bun run type-check
bun run lint
bun run format:check

# 数据库
bun run db:migrate
bun run db:seed:dev
bun run db:studio

# 测试
bun run test
bun run e2e
```

## 文档导航

- 文档总览：`docs/index.md`
- 需求基线（SRS）：`docs/requirements/asset-ledger-srs.md`
- 本地开发指南：`docs/runbooks/local-dev.md`
- API 规范：`docs/design/asset-ledger-api-spec.md`

## 贡献约定

- 提交信息遵循 Conventional Commits
- 提交前建议执行：

```bash
bun run lint
bun run format:check
bun run type-check
```

## License

MIT（见 `LICENSE.md`）
