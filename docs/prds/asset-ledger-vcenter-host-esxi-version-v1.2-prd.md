# 资产台账系统 - vCenter Host ESXi 版本/构建号 + 硬件规格（CPU/内存/本地磁盘总量/厂商型号）+ 管理 IP 采集（SOAP）与资产列表展示 - 产品需求文档（PRD）

> 目标：补齐 Host（ESXi）的关键盘点字段：操作系统版本、CPU/内存、本地磁盘总量、硬件厂商/型号、管理 IP，并在资产列表（/assets）展示。Host（ESXi）侧信息**全部通过 vSphere Web Services（SOAP / vim25）采集**，数据来源可追溯（canonical 快照），不依赖人工输入。

## Requirements Description

### Background

- **Business Problem**：
  - VM 的 CPU/内存/磁盘可通过 vCenter REST 较稳定地采集，但 Host（ESXi）的版本/构建号与硬件规格信息在 REST 侧缺失或不稳定，导致资产列表 Host 行 CPU/内存/磁盘列常为空。
  - 盘点场景需要在列表页快速看到 Host 的 ESXi 版本与硬件规格，否则需要人工登录 vCenter/ESXi 查询，效率低、不可追溯。
- **Target Users**：管理员（admin）、平台研发/采集插件开发者。
- **Value Proposition**：
  - 列表页即可完成 Host（ESXi）盘点（版本/CPU/内存/磁盘）。
  - 统一以 SOAP（vim25）采集 Host（ESXi）信息，字段稳定且可追溯到 source/run。
- **Success Metrics**：
  - 指标：Host 关键字段非空率 = 100%。
  - 统计口径（分母）：
    - `os.version` / `os.fingerprint` / `hardware.cpu_count` / `hardware.memory_bytes`：
      - 分母 = SOAP 登录成功且该 Host 可读取到 `summary.*` 的 Host。
    - `attributes.disk_total_bytes`：
      - 分母 = 可判定本地盘容量口径的 Host（可解析 `HostScsiDisk.localDisk` 或 `HostNvmeNamespace`；无法判定者允许缺失并告警，不纳入分母）。

### Feature Overview

#### Core Features（本次变更）

1. **通过 vSphere Web Services（SOAP / vim25）采集 Host 的 ESXi 版本/构建号**

- SDK endpoint：`https://<vcenter>/sdk`（基于现有 `endpoint` 自动补齐 `/sdk`，不要求用户输入完整路径）。
- 采集字段（HostSystem）：
  - `summary.config.product.version`（必需，用于展示）
  - `summary.config.product.build`（必需，必须采集并落库到 `os.fingerprint`；本期不用于搜索）
  - `summary.config.product.name`（可选；展示侧统一用 `ESXi`）

2. **通过 SOAP 采集 Host（ESXi）的 CPU/内存硬件规格**

- 采集字段（HostSystem）：
  - `summary.hardware.numCpuCores`（必需，落 `hardware.cpu_count`）
  - `summary.hardware.memorySize`（必需，落 `hardware.memory_bytes`）
  - 其余 CPU 明细（建议采集，落 attributes）：
    - `summary.hardware.cpuModel`
    - `summary.hardware.cpuMhz`
    - `summary.hardware.numCpuPkgs`
    - `summary.hardware.numCpuThreads`

3. **通过 SOAP 采集 Host（ESXi）的“本地物理盘总量”（仅 total，不采集 used）**

- 口径：只统计 **本地物理盘** 的容量总和：`HostScsiDisk.localDisk == true` 的容量之和 + `HostNvmeNamespace(blockSize * capacityInBlocks)` 之和。
- 不做 fallback：若无法读取/无法判定本地盘，则该 Host 的 `disk_total_bytes` 视为缺失（UI 显示 `-`，并记录 warning）。

4. **资产列表（/assets）展示对齐**

