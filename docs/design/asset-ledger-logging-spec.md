# 资产台账日志规范（Wide Events / Domain Events）

版本：v1.0  
日期：2026-01-27

## 文档简介

本文档定义资产台账系统的最小可落地日志规范：

- **Web 请求宽事件（Wide Event / Canonical Log Line）**：每个请求结束时输出 1 条结构化 JSON 日志。
- **采集域事件（Domain Events）**：调度器与 worker 的关键事件（例如 schedule_group 触发、Run 完成）也采用结构化 JSON，尽量“每个 Run 结束 1 条”。

目标：

- 一眼定位问题：按 `request_id/run_id/source_id` 可快速串联上下文。
- 便于检索分析：字段稳定、类型稳定、避免随手字符串。
- 安全默认：日志中不出现任何明文凭证/敏感信息。

## 0. 基本原则（强约束）

- **结构化 JSON**：禁止仅输出拼接字符串（除非是 `message` 辅助字段）。
- **单条宽事件**：Web 请求结束输出 1 条；Run 结束输出 1 条（不要把同一上下文拆成一堆零散日志）。
- **禁止泄漏 secrets**：日志、错误、stdout/stderr 摘要中均不得出现明文凭证（password/token/AK/SK 等）。
- **截断与脱敏**：任何 `*_excerpt` 字段必须截断（建议 ≤ 2000 字符）并做脱敏。

> 本文档使用 `a.b.c` 表达“嵌套 JSON 路径”（例如 `http.method` 表示 `{ "http": { "method": "..." } }`），实际日志建议使用嵌套对象而不是包含 `.` 的扁平 key。

## 1. 通用事件包络（所有事件必带）

| 字段         | 类型   | 说明                                  |
| ------------ | ------ | ------------------------------------- |
| `ts`         | string | 事件发生时间（ISO8601，UTC）          |
| `level`      | string | `info` / `error`                      |
| `service`    | string | `web` / `scheduler` / `worker`        |
| `env`        | string | `development` / `test` / `production` |
| `version`    | string | 构建版本（建议 git sha）              |
| `event_type` | string | 事件类型（见第 2 章）                 |

推荐（可选）：`message`（简短可读摘要）。

## 2. 事件类型与最小字段

### 2.1 Web：`http.request`（每个 HTTP 请求 1 条）

必填字段：

- `request_id`（string）
- `http.method`（string）
- `http.path`（string）
- `http.status_code`（number）
- `duration_ms`（number）
- `outcome`（`success|error`）

可选字段：

- `actor.user_id`（string 或 null）
- `actor.role`（string 或 null）
- `error.code` / `error.category` / `error.message`（仅当 `outcome=error`）

### 2.2 Scheduler：`schedule_group.triggered`（每次调度组触发 1 条）

必填字段：

- `schedule_group_id`（string）
- `timezone`（string，IANA TZ）
- `local_date`（string，YYYY-MM-DD）
- `hhmm`（string，HH:mm）
- `queued`（number，本次创建 Run 数量）
- `skipped_active`（number，因单飞跳过的 source 数量）

### 2.3 Worker：`run.finished`（每个 Run 完成 1 条）

必填字段：

- `run_id`（string）
- `source_id`（string）
- `trigger_type`（`schedule|manual`）
- `mode`（`collect|detect|healthcheck`）
- `status`（`Succeeded|Failed|Cancelled`）
- `duration_ms`（number）

推荐字段（强烈建议）：

- `plugin.timeout_ms`（number）
- `plugin.exit_code`（number 或 null）
- `plugin.driver`（string 或 null）
- `stats.assets` / `stats.relations`（number）
- `stats.inventory_complete`（boolean 或 null）
- `warnings_count` / `errors_count`（number）

失败时必填：

- `error.code`（string）
- `error.category`（string）
- `error.retryable`（boolean）
- `error_summary`（string，脱敏）

## 3. error 对象（统一结构）

当事件包含错误时，使用 `error` 对象统一承载，字段如下（以 `error.*` 表示嵌套路径）：

- `error.code`（string）：稳定错误码（例如 `AUTH_FAILED` / `PLUGIN_FAILED`）。
- `error.category`（string）：错误分类（枚举）：
  - `auth`：认证失败（账号/密码/会话）
  - `permission`：权限不足
  - `network`：网络/连接问题
  - `rate_limit`：限流
  - `parse`：解析/协议不兼容
  - `config`：配置错误（缺少必填/非法值）
  - `unknown`：无法归类
- `error.message`（string）：可读错误信息（必须脱敏）。
- `error.retryable`（boolean）：是否建议重试（用于 UI 提示与自动重试策略）。
- `error.redacted_context`（object，可选）：脱敏后的定位上下文（示例：`http_status`、`trace_id`、`stderr_excerpt`、`endpoint`、`source_type`）。

## 4. 示例（参考）

### 4.1 http.request

```json
{
  "ts": "2026-01-27T09:00:00.000Z",
  "level": "info",
  "service": "web",
  "env": "production",
  "version": "git:abcdef1",
  "event_type": "http.request",
  "request_id": "req_123",
  "http": { "method": "GET", "path": "/api/runs", "status_code": 200 },
  "duration_ms": 12,
  "outcome": "success",
  "actor": { "user_id": "u_admin", "role": "admin" }
}
```

### 4.2 run.finished

```json
{
  "ts": "2026-01-27T09:05:00.000Z",
  "level": "info",
  "service": "worker",
  "env": "production",
  "version": "git:abcdef1",
  "event_type": "run.finished",
  "run_id": "run_456",
  "source_id": "src_123",
  "trigger_type": "schedule",
  "mode": "collect",
  "status": "Succeeded",
  "duration_ms": 5321,
  "plugin": { "timeout_ms": 300000, "exit_code": 0, "driver": "vcenter@v1" },
  "stats": { "assets": 120, "relations": 80, "inventory_complete": true },
  "warnings_count": 0,
  "errors_count": 0
}
```
