# 资产台账系统 - vCenter 插件多版本 Driver + 关系/规格/电源状态 - 产品需求文档（PRD）

> 本 PRD 用于补齐并纠正 vCenter 插件的“多版本差异处理”与“关键资产数据采集”：
>
> 1. **多版本 Driver（禁止降级）**：管理员在 Source 中选择 vCenter 版本范围；插件按选择使用对应采集 Driver；当所选 Driver 的关键能力不满足时 **直接失败**，不允许用更少信息的 fallback 伪成功（例如 `VCENTER_HOST_DETAIL_NOT_FOUND` 这类“详情接口不存在就用摘要继续采集”的行为）。
> 2. **关系必须可用**：采集结果必须输出关系边（`VM runs_on Host`、`Host member_of Cluster` 至少一种），用于资产页关系链展示与后续入账规则。
> 3. **补齐 VM 关键字段**：采集 VM 的配置规格（vCPU/内存/磁盘明细）与电源状态（poweredOn / poweredOff / suspended）。
>
> 需求口径仍以 `docs/requirements/asset-ledger-srs.md` 为准；本 PRD 仅定义本次新增/变更点与验收标准。

## Requirements Description

### Background

- **Business Problem**：
  - 现有 vCenter 插件对版本差异采用“运行时降级”策略（接口 404 → warning + fallback），导致表面成功但关键字段与关系缺失。
  - UI 上出现：资产存在但 **outgoing relations 为空**；同时 VM 缺少配置规格与电源状态，影响运维与审计价值。
- **Target Users**：仅管理员（admin）。
- **Value Proposition**：
  - 采集“成功”必须代表数据契约与关键字段满足，不允许降级掩盖问题。
  - 通过明确的多版本 Driver 与强制关系边，保证资产链路可追溯、可解释、可用于后续能力演进。

### Feature Overview

#### Core Features（本次增量）

1. **Source：vCenter 版本范围（首选）**

- vCenter Source 新增配置项：`config.preferred_vcenter_version`（必填，枚举）。
- 选项固定为 2 个范围（产品简化，覆盖 6.5~8）：
  - `6.5-6.7`
  - `7.0-8.x`

2. **插件：按版本范围选择 Driver（禁止降级）**

- 插件必须根据 `preferred_vcenter_version` 选择对应 Driver（内部可再做 capability probe 作为校验/提示，但不得以“更少字段”继续成功）。
- 当所选 Driver 的关键能力缺失（例如关键 endpoint 不存在/权限不足导致拿不到必须字段）：
  - `mode=collect`：必须失败（`errors[]` + 非 0 exit code），并标记 `stats.inventory_complete=false`；
  - 不得以 warning + fallback 方式返回成功。

3. **采集输出：关系边必须存在**

- 插件输出关系 `relations[]` 必须满足：`runs_on` 与 `member_of` 至少一种 **非空**。
- 推荐目标：两种关系都输出（VM→Host 与 Host→Cluster），用于 UI 关系链与未来去重/归属能力。

4. **采集输出：VM 规格与电源状态**

- VM 配置规格（配置值，不取实时 usage）：
  - `normalized.hardware.cpu_count`
  - `normalized.hardware.memory_bytes`
  - `normalized.hardware.disks[]`（每块盘明细：name/size_bytes/type）
- VM 电源状态（结构化字段，不写入 attributes）：
  - `normalized.runtime.power_state ∈ { poweredOn, poweredOff, suspended }`

#### Feature Boundaries（明确不做什么）

- 不做“自动猜测并静默切换版本范围”的体验：Source 以管理员选择为准；detect 只能做校验/建议。
- 不做“实时资源使用率/性能指标”（CPU usage、mem usage、IOPS 等）。
- 不改变 canonical 资产生命周期状态（`Asset.status = in_service/offline/merged`）的语义；VM 电源状态作为字段存在于 canonical.fields 内。

### User Scenarios

