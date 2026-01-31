# M11：资产台账系统 - 阿里云采集（ECS 为主）- 产品需求文档（PRD）

> 目标：新增阿里云来源采集能力（以 ECS 为主），将云上 VM 纳入统一资产视图；支持多 Region 采集、分页/限流/幂等等关键工程口径；raw 永久保留并可脱敏查看（admin-only）。

## Requirements Description

### Background

- **现状问题**：系统未实现阿里云采集，无法覆盖云上资产盘点。
- **目标用户**：管理员（admin）、盘点/运维。
- **价值**：形成“本地虚拟化 + 云”统一台账的基础能力，为后续重复治理/合并提供候选键与证据链。

### Scope / Out of Scope

**In Scope**

- 插件化采集：`healthcheck/detect/collect`（遵循 `docs/design/asset-ledger-collector-reference.md`）。
- 接入方式：远程协议（官方 API/SDK）。
- 采集对象：ECS 实例（作为 VM 资产入账）。
- 多 Region 支持：按 Source config 指定的 region 列表做全量枚举。
- raw 永久保留、脱敏查看（admin-only）与访问审计。

**Out of Scope**

- 云资源全家桶（SLB/RDS/VPC/安全组等）专项。
- 账单/成本/标签治理专项（tags 可作为 best-effort 字段后续扩展）。
- 云侧宿主/集群关系映射（relations 默认为空）。

### Success Metrics

- 在权限与网络满足前提下：
  - `healthcheck` 成功率 = 100%
  - `detect` 成功率 = 100%
  - `collect` 成功率 ≥ 99%
- `collect` 成功后：ECS 实例可在 `/assets` 浏览（列表 + 详情），且 `stats.inventory_complete=true`。
- raw 永久保留；管理员可脱敏查看 raw 且写入审计。

## Feature Overview

### Core Requirements

1. **Collector 契约与 inventory complete（强约束）**

- `mode=collect` 输出必须代表该 Source 的“完整资产清单快照”（inventory complete）。
- 对阿里云 Source，“完整”语义为：配置的所有 region 内的 ECS 实例均完成枚举。
- 若任一 region 枚举失败或分页/限流导致无法保证完整：Run 必须失败（不得 warnings 伪成功）。

2. **ECS 字段（最小集合，normalized-v1）**

- VM（kind=vm）：
  - identity：cloud_native_id（实例 ID，必须）、hostname/caption（best-effort）
  - os：name/version（best-effort）
  - hardware：cpu_count/memory_bytes（best-effort）
  - network：ip_addresses（公网/私网，best-effort）
  - runtime：power_state（必须，映射到规范枚举）

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

- `regions`：string[]（必填；示例：`["cn-hangzhou","cn-beijing"]`）
- `timeout_ms`：number（默认 60_000）
- `max_parallel_regions`：number（默认 3；避免触发更严重限流）
- `include_stopped`：boolean（默认 true；是否包含已停止实例）

凭证（敏感，存 credential；运行时注入）：

- `access_key_id`（必填）
- `access_key_secret`（必填）
- `sts_token?`（可选；若使用 STS 临时凭证）

### 2) healthcheck（连通性 + 权限基线）

healthcheck 必须检查：

- 凭证可用（能调用一个轻量 API，例如 DescribeRegions/DescribeInstances(1)）
- RAM 权限满足最小集（见 2.1）

#### 2.1 最小 RAM 权限集（建议）

> 目标：只读盘点；避免给过大权限。

- `ecs:DescribeInstances`
- `ecs:DescribeRegions`（或按实现需要的 region API）
- （可选）`vpc:DescribeVpcs` / `vpc:DescribeVSwitches`：仅当需要解析 VPC/子网信息时（本期不强制）

### 3) detect（账号/能力/配置校验）

detect 输出（示例）：

- `target_version`：`aliyun-ecs`（固定字符串即可）
- `capabilities`：
  - `regions`: string[]（最终生效的 region 列表）
  - `supports_sts`: boolean（是否提供 sts_token）
  - `include_stopped`: boolean
