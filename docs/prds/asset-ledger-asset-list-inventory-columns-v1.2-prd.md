# 资产台账系统 - 资产列表盘点列展示（机器名覆盖 + 列顺序调整 + 操作系统 + VM 运行状态 + Host ESXi 版本）- 产品需求文档（PRD）

> 本 PRD 用于定义“资产列表（/assets）”在盘点场景下的默认展示列与数据口径：补齐机器名（可人工覆盖显示）、操作系统、VM 运行状态，并补齐 vCenter Host 的 ESXi 版本/构建号（SOAP）。同时明确可搜索字段范围与边界行为。

## Requirements Description

### Background

- **Business Problem**：
  - 资产列表盘点时需要同时看到：VM 的虚拟机名、宿主机名、VM 内部机器名（Guest hostname/ComputerName，可能缺失）、操作系统与运行状态。
  - “机器名”在部分来源或采集能力下可能拿不到；但盘点/对账时需要管理员临时补齐，并且不应影响后续真实采集入库。
  - Host（ESXi）资产的“操作系统”需要展示 `ESXi 7.0.3` 这类版本信息；vCenter REST 信息不足，需 SOAP（vim25）补齐。
- **Target Users**：管理员（admin）、平台研发/采集插件开发者。
- **Value Proposition**：
  - 列表页直接完成盘点关键字段核对，不必频繁进入详情页。
  - 支持机器名“覆盖显示”，同时保留采集到的真实值持续入库，避免覆盖影响数据可追溯。
  - Host ESXi 版本可在列表直观可见，减少登录 vCenter/ESXi 查询成本。

### Feature Overview

#### Core Features（本次变更）

1. **资产列表列顺序与字段补齐**

- 列表展示列（从左到右，至少前 4 列必须一致）：
  1. 机器名
  2. 虚拟机名
  3. 宿主机名
  4. 操作系统
  - 其它未提及列：保持现状（仅做必要的插入/调整，避免影响未涉及逻辑）
  - 新增：状态列（显示“虚拟机是否运行”）

2. **机器名支持“覆盖显示”**

- 新增字段：`machine_name_override`（“显示别名”），仅用于覆盖显示。
- 机器名展示来源（优先级）：
  - `machine_name_override`（管理员手动填写；优先展示）
  - `machine_name_collected`（采集值；作为 fallback 展示）
  - 无值时：保持为空（不展示 `-` 占位）
- 覆盖值仅影响显示，不改变采集链路：后续采集到真实机器名仍应正常写入 canonical 快照（可追溯）。
- 当覆盖值与采集值同时存在且不一致时：在 UI 增加“特殊标记”提示不一致（例如 badge/标签/tooltip）。

3. **机器名编辑交互：弹窗/抽屉（B）**

- 在资产列表行操作中提供“编辑机器名”入口，打开弹窗/抽屉编辑：
  - 可保存覆盖值
  - 可清空覆盖值（清空后回退展示采集值；采集值缺失则为空）
  - 展示采集到的机器名（只读）用于对比

4. **关键字搜索范围扩展（q）**

- 以下字段必须可被搜索命中（不区分大小写的 substring contains）：
  - 机器名（覆盖值 + 采集值，展示值优先但搜索需覆盖两者）
  - 虚拟机名
  - 宿主机名
  - 操作系统（含 `os.name/os.version`，以及 fingerprint fallback）
  - 状态（如实现已支持，可选；最低要求为：以上文本字段可搜索）

5. **状态列：VM 是否运行**

- VM：展示 runtime.power_state（`poweredOn`/`poweredOff`/`suspended` → UI 映射为“运行/关机/挂起”）
- 非 VM：显示 `-`

6. **Host 的 ESXi 版本/构建号补齐（SOAP / vim25）**

- 目标：在 Host 行“操作系统”列展示为 `ESXi 7.0.3`（仅展示 name + version）。
- 采集来源：vSphere Web Services（SOAP, `https://<vcenter>/sdk`）
- HostSystem 字段：
  - `summary.config.product.version`（必需）
  - `summary.config.product.build`（可选但建议采集）
  - `summary.config.product.name`（可选；展示侧统一用 `ESXi`）

#### Feature Boundaries（明确不做什么）

- 不做中文分词、同义词、拼写纠错等高级搜索能力（维持“简单 contains 匹配”）。
- 不新增排序能力（维持现状）。
- 不改动未提及页面与未提及业务逻辑（避免影响金主大人自行修改的部分）。

## Detailed Requirements

### Input/Output（字段口径）

