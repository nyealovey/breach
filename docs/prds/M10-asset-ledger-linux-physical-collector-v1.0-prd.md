# M10：资产台账系统 - Linux 普通物理机采集 - 产品需求文档（PRD）

> 目标：新增 Linux 普通物理机采集能力（作为 Host 资产入账），补齐最小盘点字段集与可追溯 raw。

## Requirements Description

### Background

- **现状问题**：Linux 物理机无法进入统一资产视图，盘点与治理不完整。
- **目标用户**：管理员（admin）、资产盘点人员。
- **价值**：补齐物理机资产面，支撑重复治理/合并与自定义字段管理。

### Scope / Out of Scope

**In Scope**

- 采集 Host 最小字段集（identity/os/hardware/network）。
- raw 永久保留 + 脱敏查看（admin-only）+ 审计。

**Out of Scope**

- 软件清单/包管理列表/漏洞扫描结果。
- 与机房/交换机等关系建模。

### Success Metrics

- 可成功入账并在 `/assets` 可浏览。
- normalized schema 校验通过率 = 100%（通过 schema 校验的记录）。

## Feature Overview

### Core Requirements

1. **Host 最小字段集**

- identity：hostname、serial_number（best-effort）、vendor/model（best-effort）
- os：name/version（best-effort）
- hardware：cpu_count、memory_bytes（best-effort）
- network：ip_addresses[]（best-effort）、bmc_ip（如可得）

2. **关系策略**

- 默认不输出 `runs_on/member_of`。

## Detailed Requirements

### 1) Source 类型（草案）

- 推荐先以 `third_party` SourceType 落地，在 config 中声明 `collector_kind=linux_physical`。

### 2) 采集方式（实现可选，PRD 不限定）

- SSH/Agent/CMDB 同步 任一可行方案。
- 必须明确权限需求与最小可行权限集。

## Acceptance Criteria

- [ ] 可采集 Linux 物理机并入账为 Host 资产。
- [ ] 输出 normalized 符合 `normalized-v1` schema。
- [ ] raw 永久保留；管理员可脱敏查看 raw，并记录审计事件。

---

**Document Version**: 1.0  
**Created**: 2026-01-30  
**Quality Score**: 60/100
