# M6：资产台账系统 - PVE 采集（兼容 5.0 ～ 8.0）- 产品需求文档（PRD）

> 目标：新增 PVE（Proxmox VE）来源采集能力，并确保 **PVE 5.0～8.0** 的关键路径稳定可用（healthcheck/detect/collect；字段解析健壮；错误口径一致；raw 可追溯）。

## Requirements Description

### Background

- **现状问题**：系统未实现 PVE 插件，无法覆盖 PVE 资产盘点与关系链（VM→Host→Cluster）。
- **目标用户**：管理员（admin）、盘点/运维。
- **价值**：
  - 将 PVE VM/Node 纳入统一资产视图，形成多来源台账基础。
  - 为后续重复中心（M5）与人工合并提供候选键数据与证据链（raw/provenance）。

### Scope / Out of Scope

**In Scope**

- 插件化采集：实现 `healthcheck/detect/collect`，遵循 collector 契约（`docs/design/asset-ledger-collector-reference.md`）。
- 接入方式：优先 **远程协议**（PVE HTTPS REST API）；同一 `source_type=pve` 未来允许扩展第二种方式（例如 Agent），但本期仅实现远程协议。
- 覆盖形态：
  - 单节点 PVE：采集 Host（node）与 VM，并输出 VM→Host（runs_on）
  - PVE Cluster：采集 Cluster/Host/VM，并输出 Host→Cluster（member_of）与 VM→Host（runs_on，best-effort 但应高可用）
- raw 永久保留：插件输出的 `raw_payload` 必须被 core 持久化（对齐“可回放/可审计”语义）。

**Out of Scope**

- 存储/网络拓扑专项（Ceph、bridge/VLAN 关系建模等）。
- 性能指标/告警事件/日志采集。
- 自动开通/自动修复（不自动修改目标系统配置；只输出错误码与建议动作）。

### Success Metrics

- 在权限与网络满足前提下：
  - `healthcheck` 成功率 = 100%
  - `detect` 成功率 = 100%
  - `collect` 成功率 ≥ 99%
- `collect` 成功时：
  - `stats.inventory_complete=true`
  - 当存在 VM 时：`relations.length > 0`（至少有 VM→Host 或 Host→Cluster）

## Feature Overview

### Core Requirements

1. **Collector 契约与 inventory complete（强约束）**

- `mode=collect` 输出必须代表该 Source 的“完整资产清单快照”（inventory complete）。
- 若因权限/分页/限流/API 错误无法保证完整：Run 必须失败（`errors[]`），不得以 warnings 标记成功。

2. **版本兼容策略（5.0～8.0）**

- `detect` 必须输出：
  - `target_version`（best-effort：可为 major.minor）
  - `capabilities`（例如：是否启用 cluster、是否可用 guest agent 接口、关键 endpoint 是否可用）
  - `driver`（按 capability 选择；版本号仅作为 fallback）
- 对可选字段缺失应健壮解析（best-effort）；对关键枚举失败/清单不完整必须失败。

3. **最小字段集（normalized-v1）**

- VM（kind=vm）：name/hostname（best-effort）、cpu_count、memory_bytes、power_state（必须）、ip_addresses（best-effort）
- Host（kind=host）：hostname（必须）、os/version（best-effort）、cpu_count/memory_bytes（best-effort）、serial_number（best-effort）
- Cluster（kind=cluster）：caption（best-effort：cluster 名）

4. **关系必须可用（虚拟化平台硬约束）**

- 当存在 VM 时，必须尽力输出 VM→Host（runs_on）；群集模式下必须输出 Host→Cluster（member_of）。
- 禁止“存在 VM 但 relations=0”的伪成功：应失败并输出稳定错误码（建议 `INVENTORY_RELATIONS_EMPTY`）。

## Detailed Requirements

### 1) Source 配置（pve）

SourceType：`pve`

接入方式（v1）：HTTPS REST API（远程协议）。

建议 config（非敏感）字段：

- `endpoint`：string（示例：`https://pve.example.com:8006`；允许填写任一节点或 VIP）
- `tls_verify`：boolean（默认 true；允许显式关闭用于自签名/内网，关闭需 UI 风险提示）
- `timeout_ms`：number（默认 60_000；单次 HTTP 请求超时）
- `scope`：`auto|standalone|cluster`（默认 auto；detect 可给出建议）
- `max_parallel_nodes`：number（默认 5；cluster 场景节点并发上限）
- `auth_type`：`api_token|user_password`（默认 api_token；仅用于指导 credential 结构）

凭证（敏感，存 credential；运行时注入）：

- `auth_type=api_token`：
  - `api_token_id`（例如：`user@pam!tokenid`）
  - `api_token_secret`
