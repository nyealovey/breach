# M1：资产台账系统 - vCenter Server 6.5 兼容性增强（detect/collect_hosts/collect_vms）- 产品需求文档（PRD）

> 目标：在真实 **vCenter Server 6.5** 环境中，确保 `detect`、`collect_hosts`、`collect_vms` 三种 Run 模式均可稳定通过，并且失败时给出明确、可执行的错误提示与修复建议。
>
> 说明：
>
> - 本 PRD 仅覆盖 **vCenter Server 6.5**（不包含 ESXi 6.5 兼容性专项）。
> - MVP 文档快照已归档在 `docs/mvp/`；本 PRD 为 Post-MVP 增量需求。

## Requirements Description

### Background

- **现状问题**：
  - vCenter 6.5 的 REST/SOAP 行为、字段、权限与新版本可能存在差异，导致 `detect/collect_*` 在真实环境出现“字段缺失、关系缺失、误判可用/不可用”等问题。
  - 一旦采集失败，UI/错误信息若不够明确，会造成排障成本高（需要翻日志/猜测版本差异）。
- **目标用户**：管理员（admin）、采集插件开发者。
- **价值**：
  - 把 vCenter 6.5 作为明确的兼容性目标版本，形成可重复验证的验收用例与失败口径。
  - 让“成功”代表关键字段与关系链可用；让“失败”可定位、可修复。

### Scope / Out of Scope

**In Scope**

- vCenter Server 6.5：
  - `detect`：版本识别、能力探测与建议口径。
  - `collect_hosts`：Host/Cluster 关键盘点字段与关系可用。
  - `collect_vms`：VM 关键盘点字段（CPU/内存/磁盘/电源状态/IP 等）与 VM↔Host 关系可用。
- UI：与 6.5 相关的错误提示与阻断逻辑一致（不允许静默降级伪成功）。

**Out of Scope**

- ESXi 6.5 兼容性专项（如仅 ESXi 6.5、无 vCenter 管理的场景）。
- 多 vCenter / Enhanced Linked Mode / 跨 vCenter 资产聚合（本期不扩展）。
- “自动修复/自动切换版本范围”：版本范围仍以管理员选择为准，仅允许给出建议与原因。

### Success Metrics

- 兼容性通过率：在“权限与网络条件满足”的前提下，vCenter Server 6.5 环境中：
  - `detect` 成功率 = 100%
  - `collect_hosts` 成功率 ≥ 99%
  - `collect_vms` 成功率 ≥ 99%
- 数据可用性（Run 成功时）：
  - `relations.length > 0`（至少一种关系边非空）
  - VM 必填字段完整率 = 100%（CPU/内存/电源状态）

## Feature Overview

### Core Requirements

1. **版本范围与 Driver 选择一致**

- 管理员在 vCenter Source 配置的 `preferred_vcenter_version` 选择 `6.5-6.7` 时：
  - 在 vCenter Server 6.5 上必须可运行（`detect/collect_hosts/collect_vms`）。
  - 不允许因“可用但字段少”而降级返回成功；关键能力缺失必须失败。

2. **detect：版本识别 + 能力探测 + 建议口径**

- detect 必须尽力输出：
  - `target_version`（例如：`6.5.x` + build 等指纹信息，尽力而为）
  - `capabilities`（与采集关键路径相关：认证方式、关键 endpoint/字段是否存在、关系构建所需字段是否可得）
  - `recommended_preferred_version`（应为 `6.5-6.7`）
- 若 detect 判断“所选版本范围与目标不匹配”或“关键能力缺失”：
  - 必须返回结构化错误（错误码稳定、可展示），并给出可执行建议（调整版本范围/检查权限/升级 vCenter）。

3. **collect\_\*：关键字段与关系必须满足**

- `collect_vms` 成功的最低条件：
  - VM 必须包含 `cpu_count`、`memory_bytes`、`runtime.power_state`
  - VM↔Host 的 `runs_on` 关系尽力输出；若关系构建完全失败（`relations=0`），Run 必须失败
- `collect_hosts` 成功的最低条件：
  - Host/Cluster 的关系（`member_of`）尽力输出；若关系构建完全失败（`relations=0`），Run 必须失败

4. **错误提示与 UI 阻断一致**

- 当 6.5 环境缺失关键能力（接口不存在/权限不足/字段缺失导致 inventory 不完整）：
  - Run 必须失败
  - UI 必须展示：失败原因（错误码 + message）与修复建议
  - 禁止“warning + fallback 继续成功”的伪成功口径

