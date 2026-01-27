# 资产台账系统需求规格说明书（SRS）

版本：v1.1  
日期：2026-01-26

## 文档简介

本文档用于定义“资产台账系统”的**需求边界**与**可验收条款**（FR/NFR）。它回答“系统必须做什么/不做什么/做到什么程度”，避免与实现细节混写。

- 适用读者：产品、研发、测试、运维、评审人员。
- 使用方式：优先以 FR 的验收标准为准；发生歧义时，以本文术语表与约束/假设为准。
- 关联文档：
  - 概念数据模型：`docs/design/asset-ledger-data-model.md`（实体/关系/关键约束）
  - 采集插件参考：`docs/design/asset-ledger-collector-reference.md`（插件契约与选型建议）
  - normalized/canonical JSON Schema：`docs/design/asset-ledger-json-schema.md`

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
  - 查看/下载来源 raw payload（需脱敏；下载动作需审计）
- 普通用户（user）
  - 查看资产列表/详情/关系/历史
  - 不可查看/编辑凭证
  - 不可查看/下载 raw payload
  - 不可合并资产
  - 不可管理字段定义

### 2.2 验收标准

- 管理员可访问“来源管理/重复中心/字段管理”等管理功能；普通用户不可见或无权限操作。
- 普通用户不可直接获取任何来源凭证明文（包括 API 响应与页面渲染）。
- 普通用户不可查看/下载任何来源 raw payload（403/无入口）。

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
  Then 必须绑定一个调度组（Schedule Group），用于“分组定时触发”（见 FR-02）。
- Given 管理员创建 Source 成功  
  When 在列表查看  
  Then 可看到 Source 基本信息（名称、类型、启用状态、最近一次 Run 状态/时间）。
- Given 管理员停用某 Source  
  When 到达定时触发点  
  Then 系统不应为该 Source 自动创建新的 Run。

### FR-01.A 调度组（Schedule Group）管理

**描述**

系统支持管理员定义“采集任务/调度组”，用于将不同采集任务分组，并在不同固定时间触发该组下的定时采集。

**验收标准**

- Given 管理员创建调度组时缺少必填项（名称、时区、触发时间）  
  When 保存  
  Then 系统阻止保存并提示缺失字段。
- Given 管理员创建调度组  
  When 保存  
  Then 触发时间必须为合法 `HH:mm`，时区必须为 IANA TZ（例如 `Asia/Shanghai`）。
- Given 管理员停用某调度组  
  When 到达该组的定时触发点  
  Then 系统不应为该组下的任何 Source 自动创建新的 Run。
- Given 管理员修改某调度组的触发时间  
  When 修改生效  
  Then 新触发时间仅影响下一次触发，不应对过去错过的触发点进行补跑。

### FR-02 采集批次（Run）管理：定时与手动

**描述**

系统支持按“调度组（Schedule Group）”进行每天一次的固定时间定时采集，并支持管理员对单个/多个 Source 手动触发采集。

**验收标准**

- Given 某调度组已启用且到达该组的定时触发点  
  When 定时任务执行  
  Then 系统应在触发点后 **≤ 60 秒** 内为该组下所有已启用 Source 创建新的 Run，状态进入 `Queued`（必须可观测）。
- Given 系统在某调度组触发点发生宕机/停止，导致错过触发点  
  When 系统在触发点之后恢复运行  
  Then 系统不得补跑该次定时采集（跳过），仅在下一次触发点到达时再创建 Run。
- Given 管理员手动触发某 Source 采集  
  When 触发成功  
  Then 生成 Run 并可在 Run 列表看到状态变化与日志/错误摘要。
- Given 管理员查看 Run 列表  
  When 展示  
  Then 必须展示 Run 的 `mode`（collect/detect/healthcheck）。
- Given 同一 Source 已存在一个状态为 `Queued` 或 `Running` 的 Run  
  When 再次触发同一 Source（定时或手动）  
  Then 系统不得创建新的 Run，而是返回当前活动 Run 的 `run_id`，并记录一次审计事件（例如 `run.trigger_suppressed`，包含 trigger_type 与原因）。

### FR-03 插件化采集（Collector）与目标版本适配

**描述**

