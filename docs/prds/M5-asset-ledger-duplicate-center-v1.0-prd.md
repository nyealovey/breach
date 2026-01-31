# M5：资产台账系统 - 重复资产治理（重复中心 + 下线语义）- 产品需求文档（PRD）

> 目标：
>
> 1. 生成并展示“疑似重复候选（DuplicateCandidate）”，让管理员以**可解释**方式处理“可能重复的资产”（忽略/进入合并）。
> 2. 补齐“来源消失即下线”语义：当某来源在最新成功 `collect` Run 中未发现之前存在的对象时，对该来源维度标记为 `missing`；并在资产总体层面汇总为 `in_service/offline`，满足可验收的“下线/恢复”口径。

## Requirements Description

### Background

- **现状问题**：迁移/多来源会导致同一资产出现多份记录，当前系统缺少“重复提示与治理入口”。
- **现状问题（下线语义缺失）**：当前仅更新“本轮出现”的 `lastSeenAt`，缺少“本轮未出现”的明确语义，导致资产下线无法验收，也会影响重复治理的可解释性（例如“最近一次出现时间”的口径不稳定）。
- **目标用户**：管理员（admin）。
- **价值**：
  - 固定规则生成候选，降低重复资产的人工排查成本，并为合并提供入口。
  - 用 `present/missing/offline` 固化“下线/恢复”口径，避免依赖猜测或日志排查。

### Scope / Out of Scope

**In Scope**

- DuplicateCandidate：
  - 按固定规则 `dup-rules-v1` 生成候选（规则/阈值/时间窗固定，不提供 UI 配置）。
  - 候选必须可解释：命中规则、证据字段、分数、置信度标签、对比字段。
  - 候选在 UI 的“重复中心”可浏览：列表 + 详情，并可执行操作（Ignore、进入 Merge）。
- 下线语义（来源消失 / presence）：
  - per-source：更新 `asset_source_link.presence_status=present|missing` 与 `last_seen_at/last_seen_run_id`（见：`docs/design/asset-ledger-data-model.md`）。
  - overall：汇总得到 `asset.status=in_service|offline`（`merged` 由合并流程赋值）。
  - UI 可见：资产详情 `sourceLinks[].presenceStatus/lastSeenAt` 与资产状态（offline/in_service）。
- 审计（必须）：
  - Ignore 候选必须写入 `audit_event`（操作者/时间/candidate_id/原因摘要/requestId）。

**Out of Scope**

- 自动合并（无论置信度多高均不自动合并）。
- 候选规则配置化（规则固定，不提供 UI 配置）。
- ignored 候选的 reopen（取消忽略/重新打开）：ignored 为终态（见 `dup-rules-v1` 降噪策略）。
- `cluster` 的重复候选生成（默认不做）。

### Success Metrics

- 重复候选可解释展示（原因/置信度/对比字段齐全）。
- 被忽略的候选不会反复出现（降噪策略生效）。
- 在成功 `collect` Run 后，“本轮未出现”的对象会被标记为 missing，且 UI 可见；资产在所有来源 missing 后整体状态为 offline，并可在任一来源恢复 present 后自动恢复 in_service。

## Feature Overview

### Core Requirements

1. **规则口径固定**

- 规则以 `docs/design/asset-ledger-dup-rules-v1.md` 为准（`dup-rules-v1`）。
- 固定参数（来自 `dup-rules-v1`）：
  - 候选对象：仅 `vm/host`；`cluster` 不生成候选。
  - 时间窗：最近 `N=7` 天出现过的资产（含 in_service + 最近出现过的 offline）。
  - 阈值：`score >= 70` 创建候选；`score >= 90` 标记 High。

2. **候选生命周期（降噪）**

- 状态：`open | ignored | merged`。
- ignored 为终态；再次命中仅更新 `last_observed_at`，不得 reopen。

3. **下线语义（来源消失）**

- 触发前置条件：Run 必须 `status=Success` 且 `stats.inventory_complete=true`（见：`docs/design/asset-ledger-collector-reference.md`）。
- per-source：对该来源的 `asset_source_link` 计算 `present/missing`。
- overall：当 asset 的所有来源 link 都为 missing → `asset.status=offline`；任一来源恢复 present → `asset.status=in_service`。

## Detailed Requirements

