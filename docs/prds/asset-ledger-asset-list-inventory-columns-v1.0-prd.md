# 资产台账系统 - 资产列表盘点列展示（主机名/虚拟机名/IP/CPU/内存/总分配磁盘）- 产品需求文档（PRD）

> 本 PRD 用于定义“资产列表（/assets）”在盘点场景下的默认展示列与数据口径，提升台账可读性与盘点效率。

## Requirements Description

### Background

- **Business Problem**：
  - 资产列表当前展示 `Last Seen` 与 `来源` 列，但盘点场景更关注“资产是谁（主机/虚拟机）+ 在哪（IP）+ 规模（CPU/内存/磁盘）”。
  - 列表缺少关键盘点字段，导致需要逐个进入详情页才能核对容量与规格，效率低。
- **Target Users**：管理员（admin）。
- **Value Proposition**：
  - 列表页即可完成基础盘点与粗粒度容量核对。
  - 列展示更贴合“总台账盘点”场景，减少噪声列。

### Feature Overview

#### Core Features（本次变更）

1. **资产列表默认展示列调整**

- 显示列（从左到右）：
  - 主机名
  - 虚拟机名
  - IP（取 `ip_addresses` 全量）
  - CPU（vCPU 数量）
  - 内存（GiB/TiB，1024 进制）
  - 总分配磁盘（GiB/TiB，1024 进制）
  - 状态
  - 操作
- 不显示列：
  - `Last Seen`
  - `来源`

2. **Cluster 默认不在“全部类型”中出现**

- “全部类型”默认展示范围：VM + Host。
- Cluster 仅在类型筛选为 `cluster` 时出现。

#### Feature Boundaries（明确不做什么）

- 不新增/调整资产详情页字段展示。
- 不新增排序能力（维持现状）。
- 不移除现有筛选项（例如按来源过滤仍保留）。

### User Scenarios

1. 管理员进入资产列表（默认“全部类型”）：
   - 列表仅展示 VM 与 Host；
   - 可直接看到主机/虚拟机的 IP、CPU、内存、总分配磁盘用于盘点。
2. 管理员切换筛选为 Cluster：
   - 列表显示 Cluster 资产；未适配字段显示 `-`（按缺失策略）。

## Detailed Requirements

### Input/Output

#### 列表行字段口径（来自最新 canonical 快照）

- 主机名：
  - VM：优先取该 VM 的 `runs_on` 关系指向 Host 的 `display_name`；缺失则 `-`
  - Host/Cluster：取资产自身 `display_name`
- 虚拟机名：
  - VM：取资产自身 `display_name`
  - Host/Cluster：`-`
- IP：
  - 取 `canonical.fields.network.ip_addresses.value`（数组），过滤空值并去重后以 `", "` 拼接；无值则 `-`
- CPU：
  - 取 `canonical.fields.hardware.cpu_count.value`；无值则 `-`
- 内存：
  - 取 `canonical.fields.hardware.memory_bytes.value`；按 1024 进制格式化为 GiB/TiB；无值则 `-`
- 总分配磁盘：
  - 取 `canonical.fields.hardware.disks.value[].size_bytes` 求和；按 1024 进制格式化为 GiB/TiB；无值则 `-`

### Edge Cases

- 资产没有任何快照（无 canonical）：所有盘点列显示 `-`（主机名/虚拟机名按 fallback 规则仍可展示）。
- VM 未能构建 `runs_on`：主机名为 `-`（不影响 VM 行展示）。
- IP 地址过多：允许换行展示（避免被截断）。

## Design Decisions

### Technical Approach

- 列表接口 `GET /api/v1/assets` 返回用于列表展示的聚合字段（hostName/vmName/ip/cpuCount/memoryBytes/totalDiskBytes）。
- 为避免 N+1 查询：通过 Prisma 在 asset 列表查询中关联 `runSnapshots` 的最新一条 canonical 快照（take=1）。

### Constraints

- 列表展示单位统一使用 1024 进制（GiB/TiB）。

## Acceptance Criteria

### Functional Acceptance

- [ ] `/assets` 列表默认展示列为：主机名/虚拟机名/IP/CPU/内存/总分配磁盘/状态/操作。
- [ ] `/assets` 不展示 `Last Seen` 与 `来源` 列。
- [ ] “全部类型”默认不展示 Cluster；切换类型到 Cluster 时才出现 Cluster 行。
- [ ] IP 展示取 `ip_addresses` 全量并用逗号分隔（去重、过滤空值）。
- [ ] 内存与磁盘展示单位为 GiB/TiB（1024 进制）。

### Quality Standards

- [ ] 文档同步：SRS/UI spec/API spec/README 至少更新一处并保持一致。
- [ ] 单测：`GET /api/v1/assets` 返回字段与计算口径有测试覆盖。

## Execution Phases

### Phase 1: 契约与 UI

**Goal**：完成列展示与口径对齐

- [ ] 调整资产列表列（移除 Last Seen/来源，新增盘点列）
- [ ] Cluster 默认隐藏策略落地

### Phase 2: API 与数据拼装

**Goal**：列表接口返回盘点列字段

- [ ] API 返回 hostName/vmName/ip/cpuCount/memoryBytes/totalDiskBytes
- [ ] IP 全量拼接与磁盘汇总计算
- [ ] 测试与文档更新

---

**Document Version**: 1.0
**Created**: 2026-01-29
**Clarification Rounds**: 1
**Quality Score**: 92/100
