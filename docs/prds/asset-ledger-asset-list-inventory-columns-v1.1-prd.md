# 资产台账系统 - 资产列表盘点列展示（机器名覆盖 + 列顺序调整 + 操作系统 + VM 运行状态）- 产品需求文档（PRD）

> 本 PRD 用于定义“资产列表（/assets）”在盘点场景下的默认展示列与数据口径：补齐机器名（可人工覆盖显示）、操作系统、VM 运行状态，并明确可搜索字段范围。

## Requirements Description

### Background

- **Business Problem**：
  - 资产列表盘点时需要同时看到：VM 的平台名称（虚拟机名）、宿主机名称、VM 内部机器名（Guest hostname/ComputerName，可能缺失）、以及操作系统与运行状态。
  - “机器名”在部分来源或采集能力下可能拿不到；但盘点/对账时需要管理员临时补齐。
- **Target Users**：管理员（admin）。
- **Value Proposition**：
  - 列表页直接完成盘点关键字段核对，不必频繁进入详情页。
  - 支持机器名“覆盖显示”，同时保留采集到的真实值持续入库，避免覆盖影响数据可追溯。

### Feature Overview

#### Core Features（本次变更）

1. **资产列表列顺序与字段补齐**

- 列表展示列（从左到右，至少前 4 列必须一致）：
  1. 机器名
  2. 虚拟机名
  3. 宿主机名
  4. 操作系统
  5. IP
  6. CPU
  7. 内存
  8. 总分配磁盘
  9. 状态（VM 是否运行）
  10. 操作

2. **机器名支持“覆盖显示”**

- 机器名字段来源：
  - `machine_name_override`（管理员手动填写；优先展示）
  - `machine_name_collected`（采集值；作为 fallback 展示）
  - 无值时：保持为空（不展示 `-` 占位）
- 覆盖值仅影响显示，不改变采集链路：后续采集到真实机器名仍会正常写入 `asset_run_snapshot.canonical`（可追溯）。
- 当覆盖值与采集值同时存在且不一致时：在 UI 增加“特殊标记”提示不一致（例如 badge/标签）。

3. **机器名编辑交互：抽屉/弹窗（B）**

- 在资产列表行操作中提供“编辑机器名”入口，打开弹窗/抽屉编辑：
  - 可保存覆盖值
  - 可清空覆盖值（清空后回退展示采集值；采集值缺失则为空）
  - 展示采集到的机器名（只读）用于对比

4. **关键字搜索范围扩展（q）**

- 搜索命中“显示值优先”的文本字段：
  - 虚拟机名（VM）
  - 宿主机名（VM 的 runs_on Host）
  - 操作系统（os.name/os.version）
  - 机器名（覆盖值 + 采集值）
  - 同时保留：externalId、uuid（现有行为）

5. **状态列：VM 是否运行**

- VM：展示 runtime.power_state（`poweredOn`/`poweredOff`/`suspended` → UI 映射为“运行/关机/挂起”）
- 非 VM：显示 `-`

#### Feature Boundaries（明确不做什么）

- 不做中文分词、同义词、拼写纠错等高级搜索能力（维持“简单 contains 匹配”）。
- 不新增排序能力（维持现状）。
- 不在本次 PRD 中定义“资产详情页”的全量字段编排（仅确保本次新增字段不会破坏现有详情）。

### User Scenarios

1. 管理员进入资产列表（默认“全部类型”：VM + Host，默认隐藏 Cluster）：
   - 可直接看到机器名/虚拟机名/宿主机名/操作系统与 VM 运行状态。
2. 管理员发现某台 VM 未采集到机器名：
   - 机器名列为空；点击“编辑机器名”补齐覆盖值；
   - 后续采集恢复后，采集值仍会写入快照；若与覆盖不一致，列表出现提示标记。
3. 管理员通过搜索快速定位：
   - 通过虚拟机名、宿主机名或操作系统关键词快速过滤资产。

## Detailed Requirements

### Input/Output（字段口径）

