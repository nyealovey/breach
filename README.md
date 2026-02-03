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
- Hyper-V（WinRM）采集验收清单：[`docs/runbooks/hyperv-collector-checklist.md`](docs/runbooks/hyperv-collector-checklist.md)
- Hyper-V（WinRM）认证说明：默认 `auth_method=auto` 优先 Kerberos（不要求改服务器默认 WinRM 配置）；采集侧依赖 `kinit` + 支持 `--negotiate` 的 `curl`；`endpoint` 建议使用 hostname/FQDN（或 IP 具备 PTR 反解）以匹配 Kerberos SPN；WinRM 默认常见为 `http/5985`。
- 调度组页面的「运行」按钮支持选择 `mode=healthcheck|detect|collect`：排障优先 `healthcheck/detect`，确认无误后再 `collect`。
- 兼容性说明：vCenter 6.5~8 通过 Source 中的“vCenter 版本范围（首选）”选择不同采集 Driver；若所选版本范围与目标环境不兼容（关键能力缺失/关键接口不存在），UI 将默认阻止运行并提示调整版本范围或升级 vCenter（即使绕过 UI，采集也会直接失败）；不再使用降级方式伪成功。
- 认证/Session：优先调用 `POST /api/session` 获取 session token；若返回 JSON-RPC 错误或该接口不存在，则自动 fallback 到 `POST /rest/com/vmware/cis/session`（常见于 6.5/6.7 环境）。vCenter REST 资源接口优先使用 `/api/vcenter/*`；若遇到 404/405（接口不存在或 GET 不支持）则自动 fallback 到 `/rest/vcenter/*`；VM 按 Host 过滤（`listVMsByHost`）在部分 6.5/6.7 环境会自动从 `hosts=` fallback 到 `filter.hosts=`。
- Host（ESXi）关键盘点字段（ESXi 版本/构建号、CPU/内存、本地盘总量、datastore 总容量（排除 NFS/NFS41/vSAN）、整机序列号、硬件厂商/型号、管理 IP）通过 vSphere SOAP（`/sdk` + vim25）采集，并由 `collect_hosts` 模式写入；优先使用 `RetrievePropertiesEx`，若目标不支持会自动降级到 `RetrieveProperties`；若 SOAP 返回 `InvalidPropertyFault`（旧版本字段缺失），会自动剔除该字段并重试（可连续剔除多个）；管理 IP 优先取 `vmk0`/`vswif0`（或 portgroup 含 `Management`）的 IPv4；本地盘总量口径为 `config.storageDevice.scsiLun` 中 `lunType="disk"` 且有 `capacity` 的设备容量求和 + `config.storageDevice.nvmeTopology`（`HostNvmeNamespace.blockSize * capacityInBlocks`）求和（若目标不支持 `nvmeTopology` 将自动忽略）；datastore 总容量口径为 Host 的 `datastore` 列表对应 Datastore `summary.capacity` 求和（过滤 `summary.type in {NFS,NFS41,vsan}`）；`os.fingerprint` 用于承接 build（落库但不用于列表搜索/展示）。
- 手动触发 Source Run 支持 `mode=detect`（探测模式），用于写入 `detectResult`（driver/target_version/capabilities 等元信息）。
- vCenter Source 的调度/采集会拆成两条独立 Run：`collect_hosts`（仅 Host/Cluster + SOAP 详情）与 `collect_vms`（仅 VM + VM↔Host 关系）；两条 Run 独立执行/独立落库，任一失败不影响另一条。

需求文档：