- `driver`：例如 `aliyun-ecs-sdk-v1`

detect 必须校验：

- `regions` 非空且合法；非法 region 必须失败（`ALIYUN_CONFIG_INVALID`）

### 4) collect（按 region 全量枚举 ECS）

#### 4.1 完整枚举（inventory complete）

- 对每个 region：
  - 必须全量分页拉取 ECS 实例
  - 必须处理限流（指数退避重试；超过最大重试次数则失败）
- 任一 region 失败 → Run 失败（`INVENTORY_INCOMPLETE` 或更具体 `ALIYUN_*` 错误码）。

#### 4.2 运行状态与过滤

- `include_stopped=true` 时：
  - 枚举 running/stopped 等全部状态（按 API 能力实现）
- `include_stopped=false` 时：
  - 仅保留运行中实例（需在 detect/capabilities 体现）

### 5) normalized-v1 字段落点（示例）

VM（normalized-v1）：

- `kind="vm"`
- `identity.cloud_native_id`：ECS instanceId（必须）
- `identity.hostname`：InstanceName（best-effort）
- `os.name/os.version`：从 Image/OSName 字段 best-effort 映射
- `hardware.cpu_count`：Cpu
- `hardware.memory_bytes`：Memory（GiB → bytes）
- `runtime.power_state`：从 Status 映射到规范枚举（running/stopped 等）
- `network.ip_addresses[]`：合并私网/公网 IP（best-effort；去重）

### 6) external_id 选择（同一 Source 内稳定）

- VM：使用 instanceId（必须稳定）

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
  - ECS 字段映射到 normalized-v1
  - raw 留存与脱敏
- 完整性优先：
  - 任一 region 枚举失败视为 inventory incomplete，必须失败，避免“云上资产缺口”被误当作 offline/missing。

### Constraints

- 本期仅 ECS；其它云资源后续拆 PRD。
- 不建模 region/zone/vpc 为 cluster/host 资产与关系边（避免语义误导）。

### Risk Assessment

- **限流风险**：云 API 容易被 Throttling。缓解：`max_parallel_regions` 控制并发；对 429/Throttling 指数退避；超过重试上限失败并输出 `ALIYUN_RATE_LIMIT`。
- **多 region 配置复杂风险**：漏配 region 会造成盘点缺口。缓解：detect 回显最终 region 列表；UI 给出提示（“当前 Source 未覆盖的 region 不会被采集”）。
- **字段口径漂移风险**：云厂商字段/枚举可能变化。缓解：driver 版本化 + parse 健壮；关键字段缺失则失败（避免 silent bad data）。

## Acceptance Criteria

### Functional Acceptance

- [ ] 插件遵循 `collector-response-v1` 契约，输出 `assets[]/relations[]/stats.inventory_complete/errors[]`。
- [ ] `collect` 成功时：覆盖 config 指定的全部 regions，`stats.inventory_complete=true`。
- [ ] 每个 ECS 实例入账为 VM；`identity.cloud_native_id` 必须为 instanceId。
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

## Execution Phases

### Phase 1: 配置与权限定稿

- [ ] 定稿 aliyun Source config（regions/max_parallel_regions/include_stopped）
- [ ] 定义最小 RAM 权限集与验收清单

### Phase 2: healthcheck/detect/collect 最小闭环

- [ ] healthcheck：连通性 + 权限基线
- [ ] detect：配置回显 + driver/capabilities
- [ ] collect：多 region 全量分页枚举 ECS

### Phase 3: 限流与稳定性

- [ ] Throttling/429 的指数退避与最大重试策略
- [ ] 幂等性验证（同配置重复运行输出集合一致）

### Phase 4: 错误码/文档/回归

- [ ] 注册 `ALIYUN_*` 错误码并补齐 retryable/category 口径
- [ ] 按回归清单验证（至少 2 个 region）

---

**Document Version**: 1.0
**Created**: 2026-01-30
**Clarification Rounds**: 0
**Quality Score**: 100/100