- Host 行：
  - “操作系统”列展示为 `ESXi {version}`（仅展示 name + version）
  - CPU 列展示为 `attributes.cpu_threads`（线程数）
  - 内存列展示为 `hardware.memory_bytes`（按 1024 进制格式化）
  - “总分配磁盘”列对 Host 展示为 `attributes.disk_total_bytes`（本地物理盘总量；按 1024 进制格式化）

5. **搜索（q）支持按 ESXi 版本命中 Host**

- 输入 `ESXi` 或 `7.0.3` 可命中对应 Host。
- 本期不支持按 build 号（`os.fingerprint`）搜索，后续版本可扩展。

6. **通过 SOAP 采集 Host（ESXi）的硬件厂商/型号、整机序列号与管理 IP（用于盘点展示）**

- 采集字段（HostSystem）：
  - `hardware.systemInfo.vendor`（建议，落 `identity.vendor`）
  - `hardware.systemInfo.model`（建议，落 `identity.model`）
  - `hardware.systemInfo.serialNumber`（建议，落 `identity.serial_number`；若缺失则尝试从 `hardware.systemInfo.otherIdentifyingInfo` 提取 ServiceTag/Serial）
  - `config.network.vnic` / `config.network.consoleVnic`（建议，提取 IPv4；落 `network.ip_addresses` 与 `network.management_ip`）
- 口径（管理 IP）：
  - 优先取 `device == vmk0`（或 `vswif0`）的 IPv4；
  - 其次取 `portgroup` 名称包含 `Management` 的 IPv4；
  - 否则取采集到的第一个 IPv4（仅用于兜底展示）。

#### Feature Boundaries（明确不做什么）

- 不采集/落库本地盘“已使用/可用”（`disk_used_bytes`）。（本次只做 total）
- 不采集 datastore “已用/可用”；仅采集 datastore total，并按 `summary.type in {NFS,NFS41,vsan}` 排除远程 NFS 与 vSAN datastore。
- 不做“ESXi 版本 → 风险/漏洞”联动能力（后续需求另立 PRD）。
- 不做 UI 列排序能力（维持现状）。

## Detailed Requirements

### Data Requirements（字段口径与落点）

#### normalized-v1（Host）

将 SOAP 获取到的 ESXi 与硬件信息映射到 Host 的 `normalized`：

- `normalized.os.name = "ESXi"`
- `normalized.os.version = <soap_version>`（例如 `7.0.3`）
- `normalized.os.fingerprint = <soap_build>`（必需；例如 `20036589`）
- `normalized.hardware.cpu_count = <numCpuCores>`（核心数）
- `normalized.hardware.memory_bytes = <memorySize>`（bytes）
- `normalized.attributes.cpu_model = <cpuModel>`（string，可选）
- `normalized.attributes.cpu_mhz = <cpuMhz>`（number，可选）
- `normalized.attributes.cpu_packages = <numCpuPkgs>`（number，可选）
- `normalized.attributes.cpu_threads = <numCpuThreads>`（number，可选）
- `normalized.attributes.disk_total_bytes = <sum(localDisk capacities)>`（number，bytes，必需；若无法采集则缺失并告警）
- `normalized.attributes.datastore_total_bytes = <sum(datastore.summary.capacity)>`（number，bytes，建议；过滤 `summary.type in {NFS,NFS41,vsan}`）
- `normalized.identity.vendor = <soap_vendor>`（string，建议；例如 `HP`）
- `normalized.identity.model = <soap_model>`（string，建议；例如 `ProLiant DL380p Gen8`）
- `normalized.identity.serial_number = <soap_serial>`（string，建议；例如 `SN-123`）
- `normalized.network.management_ip = <mgmt_ipv4>`（string，建议；例如 `192.168.1.10`）
- `normalized.network.ip_addresses = <all_ipv4s_from_vnic>`（string[]，建议；例如 `["192.168.1.10"]`）