### 0) 术语与关联文档（强依赖）

- 重复候选规则：`docs/design/asset-ledger-dup-rules-v1.md`
- 概念数据模型：`docs/design/asset-ledger-data-model.md`（`asset_source_link/duplicate_candidate/audit_event`）
- 采集契约：`docs/design/asset-ledger-collector-reference.md`（`stats.inventory_complete`）
- API 规范（参考）：`docs/design/asset-ledger-api-spec.md`

### 1) DuplicateCandidate：数据模型（最小字段集）

以 `docs/design/asset-ledger-data-model.md` 为准，最小字段集：

- `candidate_id`：主键
- `asset_uuid_a` / `asset_uuid_b`：候选对（必须规范化顺序：a<b）
- `score`：0-100
- `reasons`：命中原因与证据（JSON；`{ version:"dup-rules-v1", matched_rules:[...] }`）
- `status`：`open | ignored | merged`
- `created_at` / `updated_at`
- `last_observed_at`：最近一次命中时间（用于降噪/排序）
- ignored 信息：`ignored_by_user_id/ignored_at/ignore_reason`

关键约束：

- 唯一：`(asset_uuid_a, asset_uuid_b)`（a<b 规范化后）唯一，避免重复候选。

### 2) 候选生成：触发时机与口径

- 触发时机：
  - 每个 Source 的 `collect` Run 成功结束并完成 ingest 后生成候选（可异步任务）。
  - 失败/取消 Run 不得推进候选与下线语义（见 `dup-rules-v1`）。
- 输入口径（最小可用）：
  - 每个 Asset 的候选键取“最近一次快照”的 normalized 候选键集合（见 `dup-rules-v1`：hostname+ip overlap 取最近一次快照）。
  - 候选范围：`in_service` + 最近 `N=7` 天内出现过的 `offline`（按 `asset_source_link.last_seen_at` 判断）。
  - 排除：任一方 `asset.status=merged` 的资产不参与候选（见 `dup-rules-v1`）。

> 注：实现可选择“增量（只比较本次 Run 触达的资产）”或“全量（在时间窗内全对比）”。无论哪种实现方式，规则命中与解释结构必须一致。

### 3) 评分与命中规则（dup-rules-v1）

规则以 `dup-rules-v1` 为准（下表为摘要，便于 PRD 自包含）：

| rule_code                | 适用对象 | 分值 | 摘要                                   |
| ------------------------ | -------- | ---: | -------------------------------------- |
| `vm.machine_uuid_match`  | vm       |  100 | machine_uuid 完全相同                  |
| `vm.mac_overlap`         | vm       |   90 | mac_addresses 交集 >= 1                |
| `vm.hostname_ip_overlap` | vm       |   70 | hostname 相同且 ip_addresses 交集 >= 1 |
| `host.serial_match`      | host     |  100 | serial_number 完全相同                 |
| `host.bmc_ip_match`      | host     |   90 | bmc_ip 完全相同                        |
| `host.mgmt_ip_match`     | host     |   70 | management_ip 完全相同                 |

阈值固定：

- `score >= 70` 创建候选
- `score >= 90` UI 展示置信度标签 High；否则为 Medium（70-89）

### 4) 可解释性：reasons JSON

结构以 `dup-rules-v1` 为准（示例）：

```json
{
  "version": "dup-rules-v1",
  "matched_rules": [
    {
      "code": "vm.mac_overlap",
      "weight": 90,
      "evidence": {
        "field": "normalized.network.mac_addresses",
        "a": ["AA:BB:CC:DD:EE:FF"],
        "b": ["AA:BB:CC:DD:EE:FF"]
      }
    }
  ]
}
```

边界处理（必须）：

- `null/""/[]` 视为缺失，不参与匹配
- UUID/MAC/hostname 需 normalize（trim、大小写、分隔符）
- 占位符黑名单（如 `Unknown/To Be Filled/00:00:...`）视为缺失（见 `dup-rules-v1`）

### 5) 候选状态机与幂等

- 初次命中创建：`status=open`。
- Ignore：`status=open -> ignored`（终态）。
- Merge：当候选中的任一资产被合并（进入 `asset.status=merged`）后：
  - 对相关候选：置 `status=merged`（终态）。