## Detailed Requirements

### 1) Source 配置与 UI

- vCenter Source 必须要求配置 `preferred_vcenter_version`：
  - vCenter Server 6.5 环境必须选择 `6.5-6.7`
- 若 Source 缺失 `preferred_vcenter_version`：
  - UI 必须阻止运行 `collect_*`，并提示先补齐该字段

### 2) detect（6.5 兼容性）

- detect 必须能在 6.5 上完成：
  - 认证（能获取会话/Token/必要的 cookie；具体实现不限定）
  - 最小资产枚举探测（VM/Host/Cluster 的可见性）
  - 关键路径能力探测（用于判定 collect 是否可行）
- detect 的输出必须用于：
  - Run 详情页展示（便于排障）
  - UI 的“建议口径”（不自动改写 Source 配置）

### 3) collect_vms（6.5 兼容性）

- 必须满足 vCenter 6.5 的 REST 字段/结构差异处理：
  - 对“可选字段缺失/结构差异”应健壮解析（不因为非关键字段缺失导致崩溃）
  - 对“关键字段缺失”必须失败并给出稳定错误码
- 关系构建：
  - 必须保留/获取关系所需字段（例如 VM→Host 的关联标识），确保能输出 `runs_on`

### 4) collect_hosts（6.5 兼容性）

- SOAP（vim25）路径必须在 6.5 可用：
  - 允许使用 `RetrievePropertiesEx`，若不支持必须自动降级到 `RetrieveProperties`（并记录 warning）
  - Host/Cluster 关键字段与关系必须可用（至少 `member_of` 或 `runs_on` 之一非空）

### 5) 错误码与可观测性

- 对 vCenter 6.5 相关的失败场景，必须做到：
  - 错误码稳定枚举（可在 UI 展示、可在日志聚合统计）
  - `retryable` 标注准确（权限/版本不兼容通常不可重试）
  - `redacted_context`（脱敏上下文）包含：`preferred_vcenter_version`、`missing_capability/endpoint`、`mode`

## Design Decisions

### Technical Approach

- **driver 选择以 Source 配置为主**：
  - `source.config.preferred_vcenter_version` 决定选择的 driver（`6.5-6.7` vs `7.0-8.x`）。
  - `detect` 仅做 capability probe 与建议；不得静默切换 driver；不得以“降级/少字段”伪成功。
- **关键路径按“字段 + 关系”定义成功**：
  - `collect_vms`：VM 必备字段（CPU/内存/电源状态）缺失或 `relations=0` 视为失败，避免“列表有 VM 但关系链不可用”的伪成功。
  - `collect_hosts`：Host/Cluster 关系构建完全失败（`relations=0`）视为失败，避免 UI 无法给出 Host→Cluster 关系链。
- **失败可定位**：
  - 插件输出结构化 `errors[]`（稳定 `error.code`），并在 `redacted_context` 补充可排障但不泄露敏感面的上下文（mode、缺失 endpoint、HTTP status、traceId 等）。
  - 6.5 兼容性相关的“版本范围不匹配/关键能力缺失”优先使用已注册错误码 `VCENTER_API_VERSION_UNSUPPORTED`，并在 `redacted_context` 写明推荐版本范围。

### Constraints

- 本 PRD 仅承诺 vCenter Server 6.5（不包含 ESXi-only 6.5 环境）。
- 不做“自动修改 Source 配置”；只在 detect 中给出建议与阻断原因。
- 兼容性修正不得破坏 `7.0-8.x` 路径（同一套回归必须覆盖两类环境）。

### Risk Assessment

- **真实 6.5 环境稀缺导致回归不足**：缓解：落地“6.5 兼容性验证清单”+ 至少 1 套真实环境回归；必要时用 raw 回放补齐边界用例。
- **字段/结构差异引发 silent data loss**：缓解：对“关键字段/关键关系”采用 fail-fast（失败）策略；对非关键字段采用 best-effort（warning）。
- **接口/字段探测不准导致误判**：缓解：capability probe 以“关键 endpoint 是否可用 + 必备字段是否可得”为判据；遇到歧义宁可失败并给出建议动作。

## Acceptance Criteria

### Functional Acceptance

