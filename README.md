<p align="center">
  <img src="https://user-images.githubusercontent.com/26466516/141659551-d7ba5630-7200-46fe-863b-87818dae970a.png" alt="Next.js TypeScript Starter">
</p>

<br />

<div align="center"><strong>Non-opinionated TypeScript starter for Next.js</strong></div>
<div align="center">Highly scalable foundation with the best DX. All the tools you need to build your Next project.</div>

<br />

<div align="center">
  <img src="https://img.shields.io/static/v1?label=PRs&message=welcome&style=flat-square&color=5e17eb&labelColor=000000" alt="PRs welcome!" />

  <img alt="License" src="https://img.shields.io/github/license/jpedroschmitz/typescript-nextjs-starter?style=flat-square&color=5e17eb&labelColor=000000">

  <a href="https://x.com/intent/follow?screen_name=jpedroschmitz">
    <img src="https://img.shields.io/twitter/follow/jpedroschmitz?style=flat-square&color=5e17eb&labelColor=000000" alt="Follow @jpedroschmitz" />
  </a>
</div>

<div align="center">
  <sub>Created by <a href="https://x.com/jpedroschmitz">João Pedro</a> with the help of many <a href="https://github.com/jpedroschmitz/typescript-nextjs-starter/graphs/contributors">wonderful contributors</a>.</sub>
</div>

<br />

## Features

- ⚡️ Next.js 16 (App Router)
- ⚛️ React 19
- ⛑ TypeScript
- 📏 ESLint 9 — To find and fix problems in your code
- 💖 Prettier — Code Formatter for consistent style
- 🐶 Husky — For running scripts before committing
- 🚓 Commitlint — To make sure your commit messages follow the convention
- 🖌 Renovate — To keep your dependencies up to date
- 🚫 lint-staged — Run ESLint and Prettier against staged Git files
- 👷 PR Workflow — Run Type Check & Linters on Pull Requests
- ⚙️ EditorConfig - Consistent coding styles across editors and IDEs
- 🗂 Path Mapping — Import components or images using the `@` prefix
- 🔐 CSP — Content Security Policy for enhanced security (default minimal policy)
- 🧳 T3 Env — Type-safe environment variables
- 🪧 Redirects — Easily add redirects to your application

## Quick Start

