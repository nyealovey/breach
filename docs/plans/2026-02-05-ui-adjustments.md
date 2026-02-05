# UI 调整清单（凭据/来源/资产/运行）实施计划

日期：2026-02-05

## 目标 / 成功标准

目标：按需求清单完成 UI 调整：补齐列表字段、全量显示各类 ID、资产页筛选与操作区重排、概览页改资产统计、运行页筛选调整、资产详情页重做布局与来源明细“仅变化”。

成功标准：

1. 凭据列表页展示「用户名/账号」与「凭据类型」。
2. 来源列表页展示「选择的凭据」。
3. 全站各类 ID（Asset UUID / RecordId / RunId / SourceId / CandidateId 等）不再做任何压缩显示（无 `compactId` / 无省略号截断）。
4. 概览页移除快捷导航，改为资产统计页（多维度统计 + 可跳转到资产清单的筛选链接）。
5. 资产清单操作区重排：导出台账 CSV 按钮移到资产清单；批量设置台账字段/列设置改为图标并调整顺序；行内编辑机器名/查看详情改为纯图标且语义直观。
6. 资产详情页：左右两列等宽；左列降噪（结构化字段仅显示字段 ID，不显示字段名；减少过多标题）；右列包含关系链/调试（canonical JSON）/来源明细（默认仅显示有变化来源并打 tag，可切换“显示全部”）。
7. 资产筛选：按“台账字段/资产字段”分区并支持折叠；增加快捷筛选（仅 IP 缺失、仅机器名缺失、机器名≠虚拟机名、最近新增 7 天）；搜索覆盖指定字段集合。
8. 运行页：移除顶部 sourceId，改为“调度组”筛选；新增“状态（成功/失败）”筛选。
9. 列表页 pageSize 控件统一放到底部左侧（含资产/运行等页面）。
10. 新建/编辑凭据、新建/编辑来源等表单页统一居中与布局一致。

## 架构/实现要点

- 以最小侵入方式在现有 Next.js(App Router) 页面中改布局与交互。
- 新增 `IdText` 统一 ID 展示（等宽字体 + `break-all`，避免任何 UI 层压缩）。
- VM「机器名≠虚拟机名」快捷筛选采用 DB 派生字段（ingest 写入 + backfill + 迁移）保证准确性，避免前端猜测。
- 资产详情来源明细：前端按 `sourceId` 聚合，比较最新/上一条 normalized（stable stringify + key 排序）打 `NEW/CHANGED/SAME` tag；默认只展示 `NEW/CHANGED`，可切换“全部”。

## 任务拆解

---

### Task 1: 全 UI 取消 ID 压缩（修复编译）

**Files:**

- Modify: `src/app/assets/[uuid]/page.tsx`
- Modify: `src/app/duplicate-candidates/[candidateId]/page.tsx`
- Modify: `src/app/duplicate-candidates/[candidateId]/merge/page.tsx`

**Step 1: 替换 `compactId(...)` 为 `IdText`**

- 资产详情页：assetUuid/runId/sourceId/toAssetUuid 等全部用 `<IdText value={...} />`
- 重复候选页：candidateId/assetUuid/sourceId/runId 等全部用 `<IdText value={...} />`

**Step 2: 搜索确保无残留**
Run: `rg -n "compactId\\(" src`
Expected: 只剩 `src/lib/ui/compact-id.ts` 及其测试（或 0 命中）

---

### Task 2: 资产详情页改为左右等宽 2 列 + 减少标题噪音

**Files:**

- Modify: `src/app/assets/[uuid]/page.tsx`

**Step 1: 外层布局改为等宽两列**

- `lg:grid-cols-2`，移除 12 列/col-span 的宽度不均

**Step 2: 左列固定 3 块（自上而下）**

- 盘点摘要
- 台账字段
- 字段（结构化）

**Step 3: 结构化字段表格降噪**

- 移除“字段名”列，仅保留：字段 ID/值/来源数/冲突
- 取消过细分组：默认用单表展示（必要时加 `details` 折叠）

**Step 4: 历史/时间线挪为折叠区（默认收起）**

- 避免在主视图占据大量空间

---

### Task 3: 资产详情页右列：关系链 / 调试（canonical JSON）/ 来源明细（仅变化）

**Files:**

- Modify: `src/app/assets/[uuid]/page.tsx`

**Step 1: 调试区移动到右列**

- 独立 Card：`details` 展开查看 raw canonical JSON（可加 Copy）

**Step 2: 来源明细默认仅显示“有变化”的来源**

- 按 `sourceId` 分组，取每组最新 1 条记录
- 变化判定：最新 normalized 与上一条 normalized 不一致 => changed；无上一条 => new
- 默认显示 changed/new；提供 toggle “显示全部来源记录”
- 为每行加 tag（NEW/CHANGED/SAME）

---

### Task 4: OpenAPI 文档补齐

**Files:**

- Modify: `src/lib/openapi/spec.ts`

**Step 1: `/api/v1/assets` query 参数补齐**

- `region/company/department/system_category/system_level/biz_owner/os`
- `machine_name_missing/machine_name_vmname_mismatch/created_within_days`

**Step 2: `/api/v1/assets/{uuid}/source-records` schema 补齐 `sourceName`**

---

### Task 5: 资产筛选解析/where 构建新增单测

**Files:**

- Modify: `src/lib/assets/asset-list-query.test.ts`

**Step 1: parse 测试**

- `machine_name_missing=true`
- `machine_name_vmname_mismatch=true`
- `created_within_days=7`

**Step 2: where 构建测试（不连 DB）**

- assert `buildAssetListWhere` 生成包含关键条件（assetType=vm 时的 AND/字段）

Run: `bun run test src/lib/assets/asset-list-query.test.ts`
Expected: PASS

---

### Task 6: README 同步（用户可见改动）

**Files:**

- Modify: `README.md`

**Step 1: 记录关键变更**

- ID 全量显示策略
- 首页改为“资产统计”并可跳转到资产清单
- 资产清单新增快捷筛选与搜索字段范围
- VM mismatch/机器名缺失/最近新增等筛选说明
- DB 派生字段迁移与 backfill 脚本使用说明：`bun src/bin/backfill-asset-derived-fields.ts`

---

### Task 7: 验证（必须）

Run:

- `bun run format:check`
- `bun run lint`
- `bun run type-check`
- `bun run test`（如仓库已配置）

Expected: 全部通过；若失败，逐项修复。
