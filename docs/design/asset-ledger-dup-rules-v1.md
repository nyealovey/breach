# 资产台账 dup-rules-v1（疑似重复候选规则）

版本：v1.1  
日期：2026-01-26

## 文档简介

本文档沉淀资产台账系统的“疑似重复候选（DuplicateCandidate）”生成规则 `dup-rules-v1`，用于在多来源/迁移场景下提示可能重复的资产记录，并支持人工合并/忽略。

- 适用读者：产品、研发、测试、评审人员。
- 规则定位：**只生成候选，不做自动合并**；规则固定但必须可解释（命中原因 + 证据 + 分数）。
- 关联文档：
  - SRS：`docs/requirements/asset-ledger-srs.md`（FR-07：疑似重复候选）
  - normalized/canonical JSON Schema：`docs/design/asset-ledger-json-schema.md`（候选键字段落点）

## 1. 触发时机与数据口径

- 触发时机：在**每个 Source 的 Run 成功结束后**生成候选（可异步任务）。
- 数据口径：仅基于**成功 Run**产生的快照（`source_record.normalized` 等）计算；失败/取消的 Run **不得**推进去重候选与缺失/下线语义。

## 2. 候选范围（Candidate Scope）

默认约束：

- 排除：任一方 `asset.status=merged` 的资产不参与候选。
- 可包含：`vm` / `host`（`cluster` 默认不生成候选，除非后续明确需要）。

## 3. 候选时间窗（D-01，已决策）

- 候选范围：在管（in_service）+ 最近 `N` 天内出现过（`last_seen_at` within N days）的离线资产。
- 参数：`N = 7`（天；常量固化，不提供 UI 配置）。
- 目的：覆盖迁移场景，同时控制噪音与计算成本。

## 4. 评分与阈值

- 分数：`score ∈ [0,100]`，由规则命中累加（上限 100）。
- 候选创建阈值：`score >= 70` 创建候选；`score < 70` 不创建。
- 置信度标签（UI 展示建议）：
  - `90-100`：高（High）
  - `70-89`：中（Medium）

## 5. 阈值固定（D-02，已决策）

- 固定阈值：创建 `score >= 70`；High `score >= 90`。不提供配置项。

## 6. 规则列表（Rule Set）

> 说明：规则使用 `source_record.normalized` 中的“候选键（candidate keys）”。键不存在时视为不命中；不强制所有来源都提供全部键。

| rule_code                | 适用对象 | 分值 | 命中条件（摘要）                                            | 解释要点                                       |
| ------------------------ | -------- | ---- | ----------------------------------------------------------- | ---------------------------------------------- |
| `vm.machine_uuid_match`  | vm       | 100  | `machine_uuid` 存在且完全相同（SMBIOS/BIOS UUID 等）        | 强信号：同一虚拟机跨平台迁移仍可能保留         |
| `vm.mac_overlap`         | vm       | 90   | `mac_addresses` 交集 ≥ 1                                    | 强信号：需注意 MAC 复用/漂移                   |
| `vm.hostname_ip_overlap` | vm       | 70   | `hostname` 相同且 `ip_addresses` 交集 ≥ 1（取最近一次快照） | 中信号：DHCP/重装会带来误报                    |
| `host.serial_match`      | host     | 100  | `serial_number` 存在且完全相同                              | 强信号：物理机/设备序列号                      |
| `host.bmc_ip_match`      | host     | 90   | `bmc_ip` 存在且完全相同                                     | 强信号：OOB 管理地址通常稳定；仍需注意 IP 复用 |
| `host.mgmt_ip_match`     | host     | 70   | `management_ip` 存在且完全相同                              | 中信号：网段复用会误报                         |

## 7. 候选键集合（D-03，已决策）

- 最小集合：`machine_uuid`、`serial_number`、`mac_addresses`、`hostname`、`ip_addresses`、`bmc_ip`（host）
- 可选：`management_ip`（host，in-band；仅来源可稳定提供时使用）
- 辅助键（用于解释与人工研判；默认不计分）：`os.fingerprint`、`resource.profile`、`identity.cloud_native_id`

## 8. 可解释性：原因与证据（reasons JSON）

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

## 9. 降噪与抑制策略（Ignored Handling）

基础要求：支持“永久忽略”。

### ignored 抑制策略（D-04，已决策）

- 处理：保持 `status=ignored` 不变；再次命中仅更新 `last_observed_at`，默认不再提示。
- 可选增强：管理员可手工 `reopen`（将 ignored 重新置为 open），并记录审计事件（建议 `duplicate_candidate.reopened`）。若未实现，则 ignored 仅支持永久抑制（不提供 reopen 入口）。
