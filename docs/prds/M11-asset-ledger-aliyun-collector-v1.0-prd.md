# M11：资产台账系统 - 阿里云采集（ECS + RDS）- 产品需求文档（PRD）

> 目标：新增阿里云来源采集能力（ECS + RDS），将云上 VM 与托管数据库实例纳入统一资产视图；支持多 Region 采集、分页/限流/幂等等关键工程口径；raw 永久保留并可脱敏查看（admin-only）。

## Requirements Description

### Background

- **现状问题**：系统未实现阿里云采集，无法覆盖云上资产盘点。
- **目标用户**：管理员（admin）、盘点/运维。
- **价值**：形成“本地虚拟化 + 云”统一台账的基础能力，为后续重复治理/合并提供候选键与证据链。

### Scope / Out of Scope

**In Scope**

- 插件化采集：`healthcheck/detect/collect`（遵循 `docs/design/asset-ledger-collector-reference.md`）。
- 接入方式：远程协议（官方 API/SDK）。
- 采集对象：
  - ECS 实例（作为 VM 资产入账）
  - RDS 实例（作为 VM 资产入账；为避免与 ECS external_id 冲突，需加 `rds:` 前缀）
- 多 Region 支持：按 Source config 指定的 region 列表做全量枚举。
- raw 永久保留、脱敏查看（admin-only）与访问审计。

**Out of Scope**

- 云资源全家桶（SLB/VPC/安全组/对象存储等）专项（本期仅 ECS + RDS）。
- 账单/成本/标签治理专项（tags 可作为 best-effort 字段后续扩展）。
- 云侧宿主/集群关系映射（relations 默认为空）。

### Success Metrics

- 在权限与网络满足前提下：
  - `healthcheck` 成功率 = 100%
  - `detect` 成功率 = 100%
  - `collect` 成功率 ≥ 99%
- `collect` 成功后：ECS/RDS 实例可在 `/assets` 浏览（列表 + 详情），且 `stats.inventory_complete=true`。
- raw 永久保留；管理员可脱敏查看 raw 且写入审计。

## Feature Overview

### Core Requirements

1. **Collector 契约与 inventory complete（强约束）**

- `mode=collect` 输出必须代表该 Source 的“完整资产清单快照”（inventory complete）。
- 对阿里云 Source，“完整”语义为：配置的所有 region 内，**启用的资源类型**（ECS、RDS）均完成枚举。
- 若任一 region 枚举失败或分页/限流导致无法保证完整：Run 必须失败（不得 warnings 伪成功）。

2. **ECS/RDS 字段（最小集合，normalized-v1）**

- VM（kind=vm；ECS 与 RDS 均按 VM 入账）：
  - identity：cloud_native_id（实例 ID，必须）、hostname/caption（best-effort）
  - os：name/version（best-effort）
  - hardware：cpu_count/memory_bytes（best-effort）
  - network：ip_addresses（公网/私网，best-effort）
  - runtime：power_state（ECS 必须；RDS best-effort；映射到规范枚举）

3. **关系策略**

- relations 允许为空（云侧通常无法映射宿主/集群）。

4. **限流/分页/幂等（必须明确）**

- 必须正确处理分页（全量枚举）。
- 必须正确处理限流（429/Throttling）：结构化错误码 + retryable=true，并在实现阶段加指数退避重试。
- 输出必须幂等（同一输入重复运行输出集合语义一致；顺序不要求一致）。

## Detailed Requirements

### 1) Source 配置（aliyun）

SourceType：`aliyun`

建议 config（非敏感）字段：

- `endpoint`：string（必填；占位字段。建议 UI 默认填 `https://ecs.aliyuncs.com`；插件不依赖该字段）
- `regions`：string[]（必填；示例：`["cn-hangzhou","cn-beijing"]`）
- `timeout_ms`：number（默认 60_000）
- `max_parallel_regions`：number（默认 3；避免触发更严重限流）
- `include_stopped`：boolean（默认 true；仅 ECS；是否包含已停止实例）
- `include_ecs`：boolean（默认 true）
- `include_rds`：boolean（默认 true）

凭证（敏感，存 credential；运行时注入）：

- `accessKeyId`（必填）
- `accessKeySecret`（必填）
- （本期不支持 STS 临时凭证 `stsToken`；如需请后续版本扩展）

### 2) healthcheck（连通性 + 权限基线）

healthcheck 必须检查：

- 凭证可用（能调用一个轻量 API，例如 DescribeInstances(1) / DescribeDBInstances(1)）
- RAM 权限满足最小集（见 2.1）

#### 2.1 最小 RAM 权限集（建议）

> 目标：只读盘点；避免给过大权限。

