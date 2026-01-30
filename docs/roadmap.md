# 资产台账系统 Post-MVP 里程碑路线图（草案）

日期：2026-01-30

## 背景与约定

- **当前仓库代码实现 = MVP**（不改动代码结构，仅做文档归档）。
- MVP 相关 PRD/计划/追溯矩阵/技术设计已归档到：`docs/mvp/`
- 后续新增/迭代需求文档（PRD）统一放到：`docs/prds/`

## 优先级原则（建议）

> 说明：里程碑编号（M1/M2/…）用于“主题拆分”，不等同于“开发顺序”。  
> 本节给出一个以“减少返工/降低耦合”为目标的推荐顺序。

优先级策略（你已确认）：**C（稳定性/可定位） > B（覆盖面/新来源） > A（治理/权限/协作）**。

建议执行顺序（草案，按低耦合优先）：

1. C：/runs 失败可定位（错误码 + 建议动作）：`docs/prds/M3-asset-ledger-runs-ui-optimizations-v1.0-prd.md`
2. C：vCenter 6.5 兼容性增强：`docs/prds/M1-asset-ledger-vcenter-6.5-compat-v1.0-prd.md`
3. C：/assets/[uuid] 详情字段可读化底座（中文字段名 + 分块/分组 + 值渲染规范）：包含在 `docs/prds/M3-asset-ledger-ui-optimizations-v1.0-prd.md`
4. B：采集字段覆盖面增强（示例：Host Datastore 明细）：`docs/prds/M2-asset-ledger-collector-optimizations-v1.0-prd.md`
5. B：新增来源（按实际场景优先级微调）：PVE（M6）→ Hyper-V（M4）→ 物理机（M10）→ 阿里云（M11）
6. A：治理与协作能力（建议在多来源落地后再做）：重复中心/合并（M5）→ 自定义字段（M8）→ 台账字段批量维护（M9）→ 历史追溯（M12）→ 导出（M8）→ user 只读（M7）

减少返工的关键约束（建议作为“稳定契约”先定）：

- **Schema 先行**：新增字段尽量落到 `docs/design/asset-ledger-json-schema.md` 约定的结构化路径；无法结构化才进 `attributes.*`。
- **UI 展示层稳定**：资产详情的 canonical 展示遵循“字段字典（field registry）+ 分块/分组 + 值渲染”规范；后续新增字段/新增来源以“补字典/补格式化规则”为主，避免推倒页面结构。
- **错误口径稳定**：错误码（error.code）必须稳定枚举；UI 映射表增量维护，不依赖 message 文本。

## 里程碑拆分（建议）

### M0：vCenter MVP（已完成/归档）

- 文档入口：`docs/mvp/index.md`

### M1：vCenter 6.5 兼容性增强

目标：确保在真实 **vCenter Server 6.5** 环境中，`detect/collect_hosts/collect_vms` 的关键路径稳定可用，并且 UI/错误提示口径一致。

范围（草案）：

- driver/capabilities：补齐/修正对 6.5 的能力探测与判定口径，避免“误判可用/误判不可用”。
- SOAP/REST 差异：针对 6.5 的字段缺失/结构差异做明确的“必填/可选”口径与错误码。
- 回归用例：补充最小兼容性用例清单（不要求引入测试框架，但至少形成可重复的验证步骤/样例输出）。

交付物（计划）：

- PRD：`docs/prds/M1-asset-ledger-vcenter-6.5-compat-v1.0-prd.md`
- 工程计划：按 PRD 拆分到 `docs/plans/`（待创建）

已确认：

1. 目标版本：vCenter Server 6.5
2. 验收范围：`detect`、`collect_hosts`、`collect_vms` 都必须可用

### M2：采集项优化（Collector 优化）

目标：在不破坏现有契约与数据口径的前提下，优先提升采集项的**字段覆盖面**（补齐更多 inventory 字段），并为后续性能/稳定性优化打基础。

范围（草案）：

- 覆盖面：明确“必须采集项/可选采集项/不采集项”的清单与版本差异。
- 性能：减少 API 调用次数、避免重复拉取、必要时并发/批量化；Run 级别可观测（统计项更可用）。
- 稳定性：对超时、单对象失败、分页/游标等边界给出一致策略（Fail fast vs 部分成功）。

交付物（计划）：

- PRD：`docs/prds/M2-asset-ledger-collector-optimizations-v1.0-prd.md`
- 设计补充（必要时）：`docs/design/`（按主题新增）

已确认：

1. 优先补齐字段：Host 的 Datastore 明细（名称 + 容量），在保留现有总容量口径的基础上补齐拆分信息

### M3：UI 优化

目标：优先提升 **/assets** 页面的易用性与可观测性，减少“需要查日志才能定位问题”的场景。

范围（草案）：

- /assets：列表信息密度、筛选/搜索、详情页信息组织、关系链可读性。
- /runs：优先做失败可定位（错误码 + 可执行建议动作）；统计展示可后续补齐；暂不做“从 /runs 直接打开 raw”的入口（raw 仍仅在资产详情可查看，admin-only）。
- 通用：加载性能、空状态/错误状态一致性、表单校验与提示文案。

交付物（计划）：

- PRD（/assets）：`docs/prds/M3-asset-ledger-ui-optimizations-v1.0-prd.md`
- PRD（/runs）：`docs/prds/M3-asset-ledger-runs-ui-optimizations-v1.0-prd.md`

已确认：

