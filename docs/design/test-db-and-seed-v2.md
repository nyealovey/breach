# 测试库初始化与 Seed v2 设计说明

版本：v1.0  
日期：2026-02-06

## 1. 背景与目标

当前项目已有 `db:seed:dev`，但历史种子数据与现行模型（`SourceRole`、`AssetSignalLink`、`MergeAudit`、`AssetHistoryEvent` 等）覆盖不完整。  
本次设计目标：

- 提供可重复、可回滚的本地测试库初始化流程（Docker + Postgres）。
- 提供“显式 reset + seed”流程，确保数据口径可预期。
- 将种子数据升级为“功能覆盖优先”，用于联调 API/UI 关键路径。

## 2. 本地数据库编排（仅 PostgreSQL）

新增 `docker-compose.local-db.yml`，固定本地端口 `54329`，默认数据库 `breach`。  
为兼容 PostgreSQL 18+ 升级建议，卷挂载路径使用 `/var/lib/postgresql`（而非旧的 `/var/lib/postgresql/data`）。

推荐命令：

```bash
bun run db:up
bun run db:logs
bun run db:down
bun run db:down:volumes
```

## 3. 初始化工作流

### 3.1 标准流程（推荐）

```bash
bun run db:up
bun run db:reset:seed
```

### 3.2 一键流程

```bash
bun run db:setup:docker
```

### 3.3 仅重建数据库（不 seed）

```bash
bun run db:reset
```

## 4. Seed v2 覆盖矩阵

| 功能域     | 对应模型/对象                                                | 覆盖点                                                                             |
| ---------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 来源配置   | `Source` / `Credential` / `ScheduleGroup` / `Agent`          | inventory + signal 两类来源，含 Hyper-V Agent 绑定                                 |
| 运行记录   | `Run`                                                        | `Succeeded`、`Failed`、`detect` 等模式与状态                                       |
| 资产主数据 | `Asset`                                                      | `vm/host/cluster`、`in_service/offline/merged`、覆盖字段与采集派生字段             |
| 台账字段   | `AssetLedgerFields`                                          | source 与 override 同时覆盖（含 host 专属字段）                                    |
| 关系图谱   | `Relation` / `RelationRecord`                                | `runs_on`、`member_of`，含 `active/inactive`                                       |
| 采集溯源   | `AssetSourceLink` / `SourceRecord` / `AssetRunSnapshot`      | raw + normalized + canonical 全链路                                                |
| 监控信号   | `AssetSignalLink` / `SignalRecord` / `AssetOperationalState` | matched / ambiguous / unmatched 三类场景                                           |
| 去重治理   | `DuplicateCandidate` / `DuplicateCandidateJob`               | `open` / `ignored` / `merged` 三态                                                 |
| 合并审计   | `MergeAudit`                                                 | 合并策略与摘要数据                                                                 |
| 资产历史   | `AssetHistoryEvent`                                          | `collect.changed`、`ledger_fields.changed`、`asset.status_changed`、`asset.merged` |
| 导出任务   | `AssetLedgerExport`                                          | `Succeeded` 与 `Failed` 两类任务样本                                               |

## 5. 安全护栏

`db:reset` 与 `db:seed:dev` 增加本地库保护：

- 默认仅允许 `DATABASE_URL` 主机为 `localhost` / `127.0.0.1` / `::1` / `host.docker.internal`。
- 若确需对非本地库执行，必须显式设置：

```bash
ALLOW_NON_LOCAL_DB_SEED=true
```

## 6. 测试数据约束

- 全部使用脱敏与约定假数据：`example.com/.net/.org`、`user@example.com`。
- IP 使用 RFC5737 段：`192.0.2.0/24`、`198.51.100.0/24`、`203.0.113.0/24`。
- 不写入真实域名、真实主机名、真实账号或真实凭据。
