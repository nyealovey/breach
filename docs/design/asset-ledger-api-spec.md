# 资产台账 API 规范

版本：v1.2
日期：2026-02-06

## 文档简介

本文档定义资产台账系统的 REST API 规范，包括请求/响应格式、错误处理、分页约定等，确保前后端对齐。

- 适用读者：前端开发、后端开发、API 消费者。
- 关联文档：
  - PRD：`docs/mvp/prds/asset-ledger-v1.0-prd.md`
  - 错误码规范：`docs/design/asset-ledger-error-codes.md`
  - JSON Schema：`docs/design/asset-ledger-json-schema.md`

## 1. 通用约定

### 1.1 基础信息

| 项目     | 值                 |
| -------- | ------------------ |
| 基础路径 | `/api/v1`          |
| 协议     | HTTPS（生产环境）  |
| 内容类型 | `application/json` |
| 字符编码 | UTF-8              |

### 1.2 认证

- 方式：Session Cookie（HttpOnly）
- Cookie 名称：`session`
- 未认证请求返回 `401 Unauthorized`

### 1.3 请求头

| Header         | 必填                 | 说明                       |
| -------------- | -------------------- | -------------------------- |
| `Content-Type` | 是（POST/PUT/PATCH） | `application/json`         |
| `Accept`       | 否                   | `application/json`（默认） |
| `X-Request-ID` | 否                   | 客户端请求 ID（用于追踪）  |

### 1.4 响应格式

**成功响应**：

```json
{
  "data": { ... },
  "meta": {
    "requestId": "req_abc123",
    "timestamp": "2026-01-27T12:00:00Z"
  }
}
```

**列表响应（带分页）**：

```json
{
  "data": [ ... ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 150,
    "totalPages": 8
  },
  "meta": {
    "requestId": "req_abc123",
    "timestamp": "2026-01-27T12:00:00Z"
  }
}
```

**错误响应**：

```json
{
  "error": {
    "code": "CONFIG_INVALID_REQUEST",
    "category": "config",
    "message": "Validation failed",
    "retryable": false,
    "details": [{ "field": "config.endpoint", "issue": "required", "message": "endpoint is required" }]
  },
  "meta": {
    "requestId": "req_abc123",
    "timestamp": "2026-01-27T12:00:00Z"
  }
}
```

> 说明：错误对象（`error`）字段与错误码/日志规范对齐（见：`docs/design/asset-ledger-error-codes.md`、`docs/design/asset-ledger-logging-spec.md`）。
>
> - `error.code`：稳定错误码（可枚举）
> - `error.category`：错误分类（枚举）
> - `error.message`：可读且脱敏的错误信息
> - `error.retryable`：是否建议“按同样输入重试”可能成功（用于 UI 提示/自动重试）
> - `error.redacted_context`（可选）：脱敏后的定位上下文（例如 `http_status/trace_id/stdout_excerpt` 等）
> - `error.details`（可选）：参数校验细节（常用于 `CONFIG_INVALID_REQUEST`）

**常见错误响应（示例）**

> 注意：以下示例用于展示字段结构；具体错误码与使用场景见错误码规范：`docs/design/asset-ledger-error-codes.md`。

**未认证（401）**