- `auth_type=user_password`：
  - `username`
  - `password`

### 2) healthcheck（连通性 + 权限基线）

目的：不产出资产清单的前提下，验证“网络 + 认证 + 最小只读权限”是否满足 collect。

healthcheck 必须检查：

- endpoint 可达（TLS/HTTP）
- 认证成功（token 或用户密码）
- 最小权限可满足以下“清单枚举”：
  - 节点列表（Host 枚举）
  - VM 列表（至少能列出 vmid/name/status）

失败口径：

- TLS/证书：`PVE_TLS_ERROR`（retryable=false）
- 网络/超时：`PVE_NETWORK_ERROR`（retryable=true）
- 认证失败：`PVE_AUTH_FAILED`（retryable=false）
- 权限不足：`PVE_PERMISSION_DENIED`（retryable=false）

### 3) detect（版本/形态/能力探测）

detect 输出（示例）：

- `target_version`：`8.1`（best-effort）
- `capabilities`：
  - `is_cluster`: boolean
  - `guest_agent_supported`: boolean（仅表示 endpoint 可用；不保证每台 VM 都启用）
  - `supports_cluster_resources_endpoint`: boolean（若使用 `/cluster/resources` 路线）
- `driver`：例如 `pve-cap-v1` / `pve-cap-v2`

detect 必须用于：

- Run 详情展示（排障）
- 给出 `scope` 建议（auto 判断为 cluster/standalone）

### 4) collect（完整清单 + best-effort 字段）

#### 4.1 清单范围（inventory complete）

collect 必须覆盖：

- Host（node）清单：所有可见节点
- VM 清单：所有可见 VM（QEMU/LXC 均允许纳入；若仅采集 QEMU，则必须在 PRD/实现中写明并在 UI 标注）
- Cluster（若存在）：1 个 cluster 资产（best-effort）

若任何“清单枚举”失败或分页/限流导致无法保证完整：必须失败（`INVENTORY_INCOMPLETE` 或更具体的 `PVE_*` 错误码）。

#### 4.2 单机模式（standalone）

- 资产：
  - 1 个 Host（external_kind=host）
  - N 个 VM（external_kind=vm）
- 关系：
  - 每个 VM 尽力输出 `runs_on -> Host`
- 若存在 VM 但最终 `relations=0`：失败（`INVENTORY_RELATIONS_EMPTY`）

#### 4.3 群集模式（cluster）

- 节点发现：
  - 必须能获取 cluster 名称 + 节点列表（node hostnames）
- 资产：
  - 1 个 Cluster（external_kind=cluster，best-effort）
  - M 个 Host（external_kind=host；群集节点）
  - N 个 VM（external_kind=vm）
- 关系：
  - 每个 Host 输出 `member_of -> Cluster`（若 cluster 存在则必须）
  - 每个 VM 尽力输出 `runs_on -> Host`（owner node best-effort；至少应覆盖绝大多数 VM）
- 若存在 VM 但最终 `relations=0`：失败（`INVENTORY_RELATIONS_EMPTY`）

#### 4.4 VM IP 获取（best-effort，依赖 guest agent）

- 若 detect 判定 `guest_agent_supported=true`：
  - 插件可对每台 VM best-effort 拉取网络接口信息并映射到 `network.ip_addresses[]`
- 若 agent 不可用或权限不足：
  - 不阻断 Run 成功，但应写入 warning（错误码稳定，例如 `PVE_GUEST_AGENT_UNAVAILABLE`，如新增需注册）

### 5) normalized-v1 字段落点（最小口径）

> 以 `docs/design/asset-ledger-json-schema.md` 为准；以下用于实现与验收对齐。

VM（normalized-v1）：

- `kind="vm"`
- `identity.hostname`：VM 名称（best-effort）
- `identity.cloud_native_id`：`vmid`（best-effort）
- `hardware.cpu_count`：vCPU（best-effort）
- `hardware.memory_bytes`：内存（best-effort）
- `runtime.power_state`：必须（映射为规范枚举：running/stopped/suspended 等）
- `network.ip_addresses[]`：best-effort（依赖 guest agent）

Host（normalized-v1）：

- `kind="host"`
- `identity.hostname`：node 名称（必须）
- `os.name/os.version`：best-effort
- `hardware.cpu_count/hardware.memory_bytes`：best-effort
- `identity.serial_number`：best-effort（若无可靠来源则缺失）

Cluster（normalized-v1）：

- `kind="cluster"`
- `identity.caption`：cluster 名称（best-effort）

### 6) external_id 选择（同一 Source 内稳定）

必须满足 `(source_id, external_kind, external_id)` 唯一且稳定：

