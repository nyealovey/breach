# M4：资产台账系统 - Hyper-V 采集（单机 + Failover Cluster（含 S2D））- 产品需求文档（PRD）

> 目标：新增 Hyper-V 来源采集能力，支持单机与故障转移群集（含 S2D 场景），产出 VM/Host/Cluster 资产与最小关系链 `VM -> Host -> Cluster`（允许缺边，但禁止 relations=0 的伪成功）。

## Requirements Description

### Background

- **现状问题**：系统当前仅实现 vCenter 插件，无法覆盖 Hyper-V 资产盘点需求。
- **目标用户**：管理员（admin）、运维/审计。
- **价值**：将 Hyper-V 纳入统一资产视图，形成多来源台账与关系链展示基础。

### Scope / Out of Scope

**In Scope**

- 插件化采集：实现 `healthcheck/detect/collect`，遵循 collector 契约（见 `docs/design/asset-ledger-collector-reference.md`）。
- 覆盖形态：
  - Hyper-V 单机：采集 Host/VM，输出 VM→Host 关系
  - Failover Cluster：采集 Cluster/Host/VM，输出 Host→Cluster、VM→Host（best-effort）关系
  - S2D：识别“这是 S2D 群集”的形态信息（best-effort），不要求输出存储明细

**Out of Scope**

- 存储明细（S2D 容量/CSV/磁盘拓扑）专项（另立 PRD）。
- 性能指标（CPU 使用率/IOPS）与告警事件。

### Success Metrics

- 在权限与网络满足前提下：
  - `detect` 成功率 = 100%
  - `collect` 成功率 ≥ 99%
- `collect` 成功时：`relations.length > 0`

## Feature Overview

### Core Requirements

1. **资产范围（最小字段集）**

- VM（kind=vm）：
  - identity：caption/hostname（best-effort）
  - hardware：cpu_count、memory_bytes、disks[]（best-effort）
  - runtime：power_state
  - network：ip_addresses（best-effort）
- Host（kind=host）：
  - identity：hostname/serial_number（best-effort）
  - os：name/version（Windows Server）
  - hardware：cpu_count、memory_bytes、disk_total（best-effort）
- Cluster（kind=cluster）：
  - identity：caption（群集名）

2. **关系必须可用**

- `relations[]` 至少一种非空：
  - VM `runs_on` Host（尽力）
  - Host `member_of` Cluster（群集模式下应可用）
- 若采集结果 `relations=0`：Run 必须失败（避免 UI 关系链不可用）。

3. **错误口径**

- 权限不足/接口不可用/关键枚举失败导致 inventory 不完整：Run 必须失败并给出结构化错误（code 稳定、retryable 标注准确）。

## Detailed Requirements

### 1) Source 配置（草案）

- SourceType：`hyperv`
- config（最小集合，具体字段可在 PRD 迭代时细化）：
  - endpoint（WinRM/HTTPS/管理入口）
  - 采集范围（单机/群集）可由 detect 自动识别并提示

### 2) detect（形态识别 + 能力探测）

- 输出：
  - target_version（Windows/Hyper-V 版本指纹，best-effort）
  - capabilities（是否群集、是否 S2D、关键枚举是否可用）

### 3) collect（资产 + 关系）

- 单机：枚举 Host + 其管理的 VM 列表
- 群集：枚举 Cluster + 节点 Host + VM（含 owner node，best-effort）

## Acceptance Criteria

### Functional Acceptance

- [ ] 单机：可采集 Host/VM，且 `relations.length > 0`（至少 VM→Host）。
- [ ] 群集：可采集 Cluster/Host/VM，且 Host→Cluster 关系可用；VM→Host 尽力输出。
- [ ] 若无法构建任何关系（relations=0），Run 必须失败并给出结构化错误。
- [ ] 所有输出 normalized 必须符合 `normalized-v1` schema。

### Quality Standards

- [ ] 文档同步：更新 `docs/roadmap.md`；补充 collector reference 中 Hyper-V 的字段示例与失败口径。

## Execution Phases

### Phase 1: 能力探测与最小闭环

- [ ] healthcheck/detect/collect 基线打通（最小字段 + relations>0）

### Phase 2: 群集与 S2D 形态支持

- [ ] Failover Cluster 枚举与关系补齐（member_of/runs_on）
- [ ] S2D 形态识别（best-effort）

### Phase 3: 回归与文档

- [ ] 至少 1 套单机 + 1 套群集环境回归（手工验收清单）

---

**Document Version**: 1.0  
**Created**: 2026-01-30  
**Quality Score**: 65/100
