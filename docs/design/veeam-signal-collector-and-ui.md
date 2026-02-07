# Veeam（VBR）信号采集与备份状态展示

版本：v1.0  
日期：2026-02-07

## 1. 背景与目标

本设计用于新增一个 **Veeam Backup & Replication（VBR）** 的“信号（signal）来源”，与 SolarWinds 类似：不作为库存（inventory）来源，不生成/维护资产清单；仅用于为已存在的资产补充**备份覆盖与状态**。

目标：

- 支持新增 SourceType：`veeam`，且 `role=signal`。
- 资产列表页“监控”列：同时展示 SolarWinds（监控）与 Veeam（备份）两个小图标，并按状态染色。
- 资产详情页：展示备份摘要，并展示最近 **7 次**备份记录（不做完整备份列表）。

## 2. Source 配置与凭据

### 2.1 Source 配置（config）

Veeam Source 使用直连 VBR REST API：

- `endpoint`：VBR Base URL，例如 `https://vbr.example.com:9419`
- `tls_verify`：是否校验证书（默认 `true`）
- `timeout_ms`：HTTP 超时（默认 `60000`）
- `api_version`：VBR REST API Header：`x-api-version`（默认 `1.3-rev1`）
- `sessions_limit`：拉取 sessions 上限（默认 `200`）
- `task_sessions_limit`：拉取 task sessions 上限（默认 `2000`）

### 2.2 凭据（credential）

- `username`
- `password`

## 3. 采集插件（plugins/veeam）

### 3.1 认证方式

- OAuth2 password grant：`POST /api/oauth2/token`
- Header 必填：`x-api-version`
- 后续请求使用 `Authorization: <token_type> <access_token>`

### 3.2 拉取策略（collect）

核心数据来自两类接口：

- `GET /api/v1/sessions`：按 `EndTime` 倒序拉取（`typeFilter=BackupJob`，`limit=sessions_limit`）
- `GET /api/v1/sessions/{id}/taskSessions`：按 `EndTime` 倒序分页拉取（总量受 `task_sessions_limit` 约束）

插件将 task session 聚合为“每个受保护对象（通常是 VM）一条信号”。

### 3.3 collector-response-v1 输出

#### 3.3.1 normalized-v1（信号）

Veeam 信号使用 `normalized-v1` 的 `attributes.*` 承载备份语义（保证值为 primitive）：

- `backup_covered`：boolean
- `backup_state`：`success|warning|failed|unknown`
- `backup_last_result`：原始结果（例如 `Success|Warning|Failed`）
- `backup_last_message`：结果说明（可空）
- `backup_last_end_at`：最近一次结束时间（ISO8601，可空）
- `backup_last_success_at`：最近一次成功结束时间（ISO8601，可空）

`identity.caption` 写入对象名（来自 Veeam task session `name`），用于与资产侧做“按名称匹配”。

#### 3.3.2 raw_payload（最近 7 次）

为满足详情页展示，插件仅在 `raw_payload` 中保留最近 7 条备份历史（**不提供完整列表**）：

```json
{
  "history_last7": [
    {
      "end_time": "2026-02-07T00:09:59.000Z",
      "start_time": "2026-02-07T00:00:10.000Z",
      "result": "Success",
      "message": "OK",
      "state": "Stopped",
      "job_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "job_name": "Job A",
      "session_id": "11111111-1111-1111-1111-111111111111",
      "session_name": "Job A",
      "task_session_id": "22222222-2222-2222-2222-222222222222",
      "repository_id": "33333333-3333-3333-3333-333333333333",
      "processed_size": 123,
      "read_size": 456,
      "transferred_size": 789,
      "duration": "00:09:49"
    }
  ]
}
```

## 4. Ingest 映射（落库聚合字段）

Worker 将 Veeam 插件输出的信号写入：

- `SignalRecord`：保存 normalized 与 raw（压缩存储）。
- `AssetSignalLink`：复用既有信号匹配/绑定机制（manual/auto/ambiguous/unmatched）。
- `AssetOperationalState.backup*`：用于列表与详情页快速展示：
  - `backupCovered`
  - `backupState`
  - `backupLastSuccessAt`
  - `backupLastResult`
  - `backupUpdatedAt`

聚合策略（同一次 run 内）：

- 对同一资产可能出现多条信号（例如多个 job 覆盖同一对象）：
  - `backupState/backupLastResult` 取 **last_end_at 最新** 的那条；
  - `backupLastSuccessAt` 取所有信号中 **最大**（最新成功时间）。

注意：

- 当前实现不会像 SolarWinds 那样在“本次 run 未出现”时把 `backupCovered` 强制置为 `false`（避免多套 VBR / 多来源覆盖时互相覆盖为 not_covered）。

## 5. UI 展示规则

### 5.1 资产列表页（/assets）“监控”列

- 该列同时展示两枚小图标：
  - `SW`：SolarWinds 监控状态（来自 `monitor*`）
  - `V`：Veeam 备份状态（来自 `backup*`）
- 图标按状态染色：
  - 正常/成功：绿色
  - 告警：黄色
  - 异常/失败：红色
  - 未覆盖/未知：灰色
- tooltip 展示更新时间/状态详情（例如最近一次备份结果、最近成功时间）。

### 5.2 资产详情页（/assets/[uuid]）

- 盘点摘要表新增“备份”行：Badge 展示 `backupState`，tooltip 展示最近结果/最近成功/更新时间。
- 新增「最近 7 次备份」表格：仅展示最近 7 条历史（来自 `backupLast7`）。
