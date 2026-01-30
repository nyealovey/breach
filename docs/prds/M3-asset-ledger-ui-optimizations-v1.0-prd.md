# M3：资产台账系统 - UI 优化（/assets：筛选/搜索 + 列配置（DB 持久化）+ 详情信息组织 + 关系展示）- 产品需求文档（PRD）

> 目标：围绕 `/assets` 页面做可用性与可观测性提升，优先级顺序：A（筛选/搜索）→ B（列配置）→ C（详情信息组织）→ D（关系展示）。
>
> 约束：列配置需要 **按用户持久化到数据库**（非 localStorage / 非仅 URL）。
>
> 备注：`/runs` 的 UI 优化需求将以独立 PRD 管理（本 PRD 不包含）。

## Requirements Description

### Background

- **现状问题**：
  - `/assets` 列表虽已有基础搜索与筛选，但：
    - 查询状态不易复用/分享（与 URL 同步不足时，会影响回退/书签/分享）
    - 表格列固定，无法按不同盘点任务调整信息密度
  - 资产详情页当前偏“调试视角”（flatten canonical），对盘点用户不友好：关键字段难以快速定位、关系链不直观。
- **目标用户**：管理员（admin）；普通用户（user）若已开放阅读权限，可复用同样体验（本 PRD 不强制拓展权限范围）。
- **价值**：
  - 列表页更像“盘点工作台”：可筛可搜、列可配置、状态可复用。
  - 详情页更像“资产卡片”：关键字段聚合展示，同时保留调试入口。

### Scope / Out of Scope

**In Scope**

- `/assets` 列表：
  - A：筛选/搜索增强（含 URL 同步）
  - B：列配置（显示/隐藏）+ DB 持久化（按用户）
- `/assets/[uuid]` 详情：
  - C：信息组织（盘点摘要 + 分组展示）
  - D：关系展示增强（关系链更直观、可导航）

**Out of Scope**

- 大规模 BI/报表（导出、透视分析等）。
- 多租户/组织隔离引入导致的 UI 大改（另立 PRD）。
- `/runs` 页面优化（拆分到独立 PRD）。

### Success Metrics

- 列表页可用性：
  - “一次盘点任务”内列调整次数减少（可通过用户反馈/操作日志观察）
  - 列配置命中率：用户二次进入仍能恢复上次列配置（DB 持久化）
- 详情页可读性：
  - 用户无需展开 canonical 大表即可找到 Top 10 关键字段（IP/CPU/内存/磁盘/OS/电源状态等）

## Feature Overview

### A) /assets 筛选与搜索增强（优先级最高）

1. **URL 同步（可复制/可分享/可回退）**

- 列表页的查询条件必须与 URL query 同步：
  - `q`、`asset_type`、`exclude_asset_type`、`source_id`、`page`、`pageSize`
- 支持：
  - 刷新不丢条件
  - 浏览器前进/后退可恢复条件
  - 复制 URL 给他人可复现同样的列表视图（权限允许前提下）

2. **筛选项补齐（最小集合）**

在现有基础上，新增（或强化）以下筛选（按优先级，允许分期交付）：

- VM 电源状态：`poweredOn | poweredOff | suspended`
- “仅显示 IP 缺失”（盘点常见问题定位）

> 备注：不强制引入复杂区间筛选（CPU/内存范围）以避免一期过重。

### B) /assets 列配置（按用户 DB 持久化）

1. **列显示/隐藏**

- 提供 “列设置” 入口（按钮/抽屉/弹窗皆可）：
  - 可勾选显示哪些列
  - 支持恢复默认
- 默认列保持与当前 MVP 一致（不改变默认体验）。

2. **DB 持久化（按用户）**

- 列配置必须存数据库并与用户绑定：
  - 用户下次进入 `/assets` 自动加载并应用上次列配置
- 配置粒度：**每用户一份全局配置**（不按 assetType 拆分；不持久化列顺序）
- 推荐数据模型（示例）：
  - `UserPreference` 表：`userId + key + value(Json) + updatedAt`
  - `key = "assets.table.columns.v1"`
  - `value` 存储：`{ visibleColumns: string[] }`

3. **API 契约（示例）**

- `GET /api/v1/me/preferences?key=assets.table.columns.v1`
- `PUT /api/v1/me/preferences`（body: `{ key, value }`）

> 备注：具体路径可调整，但必须具备“按用户读写偏好”的能力。

### C) /assets/[uuid] 详情信息组织

1. **盘点摘要（首屏可读）**

详情页首屏提供结构化展示（按 assetType 不同，字段略有差异）：

- 基本：类型、状态、Last Seen、Latest Snapshot（runId/时间）
- 关键字段（示例）：
  - 机器名（含覆盖/采集差异标识）
  - OS、IP（含 “Tools 未运行导致 IP 缺失” 的提示）
  - CPU/内存/磁盘（格式化）
  - VM：电源状态、Tools 状态

2. **分块 + 分组展示（替代 flatten 大表的默认视图）**

- 外层分块（业务视角，A）：
  - 通用字段
  - VM 专用字段
  - Host/物理机专用字段
  - Cluster 专用字段
  - 扩展字段（attributes.\*）
  - 自定义字段（台账字段；本 PRD 仅定义页面布局与展示占位，编辑能力由 M8/M9 提供）
