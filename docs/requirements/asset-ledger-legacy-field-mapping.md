# 资产台账 legacy 字段 → normalized 映射（Host 优先；导入仅作兜底）

版本：v1.1  
日期：2026-01-26

## 目标与范围

- 本文主要面向 **物理机/裸金属（host）** 的历史表格导入与第三方导出对齐（未来主路径是自动化采集）。
- **VM 不做 legacy 导入**：如未来需要，建议直接由采集插件输出 `normalized-v1`（见 schema），本表不再维护 VM 的列级映射。
- v1 MVP 优先保证以下字段可检索/过滤：**IP、主机名、CPU（数量）、内存（数量）、操作系统**。
- Host 的去重/候选键（导入/采集侧建议）：
  1. `network.bmc_ip`（你们口径的管理地址，优先）
  2. `identity.serial_number`（如可得，强烈建议同时采集/导入）
  3. `network.management_ip`（仅当来源提供“in-band 管理 IP”时作为补充）

Schema 定义见：`docs/requirements/asset-ledger-json-schema.md`（已新增 `network.bmc_ip`；`network.ilo_ip` 作为历史别名已废弃）。

## 0. 通用清洗/校验规则（强烈建议）

- 字符串：trim；多个分隔符统一（`,` `;` `|` `、` 空格）。
- IP 列表：
  - 拆分后写入 `network.ip_addresses[]`（去重）。
  - `network.ip_addresses[]` **仅放 in-band IP**（业务网/管理网/主机网卡 IP）；不要混入 BMC 地址。
  - BMC 地址写入 `network.bmc_ip`（单值）；如只有历史列 “ILO/iDRAC/IPMI 地址”，直接落这里。
- CPU：仅填 **数量** → `hardware.cpu_count`（整数）；无法可靠解析时写 `attributes.legacy_cpu_raw`。
- 内存：仅填 **数量** → `hardware.memory_bytes`（bytes）；无法可靠解析时写 `attributes.legacy_memory_raw`。
- 操作系统：
  - 名称 → `os.name`
  - 版本（可选） → `os.version`
  - 原始文本建议保留 → `attributes.legacy_os_raw`
- 硬盘（预留）：
  - v1 不强制结构化与计算“分配/已用”；建议先保留原文 → `attributes.legacy_disk_spec`。
  - 如未来要做“分配/已用”，建议预留：
    - `attributes.disk_total_bytes`（number，bytes，总容量/可分配）
    - `attributes.disk_used_bytes`（number，bytes，已用）
  - 说明：BMC/Redfish 通常只能拿到物理盘容量，拿不到文件系统 used；used 需要 OS/Agent/监控侧补齐。
- 敏感信息（如“管理码”）：**禁止明文入库**；仅写 `attributes.management_credential_present=true` 或 `attributes.management_secret_ref`（引用密钥系统）。
- “状态/分类/服务级别”等治理字段：如暂未实现自定义字段，建议先保留原值到 `attributes.legacy_*`，避免污染结构化字段枚举。

## 1. Host（物理机）字段映射（legacy → normalized-v1）

> “MVP 必填”指：你要求 v1 首屏检索/过滤必须可用的字段。

| 旧字段       | normalized 路径                                    | 说明/转换                                                                      | 归类                  | MVP 必填 |
| ------------ | -------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------- | -------- |
| 主机名       | `identity.hostname`                                | 主机名/ComputerName                                                            | 通用                  | 是       |
| IP地址       | `network.ip_addresses[]`                           | 多 IP 拆分、去重；不要包含 BMC IP                                              | 通用                  | 是       |
| ILO 地址     | `network.bmc_ip`                                   | iLO/iDRAC/IPMI/BMC 管理 IP（你们用于去重的管理地址）                           | 通用                  | 是       |
| （可选）     | `network.management_ip`                            | 若你希望“主管理地址”统一落点：可令其 = `network.bmc_ip`（仅 host legacy 导入） | 通用                  | 否       |
| CPU          | `hardware.cpu_count`                               | 仅数量（整数）；无法可靠解析则 `attributes.legacy_cpu_raw`                     | 通用/attributes       | 是       |
| 内存         | `hardware.memory_bytes`                            | 仅数量（bytes）；无法可靠解析则 `attributes.legacy_memory_raw`                 | 通用/attributes       | 是       |
| 操作系统     | `os.name` / `os.version`                           | 可拆分出版本则填 `os.version`；原文保留 `attributes.legacy_os_raw`             | 通用/attributes       | 是       |
| 产品序列号   | `identity.serial_number`                           | 强烈建议导入/采集（dup 强键）                                                  | 通用                  | 否       |
| 固定资产编号 | `physical.fixed_asset_id`                          | 盘点/财务口径；建议同时在 `attributes.legacy_fixed_asset_id_raw` 保留原文      | 物理机扩展/attributes | 否       |
| 地区         | `location.region`                                  | 如“华东/北京机房”等                                                            | 通用                  | 否       |
| 机柜         | `location.cabinet`                                 | 机柜编号                                                                       | 通用                  | 否       |
| 位置         | `location.position`                                | U 位/位置描述（建议后续拆 `rack_u`）                                           | 通用                  | 否       |
| 硬盘         | `hardware.disks[]` / `attributes.legacy_disk_spec` | v1 不强制；能结构化多盘则写 `hardware.disks[]`，否则保留原文                   | 通用/attributes       | 否       |
| 维保期       | `physical.maintenance_period`                      | 如“3y/36m/2025-2028”；不强制结构化为起止日期                                   | 物理机扩展            | 否       |
| 采购日期     | `attributes.legacy_purchase_date`                  | 不进入结构化；保留原文用于对账/追溯                                            | attributes            | 否       |
| 保修截止期   | `attributes.legacy_warranty_end`                   | 不进入结构化；保留原文用于对账/追溯                                            | attributes            | 否       |
| 状态         | `attributes.legacy_status`                         | 不建议直接映射到 `asset.status`（需枚举对齐）                                  | attributes            | 否       |
| 服务级别     | `attributes.legacy_service_level`                  | v1 建议先放 attributes，避免枚举污染                                           | attributes            | 否       |
| 管理码       | `attributes.management_secret_ref`                 | 禁止明文；建议只存 ref/是否已配置                                              | attributes            | 否       |

## 2. VM（虚拟机）说明（不做 legacy 导入）

- VM 未来如需接入：建议通过采集插件输出 `normalized-v1`，并满足最小候选键（`identity.machine_uuid`/`network.mac_addresses[]`/`network.ip_addresses[]` 等）。
- 本文件不再维护 VM 的列级映射，避免误导导入流程。

## 3. 导入时的优先级/回填规则（Host）

- `network.bmc_ip`：若导入表存在 “ILO/iDRAC/IPMI/BMC” 任一列，优先填；为空则无法按你们口径去重，应提示“弱键导入”。
- `hardware.memory_bytes`：优先规范单位列（如 GB 列）；其次解析自由文本列（如 “256GB”）；再不行写 `attributes.legacy_memory_raw`。
- `os.name/os.version`：优先结构化列；其次从自由文本拆分；再不行写 `attributes.legacy_os_raw`。

## 4. attributes 命名约定（强烈建议）

- legacy 导入/第三方对齐字段统一使用 `legacy_` 前缀：`legacy_status`、`legacy_os_raw`、`legacy_cpu_raw`、`legacy_memory_raw`、`legacy_disk_spec`…
- 对于“暂不使用但要保留”的数值字段，建议以 bytes 为单位并明确后缀：`disk_total_bytes`、`disk_used_bytes`。