1. 管理员创建 vCenter Source 时选择版本范围（`6.5-6.7` 或 `7.0-8.x`），填写 endpoint 并绑定凭据。
2. 管理员触发采集：
   - 若版本范围与 vCenter 能力匹配：Run 成功，VM/Host/Cluster 资产与关系边可在资产页展示；VM 可查看配置规格与电源状态。
   - 若不匹配：Run 失败，错误提示明确指出“所选版本范围不兼容/关键能力缺失”，要求管理员调整版本范围或升级 vCenter。

## Detailed Requirements

### 1) Source 配置与 UI

#### 1.1 Source.config（vCenter）

在现有 `config.endpoint` 基础上新增：

- `preferred_vcenter_version`（必填，枚举）：`6.5-6.7 | 7.0-8.x`

兼容策略：

- 对历史 Source：若该字段为空/缺失，UI 必须要求管理员补齐后才允许运行 `collect`（避免继续隐式降级）。

#### 1.2 UI 行为（admin-only）

- Source 新建/编辑页（vCenter）新增下拉框：
  - 标题：`vCenter 版本范围（首选）`
  - 选项：`6.5-6.7`、`7.0-8.x`
  - 必填校验：未选择不得保存/不得运行。

### 2) 插件 Detect（校验 + 建议）

#### 2.1 detect() 输出

- `detect.target_version`：尽力探测真实版本号/构建号（用于排障与建议，不作为唯一判据）。
- `detect.driver`：返回本次“建议/将使用”的 driver（例如 `vcenter-rest-6x` / `vcenter-rest-7x`）。
- `detect.capabilities`：至少包含：
  - 关键资源是否可列举（VM/Host/Cluster list）
  - 关键字段是否可获取（VM host 归属、cluster 归属、VM hardware、VM power_state）

#### 2.2 detect() 与 Source 选择的关系

- detect 不能覆盖 Source 的 `preferred_vcenter_version`（不做静默切换）。
- 若 detect 判断与 Source 选择不匹配：必须在 UI/Run 中给出明确提示，并在 collect 时强制失败（见 3.2）。

### 3) 插件 Collect（强约束：不降级）

#### 3.1 资产种类与最小字段

- VM：
  - 必须：`external_id`、`identity.hostname`（可用 name/guest hostname 等来源组合）、`identity.machine_uuid`（若可得）、`network.mac_addresses[]`（若可得）
  - 必须新增：`hardware.cpu_count`、`hardware.memory_bytes`、`hardware.disks[]`、`runtime.power_state`
- Host：
  - 必须：`external_id`、`identity.hostname`（可得则填）、`identity.serial_number`（可得则填）
- Cluster：
  - 必须：`external_id`、`identity.caption`（name）

#### 3.2 关系边（必须存在）

验收口径（硬性）：

- 插件输出的 `relations[]` 必须满足：
  - `runs_on` 与 `member_of` 至少一种非空；
  - 且 `relations[].from/to` 引用的端点必须在同次 `assets[]` 内存在。

失败条件（硬性）：

- 若 VM/Host/Cluster 列表可获取但**无法构建任何关系边**（`relations.length === 0`）：本次 Run 必须失败（原因：关系缺失会直接导致 UI 与后续能力不可用）。

#### 3.3 不降级原则（硬性）

- 禁止使用“更少信息的 fallback”让 collect 继续成功（例如 Host detail 404 后改用 Host summary 并返回成功）。
- 当关键能力缺失：
  - 直接失败并返回结构化错误（建议使用 `VCENTER_API_VERSION_UNSUPPORTED`，`retryable=false`），并在 `redacted_context` 中包含：
    - `preferred_vcenter_version`
    - `missing_capability` 或 `missing_endpoint`

### 4) 数据字段与 Schema

#### 4.1 normalized-v1 schema 扩展（必须）

- 在 `normalized-v1` 增加结构化字段：
  - `runtime.power_state`（VM 专用；Host/Cluster 可缺省）

枚举值（硬性）：

- `poweredOn`
- `poweredOff`
- `suspended`

#### 4.2 canonical 展示口径

