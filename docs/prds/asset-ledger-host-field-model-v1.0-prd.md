# Host 字段模型优化（BMC 去重 + MVP 可检索字段）- 产品需求文档（PRD）

> 本 PRD 聚焦“Host（物理机/裸金属）字段模型”的可落地优化，面向未来自动化采集；legacy 表格导入仅作为兜底。

## Requirements Description

### Background

- **Business Problem**：Host 字段在不同来源/表格中口径不一（尤其“管理 IP/ILO/iDRAC”等），导致去重候选不稳定、检索字段不统一、字段语义易漂移。
- **Target Users**：管理员（admin）与平台研发/采集插件开发者。
- **Value Proposition**：用最少的一组稳定字段支撑 v1 的检索/过滤与去重候选，并为后续磁盘“总量/已用”扩展预留一致落点。

### Feature Overview

#### Core Features（v1.0）

- Host MVP 可检索字段统一：IP、主机名、CPU（数量）、内存（数量）、操作系统。
- 去重候选键统一：以 `network.bmc_ip` 为首选（out-of-band 管理地址），并保留 `identity.serial_number` 与 `network.management_ip` 作为补充键。
- 兼容与命名治理：
  - 新增 `network.bmc_ip`（推荐字段）
  - 废弃 `network.ilo_ip`（仅作为历史别名）
- 磁盘指标预留：v1 不强制计算“总量/已用”，但约定预留 key，避免未来迁移。

#### Feature Boundaries

- **In Scope（v1.0）**：schema/文档口径对齐；导入映射与字段清洗规则；去重候选键口径更新。
- **Out of Scope（v1.0）**：磁盘“总量/已用”的采集实现与展示（作为 v2 迭代）。

## Detailed Requirements

### Input/Output（字段口径）

#### Host 必填（用于 v1 检索/过滤）

- `identity.hostname`
- `network.ip_addresses[]`
- `network.bmc_ip`
- `hardware.cpu_count`
- `hardware.memory_bytes`
- `os.name`（可选：`os.version`）

#### Host 推荐补充（用于更稳的候选键与对账）

- `identity.serial_number`
- `physical.fixed_asset_id`
- `location.region/cabinet/position`

#### 磁盘（v1 预留，不强制）

- 原文：`attributes.legacy_disk_spec`
- 数值预留（bytes）：
  - `attributes.disk_total_bytes`
  - `attributes.disk_used_bytes`

### Data Requirements（校验与清洗）

- `network.ip_addresses[]` 只承载 in-band IP；BMC 地址必须落 `network.bmc_ip`，不得混入。
- `hardware.cpu_count` 与 `hardware.memory_bytes` 仅表达数量；无法可靠解析时必须保留原文到 `attributes.legacy_cpu_raw/legacy_memory_raw`。
- 敏感信息（如管理口令）禁止明文落库；仅允许写入 `attributes.management_secret_ref`（密钥引用）。

#### BMC IP 校验规则

> 目标：确保 BMC IP 格式正确且与 in-band IP 区分。

**格式校验**

- 必须为合法 IPv4 地址（暂不支持 IPv6 BMC）
- 正则示例：`^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$`
- 不允许为 `0.0.0.0`、`127.x.x.x`、`255.255.255.255`

**来源识别规则**

| 来源类型   | BMC IP 字段来源                                                                | 说明            |
| ---------- | ------------------------------------------------------------------------------ | --------------- |
| vCenter    | `host.hardware.systemInfo.otherIdentifyingInfo` 中的 `ServiceTag` 或 IPMI 配置 | 需解析          |
| 手工导入   | 明确标注为"ILO/iDRAC/BMC"的列                                                  | 映射到 `bmc_ip` |
| 第三方 API | 字段名包含 `ilo`/`idrac`/`bmc`/`ipmi`（不区分大小写）                          | 自动识别        |

**清洗示例**

```json
// 输入（legacy 表格）
{ "管理IP": "10.1.1.100", "ILO地址": "10.1.2.100" }

// 输出（normalized）
{
  "network": {
    "management_ip": "10.1.1.100",
    "bmc_ip": "10.1.2.100",
    "ip_addresses": ["10.1.1.100"]  // bmc_ip 不进入此数组
  }
}
```

## 技术设计（另附）

为避免“需求/设计”混写，本 PRD 不再包含具体 schema/文档对齐的实现细节；对应设计与口径见：

- `docs/design/asset-ledger-json-schema.md`
- `docs/design/asset-ledger-legacy-field-mapping.md`
- `docs/design/asset-ledger-collector-reference.md`
- `docs/design/asset-ledger-data-model.md`

## Acceptance Criteria

### Functional Acceptance

- [ ] `normalized-v1` schema 支持 `network.bmc_ip`，且 `network.ilo_ip` 被明确标注为废弃别名。
- [ ] legacy 导入映射文档以 Host 为中心，明确 v1 必填字段与去重候选键顺序。
- [ ] collector/data-model 文档的“最小字段集合”包含 `network.bmc_ip`（如可得，推荐提供）。
- [ ] 文档明确：BMC 地址不得写入 `network.ip_addresses[]`。

### Quality Standards

- [ ] 所有新增/调整字段均有清晰语义说明与清洗/校验规则。

## Execution Phases

### Phase 1: Documentation Alignment

**Goal**：统一文档口径与字段命名

- [ ] 更新 normalized schema 文档（新增 `network.bmc_ip`，废弃 `network.ilo_ip`）。
- [ ] 重写 legacy Host 映射（仅兜底导入，突出 v1 必填与去重键）。
- [ ] 更新 collector/data-model 对最小字段集合的描述。
- **Deliverables**：文档对齐 PR。
- **Time**：0.5 天