- 需求规格说明书（SRS，需求口径/验收依据）：[`docs/requirements/asset-ledger-srs.md`](docs/requirements/asset-ledger-srs.md)
- MVP 归档入口（当前仓库实现对应的文档快照）：[`docs/mvp/index.md`](docs/mvp/index.md)
- PRD（vCenter MVP v1.0，历史范围说明）：[`docs/mvp/prds/asset-ledger-v1.0-prd.md`](docs/mvp/prds/asset-ledger-v1.0-prd.md)
- PRD（vCenter MVP 增量：凭据模块 + 调度组手动运行 v1.0）：[`docs/mvp/prds/asset-ledger-vcenter-mvp-credentials-sg-manual-run-v1.0-prd.md`](docs/mvp/prds/asset-ledger-vcenter-mvp-credentials-sg-manual-run-v1.0-prd.md)
- PRD（vCenter 插件：多版本 Driver + 关系/规格/电源状态 v1.1）：[`docs/mvp/prds/asset-ledger-vcenter-plugin-versioned-drivers-v1.1-prd.md`](docs/mvp/prds/asset-ledger-vcenter-plugin-versioned-drivers-v1.1-prd.md)
- PRD（vCenter Host（ESXi）版本/规格/型号/IP（SOAP）v1.3）：[`docs/mvp/prds/asset-ledger-vcenter-host-esxi-version-v1.2-prd.md`](docs/mvp/prds/asset-ledger-vcenter-host-esxi-version-v1.2-prd.md)
- PRD（资产列表盘点列展示 v1.0）：[`docs/mvp/prds/asset-ledger-asset-list-inventory-columns-v1.0-prd.md`](docs/mvp/prds/asset-ledger-asset-list-inventory-columns-v1.0-prd.md)
- PRD（Host 字段模型 v1.0，历史范围说明）：[`docs/mvp/prds/asset-ledger-host-field-model-v1.0-prd.md`](docs/mvp/prds/asset-ledger-host-field-model-v1.0-prd.md)
- v1.0 需求追溯矩阵（Traceability）：[`docs/mvp/requirements/asset-ledger-v1.0-traceability.md`](docs/mvp/requirements/asset-ledger-v1.0-traceability.md)
- vCenter MVP v1.0（含增量：凭据模块 + 调度组手动运行）实施计划：[`docs/mvp/plans/2026-01-28-asset-ledger-vcenter-mvp.md`](docs/mvp/plans/2026-01-28-asset-ledger-vcenter-mvp.md)
- vCenter MVP v1.0（含增量：凭据模块 + 调度组手动运行）实施进度（执行记录）：[`docs/mvp/plans/2026-01-28-asset-ledger-vcenter-mvp.progress.md`](docs/mvp/plans/2026-01-28-asset-ledger-vcenter-mvp.progress.md)
- 后续里程碑规划（草案）：[`docs/roadmap.md`](docs/roadmap.md)
- 后续 PRD 列表（Post-MVP）：[`docs/prds/README.md`](docs/prds/README.md)

设计文档：

- 技术设计（vCenter MVP v1.0）：[`docs/mvp/design/asset-ledger-vcenter-mvp-design.md`](docs/mvp/design/asset-ledger-vcenter-mvp-design.md)
- 日志规范（宽事件 / 采集域事件）：[`docs/design/asset-ledger-logging-spec.md`](docs/design/asset-ledger-logging-spec.md)
- 错误码规范（Error Codes）：[`docs/design/asset-ledger-error-codes.md`](docs/design/asset-ledger-error-codes.md)
- 疑似重复规则（dup-rules-v1）：[`docs/design/asset-ledger-dup-rules-v1.md`](docs/design/asset-ledger-dup-rules-v1.md)
- 概念数据模型（Conceptual Data Model）：[`docs/design/asset-ledger-data-model.md`](docs/design/asset-ledger-data-model.md)
- 采集插件参考（开源组件优先）：[`docs/design/asset-ledger-collector-reference.md`](docs/design/asset-ledger-collector-reference.md)
- normalized/canonical JSON Schema：[`docs/design/asset-ledger-json-schema.md`](docs/design/asset-ledger-json-schema.md)
- 旧字段映射（导入/对齐）：[`docs/design/asset-ledger-legacy-field-mapping.md`](docs/design/asset-ledger-legacy-field-mapping.md)

### MVP UI 页面（持续完善）

角色与权限（v1）：

- admin：可管理调度组/来源/凭据、触发采集、重复中心/合并、写台账字段、导出 CSV、查看 raw（脱敏+审计）。
- user：仅可只读访问资产与 Runs（含资产历史时间线）；无入口且服务端 403 禁止访问以上敏感能力。

页面入口：

- 导航：顶部主导航（一级）；「配置中心」为一级菜单，二级菜单包含「来源」「凭据」。

- `/login`：登录（admin/user；登录成功默认跳转 `/assets`）
- `/runs`：采集 Run 列表与详情（admin/user；失败可定位：错误码 + 建议动作；结构化 errors/warnings；脱敏上下文白名单）
- `/assets`：资产统一视图（canonical）+ 来源明细（normalized）+ 关系（outgoing）（admin/user）；raw 查看仅 admin（脱敏+审计）；资产详情包含“历史/时间线”（M12）；支持筛选：操作系统、地区、业务对接人员、公司、部门、系统分类、系统分级（下拉候选来自 `GET /api/v1/assets/ledger-fields/options`）；资产列表新增“录入时间”（默认显示首次采集时间）；列设置支持两列展示避免高度溢出，且“机器名/IP”为核心列固定显示；资产详情的来源记录查看（normalized/raw）为页面跳转：`/source-records/:recordId?tab=normalized|raw`（避免模态框），并按资产类型隐藏不相关字段
- `/exports`：资产台账导出 CSV（admin-only；异步任务；下载即失效）
- `/schedule-groups`：调度组配置（admin-only）
- `/sources`：来源配置（admin-only）
- `/credentials`：凭据管理（admin-only）
- `/duplicate-candidates`：重复中心（admin-only）：候选列表/详情、命中原因（dup-rules-v1）、关键字段对比；VM 详情/合并页会展示宿主机（runs_on_host）；关键字段对比将“双方都缺失”标记为“缺失”；支持 Ignore（永久）与合并确认（`primary_wins`，入口：候选详情“进入 Merge” → `/duplicate-candidates/:candidateId/merge`）
- `/api/docs`：OpenAPI/Swagger（admin-only）