```json
{
  "error": {
    "code": "AUTH_UNAUTHORIZED",
    "category": "auth",
    "message": "Not authenticated",
    "retryable": false
  },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

**无权限（403）**

```json
{
  "error": {
    "code": "AUTH_FORBIDDEN",
    "category": "permission",
    "message": "Permission denied",
    "retryable": false
  },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

**资源不存在（404）**

```json
{
  "error": {
    "code": "CONFIG_SOURCE_NOT_FOUND",
    "category": "config",
    "message": "Resource not found",
    "retryable": false
  },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

**资源冲突（409）**

```json
{
  "error": {
    "code": "CONFIG_RESOURCE_CONFLICT",
    "category": "config",
    "message": "Resource conflict",
    "retryable": false
  },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

### 1.5 分页参数

| 参数       | 类型   | 默认值 | 说明                 |
| ---------- | ------ | ------ | -------------------- |
| `page`     | number | 1      | 页码（从 1 开始）    |
| `pageSize` | number | 20     | 每页条数（最大 100） |

### 1.6 排序参数

| 参数        | 类型   | 示例        | 说明                     |
| ----------- | ------ | ----------- | ------------------------ |
| `sortBy`    | string | `createdAt` | 排序字段                 |
| `sortOrder` | string | `desc`      | 排序方向（`asc`/`desc`） |

### 1.7 HTTP 状态码

| 状态码 | 含义                  | 使用场景                                     |
| ------ | --------------------- | -------------------------------------------- |
| 200    | OK                    | 成功（GET/PUT/PATCH/DELETE）                 |
| 201    | Created               | 创建成功（POST）                             |
| 204    | No Content            | 删除成功（无响应体）                         |
| 400    | Bad Request           | 请求参数校验失败                             |
| 401    | Unauthorized          | 未认证/会话无效                              |
| 403    | Forbidden             | 无权限                                       |
| 404    | Not Found             | 资源不存在                                   |
| 409    | Conflict              | 资源冲突（如名称重复/存在依赖/存在活动 Run） |
| 500    | Internal Server Error | 服务器内部错误                               |

## 2. 认证 API

**常见错误码**

- 401：`AUTH_INVALID_CREDENTIALS`（登录失败：用户名/密码错误）
- 401：`AUTH_UNAUTHORIZED` / `AUTH_SESSION_EXPIRED`（未登录/会话失效）
- 403：`AUTH_FORBIDDEN`（无权限；v1.0 仅 admin，预留）

### 2.1 登录

**POST** `/api/v1/auth/login`

**请求体**：

```json
{
  "username": "admin",
  "password": "********"
}
```

**成功响应**（200）：

```json
{
  "data": {
    "userId": "u_admin",
    "username": "admin",
    "role": "admin"
  },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

**错误响应**（401）：

```json
{
  "error": {
    "code": "AUTH_INVALID_CREDENTIALS",
    "category": "auth",
    "message": "Invalid username or password",
    "retryable": false
  },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

### 2.2 登出

**POST** `/api/v1/auth/logout`

**成功响应**（204）：无响应体

### 2.3 获取当前用户

**GET** `/api/v1/auth/me`

**成功响应**（200）：

```json
{
  "data": {
    "userId": "u_admin",
    "username": "admin",
    "role": "admin"
  },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

### 2.4 修改密码

**PUT** `/api/v1/auth/password`

**请求体**：

```json
{
  "currentPassword": "********",
  "newPassword": "********"
}
```

**成功响应**（200）：

```json
{
  "data": { "message": "Password updated successfully" },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

### 2.5 读取当前用户偏好（Preferences）

> 说明：用于 UI 持久化“列配置/筛选偏好”等个人偏好（每用户一份）。

**GET** `/api/v1/me/preferences`

**查询参数**：

| 参数  | 类型   | 说明                                             |
| ----- | ------ | ------------------------------------------------ |
| `key` | string | 偏好 key（版本化，如 `assets.table.columns.v1`） |

**成功响应**（200）：

```json
{
  "data": {
    "key": "assets.table.columns.v1",
    "value": { "visibleColumns": ["machineName", "ip", "cpuCount"] }
  },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

**错误响应**（404，未设置）：

```json
{
  "error": {
    "code": "CONFIG_PREFERENCE_NOT_FOUND",
    "category": "config",
    "message": "Preference not found",
    "retryable": false
  },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

### 2.6 写入当前用户偏好（Preferences）

**PUT** `/api/v1/me/preferences`

**请求体**：

```json
{
  "key": "assets.table.columns.v1",
  "value": { "visibleColumns": ["machineName", "ip", "cpuCount"] }
}
```

**成功响应**（200）：

```json
{
  "data": { "message": "Preference updated successfully" },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

## 3. 调度组 API

**常见错误码**

- 401：`AUTH_UNAUTHORIZED`（未登录/会话失效）
- 404：`CONFIG_SCHEDULE_GROUP_NOT_FOUND`（调度组不存在）
- 409：`CONFIG_RESOURCE_CONFLICT`（删除时存在未删除 Source 依赖）

### 3.1 获取调度组列表

**GET** `/api/v1/schedule-groups`

**查询参数**：

| 参数      | 类型    | 说明           |
| --------- | ------- | -------------- |
| `enabled` | boolean | 按启用状态过滤 |

**成功响应**（200）：

```json
{
  "data": [
    {
      "groupId": "sg_123",
      "name": "每日凌晨采集",
      "enabled": true,
      "timezone": "Asia/Shanghai",
      "runAtHhmm": "02:00",
      "sourceCount": 3,
      "lastTriggeredOn": "2026-01-26",
      "createdAt": "2026-01-01T00:00:00Z",
      "updatedAt": "2026-01-26T02:00:00Z"
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

### 3.2 创建调度组

**POST** `/api/v1/schedule-groups`

**请求体**：

```json
{
  "name": "每日凌晨采集",
  "timezone": "Asia/Shanghai",
  "runAtHhmm": "02:00",
  "enabled": true,
  "maxParallelSources": null,
  "sourceIds": ["src_123", "src_456"]
}
```

**成功响应**（201）：

```json
{
  "data": {
    "groupId": "sg_123",
    "name": "每日凌晨采集",
    "enabled": true,
    "timezone": "Asia/Shanghai",
    "runAtHhmm": "02:00",
    "maxParallelSources": null,
    "createdAt": "2026-01-27T12:00:00Z",
    "updatedAt": "2026-01-27T12:00:00Z"
  },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

> 注意：创建调度组时必须选择 1+ 个 `sourceIds`（且仅允许 `enabled=true` 的来源）。若来源已属于其他调度组，将被移动到新调度组（通过更新其 `scheduleGroupId` 实现）。

### 3.3 获取调度组详情

**GET** `/api/v1/schedule-groups/:groupId`

### 3.4 更新调度组

**PUT** `/api/v1/schedule-groups/:groupId`

### 3.5 删除调度组

**DELETE** `/api/v1/schedule-groups/:groupId`

**约束**：调度组下存在任一未删除 Source 时不允许删除（返回 409）。

## 4. Source API

**常见错误码**

- 401：`AUTH_UNAUTHORIZED`（未登录/会话失效）
- 403：`AUTH_FORBIDDEN`（非管理员访问管理接口）
- 404：`CONFIG_SOURCE_NOT_FOUND`（来源不存在）
- 409：`CONFIG_RESOURCE_CONFLICT`（删除时存在活动 Run）
- 409：`CONFIG_DUPLICATE_NAME`（名称重复，创建/更新冲突）

### 4.1 获取 Source 列表

**GET** `/api/v1/sources`

**查询参数**：

| 参数              | 类型    | 说明                              |
| ----------------- | ------- | --------------------------------- |
| `sourceType`      | string  | 按来源类型过滤（vcenter/pve/...） |
| `enabled`         | boolean | 按启用状态过滤                    |
| `scheduleGroupId` | string  | 按调度组过滤                      |

**成功响应**（200）：

```json
{
  "data": [
    {
      "sourceId": "src_123",
      "name": "vcenter-prod",
      "sourceType": "vcenter",
      "enabled": true,
      "scheduleGroupId": "sg_123",
      "scheduleGroupName": "每日凌晨采集",
      "config": {
        "endpoint": "https://vcenter.example.com"
      },
      "lastRun": {
        "runId": "run_456",
        "status": "Succeeded",
        "finishedAt": "2026-01-26T02:15:00Z"
      },
      "createdAt": "2026-01-01T00:00:00Z",
      "updatedAt": "2026-01-26T02:15:00Z"
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

### 4.1A 获取 Source 摘要列表（供 user 筛选，脱敏）

> 说明：普通用户（user）只读访问场景下，为避免暴露来源 `config/endpoint/credential/scheduleGroupId` 等敏感信息，提供最小摘要列表供 UI 筛选使用。

**GET** `/api/v1/sources/summary`

**权限**：user/admin 均可访问。

**成功响应**（200）：

```json
{
  "data": [{ "sourceId": "src_123", "name": "vcenter-prod", "sourceType": "vcenter", "enabled": true }],
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

约束：

- 不返回 `config`（尤其 endpoint）、不返回 `scheduleGroupId`、不返回任何 credential 信息。
- 默认仅返回 `enabled=true` 且 `deletedAt=null` 的来源（避免 user 看到已删除来源）。

### 4.2 创建 Source

**POST** `/api/v1/sources`

**请求体**：

```json
{
  "name": "vcenter-prod",
  "sourceType": "vcenter",
  "enabled": true,
  "config": {
    "endpoint": "https://vcenter.example.com"
  },
  "credentialId": "cred_123",
  "scheduleGroupId": null
}
```

**成功响应**（201）：

```json
{
  "data": {
    "sourceId": "src_123",
    "name": "vcenter-prod",
    "sourceType": "vcenter",
    "enabled": true,
    "scheduleGroupId": null,
    "credential": {
      "credentialId": "cred_123",
      "name": "vcenter-prod-admin",
      "type": "vcenter"
    },
    "config": {
      "endpoint": "https://vcenter.example.com"
    },
    "createdAt": "2026-01-27T12:00:00Z",
    "updatedAt": "2026-01-27T12:00:00Z"
  },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

> 注意：响应中不包含凭据明文（payload 不回显），仅返回 `credential` 摘要信息。

### 4.3 获取 Source 详情

**GET** `/api/v1/sources/:sourceId`

### 4.4 更新 Source

**PUT** `/api/v1/sources/:sourceId`

### 4.5 更新 Source 凭证

**PUT** `/api/v1/sources/:sourceId/credential`

**请求体**：

```json
{
  "username": "admin@vsphere.local",
  "password": "********"
}
```

**成功响应**（200）：

```json
{
  "data": { "message": "Credential updated successfully" },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

### 4.6 删除 Source

**DELETE** `/api/v1/sources/:sourceId`

**语义**：软删除（不物理删除）。删除后 Source 默认不再出现在 Source 列表，且不会再参与定时调度或被手动触发；但历史 Run/SourceRecord/资产追溯关系必须保留且仍可查询。

**约束**：若该 Source 存在活动 Run（`Queued`/`Running`），不允许删除（返回 409）。

**成功响应**（204）：无响应体

**错误响应**（404，Source 不存在）：

```json
{
  "error": {
    "code": "CONFIG_SOURCE_NOT_FOUND",
    "category": "config",
    "message": "Source not found",
    "retryable": false
  },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

**错误响应**（409，存在活动 Run）：

```json
{
  "error": {
    "code": "CONFIG_RESOURCE_CONFLICT",
    "category": "config",
    "message": "Active run exists for this source",
    "retryable": false,
    "redacted_context": { "sourceId": "src_123" }
  },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

### 4.7 触发 Source 采集

**POST** `/api/v1/sources/:sourceId/runs`

**请求体**：

```json
{
  "mode": "collect|detect|healthcheck"
}
```

说明：

- `detect`：仅做“探测模式”，在不真正采集资产的情况下连通性/能力探测，并返回 `detectResult`（例如 driver/target_version/capabilities）。
- `collect`：执行实际采集；本期 collect 响应不包含 `detect` 字段，因此 `detectResult` 只有在 `mode=detect` 的 Run 才会写入。

**成功响应**（201）：

```json
{
  "data": {
    "runId": "run_789",
    "sourceId": "src_123",
    "mode": "collect",
    "triggerType": "manual",
    "status": "Queued",
    "createdAt": "2026-01-27T12:00:00Z"
  },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

**触发抑制响应**（200，已有活动 Run）：

```json
{
  "data": {
    "runId": "run_456",
    "sourceId": "src_123",
    "status": "Running",
    "message": "Active run already exists"
  },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

## 5. Run API

**常见错误码**

- 401：`AUTH_UNAUTHORIZED`（未登录/会话失效）
- 404：`CONFIG_RUN_NOT_FOUND`（Run 不存在）
- 5xx：采集/执行类错误（例如 `PLUGIN_TIMEOUT/PLUGIN_OUTPUT_INVALID_JSON/DB_WRITE_FAILED` 等，见错误码规范）

### 5.1 获取 Run 列表

**GET** `/api/v1/runs`

**权限**：user/admin 均可访问。

**查询参数**：

| 参数          | 类型   | 说明                                                    |
| ------------- | ------ | ------------------------------------------------------- |
| `sourceId`    | string | 按 Source 过滤                                          |
| `status`      | string | 按状态过滤（Queued/Running/Succeeded/Failed/Cancelled） |
| `mode`        | string | 按模式过滤（collect/detect/healthcheck）                |
| `triggerType` | string | 按触发类型过滤（schedule/manual）                       |

**成功响应**（200）：

```json
{
  "data": [
    {
      "runId": "run_456",
      "sourceId": "src_123",
      "sourceName": "vcenter-prod",
      "mode": "collect",
      "triggerType": "schedule",
      "status": "Succeeded",
      "startedAt": "2026-01-26T02:00:00Z",
      "finishedAt": "2026-01-26T02:15:00Z",
      "durationMs": 900000,
      "stats": {
        "assets": 120,
        "relations": 80,
        "inventoryComplete": true
      },
      "warningsCount": 0,
      "errorsCount": 0
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

### 5.2 获取 Run 详情

**GET** `/api/v1/runs/:runId`

**权限**：user/admin 均可访问。

**成功响应**（200）：

```json
{
  "data": {
    "runId": "run_456",
    "sourceId": "src_123",
    "sourceName": "vcenter-prod",
    "mode": "collect",
    "triggerType": "schedule",
    "status": "Succeeded",
    "startedAt": "2026-01-26T02:00:00Z",
    "finishedAt": "2026-01-26T02:15:00Z",
    "durationMs": 900000,
    "detectResult": {
      "targetVersion": "8.0",
      "driver": "vcenter@v1"
    },
    "stats": {
      "assets": 120,
      "relations": 80,
      "inventoryComplete": true
    },
    "warnings": [],
    "errors": []
  },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

### 5.3 取消 Run

v1.0 不提供取消能力；后续如需要，可新增 `POST /api/v1/runs/:runId/cancel` 并补充“运行中中断插件进程/一致性回滚”的语义与实现。

## 6. Asset API

**常见错误码**

- 401：`AUTH_UNAUTHORIZED`（未登录/会话失效）
- 403：`AUTH_FORBIDDEN`（非管理员写入）
- 404：`CONFIG_ASSET_NOT_FOUND`（资产不存在）

### 6.1 获取 Asset 列表

**GET** `/api/v1/assets`

**权限**：user/admin 均可访问。

**查询参数**：

| 参数                 | 类型   | 说明                                                                                                                                                       |
| -------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `page`               | number | 分页页码（从 1 开始）                                                                                                                                      |
| `pageSize`           | number | 每页条数                                                                                                                                                   |
| `asset_type`         | string | 按类型过滤（vm/host/cluster）                                                                                                                              |
| `source_id`          | string | 按来源过滤                                                                                                                                                 |
| `exclude_asset_type` | string | 排除类型（vm/host/cluster）；用于列表默认不展示某类资产（例如默认隐藏 cluster）                                                                            |
| `q`                  | string | 关键字搜索（覆盖：机器名/虚拟机名/宿主机名/操作系统、externalId、uuid 等文本字段；空格分词 AND；不区分大小写；模糊包含匹配；不做中文分词/同义词/拼写容错） |

**关键字搜索（q）语义**：

- 空格分词：将 `q` 按空白字符切分为多个词（连续空白视为一个分隔）。
- AND：每个词都必须命中。
- 匹配方式：不区分大小写的“包含”匹配（substring）。
- 范围：对机器名（覆盖值/采集值）、虚拟机名、宿主机名、操作系统生效：
  - `os.name` / `os.version`：所有资产类型均参与；
  - `os.fingerprint`：仅 VM 参与（用于承接 guest_OS 等指纹）；Host 的 `os.fingerprint` 用于承接 ESXi build，本期不纳入 `q` 搜索。
  - 台账字段按 `effective` 口径参与（`override` 命中优先；`override` 为空时匹配 `source`）。
  - 以及 externalId、uuid 等文本字段。
- 空值处理：`q` 为空或仅包含空白时，视为未提供该参数。

**成功响应**（200）：

```json
{
  "data": [
    {
      "assetUuid": "a_123",
      "assetType": "vm",
      "status": "in_service",
      "machineName": "app-01",
      "machineNameOverride": "app-01",
      "machineNameCollected": "app-01.local",
      "machineNameMismatch": true,
      "hostName": "esxi-01",
      "vmName": "vm-app-01",
      "os": "Ubuntu 22.04",
      "vmPowerState": "poweredOn",
      "ip": "10.10.1.23",
      "cpuCount": 4,
      "memoryBytes": 8589934592,
      "totalDiskBytes": 53687091200
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

**字段口径补充（列表聚合字段）**：

- `cpuCount`：
  - VM：取 `canonical.fields.hardware.cpu_count.value`（vCPU 数量）；
  - Host（ESXi）：取 `canonical.fields.attributes.cpu_threads.value`（线程数）；
  - 其它：取 `canonical.fields.hardware.cpu_count.value`。
- `memoryBytes`：取 `canonical.fields.hardware.memory_bytes.value`（bytes）。
- `totalDiskBytes`：
  - VM：`canonical.fields.hardware.disks.value[].size_bytes` 求和；
  - Host：优先取 `canonical.fields.attributes.disk_total_bytes.value`（bytes，本地物理盘总量）；缺失时可返回 `null`/`-`（由 UI 缺失策略决定）。

### 6.1A 更新 Asset（机器名覆盖）

**PUT** `/api/v1/assets/:assetUuid`

**权限**：仅管理员（admin-only）。

**请求体**：

```json
{ "machineNameOverride": "app-01" }
```

- `machineNameOverride`：
  - `string`：设置覆盖值（会 trim；空串会被视为清空）
  - `null`：清空覆盖值（回退展示采集值）

**成功响应**（200）：

```json
{
  "data": { "assetUuid": "a_123", "machineNameOverride": "app-01" },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

### 6.2 获取 Asset 详情

**GET** `/api/v1/assets/:assetUuid`

**权限**：user/admin 均可访问。

**成功响应**（200）：

```json
{
  "data": {
    "assetUuid": "a_123",
    "assetType": "vm",
    "displayName": "vm-app-01",
    "status": "in_service",
    "canonical": {
      "version": "canonical-v1",
      "fields": {
        "identity": {
          "hostname": {
            "value": "vm-app-01",
            "sources": [{ "sourceId": "src_123", "runId": "run_456" }],
            "conflict": false
          }
        },
        "network": {
          "ip_addresses": {
            "value": ["10.10.1.23"],
            "sources": [{ "sourceId": "src_123", "runId": "run_456" }]
          }
        }
      },
      "relations": {
        "outgoing": [
          {
            "type": "runs_on",
            "to": { "assetUuid": "h_456", "assetType": "host", "displayName": "esxi-01" },
            "sourceId": "src_123"
          }
        ]
      }
    },
    "sourceLinks": [
      {
        "linkId": "link_001",
        "sourceId": "src_123",
        "sourceName": "vcenter-prod",
        "externalKind": "vm",
        "externalId": "vm-100",
        "presenceStatus": "present",
        "lastSeenAt": "2026-01-26T02:15:00Z"
      }
    ],
    "createdAt": "2026-01-01T00:00:00Z",
    "updatedAt": "2026-01-26T02:15:00Z"
  },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

### 6.3 获取 Asset 来源明细

**GET** `/api/v1/assets/:assetUuid/source-records`

**权限**：user/admin 均可访问（仅 normalized；不含 raw）。

**查询参数**：

| 参数       | 类型   | 说明        |
| ---------- | ------ | ----------- |
| `sourceId` | string | 按来源过滤  |
| `runId`    | string | 按 Run 过滤 |

**成功响应**（200）：

```json
{
  "data": [
    {
      "recordId": "rec_001",
      "runId": "run_456",
      "sourceId": "src_123",
      "sourceName": "vcenter-prod",
      "collectedAt": "2026-01-26T02:15:00Z",
      "normalized": {
        "version": "normalized-v1",
        "kind": "vm",
        "identity": { "hostname": "vm-app-01" },
        "network": { "ip_addresses": ["10.10.1.23"] }
      }
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

### 6.4 获取 Asset 关系链

**GET** `/api/v1/assets/:assetUuid/relations`

**权限**：user/admin 均可访问。

**成功响应**（200）：

```json
{
  "data": {
    "assetUuid": "a_123",
    "assetType": "vm",
    "displayName": "vm-app-01",
    "outgoing": [
      {
        "type": "runs_on",
        "to": {
          "assetUuid": "h_456",
          "assetType": "host",
          "displayName": "esxi-01",
          "outgoing": [
            {
              "type": "member_of",
              "to": {
                "assetUuid": "c_789",
                "assetType": "cluster",
                "displayName": "cluster-prod"
              }
            }
          ]
        },
        "sourceId": "src_123",
        "status": "active"
      }
    ],
    "missing": []
  },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

> 注意：`missing` 数组用于说明缺边原因（如 "来源不提供"/"权限不足"）。

### 6.4A 获取 Asset 历史（时间线）（M12）

**GET** `/api/v1/assets/:assetUuid/history`

**权限**：user/admin 均可访问。

**查询参数**：

| 参数     | 类型   | 说明                                                                                                |
| -------- | ------ | --------------------------------------------------------------------------------------------------- |
| `limit`  | number | 返回条数（默认 20；最大 100）                                                                       |
| `cursor` | string | 游标（opaque；来自上一次响应的 `nextCursor`）                                                       |
| `types`  | string | 事件类型过滤（逗号分隔）：`collect.changed,ledger_fields.changed,asset.merged,asset.status_changed` |

**成功响应**（200）：

```json
{
  "data": {
    "items": [
      {
        "eventId": "ev_123",
        "assetUuid": "a_123",
        "sourceAssetUuid": null,
        "eventType": "collect.changed",
        "occurredAt": "2026-01-26T02:15:00Z",
        "title": "采集变化",
        "summary": { "changes": [{ "key": "identity.hostname", "before": "a", "after": "b" }] },
        "refs": { "runId": "run_456" }
      }
    ],
    "nextCursor": "opaque_cursor"
  },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

约束：

- cursor 分页按 `occurredAt desc, id desc` 排序。
- 若资产发生合并，主资产的 history 会包含被合并资产的事件，并用 `sourceAssetUuid` 标注来源资产 UUID（用于 UI 标记“来自合并资产”）。

### 6.5 获取 SourceRecord raw payload（管理员）

**GET** `/api/v1/source-records/:recordId/raw`

**权限**：仅管理员可访问；访问动作必须记录审计（audit_event）。

**成功响应**（200）：

```json
{
  "data": {
    "recordId": "rec_001",
    "runId": "run_456",
    "sourceId": "src_123",
    "collectedAt": "2026-01-26T02:15:00Z",
    "rawMeta": {
      "rawHash": "sha256:...",
      "rawCompression": "zstd",
      "rawSizeBytes": 12345
    },
    "rawPayload": { "opaque": "json" }
  },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

> 注意：raw 展示必须脱敏可能的敏感字段（例如 `password/token/secret` 等），且不得包含任何来源凭证明文。

### 6.6 台账字段（ledger-fields-v1：source / override / effective）

> 说明：台账字段为固定字段集（ledger-fields-v1），字段值采用三态：
>
> - `source`：来源值（由 SolarWinds 手动同步写入）
> - `override`：手工覆盖值（单资产编辑/批量设置写入）
> - `effective`：生效值，统一口径 `override ?? source`

补充规则：

- `override` 写入空串会归一化为 `null`（表示取消覆盖，回退来源值）。
- SolarWinds 同步只更新 `source`，不会修改 `override`。
- 本期仅以下 6 个字段接入 SolarWinds 来源映射：`region/systemLevel/company/systemCategory/department/bizOwner`。

#### 6.6.1 更新单资产台账覆盖值（管理员）

**PUT** `/api/v1/assets/:assetUuid/ledger-fields`

**权限**：仅管理员可访问；变更动作必须记录审计（`asset.ledger_fields_saved`）。

**请求体**：

```json
{
  "ledgerFieldOverrides": {
    "company": "Example Corp",
    "department": "SRE",
    "systemLevel": "一般系统",
    "fixedAssetNo": null
  }
}
```

**成功响应**（200）：

```json
{
  "data": {
    "assetUuid": "a_123",
    "updatedKeys": ["company", "department", "systemLevel", "fixedAssetNo"],
    "ledgerFields": {
      "company": { "source": "浙江正泰电器股份有限公司", "override": "Example Corp", "effective": "Example Corp" },
      "department": { "source": "IT共享资源中心", "override": "SRE", "effective": "SRE" },
      "systemLevel": { "source": "一般系统", "override": "一般系统", "effective": "一般系统" },
      "fixedAssetNo": { "source": null, "override": null, "effective": null }
    }
  },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

**常见错误码**

- 400：`CONFIG_LEDGER_FIELD_KEY_INVALID`
- 400：`CONFIG_LEDGER_FIELD_ASSET_TYPE_MISMATCH`
- 400：`CONFIG_LEDGER_FIELD_VALUE_INVALID`
- 403：`AUTH_FORBIDDEN`

#### 6.6.2 批量设置台账覆盖值（管理员，当前页勾选）

**POST** `/api/v1/assets/ledger-fields/bulk-set`

**权限**：仅管理员可访问；变更动作必须记录审计（`asset.ledger_fields_bulk_set`）。

**请求体**：

```json
{
  "assetUuids": ["a_1", "a_2"],
  "key": "company",
  "value": "Example Corp"
}
```

说明：该接口只写 `override` 层；`value = null` 表示清空覆盖并回退到 `source`。

**成功响应**（200）：

```json
{
  "data": { "updated": 2 },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

**常见错误码**

- 400：`CONFIG_LEDGER_FIELD_LIMIT_EXCEEDED`（N>100）
- 400：`CONFIG_LEDGER_FIELD_KEY_INVALID`
- 400：`CONFIG_LEDGER_FIELD_ASSET_TYPE_MISMATCH`
- 400：`CONFIG_LEDGER_FIELD_VALUE_INVALID`
- 403：`AUTH_FORBIDDEN`

#### 6.6.3 获取台账筛选候选值（effective 口径）

**GET** `/api/v1/assets/ledger-fields/options`

**权限**：user/admin 均可访问。

**成功响应**（200）：

```json
{
  "data": {
    "regions": ["温州"],
    "companies": ["浙江正泰电器股份有限公司"],
    "departments": ["IT共享资源中心"],
    "systemCategories": ["大数据（测试）"],
    "systemLevels": ["一般系统"],
    "bizOwners": ["王逸"],
    "osNames": ["Windows Server 2019"],
    "brands": ["Dell Inc."],
    "models": ["PowerEdge R740"]
  },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

#### 6.6.4 SolarWinds 手动同步（来源值写入）

**POST** `/api/v1/assets/:assetUuid/solarwinds/collect`

当返回 `status = "ok"` 时，响应中新增：

- `ledgerFieldSources`：本次同步后的来源值快照（可能为 `null`，表示本次来源同步被跳过）
- `warnings`：来源同步告警列表（例如 `ledger.source_sync_skipped`、`ledger.source_sync_value_invalid`）

说明：

- 该接口始终以“监控信号采集”为主流程；台账来源同步是 best-effort 附带动作。
- 即使 `warnings` 非空，只要 `status = "ok"`，采集主流程仍视为成功。

### 6.7 导出全量台账（CSV）（管理员）

> 说明：导出采用异步任务；下载即失效（首次下载成功后立即失效，后续下载返回 410 `CONFIG_EXPORT_EXPIRED`）。

**常见错误码**

- 401：`AUTH_UNAUTHORIZED`（未登录/会话失效）
- 403：`AUTH_FORBIDDEN`（非管理员）
- 404：`CONFIG_EXPORT_NOT_FOUND`（导出任务不存在）
- 410：`CONFIG_EXPORT_EXPIRED`（导出文件已下载失效）

#### 6.7.1 创建导出任务

**POST** `/api/v1/exports/asset-ledger`

**权限**：仅管理员可访问；导出动作必须记录审计（audit_event，event_type=`asset.ledger_exported`）。

**请求体（v1）**：

```json
{
  "format": "csv",
  "version": "asset-ledger-export-v1"
}
```

**成功响应**（201）：

```json
{
  "data": {
    "exportId": "exp_123",
    "status": "Queued"
  },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

#### 6.7.2 查询导出任务状态

**GET** `/api/v1/exports/asset-ledger/:exportId`

**成功响应**（200）：

```json
{
  "data": {
    "exportId": "exp_123",
    "status": "Succeeded",
    "createdAt": "2026-01-31T12:00:00Z",
    "startedAt": "2026-01-31T12:00:01Z",
    "finishedAt": "2026-01-31T12:00:05Z",
    "rowCount": 1234,
    "fileName": "asset-ledger-export-20260131-120005.csv",
    "fileSizeBytes": 456789
  },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

#### 6.7.3 下载 CSV（下载即失效）

**GET** `/api/v1/exports/asset-ledger/:exportId/download`

**权限**：仅管理员可访问；下载成功后导出文件立即失效（后续下载返回 410）。

**成功响应**（200）：

- `Content-Type: text/csv; charset=utf-8`
- `Content-Disposition: attachment; filename="asset-ledger-export-YYYYMMDD-HHmmss.csv"`
- body：CSV 文件内容（UTF-8，不带 BOM）

## 7. OpenAPI 文档

### 7.1 获取 OpenAPI JSON

**GET** `/api/openapi.json`

### 7.2 Swagger UI

**GET** `/api/docs`

> 注意：生产环境建议仅管理员可访问。

## 8. 重复中心（Duplicate Candidates）

> 说明：本节为 M5 重复资产治理的后端 API（列表/详情/Ignore）。候选生成规则见：`docs/design/asset-ledger-dup-rules-v1.md`。

### 8.1 候选列表

**GET** `/api/v1/duplicate-candidates`

**权限**：仅管理员（admin-only）。

**Query 参数**：

| 参数         | 类型   | 默认值 | 说明                 |
| ------------ | ------ | ------ | -------------------- | ------------------------------------------------ | ------- |
| `page`       | number | 1      | 页码（从 1 开始）    |
| `pageSize`   | number | 20     | 每页条数（最大 100） |
| `status`     | string | open   | `open                | ignored                                          | merged` |
| `assetType`  | string | -      | `vm                  | host`                                            |
| `confidence` | string | -      | `High                | Medium`；`High`=score>=90；`Medium`=70<=score<90 |

**成功响应**（200）：

```json
{
  "data": [
    {
      "candidateId": "dc_1",
      "status": "open",
      "score": 95,
      "confidence": "High",
      "lastObservedAt": "2026-01-31T00:00:00.000Z",
      "assetA": {
        "assetUuid": "uuid_a",
        "assetType": "vm",
        "status": "in_service",
        "displayName": "vm-a",
        "lastSeenAt": null
      },
      "assetB": {
        "assetUuid": "uuid_b",
        "assetType": "vm",
        "status": "offline",
        "displayName": "vm-b",
        "lastSeenAt": null
      }
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

**常见错误码**：

- 401：`AUTH_UNAUTHORIZED`
- 403：`AUTH_FORBIDDEN`

### 8.2 候选详情

**GET** `/api/v1/duplicate-candidates/:candidateId`

**权限**：仅管理员（admin-only）。

**成功响应**（200，示例摘要）：

```json
{
  "data": {
    "candidateId": "dc_1",
    "status": "open",
    "score": 90,
    "confidence": "High",
    "reasons": {
      "version": "dup-rules-v1",
      "matched_rules": [
        /* ... */
      ]
    },
    "assetA": {
      "assetUuid": "uuid_a",
      "assetType": "vm",
      "sourceLinks": [
        /* ... */
      ]
    },
    "assetB": {
      "assetUuid": "uuid_b",
      "assetType": "vm",
      "sourceLinks": [
        /* ... */
      ]
    }
  },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

**常见错误码**：

- 404：`CONFIG_DUPLICATE_CANDIDATE_NOT_FOUND`

### 8.3 Ignore（永久忽略）

**POST** `/api/v1/duplicate-candidates/:candidateId/ignore`

**权限**：仅管理员（admin-only）。

**请求体**：

```json
{ "reason": "not duplicate" }
```

> 说明：`reason` 可选；空字符串视为未提供（按 null 处理）。

**成功响应**（200）：

```json
{
  "data": {
    "candidateId": "dc_1",
    "status": "ignored",
    "ignoredAt": "2026-01-31T12:00:00Z",
    "ignoreReason": "not duplicate"
  },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

**审计**：

- 写入 `audit_event`：`eventType=duplicate_candidate.ignored`
- payload（最小集）：`candidateId/assetUuidA/assetUuidB/ignoreReason/requestId`

**常见错误码**：

- 400：`CONFIG_INVALID_REQUEST`
- 404：`CONFIG_DUPLICATE_CANDIDATE_NOT_FOUND`

## 9. 资产合并（Merge）

> 目标：支持管理员将重复资产合并为单一主资产；合并后从资产默认隐藏，来源明细/关系并入主资产，并写审计。

### 9.1 合并（primary_wins）

**POST** `/api/v1/assets/:primaryAssetUuid/merge`

**权限**：仅管理员（admin-only）。

**请求体**：

```json
{
  "mergedAssetUuids": ["uuid_b"],
  "conflictStrategy": "primary_wins"
}
```

> 说明：
>
> - `mergedAssetUuids`：至少 1 个；必须与主资产同 `assetType`。
> - `conflictStrategy`：当前仅支持 `primary_wins`（冲突时以主资产为准）。
> - VM 合并门槛（强约束）：仅允许将 `offline` 的 VM 合并到 `in_service` 的 VM（仅关机不等于下线）。

**成功响应**（200）：

```json
{
  "data": {
    "primaryAssetUuid": "uuid_a",
    "mergedAssetUuids": ["uuid_b"],
    "conflictStrategy": "primary_wins",
    "mergeAuditIds": ["ma_1"],
    "migrated": {
      "assetsUpdatedCount": 1,
      "sourceLinksMovedCount": 10,
      "sourceRecordsMovedCount": 120,
      "relationsRewrittenCount": 2,
      "dedupedRelationsCount": 0,
      "duplicateCandidatesUpdatedCount": 3
    }
  },
  "meta": { "requestId": "req_xxx", "timestamp": "..." }
}
```

**审计**：

- 写入 `merge_audit`（每个被合并资产 1 条；summary 含 requestId + migrated 统计）
- 写入 `audit_event`：`eventType=asset.merged`

**常见错误码**：

- 400：`CONFIG_INVALID_REQUEST`
- 400：`CONFIG_ASSET_MERGE_ASSET_TYPE_MISMATCH`
- 400：`CONFIG_ASSET_MERGE_CYCLE_DETECTED`
- 400：`CONFIG_ASSET_MERGE_VM_REQUIRES_OFFLINE`
- 404：`CONFIG_ASSET_NOT_FOUND`
