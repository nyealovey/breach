# 资产台账错误码规范（Error Codes）

版本：v1.3
日期：2026-01-31

## 文档简介

本文档为资产台账系统提供 **稳定的错误码（`error.code`）注册表** 与落地口径，用于统一：

- Web 请求宽事件（`event_type=http.request`）的 `error.*`
- Worker/Scheduler 域事件（例如 `event_type=run.finished`）的 `error.*`
- 插件输出 `errors[]`（最终落库到 `run.errors`）的 `code/category/retryable`

关联文档：

- PRD（vCenter MVP v1.0）：`docs/mvp/prds/asset-ledger-v1.0-prd.md`
- 日志规范：`docs/design/asset-ledger-logging-spec.md`
- 采集插件契约：`docs/design/asset-ledger-collector-reference.md`

> 范围说明：本错误码表以 **vCenter MVP v1.0** 为基线，并按后续需求持续扩展（只增不改）。

## 1. 字段口径（强约束）

### 1.1 `error.code`

- 稳定、可枚举的字符串；建议使用 `UPPER_SNAKE_CASE`。
- **同一个 code 的语义不可漂移**（只加不改；需要变更语义就新增 code）。
- 建议按层级/来源做前缀区分（例如 `AUTH_*`、`CONFIG_*`、`PLUGIN_*`、`VCENTER_*`），避免“同名但含义不同”。

### 1.2 `error.category`

必须从下列枚举选择（与日志规范对齐）：

`auth | permission | network | rate_limit | parse | config | unknown`

### 1.3 `error.retryable`

- 表示“按同样输入重试是否**可能**成功”（用于自动重试/Run UI 提示）。
- 当无法判断时，宁可设为 `false` 并在 `redacted_context` 补充“需要人工介入的线索”。

### 1.4 `error.message` 与 `error.redacted_context`

- `message` 必须可读且**脱敏**（不得包含任何明文凭证/Token/AK/SK/密码）。
- `redacted_context` 只允许放安全上下文（例如 endpoint host、HTTP status、trace_id、stderr_excerpt 截断、source_id/run_id/mode 等）。

## 2. 错误码注册表（基线 + 增量）

> 表内 “默认 HTTP 状态码”仅适用于 `http.request`；Worker/插件场景不适用可留空。

