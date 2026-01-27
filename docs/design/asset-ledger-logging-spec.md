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

- `actor.user_id`（string|null）
- `actor.role`（string|null）
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
- `plugin.exit_code`（number|null）
- `plugin.driver`（string|null）
- `stats.assets` / `stats.relations`（number）
- `stats.inventory_complete`（boolean|null）
- `warnings_count` / `errors_count`（number）

失败时必填：

- `error.code`（string）
- `error.category`（string）
- `error.retryable`（boolean）
- `error.message`（string，脱敏）

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

> 错误码注册表（MVP 口径）见：`docs/design/asset-ledger-error-codes.md`。

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

## 5. 日志保留与归档策略

### 5.1 保留策略

| 日志类型                                   | 保留周期 | 归档策略                |
| ------------------------------------------ | -------- | ----------------------- |
| Web 请求日志（`http.request`）             | 90 天    | 90 天后压缩归档到冷存储 |
| 调度事件日志（`schedule_group.triggered`） | 180 天   | 180 天后压缩归档        |
| Run 完成日志（`run.finished`）             | 永久     | 与 Run 数据保留策略一致 |
| 错误日志（`level=error`）                  | 永久     | 用于审计与排障          |

### 5.2 日志级别使用指南

| 级别    | 使用场景                     | 示例                               |
| ------- | ---------------------------- | ---------------------------------- |
| `info`  | 正常业务流程、成功操作       | 请求完成、Run 成功、调度触发       |
| `error` | 失败操作、需要关注的异常     | 认证失败、插件超时、数据库写入失败 |
| `warn`  | 非致命问题、降级操作（预留） | 部分字段缺失、重试成功             |
| `debug` | 开发调试（生产环境默认关闭） | 详细请求/响应内容                  |

### 5.3 日志文件管理（建议）

- **文件轮转**：按日期轮转（`YYYY-MM-DD.log`），单文件上限 100MB
- **压缩**：轮转后的日志文件使用 gzip 压缩
- **清理**：超过保留周期的日志文件自动删除（建议使用 logrotate 或类似工具）
- **监控**：日志目录磁盘使用率告警阈值建议 80%

## 6. 日志采样策略

### 6.1 采样规则

> 目标：在高流量场景下控制日志量，同时保证关键事件不丢失。

| 事件类型 | 采样策略 | 说明 |
|---------|---------|------|
| `http.request`（成功） | 10% 采样 | 正常请求可降采样 |
| `http.request`（失败） | 100% 保留 | 错误必须全量记录 |
| `http.request`（慢请求 >1s） | 100% 保留 | 性能问题必须记录 |
| `schedule_group.triggered` | 100% 保留 | 调度事件全量记录 |
| `run.finished` | 100% 保留 | Run 事件全量记录 |
| `run.finished`（失败） | 100% 保留 + 告警 | 失败必须告警 |

### 6.2 采样实现（TypeScript）

```typescript
/**
 * 日志采样配置
 */
export interface SamplingConfig {
  /** 默认采样率（0-1） */
  defaultRate: number;
  /** 按事件类型覆盖采样率 */
  overrides: Record<string, number>;
  /** 强制保留的条件 */
  forceRetain: {
    /** 错误事件始终保留 */
    onError: boolean;
    /** 慢请求阈值（ms），超过则保留 */
    slowThresholdMs: number;
    /** 特定用户始终保留（用于调试） */
    userIds: string[];
  };
}

/**
 * 默认采样配置
 */
export const defaultSamplingConfig: SamplingConfig = {
  defaultRate: 0.1, // 10% 默认采样
  overrides: {
    'http.request': 0.1,
    'schedule_group.triggered': 1.0,
    'run.finished': 1.0,
  },
  forceRetain: {
    onError: true,
    slowThresholdMs: 1000,
    userIds: [],
  },
};

/**
 * 判断是否应该记录该事件
 */
export function shouldLog(
  event: LogEvent,
  config: SamplingConfig = defaultSamplingConfig
): boolean {
  // 1. 错误事件始终保留
  if (config.forceRetain.onError && event.level === 'error') {
    return true;
  }

  // 2. 慢请求始终保留
  if (
    event.duration_ms &&
    event.duration_ms > config.forceRetain.slowThresholdMs
  ) {
    return true;
  }

  // 3. 特定用户始终保留
  if (
    event.actor?.user_id &&
    config.forceRetain.userIds.includes(event.actor.user_id)
  ) {
    return true;
  }

  // 4. 按事件类型采样
  const rate = config.overrides[event.event_type] ?? config.defaultRate;
  return Math.random() < rate;
}
```

