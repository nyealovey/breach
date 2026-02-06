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
- Hyper-V（WinRM / Agent）采集验收清单：[`docs/runbooks/hyperv-collector-checklist.md`](docs/runbooks/hyperv-collector-checklist.md)
- Hyper-V 采集说明：域内且要求“只开 HTTP 但必须信息加密”时，优先使用 `connection_method=agent`（Windows Agent + gMSA 在域内完成 Kerberos/Negotiate 的消息级加密）。注意：Agent 模式下 `endpoint` **仍必填**（目标 Hyper-V 主机名/IP 或 Failover Cluster 名称）；Windows Agent 的 HTTP 地址在「配置中心 → 代理」统一配置，并在 Hyper-V 来源选择 `connection_method=agent` 时通过下拉框选择（内部以 `agentId` 引用；兼容旧 `config.agent_url`）。`connection_method=winrm`（legacy）仍保留；WinRM 模式默认 `auth_method=auto` 优先 Kerberos（HTTP/5985）；Kerberos 首选 `pywinrm`（支持 AllowUnencrypted=false 的消息加密），依赖 `uv` + `kinit`；`auth_method=auto` 下 Kerberos 失败会降级到 `curl --negotiate`/legacy；`auth_method=kerberos` 不降级；`endpoint` 建议使用 hostname/FQDN（或 IP 具备 PTR 反解）以匹配 Kerberos SPN。
- PVE 采集说明：若使用「用户名/密码」凭据，PVE 的用户名需要带 realm（对应 UI 登录页下拉框），例如 `root@pam` / `admin@pve` / `user@ldap`；本系统支持在凭据里单独填写 `realm`（默认 `pam`），也支持直接在用户名中写 `@realm`。若使用自签名证书且 `tls_verify=true`，可能出现 `unable to verify the first certificate`，可导入 CA 或显式关闭 `tls_verify`（有安全风险）。
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
- UI 规范（交互 + 视觉）：[`docs/design/asset-ledger-ui-spec.md`](docs/design/asset-ledger-ui-spec.md)
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
- 未登录访问页面：默认跳转到 `/login`。

- `/`：资产统计（按类型/状态/来源/台账字段等维度统计；可一键跳转到资产清单筛选结果）
- `/login`：登录（admin/user；登录成功默认跳转 `/assets`）
- `/runs`：采集 Run 列表与详情（admin/user；支持按调度组/结果筛选；分页大小在列表底部左侧；失败可定位：错误码 + 建议动作）
- `/assets`：资产清单与详情（admin/user；canonical）
  - 清单：支持搜索（机器名/虚拟机名/宿主机名/操作系统/IP/地区/公司/部门/系统分类/系统分级/业务对接人员/管理IP）
  - 清单：支持按「虚拟化技术」筛选（vCenter / PVE / Hyper-V；命中规则：资产任一来源属于该类型即可）
  - 清单：暂不展示 Cluster（Cluster 定位为“虚拟资产”，后续再讨论如何在清单中展示）
  - 清单：电源列展示 `fields.runtime.power_state`（VM/Host；`POWERED_ON/OFF/SUSPENDED` → `运行/关机/挂起`）
  - 清单：IP 列默认过滤 `169.254.*`（APIPA/link-local），避免混入无效地址
  - 清单：录入时间列位于电源列之后
  - 快捷筛选：仅 IP 缺失 / 仅机器名缺失 / 仅机器名≠虚拟机名 / 仅最近新增（7 天）
  - 操作区：列设置（图标）、批量设置台账字段（图标）、导出台账 CSV
  - 分页：每页条数选择在列表底部左侧
  - 详情：左右等宽两列；左侧为盘点摘要（机器名/虚拟机名/操作系统/IP/CPU/内存/总分配磁盘/电源/Tools 等）+「磁盘（可选）」明细（Host 来自 `storage.datastores`；VM 来自 `hardware.disks`，展示名称/容量/类型）/台账字段/结构化字段（仅字段 ID），右侧为关系链/调试（canonical JSON）/来源明细（默认仅 NEW/CHANGED，带 tag）
  - 清单/详情：当 VM 上电且 Tools / Guest 服务未运行导致 guest 信息缺失时，机器名/操作系统/IP 会显示 `- (Tools 未运行)`（vCenter≈VMware Tools；PVE≈QEMU Guest Agent；Hyper-V≈来宾集成服务，best-effort）
