# PRDs Clarity Audit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 审计 `docs/prds/` 下所有 PRD，并通过“提问澄清 + 补齐文档”把每份 PRD 的 `Quality Score` 推升到 **100/100**。

**Architecture:** 先做全量盘点与评分基线（以 requirements-clarity rubric + 本仓库 PRD 模板为准），再按主题分批补齐缺失章节（Design Decisions/Constraints/Risk/详细需求/验收/执行阶段），并用“每轮 2~3 个问题”的方式向金主大人收集无法从现有文档推导的信息；每轮回答后立即回写 PRD、更新分数与追踪矩阵，直到全部 100/100。

**Tech Stack:** Markdown 文档（`docs/prds/*.md`）、现有 SRS/设计文档（`docs/requirements/*`、`docs/design/*`）、必要时用 `python3` 做批量扫描/统计。

---

### Task 1: 盘点与基线审计（输出 Scorecard）

**Files:**

- Create: `docs/prds/QUALITY-AUDIT-2026-01-31.md`
- Modify: `docs/prds/README.md`

**Step 1: 扫描现有 PRD 列表与现有分数**

Run:

```bash
rg -n "Quality Score" docs/prds/*.md
```

**Step 2: 生成 scorecard（按 active/deprecated 分组）**

Run:

```bash
python3 - <<'PY'
import re, glob, os
files=sorted(glob.glob('docs/prds/*.md'))
for f in files:
    if os.path.basename(f).lower()=='readme.md':
        continue
    txt=open(f,'r',encoding='utf-8').read()
    score=re.search(r"\\*\\*Quality Score\\*\\*:\\s*(\\d+)/100",txt)
    score=score.group(1) if score else "-"
    deprecated=("已废弃" in txt) or ("已并入并被替代" in txt)
    print(("deprecated" if deprecated else "active").ljust(10), score.rjust(3), os.path.basename(f))
PY
```

**Step 3: 写入审计报告**

- 把每份 PRD 的“缺口点（按 rubric 四象限）+ 下一步补齐动作”写入 `docs/prds/QUALITY-AUDIT-2026-01-31.md`。
- 在 `docs/prds/README.md` 增加“质量审计报告入口”链接。

---

### Task 2: 定义 100/100 的口径（统一模板 + 最小必备信息）

**Files:**

- Modify: `docs/prds/QUALITY-AUDIT-2026-01-31.md`

**Step 1: 明确评分标准（落地到文档）**

- 以 requirements-clarity rubric（功能/技术/实现/业务四象限）为主。
- 结合本仓库 PRD 模板，补充“必须出现的章节清单”：
  - Requirements Description（Background/Scope/Success Metrics）
  - Feature Overview
  - Detailed Requirements
  - Design Decisions（Technical Approach/Constraints/Risk Assessment）
  - Acceptance Criteria（Functional + Quality + Security/Perf where applicable）
  - Execution Phases（可直接拆分到工程任务）

**Step 2: 统一元信息**

- 每份 PRD 末尾必须包含并维护：
  - `Document Version`
  - `Created`
  - `Clarification Rounds`（从 0 开始）
  - `Quality Score`

---

### Task 3: 先把“低分 PRD（<=70）”补齐到 90+

**Files:**

- Modify: `docs/prds/M12-asset-ledger-asset-history-v1.0-prd.md`
- Modify: `docs/prds/M5-asset-ledger-asset-merge-v1.0-prd.md`
- Modify: `docs/prds/M5-asset-ledger-duplicate-center-v1.0-prd.md`
- Modify: `docs/prds/M8-asset-ledger-export-csv-v1.0-prd.md`
- Modify: `docs/prds/M4-asset-ledger-hyperv-collector-v1.0-prd.md`
- Modify: `docs/prds/M6-asset-ledger-pve-5-8-compat-v1.0-prd.md`
- Modify: `docs/prds/M7-asset-ledger-user-readonly-access-v1.0-prd.md`
- Modify: `docs/prds/M10-asset-ledger-windows-physical-collector-v1.0-prd.md`
- Modify: `docs/prds/M10-asset-ledger-linux-physical-collector-v1.0-prd.md`
- Modify: `docs/prds/M11-asset-ledger-aliyun-collector-v1.0-prd.md`

**Step 1: 补齐缺失章节骨架（不写猜测，写“已知事实 + 待确认”）**

- 增补：Detailed Requirements / Design Decisions / Constraints / Risk Assessment / Execution Phases（若缺失）。
- 把能从 `docs/requirements/asset-ledger-srs.md` 与 `docs/roadmap.md` 推导的信息写进去，并加引用路径。

**Step 2: 把验收标准改成可勾选的“可执行条款”**

- 每个 PRD 至少 8 条 `- [ ]`（功能 5+，质量/安全/性能 3+）。
- 明确：权限（admin/user）、错误码、缺失策略（warning vs fail）、数据保留/审计（如涉及）。

**Step 3: 更新 Clarification Rounds 与 Quality Score（先到 90）**

- 若仍存在“关键决策未确认”，不得打 100；先打到 85~95 并把问题留在“Open Questions”。

---

### Task 4: 主题化澄清（每轮 2~3 个问题）并冲 100/100

**Files:**

- Modify: `docs/prds/*.md`（按轮次命中）

**Step 1: Round 1（全局口径）**

- 统一“错误码/建议动作/可观测性”口径（与 `docs/design/asset-ledger-error-codes.md` 对齐）。
- 统一“关系缺失是否允许成功”的口径（虚拟化平台禁止 relations=0）。

**Step 2: Round 2（采集类 PRD 口径）**

- Hyper-V/PVE/物理机/Aliyun 的接入方式与最小权限集（验收依赖）。
- raw 保留/脱敏/访问审计的统一要求。

**Step 3: Round 3（治理类 PRD 口径）**

- DuplicateCandidate 规则、降噪策略、状态机、合并冲突策略、下线语义的边界条件。

**Step 4: Round 4（历史/导出/权限）**

- 历史追溯：diff 粒度、性能预算、分页与缓存策略。
- 导出 CSV：同步/异步、规模阈值、文件留存与权限控制。
- user 只读：页面/API 白名单、字段/敏感面红线。

**Step 5: 每轮回答后回写 PRD 并把 Quality Score 推到 100**

- 在每份 PRD 末尾增加“Clarification Rounds”累计。
- 关键问题全部闭环后，把 `Quality Score` 更新为 100/100。

---

### Task 5: 最终校验与收口

**Files:**

- Modify: `docs/prds/README.md`
- Modify: `docs/prds/QUALITY-AUDIT-2026-01-31.md`

**Step 1: 校验所有 active PRD 是否已 100/100**

Run:

```bash
python3 - <<'PY'
import re, glob, os
bad=[]
for f in sorted(glob.glob('docs/prds/*.md')):
    if os.path.basename(f).lower()=='readme.md':
        continue
    txt=open(f,'r',encoding='utf-8').read()
    if ('已废弃' in txt) or ('已并入并被替代' in txt):
        continue
    m=re.search(r\"\\*\\*Quality Score\\*\\*:\\s*(\\d+)/100\",txt)
    if not m or int(m.group(1))!=100:
        bad.append(os.path.basename(f))
print('NOT 100:', bad)
PY
```

**Step 2: 更新 PRDs 目录 README**

- 为每个 active PRD 补充当前分数（100/100）与最后更新时间。