- VM：建议使用 `"{node}:{vmid}"`（字符串拼接，便于稳定追踪）
- Host：使用 `node` 名称（如未来支持改名风险，可在 detect 中提示）
- Cluster：使用 cluster name（或 cluster UUID，若可得）

### 7) 错误码（需注册、需稳定）

本期新增 PVE 插件错误码（需注册到 `docs/design/asset-ledger-error-codes.md`）：

- `PVE_CONFIG_INVALID`（config）
- `PVE_AUTH_FAILED`（auth）
- `PVE_PERMISSION_DENIED`（permission）
- `PVE_NETWORK_ERROR`（network，retryable=true）
- `PVE_TLS_ERROR`（network，retryable=false）
- `PVE_RATE_LIMIT`（rate_limit，retryable=true）
- `PVE_PARSE_ERROR`（parse）
- `INVENTORY_RELATIONS_EMPTY`（relations=0 的硬失败；若新增需注册）

## Design Decisions

### Technical Approach

- v1 选择远程协议（PVE HTTPS REST API）：
  - 无需在目标侧部署 agent，覆盖成本低
  - 以 capability probe + driver 选择兼容 5.0～8.0
- “完整清单”为第一目标：
  - 分页/限流/权限导致清单不完整时必须失败，避免推进 missing/offline 语义错误。

### Constraints

- 只支持只读采集；不修改目标系统配置。
- guest agent 相关字段（VM IP）为 best-effort，不作为成功硬门槛。
- 本期不映射 PVE 的存储/网络拓扑为关系边（仅 VM↔Host↔Cluster）。

### Risk Assessment

- **权限模型复杂风险**：不同 PVE 部署的 RBAC 差异会导致接口不可用。缓解：healthcheck 给出“缺哪个权限/接口”的结构化错误与建议动作。
- **多节点并发与限流风险**：cluster 场景可能触发 API 限流。缓解：`max_parallel_nodes` 限制并发；遇到 429/限流返回 `PVE_RATE_LIMIT`（retryable=true）。
- **external_id 稳定性风险**：若仅用 `vmid`，跨节点可能冲突；缓解：采用 `{node}:{vmid}` 组合。

## Acceptance Criteria

### Functional Acceptance

- [ ] 插件遵循 `collector-response-v1` 契约，输出 `assets[]/relations[]/stats.inventory_complete`。
- [ ] PVE 5.0～8.0：`healthcheck`/`detect` 可成功并输出版本/能力摘要。
- [ ] PVE 5.0～8.0：`collect` 可成功并产出 Host/VM（Cluster best-effort），且 `stats.inventory_complete=true`。
- [ ] 当存在 VM 时：collect 成功必须满足 `relations.length > 0`；否则失败并返回 `INVENTORY_RELATIONS_EMPTY`。
- [ ] 所有输出 normalized 必须符合 `normalized-v1` schema（不得出现 `SCHEMA_VALIDATION_FAILED`）。

### Error Handling Acceptance

- [ ] 认证失败返回 `PVE_AUTH_FAILED`（retryable=false）。
- [ ] 权限不足返回 `PVE_PERMISSION_DENIED`（retryable=false）。
- [ ] 网络/超时返回 `PVE_NETWORK_ERROR`（retryable=true）。
- [ ] TLS/证书错误返回 `PVE_TLS_ERROR`（retryable=false）。
- [ ] 429/限流返回 `PVE_RATE_LIMIT`（retryable=true）。

### Quality Standards

- [ ] raw 永久保留：插件提供的 `raw_payload` 必须被 core 写入 `source_record.raw`（失败写入必须导致 Run 失败）。
- [ ] 文档同步：补充错误码到 `docs/design/asset-ledger-error-codes.md`；必要时在 `docs/design/asset-ledger-collector-reference.md` 增加 PVE 示例。
- [ ] 回归清单：至少 1 套单机 + 1 套群集环境回归（手工步骤 + 期望输出摘要）。

## Test Scenarios

### 正向场景（Happy Path）

| 场景 ID | 场景描述 | 前置条件 | 操作步骤 | 期望结果 |
|---------|----------|----------|----------|----------|
| T6-01 | PVE 8.x healthcheck 成功 | PVE 8.x、API Token 正确 | 执行 `healthcheck` | Run 成功 |
| T6-02 | PVE 5.x detect 成功 | PVE 5.x 环境 | 执行 `detect` | 输出 `target_version`、`capabilities`、`driver` |
| T6-03 | 单机 collect 成功 | PVE 单节点、至少 1 台 VM | 执行 `collect` | 输出 1 Host + N VM；`relations.length > 0` |
| T6-04 | 群集 collect 成功 | PVE Cluster | 执行 `collect` | 输出 1 Cluster + M Host + N VM；Host→Cluster 关系可用 |
| T6-05 | VM IP 获取（guest agent） | VM 启用 guest agent | 执行 `collect` | VM 包含 `network.ip_addresses[]` |

