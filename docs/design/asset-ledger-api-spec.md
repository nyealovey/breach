# 资产台账 API 规范

版本：v1.0
日期：2026-01-27

## 文档简介

本文档定义资产台账系统的 REST API 规范，包括请求/响应格式、错误处理、分页约定等，确保前后端对齐。

- 适用读者：前端开发、后端开发、API 消费者。
- 关联文档：
  - PRD：`docs/prds/asset-ledger-v1.0-prd.md`
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
  "mode": "collect"
}
```

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
- 404：`CONFIG_ASSET_NOT_FOUND`（资产不存在）

### 6.1 获取 Asset 列表

**GET** `/api/v1/assets`

**查询参数**：

| 参数         | 类型   | 说明                                                                                                                                     |
| ------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `page`       | number | 分页页码（从 1 开始）                                                                                                                    |
| `pageSize`   | number | 每页条数                                                                                                                                 |
| `asset_type` | string | 按类型过滤（vm/host/cluster）                                                                                                            |
| `source_id`  | string | 按来源过滤                                                                                                                               |
| `q`          | string | 关键字搜索（覆盖：主机名/虚拟机名、externalId、uuid 等文本字段；空格分词 AND；不区分大小写；模糊包含匹配；不做中文分词/同义词/拼写容错） |

**关键字搜索（q）语义**：

- 空格分词：将 `q` 按空白字符切分为多个词（连续空白视为一个分隔）。
- AND：每个词都必须命中。
- 匹配方式：不区分大小写的“包含”匹配（substring）。
- 范围：仅对主机名/虚拟机名（display_name）、externalId、uuid 等文本字段生效。
- 空值处理：`q` 为空或仅包含空白时，视为未提供该参数。

**成功响应**（200）：

```json
{
  "data": [
    {
      "assetUuid": "a_123",
      "assetType": "vm",
      "status": "in_service",
      "hostName": "esxi-01",
      "vmName": "vm-app-01",
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

### 6.2 获取 Asset 详情

**GET** `/api/v1/assets/:assetUuid`

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

## 7. OpenAPI 文档

### 7.1 获取 OpenAPI JSON

**GET** `/api/openapi.json`

### 7.2 Swagger UI

**GET** `/api/docs`

> 注意：生产环境建议仅管理员可访问。