1. 优先级顺序：筛选/搜索（A）→ 列配置（B）→ 详情信息组织（C）→ 关系链展示（D）
2. 列配置持久化方式：DB（按用户，单份全局配置；不持久化列顺序）
3. /runs 优化优先级：A（错误码→可读原因 + 建议动作）；暂不增加“从 /runs 打开 raw”的入口

### M4：Hyper-V 采集（单机 + Failover Cluster（含 S2D））

目标：新增 Hyper-V 来源采集能力，覆盖单机与故障转移群集（含 S2D 场景），并满足虚拟化平台“关系边可用”的最低要求（禁止 relations=0 伪成功）。

范围（草案）：

- 单机：Host/VM 盘点字段与 VM→Host 关系。
- Failover Cluster：Cluster/Host/VM 盘点字段与 VM→Host→Cluster 关系（允许缺边，但禁止 relations=0 伪成功）。
- S2D：本期以“群集形态识别 + 最小盘点字段可用”为主（存储明细另立 PRD）。

交付物（计划）：

- PRD：`docs/prds/M4-asset-ledger-hyperv-collector-v1.0-prd.md`

### M5：重复资产治理（重复中心 + 下线语义）+ 合并治理

目标：支持显示疑似重复资产（可解释）、补齐来源消失下线语义，并提供人工合并能力（含审计与默认隐藏被合并资产）。

范围（草案）：

- 重复中心（DuplicateCandidate）：按固定规则生成候选，展示命中原因/置信度/关键字段对比，支持忽略。
- 下线语义（来源消失）：本轮成功 Run 未发现 → 标记来源维度为 missing；资产在所有来源均 missing → overall offline；再次出现可恢复。
- 合并（Merge）：主/从资产选择、关系/来源明细并入、冲突处理策略、审计落库；被合并资产默认隐藏。

交付物（计划）：

- PRD（重复中心 + 下线语义）：`docs/prds/M5-asset-ledger-duplicate-center-v1.0-prd.md`
- PRD（合并与审计）：`docs/prds/M5-asset-ledger-asset-merge-v1.0-prd.md`

### M6：PVE 采集（兼容 5.0 ～ 8.0）

目标：新增 PVE 来源采集能力，并确保 **PVE 5.0～8.0** 的关键路径可用（detect/collect，字段解析健壮，错误口径一致）。

交付物（计划）：

- PRD：`docs/prds/M6-asset-ledger-pve-5-8-compat-v1.0-prd.md`

### M7：权限拓展（普通用户只读）

目标：在不扩大敏感面（凭证/raw/治理操作）的前提下，支持 **普通用户（user）** 只读访问资产与运行结果，满足 SRS 的角色模型。

交付物（计划）：

- PRD：`docs/prds/M7-asset-ledger-user-readonly-access-v1.0-prd.md`

### M8：自定义字段 + 全量导出（CSV）

目标：支持管理员配置台账自定义字段，并支持全量导出用于盘点与离线分析（导出需审计、权限受控）。

交付物（计划）：

- PRD（自定义字段）：`docs/prds/M8-asset-ledger-custom-fields-v1.0-prd.md`
- PRD（导出 CSV）：`docs/prds/M8-asset-ledger-export-csv-v1.0-prd.md`

### M9：批量维护台账字段（批量编辑自定义字段 + 资产详情一键保存）

目标：为“自定义字段（台账字段扩展）”补齐可持续的维护能力：

- 多资产：在资产列表中选择一批资产，并一次性设置某个自定义字段的值，用于快速完成资产归类（分级/负责人/地区/公司等）。
- 单资产：在资产详情中一次保存多个台账字段变更（自定义字段 + 覆盖机器名 + 覆盖 IP），替代原“编辑机器名”列表弹窗。

范围（草案）：

- 入口：资产列表（/assets）提供“批量编辑”入口（admin-only）。
- 选择：仅支持“当前页勾选”（分页建议提升为 100 行/页）。
- 操作：一次仅设置 1 个启用的自定义字段；值可为 `null`（等价于清空/未设置）；总是覆盖。
- 辅助筛选：新增“最近入账 7 天”筛选，以便快速定位新起服务器；自定义字段筛选（含空值筛选）由后续版本补齐。
- 单资产编辑：在资产详情（/assets/[uuid]）提供“编辑模式”，可一次提交多个自定义字段 + `machineNameOverride` + `ipOverride`（仅 IPv4，做格式校验）。
- 审计：批量变更与单资产一键保存都必须写入审计事件（操作者/变更摘要/requestId）。

交付物（计划）：

- PRD：`docs/prds/M9-asset-ledger-bulk-edit-custom-fields-v1.0-prd.md`

### M10：物理机采集（Windows + Linux）

目标：将 Windows/Linux 普通物理机纳入统一资产视图（Host 资产），补齐最小盘点字段集与可追溯 raw（关系默认不输出 runs_on/member_of）。

交付物（计划）：

- PRD（Windows 物理机）：`docs/prds/M10-asset-ledger-windows-physical-collector-v1.0-prd.md`
- PRD（Linux 物理机）：`docs/prds/M10-asset-ledger-linux-physical-collector-v1.0-prd.md`

### M11：阿里云采集（Aliyun）

目标：新增阿里云来源采集能力（以 ECS 为主），满足 “多来源资产汇总 + 可追溯” 的最小闭环。

交付物（计划）：

- PRD：`docs/prds/M11-asset-ledger-aliyun-collector-v1.0-prd.md`

### M12：资产历史追溯（按 Run）

目标：资产详情提供“历史/时间线”入口，按 Run 展示关键字段变化与关系变化摘要，满足可追溯验收要求。

交付物（计划）：

- PRD：`docs/prds/M12-asset-ledger-asset-history-v1.0-prd.md`