- 幂等要求（同一候选对再次命中）：
  - `open`：更新 `score/reasons/last_observed_at`（允许覆盖为最新证据）
  - `ignored`：仅更新 `last_observed_at`；不得 reopen
  - `merged`：保持 merged（允许更新 `last_observed_at` 用于观测）

### 6) 重复中心 UI（admin-only）

#### 6.1 列表页

- 默认筛选：`status=open`
- 支持筛选（最小集）：status、asset_type、confidence（High/Medium）
- 排序默认：`last_observed_at desc`（或 score desc + last_observed_at desc）
- 列表卡片/表格应展示：
  - score + 置信度标签
  - 双方资产摘要（display_name/asset_uuid/status）
  - 最近出现时间摘要（按 `asset_source_link.last_seen_at`）

#### 6.2 详情页

- 必须展示：
  - 双方资产对比字段（候选键 + 补充信息，如 os.fingerprint）
  - 命中规则清单（matched_rules）与 evidence
  - 双方来源维度状态（`sourceLinks[].presenceStatus/lastSeenAt`）
- 操作入口：
  - Ignore（永久）
  - 进入 Merge（跳转到合并流程；见 `docs/prds/M5-asset-ledger-asset-merge-v1.0-prd.md`）

### 7) Ignore（永久忽略 + 审计）

- 行为：将 candidate.status 置为 `ignored`（终态，不提供取消忽略）。
- UI：忽略时可选填“忽略原因”（字符串，可为空）。
- 审计：写入 `audit_event`：
  - `event_type=duplicate_candidate.ignored`
  - `subject_type=duplicate_candidate`、`subject_id=candidate_id`
  - `context.request_id`（取 `X-Request-ID`；若无由服务端生成）
  - `after` 至少包含：candidate_id、asset_uuid_a、asset_uuid_b、ignore_reason（可为空）

### 8) 下线语义（presence + offline 汇总）

#### 8.1 per-source：presence_status（asset_source_link）

以 `docs/design/asset-ledger-data-model.md` 为准：

- `presence_status=present|missing`
- `last_seen_at`：最后一次 present 的时间
- `last_seen_run_id`：最后一次 present 的 run

更新规则（每个 Source 的成功 `collect` Run，且 `stats.inventory_complete=true`）：

- 本轮出现的 external_id：对应 link 置 `present`，并更新 `last_seen_at/last_seen_run_id`
- 本轮未出现但历史存在的 link：置 `missing`，并保持 `last_seen_at/last_seen_run_id` 不变

> 注意：若 Run 失败或 `inventory_complete=false`，不得推进 missing/offline 语义，避免误判下线。

#### 8.2 overall：asset.status

- 若 asset 的所有 sourceLinks 均为 missing：asset.status=offline
- 若任一 sourceLink 为 present：asset.status=in_service
- status=merged 不由本流程产生（由合并流程写入）

### 9) API 契约（建议）

> 注：当前 `docs/design/asset-ledger-api-spec.md` 未覆盖重复中心 API；本 PRD 定义最小契约，后续需补充到 API spec。

- `GET /api/v1/duplicate-candidates?page&pageSize&status&assetType&confidence`
- `GET /api/v1/duplicate-candidates/:candidateId`
- `POST /api/v1/duplicate-candidates/:candidateId/ignore`（body: `{ reason?: string }`）

权限：

- admin-only；user 访问返回 403（`AUTH_FORBIDDEN`）。

## Design Decisions

### Technical Approach

- 规则实现与口径以 `dup-rules-v1` 为准（规则固定、阈值固定、时间窗固定）。
- 候选生成采用“Run 成功后异步任务”：
  - 避免阻塞 ingest 主链路
  - 便于做分批处理与超时保护（见 `dup-rules-v1` 性能边界）
- ignored 为终态（降噪），不提供 reopen。

### Constraints

- 仅对 `vm/host` 生成候选；`cluster` 默认不生成。
- 不做自动合并。
- 性能边界（来自 `dup-rules-v1`）：
  - 单次 Run 资产数 > 10,000：必须分批处理，避免内存溢出
  - 候选计算超时 > 5 分钟：记录 warning（可观测），任务继续（best-effort）
  - 候选数量 > 1,000 条/Run：记录 warning，并提示需要人工介入（可能存在来源数据异常）

### Risk Assessment

