# M2：资产台账系统 - 采集项优化（补齐 Datastore 明细：名称 + 容量）- 产品需求文档（PRD）

> 目标：在保留现有 “Host datastore 总容量” 口径的基础上，补齐 **Datastore 明细**（每个 datastore 的名称与容量），用于盘点与容量核对。
>
> 背景：目前仅有总容量（sum），缺少 datasource（Datastore）层面的拆分信息，无法定位容量分布。

## Requirements Description

### Background

- **现状问题**：
  - Host 已有 datastore 总容量口径（sum），但缺少每个 datastore 的 `name/capacity`，盘点时只能看到“总数”，看不到“分布”。
  - 一旦总容量异常，无法在系统内快速定位是哪个 datastore 造成的偏差。
- **目标用户**：管理员（admin）、采集插件开发者。
- **价值**：
  - Host 资产详情可直接查看 datastore 明细（名称 + 容量），并与总容量一致对齐。

### Scope / Out of Scope

**In Scope**

- vCenter（SOAP/REST 以现有实现为准）采集 Host 的 datastore 明细：
  - `datastores[].name`
  - `datastores[].capacity_bytes`
- 保留现有 datastore 总容量字段与口径（当前只有总容量）。
- UI：在资产详情（/assets/[uuid]）可见（至少展示表格，不要求列表页展示）。

**Out of Scope**

- datastore 的 used/free/committed/uncommitted 等使用量（本期不做）。
- datastore 级别的健康状态、告警、性能指标（后续另立 PRD）。
- cluster 维度的 datastore 聚合（可后续扩展）。

### Success Metrics

- 覆盖率（Host）：
  - `storage.datastores` 非空率 ≥ 95%（分母：SOAP 登录成功且该 Host 可枚举 datastore 的场景）
- 一致性：
  - `datastore_total_bytes` 与 `sum(storage.datastores[].capacity_bytes)` 口径一致（同一过滤规则）

## Feature Overview

### Core Requirements

1. **新增结构化字段：storage.datastores[]**

- 在 `normalized-v1` 中新增结构化字段（避免塞入 `attributes.*`）：
  - `storage.datastores[]`：对象数组
    - `name`（string，必需）
    - `capacity_bytes`（number/int，bytes，必需）

2. **保留现有“总容量”字段与口径**

- 继续保留并写入现有总容量字段（不改变字段名与现有依赖方的读取方式）。
- 明确一致性口径：
  - `datastore_total_bytes = sum(datastores[].capacity_bytes)`（在相同过滤规则下）

3. **UI 展示（资产详情）**

- Host 资产详情页新增一个 “Datastores” 区块：
  - 表格列：名称、容量（GiB/TiB，1024 进制）
  - 表格底部/顶部展示：总容量（与现有总容量字段一致）
- 若无数据：
  - 展示空状态（说明：无权限/未采集到/该 Host 无 datastore 等），并提示去 Run 详情查看 warnings/errors。

## Detailed Requirements

### 1) Schema 变更（必须）

#### normalized-v1

新增：

- `storage`（object，可选）
  - `datastores`（array，可选）
    - item:
      - `name`（string，minLength=1）
      - `capacity_bytes`（integer >= 0）

#### canonical-v1

canonical 聚合后字段落点：

- `canonical.fields.storage.datastores.value`：数组（对象：name/capacity_bytes）
- `canonical.fields.storage.datastores.sources[]`：保留来源证据（source_id/run_id/record_id）

其中 value 的单个对象最小字段集为：

- `name`
- `capacity_bytes`

> 备注：本期不做 datastore 的稳定唯一标识（`id`）；canonical 的数组字段去重暂以 `name` 为主（同 source/run 内不应重复；跨来源按并集去重）。

### 2) 采集口径（Host）

- 采集来源：vCenter Host 的 datastore 列表与 datastore `summary.capacity`（bytes）
- 过滤规则：与现有总容量口径保持一致（避免 list 与 sum 不一致）
  - 若现有口径已明确过滤（例如排除 NFS/NFS41/vSAN），本期 list 也必须应用相同过滤

### 3) 失败/缺失策略

- datastore 明细为“盘点增强字段”，不应导致整个 collect 失败：
  - 若无权限读取 datastore 列表：记录 warning（错误码稳定），Run 仍可成功
  - 若解析失败/数据格式异常：记录 warning，并尽力保留已解析部分

## Acceptance Criteria

### Functional Acceptance

- [ ] Host 的 `normalized-v1` 输出包含 `storage.datastores[]`（name + capacity_bytes）。
- [ ] Host 的 canonical 快照中包含 `fields.storage.datastores`，并且保留来源证据。
- [ ] 系统保留现有 datastore 总容量字段（当前已有的 sum），并保证与明细求和口径一致。
- [ ] 资产详情页（Host）展示 Datastores 表格（名称 + 容量），并展示总容量。

### Quality Standards

- [ ] Schema 同步：更新 `docs/design/asset-ledger-json-schema.md` 与对应的 schema 文件（normalized-v1、canonical-v1）。
- [ ] API/契约同步：更新 `docs/design/asset-ledger-collector-reference.md`（字段说明与示例）。
- [ ] 回归：至少在 1 个真实 vCenter 环境中验证 Host datastores 展示与总容量一致。

## Execution Phases

### Phase 1: Schema + 契约

- [ ] 扩展 normalized-v1 / canonical-v1 schema：新增 `storage.datastores`
- [ ] 更新 collector contract 文档（字段含义、示例、缺失策略）

### Phase 2: 采集与落库

- [ ] 插件采集 Host datastores（name/capacity_bytes）
- [ ] Core 入库与 canonical 聚合（含 provenance）

### Phase 3: UI 展示（详情页）

- [ ] Host 详情页增加 Datastores 区块（表格 + 总容量）
- [ ] 空状态/告警提示（引导到 Run 详情）

---

**Document Version**: 1.0  
**Created**: 2026-01-30  
**Quality Score**: 90/100