### Phase 2: (Optional) Implementation Follow-up

**Goal**：在实现侧落实校验/检索（如当前代码库需要）

- [ ] 校验：BMC IP 不进入 `ip_addresses[]` 的规则（导入/采集入口处）。
- [ ] 查询：Host 列表 IP 搜索覆盖 `ip_addresses[] + management_ip + bmc_ip`（如有 UI/API）。
- **Deliverables**：实现 PR（可选）。
- **Time**：0.5-1 天

---

**Document Version**：1.0
**Created**：2026-01-26
**Clarification Rounds**：2
**Quality Score**：93/100

---

## 验收检查清单（Acceptance Checklist）

### 文档验收

| 检查项                                       | 状态 | 验收人 | 日期 |
| -------------------------------------------- | ---- | ------ | ---- |
| `normalized-v1` schema 包含 `network.bmc_ip` | [ ]  |        |      |
| `network.ilo_ip` 标注为废弃别名              | [ ]  |        |      |
| legacy 导入映射以 Host 为中心                | [ ]  |        |      |
| v1 必填字段清单完整                          | [ ]  |        |      |
| 去重候选键顺序明确                           | [ ]  |        |      |
| collector 文档包含 `bmc_ip`                  | [ ]  |        |      |
| data-model 文档包含 `bmc_ip`                 | [ ]  |        |      |
| BMC 地址不入 `ip_addresses[]` 规则明确       | [ ]  |        |      |

### 实现验收（可选）

| 检查项                       | 状态 | 验收人 | 日期 |
| ---------------------------- | ---- | ------ | ---- |
| BMC IP 校验规则实现          | [ ]  |        |      |
| 导入时 BMC/IP 分离逻辑       | [ ]  |        |      |
| Host 列表 IP 搜索覆盖三类 IP | [ ]  |        |      |
| 单元测试覆盖边界条件         | [ ]  |        |      |

### 测试验收

| 测试场景               | 预期结果                   | 状态 |
| ---------------------- | -------------------------- | ---- |
| 导入含 ILO 地址的 CSV  | BMC IP 正确映射到 `bmc_ip` | [ ]  |
| 导入缺少 BMC IP 的记录 | 警告"弱键导入"             | [ ]  |
| BMC IP 格式非法        | 校验失败，记录错误         | [ ]  |
| 搜索 BMC IP            | 能找到对应 Host            | [ ]  |
| 去重候选生成           | BMC IP 匹配优先于 hostname | [ ]  |

---

## 需求-设计关联矩阵（Traceability Matrix）

### 需求到设计文档映射

| 需求 ID | 需求描述                   | 设计文档                               | 设计章节                |
| ------- | -------------------------- | -------------------------------------- | ----------------------- |
| REQ-01  | Host MVP 可检索字段统一    | `asset-ledger-json-schema.md`          | normalized-v1 Host 字段 |
| REQ-02  | 去重候选键以 BMC IP 为首选 | `asset-ledger-dup-rules-v1.md`         | 6. 规则列表             |
| REQ-03  | 新增 `network.bmc_ip` 字段 | `asset-ledger-json-schema.md`          | network 对象定义        |
| REQ-04  | 废弃 `network.ilo_ip`      | `asset-ledger-json-schema.md`          | 废弃字段说明            |
| REQ-05  | 磁盘指标预留               | `asset-ledger-json-schema.md`          | attributes 对象定义     |
| REQ-06  | BMC IP 校验规则            | `asset-ledger-legacy-field-mapping.md` | 5. 数据校验规则         |
| REQ-07  | BMC 地址不入 ip_addresses  | `asset-ledger-legacy-field-mapping.md` | 0. 通用清洗规则         |

### 需求到测试用例映射

| 需求 ID | 测试用例 ID  | 测试描述                 |
| ------- | ------------ | ------------------------ |
| REQ-01  | TC-HOST-01   | Host 列表按 IP 搜索      |
| REQ-01  | TC-HOST-02   | Host 列表按主机名搜索    |
| REQ-01  | TC-HOST-03   | Host 列表按 CPU 过滤     |
| REQ-01  | TC-HOST-04   | Host 列表按内存过滤      |
| REQ-01  | TC-HOST-05   | Host 列表按操作系统过滤  |
| REQ-02  | TC-DUP-01    | BMC IP 匹配生成候选      |
| REQ-02  | TC-DUP-02    | 序列号匹配生成候选       |
| REQ-02  | TC-DUP-03    | 管理 IP 匹配生成候选     |
| REQ-03  | TC-SCHEMA-01 | normalized 包含 bmc_ip   |
| REQ-06  | TC-VALID-01  | BMC IP 格式校验          |
| REQ-06  | TC-VALID-02  | BMC IP 非法值拒绝        |
| REQ-07  | TC-CLEAN-01  | BMC IP 不入 ip_addresses |

### 需求到代码模块映射

| 需求 ID | 代码模块      | 文件路径（预期）                      |
| ------- | ------------- | ------------------------------------- |
| REQ-01  | Host 列表查询 | `src/services/asset/host-query.ts`    |
| REQ-02  | 去重候选计算  | `src/services/duplicate/dup-rules.ts` |
| REQ-03  | Schema 定义   | `src/schemas/normalized-v1.ts`        |
| REQ-06  | 校验规则      | `src/services/import/validators.ts`   |
| REQ-07  | 清洗规则      | `src/services/import/cleaners.ts`     |

---

## 变更历史

| 版本 | 日期       | 变更内容                   | 作者 |
| ---- | ---------- | -------------------------- | ---- |
| 1.0  | 2026-01-26 | 初始版本                   | -    |
| 1.1  | 2026-01-27 | 添加验收检查清单和关联矩阵 | -    |
