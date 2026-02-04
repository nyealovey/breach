# Hyper-V Windows Agent（B 方案）

该 Agent 用于在 **入域 Windows** 上以 **gMSA**（推荐）运行 PowerShell 采集 Hyper-V/Failover Cluster 信息，并通过 HTTP API 返回 raw JSON（由 Linux 侧 `plugins/hyperv` 负责 normalize 为 assets/relations/stats）。

## 1. 配置文件（必需）

默认读取 **可执行文件同目录** 的 `hyperv-agent.config.json`，也可通过 `--config <path>` 指定。

示例（`hyperv-agent.config.json`）：

```json
{
  "bind": "127.0.0.1",
  "port": 8787,
  "token": "REPLACE_ME",
  "ps_timeout_ms": 600000,
  "log": {
    "dir": "logs",
    "level": "info",
    "retain_days": 14
  }
}
```

安全建议：

- `token` 为 Agent 的 HTTP API 鉴权口令（对应 Hyper-V Credential：`{ "auth": "agent", "token": "..." }`）。
- 配置文件包含敏感信息，请用 NTFS ACL 限制仅 **服务运行账号** 与 **管理员** 可读。

## 2. 启动

开发模式（在 Windows 上）：

```bash
bun run src/server.ts --config hyperv-agent.config.json
```

编译（Windows 单文件 exe）：

```bash
bun build --compile src/server.ts --outfile dist/hyperv-windows-agent.exe
```

注意：

- Agent 会在运行目录的 `scripts/` 下查找 PowerShell 脚本。编译后请将 `src/scripts/` 复制到 `dist/scripts/`（与 exe 同级目录）。
- 本地日志默认写入 `logs/`（相对运行目录），按天切分为 `logs/hyperv-agent-YYYY-MM-DD.jsonl`；请确保服务账号对该目录有写权限。

## 3. API

鉴权：

- Header：`Authorization: Bearer <token>`
- 可选 Header：`X-Request-Id: <string>`（用于日志关联）

路由：

- `POST /v1/hyperv/healthcheck`
- `POST /v1/hyperv/detect`
- `POST /v1/hyperv/collect`

请求体（最小集合）：

```json
{
  \"source_id\": \"string\",
  \"run_id\": \"string\",
  \"mode\": \"healthcheck|detect|collect\",
  \"now\": \"ISO-8601\",
  \"scope\": \"auto|standalone|cluster\",
  \"max_parallel_nodes\": 5
}
```

响应体（raw，插件负责 normalize）：

- 成功：`{ \"ok\": true, \"data\": { ... } }`
- 失败：`{ \"ok\": false, \"error\": { \"code\": \"AGENT_*\", \"message\": \"...\", \"context\": { ... } } }`