### 6.3 采样标记

被采样的日志应包含采样标记，便于后续分析时还原真实流量：

```json
{
  "ts": "2026-01-27T09:00:00.000Z",
  "event_type": "http.request",
  "sampling": {
    "rate": 0.1,
    "retained_reason": "sampled"
  }
}
```

`retained_reason` 枚举值：
- `sampled`：按采样率随机保留
- `error`：因错误强制保留
- `slow`：因慢请求强制保留
- `user`：因特定用户强制保留
- `always`：该事件类型始终保留

## 7. 告警规则

### 7.1 告警级别定义

| 级别 | 说明 | 响应时间 | 通知方式 |
|-----|------|---------|---------|
| P0 | 系统不可用 | 立即 | 电话 + 短信 + 邮件 |
| P1 | 核心功能受损 | 15 分钟内 | 短信 + 邮件 |
| P2 | 非核心功能异常 | 1 小时内 | 邮件 + IM |
| P3 | 需关注但不紧急 | 24 小时内 | 邮件 |

### 7.2 告警规则清单

#### 7.2.1 系统级告警

| 告警名称 | 级别 | 触发条件 | 恢复条件 |
|---------|------|---------|---------|
| `system.down` | P0 | Web 服务连续 3 次健康检查失败 | 健康检查恢复 |
| `db.connection_failed` | P0 | 数据库连接失败 | 连接恢复 |
| `disk.usage_critical` | P1 | 磁盘使用率 > 90% | 使用率 < 85% |
| `disk.usage_warning` | P2 | 磁盘使用率 > 80% | 使用率 < 75% |
| `memory.usage_critical` | P1 | 内存使用率 > 90% 持续 5 分钟 | 使用率 < 85% |

#### 7.2.2 业务级告警

| 告警名称 | 级别 | 触发条件 | 恢复条件 |
|---------|------|---------|---------|
| `run.failure_rate_high` | P1 | 过去 1 小时 Run 失败率 > 50% | 失败率 < 20% |
| `run.consecutive_failures` | P1 | 同一 Source 连续 3 次 Run 失败 | Run 成功 |
| `run.timeout_spike` | P2 | 过去 1 小时超时 Run 数量 > 5 | 超时数量 < 2 |
| `scheduler.no_trigger` | P2 | 调度组超过预期时间未触发 | 触发恢复 |
| `api.error_rate_high` | P1 | 过去 5 分钟 API 错误率 > 10% | 错误率 < 5% |
| `api.latency_high` | P2 | 过去 5 分钟 P99 延迟 > 5s | P99 < 2s |

#### 7.2.3 安全告警

| 告警名称 | 级别 | 触发条件 | 恢复条件 |
|---------|------|---------|---------|
| `auth.brute_force` | P1 | 同一 IP 5 分钟内登录失败 > 10 次 | 无新失败 |
| `auth.unusual_access` | P2 | 非工作时间管理员登录 | 手动确认 |
| `credential.exposure` | P0 | 日志中检测到疑似凭证 | 手动确认已清理 |

### 7.3 告警规则配置（Prometheus 格式）

