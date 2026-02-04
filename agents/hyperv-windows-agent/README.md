# Hyper-V Windows Agent（B 方案）

该 Agent 用于在 **入域 Windows** 上以 **gMSA**（推荐）运行 PowerShell 采集 Hyper-V/Failover Cluster 信息，并通过 HTTP API 返回 raw JSON（由 Linux 侧 `plugins/hyperv` 负责 normalize 为 assets/relations/stats）。

## 1. 环境变量

- `HYPERV_AGENT_TOKEN`（必填）：Bearer token（与 Hyper-V Credential: `{ auth: \"agent\", token }` 对应）
- `HYPERV_AGENT_BIND`（默认 `127.0.0.1`）：监听地址
- `HYPERV_AGENT_PORT`（默认 `8787`）：监听端口
- `HYPERV_AGENT_PS_TIMEOUT_MS`（默认 `600000`）：单次 PowerShell 执行超时（ms）

## 2. 启动

开发模式（在 Windows 上）：

```bash
bun run src/server.ts
```

编译（Windows 单文件 exe）：

```bash
bun build --compile src/server.ts --outfile dist/hyperv-windows-agent.exe
```

注意：当前实现会在运行目录的 `scripts/` 下查找 PowerShell 脚本。编译后请将 `src/scripts/` 复制到 `dist/scripts/`（与 exe 同级目录）。

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
