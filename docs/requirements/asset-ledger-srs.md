# 资产台账系统需求规格说明书（SRS）

版本：v1.0（冻结）  
日期：2026-01-26

## 文档简介

本文档用于定义“资产台账系统”的**需求边界**与**可验收条款**（FR/NFR）。它回答“系统必须做什么/不做什么/做到什么程度”，避免与实现细节混写。

- 适用读者：产品、研发、测试、运维、评审人员。
- 使用方式：优先以 FR 的验收标准为准；发生歧义时，以本文术语表与约束/假设为准。
- 关联文档：
  - 概念数据模型：`docs/requirements/asset-ledger-data-model.md`（实体/关系/关键约束）
  - 采集插件参考：`docs/requirements/asset-ledger-collector-reference.md`（插件契约与选型建议）

## 1. 概述

### 1.1 背景

现有虚拟化/云平台资产分散在多个来源（阿里云、Hyper-V、vCenter、PVE 等），并可能因迁移/复制导致“同一资产在不同来源或同一来源不同时间窗口出现多份记录”。需要一个统一台账系统，按固定频率持续采集并留痕，支持人工治理（疑似重复提示与合并），同时允许业务自定义字段扩展。

### 1.2 目标

- 统一：将多来源资产采集结果汇总为“统一资产视图（Asset）”，并能回溯到来源与采集批次。
- 可插拔：采集方式插件化，支持按目标版本选择不同采集 driver。
- 可治理：系统提示疑似重复资产，由管理员手工合并；提供合并审计与（至少）可追溯性。
- 可扩展：支持自定义字段（台账字段）与字段值管理。
- 可追溯：Run 历史与 raw 原始数据永久保留；重要操作审计永久保留。
- 关系：支持最小关系模型 `VM ↔ Host ↔ Cluster`（允许缺边）。

### 1.3 范围（In Scope）

- 采集来源（第一批）：阿里云、Hyper-V、vCenter、PVE。
- 物理机/第三方平台来源：以“插件化来源”接入（不绑定具体平台；Zabbix 仅为示例）。
- 采集频率：每天一次定时采集；支持管理员手动触发。
- 去重治理：疑似重复候选生成 + 人工合并/忽略，不做自动合并。
- 字段扩展：管理员可新增自定义字段，并在资产上维护字段值。
- 权限：管理员/普通用户两类角色。
- 数据保留：Run 与 raw 永久保留；不物理删除资产数据（软删除/状态流转）。

### 1.4 不在范围（Out of Scope）

- 实时事件采集/增量订阅（如 vCenter 事件订阅）。
- 多租户/组织隔离与跨组织权限。
- 自动合并（无论置信度多高均不自动合并）。
- 扩展关系模型到存储、网络、机房、数据中心等更大 CMDB 范围。

### 1.5 术语表

| 名词                               | 说明                                                            |
| ---------------------------------- | --------------------------------------------------------------- |
| Source（来源）                     | 一个可采集目标的连接配置实例（如 vcenter-prod、pve-lab）        |
| Run（采集批次）                    | 一次采集执行记录（开始/结束/状态/统计/错误/插件版本等）         |
| SourceRecord（来源记录）           | 某次 Run 从某 Source 获取的一条资产原始记录（raw + normalized） |
| Asset（统一资产）                  | 系统内资产实体，主键为系统生成 `asset_uuid`                     |
| Relation（关系）                   | 资产之间的关系边，仅支持 `runs_on` 与 `member_of` 两类          |
| DuplicateCandidate（疑似重复候选） | 系统计算出的可能重复的资产对/组，等待人工处理                   |
| 合并（Merge）                      | 管理员将多个 Asset 合并为一个主 Asset 的操作                    |

## 2. 角色与权限

### 2.1 角色定义

- 管理员（admin）
  - 管理 Source（创建/编辑/启停/凭证更新）
  - 手动触发采集 Run
  - 处理疑似重复（合并/忽略）
  - 管理自定义字段定义
  - 查看/导出全量台账