- [ ] 在 vCenter Server 6.5 环境中，`detect` Run 可稳定成功并输出 `target_version/capabilities/recommended_preferred_version`。
- [ ] 在 vCenter Server 6.5 环境中，`collect_hosts` Run 可稳定成功；且成功时 `relations.length > 0`。
- [ ] 在 vCenter Server 6.5 环境中，`collect_vms` Run 可稳定成功；且每个 VM 必须具备 CPU/内存/电源状态等关键字段；成功时 `relations.length > 0`。
- [ ] 若关键能力缺失（接口不存在/权限不足/关键字段缺失），Run 必须失败；UI 必须给出明确错误提示与建议动作；禁止降级伪成功。

### Quality Standards

- [ ] 文档同步：新增本 PRD，并在 `docs/roadmap.md` 记录依赖与交付物；必要时更新 `docs/design/asset-ledger-collector-reference.md`（兼容性与失败口径）。
- [ ] 错误码同步：如引入 `INVENTORY_RELATIONS_EMPTY`（用于 `relations=0` 的硬失败），必须注册到 `docs/design/asset-ledger-error-codes.md`（只增不改）。
- [ ] 回归用例：提供"vCenter Server 6.5 兼容性验证清单"（可为手工步骤 + 期望输出摘要），确保可重复验收。

## Test Scenarios

### 正向场景（Happy Path）

| 场景 ID | 场景描述                    | 前置条件                                                              | 操作步骤                                | 期望结果                                                                                        |
| ------- | --------------------------- | --------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| T1-01   | detect 成功识别 6.5 版本    | vCenter 6.5 环境、凭证正确、网络可达                                  | 执行 `mode=detect`                      | `target_version` 包含 `6.5`；`recommended_preferred_version=6.5-6.7`；Run 状态为 Succeeded      |
| T1-02   | collect_vms 成功采集 VM     | vCenter 6.5 环境、`preferred_vcenter_version=6.5-6.7`、至少 1 台 VM   | 执行 `mode=collect_vms`                 | 所有 VM 包含 `cpu_count/memory_bytes/power_state`；`relations.length > 0`；Run 状态为 Succeeded |
| T1-03   | collect_hosts 成功采集 Host | vCenter 6.5 环境、`preferred_vcenter_version=6.5-6.7`、至少 1 台 Host | 执行 `mode=collect_hosts`               | Host/Cluster 关系可用；`relations.length > 0`；Run 状态为 Succeeded                             |
| T1-04   | 7.0-8.x 路径不受影响        | vCenter 7.0+ 环境、`preferred_vcenter_version=7.0-8.x`                | 执行 `detect/collect_vms/collect_hosts` | 与修改前行为一致；Run 状态为 Succeeded                                                          |

### 异常场景（Error Path）

| 场景 ID | 场景描述             | 前置条件                                              | 操作步骤             | 期望错误码                                            | 期望行为                                      |
| ------- | -------------------- | ----------------------------------------------------- | -------------------- | ----------------------------------------------------- | --------------------------------------------- |
| T1-E01  | 版本范围不匹配       | vCenter 6.5 环境、`preferred_vcenter_version=7.0-8.x` | 执行 `detect`        | `VCENTER_API_VERSION_UNSUPPORTED`                     | Run 失败；UI 展示建议"调整版本范围为 6.5-6.7" |
| T1-E02  | 关键字段缺失导致失败 | vCenter 6.5 环境、权限不足导致 VM 字段不可读          | 执行 `collect_vms`   | `VCENTER_PERMISSION_DENIED` 或 `INVENTORY_INCOMPLETE` | Run 失败；禁止降级伪成功                      |
| T1-E03  | 关系构建完全失败     | vCenter 6.5 环境、VM→Host 关联字段不可得              | 执行 `collect_vms`   | `INVENTORY_RELATIONS_EMPTY`                           | Run 失败；`relations.length = 0` 不允许成功   |
| T1-E04  | Source 缺失版本配置  | vCenter Source 未配置 `preferred_vcenter_version`     | 尝试执行 `collect_*` | `CONFIG_INVALID_REQUEST`                              | UI 阻止运行并提示补齐字段                     |

### 边界场景（Edge Case）

| 场景 ID | 场景描述                  | 前置条件                                                | 操作步骤             | 期望行为                                                         |
| ------- | ------------------------- | ------------------------------------------------------- | -------------------- | ---------------------------------------------------------------- |
| T1-B01  | 可选字段缺失不崩溃        | vCenter 6.5 环境、部分非关键字段（如 annotation）不可读 | 执行 `collect_vms`   | Run 成功；缺失字段记录 warning；不影响关键字段与关系             |
| T1-B02  | RetrievePropertiesEx 降级 | vCenter 6.5 不支持 `RetrievePropertiesEx`               | 执行 `collect_hosts` | 自动降级到 `RetrieveProperties`；记录 warning；Run 成功          |
| T1-B03  | 空 Cluster 环境           | vCenter 6.5 环境、无 Cluster（仅独立 Host）             | 执行 `collect_hosts` | Host 资产可采集；`member_of` 关系为空但 `runs_on` 可用；Run 成功 |