> 说明：
>
> - UI 展示：
>   - “操作系统”只使用 `name + version`；
>   - CPU 使用 `attributes.cpu_threads`；内存使用 `hardware.memory_bytes`；
>   - Host 的“总分配磁盘”使用 `attributes.disk_total_bytes`（本地盘总量）。

#### canonical-v1（Host）

`asset_run_snapshot.canonical.fields` 必须包含上述字段（若可得），并保留来源信息（source/run/record），确保可追溯与可回放。

### Collection Flow（SOAP 采集流程）

> 目标：一次 collect run 内尽量批量化，避免 N+1 SOAP 请求；Host（ESXi）信息全部走 SOAP。

1. SOAP 登录与会话复用：
   - SOAP 通过 `RetrieveServiceContent` 获取 `SessionManager`、`PropertyCollector` 引用；
   - `SessionManager.Login(userName,password)` 登录；
   - 后续 SOAP 请求通过 `Cookie` 维持会话。
2. 获得 Host 列表（仍可复用 REST `list hosts` 的 host MoRef，例如 `host-123`），但 **不再通过 REST 获取 host detail**。
3. 使用 `PropertyCollector.RetrievePropertiesEx` 批量读取所有 Host 的：
   - ESXi 版本：`summary.config.product.version/build`
   - CPU/内存：`summary.hardware.numCpuCores/memorySize` 与建议的 CPU 明细字段
4. 再批量读取（或同批次读取）本地物理盘信息：
   - 读取 `config.storageDevice.scsiLun`（或等价可获得 `HostScsiDisk` 的路径）
   - 仅统计 `HostScsiDisk.localDisk == true` 的容量之和 + `HostNvmeNamespace(blockSize * capacityInBlocks)` 之和，写入 `attributes.disk_total_bytes`
5. 将结果回填到对应 Host 的 normalized 中，最终由核心 ingest 写入 canonical 快照。

6. datastore total（建议）：
   - 先读取 HostSystem 的 `datastore`（MoRef 列表）
   - 再按 Datastore MoRef 批量读取 `summary.type` / `summary.capacity`
   - 过滤 `summary.type in {NFS,NFS41,vsan}` 后求和，写入 `attributes.datastore_total_bytes`

### UI & API（展示与搜索）

- 资产列表接口 `GET /api/v1/assets`：
  - Host 行 `os`：展示 `ESXi {version}`（来自 canonical 的 `os.name + os.version`）
  - Host 行 `cpuCount/memoryBytes`：来自 canonical `hardware.cpu_count/hardware.memory_bytes`
  - Host 行 `totalDiskBytes`：优先来自 canonical `attributes.disk_total_bytes`
  - Host 行 `ip`：来自 canonical `network.ip_addresses`（将数组去重/过滤后用 `", "` 拼接）
- 搜索 `q` 覆盖 `os.name`、`os.version`（本期不支持 `os.fingerprint`）

### Edge Cases

- SOAP SDK endpoint 不可达 / 登录失败：
  - 不应导致本次 collect 完全失败（除非现有策略要求失败）；
  - 对应 Host 的 `os.*` / `hardware.*` / `attributes.disk_total_bytes` 缺失，UI 显示 `-`；
  - 需要记录可定位的 warning/error（含阶段、HTTP 状态码、摘要等）。
- 本地盘信息不可读 / 无法判定本地盘（无 fallback）：
  - 该 Host 的 `attributes.disk_total_bytes` 缺失，UI 显示 `-`；
  - 记录 warning（含 host_id、字段路径、原因摘要）。
- 部分 Host 查询失败：
  - 其他 Host 仍能补齐；
  - 失败的 Host 字段缺失并产生 warning。
- 数值合理性校验（异常值视为缺失并记录 warning）：
  - `numCpuCores`：< 1 或 > 1024 视为异常
  - `memorySize`：< 0 或 > 200 TiB（219,902,325,555,200 bytes）视为异常
  - `disk_total_bytes`：< 0 或 > 200 TiB 视为异常