| error.code                              | 层级   | category   | retryable | 默认 HTTP 状态码 | 说明（MVP 语义）                                                                                                 |
| --------------------------------------- | ------ | ---------- | --------- | ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| AUTH_UNAUTHORIZED                       | web    | auth       | false     | 401              | 未登录/会话无效（无有效 session）                                                                                |
| AUTH_INVALID_CREDENTIALS                | web    | auth       | false     | 401              | 登录失败（用户名/密码错误）                                                                                      |
| AUTH_FORBIDDEN                          | web    | permission | false     | 403              | 已登录但无权限（v1.0 仅 admin；预留）                                                                            |
| AUTH_SESSION_EXPIRED                    | web    | auth       | false     | 401              | 会话过期（session 失效）                                                                                         |
| CONFIG_INVALID_REQUEST                  | web    | config     | false     | 400              | 请求参数校验失败（Zod/表单校验）                                                                                 |
| CONFIG_LEDGER_FIELD_KEY_INVALID         | web    | config     | false     | 400              | 台账字段 key 非法/不允许                                                                                         |
| CONFIG_LEDGER_FIELD_ASSET_TYPE_MISMATCH | web    | config     | false     | 400              | 台账字段与资产类型不匹配（例如将 host 字段写入 vm）                                                              |
| CONFIG_LEDGER_FIELD_VALUE_INVALID       | web    | config     | false     | 400              | 台账字段值格式非法（date/ipv4 等）                                                                               |
| CONFIG_LEDGER_FIELD_LIMIT_EXCEEDED      | web    | config     | false     | 400              | 台账字段批量更新超限（N>100）                                                                                    |
| CONFIG_INVALID_TIMEZONE                 | web    | config     | false     | 400              | 调度组时区非法（非 IANA TZ）                                                                                     |
| CONFIG_INVALID_HHMM                     | web    | config     | false     | 400              | 调度组触发时间非法（非 `HH:mm`）                                                                                 |
| CONFIG_SOURCE_NOT_FOUND                 | web    | config     | false     | 404              | 来源不存在（Source 不存在）                                                                                      |
| CONFIG_CREDENTIAL_NOT_FOUND             | web    | config     | false     | 404              | 凭据不存在（Credential 不存在）                                                                                  |
| CONFIG_RUN_NOT_FOUND                    | web    | config     | false     | 404              | Run 不存在                                                                                                       |
| CONFIG_ASSET_NOT_FOUND                  | web    | config     | false     | 404              | 资产不存在                                                                                                       |
| CONFIG_ASSET_MERGE_ASSET_TYPE_MISMATCH  | web    | config     | false     | 400              | 合并资产类型不一致（禁止跨 asset_type 合并）                                                                     |
| CONFIG_ASSET_MERGE_CYCLE_DETECTED       | web    | config     | false     | 400              | 检测到合并环/链冲突（禁止产生环）                                                                                |
| CONFIG_ASSET_MERGE_VM_REQUIRES_OFFLINE  | web    | config     | false     | 400              | VM 合并门槛未满足：仅允许将 offline VM 合并到 in_service VM（仅关机不等于下线）                                  |
| CONFIG_SOURCE_RECORD_NOT_FOUND          | web    | config     | false     | 404              | 源记录不存在（SourceRecord 不存在）                                                                              |
| CONFIG_PREFERENCE_NOT_FOUND             | web    | config     | false     | 404              | 用户偏好不存在（preference key 未设置）                                                                          |
| CONFIG_EXPORT_NOT_FOUND                 | web    | config     | false     | 404              | 导出任务不存在（Export 不存在）                                                                                  |
| CONFIG_EXPORT_EXPIRED                   | web    | config     | false     | 410              | 导出文件已下载失效（下载即失效策略）                                                                             |
| CONFIG_SCHEDULE_GROUP_NOT_FOUND         | web    | config     | false     | 404              | 调度组不存在                                                                                                     |
| CONFIG_DUPLICATE_NAME                   | web    | config     | false     | 409              | 名称重复导致冲突                                                                                                 |
| CONFIG_RESOURCE_CONFLICT                | web    | config     | false     | 409              | 资源冲突（例如存在依赖/存在活动 Run）                                                                            |
| PLUGIN_EXEC_FAILED                      | worker | unknown    | false     |                  | 插件进程无法启动（文件不存在/权限/exec 失败）                                                                    |
| PLUGIN_TIMEOUT                          | worker | unknown    | true      |                  | 插件执行超时（超出 `ASSET_LEDGER_PLUGIN_TIMEOUT_MS`）                                                            |
| PLUGIN_EXIT_NONZERO                     | worker | unknown    | false     |                  | 插件退出码非 0 且 `errors[]` 不可用（缺失/无法解析）                                                             |
| PLUGIN_OUTPUT_INVALID_JSON              | worker | parse      | false     |                  | 插件 stdout 不是合法 JSON（包含被截断、混入非 JSON 等情况）                                                      |
| PLUGIN_SCHEMA_VERSION_UNSUPPORTED       | worker | parse      | false     |                  | `schema_version` 不被核心支持（请求/响应契约版本不匹配）                                                         |
| PLUGIN_RESPONSE_INVALID                 | worker | parse      | false     |                  | 插件响应缺少必填字段/结构不符合契约（例如缺少 `assets[]`）                                                       |
| SCHEMA_VALIDATION_FAILED                | worker | parse      | false     |                  | `normalized-v1`/canonical 输出 schema 校验失败                                                                   |
| INVENTORY_INCOMPLETE                    | worker | parse      | false     |                  | collect 未提供完整清单（`inventory_complete=false`）                                                             |
| INVENTORY_RELATIONS_EMPTY               | worker | parse      | false     |                  | 虚拟化类来源关系清单为空（`relations=0`），会导致关系链不可用（禁止伪成功）                                      |
| RAW_PERSIST_FAILED                      | worker | unknown    | true      |                  | raw/元数据写入失败（raw 永久保留语义无法满足）                                                                   |
| DB_WRITE_FAILED                         | worker | unknown    | true      |                  | 数据库写入失败（Run/source_record/relation 等持久化失败）                                                        |
| DB_READ_FAILED                          | worker | unknown    | true      |                  | 数据库读取失败                                                                                                   |
| VCENTER_CONFIG_INVALID                  | plugin | config     | false     |                  | vCenter 输入配置非法（endpoint 缺失/格式不合法等）                                                               |
| VCENTER_AUTH_FAILED                     | plugin | auth       | false     |                  | vCenter 认证失败（用户名/密码错误）                                                                              |
| VCENTER_PERMISSION_DENIED               | plugin | permission | false     |                  | vCenter 权限不足（无法列举 inventory/读取必要字段）                                                              |
| VCENTER_NETWORK_ERROR                   | plugin | network    | true      |                  | vCenter 网络/连接失败（DNS/TCP/超时等）                                                                          |
| VCENTER_TLS_ERROR                       | plugin | network    | false     |                  | TLS 握手/证书失败（与 v1.0“允许自签名”的实现策略相关）                                                           |
| VCENTER_RATE_LIMIT                      | plugin | rate_limit | true      |                  | vCenter API 限流/节流                                                                                            |
| VCENTER_PARSE_ERROR                     | plugin | parse      | false     |                  | vCenter 响应解析失败/协议不兼容                                                                                  |
| VCENTER_API_VERSION_UNSUPPORTED         | plugin | parse      | false     |                  | vCenter API 版本/能力不支持（需升级 driver 或明确失败）                                                          |
| VCENTER_HOST_DETAIL_NOT_FOUND           | plugin | network    | false     |                  | **DEPRECATED**：不再允许降级。应改为以 `VCENTER_API_VERSION_UNSUPPORTED` 失败并提示选择正确版本范围/升级 vCenter |
| PVE_CONFIG_INVALID                      | plugin | config     | false     |                  | PVE 输入配置非法（endpoint/regions/认证方式等）                                                                  |
| PVE_AUTH_FAILED                         | plugin | auth       | false     |                  | PVE 认证失败（Token/用户名密码错误）                                                                             |
| PVE_PERMISSION_DENIED                   | plugin | permission | false     |                  | PVE 权限不足（无法枚举 inventory/读取必要字段）                                                                  |
| PVE_NETWORK_ERROR                       | plugin | network    | true      |                  | PVE 网络/连接失败（DNS/TCP/超时等）                                                                              |
| PVE_TLS_ERROR                           | plugin | network    | false     |                  | PVE TLS/证书失败                                                                                                 |
| PVE_RATE_LIMIT                          | plugin | rate_limit | true      |                  | PVE API 限流/节流                                                                                                |
| PVE_PARSE_ERROR                         | plugin | parse      | false     |                  | PVE 响应解析失败/协议不兼容                                                                                      |
| HYPERV_CONFIG_INVALID                   | plugin | config     | false     |                  | Hyper-V 输入配置非法（endpoint/port/scope 等）                                                                   |
| HYPERV_AUTH_FAILED                      | plugin | auth       | false     |                  | Hyper-V 认证失败（用户名/密码/域错误）                                                                           |
| HYPERV_PERMISSION_DENIED                | plugin | permission | false     |                  | Hyper-V 权限不足（无法枚举 inventory/读取必要字段）                                                              |
| HYPERV_NETWORK_ERROR                    | plugin | network    | true      |                  | Hyper-V 网络/连接失败（DNS/TCP/超时等）                                                                          |
| HYPERV_TLS_ERROR                        | plugin | network    | false     |                  | Hyper-V TLS/证书失败                                                                                             |
| HYPERV_PARSE_ERROR                      | plugin | parse      | false     |                  | Hyper-V 响应解析失败/协议不兼容                                                                                  |
| ALIYUN_CONFIG_INVALID                   | plugin | config     | false     |                  | 阿里云输入配置非法（regions 缺失/格式不合法等）                                                                  |
| ALIYUN_AUTH_FAILED                      | plugin | auth       | false     |                  | 阿里云认证失败（AK/SK 或 STS Token 无效）                                                                        |
| ALIYUN_PERMISSION_DENIED                | plugin | permission | false     |                  | 阿里云权限不足（RAM 权限缺失）                                                                                   |
| ALIYUN_NETWORK_ERROR                    | plugin | network    | true      |                  | 阿里云网络/请求失败（DNS/TCP/超时等）                                                                            |
| ALIYUN_RATE_LIMIT                       | plugin | rate_limit | true      |                  | 阿里云 API 限流/节流                                                                                             |
| ALIYUN_PARSE_ERROR                      | plugin | parse      | false     |                  | 阿里云响应解析失败/协议不兼容                                                                                    |
| PHYSICAL_CONFIG_INVALID                 | plugin | config     | false     |                  | 物理机来源输入配置非法（endpoint/port/auth_type 等）                                                             |
| PHYSICAL_AUTH_FAILED                    | plugin | auth       | false     |                  | 物理机来源认证失败（SSH/WinRM 凭证错误）                                                                         |
| PHYSICAL_PERMISSION_DENIED              | plugin | permission | false     |                  | 物理机来源权限不足（无法读取必要字段）                                                                           |
| PHYSICAL_NETWORK_ERROR                  | plugin | network    | true      |                  | 物理机来源网络/连接失败（DNS/TCP/超时等）                                                                        |
| PHYSICAL_TLS_ERROR                      | plugin | network    | false     |                  | 物理机来源 TLS/证书失败（WinRM HTTPS 等）                                                                        |
| PHYSICAL_PARSE_ERROR                    | plugin | parse      | false     |                  | 物理机来源响应解析失败/协议不兼容                                                                                |
| INTERNAL_ERROR                          | common | unknown    | false     | 500              | 未分类内部错误                                                                                                   |
| INTERNAL_NOT_IMPLEMENTED                | common | unknown    | false     | 501              | 未实现功能                                                                                                       |

