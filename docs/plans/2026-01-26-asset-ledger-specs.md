# 资产台账系统需求文档（SRS + 概念数据模型）Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在仓库内沉淀《需求规格说明书（SRS，含可验收条款）》与《概念数据模型（含 ER/状态机图）》两份文档，并在 README 中建立入口。

**Architecture:** 以 `docs/requirements/` 为落点输出两份 Markdown 文档；关键流程与数据模型使用 Mermaid 表达并通过脚本校验；README 仅新增一个简短中文入口区块，避免影响现有模板说明。

**Tech Stack:** Markdown、Mermaid（`~/.codex/skills/mermaid/scripts/validate_mermaid.sh`）、Prettier（可选：仅格式化新增/修改文件）。

---

### Task 1: 建立文档目录与计划落点

**Files:**

- Create: `docs/requirements/asset-ledger-srs.md`
- Create: `docs/design/asset-ledger-data-model.md`
- Modify: `README.md`

**Step 1: 确认目录存在**

Run:

```bash
mkdir -p docs/plans docs/requirements
```

Expected: 目录存在且无报错。

**Step 2: 创建空文档骨架**

Run:

```bash
touch docs/requirements/asset-ledger-srs.md docs/design/asset-ledger-data-model.md
```

Expected: 两个文件创建成功。

**Step 3: 提交（可选）**

若需要提交：

```bash
git add docs/plans/2026-01-26-asset-ledger-specs.md
git commit -m "docs: add plan for asset ledger specs"
```

---

### Task 2: 编写《需求规格说明书（SRS）》

**Files:**

- Modify: `docs/requirements/asset-ledger-srs.md`

**Step 1: 写入 SRS（以可验收条款为中心）**

内容包含（至少）：

- 背景/目标/范围/不做清单
- 术语表
- 角色与权限（管理员/普通用户）
- 功能需求（按 FR 编号）+ 每条验收标准（Given/When/Then 或等价表述）
- 非功能需求（保留策略=永久、软删除、可观测/安全/性能的底线）
- 约束与假设（例如：阿里云 Cluster 为空）

**Step 2: 自检可读性**

人工检查：

- 每条 FR 是否可独立验收
- 是否避免“实现细节”与“需求”混写

---

### Task 3: 编写《概念数据模型》并补充 Mermaid 图

**Files:**

- Modify: `docs/design/asset-ledger-data-model.md`

**Step 1: 写入实体/关系定义**

内容包含（至少）：

- 核心实体：Source、Run、SourceRecord、Asset、Relation、DuplicateCandidate、MergeAudit、CustomFieldDefinition、CustomFieldValue、User
- 关键字段（概念级）、基数关系、唯一性约束
- 状态机（Run/Asset/DuplicateCandidate/SourceRecord 可见性）

**Step 2: 添加 Mermaid 图**

至少包含：

- ER 图（概念级）
- 状态图（Run 状态 + DuplicateCandidate 状态）

**Step 3: 校验 Mermaid**

Run:

```bash
~/.codex/skills/mermaid/scripts/validate_mermaid.sh docs/design/asset-ledger-data-model.md
```

Expected: 输出 `✅ ... Valid`。

---

### Task 4: README 增加文档入口

**Files:**

- Modify: `README.md`

**Step 1: 增加“台账系统文档”入口区块**

要求：

- 简短中文说明 + 两个链接
- 不重写现有英文模板内容（只追加一个区块）

---

### Task 5: 格式化与最终校验

**Files:**

- Modify: `docs/requirements/asset-ledger-srs.md`
- Modify: `docs/design/asset-ledger-data-model.md`
- Modify: `README.md`

**Step 1: 可选格式化（仅触达新增/修改文件）**

Run:

```bash
bunx prettier docs/requirements/asset-ledger-srs.md docs/design/asset-ledger-data-model.md docs/plans/2026-01-26-asset-ledger-specs.md README.md --write
```

Expected: 无报错，格式化完成。

**Step 2: 校验（可选）**

Run:

```bash
bun run format:check
```

Expected: 通过（或仅报告与本次无关文件）。

**Step 3: 提交（可选）**

若需要提交：

```bash
git add docs/requirements/asset-ledger-srs.md docs/design/asset-ledger-data-model.md README.md
git commit -m "docs: add asset ledger SRS and data model"
```
