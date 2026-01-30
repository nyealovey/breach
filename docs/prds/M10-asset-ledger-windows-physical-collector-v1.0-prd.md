# M10：资产台账系统 - Windows 普通物理机采集 - 产品需求文档（PRD）

> 目标：支持采集 Windows 普通物理机信息（作为 Host 资产入账），补齐最小盘点字段集与可追溯 raw；与虚拟化关系解耦（默认不输出 runs_on/member_of）。

## Requirements Description

### Background

- **现状问题**：物理机资产（尤其 Windows）无法进入台账统一视图。
- **目标用户**：管理员（admin）、资产盘点人员。
- **价值**：将物理机纳入统一资产视图，为后续重复治理/合并提供基础数据。

### Scope / Out of Scope

**In Scope**

- 新增“Windows 物理机”来源采集（作为 Host 资产入账）。
- 最小字段集（identity/os/hardware/network）。
- raw 永久保留、脱敏查看（admin-only）与访问审计。

**Out of Scope**

- 软件清单、补丁、进程、用户等深度资产信息。
- 与机房/机柜/交换机等 CMDB 关系扩展。

### Success Metrics

- 可成功采集并入账（Host 资产可在 `/assets` 列表/详情查看）。
- normalized 输出 schema 校验通过率 = 100%（通过 schema 校验的记录）。

## Feature Overview

### Core Requirements

1. **Host 盘点字段（最小集合）**

- identity：
  - hostname（必需，best-effort）
  - serial_number（best-effort）
  - vendor/model（best-effort）
- os：
  - name="Windows"（或 Windows Server）
  - version（best-effort）
- hardware：
  - cpu_count、memory_bytes（best-effort）
- network：
  - ip_addresses[]（best-effort）
  - bmc_ip（如可得则写入；否则缺失）

2. **关系策略**

- 默认不输出 `runs_on/member_of`（物理机不属于虚拟化关系链）。

## Detailed Requirements

### 1) Source 类型（草案）

- 推荐先以 `third_party` SourceType 落地（避免立即扩展枚举），在 config 中声明 `collector_kind=windows_physical`。

### 2) 采集方式（实现可选，PRD 不限定）

- WinRM/WMI/PowerShell Remoting/Agent 任一可行方案。
- 必须明确权限需求与最小可行权限集（作为验收清单的一部分）。

## Acceptance Criteria

### Functional Acceptance

- [ ] 可采集 Windows 物理机并入账为 Host 资产。
- [ ] 输出 normalized 符合 `normalized-v1` schema。
- [ ] raw 永久保留；管理员可脱敏查看 raw，且访问动作写入审计。

## Execution Phases

### Phase 1: 最小闭环

- [ ] healthcheck/detect/collect 打通（最小字段集）

### Phase 2: 字段补齐与稳定性

- [ ] 补齐 serial/vendor/model 等 best-effort 字段
- [ ] 明确缺失策略（权限不足 → warning or fail 的口径）

---

**Document Version**: 1.0  
**Created**: 2026-01-30  
**Quality Score**: 60/100