## 3. 落地规则（建议）

### 3.1 插件（errors[]）

- 插件失败时必须输出 `errors[]`（即使退出码非 0）。
- `errors[].code` 必须取自本表；如需扩展，先在本表新增。
- 同一个失败可输出多条 `errors[]`，但 **第一条** 建议作为“主错误”（UI/日志默认展示）。

### 3.2 Worker（run.finished）

- 若插件提供了 `errors[]`：优先使用第一条 error 填充 `error.*`（并落库到 `run.errors`）。
- 若插件未提供/不可解析：
  - 超时 → `PLUGIN_TIMEOUT`
  - 无法启动 → `PLUGIN_EXEC_FAILED`
  - stdout 非 JSON → `PLUGIN_OUTPUT_INVALID_JSON`
  - 其它非 0 → `PLUGIN_EXIT_NONZERO`
- 任一 raw/DB 持久化失败必须让 Run 失败（否则"可追溯"语义被破坏）。

## 4. 完整错误码枚举（TypeScript）

> 以下为 v1.x 完整错误码枚举，可直接用于代码生成。

```typescript
/**
 * 资产台账系统错误码枚举
 * @version v1.3
 */
export const ErrorCode = {
  // ========== Web 层（AUTH_* / CONFIG_*）==========
  AUTH_UNAUTHORIZED: 'AUTH_UNAUTHORIZED',
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_FORBIDDEN: 'AUTH_FORBIDDEN',
  AUTH_SESSION_EXPIRED: 'AUTH_SESSION_EXPIRED',

  CONFIG_INVALID_REQUEST: 'CONFIG_INVALID_REQUEST',
  CONFIG_LEDGER_FIELD_KEY_INVALID: 'CONFIG_LEDGER_FIELD_KEY_INVALID',
  CONFIG_LEDGER_FIELD_ASSET_TYPE_MISMATCH: 'CONFIG_LEDGER_FIELD_ASSET_TYPE_MISMATCH',
  CONFIG_LEDGER_FIELD_VALUE_INVALID: 'CONFIG_LEDGER_FIELD_VALUE_INVALID',
  CONFIG_LEDGER_FIELD_LIMIT_EXCEEDED: 'CONFIG_LEDGER_FIELD_LIMIT_EXCEEDED',
  CONFIG_INVALID_TIMEZONE: 'CONFIG_INVALID_TIMEZONE',
  CONFIG_INVALID_HHMM: 'CONFIG_INVALID_HHMM',
  CONFIG_SOURCE_NOT_FOUND: 'CONFIG_SOURCE_NOT_FOUND',
  CONFIG_CREDENTIAL_NOT_FOUND: 'CONFIG_CREDENTIAL_NOT_FOUND',
  CONFIG_RUN_NOT_FOUND: 'CONFIG_RUN_NOT_FOUND',
  CONFIG_ASSET_NOT_FOUND: 'CONFIG_ASSET_NOT_FOUND',
  CONFIG_ASSET_MERGE_ASSET_TYPE_MISMATCH: 'CONFIG_ASSET_MERGE_ASSET_TYPE_MISMATCH',
  CONFIG_ASSET_MERGE_CYCLE_DETECTED: 'CONFIG_ASSET_MERGE_CYCLE_DETECTED',
  CONFIG_ASSET_MERGE_VM_REQUIRES_OFFLINE: 'CONFIG_ASSET_MERGE_VM_REQUIRES_OFFLINE',
  CONFIG_SOURCE_RECORD_NOT_FOUND: 'CONFIG_SOURCE_RECORD_NOT_FOUND',
  CONFIG_PREFERENCE_NOT_FOUND: 'CONFIG_PREFERENCE_NOT_FOUND',
  CONFIG_EXPORT_NOT_FOUND: 'CONFIG_EXPORT_NOT_FOUND',
  CONFIG_EXPORT_EXPIRED: 'CONFIG_EXPORT_EXPIRED',
  CONFIG_SCHEDULE_GROUP_NOT_FOUND: 'CONFIG_SCHEDULE_GROUP_NOT_FOUND',
  CONFIG_DUPLICATE_NAME: 'CONFIG_DUPLICATE_NAME',
  CONFIG_RESOURCE_CONFLICT: 'CONFIG_RESOURCE_CONFLICT',

  // ========== Worker 层（PLUGIN_* / SCHEMA_* / DB_*）==========
  PLUGIN_EXEC_FAILED: 'PLUGIN_EXEC_FAILED',
  PLUGIN_TIMEOUT: 'PLUGIN_TIMEOUT',
  PLUGIN_EXIT_NONZERO: 'PLUGIN_EXIT_NONZERO',
  PLUGIN_OUTPUT_INVALID_JSON: 'PLUGIN_OUTPUT_INVALID_JSON',
  PLUGIN_SCHEMA_VERSION_UNSUPPORTED: 'PLUGIN_SCHEMA_VERSION_UNSUPPORTED',
  PLUGIN_RESPONSE_INVALID: 'PLUGIN_RESPONSE_INVALID',

  SCHEMA_VALIDATION_FAILED: 'SCHEMA_VALIDATION_FAILED',
  INVENTORY_INCOMPLETE: 'INVENTORY_INCOMPLETE',
  INVENTORY_RELATIONS_EMPTY: 'INVENTORY_RELATIONS_EMPTY',
  RAW_PERSIST_FAILED: 'RAW_PERSIST_FAILED',
  DB_WRITE_FAILED: 'DB_WRITE_FAILED',
  DB_READ_FAILED: 'DB_READ_FAILED',

  // ========== 插件层（VCENTER_*）==========
  VCENTER_CONFIG_INVALID: 'VCENTER_CONFIG_INVALID',
  VCENTER_AUTH_FAILED: 'VCENTER_AUTH_FAILED',
  VCENTER_PERMISSION_DENIED: 'VCENTER_PERMISSION_DENIED',
  VCENTER_NETWORK_ERROR: 'VCENTER_NETWORK_ERROR',
  VCENTER_TLS_ERROR: 'VCENTER_TLS_ERROR',
  VCENTER_RATE_LIMIT: 'VCENTER_RATE_LIMIT',
  VCENTER_PARSE_ERROR: 'VCENTER_PARSE_ERROR',
  VCENTER_API_VERSION_UNSUPPORTED: 'VCENTER_API_VERSION_UNSUPPORTED',
  VCENTER_HOST_DETAIL_NOT_FOUND: 'VCENTER_HOST_DETAIL_NOT_FOUND',

  // ========== 插件层（PVE_* / HYPERV_* / ALIYUN_* / PHYSICAL_*）==========
  PVE_CONFIG_INVALID: 'PVE_CONFIG_INVALID',
  PVE_AUTH_FAILED: 'PVE_AUTH_FAILED',
  PVE_PERMISSION_DENIED: 'PVE_PERMISSION_DENIED',
  PVE_NETWORK_ERROR: 'PVE_NETWORK_ERROR',
  PVE_TLS_ERROR: 'PVE_TLS_ERROR',
  PVE_RATE_LIMIT: 'PVE_RATE_LIMIT',
  PVE_PARSE_ERROR: 'PVE_PARSE_ERROR',

  HYPERV_CONFIG_INVALID: 'HYPERV_CONFIG_INVALID',
  HYPERV_AUTH_FAILED: 'HYPERV_AUTH_FAILED',
  HYPERV_PERMISSION_DENIED: 'HYPERV_PERMISSION_DENIED',
  HYPERV_NETWORK_ERROR: 'HYPERV_NETWORK_ERROR',
  HYPERV_TLS_ERROR: 'HYPERV_TLS_ERROR',
  HYPERV_PARSE_ERROR: 'HYPERV_PARSE_ERROR',

  ALIYUN_CONFIG_INVALID: 'ALIYUN_CONFIG_INVALID',
  ALIYUN_AUTH_FAILED: 'ALIYUN_AUTH_FAILED',
  ALIYUN_PERMISSION_DENIED: 'ALIYUN_PERMISSION_DENIED',
  ALIYUN_NETWORK_ERROR: 'ALIYUN_NETWORK_ERROR',
  ALIYUN_RATE_LIMIT: 'ALIYUN_RATE_LIMIT',
  ALIYUN_PARSE_ERROR: 'ALIYUN_PARSE_ERROR',

  PHYSICAL_CONFIG_INVALID: 'PHYSICAL_CONFIG_INVALID',
  PHYSICAL_AUTH_FAILED: 'PHYSICAL_AUTH_FAILED',
  PHYSICAL_PERMISSION_DENIED: 'PHYSICAL_PERMISSION_DENIED',
  PHYSICAL_NETWORK_ERROR: 'PHYSICAL_NETWORK_ERROR',
  PHYSICAL_TLS_ERROR: 'PHYSICAL_TLS_ERROR',
  PHYSICAL_PARSE_ERROR: 'PHYSICAL_PARSE_ERROR',

  // ========== 通用（INTERNAL_*）==========
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  INTERNAL_NOT_IMPLEMENTED: 'INTERNAL_NOT_IMPLEMENTED',
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];
```