采集必须插件化。系统通过插件完成 `detect`（目标版本/能力探测）、`collect`（采集资产/关系/原始数据）、`healthcheck`（连通性与权限校验）。同一来源类型可随目标版本差异选择不同 driver。

> 插件契约与实现建议见：`docs/design/asset-ledger-collector-reference.md`。

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
- Given 插件在 collect 模式无法保证“完整资产清单”（例如缺少列举权限/分页中断/接口错误）  
  When Run 执行  
  Then Run 必须失败并给出可读错误（需脱敏），不得以 warnings 方式标记成功。
- Given 插件输出 `assets[].normalized`  
  When 核心落库到 `source_record.normalized`  
  Then 其结构必须符合 `normalized-v1`（见：`docs/design/asset-ledger-json-schema.md`）。

### FR-04 资产入账与统一视图（Asset）

**描述**

系统以 Asset 作为统一资产视图实体，主键 `asset_uuid` 由系统生成。Asset 可关联多个 SourceRecord，形成统一展示。

**统一字段视图口径（canonical-v1）**

- 统一字段视图由关联的来源快照（SourceRecord.normalized）聚合得出，但必须保留字段级可追溯性（至少包含来源 `source_id` 与采集时间/Run）。
- 多值字段（如 `mac_addresses[]`、`ip_addresses[]`）在统一视图中取并集去重。
- 单值字段（如 `hostname`、`serial_number` 等）若存在多来源不一致，统一视图必须标记“冲突”，并展示当前选用值的来源；其余值在“关联来源明细”中可对比查看。
- **冲突字段默认选用策略（D-12，已决策）**：当单值字段存在多来源不一致时，默认选用“最新一次成功 `mode=collect` Run”所观察到的值（以 `run.finished_at`/`run.started_at` 作为时间序，取最新）；若最新来源该字段缺失，则回退到下一条更早的成功快照。
- 统一视图不应隐藏来源差异：用户必须能回溯到各来源的原始值与采集批次。
- canonical-v1 的结构（含字段级来源证据）见：`docs/design/asset-ledger-json-schema.md`。

**验收标准**

- Given 一条新的 SourceRecord 无法归属到任何已存在 Asset  
  When 入账处理  
  Then 系统创建新的 Asset 并分配新的 `asset_uuid`，并将该 SourceRecord 关联至该 Asset。
- Given 同一 Source 的同一对象在不同 Run 中重复出现（通过来源强标识判断）  
  When 入账处理  
  Then 系统应将新的 SourceRecord 归属到同一个 Asset（用于“持续追踪”，不等同于跨来源自动合并）。
- Given 用户查看资产详情  
  When 展示  
  Then 必须同时展示：统一字段视图（含字段来源/采集时间）+ 关联来源明细（normalized 对所有人可见；raw 仅管理员可查看/下载）。
- Given 同一 Asset 关联多个来源且某字段出现不一致（例如 hostname 不一致）  
  When 查看资产详情  
  Then 统一字段视图必须标记该字段为“冲突”，并在关联来源明细中可对比各来源值与采集时间。

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

> 规则细节（评分/阈值/候选键/降噪策略）属于“实现规范”，为避免与需求混写，已独立成文：`docs/design/asset-ledger-dup-rules-v1.md`。

### FR-08 人工合并（Merge）与审计

**描述**

管理员可在重复中心对候选执行合并。合并后保留主资产 `asset_uuid`，并将被合并资产的 SourceRecord、关系、历史、标签等并入主资产；被合并资产标记为“已合并（不可用/默认隐藏）”。系统必须记录合并审计并永久保留。

**验收标准**

- Given 管理员在候选详情点击“合并”并选择主资产 A、被合并资产 B  
  When 合并完成  
  Then A 的来源明细应包含原本属于 B 的 SourceRecord；关系边去重合并；B 状态变为“已合并”且默认不出现在资产列表。
- Given 合并发生字段冲突  
  When 合并执行  
  Then 系统按冲突处理策略解决（默认：主资产优先）；且必须在界面展示冲突字段清单、双方取值与最终采用值；冲突处理策略与冲突字段摘要必须写入审计。
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
- Given 管理员查看某条来源明细  
  When 打开 raw  
  Then 可查看或下载该次采集的 raw payload（需脱敏敏感字段如凭证），且下载动作必须记录审计。
