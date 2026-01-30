# M11：资产台账系统 - 阿里云采集（ECS 为主）- 产品需求文档（PRD）

> 目标：新增阿里云来源采集能力（以 ECS 为主），将云上 VM 纳入统一资产视图；raw 永久保留并可脱敏查看（admin-only）。

## Requirements Description

### Background

- **现状问题**：系统未实现阿里云采集，无法覆盖云上资产盘点。
- **目标用户**：管理员（admin）。
- **价值**：形成“本地虚拟化 + 云”统一台账的基础能力。

### Scope / Out of Scope

**In Scope**

- 插件化采集：`healthcheck/detect/collect`
- 采集对象：ECS（作为 VM 资产入账）
- 最小字段集（identity/os/hardware/network/runtime best-effort）
- 关系：云侧通常无法映射宿主/集群，允许 relations 为空

**Out of Scope**

- 云资源全家桶（SLB/RDS/VPC/安全组等）专项。
- 账单/成本/标签治理专项。

### Success Metrics

- `collect` 成功后 ECS 可在 `/assets` 浏览（列表 + 详情）。
- raw 永久保留；管理员可脱敏查看 raw 且写入审计。

## Feature Overview

### Core Requirements

1. **ECS 字段（最小集合）**

- identity：cloud_native_id / hostname / caption（best-effort）
- os：name/version（best-effort）
- hardware：cpu_count/memory_bytes（best-effort）
- network：ip_addresses（公网/私网，best-effort）
- runtime：power_state（best-effort，可映射为 running/stopped 等到规范枚举）

2. **错误口径**

- 凭证/权限不足/配额限制等失败必须结构化错误，并给出建议动作（更换 AK/SK、检查 RAM 权限等）。

## Acceptance Criteria

- [ ] 可采集 ECS 并入账为 VM 资产。
- [ ] 输出 normalized 符合 `normalized-v1` schema。
- [ ] raw 永久保留；管理员可脱敏查看 raw，且访问动作写入审计。

---

**Document Version**: 1.0  
**Created**: 2026-01-30  
**Quality Score**: 60/100