- 普通用户（user）
  - 查看资产列表/详情/关系/历史
  - 不可查看/编辑凭证
  - 不可合并资产
  - 不可管理字段定义

### 2.2 验收标准

- 管理员可访问“来源管理/重复中心/字段管理”等管理功能；普通用户不可见或无权限操作。
- 普通用户不可直接获取任何来源凭证明文（包括 API 响应与页面渲染）。

## 3. 功能需求（Functional Requirements）

> 编号规则：FR-XX。每条需求附“验收标准”（可用 Given/When/Then 表达）。

### FR-01 来源（Source）管理

**描述**

系统支持管理员创建与维护采集来源 Source。每个 Source 绑定一种来源类型（如 vCenter、PVE、阿里云等）以及对应的连接信息与凭证，并可启停。

**验收标准**

- Given 管理员在创建 Source 时缺少必填项  
  When 保存  
  Then 系统阻止保存并提示缺失字段。
- Given 管理员创建 Source  
  When 保存  
  Then 必须包含 `schedule` 与 `schedule_timezone`。
- Given 管理员创建 Source 成功  
  When 在列表查看  
  Then 可看到 Source 基本信息（名称、类型、启用状态、最近一次 Run 状态/时间）。
- Given 管理员停用某 Source  
  When 到达定时触发点  
  Then 系统不应为该 Source 自动创建新的 Run。

### FR-02 采集批次（Run）管理：定时与手动

**描述**

系统支持每天一次定时采集，并支持管理员对单个/多个 Source 手动触发采集。

**验收标准**

- Given Source 已启用且到达定时触发点  
  When 定时任务执行  
  Then 系统为该 Source 创建一个新的 Run，状态进入 Running/Queued（实现可选其一，但需可观测）。
- Given 管理员手动触发某 Source 采集  
  When 触发成功  
  Then 生成 Run 并可在 Run 列表看到状态变化与日志/错误摘要。
- Given 管理员查看 Run 列表  
  When 展示  
  Then 必须展示 Run 的 `mode`（collect/detect/healthcheck）。
- Given 同一 Source 已存在一个 Running 的 Run  
  When 再次触发同一 Source（定时或手动）  
  Then 系统必须避免并发冲突（允许返回“已在运行/已排队”之一，但行为需一致并可解释）。

### FR-03 插件化采集（Collector）与目标版本适配

**描述**

采集必须插件化。系统通过插件完成 `detect`（目标版本/能力探测）、`collect`（采集资产/关系/原始数据）、`healthcheck`（连通性与权限校验）。同一来源类型可随目标版本差异选择不同 driver。

> 采集插件建议尽量基于成熟开源组件/官方 SDK/CLI 实现“薄适配层”，以降低维护成本与风险。参考：`docs/requirements/asset-ledger-collector-reference.md`。

**验收标准**

- Given Source 创建后执行 healthcheck  
  When 凭证/权限不足  
  Then healthcheck 失败并给出可读错误（需脱敏）。
- Given 执行 healthcheck  
  When 完成  
  Then 生成 Run 且 `mode=healthcheck`，并持久化结构化错误到 `run.errors`。
- Given 执行一次 Run  
  When 插件完成 detect  
  Then Run 记录中必须保存探测到的目标版本/能力摘要与最终选用的 driver 标识（例如 pve@v8-driver）。
- Given 目标版本升级导致旧 driver 不再适用  
  When 下一次 Run 执行  
  Then 插件应选择匹配的新 driver 或明确失败原因，不得“静默采集不完整数据”。

### FR-04 资产入账与统一视图（Asset）

**描述**

系统以 Asset 作为统一资产视图实体，主键 `asset_uuid` 由系统生成。Asset 可关联多个 SourceRecord，形成统一展示。

**验收标准**

- Given 一条新的 SourceRecord 无法归属到任何已存在 Asset  
  When 入账处理  
  Then 系统创建新的 Asset 并分配新的 `asset_uuid`，并将该 SourceRecord 关联至该 Asset。