- Given 普通用户查看某条来源明细  
  When 尝试打开 raw  
  Then 无入口或被拒绝（403）。

### FR-11 资产浏览、查询与导出

**描述**

系统提供资产列表的浏览与查询能力；管理员可导出全量台账用于盘点与离线分析。

**验收标准**

- Given 任一用户访问资产列表  
  When 展示  
  Then 必须支持分页；支持按 `asset_type`、`status`、`source` 等过滤；支持关键字搜索（至少覆盖 `asset_uuid`/hostname/external_id）。
- Given 用户在资产列表选择排序  
  When 生效  
  Then 至少支持按 `last_seen_at` 与 `display_name` 排序。
- Given 管理员发起“导出全量台账”  
  When 导出完成  
  Then 生成可下载文件（CSV/JSON 其一即可），且每行/每条至少包含：`asset_uuid`、`asset_type`、`status`、`display_name`、`last_seen_at`、来源摘要（source_id/source_type）；导出动作必须记录审计。
- Given 普通用户发起“导出全量台账”  
  When 执行  
  Then 无入口或被拒绝（403）。

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
- 对同一 Source 的并发触发必须采用单一策略（见 FR-02），避免写入竞态。

### NFR-04 可扩展性

- 新增来源类型应通过新增插件实现，不修改核心域模型（除非新增资产类型/关系类型）。
- 插件需支持按目标版本/能力选择 driver。

### NFR-05 可观测性

- Run 必须记录：开始/结束时间、状态、采集数量统计、错误摘要、插件版本与 driver、目标探测信息。
- 系统应提供最小可观测入口（列表/详情页即可）。

### NFR-06 容量与备份恢复

- 系统必须提供可执行的备份与恢复方案（包含 DB 数据与 raw/审计数据），确保恢复后仍满足“永久可追溯”语义。
- 由于 raw 与审计永久保留，系统必须有容量规划与告警；实现侧应支持数据分区/归档/分层存储等手段控制长期存储成本（语义不变）。

### NFR-07 Raw 存储（永久保留/压缩/可下载，可验收）

> 背景：raw 永久保留会快速膨胀；若将 raw 长期内联在 DB，会显著放大容量、备份与查询成本。

- raw 必须永久保留，且满足“可追溯/可下载/可校验”的语义（见 FR-10 与 NFR-06）。
- raw 必须启用压缩；实现需记录压缩算法到元数据 `raw_compression`（推荐默认 zstd，亦可在实现阶段选择等价算法）。
- 系统必须为每条 raw 记录元数据（最小集合）：`raw_ref`（可定位/可下载的引用或路径）+ `raw_hash`（可校验）+ `raw_size_bytes` + `raw_compression`（可扩展 `raw_mime_type/raw_inline_excerpt` 等）。
- 实现可选对象存储/数据库/分层存储，但必须满足容量与备份恢复要求；推荐方案与字段口径见：
  - `docs/design/asset-ledger-data-model.md`
  - `docs/design/asset-ledger-collector-reference.md`
- `source_record` / `relation_record` 等高增长表必须采用时间分区（按月或等价策略），以保证长期查询与维护可控。

**验收标准**

- Given 一个 `mode=collect` 的 Run 成功结束  
  When 系统持久化 SourceRecord/RelationRecord  
  Then 每条记录必须同时具备：`raw_ref`（可下载）+ `raw_hash`（可校验）+ `raw_size_bytes` + `raw_compression`。
- Given raw 存储不可用（例如对象存储不可用或 DB 写入失败）  
  When 系统无法写入 raw  
  Then 该 Run 必须失败，并给出可读错误（不得标记为成功）。

## 5. 约束与假设

- 阿里云来源不映射 Cluster（Cluster 为空）；通常无法获取宿主 Host（runs_on 允许为空）。
- 采集频率为每天一次；不要求实时一致性。
- 疑似重复规则固定，不提供 UI 配置。
- 调度相关时区字段使用 IANA TZ 格式（例如 `Asia/Shanghai`）。