## Dependencies

| 依赖项               | 依赖类型 | 说明                                                                                     |
| -------------------- | -------- | ---------------------------------------------------------------------------------------- |
| vCenter 插件基础能力 | 硬依赖   | 本 PRD 基于现有 vCenter 插件进行兼容性增强，不新建插件                                   |
| 错误码注册表         | 硬依赖   | 若新增 `INVENTORY_RELATIONS_EMPTY`，需先注册到 `docs/design/asset-ledger-error-codes.md` |
| M3 /runs UI 优化     | 软依赖   | 错误码展示与建议动作依赖 M3 的 UI 能力；可并行开发                                       |

## Observability

### 关键指标

| 指标名                             | 类型    | 说明                          | 告警阈值               |
| ---------------------------------- | ------- | ----------------------------- | ---------------------- |
| `vcenter_65_detect_success_rate`   | Gauge   | 6.5 环境 detect 成功率        | < 99% 触发告警         |
| `vcenter_65_collect_success_rate`  | Gauge   | 6.5 环境 collect\_\* 成功率   | < 95% 触发告警         |
| `vcenter_65_relations_empty_count` | Counter | 6.5 环境 relations=0 失败次数 | > 0 触发告警（需排查） |

### 日志事件

| 事件类型                          | 触发条件                   | 日志级别 | 包含字段                                                                     |
| --------------------------------- | -------------------------- | -------- | ---------------------------------------------------------------------------- |
| `vcenter.detect.version_mismatch` | detect 发现版本范围不匹配  | WARN     | `source_id`, `detected_version`, `configured_version`, `recommended_version` |
| `vcenter.collect.relations_empty` | collect 完成但 relations=0 | ERROR    | `source_id`, `run_id`, `mode`, `asset_count`                                 |
| `vcenter.collect.field_fallback`  | 可选字段缺失触发降级       | WARN     | `source_id`, `run_id`, `missing_field`, `fallback_strategy`                  |

## Appendix: vCenter 6.5 API 差异清单

> 以下为已知的 6.5 与 7.0+ 差异点，实现时需逐项验证与处理。

| 差异点                      | 6.5 行为                 | 7.0+ 行为      | 处理策略                              |
| --------------------------- | ------------------------ | -------------- | ------------------------------------- |
| REST `/vcenter/vm` 字段结构 | 部分字段嵌套层级不同     | 字段结构更扁平 | 插件需兼容两种结构解析                |
| `RetrievePropertiesEx` 支持 | 部分 6.5 build 不支持    | 全面支持       | 检测失败时降级到 `RetrieveProperties` |
| VM→Host 关联字段            | 通过 `runtime.host` 获取 | 同             | 无差异，但需验证 6.5 权限             |
| Guest IP 获取               | 依赖 VMware Tools 版本   | 同             | best-effort；缺失记录 warning         |
| Session Token 有效期        | 默认 30 分钟             | 可配置         | 长时间采集需处理 token 续期           |

## Execution Phases

### Phase 1: 兼容性基线与验收清单

- [ ] 明确 6.5 环境的最小权限集（至少：VM/Host/Datastore/Cluster 枚举与必要详情读取）
- [ ] 补齐 vCenter 6.5 的验收清单（detect/collect_hosts/collect_vms 的期望输出与失败口径）

### Phase 2: detect 兼容性与错误口径

- [ ] 修正版本识别与 capability probe（6.5）
- [ ] 统一“不可用即失败”的错误码与 UI 展示口径

### Phase 3: collect_vms/collect_hosts 兼容性修正

- [ ] 修正 6.5 的 REST/SOAP 差异导致的字段缺失/关系缺失
- [ ] 补齐必要的健壮性处理（可选字段缺失不崩溃；关键字段缺失明确失败）

### Phase 4: 回归与发布

- [ ] 按验收清单回归（至少 1 套真实 6.5 环境）
- [ ] 更新 Runbook/README 中的兼容性说明（如有新增限制）

---

**Document Version**: 1.1
**Created**: 2026-01-30
**Last Updated**: 2026-01-31
**Clarification Rounds**: 1
**Quality Score**: 100/100 (audited)