- Given 同一 Source 的同一对象在不同 Run 中重复出现（通过来源强标识判断）  
  When 入账处理  
  Then 系统应将新的 SourceRecord 归属到同一个 Asset（用于“持续追踪”，不等同于跨来源自动合并）。
- Given 用户查看资产详情  
  When 展示  
  Then 必须同时展示：统一字段视图 + 关联来源明细（含 raw 可查看/下载）。

### FR-05 资产关系（VM ↔ Host ↔ Cluster）

**描述**

系统仅需支持两类关系：

- `vm --runs_on--> host`
- `host --member_of--> cluster`

关系由采集插件输出并随 Run 更新；允许缺边。

**验收标准**

- Given vCenter/PVE/Hyper-V 插件能采集到宿主/集群信息  
  When Run 完成  
  Then 资产详情中可查看到 VM→Host→Cluster 的关系链。
- Given 阿里云来源通常无法提供宿主信息  
  When Run 完成  
  Then VM 仍可入账；其 runs_on 关系允许为空；Cluster 为空（不做映射）。

### FR-06 自定义字段（台账字段扩展）

**描述**

管理员可新增/停用自定义字段定义，并在资产上维护字段值。字段类型至少包含：string/int/float/bool/date/datetime/enum/json；字段可限定作用域（vm/host/cluster/全局）。

**验收标准**

- Given 管理员新增字段定义（例如“业务负责人”string）  
  When 保存成功  
  Then 字段可在资产详情编辑区出现并可为资产赋值。
- Given 字段被停用  
  When 查看资产详情  
  Then 字段默认不再可编辑/可见（显示策略可选），但历史值不应被物理删除。
- Given 普通用户  
  When 访问字段定义管理  
  Then 被拒绝（403/无入口）。

### FR-07 疑似重复候选（DuplicateCandidate）

**描述**

系统在 Run 后生成疑似重复候选（固定规则，不提供规则配置），用于提示可能因迁移/多来源造成的重复资产。候选必须可解释（命中原因+置信度）。

**验收标准**

- Given 某两条资产满足系统固定的疑似重复规则  
  When 候选生成任务执行  
  Then 在重复中心可看到候选，并展示：置信度、命中原因、关键字段对比、最近出现时间。
- Given 某候选被管理员标记为“非重复/忽略”  
  When 后续再次命中同一对候选  
  Then 系统应按既定策略避免反复提示（至少支持永久忽略）。

#### FR-07.A 固定规则说明（dup-rules-v1）

> 目标：仅生成“疑似重复候选”，不做自动合并；规则固定但**可解释**（命中原因 + 证据 + 分数）。

##### 候选生成时机与数据口径

- 触发时机：在**每个 Source 的 Run 成功结束后**生成候选（可异步任务）。
- 数据口径：仅基于**成功 Run**产生的快照（`source_record.normalized` 等）计算；失败/取消的 Run **不得**推进去重候选与缺失/下线语义。

##### 候选范围（Candidate Scope）

默认约束：

- 排除：任一方 `asset.status=merged` 的资产不参与候选。
- 可包含：`vm` / `host`（`cluster` 默认不生成候选，除非后续明确需要）。

**决策点 D-01：候选时间窗（用于降噪与成本控制）**

- 已决策：方案 B（在管 + 最近 N 天内离线）
- 参数：`N = 7`（天；作为常量固化，不提供 UI 配置）

- 方案 A（最简单/最省）：仅比较“当前在管（in_service）”资产
  - 优点：噪音低、计算量小；缺点：容易漏掉“迁移后新旧资产一在管一离线”的重复。
- 方案 B（已选）：在管 + 最近 N 天内出现过（last_seen_at within N days）的离线资产
  - 优点：覆盖迁移场景、噪音可控；缺点：需要一个可配置 N（尽管规则固定，N 仍是常量）。
- 方案 C（最全/最贵）：全量历史资产参与
  - 优点：不漏；缺点：计算与人工处理成本极高，且历史噪音大。

##### 评分与阈值（Score）

