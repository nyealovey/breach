# 决策记录索引（Decision Log Index）

版本：v1.0
日期：2026-01-27

## 文档简介

本文档汇总资产台账系统所有已确认的技术决策（D-xx），便于快速查阅与追溯。

- 适用读者：研发、架构评审、产品经理。
- 使用方式：按编号查找决策详情；决策详情在对应的源文档中。

## 决策状态说明

| 状态 | 说明 |
|-----|------|
| ✅ 已确认 | 决策已确认，可直接执行 |
| 🔄 待确认 | 决策待讨论或评审 |
| ❌ 已废弃 | 决策已被新决策替代 |

## 决策索引

### 疑似重复规则（dup-rules-v1）

| 编号 | 决策 | 状态 | 源文档 |
|-----|------|------|-------|
| D-01 | 候选时间窗 N=7 天 | ✅ 已确认 | [dup-rules-v1.md](../design/asset-ledger-dup-rules-v1.md) |
| D-02 | 阈值固定：创建 ≥70，High ≥90 | ✅ 已确认 | [dup-rules-v1.md](../design/asset-ledger-dup-rules-v1.md) |
| D-03 | 候选键集合：machine_uuid/serial_number/mac_addresses/hostname/ip_addresses/bmc_ip | ✅ 已确认 | [dup-rules-v1.md](../design/asset-ledger-dup-rules-v1.md) |
| D-04 | ignored 抑制策略：保持 ignored 不变，不提供 reopen | ✅ 已确认 | [dup-rules-v1.md](../design/asset-ledger-dup-rules-v1.md) |

### 数据模型（data-model）

| 编号 | 决策 | 状态 | 源文档 |
|-----|------|------|-------|
| D-05 | 审计落库形态：仅使用 audit_event 统一承载所有审计 | ✅ 已确认 | [data-model.md](../design/asset-ledger-data-model.md) |
| D-06 | subject 外键策略：对常见对象增加可选 typed FK 列 | ✅ 已确认 | [data-model.md](../design/asset-ledger-data-model.md) |
| D-07 | 历史快照形态：物化 asset_run_snapshot | ✅ 已确认 | [data-model.md](../design/asset-ledger-data-model.md) |
| D-08 | 分区策略：source_record/relation_record 按 collected_at 月分区 | ✅ 已确认 | [data-model.md](../design/asset-ledger-data-model.md) |

### 采集插件契约（collector-reference）

| 编号 | 决策 | 状态 | 源文档 |
|-----|------|------|-------|
| D-09 | 错误信号主判据：退出码为主，errors[] 用于解释 | ✅ 已确认 | [collector-reference.md](../design/asset-ledger-collector-reference.md) |
| D-10 | 部分成功落库：允许落库排障证据，但 Run 失败 | ✅ 已确认 | [collector-reference.md](../design/asset-ledger-collector-reference.md) |
| D-11 | raw 落库方案：PG 内联 bytea + zstd 压缩 | ✅ 已确认 | [collector-reference.md](../design/asset-ledger-collector-reference.md) |
| D-12 | 压缩策略：固定 zstd | ✅ 已确认 | [collector-reference.md](../design/asset-ledger-collector-reference.md) |

### SRS / PRD

| 编号 | 决策 | 状态 | 源文档 |
|-----|------|------|-------|
| D-13 | 冲突字段默认选用策略：最新成功 collect Run 的值 | ✅ 已确认 | [srs.md](../requirements/asset-ledger-srs.md) |
| D-14 | OpenAPI 生成方式：Zod schema 生成，单一真相 | ✅ 已确认 | [vcenter-mvp-design.md](../design/asset-ledger-vcenter-mvp-design.md) |

### 技术设计（vcenter-mvp-design）

| 编号 | 决策 | 状态 | 源文档 |
|-----|------|------|-------|
| D-15 | 部署形态：单机自建 | ✅ 已确认 | [vcenter-mvp-design.md](../design/asset-ledger-vcenter-mvp-design.md) |
| D-16 | 存储：仅 PostgreSQL（不引入对象存储/Redis） | ✅ 已确认 | [vcenter-mvp-design.md](../design/asset-ledger-vcenter-mvp-design.md) |
| D-17 | ORM：Prisma | ✅ 已确认 | [vcenter-mvp-design.md](../design/asset-ledger-vcenter-mvp-design.md) |
| D-18 | 调度：错过触发点不补跑（skip） | ✅ 已确认 | [vcenter-mvp-design.md](../design/asset-ledger-vcenter-mvp-design.md) |
| D-19 | 凭证加密：aes-256-gcm + 随机 nonce | ✅ 已确认 | [vcenter-mvp-design.md](../design/asset-ledger-vcenter-mvp-design.md) |
| D-20 | 认证方式：Session（HttpOnly Cookie），v1.0 不使用 JWT | ✅ 已确认 | [vcenter-mvp-design.md](../design/asset-ledger-vcenter-mvp-design.md) |

## 决策变更流程

1. **提出**：在相关文档中新增决策条目，状态标记为 🔄 待确认
2. **评审**：在 PR 中讨论，达成共识
3. **确认**：合并 PR 后，状态更新为 ✅ 已确认，并同步更新本索引
4. **废弃**：如需废弃，状态更新为 ❌ 已废弃，并说明替代决策

## 决策编号规则

- 格式：`D-XX`（两位数字，从 01 开始）
- 新增决策使用下一个可用编号
- 废弃决策编号不复用