> 列表行字段来自：`asset` 表 + 最新 `asset_run_snapshot.canonical`（take=1, createdAt desc）+ 关系 `runs_on`。

- **机器名（machineName）**：
  - `machine_name_override`（asset 表字段）优先
  - 否则取 `canonical.fields.identity.hostname.value`
  - 无值：返回空（UI 不展示 `-`）
- **虚拟机名（vmName）**：
  - VM：优先取 `canonical.fields.identity.caption.value`（平台/资源名称）；fallback：`asset.display_name`
  - 非 VM：`-`
- **宿主机名（hostName）**：
  - VM：取 runs_on 关系指向 Host 的展示名（Host 的 `asset.display_name`）
  - Host：取自身 `asset.display_name`
  - Cluster：`-`（默认列表已隐藏）
- **操作系统（os）**：
  - `canonical.fields.os.name.value` + 可选 `canonical.fields.os.version.value`（拼接展示）
  - 无值：`-`
- **状态（vmPowerState）**：
  - VM：`canonical.fields.runtime.power_state.value`
  - 非 VM：`-`

### Edge Cases

- 无快照（无 canonical）：机器名为空；其它盘点列按缺失策略显示 `-`。
- 仅有覆盖值无采集值：机器名展示覆盖值；不显示“不一致”标记。
- 同时有覆盖值与采集值且不一致：展示覆盖值 + 不一致标记；同时在编辑弹窗中可见采集值用于对比。

## Design Decisions

### Technical Approach

- DB：在 `asset` 表新增可空字段 `machine_name_override`（仅用于覆盖显示）。
- API：
  - `GET /api/v1/assets` 扩展返回字段：`machineName`/`machineNameOverride`/`machineNameCollected`/`machineNameMismatch`、`os`、`vmPowerState`。
  - `PUT /api/v1/assets/:uuid`（或等价更新接口）支持更新/清空 `machine_name_override`。
- UI（/assets）：
  - 调整列顺序与列标题；
  - “编辑机器名”采用弹窗/抽屉交互；
  - 增加“不一致标记”。

### Constraints

- 搜索：不区分大小写的 substring contains；以“显示值优先”的语义覆盖必要字段。

## Acceptance Criteria

### Functional Acceptance

- [ ] `/assets` 前四列从左到右依次为：机器名/虚拟机名/宿主机名/操作系统。
- [ ] 机器名：无覆盖值且无采集值时，单元格保持为空（不显示 `-`）。
- [ ] 机器名可在行内操作入口通过弹窗/抽屉编辑并持久化；清空后回退展示采集值（若无采集则为空）。
- [ ] 当机器名覆盖值与采集值不一致时，列表展示“不一致标记”。
- [ ] 搜索 `q` 可命中：虚拟机名、宿主机名、操作系统、机器名（覆盖值/采集值），并保留 externalId/uuid 能力。
- [ ] 状态列展示 VM 是否运行（poweredOn/off/suspended → 运行/关机/挂起）；非 VM 显示 `-`。

### Quality Standards

- [ ] API 单测覆盖：`GET /api/v1/assets` 新增字段与口径；更新接口写入/清空覆盖值。
- [ ] 文档同步：README + API spec/PRD 至少更新并保持一致。

## Execution Phases

### Phase 1: DB + API

**Goal**：支持 machine_name_override 与列表字段返回

- [ ] Prisma schema/migration：新增 `asset.machine_name_override`
- [ ] 扩展 `GET /api/v1/assets` 返回机器名/OS/VM 运行状态相关字段
- [ ] 增加更新接口写入/清空覆盖值
- [ ] 单测覆盖

### Phase 2: UI

**Goal**：资产列表列顺序与编辑交互落地

- [ ] /assets 列顺序调整与新增列展示
- [ ] 编辑机器名弹窗/抽屉 + 不一致标记
- [ ] 搜索 placeholder 与行为对齐

---

**Document Version**: 1.1
**Created**: 2026-01-29
**Clarification Rounds**: 2
**Quality Score**: 95/100