## Design Decisions

### Technical Approach

- 插件侧新增/扩展 SOAP 客户端（TypeScript/Bun 可实现）：
  - 以最少依赖实现 SOAP 调用（HTTP 发送 XML + 解析 XML；不强依赖完整 WSDL 代码生成）。
  - 优先批量 `RetrievePropertiesEx`，避免逐 Host 调用。
- 插件行为变更：
  - **取消 vCenter REST 获取 host detail 的能力**（Host 侧版本/硬件/磁盘信息全部靠 SOAP）。
  - REST 仅用于：会话创建（如复用）、Host/Cluster/VM 列表与关系构建（若现有实现依赖）。
- 数据落点：复用 normalized/canonical 的 `os/hardware/attributes` 结构承接（不新增 DB 列）。

### Constraints

- TLS：沿用现有插件策略（v1 允许自签名；跳过证书校验）。
- 超时策略：SOAP 请求超时时间为 30 秒。
- 重试策略：SOAP 请求失败时不重试，直接降级（对应字段缺失并记录 warning）。
- 规模假设：单个 vCenter 接管的 ESXi 主机数量 ≤ 20 台，无需分页/分批策略。
- 采集成功率：不设硬性目标，尽力而为；部分 Host 失败不影响整体 run 状态。

## Acceptance Criteria

### Functional Acceptance

- [ ] 对接 vCenter 跑一次 collect 后，Host 行“操作系统”列可展示为 `ESXi 7.0.3`（示例）。
- [ ] 对接 vCenter 跑一次 collect 后，Host 的 `os.fingerprint` 可写入 canonical（示例：`20036589`；本期不用于搜索/展示）。
- [ ] 对接 vCenter 跑一次 collect 后，Host 行 CPU 列可展示为线程数（示例：`64`）。
- [ ] 对接 vCenter 跑一次 collect 后，Host 行 内存 列可展示为总量（示例：`256 GiB`）。
- [ ] 对接 vCenter 跑一次 collect 后，Host 行 “总分配磁盘” 列可展示为本地物理盘总量（示例：`3.6 TiB`）。
- [ ] 对接 vCenter 跑一次 collect 后，Host 行 IP 列可展示为管理 IP（示例：`192.168.1.10`）。
- [ ] 对接 vCenter 跑一次 collect 后，Host 的 `identity.model` 可写入 canonical（示例：`ProLiant DL380p Gen8`）。
- [ ] 搜索 `ESXi` 或 `7.0.3` 可命中对应 Host（本期不支持 build 号搜索）。
- [ ] SOAP 不可用时不影响采集其它数据，且错误/告警可定位。

### Quality Standards

- [ ] 插件侧新增单测/集成测覆盖：SOAP 成功与失败降级路径（至少覆盖 version/build、CPU/内存、本地盘总量的解析与映射）。
- [ ] 文档同步：本 PRD + API spec/collector reference 至少更新一处并保持一致。

## Execution Phases

### Phase 1: SOAP 采集能力扩展（Host）

- [ ] SOAP 登录（RetrieveServiceContent + Login）与会话复用（Cookie）
- [ ] RetrievePropertiesEx 批量获取 Host ESXi version/build + CPU/内存（summary.hardware）
- [ ] RetrievePropertiesEx 批量获取 Host 本地盘容量并计算 `attributes.disk_total_bytes`
- [ ] 映射到 normalized 对应字段并串通到 canonical

### Phase 2: 列表展示与搜索对齐

- [ ] `GET /api/v1/assets` Host 行：
  - `os = ESXi {version}`
  - `cpuCount/memoryBytes` 对齐 canonical.hardware
  - `totalDiskBytes` 优先取 canonical.attributes.disk_total_bytes
- [ ] `q` 搜索覆盖 `os.name/os.version`

---

**Document Version**: 1.3
**Created**: 2026-01-30
**Clarification Rounds**: 5
**Quality Score**: 100/100