- 分数：`score ∈ [0,100]`，由规则命中累加（上限 100）。
- 候选创建阈值：`score >= 70` 创建候选；`score < 70` 不创建。
- 置信度标签（UI 展示建议）：
  - `90-100`：高（High）
  - `70-89`：中（Medium）

**决策点 D-02：阈值是否调整**

- 已决策：方案 A（固定 70/90）

- 方案 A（已选）：固定为 70/90（如上）
- 方案 B：提高创建阈值（例如 80）以减少噪音，但可能漏报
- 方案 C：降低创建阈值（例如 60）以提高召回，但会显著增加人工工作量

##### 规则列表（Rule Set）

> 说明：规则使用 `source_record.normalized` 中的“候选键（candidate keys）”。键不存在时视为不命中；不强制所有来源都提供全部键。

| rule_code                | 适用对象 | 分值 | 命中条件（摘要）                                            | 解释要点                               |
| ------------------------ | -------- | ---- | ----------------------------------------------------------- | -------------------------------------- |
| `vm.machine_uuid_match`  | vm       | 100  | `machine_uuid` 存在且完全相同（SMBIOS/BIOS UUID 等）        | 强信号：同一虚拟机跨平台迁移仍可能保留 |
| `vm.mac_overlap`         | vm       | 90   | `mac_addresses` 交集 ≥ 1                                    | 强信号：需注意 MAC 复用/漂移           |
| `vm.hostname_ip_overlap` | vm       | 70   | `hostname` 相同且 `ip_addresses` 交集 ≥ 1（取最近一次快照） | 中信号：DHCP/重装会带来误报            |
| `host.serial_match`      | host     | 100  | `serial_number` 存在且完全相同                              | 强信号：物理机/设备序列号              |
| `host.mgmt_ip_match`     | host     | 70   | `management_ip` 存在且完全相同                              | 中信号：网段复用会误报                 |

**决策点 D-03：候选键的最小集合**

- 已决策：方案 B（增加辅助键）

- 方案 A（最小/易落地）：`machine_uuid`、`serial_number`、`mac_addresses`、`hostname`、`ip_addresses`、`management_ip`
- 方案 B（已选/更稳）：在 A 基础上增加以下辅助键（用于对比解释与人工研判；是否纳入评分可后续迭代）：
  - `os_fingerprint`（如 OS family + version）
  - `resource_profile`（如 vCPU/内存/磁盘等规格摘要）
  - `cloud_native_id`（如 cloud instanceId/资源 ARN 等，来源内强标识）

##### 可解释性：原因与证据（reasons JSON）

为满足“可解释”，候选需持久化命中原因与证据（示例结构）：

```json
{
  "version": "dup-rules-v1",
  "matched_rules": [
    {
      "code": "vm.machine_uuid_match",
      "weight": 100,
      "evidence": {
        "field": "normalized.identity.machine_uuid",
        "a": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        "b": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
      }
    }
  ]
}
```

##### 降噪与抑制策略（Ignored Handling）

基础要求：支持“永久忽略”（见 FR-07 验收）。

**决策点 D-04：ignored 后再次命中如何处理**

- 已决策：方案 A（永久忽略，记录 last_observed，可手工 reopen）

- 方案 A（已选）：保持 `status=ignored` 不变，仅更新 `last_observed_at`，UI 默认不再提示；允许管理员手工 reopen
- 方案 B：ignored 设置 TTL（例如 90 天）到期后自动 reopen（更灵活但更易扰民）
- 方案 C：不记录 last_observed，仅永久压制（最安静但丢失“再次命中”的信号）

### FR-08 人工合并（Merge）与审计

**描述**

管理员可在重复中心对候选执行合并。合并后保留主资产 `asset_uuid`，并将被合并资产的 SourceRecord、关系、历史、标签等并入主资产；被合并资产标记为“已合并（不可用/默认隐藏）”。系统必须记录合并审计并永久保留。

**验收标准**