The best way to start with this template is using [Create Next App](https://nextjs.org/docs/api-reference/create-next-app).

```
# bun
bunx create next-app -e https://github.com/jpedroschmitz/typescript-nextjs-starter
# pnpm
pnpm create next-app -e https://github.com/jpedroschmitz/typescript-nextjs-starter
# yarn
yarn create next-app -e https://github.com/jpedroschmitz/typescript-nextjs-starter
# npm
npx create-next-app -e https://github.com/jpedroschmitz/typescript-nextjs-starter
```

### Development

To start the project locally, run:

```bash
bun run dev
```

Open `http://localhost:3000` with your browser to see the result.

## Testimonials

> [**“This starter is by far the best TypeScript starter for Next.js. Feature packed but un-opinionated at the same time!”**](https://github.com/jpedroschmitz/typescript-nextjs-starter/issues/87#issue-789642190)<br>
> — Arafat Zahan

> [**“I can really recommend the Next.js Typescript Starter repo as a solid foundation for your future Next.js projects.”**](https://corfitz.medium.com/create-a-custom-create-next-project-command-2a6b35a1c8e6)<br>
> — Corfitz

> [**“Brilliant work!”**](https://github.com/jpedroschmitz/typescript-nextjs-starter/issues/87#issuecomment-769314539)<br>
> — Soham Dasgupta

## Showcase

List of websites that started off with Next.js TypeScript Starter:

- [FreeInvoice.dev](https://freeinvoice.dev)
- [Notion Avatar Maker](https://github.com/Mayandev/notion-avatar)
- [IKEA Low Price](https://github.com/Mayandev/ikea-low-price)
- [hygraph.com](https://hygraph.com)
- [rocketseat.com.br](https://www.rocketseat.com.br)
- [vagaschapeco.com](https://vagaschapeco.com)
- [unfork.vercel.app](https://unfork.vercel.app)
- [Add yours](https://github.com/jpedroschmitz/typescript-nextjs-starter/edit/main/README.md)

## Documentation

### 资产台账系统文档

文档总览（推荐先读；需求口径以 SRS 为准）：[`docs/index.md`](docs/index.md)

配置顺序（vCenter MVP）：

1. 新建凭据（Credentials，可选；来源若启用但未绑定凭据，会提示无法参与运行/调度）
2. 新建来源（Sources；创建/编辑来源时不需要选择调度组）
3. 新建调度组（Schedule Groups；创建调度组时必须选择 1+ 个来源，且为多选；调度组成员调整在调度组编辑页完成）

运行指南：

- 本地开发与测试环境启动指南：[`docs/runbooks/local-dev.md`](docs/runbooks/local-dev.md)
- 兼容性说明：vCenter 6.5~8 通过 Source 中的“vCenter 版本范围（首选）”选择不同采集 Driver；若所选版本范围与目标环境不兼容（关键能力缺失/关键接口不存在），UI 将默认阻止运行并提示调整版本范围或升级 vCenter（即使绕过 UI，采集也会直接失败）；不再使用降级方式伪成功。

需求文档：

- 需求规格说明书（SRS，需求口径/验收依据）：[`docs/requirements/asset-ledger-srs.md`](docs/requirements/asset-ledger-srs.md)
- PRD（vCenter MVP v1.0，历史范围说明）：[`docs/prds/asset-ledger-v1.0-prd.md`](docs/prds/asset-ledger-v1.0-prd.md)
- PRD（vCenter MVP 增量：凭据模块 + 调度组手动运行 v1.0）：[`docs/prds/asset-ledger-vcenter-mvp-credentials-sg-manual-run-v1.0-prd.md`](docs/prds/asset-ledger-vcenter-mvp-credentials-sg-manual-run-v1.0-prd.md)
- PRD（vCenter 插件：多版本 Driver + 关系/规格/电源状态 v1.1）：[`docs/prds/asset-ledger-vcenter-plugin-versioned-drivers-v1.1-prd.md`](docs/prds/asset-ledger-vcenter-plugin-versioned-drivers-v1.1-prd.md)
- PRD（资产列表盘点列展示 v1.0）：[`docs/prds/asset-ledger-asset-list-inventory-columns-v1.0-prd.md`](docs/prds/asset-ledger-asset-list-inventory-columns-v1.0-prd.md)
- PRD（Host 字段模型 v1.0，历史范围说明）：[`docs/prds/asset-ledger-host-field-model-v1.0-prd.md`](docs/prds/asset-ledger-host-field-model-v1.0-prd.md)
- v1.0 需求追溯矩阵（Traceability）：[`docs/requirements/asset-ledger-v1.0-traceability.md`](docs/requirements/asset-ledger-v1.0-traceability.md)
- vCenter MVP v1.0（含增量：凭据模块 + 调度组手动运行）实施计划：[`docs/plans/2026-01-28-asset-ledger-vcenter-mvp.md`](docs/plans/2026-01-28-asset-ledger-vcenter-mvp.md)
- vCenter MVP v1.0（含增量：凭据模块 + 调度组手动运行）实施进度（执行记录）：[`docs/plans/2026-01-28-asset-ledger-vcenter-mvp.progress.md`](docs/plans/2026-01-28-asset-ledger-vcenter-mvp.progress.md)

设计文档：

- 技术设计（vCenter MVP v1.0）：[`docs/design/asset-ledger-vcenter-mvp-design.md`](docs/design/asset-ledger-vcenter-mvp-design.md)
- 日志规范（宽事件 / 采集域事件）：[`docs/design/asset-ledger-logging-spec.md`](docs/design/asset-ledger-logging-spec.md)
- 错误码规范（Error Codes）：[`docs/design/asset-ledger-error-codes.md`](docs/design/asset-ledger-error-codes.md)
- 疑似重复规则（dup-rules-v1）：[`docs/design/asset-ledger-dup-rules-v1.md`](docs/design/asset-ledger-dup-rules-v1.md)
- 概念数据模型（Conceptual Data Model）：[`docs/design/asset-ledger-data-model.md`](docs/design/asset-ledger-data-model.md)
- 采集插件参考（开源组件优先）：[`docs/design/asset-ledger-collector-reference.md`](docs/design/asset-ledger-collector-reference.md)
- normalized/canonical JSON Schema：[`docs/design/asset-ledger-json-schema.md`](docs/design/asset-ledger-json-schema.md)
- 旧字段映射（导入/对齐）：[`docs/design/asset-ledger-legacy-field-mapping.md`](docs/design/asset-ledger-legacy-field-mapping.md)

### MVP UI 页面（持续完善）

- `/login`：管理员登录
- `/schedule-groups`：调度组配置
- `/sources`：来源配置（绑定凭据）
- `/credentials`：凭据管理（创建/编辑/删除；不回显 secret）
- `/runs`：采集 Run 列表与详情
- `/assets`：资产统一视图（canonical）+ 来源明细（normalized）+ 关系（outgoing）+ raw 查看（admin-only，脱敏+审计）；资产列表默认展示：机器名（支持覆盖显示）/虚拟机名/宿主机名/操作系统/IP/CPU/内存/总分配磁盘/状态（VM 是否运行）（不展示 Last Seen/来源）
- `/api/docs`：OpenAPI/Swagger（admin-only）

### 资产台账（单机自建 / PG-only）运行方式（MVP）

环境变量（服务端）：

- `DATABASE_URL`：PostgreSQL 连接串（Prisma 使用）
- `ASSET_LEDGER_ADMIN_PASSWORD`：首次启动用于初始化默认管理员（用户名固定 `admin`）的密码；仅当 DB 中不存在 admin 时读取；生产环境必须设置。
- `SECRET_KEY`：用于会话签名（生产必须固定且随机生成）。
- `JWT_SECRET_KEY`：用于 JWT 签名（仅当启用 JWT 模式；v1.0 默认不使用，可留空）。
- `BCRYPT_LOG_ROUNDS`：bcrypt 成本（默认 12；值越大越安全但越慢）。
- `PASSWORD_ENCRYPTION_KEY`：用于数据库中“Credential 凭据密文”的加/解密（生产环境必须固定；否则重启后无法解密已存储的凭据）。
- `ASSET_LEDGER_VCENTER_PLUGIN_PATH`：vCenter 采集插件可执行文件路径（子进程调用；默认 `plugins/vcenter/index.ts`）
- `ASSET_LEDGER_SCHEDULER_TICK_MS`：调度器 tick 间隔（默认 30000）
- `ASSET_LEDGER_WORKER_POLL_MS`：worker 空转轮询间隔（默认 2000）
- `ASSET_LEDGER_WORKER_BATCH_SIZE`：worker 每次领取 run 数量（默认 1）
- `ASSET_LEDGER_PLUGIN_TIMEOUT_MS`：插件执行超时（默认 300000）

生成示例：

```bash
# SECRET_KEY / JWT_SECRET_KEY（会话/JWT 签名）
python -c "import secrets; print(secrets.token_urlsafe(32))"

# PASSWORD_ENCRYPTION_KEY（32 bytes key，base64url）
python -c "import base64, os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())"
```

命令：

- `bun run db:generate`：生成 Prisma Client
- `bun run db:migrate`：本地创建/更新数据库表（开发环境）
- `bun run scheduler`：启动调度器（按“调度组固定时间”创建 Run；错过触发点不补跑）
- `bun run worker`：启动 worker（消费 Queued Run，子进程调用插件）

### Requirements

- Node.js >= 24
- Bun >= 1.3

### Directory Structure

- [`.github`](.github) — GitHub configuration including the CI workflow.<br>
- [`.husky`](.husky) — Husky configuration and hooks.<br>
- [`public`](./public) — Static assets such as robots.txt, images, and favicon.<br>
- [`src`](./src) — Application source code, including pages, components, styles.

### Scripts

- `bun run dev` — Starts the application in development mode at `http://localhost:3000`.
- `bun run build` — Creates an optimized production build of your application.
- `bun run start` — Starts the application in production mode.
- `bun run type-check` — Validate code using TypeScript compiler.
- `bun run lint` — Runs ESLint for all files in the `src` directory.
- `bun run lint:fix` — Runs ESLint fix for all files in the `src` directory.
- `bun run format` — Runs Prettier for all files in the `src` directory.
- `bun run format:check` — Check Prettier list of files that need to be formatted.
- `bun run format:ci` — Prettier check for CI.
- `bun run e2e` — Runs Playwright E2E tests (requires `E2E_ADMIN_PASSWORD`; can set `E2E_WEB_SERVER=1` to auto-start dev server).

### Path Mapping

TypeScript are pre-configured with custom path mappings. To import components or files, use the `@` prefix.

```tsx
import { Button } from '@/components/Button';
// To import images or other files from the public folder
import avatar from '@/public/avatar.png';
```

### Switch to pnpm/Yarn/npm

This starter uses Bun by default, but this choice is yours. If you'd like to switch to pnpm/Yarn/npm, delete `bun.lock`, install dependencies with your preferred package manager, and update the CI workflow and Husky Git hooks to match.

> **Note:** If you use Yarn, make sure to follow these steps from the [Husky documentation](https://typicode.github.io/husky/troubleshoot.html#yarn-on-windows) so that Git hooks do not fail with Yarn on Windows.

### Environment Variables

We use [T3 Env](https://env.t3.gg/) to manage environment variables. Create a `.env.local` file in the root of the project and add your environment variables there.

When adding additional environment variables, the schema in `./src/lib/env/client.ts` or `./src/lib/env/server.ts` should be updated accordingly.

### Redirects

To add redirects, update the `redirects` array in `./redirects.ts`. It's typed, so you'll get autocompletion for the properties.

### CSP (Content Security Policy)

The Content Security Policy (CSP) is a security layer that helps to detect and mitigate certain types of attacks, including Cross-Site Scripting (XSS) and data injection attacks. The CSP is implemented in the `next.config.ts` file.

It contains a default and minimal policy that you can customize to fit your application needs. It's a foundation to build upon.

### Husky

Husky is a tool that helps us run scrips before Git events. We have 3 hooks:

- `pre-commit` — (Disabled by default) Runs lint-staged to lint and format the files.
- `commit-msg` — Runs commitlint to check if the commit message follows the conventional commit message format.
- `post-merge` — Runs `bun install` to update dependencies if there was a change in the `bun.lock` file.

> Important note: Husky is disabled by default in the pre-commit hook. This is intention because most developers don't want to run lint-staged on every commit. If you want to enable it, run `echo 'HUSKY_ENABLED=true' > .husky/_/pre-commit.options`.

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for more information.