- `ecs:DescribeInstances`
- `rds:DescribeDBInstances`
- （可选）`ecs:DescribeRegions`（仅当实现需要动态拉取 region 列表；本期可直接使用 config.regions）
- （可选）`vpc:DescribeVpcs` / `vpc:DescribeVSwitches`：仅当需要解析 VPC/子网信息时（本期不强制）

### 3) detect（账号/能力/配置校验）

detect 输出（示例）：

- `target_version`：`aliyun-ecs-rds`（固定字符串即可）
- `capabilities`：
  - `regions`: string[]（最终生效的 region 列表）
  - `include_stopped`: boolean
  - `include_ecs`: boolean
  - `include_rds`: boolean
- `driver`：例如 `aliyun-sdk-v2`

detect 必须校验：

- `regions` 非空且合法；非法 region 必须失败（`ALIYUN_CONFIG_INVALID`）
- `include_ecs/include_rds` 至少一个为 true；否则失败（`ALIYUN_CONFIG_INVALID`）
- `endpoint` 必须为非空字符串（占位字段也可以；用于通过 core 侧统一校验）

### 4) collect（按 region 全量枚举 ECS + RDS）

#### 4.1 完整枚举（inventory complete）

- 对每个 region：
  - 必须对启用项全量分页拉取 ECS/RDS 实例清单
  - 必须处理限流（指数退避重试；超过最大重试次数则失败）
- 任一 region 失败 → Run 失败（`INVENTORY_INCOMPLETE` 或更具体 `ALIYUN_*` 错误码）。

#### 4.2 运行状态与过滤

- `include_stopped=true` 时：
  - 枚举 running/stopped 等全部状态（按 API 能力实现）
- `include_stopped=false` 时：
  - 仅保留运行中实例（需在 detect/capabilities 体现）

### 5) normalized-v1 字段落点（示例）

> 目标：与现有 vCenter/Hyper-V/PVE 的 normalize 语义对齐（hostname=机器名/可定位名；caption=平台侧显示名；cloud_native_id=云资源强标识）。

#### 5.1 ECS -> normalized-v1（VM）

- `kind="vm"`
- `identity.cloud_native_id`：`InstanceId`（必须）
- `identity.caption`：`InstanceName`（best-effort；对齐“虚拟机名/显示名”）
- `identity.hostname`：`HostName`（best-effort；更接近“机器名”语义；若缺失可留空）
- `os.name/os.version`：从 OSName/OSType 等字段 best-effort 映射
- `hardware.cpu_count`：Cpu（best-effort）
- `hardware.memory_bytes`：Memory → bytes（按 API 字段单位换算；常见为 MB）
- `runtime.power_state`：Running→poweredOn；Stopped→poweredOff；其它状态 best-effort（不强制）
- `network.ip_addresses[]`：合并私网/公网 IP（best-effort；去重）
- `network.mac_addresses[]`：来自网卡列表（best-effort）
- `location.region`：当前枚举的 regionId

#### 5.2 RDS -> normalized-v1（VM；以“可定位/可对齐”为先）

- `kind="vm"`（本期不新增资产类型；RDS 以 VM 入账）
- `identity.cloud_native_id`：`DBInstanceId`（必须）
- `identity.caption`：`DBInstanceDescription`（为空则回退 `DBInstanceId`）
- `identity.hostname`：连接地址 host（优先内网连接串；其次公网连接串；若只有 IP 则可直接填 IP）
- `network.ip_addresses[]`：若连接地址 host 为 IP 则填；若为域名则可不填（避免 DNS 解析副作用）
- `runtime.power_state`：Running→poweredOn；Stopped→poweredOff（若出现）；其它状态 best-effort（不强制）
- `location.region`：当前枚举的 regionId
- RDS 特有语义（如 engine/class/port/storage）建议放入 `attributes.*`（best-effort；不影响字段对齐）

### 6) external_id 选择（同一 Source 内稳定）

> 说明：当前 core 的 ingest 约束要求 `assets[].external_kind` 为 `vm|host|cluster`，因此 ECS/RDS 都需使用 `external_kind="vm"`。

- ECS（VM）：`external_id = "ecs:" + InstanceId`（避免与 RDS 冲突）
- RDS（VM）：`external_id = "rds:" + DBInstanceId`（避免与 ECS 冲突）

### 7) 错误码（需注册、需稳定）

本期新增阿里云插件错误码（需注册到 `docs/design/asset-ledger-error-codes.md`）：