- `/exports`：导出台账 CSV 任务列表与下载（admin-only；创建入口在 `/assets`；下载即失效）
- `/schedule-groups`：调度组配置（admin-only）
- `/sources`：来源配置（admin-only；清单展示绑定的凭据）
- `/credentials`：凭据管理（admin-only；清单展示用户名/账号与凭据类型）
- `/duplicate-candidates`：重复中心（admin-only）：候选列表/详情、命中原因（dup-rules-v1）、关键字段对比；VM 详情/合并页会展示宿主机（runs_on_host）；关键字段对比将“双方都缺失”标记为“缺失”；支持 Ignore（永久）与合并确认（`primary_wins`，入口：候选详情“进入 Merge” → `/duplicate-candidates/:candidateId/merge`）
- `/api/docs`：OpenAPI/Swagger（admin-only）

备注：UI 中内部 ID（如 Run ID / Source ID / Asset UUID 等）统一全量展示（不再缩略）；大量 ID 会自动换行避免挤压布局。Raw 查看使用 zstd 压缩，依赖 `@bokuweb/zstd-wasm` 的 `zstd.wasm`。若使用 Turbopack/standalone/serverless 等“产物裁剪”部署方式，需确保该 wasm 文件被包含；仓库已在 `next.config.ts` 通过 `serverExternalPackages` + `outputFileTracingIncludes` 处理。

备注：为支持 VM 快捷筛选（机器名缺失/机器名≠虚拟机名/最近新增）与搜索（宿主机名、管理IP 等），Asset 增加采集派生字段并提供回填脚本：`bun src/bin/backfill-asset-derived-fields.ts`（升级后先执行 `bun run db:migrate`，再回填历史数据）。

### 资产台账（单机自建 / PG-only）运行方式（MVP）

环境变量（服务端）：

- `DATABASE_URL`：PostgreSQL 连接串（Prisma 使用）
- `ASSET_LEDGER_DEBUG`：debug 总开关（默认关闭）。开启后：worker 会回显插件 stderr（用于排查插件启动/崩溃）。
- `ASSET_LEDGER_VCENTER_DEBUG`：vCenter 采集 debug 开关（默认关闭）。开启后：会在本地输出调试文件 `logs/vcenter-soap-debug-YYYY-MM-DD.log` / `logs/vcenter-rest-debug-YYYY-MM-DD.log`（可能包含敏感基础设施信息；`logs/` 已加入 `.gitignore`，请勿提交）。
- `ASSET_LEDGER_HYPERV_DEBUG`：Hyper-V 采集 debug 开关（默认关闭）。开启后：会在本地输出调试文件 `logs/hyperv-winrm-debug-YYYY-MM-DD.log`（可能包含敏感基础设施信息；`logs/` 已加入 `.gitignore`，请勿提交）。调试日志会记录 Kerberos 解析与 kinit（`resolved_host/resolved_addresses/realm/principal`）、以及每次 WinRM 请求的 HTTP status、Kerberos `service_name`（SPN service class）、部分响应 header 摘要（如 `server/content_type/content_length`）、以及 401 时的 `WWW-Authenticate` challenge 列表（仅记录 scheme，不记录 token）。
  - Kerberos SPN 默认使用 `WSMAN`（strict：仅尝试一次）。如环境只注册 `HTTP/<host>` 或需兼容多 SPN，可在 Hyper-V Source config 设置 `kerberos_service_name / kerberos_spn_fallback / kerberos_hostname_override`（详见 runbook）。
  - 字段说明（Hyper-V）：Host（node）会采集 `network.ip_addresses / network.management_ip / storage.datastores / runtime.power_state` 等；VM 会采集 `hardware.disks / runtime.power_state / runtime.tools_running / runtime.tools_status / network.mac_addresses`，以及（best-effort）`network.ip_addresses`。
  - VM IP 依赖来宾集成服务：仅当来宾系统可上报网络信息时（Windows Integration Services / Linux Hyper-V 集成组件），`Get-VMNetworkAdapter` 才能返回 `IPAddresses`；否则会保留空 IP 并在 Run warnings 中输出 `HYPERV_VM_IP_UNAVAILABLE`（不影响 inventory complete）。Hyper-V 的 `runtime.tools_running/tools_status` 目前映射为 KVP（Key-Value Pair Exchange）集成服务的启用/状态（best-effort）。
  - VM 磁盘/容量为 best-effort：优先 `Get-VHD` 的 `Size`（最大容量）与 `FileSize`（实际占用，聚合为 `attributes.disk_file_size_bytes_total`），并将 `VhdType` 映射为 `hardware.disks[].type`（Dynamic→thin，Fixed→thick，Differencing→thin）；pass-through 场景会尝试 `Get-Disk` 的 `Size`。若只能枚举到磁盘但取不到容量，会在 Run warnings 中输出 `HYPERV_VM_DISK_SIZE_UNAVAILABLE`；若连磁盘列表都拿不到，会输出 `HYPERV_VM_DISKS_MISSING`。
  - VM MAC 为 best-effort：来自 `Get-VMNetworkAdapter` 的 `MacAddress`；若 VM 无网卡或读取受限，会在 Run warnings 中输出 `HYPERV_VM_MAC_UNAVAILABLE`。