- Given 管理员在候选详情点击“合并”并选择主资产 A、被合并资产 B  
  When 合并完成  
  Then A 的来源明细应包含原本属于 B 的 SourceRecord；关系边去重合并；B 状态变为“已合并”且默认不出现在资产列表。
- Given 合并发生字段冲突  
  When 合并执行  
  Then 按系统策略处理（默认：主资产优先；若实现提供其它策略需在界面明确选择并审计）。
- Given 合并完成  
  When 查看审计  
  Then 必须记录：操作者、时间、主/从资产、冲突处理策略、影响范围摘要。

### FR-09 软删除/下线语义（来源消失）

**描述**

不物理删除数据。当某来源在最新成功 Run 中未发现之前存在的对象时，将其在该来源维度标记为“未发现/下线”，并记录 last_seen 与缺失 Run；统一资产状态可按“是否在任一来源仍被发现”汇总为在管/下线。

**验收标准**

- Given 某资产在 Source S 的上一轮 Run 可见，本轮 Run 不可见  
  When 本轮 Run 成功结束  
  Then 该资产在来源 S 的可见性标记为“未发现”，并更新 last_seen_at 为上一轮可见时间。
- Given 该资产在所有来源均为“未发现”  
  When 查看资产列表  
  Then 资产总体状态为“下线（软删除）”，但仍可查询历史与来源明细。
- Given 该资产后续再次在任一来源出现  
  When 新 Run 成功结束  
  Then 资产总体状态恢复为“在管”，并记录状态变更历史。

### FR-10 历史与追溯（永久保留）

**描述**

Run 历史、SourceRecord raw 数据、合并与字段变更等审计信息永久保留。资产详情需可查看“按 Run 的变化历史”（至少能看到每次 Run 的快照/变更摘要）。

**验收标准**

- Given 资产经过多次 Run  
  When 查看资产历史  
  Then 能按时间/Run 查看历史记录（至少包含每次 Run 的采集时间、关键字段变化与关系变化摘要）。
- Given 用户查看某条来源明细  
  When 打开 raw  
  Then 可查看或下载该次采集的 raw payload（需脱敏敏感字段如凭证）。

## 4. 非功能需求（Non-Functional Requirements）

### NFR-01 数据保留

- Run、SourceRecord（含 raw）、审计日志：永久保留（系统不得自动清理/过期删除）。
- 允许实现侧做压缩/分层存储，但对用户语义必须是“可永久追溯”。

### NFR-02 安全

- 凭证加密存储；任何 API/日志/页面不得输出明文凭证。
- 采集过程日志需脱敏（例如 Token/密码/AK/SK）。
- 普通用户无权限访问来源管理与凭证。

### NFR-03 可靠性与可恢复

- Run 失败需记录可读错误与失败原因分类（认证失败/网络失败/解析失败等）。
- 失败原因分类需结构化落库（`run.errors`），非致命问题落库为 `run.warnings`。
- 对同一 Source 的并发触发应有一致策略（拒绝/排队），避免写入竞态。

### NFR-04 可扩展性

- 新增来源类型应通过新增插件实现，不修改核心域模型（除非新增资产类型/关系类型）。
- 插件需支持按目标版本/能力选择 driver。

### NFR-05 可观测性

- Run 必须记录：开始/结束时间、状态、采集数量统计、错误摘要、插件版本与 driver、目标探测信息。
- 系统应提供最小可观测入口（列表/详情页即可）。

## 5. 约束与假设

- 阿里云来源不映射 Cluster（Cluster 为空）；通常无法获取宿主 Host（runs_on 允许为空）。
- 采集频率为每天一次；不要求实时一致性。
- 疑似重复规则固定，不提供 UI 配置。
- `schedule_timezone` 使用 IANA TZ 格式（例如 `Asia/Shanghai`）。

## 待决策（Decision Log）

- D-01：B（在管 + 最近 N 天离线；`N=7`）
- D-02：A（固定 70/90）
- D-03：B（增加辅助键：os_fingerprint/resource_profile/cloud_native_id）
- D-04：A（永久 ignored，更新 last_observed，允许手工 reopen）