```yaml
groups:
  - name: asset-ledger-alerts
    rules:
      # P0: 系统不可用
      - alert: SystemDown
        expr: up{job="asset-ledger-web"} == 0
        for: 1m
        labels:
          severity: P0
        annotations:
          summary: "资产台账 Web 服务不可用"
          description: "Web 服务已停止响应超过 1 分钟"

      # P1: Run 失败率过高
      - alert: RunFailureRateHigh
        expr: |
          sum(rate(run_finished_total{status="Failed"}[1h])) /
          sum(rate(run_finished_total[1h])) > 0.5
        for: 5m
        labels:
          severity: P1
        annotations:
          summary: "Run 失败率过高"
          description: "过去 1 小时 Run 失败率超过 50%"

      # P1: 连续失败
      - alert: RunConsecutiveFailures
        expr: run_consecutive_failures > 3
        for: 0m
        labels:
          severity: P1
        annotations:
          summary: "Source {{ $labels.source_id }} 连续失败"
          description: "Source 已连续 {{ $value }} 次 Run 失败"

      # P1: API 错误率过高
      - alert: ApiErrorRateHigh
        expr: |
          sum(rate(http_requests_total{status=~"5.."}[5m])) /
          sum(rate(http_requests_total[5m])) > 0.1
        for: 2m
        labels:
          severity: P1
        annotations:
          summary: "API 错误率过高"
          description: "过去 5 分钟 API 5xx 错误率超过 10%"

      # P2: API 延迟过高
      - alert: ApiLatencyHigh
        expr: |
          histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m])) > 5
        for: 5m
        labels:
          severity: P2
        annotations:
          summary: "API P99 延迟过高"
          description: "过去 5 分钟 API P99 延迟超过 5 秒"

      # P2: 磁盘使用率告警
      - alert: DiskUsageWarning
        expr: disk_usage_percent > 80
        for: 5m
        labels:
          severity: P2
        annotations:
          summary: "磁盘使用率告警"
          description: "磁盘使用率已达 {{ $value }}%"

      # P1: 磁盘使用率严重
      - alert: DiskUsageCritical
        expr: disk_usage_percent > 90
        for: 2m
        labels:
          severity: P1
        annotations:
          summary: "磁盘使用率严重"
          description: "磁盘使用率已达 {{ $value }}%，请立即处理"

### 7.4 告警抑制规则

```yaml
inhibit_rules:
  # 系统不可用时抑制其他告警
  - source_match:
      alertname: SystemDown
    target_match_re:
      alertname: (RunFailureRateHigh|ApiErrorRateHigh|ApiLatencyHigh)
    equal: ['instance']

  # P1 告警抑制同类 P2 告警
  - source_match:
      severity: P1
    target_match:
      severity: P2
    equal: ['alertname']
```

### 7.5 告警通知模板

```yaml
# 告警通知模板（中文）
templates:
  - name: 'alert_notification'
    template: |
      【{{ .Labels.severity }}】{{ .Annotations.summary }}

      告警名称：{{ .Labels.alertname }}
      触发时间：{{ .StartsAt.Format "2006-01-02 15:04:05" }}
      告警详情：{{ .Annotations.description }}

      {{ if .Labels.source_id }}来源 ID：{{ .Labels.source_id }}{{ end }}
      {{ if .Labels.run_id }}Run ID：{{ .Labels.run_id }}{{ end }}

      请及时处理！
```

### 7.6 告警处理 SOP

| 告警 | 处理步骤 |
|-----|---------|
| `system.down` | 1. 检查服务进程状态<br>2. 检查系统资源（CPU/内存/磁盘）<br>3. 检查数据库连接<br>4. 查看最近部署记录<br>5. 必要时回滚 |
| `run.consecutive_failures` | 1. 查看 Run 错误详情<br>2. 检查 Source 配置（endpoint/凭证）<br>3. 测试目标系统连通性<br>4. 手动触发 healthcheck<br>5. 联系目标系统管理员 |
| `api.error_rate_high` | 1. 查看错误日志分布<br>2. 识别错误类型（auth/db/timeout）<br>3. 检查依赖服务状态<br>4. 必要时限流或降级 |
| `disk.usage_critical` | 1. 检查日志文件大小<br>2. 清理过期日志<br>3. 检查 raw 数据增长<br>4. 考虑扩容或归档 |