- 内层分组（schema 视角，B）：
  - 每个分块内部，将 canonical.fields 按一级分组（identity/network/os/hardware/runtime/storage/location/ownership/service/physical/attributes 等）展示
- 每组内字段展示规则：
  - 表格列：`字段ID（英文 path）` + `字段名（中文）` + `值（人类可读）` + `来源数` + `冲突`
  - 冲突字段遵循 `docs/design/asset-ledger-ui-spec.md` 的冲突标记规范
  - 仍提供“查看原始 canonical（JSON）”的调试入口（折叠/Advanced）

3. **字段名本地化（中文字段名）**

- 字段名必须基于 canonical schema（`docs/design/asset-ledger-json-schema.md`）覆盖全部结构化字段：
  - structured fields：schema 中明确列出的结构化路径（例如 `identity.hostname`、`network.ip_addresses`、`hardware.memory_bytes` 等）
  - dynamic fields：`attributes.*` 只做“扩展字段：{key}”的展示与兜底，不要求穷举翻译
- 推荐实现方式：维护一个“字段字典（field registry）”，为每个结构化字段提供：
  - `labelZh`（中文名）
  - `groupA`（通用/VM/Host/Cluster/扩展/自定义）
  - `groupB`（一级分组：identity/network/...）
  - `formatHint`（可选：bytes/datetime/enum 等，用于值渲染）
- 兜底策略：
  - 若字段不在字典中：中文列显示 `-`，字段仍必须展示（不可隐藏）

4. **值渲染（人类可读，替代 JSON 默认视图）**

- 基础类型：
  - string：直接展示（必要时换行/截断）
  - number：直接展示；对 bytes 字段需格式化（GiB/TiB，1024 进制）
  - boolean：展示“是/否”
  - null：展示 `-`
- array：
  - 基础数组（string/number/bool）：用逗号分隔或 tag 形式展示（不展示 JSON）
  - 对象数组（例如 `hardware.disks[]`、`storage.datastores[]`）：默认以“列表卡片”展示（每项一张卡片/一行，内含关键键值）
- object：
  - 对 schema 明确的对象：按 key-value 形式展示（优先使用字段字典对内部 key 做中文化）
  - 对未知对象：不作为默认展示内容，提供“查看原始值（JSON）”折叠入口

> 依赖：如需展示 Datastore 明细，可依赖采集项优化 PRD：`docs/prds/M2-asset-ledger-collector-optimizations-v1.0-prd.md`

### D) 关系展示增强

1. **关系链视图（更贴近盘点）**

- VM：展示 `VM -> Host -> Cluster`（允许缺边）
- Host：展示 `Host -> Cluster`，并可展示 “包含的 VM 数量/入口”（若数据可得）
- Cluster：展示成员 Host 列表入口（若数据可得）

2. **关系表保留（调试视角）**

- 仍保留当前 outgoing 列表作为“详细信息/调试入口”（折叠或下移）

## Acceptance Criteria

### Functional Acceptance

- [ ] 列表页查询条件与 URL 同步：刷新/回退/分享均可复现同一视图。
- [ ] 列表新增筛选：VM 电源状态 + “仅显示 IP 缺失”（至少其一可落地，另一个可作为 Phase 2）。
- [ ] 列配置支持显示/隐藏并可恢复默认；默认列不变。
- [ ] 列配置按用户写入 DB；用户再次进入 `/assets` 能自动恢复。
- [ ] 资产详情页提供“盘点摘要 + 分组展示”；canonical flatten 大表不再作为默认主视图，但仍保留调试入口。
- [ ] Canonical 字段表格同时展示：字段ID（英文 path）+ 字段名（中文）。
- [ ] Canonical 字段值默认以“人类可读”方式展示（不以 JSON 作为默认值视图）；对象数组默认以“列表卡片”展示。
- [ ] Canonical 字段按“外层分块（业务视角）+ 内层分组（schema 一级 key）”组织展示。
- [ ] 关系展示提供关系链视图，并可点击导航到相关资产。

### Quality Standards

- [ ] DB 变更通过 Prisma migration 管理，并且不影响现有用户登录/会话。
- [ ] 新增 API 有权限控制（至少：需要登录；若有 role 区分则按现有规则）。
- [ ] 文档同步：更新 `docs/design/asset-ledger-ui-spec.md`（必要时）与 `docs/roadmap.md`。

## Execution Phases

### Phase 1: /assets URL 同步 + 最小筛选增强

- [ ] URL query 与列表状态同步（q/asset_type/source_id/page）
- [ ] 增加 VM 电源状态筛选或“IP 缺失”筛选（优先落地一个）

### Phase 2: 列配置 + DB 持久化

- [ ] 增加 `UserPreference`（或等价）数据模型
- [ ] 提供偏好读写 API（me/preferences）
- [ ] `/assets` 读取并应用列配置

### Phase 3: 详情页信息组织

- [ ] 盘点摘要区块（格式化展示关键字段）
- [ ] canonical 分组展示 + 调试入口（JSON）

### Phase 4: 关系链视图

- [ ] VM/Host/Cluster 的关系链视图与导航
- [ ] 保留关系表作为详细/调试

---

**Document Version**: 1.0  
**Created**: 2026-01-30  
**Quality Score**: 92/100