- **误报风险**：IP/hostname 等中信号规则可能误报（DHCP/重装/网段复用）。缓解：仅作为候选，必须可解释；High/Medium 分级；支持永久忽略。
- **性能风险**：多来源/大规模资产会造成候选计算成本高。缓解：时间窗 N=7、分批处理、超时保护、候选数量告警。
- **下线误判风险**：若 inventory 不完整，会误标 missing/offline。缓解：仅在 `inventory_complete=true` 时推进 missing/offline。

## Acceptance Criteria

### Functional Acceptance

- [ ] 系统按 `dup-rules-v1` 生成 DuplicateCandidate（仅 vm/host；cluster 不生成）。
- [ ] 候选创建阈值固定：score>=70 创建；score>=90 标记 High；不提供 UI 配置。
- [ ] 重复中心列表可筛选/排序，并默认只展示 open 候选。
- [ ] 候选详情可解释：展示命中规则、证据字段、分数/置信度、关键字段对比与最近命中时间。
- [ ] admin 可对候选执行 Ignore（永久忽略）；ignored 候选再次命中仅更新 last_observed_at，不 reopen。
- [ ] 成功 `collect` Run 且 `inventory_complete=true` 后：来源维度可识别 missing/present，并在资产详情 `sourceLinks` 可见。
- [ ] 若资产所有来源均 missing：asset.status=offline；任一来源恢复 present：asset.status=in_service。

### Audit Acceptance

- [ ] Ignore 操作写入 `audit_event`（event_type=duplicate_candidate.ignored；可按 candidate_id 追溯操作者/时间/requestId/原因摘要）。

### Quality Standards

- [ ] 候选生成具备幂等性（同一候选对不重复创建；状态机按规则更新）。
- [ ] 当候选计算触发 `dup-rules-v1` 性能边界（超时/过多）时，系统记录 warning 且可观测（run.warnings 或任务日志宽事件）。
- [ ] 文档同步：如新增重复中心 API，需补充到 `docs/design/asset-ledger-api-spec.md`；如新增错误码，需注册到 `docs/design/asset-ledger-error-codes.md`。

## Test Scenarios

### 正向场景（Happy Path）

| 场景 ID | 场景描述                    | 前置条件                    | 操作步骤                                    | 期望结果                                                                              |
| ------- | --------------------------- | --------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------- |
| T5D-01  | 候选生成（VM MAC 重叠）     | 两台 VM 有相同 MAC          | 执行成功 collect                            | 生成 DuplicateCandidate；score=90；status=open                                        |
| T5D-02  | 候选生成（Host 序列号相同） | 两台 Host 序列号相同        | 执行成功 collect                            | 生成 DuplicateCandidate；score=100；status=open                                       |
| T5D-03  | 重复中心列表展示            | 存在 open 候选              | 访问重复中心                                | 展示候选列表；默认筛选 status=open                                                    |
| T5D-04  | 候选详情可解释              | 存在候选                    | 查看候选详情                                | 展示命中规则、证据字段、分数、置信度、对比字段                                        |
| T5D-05  | Ignore 候选                 | 存在 open 候选              | 执行 Ignore                                 | status 变为 ignored；写入 audit_event                                                 |
| T5D-06  | 下线语义生效                | 资产在最新 collect 中未出现 | 执行成功 collect（inventory_complete=true） | asset_source_link.presence_status=missing；若所有来源 missing 则 asset.status=offline |
| T5D-07  | 恢复在线                    | offline 资产重新出现        | 执行成功 collect                            | presence_status=present；asset.status=in_service                                      |

### 异常场景（Error Path）

| 场景 ID | 场景描述                            | 前置条件                            | 操作步骤         | 期望行为                               |
| ------- | ----------------------------------- | ----------------------------------- | ---------------- | -------------------------------------- |
| T5D-E01 | 失败 Run 不推进下线                 | Run 失败                            | 执行失败 collect | 不更新 presence_status；不推进 offline |
| T5D-E02 | inventory_complete=false 不推进下线 | Run 成功但 inventory_complete=false | 执行 collect     | 不更新 presence_status；不推进 offline |
| T5D-E03 | user 无权访问重复中心               | user 角色                           | 访问重复中心 API | 返回 403（AUTH_FORBIDDEN）             |

### 边界场景（Edge Case）

