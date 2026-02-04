# 本地开发与测试环境启动指南

本指南用于在本仓库启动一个完整的本地“测试环境”（Web + PostgreSQL + Worker + Scheduler），用于自测与 E2E。

## 你需要准备什么

- Node.js 24（见 `.nvmrc`）
- Bun（见 `package.json#packageManager`）
- PostgreSQL（推荐用 Docker 起一个临时库）
- （可选）Docker Desktop（如果你用容器跑 Postgres）

## 1) 启动 PostgreSQL

### 方式 A：用 Docker 起一个（推荐）

```bash
docker run --name breach-pg \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=breach \
  -p 54329:5432 \
  -d postgres:18
```

常用命令：

```bash
docker ps | rg breach-pg
docker logs -f breach-pg

# 停止/删除（会丢数据）
docker stop breach-pg
docker rm breach-pg
```

### 方式 B：使用你本机已有的 Postgres

只要你能拿到一个可连的 `DATABASE_URL` 就可以（见下一节）。

## 2) 配置环境变量（`.env` / `.env.local`）

Prisma CLI（`prisma migrate dev`）默认只会从 `.env`（或 `prisma/.env`）加载环境变量，**不会自动读取** Next.js 的 `.env.local`。

因此建议：

- 在仓库根目录创建 `.env`（至少包含 `DATABASE_URL`，让 Prisma 命令能工作）
- 其他本地私密配置可以继续放在 `.env.local`（Next.js 会读取；且会覆盖 `.env` 同名变量）

如果你已经有 `.env.local`，最省事的做法是直接复制/软链一份给 Prisma：

```bash
cp .env.local .env
# 或（推荐）用软链避免重复维护：
ln -sf .env.local .env
```

推荐最小配置（用于本地完整闭环）：

```env
# 如果你按上面 Docker 命令把容器 5432 映射到本机 54329，则这里用 54329；如果你用本机 Postgres 默认端口则用 5432
DATABASE_URL="postgresql://postgres:postgres@localhost:54329/breach?schema=public"

# 首次登录（调用登录接口 / 访问 /login）时用于自动创建默认管理员（username=admin）
ASSET_LEDGER_ADMIN_PASSWORD="请设置一个你本地用的密码"

# 用于 Source 凭据加/解密（建议本地也固定设置；否则重启后可能无法解密已存的凭据）
PASSWORD_ENCRYPTION_KEY="base64url(32bytes)"

# 用于 session cookie 签名（本地可选；不设置则 session cookie 为非签名模式）
SECRET_KEY="任意随机字符串"
```

生成 `PASSWORD_ENCRYPTION_KEY`（32 bytes，base64url）：

```bash
python -c "import base64, os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())"
```

（可选）如果你需要自定义插件路径/超时：

```env
ASSET_LEDGER_VCENTER_PLUGIN_PATH="plugins/vcenter/index.ts"
ASSET_LEDGER_PLUGIN_TIMEOUT_MS="300000"
```

## 3) 初始化数据库（迁移建表）

第一次连到一份新数据库（例如新起的 Docker 容器）需要跑迁移：

```bash
bun install
bun run db:migrate
```

说明：

- `bun run db:migrate` 是幂等的：同一份库已是最新时可以重复执行，它会只应用缺失迁移。
- 如果你换了 `DATABASE_URL`、重建了容器、或新增了迁移，也需要再执行一次。
- `db:migrate` 只负责“建表/迁移”，不会插入 `admin` 用户；默认管理员会在你**首次登录**时自动 bootstrap（或手动执行 `bun run db:bootstrap-admin`）。

（可选）提前创建默认管理员（只创建 `admin`，不生成其他种子数据）：

```bash
bun run db:bootstrap-admin
```

（推荐）初始化一套开发种子数据（无真实采集时用于调试 UI / 批量编辑等）：

```bash
bun run db:seed:dev
```

说明：

- 会创建：凭据、来源、调度组、Run、资产、快照、关系、SourceRecord，并彼此关联。
- 幂等：重复执行会“只补齐缺失数据”，不会覆盖你手工改过的数据。
- 种子数据里使用的是 mock endpoint（不可真实采集）；调度组默认 disabled，避免你启动 scheduler/worker 后不断产生失败 Run。

（可选）打开 Prisma Studio 看数据：

```bash
bun run db:studio
```

## 4) 启动本地“测试网络”（Web + Worker + Scheduler）

建议开 2～3 个终端窗口分别启动：

```bash
# 终端 1：Web（Next.js）
bun run dev

# 终端 2：Worker（消费 Queued Run，子进程调用插件，入库生成资产/关系）
bun run worker

# 终端 3：Scheduler（可选：需要“按调度组定时触发 Run”时才启动）
bun run scheduler
```

然后打开：

- `http://localhost:3000`
- 使用 `.env.local` 的 `ASSET_LEDGER_ADMIN_PASSWORD` 登录（username 固定为 `admin`；首次登录会自动创建该账号）

### 插件执行注意事项

Worker 会按 `ASSET_LEDGER_VCENTER_PLUGIN_PATH` 启动子进程（默认 `plugins/vcenter/index.ts`）。

如果你看到 Run 报错 `PLUGIN_EXEC_FAILED`，优先检查：

```bash
ls -la plugins/vcenter/index.ts
chmod +x plugins/vcenter/index.ts
```

## 5) 运行 E2E（Playwright）

首次运行通常需要安装浏览器（一次性）：

```bash
bunx playwright install
```

最小运行命令（自动起 dev server）：

```bash
E2E_WEB_SERVER=1 E2E_ADMIN_PASSWORD="你的管理员密码" bun run e2e
```

（可选）真实连 vCenter 时再提供：

```env
E2E_VCENTER_ENDPOINT="https://your-vcenter.example"
E2E_VCENTER_USERNAME="..."
E2E_VCENTER_PASSWORD="..."
```

## 常见问题

### Q1：我现在还需要初始化数据库吗？

看你连接的那份库是否是“第一次用/空库”：

- 如果你新起了 pg 容器、换了库、换了 `DATABASE_URL`：需要跑 `bun run db:migrate`
- 如果同一份库之前已经跑过迁移且期间没有新增迁移：不需要重复初始化（但重复跑 `bun run db:migrate` 也没问题）

### Q2：我之前起的 pgsql 容器是干嘛的？

它就是本项目的本地数据库。系统的用户/会话、配置、Run 队列、资产/关系、raw 压缩数据、审计事件等都会写入 Postgres。