- canonical 的 `Asset.status` 仍表示资产生命周期状态（in_service/offline/merged）。
- VM 电源状态在 canonical.fields 中展示：`fields.runtime.power_state`。

## Design Decisions

### Technical Approach

#### Driver 划分（必须）

- `vcenter-rest-6x`：覆盖 `preferred_vcenter_version=6.5-6.7`
- `vcenter-rest-7x`：覆盖 `preferred_vcenter_version=7.0-8.x`

> 备注：Driver 的内部实现可使用 REST `/rest` 或 `/api` 族接口，或官方 SDK（例如 govmomi/pyVmomi）；但对外必须遵守“不降级 + 关系必有 + 字段必有”的契约。

#### 为什么当前会出现 relations=0（现状解释，用于排障）

- 当前实现丢弃了 VM/Host 列表摘要里的关键字段（例如 vm.host、host.cluster），导致 `buildRelations()` 无法构建关系边；这不是“vSphere 不提供关系”，而是“采集实现未保留/未拉取关系所需字段”。

### Constraints

- **Compatibility**：覆盖 vCenter 6.5~8（通过 2 个版本范围选项）。
- **Security**：插件输出/日志必须脱敏；不得输出凭据/Token。

### Risk Assessment

- **技术风险**：不同 vCenter 构建的 REST 字段/路径差异导致字段缺失。
  - **缓解**：以 driver + capability probe 明确化；不满足即失败，避免 silent partial。
- **体验风险**：管理员选错版本范围导致采集失败。
  - **缓解**：detect 提供建议与明确错误信息；UI 给出选择提示与帮助文案。

## Acceptance Criteria

### Functional Acceptance

- [ ] Source（vCenter）支持配置 `preferred_vcenter_version`，且为必填（仅 2 个范围选项）。
- [ ] 插件按 `preferred_vcenter_version` 选择 driver；当关键能力缺失时 collect 必须失败，禁止 warning + fallback 成功。
- [ ] 采集结果必须输出关系边：`runs_on` 与 `member_of` 至少一种非空；`relations=0` 必须视为失败。
- [ ] VM 输出包含配置规格：`hardware.cpu_count`、`hardware.memory_bytes`、`hardware.disks[]`（盘明细）。
- [ ] VM 输出包含电源状态：`runtime.power_state`（枚举：poweredOn / poweredOff / suspended）。

### Quality Standards

- [ ] 文档同步：更新 `README.md` 与 `docs/design/asset-ledger-collector-reference.md`，移除“允许降级”的口径，改为“版本范围 + 不匹配直接失败”。
- [ ] Schema 同步：更新 `src/lib/schema/normalized-v1.schema.json` 与 `docs/design/asset-ledger-json-schema.md`，加入 `runtime.power_state`。

## Execution Phases

### Phase 1: 文档与契约对齐

**Goal**：把“禁止降级 + 版本范围 + 必备字段/关系”固化为契约与验收口径

- [ ] 新增本 PRD 文档
- [ ] 更新 README/collector reference/error codes/schema 文档

### Phase 2: Source 配置与 UI/API

**Goal**：让管理员可配置版本范围并影响插件行为

- [ ] Source API schema 增加 `config.preferred_vcenter_version`
- [ ] UI Source 新建/编辑页增加选择项与必填校验

### Phase 3: vCenter 插件多 Driver 实现

**Goal**：按版本范围稳定采集资产、关系与关键字段

- [ ] 实现 `vcenter-rest-6x` 与 `vcenter-rest-7x` driver
- [ ] 强制关系边输出与字段补齐（硬件规格/电源状态）
- [ ] 取消降级路径：关键能力缺失直接失败

### Phase 4: 集成验证与回归

**Goal**：确保 UI 展示与数据落库正确

- [ ] 回归：资产页 relations/outgoing 可展示
- [ ] 回归：VM 规格与电源状态在 canonical.fields 中可见

---

**Document Version**: 1.0  
**Created**: 2026-01-29  
**Clarification Rounds**: 2  
**Quality Score**: 96/100