## 5. 错误码分配规则

### 5.1 命名规范

| 前缀        | 层级   | 说明                          |
| ----------- | ------ | ----------------------------- |
| `AUTH_`     | Web    | 认证相关（登录、会话）        |
| `CONFIG_`   | Web    | 配置/参数校验相关             |
| `PLUGIN_`   | Worker | 插件执行相关                  |
| `SCHEMA_`   | Worker | Schema 校验相关               |
| `DB_`       | Worker | 数据库操作相关                |
| `RAW_`      | Worker | Raw 存储相关                  |
| `VCENTER_`  | Plugin | vCenter 插件专用              |
| `PVE_`      | Plugin | PVE 插件专用（预留）          |
| `HYPERV_`   | Plugin | Hyper-V 插件专用（预留）      |
| `ALIYUN_`   | Plugin | 阿里云插件专用（预留）        |
| `PHYSICAL_` | Plugin | 物理机/第三方插件专用（预留） |
| `INTERNAL_` | 通用   | 内部错误/未分类               |

### 5.2 新增错误码流程

1. **确定层级**：Web / Worker / Plugin
2. **选择前缀**：按上表选择合适前缀
3. **命名**：`{PREFIX}_{ACTION}_{REASON}`，使用 `UPPER_SNAKE_CASE`
4. **注册**：在本文档第 2 节表格中新增条目
5. **实现**：在代码中添加枚举值与处理逻辑
6. **i18n**：在消息模板中添加对应翻译