- `ASSET_LEDGER_PVE_DEBUG`：PVE 采集 debug 开关（默认关闭）。开启后：会在本地输出调试文件 `logs/pve-rest-debug-YYYY-MM-DD.log`（可能包含敏感基础设施信息；`logs/` 已加入 `.gitignore`，请勿提交）。调试日志会记录每次 PVE API 请求的 HTTP status/URL/耗时，以及网络/TLS/解析错误；不会记录密码、`api_token_secret` 或登录 ticket。
  - 字段说明（PVE）：Host（node）会采集 `network.ip_addresses / network.management_ip / storage.datastores / runtime.power_state` 等；VM 会采集 `hardware.disks / runtime.power_state / network.mac_addresses`，以及（best-effort）`network.ip_addresses`。
  - Host 存储口径：`storage.datastores` 会过滤远程/共享存储（例如 `shared=1`，或 `type` 属于 `nfs/cifs/iscsi/cephfs/glusterfs/rbd/pbs/...`），仅保留本地口径；因此 `attributes.datastore_total_bytes` 也仅统计过滤后的明细求和。
  - VM IP 依赖 QEMU Guest Agent：仅对 **running 的 QEMU VM** 调用 guest agent 接口；若 guest agent 未安装/未启用/未运行，会保留空 IP 并在 Run warnings 中输出 `PVE_GUEST_AGENT_UNAVAILABLE`（不影响 inventory complete）。
  - VM 机器名/OS/Tools（best-effort）：若 guest agent 可用，会尝试采集 `identity.hostname`（guest hostname）、`os.*`（操作系统信息）与 `runtime.tools_running`（映射为 QGA 可用性）；仅对 **running 的 QEMU VM** 生效。
  - 兼容 guest agent 返回形态差异：部分环境下 `network-get-interfaces` 的 `data` 可能是数组，也可能是 `{ result: [...] }` / `{ return: [...] }` 包裹（插件已兼容）。
- `ASSET_LEDGER_ADMIN_PASSWORD`：用于 bootstrap 默认管理员（用户名固定 `admin`）的密码；仅当 DB 中不存在 admin 时读取（例如首次登录时）；生产环境必须设置。
- `SECRET_KEY`：用于会话签名（生产必须固定且随机生成）。
- `JWT_SECRET_KEY`：用于 JWT 签名（仅当启用 JWT 模式；v1.0 默认不使用，可留空）。
- `BCRYPT_LOG_ROUNDS`：bcrypt 成本（默认 12；值越大越安全但越慢）。
- `PASSWORD_ENCRYPTION_KEY`：用于数据库中“Credential 凭据密文”的加/解密（生产环境必须固定；否则重启后无法解密已存储的凭据）。
- `ASSET_LEDGER_VCENTER_PLUGIN_PATH`：vCenter 采集插件可执行文件路径（子进程调用；默认 `plugins/vcenter/index.ts`）
- `ASSET_LEDGER_PVE_PLUGIN_PATH`：PVE 采集插件可执行文件路径（子进程调用；默认 `plugins/pve/index.ts`）
- `ASSET_LEDGER_HYPERV_PLUGIN_PATH`：Hyper-V 采集插件可执行文件路径（子进程调用；默认 `plugins/hyperv/index.ts`）
- `ASSET_LEDGER_ASSET_LIST_IP_PRIVATE_PREFIXES`：资产列表（`/assets`）IP 列的展示策略配置：逗号分隔的“私网 IP 前缀”列表（如 `169.,172.`）。配置后：若同一资产同时存在“私网 + 非私网”IP，将优先仅展示非私网；若全部为私网，则仍展示私网作为兜底。未配置/为空：不做过滤，保持原展示行为不变。
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
- `bun run db:bootstrap-admin`：提前创建默认管理员（只创建 `admin`，不生成其他种子数据）
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