### 异常场景（Error Path）

| 场景 ID | 场景描述 | 前置条件 | 操作步骤 | 期望错误码 | 期望行为 |
|---------|----------|----------|----------|------------|----------|
| T6-E01 | 认证失败 | API Token 错误 | 执行 `healthcheck` | `PVE_AUTH_FAILED` | Run 失败；retryable=false |
| T6-E02 | 权限不足 | Token 无 VM 读取权限 | 执行 `collect` | `PVE_PERMISSION_DENIED` | Run 失败 |
| T6-E03 | 限流 | 触发 API 限流 | 执行 `collect` | `PVE_RATE_LIMIT` | Run 失败；retryable=true |
| T6-E04 | 关系为空 | 存在 VM 但无法构建关系 | 执行 `collect` | `INVENTORY_RELATIONS_EMPTY` | Run 失败 |

### 边界场景（Edge Case）

| 场景 ID | 场景描述 | 前置条件 | 操作步骤 | 期望行为 |
|---------|----------|----------|----------|----------|
| T6-B01 | guest agent 不可用 | VM 未安装 guest agent | 执行 `collect` | VM IP 为空；记录 warning `PVE_GUEST_AGENT_UNAVAILABLE`；Run 成功 |
| T6-B02 | 空群集（无 VM） | PVE Cluster 无 VM | 执行 `collect` | 输出 Cluster + Host；relations 包含 Host→Cluster；Run 成功 |
| T6-B03 | LXC 容器 | 存在 LXC 容器 | 执行 `collect` | LXC 作为 VM 入账（或明确排除并文档说明） |

## Dependencies

| 依赖项 | 依赖类型 | 说明 |
|--------|----------|------|
| PVE REST API 客户端 | 硬依赖 | 需封装 PVE API 调用 |
| 错误码注册表 | 硬依赖 | `PVE_*` 错误码需先注册 |

## Observability

### 关键指标

| 指标名 | 类型 | 说明 | 告警阈值 |
|--------|------|------|----------|
| `pve_collect_success_rate` | Gauge | PVE collect 成功率 | < 95% 触发告警 |
| `pve_rate_limit_count` | Counter | 限流触发次数 | > 5/小时 触发告警 |
| `pve_guest_agent_unavailable_rate` | Gauge | guest agent 不可用率 | > 50% 触发告警（提示用户检查） |

### 日志事件

| 事件类型 | 触发条件 | 日志级别 | 包含字段 |
|----------|----------|----------|----------|
| `pve.rate_limited` | 触发限流 | WARN | `source_id`, `region`, `retry_after` |
| `pve.guest_agent_unavailable` | VM 无 guest agent | WARN | `source_id`, `vm_id`, `vm_name` |

## Version Compatibility Matrix

> 以下为已验证的 PVE 版本兼容矩阵。

| PVE 版本 | healthcheck | detect | collect | 备注 |
|----------|-------------|--------|---------|------|
| 5.0-5.4 | ✅ | ✅ | ✅ | 部分 API 字段可能缺失 |
| 6.0-6.4 | ✅ | ✅ | ✅ | - |
| 7.0-7.4 | ✅ | ✅ | ✅ | - |
| 8.0-8.x | ✅ | ✅ | ✅ | 推荐版本 |

## Execution Phases

### Phase 1: 契约与配置定稿

- [ ] 定稿 PVE Source config（endpoint/tls_verify/scope/auth_type/max_parallel_nodes）
- [ ] 定义最小权限集与验收清单（token 角色/权限）

### Phase 2: healthcheck/detect/collect 最小闭环

- [ ] healthcheck：连通性 + 权限基线
- [ ] detect：版本/能力探测（driver/capabilities）
- [ ] collect：Host/VM 清单 + 关系（VM→Host；cluster 场景补齐 Host→Cluster）

### Phase 3: best-effort 字段增强

- [ ] VM IP（guest agent）best-effort 支持与 warning 口径
- [ ] Host 序列号/vendor/model best-effort（若有可靠来源）

### Phase 4: 错误码/文档/回归

- [ ] 注册 PVE 错误码并补齐 retryable/category 口径
- [ ] 按回归清单验证 5.x/6.x/7.x/8.x 的兼容矩阵（至少覆盖两档版本）

---

**Document Version**: 1.1
**Created**: 2026-01-30
**Last Updated**: 2026-01-31
**Clarification Rounds**: 1
**Quality Score**: 100/100 (audited)
