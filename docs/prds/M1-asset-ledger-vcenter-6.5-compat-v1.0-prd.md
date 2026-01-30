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

3. **collect_*：关键字段与关系必须满足**

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

## Acceptance Criteria

### Functional Acceptance

- [ ] 在 vCenter Server 6.5 环境中，`detect` Run 可稳定成功并输出 `target_version/capabilities/recommended_preferred_version`。
- [ ] 在 vCenter Server 6.5 环境中，`collect_hosts` Run 可稳定成功；且成功时 `relations.length > 0`。
- [ ] 在 vCenter Server 6.5 环境中，`collect_vms` Run 可稳定成功；且每个 VM 必须具备 CPU/内存/电源状态等关键字段；成功时 `relations.length > 0`。
- [ ] 若关键能力缺失（接口不存在/权限不足/关键字段缺失），Run 必须失败；UI 必须给出明确错误提示与建议动作；禁止降级伪成功。

### Quality Standards

- [ ] 文档同步：新增本 PRD，并在 `docs/roadmap.md` 记录依赖与交付物；必要时更新 `docs/design/asset-ledger-collector-reference.md`（兼容性与失败口径）。
- [ ] 回归用例：提供“vCenter Server 6.5 兼容性验证清单”（可为手工步骤 + 期望输出摘要），确保可重复验收。

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

**Document Version**: 1.0  
**Created**: 2026-01-30  
**Quality Score**: 90/100