### 5.3 错误码编号范围（预留）

> 若未来需要数字编号（用于外部系统对接），建议按以下范围分配：

| 范围      | 层级           | 说明                 |
| --------- | -------------- | -------------------- |
| 1000-1999 | Web/AUTH       | 认证与权限           |
| 2000-2999 | Web/CONFIG     | 配置与参数           |
| 3000-3999 | Worker/PLUGIN  | 插件执行             |
| 4000-4999 | Worker/SCHEMA  | Schema 校验          |
| 5000-5999 | Worker/DB      | 数据库操作           |
| 6000-6999 | Plugin/VCENTER | vCenter 插件         |
| 7000-7999 | Plugin/PVE     | PVE 插件（预留）     |
| 8000-8999 | Plugin/HYPERV  | Hyper-V 插件（预留） |
| 9000-9999 | INTERNAL       | 内部错误             |

## 6. 国际化（i18n）支持

### 6.1 消息模板结构

```typescript
/**
 * 错误消息模板（支持变量插值）
 */
export const ErrorMessages: Record<
  ErrorCodeType,
  {
    zh: string;
    en: string;
  }
> = {
  AUTH_UNAUTHORIZED: {
    zh: '未登录或会话已失效，请重新登录',
    en: 'Not authenticated or session expired, please login again',
  },
  AUTH_INVALID_CREDENTIALS: {
    zh: '用户名或密码错误',
    en: 'Invalid username or password',
  },
  AUTH_FORBIDDEN: {
    zh: '权限不足，无法执行此操作',
    en: 'Permission denied, cannot perform this action',
  },
  AUTH_SESSION_EXPIRED: {
    zh: '会话已过期，请重新登录',
    en: 'Session expired, please login again',
  },
  CONFIG_INVALID_REQUEST: {
    zh: '请求参数校验失败：{{details}}',
    en: 'Request validation failed: {{details}}',
  },
  CONFIG_LEDGER_FIELD_KEY_INVALID: {
    zh: '台账字段非法：{{field_key}}',
    en: 'Invalid ledger field: {{field_key}}',
  },
  CONFIG_LEDGER_FIELD_ASSET_TYPE_MISMATCH: {
    zh: '台账字段与资产类型不匹配：{{asset_type}} / {{field_key}}',
    en: 'Ledger field asset type mismatch: {{asset_type}} / {{field_key}}',
  },
  CONFIG_LEDGER_FIELD_VALUE_INVALID: {
    zh: '台账字段值格式非法：{{field_key}}',
    en: 'Invalid ledger field value: {{field_key}}',
  },
  CONFIG_LEDGER_FIELD_LIMIT_EXCEEDED: {
    zh: '批量更新超限：{{limit}}',
    en: 'Bulk update limit exceeded: {{limit}}',
  },
  CONFIG_INVALID_TIMEZONE: {
    zh: '时区格式非法，请使用 IANA 时区格式（如 Asia/Shanghai）',
    en: 'Invalid timezone format, please use IANA timezone (e.g., Asia/Shanghai)',
  },
  CONFIG_INVALID_HHMM: {
    zh: '触发时间格式非法，请使用 HH:mm 格式（如 08:30）',
    en: 'Invalid trigger time format, please use HH:mm (e.g., 08:30)',
  },
  CONFIG_SOURCE_NOT_FOUND: {
    zh: '来源不存在：{{source_id}}',
    en: 'Source not found: {{source_id}}',
  },
  CONFIG_CREDENTIAL_NOT_FOUND: {
    zh: '凭据不存在：{{credential_id}}',
    en: 'Credential not found: {{credential_id}}',
  },
  CONFIG_RUN_NOT_FOUND: {
    zh: '采集批次不存在：{{run_id}}',
    en: 'Run not found: {{run_id}}',
  },
  CONFIG_ASSET_NOT_FOUND: {
    zh: '资产不存在：{{asset_uuid}}',
    en: 'Asset not found: {{asset_uuid}}',
  },
  CONFIG_ASSET_MERGE_ASSET_TYPE_MISMATCH: {
    zh: '合并失败：资产类型不一致',
    en: 'Merge failed: asset types mismatch',
  },
  CONFIG_ASSET_MERGE_CYCLE_DETECTED: {
    zh: '合并失败：检测到合并环/链冲突',
    en: 'Merge failed: merge cycle detected',
  },
  CONFIG_ASSET_MERGE_VM_REQUIRES_OFFLINE: {
    zh: '合并失败：VM 仅允许“offline → in_service”合并（仅关机不等于下线）',
    en: 'Merge failed: VM merge requires offline -> in_service (poweredOff is not offline)',
  },
  CONFIG_SOURCE_RECORD_NOT_FOUND: {
    zh: '源记录不存在：{{record_id}}',
    en: 'Source record not found: {{record_id}}',
  },
  CONFIG_PREFERENCE_NOT_FOUND: {
    zh: '用户偏好未设置：{{key}}',
    en: 'Preference not found: {{key}}',
  },
  CONFIG_EXPORT_NOT_FOUND: {
    zh: '导出任务不存在：{{export_id}}',
    en: 'Export not found: {{export_id}}',
  },
  CONFIG_EXPORT_EXPIRED: {
    zh: '导出文件已失效（下载即失效）：{{export_id}}',
    en: 'Export expired (single-download): {{export_id}}',
  },
  CONFIG_SCHEDULE_GROUP_NOT_FOUND: {
    zh: '调度组不存在：{{group_id}}',
    en: 'Schedule group not found: {{group_id}}',
  },
  CONFIG_DUPLICATE_NAME: {
    zh: '名称已存在：{{name}}',
    en: 'Name already exists: {{name}}',
  },
  CONFIG_RESOURCE_CONFLICT: {
    zh: '资源冲突：{{reason}}',
    en: 'Resource conflict: {{reason}}',
  },
  PLUGIN_EXEC_FAILED: {
    zh: '插件启动失败，请检查插件配置',
    en: 'Plugin execution failed, please check plugin configuration',
  },
  PLUGIN_TIMEOUT: {
    zh: '插件执行超时（超过 {{timeout_ms}} 毫秒）',
    en: 'Plugin execution timeout (exceeded {{timeout_ms}} ms)',
  },
  PLUGIN_EXIT_NONZERO: {
    zh: '插件异常退出（退出码：{{exit_code}}）',
    en: 'Plugin exited abnormally (exit code: {{exit_code}})',
  },
  PLUGIN_OUTPUT_INVALID_JSON: {
    zh: '插件输出格式错误，无法解析为 JSON',
    en: 'Plugin output format error, cannot parse as JSON',
  },
  PLUGIN_SCHEMA_VERSION_UNSUPPORTED: {
    zh: '插件契约版本不支持：{{version}}',
    en: 'Plugin schema version not supported: {{version}}',
  },
  PLUGIN_RESPONSE_INVALID: {
    zh: '插件响应结构不符合契约',
    en: 'Plugin response does not conform to contract',
  },
  SCHEMA_VALIDATION_FAILED: {
    zh: 'Schema 校验失败：{{path}} - {{message}}',
    en: 'Schema validation failed: {{path}} - {{message}}',
  },
  INVENTORY_INCOMPLETE: {
    zh: '采集清单不完整，无法保证数据一致性',
    en: 'Inventory incomplete, cannot guarantee data consistency',
  },
  INVENTORY_RELATIONS_EMPTY: {
    zh: '关系清单为空（relations=0），虚拟化关系链不可用',
    en: 'Relations empty (relations=0), virtualization relation chain unavailable',
  },
  RAW_PERSIST_FAILED: {
    zh: '原始数据存储失败，请检查存储配置',
    en: 'Raw data persistence failed, please check storage configuration',
  },
  DB_WRITE_FAILED: {
    zh: '数据库写入失败：{{table}}',
    en: 'Database write failed: {{table}}',
  },
  DB_READ_FAILED: {
    zh: '数据库读取失败：{{table}}',
    en: 'Database read failed: {{table}}',
  },
  VCENTER_CONFIG_INVALID: {
    zh: 'vCenter 配置无效：{{details}}',
    en: 'vCenter configuration invalid: {{details}}',
  },
  VCENTER_AUTH_FAILED: {
    zh: 'vCenter 认证失败，请检查用户名和密码',
    en: 'vCenter authentication failed, please check username and password',
  },
  VCENTER_PERMISSION_DENIED: {
    zh: 'vCenter 权限不足，无法访问所需资源',
    en: 'vCenter permission denied, cannot access required resources',
  },
  VCENTER_NETWORK_ERROR: {
    zh: 'vCenter 网络连接失败：{{endpoint}}',
    en: 'vCenter network connection failed: {{endpoint}}',
  },
  VCENTER_TLS_ERROR: {
    zh: 'vCenter TLS/证书错误',
    en: 'vCenter TLS/certificate error',
  },
  VCENTER_RATE_LIMIT: {
    zh: 'vCenter API 请求被限流，请稍后重试',
    en: 'vCenter API rate limited, please retry later',
  },
  VCENTER_PARSE_ERROR: {
    zh: 'vCenter 响应解析失败',
    en: 'vCenter response parse error',
  },
  VCENTER_API_VERSION_UNSUPPORTED: {
    zh: 'vCenter API 版本不支持：{{version}}',
    en: 'vCenter API version not supported: {{version}}',
  },
  VCENTER_HOST_DETAIL_NOT_FOUND: {
    zh: 'vCenter Host 详情接口不可用（已废弃降级口径）；请调整 Source 版本范围或升级 vCenter',
    en: 'vCenter host detail endpoint unavailable (fallback deprecated); adjust source version range or upgrade vCenter',
  },
  PVE_CONFIG_INVALID: {
    zh: 'PVE 配置无效：{{details}}',
    en: 'PVE configuration invalid: {{details}}',
  },
  PVE_AUTH_FAILED: {
    zh: 'PVE 认证失败，请检查 Token 或用户名密码',
    en: 'PVE authentication failed, please check token or credentials',
  },
  PVE_PERMISSION_DENIED: {
    zh: 'PVE 权限不足，无法访问所需资源',
    en: 'PVE permission denied, cannot access required resources',
  },
  PVE_NETWORK_ERROR: {
    zh: 'PVE 网络连接失败：{{endpoint}}',
    en: 'PVE network connection failed: {{endpoint}}',
  },
  PVE_TLS_ERROR: {
    zh: 'PVE TLS/证书错误',
    en: 'PVE TLS/certificate error',
  },
  PVE_RATE_LIMIT: {
    zh: 'PVE API 请求被限流，请稍后重试',
    en: 'PVE API rate limited, please retry later',
  },
  PVE_PARSE_ERROR: {
    zh: 'PVE 响应解析失败',
    en: 'PVE response parse error',
  },
  HYPERV_CONFIG_INVALID: {
    zh: 'Hyper-V 配置无效：{{details}}',
    en: 'Hyper-V configuration invalid: {{details}}',
  },
  HYPERV_AUTH_FAILED: {
    zh: 'Hyper-V 认证失败，请检查账号/密码/域',
    en: 'Hyper-V authentication failed, please check account/password/domain',
  },
  HYPERV_PERMISSION_DENIED: {
    zh: 'Hyper-V 权限不足，无法访问所需资源',
    en: 'Hyper-V permission denied, cannot access required resources',
  },
  HYPERV_NETWORK_ERROR: {
    zh: 'Hyper-V 网络连接失败：{{endpoint}}',
    en: 'Hyper-V network connection failed: {{endpoint}}',
  },
  HYPERV_TLS_ERROR: {
    zh: 'Hyper-V TLS/证书错误',
    en: 'Hyper-V TLS/certificate error',
  },
  HYPERV_PARSE_ERROR: {
    zh: 'Hyper-V 响应解析失败',
    en: 'Hyper-V response parse error',
  },
  ALIYUN_CONFIG_INVALID: {
    zh: '阿里云配置无效：{{details}}',
    en: 'Aliyun configuration invalid: {{details}}',
  },
  ALIYUN_AUTH_FAILED: {
    zh: '阿里云认证失败，请检查 AK/SK 或 STS Token',
    en: 'Aliyun authentication failed, please check AK/SK or STS token',
  },
  ALIYUN_PERMISSION_DENIED: {
    zh: '阿里云权限不足，请检查 RAM 权限',
    en: 'Aliyun permission denied, please check RAM permissions',
  },
  ALIYUN_NETWORK_ERROR: {
    zh: '阿里云网络/请求失败：{{details}}',
    en: 'Aliyun network/request failed: {{details}}',
  },
  ALIYUN_RATE_LIMIT: {
    zh: '阿里云 API 请求被限流，请稍后重试',
    en: 'Aliyun API rate limited, please retry later',
  },
  ALIYUN_PARSE_ERROR: {
    zh: '阿里云响应解析失败',
    en: 'Aliyun response parse error',
  },
  PHYSICAL_CONFIG_INVALID: {
    zh: '物理机来源配置无效：{{details}}',
    en: 'Physical source configuration invalid: {{details}}',
  },
  PHYSICAL_AUTH_FAILED: {
    zh: '物理机来源认证失败，请检查凭证',
    en: 'Physical source authentication failed, please check credentials',
  },
  PHYSICAL_PERMISSION_DENIED: {
    zh: '物理机来源权限不足，无法读取所需信息',
    en: 'Physical source permission denied, cannot read required information',
  },
  PHYSICAL_NETWORK_ERROR: {
    zh: '物理机来源网络连接失败：{{endpoint}}',
    en: 'Physical source network connection failed: {{endpoint}}',
  },
  PHYSICAL_TLS_ERROR: {
    zh: '物理机来源 TLS/证书错误',
    en: 'Physical source TLS/certificate error',
  },
  PHYSICAL_PARSE_ERROR: {
    zh: '物理机来源响应解析失败',
    en: 'Physical source response parse error',
  },
  INTERNAL_ERROR: {
    zh: '系统内部错误，请联系管理员',
    en: 'Internal system error, please contact administrator',
  },
  INTERNAL_NOT_IMPLEMENTED: {
    zh: '功能尚未实现',
    en: 'Feature not implemented',
  },
};
```

### 6.2 消息格式化函数

```typescript
/**
 * 格式化错误消息（支持变量插值）
 * @param code 错误码
 * @param locale 语言（'zh' | 'en'）
 * @param vars 变量对象
 */
export function formatErrorMessage(
  code: ErrorCodeType,
  locale: 'zh' | 'en' = 'zh',
  vars: Record<string, string | number> = {},
): string {
  const template = ErrorMessages[code]?.[locale] ?? ErrorMessages.INTERNAL_ERROR[locale];
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? `{{${key}}}`));
}
```

### 6.3 使用示例

```typescript
// 中文
formatErrorMessage('VCENTER_NETWORK_ERROR', 'zh', { endpoint: 'vcenter.example.com' });
// => "vCenter 网络连接失败：vcenter.example.com"

// 英文
formatErrorMessage('PLUGIN_TIMEOUT', 'en', { timeout_ms: 300000 });
// => "Plugin execution timeout (exceeded 300000 ms)"
```
