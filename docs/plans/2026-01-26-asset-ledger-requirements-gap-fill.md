# Asset Ledger Requirements Gap Fill Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 `docs/requirements/` 下三份资产台账需求文档补齐 3 个关键缺口，并补充每份文档的“文档简介”与“待决策清单（D-xx）”：

1. DuplicateCandidate 规则/评分/解释字典（落在 SRS）
2. 审计与历史口径（落在数据模型）
3. 插件错误模型 + raw 存储/压缩方案（落在采集插件参考）

**Architecture:** 直接在三份现有文档中新增对应章节；所有存在多种方案的点以“决策点 D-xx”形式记录（含方案对比），并在文档末尾汇总“待决策”清单，便于统一拍板。

**Tech Stack:** Markdown、Mermaid（`~/.codex/skills/mermaid/scripts/validate_mermaid.sh`）、Prettier（`bun run format:check`）。

---

### Task 1: 补齐 SRS（1/3）— DuplicateCandidate 规则/评分/解释 + 文档简介

**Files:**

- Modify: `docs/requirements/asset-ledger-srs.md`

**Step 1: 增加“文档简介”**

- 在标题与版本信息后新增：适用读者/使用方式/与其它文档的关系。

**Step 2: 在 FR-07 下补充“固定规则说明”**

- 明确：候选生成时机、候选范围（asset_type/时间窗）、阈值（创建/展示）、抑制策略（ignored 后如何处理）。
- 给出：规则列表（rule_code）、证据字段（evidence）、评分权重（score）与解释字典。
- 所有可选项以“决策点 D-xx”写入（不做最终选择）。

**Step 3: 小幅对齐语义**

- 明确“仅基于最新成功 Run 推进缺失/下线与关系 inactive”的口径（补充一句约束即可）。

---

### Task 2: 补齐数据模型（2/3）— 审计与历史口径 + ER 图更新 + 文档简介

**Files:**

- Modify: `docs/design/asset-ledger-data-model.md`

**Step 1: 增加“文档简介”**

- 同 Task 1 的结构，突出“概念模型 + 约束 + 图”的定位。

**Step 2: 增加审计实体（最小可落地）**

- 新增：`audit_event`（或等价命名）用于承载 merge/ignore/source 变更/字段变更/手工编辑等所有审计事件。
- 给出：字段建议、索引建议、常用查询路径。
- 将“字段历史追溯”的落库口径写清（与 SRS 的“永久保留”对齐）。
- 相关“是否拆分专用 history 表/是否做快照表”的分歧点写成“决策点 D-xx”。

**Step 3: 增加历史口径（面向实现）**

- 明确：资产历史按 Run 展示时的数据来源（source_record vs materialized snapshot）、合并后的历史归并规则。

**Step 4: 更新 Mermaid ER 图（如新增实体）并校验**
Run:

```bash
~/.codex/skills/mermaid/scripts/validate_mermaid.sh docs/design/asset-ledger-data-model.md
```

Expected: `✅` Valid。

---

### Task 3: 补齐采集插件参考（3/3）— 错误契约 + raw 存储/压缩方案 + 文档简介

**Files:**

- Modify: `docs/design/asset-ledger-collector-reference.md`

**Step 1: 增加“文档简介”**

- 说明：此文档是“插件契约 + 选型参考”，不是实现指南。

**Step 2: 补充错误模型与退出码约定（子进程/HTTP 两类）**

- 增加：`errors[]` 结构（category/retryable/redacted_context 等）与 `warnings[]` 语义。
- 说明：部分成功（partial success）是否允许、如何落库、如何影响核心的“missing 计算”。
- 所有多方案点写成“决策点 D-xx”。

**Step 3: 补充 raw 存储/压缩方案与阈值**

- 给出：DB 内联 / 对象存储引用 / 混合 的对比表。
- 给出：压缩建议与阈值（作为待决策）。

**Step 4: 校验 Mermaid（如文档内含图）**
Run:

```bash
~/.codex/skills/mermaid/scripts/validate_mermaid.sh docs/design/asset-ledger-collector-reference.md
```

Expected: `✅` Valid。

---

### Task 4: 汇总待决策点 + README 入口（如需）

**Files:**

- Modify: `docs/requirements/asset-ledger-srs.md`
- Modify: `docs/design/asset-ledger-data-model.md`
- Modify: `docs/design/asset-ledger-collector-reference.md`
- Modify: `README.md` (optional)

**Step 1: 每份文档末尾新增“待决策（Decision Log）”**

- 汇总该文档内出现过的 D-xx。

**Step 2: README（可选）**

- 若新增了新的补充文档/入口，则在 “资产台账系统文档” 下补一行链接；仅补充，不改动其它模板内容。

---

### Task 5: 格式化校验

Run:

```bash
bun run format:check
```

Expected: 通过（或仅报告与本次无关文件）。
