# Assets Page Ledger Filters + Column Settings Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 资产页把“公司/部门/系统分类/系统分级”从文本输入改为可选筛选框（下拉），并将“列设置”改为 2 列展示，避免内容过高溢出。

**Architecture:** 新增只读 API `/api/v1/assets/ledger-fields/options` 返回台账字段去重后的候选值（仅非 merged 资产），前端 `/assets` 页面初始化拉取后渲染为 Select；列设置弹窗使用 2 列 grid + 滚动容器，保证在小屏/低分辨率下不溢出。

**Tech Stack:** Next.js(App Router)、React、Tailwind/shadcn-ui、TypeScript、vitest（API route 单测）。

---

### Task 1: 新增台账筛选候选值 API（TDD）

**Files:**

- Create: `src/app/api/v1/assets/ledger-fields/options/route.ts`
- Create: `src/app/api/v1/assets/ledger-fields/options/route.test.ts`

**Step 1: 写 failing test**

- 未登录：透传 `requireUser` 的失败响应
- 已登录：返回 `200`，带 `X-Request-ID`，并返回结构：
  - `companies: string[]`
  - `departments: string[]`
  - `systemCategories: string[]`
  - `systemLevels: string[]`

**Step 2: 运行测试确认失败**

Run: `bun run test src/app/api/v1/assets/ledger-fields/options/route.test.ts`
Expected: FAIL（route 不存在）

**Step 3: 最小实现 route**

- `requireUser` 校验
- Prisma 从 `assetLedgerFields` 分别 `distinct` 拉取 4 个字段候选值（过滤 `asset.status != merged`）
- 清洗：trim + 去空字符串
- 返回 `ok(data, { requestId })`

**Step 4: 运行测试确认通过**

Run: `bun run test src/app/api/v1/assets/ledger-fields/options/route.test.ts`
Expected: PASS

---

### Task 2: 资产页筛选 UI：输入框 → 下拉筛选

**Files:**

- Modify: `src/app/assets/page.tsx`

**Step 1: 拉取候选值并缓存到 state**

- 页面初始化 `useEffect` 拉取 `/api/v1/assets/ledger-fields/options`
- 请求失败时回退为空数组（UI 仍可用：只展示“全部”）

**Step 2: 替换 4 个 Input 为 Select**

- “公司/部门/系统分类/系统分级”分别对应 Select
- 增加 `全部*` 选项（value=`all`），选中时写入 state 为 `''`（表示不筛选）
- 维持现有 URL/查询参数双向同步逻辑不变

**Step 3: 手动冒烟**

Run: `bun run dev`
Expected: `/assets` 上 4 个筛选项为下拉；选择后 URL 参数更新且列表刷新

---

### Task 3: 列设置弹窗改为 2 列 + 可滚动

**Files:**

- Modify: `src/app/assets/page.tsx`

**Step 1: 调整 DialogContent 尺寸与布局**

- `DialogContent` 增大宽度（例如 `max-w-3xl`）
- 列清单容器改为 `grid`：`sm:grid-cols-2`（桌面 2 列，小屏 1 列）
- 清单区域设置 `overflow-y-auto`，避免高度溢出

**Step 2: 手动检查**

Run: `bun run dev`
Expected: “列设置”弹窗 2 列展示，内容过多时在弹窗内滚动，不溢出屏幕

---

### Task 4: 文档同步（README）

**Files:**

- Modify: `README.md`

**Step 1: 补充说明**

- 资产页台账筛选项已改为下拉筛选
- 记录新增只读接口：`GET /api/v1/assets/ledger-fields/options`

**Step 2: 格式校验**

Run: `bun run format:check`
Expected: PASS

---

### Task 5: 全量校验

**Step 1: 单测**

Run: `bun run test`
Expected: PASS

**Step 2: TypeScript 类型检查**

Run: `bun run type-check`
Expected: PASS

**Step 3: Lint + 格式**

Run: `bun run lint`
Expected: PASS

Run: `bun run format:check`
Expected: PASS