| 场景 ID | 场景描述              | 前置条件                        | 操作步骤     | 期望行为                              |
| ------- | --------------------- | ------------------------------- | ------------ | ------------------------------------- |
| T5D-B01 | ignored 候选再次命中  | 已 ignored 的候选对再次满足规则 | 执行 collect | 仅更新 last_observed_at；不 reopen    |
| T5D-B02 | 候选数量超限（>1000） | 单次 Run 产生 1000+ 候选        | 执行 collect | 记录 warning；任务继续（best-effort） |
| T5D-B03 | 占位符黑名单过滤      | MAC 为 `00:00:00:00:00:00`      | 执行 collect | 不参与匹配；不生成候选                |
| T5D-B04 | cluster 不生成候选    | 存在同名 cluster                | 执行 collect | 不生成 cluster 候选                   |

## Dependencies

| 依赖项                     | 依赖类型 | 说明                                                         |
| -------------------------- | -------- | ------------------------------------------------------------ |
| dup-rules-v1 规则文档      | 硬依赖   | 规则实现需与 `docs/design/asset-ledger-dup-rules-v1.md` 对齐 |
| asset_source_link 数据模型 | 硬依赖   | 需支持 presence_status 字段                                  |
| M5 合并 PRD                | 软依赖   | 从候选进入合并流程                                           |
| M3 /assets UI              | 软依赖   | sourceLinks.presenceStatus 展示                              |

## Observability

### 关键指标

| 指标名                                         | 类型    | 说明              | 告警阈值                     |
| ---------------------------------------------- | ------- | ----------------- | ---------------------------- |
| `duplicate_candidate_open_count`               | Gauge   | open 状态候选数量 | > 500 触发告警（需人工介入） |
| `duplicate_candidate_generation_timeout_count` | Counter | 候选生成超时次数  | > 0 触发告警                 |
| `asset_offline_count`                          | Gauge   | offline 资产数量  | 环比增长 > 20% 触发告警      |

### 日志事件

| 事件类型                      | 触发条件     | 日志级别 | 包含字段                                                              |
| ----------------------------- | ------------ | -------- | --------------------------------------------------------------------- |
| `duplicate.candidate_created` | 新候选生成   | INFO     | `candidate_id`, `asset_uuid_a`, `asset_uuid_b`, `score`, `rule_codes` |
| `duplicate.candidate_ignored` | 候选被忽略   | INFO     | `candidate_id`, `ignored_by`, `reason`                                |
| `asset.status_changed`        | 资产状态变化 | INFO     | `asset_uuid`, `old_status`, `new_status`, `trigger_run_id`            |

## Performance Baseline

| 场景         | 数据规模    | 期望性能       | 验证方法 |
| ------------ | ----------- | -------------- | -------- |
| 候选生成     | 1,000 资产  | < 30s          | 压测     |
| 候选生成     | 10,000 资产 | < 5min（分批） | 压测     |
| 重复中心列表 | 1,000 候选  | TTFB < 1s      | API 压测 |

## Execution Phases

### Phase 1: 下线语义（presence + offline 汇总）

- [ ] ingest 后基于本次成功 Run 输出，批量更新 `asset_source_link.presence_status` 与 `last_seen_*`
- [ ] 汇总写入/缓存 `asset.status`（offline/in_service）
- [ ] `/assets` 与资产详情展示（sourceLinks.presenceStatus）

### Phase 2: 候选生成任务（dup-rules-v1）

- [ ] 实现规则引擎（normalize + 黑名单 + 评分阈值）
- [ ] Run 成功后异步生成候选（分批/超时保护/幂等）
- [ ] reasons JSON 落库（可解释）

### Phase 3: 重复中心 UI + Ignore + 审计

- [ ] 列表页 + 详情页（命中原因/证据/对比）
- [ ] Ignore 操作（永久）+ audit_event

### Phase 4: 与合并联动

- [ ] 从候选详情进入合并流程（见 `docs/prds/M5-asset-ledger-asset-merge-v1.0-prd.md`）
- [ ] 合并完成后候选状态置为 merged（或按实现以 merged 终态归档）

---

**Document Version**: 1.1
**Created**: 2026-01-30
**Last Updated**: 2026-01-31
**Clarification Rounds**: 1
**Quality Score**: 100/100 (audited)