> 列表行字段来自：`asset` 表 + 最新 `asset_run_snapshot.canonical`（take=1, createdAt desc）+ 关系 `runs_on`。

#### 机器名（machineName）

- 展示值：
  - `asset.machine_name_override` 优先
  - 否则取 `canonical.fields.identity.hostname.value`（采集值）
  - 无值：返回空字符串（UI 不展示 `-`）
- 不一致标记：
  - 当 `machine_name_override` 与采集值同时存在且不相等 → `machineNameMismatch = true`

#### 虚拟机名（vmName）

- VM：优先取 `canonical.fields.identity.caption.value`；fallback：`asset.display_name`
- 非 VM：`-`

#### 宿主机名（hostName）

- VM：取 runs_on 关系指向 Host 的展示名（Host 的 `asset.display_name`）
- Host：`-`（示例：IP 为 `10.10.103.36` 的 Host 行不应出现“宿主机名”）
- Cluster：`-`（默认列表隐藏 Cluster）

#### 操作系统（os）

- VM：
  - 优先：`canonical.fields.os.name.value` + 可选 `canonical.fields.os.version.value`（拼接展示）
  - fallback：`canonical.fields.os.fingerprint.value`（例如已采集到 `WINDOWS_7_SERVER_64` 时，列表不得为空）
  - 无值：`-`
- Host：
  - 优先：若已通过 SOAP 采集到 `normalized.os.name="ESXi"` 且 `normalized.os.version` 有值 → 展示 `ESXi {version}`（例如 `ESXi 7.0.3`）
  - fallback：`canonical.fields.os.*` 的现有取值策略（如 name/version/fingerprint）
  - 无值：`-`

#### 状态（vmPowerState）

- VM：`canonical.fields.runtime.power_state.value`
- 非 VM：`-`

### SOAP 采集要求（Host ESXi）

> 目标：一次 collect run 内尽量批量化，避免 N+1 SOAP 请求。

- SDK endpoint：`https://<vcenter>/sdk`（基于现有 endpoint 自动补齐 `/sdk`）。
- 同一 run 内 SOAP 登录最多一次；通过 `PropertyCollector.RetrievePropertiesEx` 批量读取 Host 的：
  - `summary.config.product.version`
  - `summary.config.product.build`（可选）
- 映射到 normalized/canonical：
  - `os.name = "ESXi"`
  - `os.version = <soap_version>`（例如 `7.0.3`）
  - `os.fingerprint = <soap_build>`（可选）

### Edge Cases

- 无快照（无 canonical）：机器名为空；其它盘点列按缺失策略显示 `-`。
- 仅有覆盖值无采集值：机器名展示覆盖值；不显示“不一致”标记。
- 同时有覆盖值与采集值且不一致：展示覆盖值 + 不一致标记；编辑弹窗中可见采集值用于对比。
- SOAP SDK endpoint 不可达 / 登录失败：
  - 不应导致整次采集全部失败（除非现有策略要求失败）
  - 对应 Host 的 `os.*` 缺失，UI 显示 `-`
  - 需要有可定位的 warning/error（含阶段、HTTP 状态码、摘要等）

## Acceptance Criteria

### Functional Acceptance

- [ ] `/assets` 前四列从左到右依次为：机器名/虚拟机名/宿主机名/操作系统。
- [ ] 机器名：无覆盖值且无采集值时，单元格保持为空（不显示 `-`）。
- [ ] 机器名可通过弹窗/抽屉编辑并持久化为 `machine_name_override`；清空后回退展示采集值（若无采集则为空）。
- [ ] 当机器名覆盖值与采集值不一致时，列表展示“不一致标记”。
- [ ] Host 行不展示“宿主机名”（示例：Host `10.10.103.36` 的“宿主机名”列应为 `-`）。
- [ ] 操作系统列：当 `os.fingerprint` 已存在（示例 `WINDOWS_7_SERVER_64`）时不得显示为空。
- [ ] 状态列展示 VM 是否运行（poweredOn/off/suspended → 运行/关机/挂起）；非 VM 显示 `-`。
- [ ] 搜索 `q` 可命中：虚拟机名、宿主机名、操作系统、机器名（覆盖值/采集值）。
- [ ] 对接 vCenter 跑一次 collect 后，Host 行“操作系统”列可展示为 `ESXi 7.0.3`（示例）。

### Quality Standards

- [ ] 文档口径与代码实现保持一致；不得为了实现偷改口径。
- [ ] 不改动未提及页面与未提及逻辑（避免引入回归）。

---

**Document Version**: 1.2  
**Created**: 2026-01-29  
**Clarification Rounds**: 2