备注：Raw 查看使用 zstd 压缩，依赖 `@bokuweb/zstd-wasm` 的 `zstd.wasm`。若使用 Turbopack/standalone/serverless 等“产物裁剪”部署方式，需确保该 wasm 文件被包含；仓库已在 `next.config.ts` 通过 `serverExternalPackages` + `outputFileTracingIncludes` 处理。

### 资产台账（单机自建 / PG-only）运行方式（MVP）

环境变量（服务端）：

- `DATABASE_URL`：PostgreSQL 连接串（Prisma 使用）
- `ASSET_LEDGER_DEBUG`：debug 总开关（默认关闭）。开启后：worker 会回显插件 stderr（用于排查插件启动/崩溃）。
- `ASSET_LEDGER_VCENTER_DEBUG`：vCenter 采集 debug 开关（默认关闭）。开启后：会在本地输出调试文件 `logs/vcenter-soap-debug-YYYY-MM-DD.log` / `logs/vcenter-rest-debug-YYYY-MM-DD.log`（可能包含敏感基础设施信息；`logs/` 已加入 `.gitignore`，请勿提交）。
- `ASSET_LEDGER_HYPERV_DEBUG`：Hyper-V 采集 debug 开关（默认关闭）。开启后：会在本地输出调试文件 `logs/hyperv-winrm-debug-YYYY-MM-DD.log`（可能包含敏感基础设施信息；`logs/` 已加入 `.gitignore`，请勿提交）。调试日志会记录 Kerberos 解析与 kinit（`resolved_host/resolved_addresses/realm/principal`）、以及每次 WinRM 请求的 HTTP status、Kerberos `service_name`（SPN service class）、部分响应 header 摘要（如 `server/content_type/content_length`）、以及 401 时的 `WWW-Authenticate` challenge 列表（仅记录 scheme，不记录 token）。
- `ASSET_LEDGER_ADMIN_PASSWORD`：首次启动用于初始化默认管理员（用户名固定 `admin`）的密码；仅当 DB 中不存在 admin 时读取；生产环境必须设置。
- `SECRET_KEY`：用于会话签名（生产必须固定且随机生成）。
- `JWT_SECRET_KEY`：用于 JWT 签名（仅当启用 JWT 模式；v1.0 默认不使用，可留空）。
- `BCRYPT_LOG_ROUNDS`：bcrypt 成本（默认 12；值越大越安全但越慢）。
- `PASSWORD_ENCRYPTION_KEY`：用于数据库中“Credential 凭据密文”的加/解密（生产环境必须固定；否则重启后无法解密已存储的凭据）。
- `ASSET_LEDGER_VCENTER_PLUGIN_PATH`：vCenter 采集插件可执行文件路径（子进程调用；默认 `plugins/vcenter/index.ts`）
- `ASSET_LEDGER_PVE_PLUGIN_PATH`：PVE 采集插件可执行文件路径（子进程调用；默认 `plugins/pve/index.ts`）
- `ASSET_LEDGER_HYPERV_PLUGIN_PATH`：Hyper-V 采集插件可执行文件路径（子进程调用；默认 `plugins/hyperv/index.ts`）
- `ASSET_LEDGER_SCHEDULER_TICK_MS`：调度器 tick 间隔（默认 30000）
- `ASSET_LEDGER_WORKER_POLL_MS`：worker 空转轮询间隔（默认 2000）
- `ASSET_LEDGER_WORKER_BATCH_SIZE`：worker 每次领取 run 数量（默认 1）
- `ASSET_LEDGER_PLUGIN_TIMEOUT_MS`：插件执行超时（默认 300000）
- `ASSET_LEDGER_RUN_RECYCLE_AFTER_MS`：自动回收卡死的 Running Run（默认 900000；超过该时长仍未结束会被标记为 Failed，避免阻塞后续调度/手工触发）。

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
- `bun run db:seed:dev`：生成一套本地开发用的“模拟数据”（凭据/来源/调度组/Run/资产/快照/关系/SourceRecord；幂等，不覆盖你手工改过的数据）
- `bun run db:setup`：一键初始化（`db:migrate` + `db:seed:dev`）
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