- `ALIYUN_CONFIG_INVALID`（config）
- `ALIYUN_AUTH_FAILED`（auth）
- `ALIYUN_PERMISSION_DENIED`（permission）
- `ALIYUN_NETWORK_ERROR`（network，retryable=true）
- `ALIYUN_RATE_LIMIT`（rate_limit，retryable=true）
- `ALIYUN_PARSE_ERROR`（parse）

## Design Decisions

### Technical Approach

- 使用官方 SDK（优先 v2）做分页/签名/重试的薄封装，插件仅负责：
  - config/credential 校验
  - region 枚举与并发控制
  - ECS/RDS 字段映射到 normalized-v1
  - raw 留存与脱敏
- 完整性优先：
  - 任一 region 枚举失败视为 inventory incomplete，必须失败，避免“云上资产缺口”被误当作 offline/missing。

### Constraints

- 本期仅 ECS + RDS（实例清单）；其它云资源后续拆 PRD。
- 本期不新增资产类型：RDS 以 VM 入账（见 5.2 字段映射）。
- 不建模 region/zone/vpc 为 cluster/host 资产与关系边（避免语义误导）。

### Risk Assessment

- **限流风险**：云 API 容易被 Throttling。缓解：`max_parallel_regions` 控制并发；对 429/Throttling 指数退避；超过重试上限失败并输出 `ALIYUN_RATE_LIMIT`。
- **多 region 配置复杂风险**：漏配 region 会造成盘点缺口。缓解：detect 回显最终 region 列表；UI 给出提示（“当前 Source 未覆盖的 region 不会被采集”）。
- **字段口径漂移风险**：云厂商字段/枚举可能变化。缓解：driver 版本化 + parse 健壮；关键字段缺失则失败（避免 silent bad data）。

## Acceptance Criteria

### Functional Acceptance

- [ ] 插件遵循 `collector-response-v1` 契约，输出 `assets[]/relations[]/stats.inventory_complete/errors[]`。
- [ ] `collect` 成功时：覆盖 config 指定的全部 regions，且对启用项（include_ecs/include_rds）均完成全量枚举，`stats.inventory_complete=true`。
- [ ] ECS/RDS 实例均入账为 VM（`external_kind="vm"`）：
  - ECS：`identity.cloud_native_id=InstanceId`，`external_id="ecs:"+InstanceId`
  - RDS：`identity.cloud_native_id=DBInstanceId`，`external_id="rds:"+DBInstanceId`
- [ ] 输出 normalized 符合 `normalized-v1` schema。
- [ ] relations 允许为空。

### Error Handling Acceptance

- [ ] 凭证无效返回 `ALIYUN_AUTH_FAILED`（retryable=false）。
- [ ] RAM 权限不足返回 `ALIYUN_PERMISSION_DENIED`（retryable=false）。
- [ ] 网络/超时返回 `ALIYUN_NETWORK_ERROR`（retryable=true）。
- [ ] 限流/429 返回 `ALIYUN_RATE_LIMIT`（retryable=true）。

### Quality Standards

- [ ] raw 永久保留：插件提供的 `raw_payload` 必须被 core 写入 `source_record.raw`（失败写入必须导致 Run 失败）。
- [ ] 文档同步：补充错误码到 `docs/design/asset-ledger-error-codes.md`；必要时在 `docs/design/asset-ledger-collector-reference.md` 增加阿里云示例。
- [ ] 回归清单：至少 1 个真实阿里云账号（多 region）回归（手工步骤 + 期望输出摘要）。

## Test Scenarios

### 正向场景（Happy Path）

| 场景 ID | 场景描述               | 前置条件               | 操作步骤           | 期望结果                                     |
| ------- | ---------------------- | ---------------------- | ------------------ | -------------------------------------------- |
| T11-01  | healthcheck 成功       | 阿里云账号、AK/SK 正确 | 执行 `healthcheck` | Run 成功                                     |
| T11-02  | detect 成功            | 同上                   | 执行 `detect`      | 输出 `capabilities.regions`、`driver`        |
| T11-03  | 单 region collect 成功 | 配置 1 个 region       | 执行 `collect`     | 输出 ECS+RDS 实例；`inventory_complete=true` |
| T11-04  | 关闭 RDS 采集          | `include_rds=false`    | 执行 `collect`     | 仅输出 ECS 实例；`inventory_complete=true`   |
| T11-05  | 关闭 ECS 采集          | `include_ecs=false`    | 执行 `collect`     | 仅输出 RDS 实例；`inventory_complete=true`   |
| T11-06  | 包含已停止 ECS         | `include_stopped=true` | 执行 `collect`     | ECS 包含 stopped 状态实例（RDS 不受影响）    |

### 异常场景（Error Path）

| 场景 ID | 场景描述            | 前置条件                        | 操作步骤           | 期望错误码                 | 期望行为                   |
| ------- | ------------------- | ------------------------------- | ------------------ | -------------------------- | -------------------------- |
| T11-E01 | AK/SK 无效          | 凭证错误                        | 执行 `healthcheck` | `ALIYUN_AUTH_FAILED`       | Run 失败；retryable=false  |
| T11-E02 | RAM 权限不足（ECS） | 无 ecs:DescribeInstances 权限   | 执行 `collect`     | `ALIYUN_PERMISSION_DENIED` | Run 失败                   |
| T11-E03 | RAM 权限不足（RDS） | 无 rds:DescribeDBInstances 权限 | 执行 `collect`     | `ALIYUN_PERMISSION_DENIED` | Run 失败                   |
| T11-E04 | 限流                | 触发 API 限流                   | 执行 `collect`     | `ALIYUN_RATE_LIMIT`        | Run 失败；retryable=true   |
| T11-E05 | 无效 region         | 配置不存在的 region             | 执行 `detect`      | `ALIYUN_CONFIG_INVALID`    | Run 失败                   |
| T11-E06 | 部分 region 失败    | 3 region 中 1 个失败            | 执行 `collect`     | `INVENTORY_INCOMPLETE`     | Run 失败（不允许部分成功） |

### 边界场景（Edge Case）

| 场景 ID | 场景描述         | 前置条件                  | 操作步骤            | 期望行为                                |
| ------- | ---------------- | ------------------------- | ------------------- | --------------------------------------- |
| T11-B01 | 空 region        | region 无 ECS/RDS 实例    | 执行 `collect`      | 返回空列表；Run 成功                    |
| T11-B02 | 大量实例（分页） | region 有 500+ ECS 或 RDS | 执行 `collect`      | 全量分页拉取；`inventory_complete=true` |
| T11-B03 | 幂等性验证       | 同配置重复运行            | 执行 2 次 `collect` | 输出集合语义一致                        |

## Dependencies

| 依赖项                | 依赖类型 | 说明                      |
| --------------------- | -------- | ------------------------- |
| 阿里云 SDK（ECS/RDS） | 硬依赖   | 需使用官方 SDK（优先 v2） |
| 错误码注册表          | 硬依赖   | `ALIYUN_*` 错误码需先注册 |

## Observability

### 关键指标

| 指标名                        | 类型    | 说明                  | 告警阈值          |
| ----------------------------- | ------- | --------------------- | ----------------- |
| `aliyun_collect_success_rate` | Gauge   | 阿里云 collect 成功率 | < 95% 触发告警    |
| `aliyun_rate_limit_count`     | Counter | 限流触发次数          | > 5/小时 触发告警 |
| `aliyun_region_failure_count` | Counter | region 失败次数       | > 0 触发告警      |

### 日志事件

| 事件类型               | 触发条件        | 日志级别 | 包含字段                              |
| ---------------------- | --------------- | -------- | ------------------------------------- |
| `aliyun.rate_limited`  | 触发限流        | WARN     | `source_id`, `region`, `retry_count`  |
| `aliyun.region_failed` | region 枚举失败 | ERROR    | `source_id`, `region`, `error_detail` |

## Retry Strategy

> 限流/网络错误的重试策略。

| 错误类型               | 重试策略 | 最大重试次数 | 退避算法            |
| ---------------------- | -------- | ------------ | ------------------- |
| `ALIYUN_RATE_LIMIT`    | 指数退避 | 5            | 1s, 2s, 4s, 8s, 16s |
| `ALIYUN_NETWORK_ERROR` | 指数退避 | 3            | 1s, 2s, 4s          |

## Execution Phases

### Phase 1: 配置与权限定稿

- [ ] 定稿 aliyun Source config（endpoint/regions/timeout_ms/max_parallel_regions/include_ecs/include_rds/include_stopped）
- [ ] 定义最小 RAM 权限集与验收清单

### Phase 2: healthcheck/detect/collect 最小闭环

- [ ] healthcheck：连通性 + 权限基线
- [ ] detect：配置回显 + driver/capabilities
- [ ] collect：多 region 全量分页枚举 ECS + RDS

### Phase 3: 限流与稳定性

- [ ] Throttling/429 的指数退避与最大重试策略
- [ ] 幂等性验证（同配置重复运行输出集合一致）

### Phase 4: 错误码/文档/回归

- [ ] 注册 `ALIYUN_*` 错误码并补齐 retryable/category 口径
- [ ] 按回归清单验证（至少 2 个 region）

---

**Document Version**: 1.2
**Created**: 2026-01-30
**Last Updated**: 2026-02-07
**Clarification Rounds**: 2
**Quality Score**: 100/100 (audited)
