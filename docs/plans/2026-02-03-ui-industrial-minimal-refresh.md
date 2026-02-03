# 资产台账 UI 统一美感（工业极简 / 顶部导航 / 仅浅色）实施计划

日期：2026-02-03

## 目标 / 成功标准

目标：把当前 UI 从“功能可用但风格不统一”升级为“工业极简、统一的视觉语言”，并用可复用的组件/规范约束后续页面不再发散。

成功标准：

1. 全站统一：字体、字号层级、背景/卡片层次、边框/阴影、间距密度一致。
2. 交互控件统一：输入框/下拉/按钮/表格在各页面观感一致（允许“Radix Select vs Native Select”两套实现，但视觉必须同一套 token）。
3. 仅浅色：不再出现“系统深色导致原生控件发黑、页面仍是浅色”的割裂（修复 `color-scheme` 不一致问题）。
4. 先样板后铺开：`/assets` 与 `/assets/[uuid]` 作为样板页达到“可截图当设计稿”，其余页面按同一规范迁移。

## 架构思路

- 用 Design Tokens（CSS 变量）统一颜色/圆角/阴影基准：`src/app/globals.css`
- 用少量 UI 约束组件替代散落的 className 拼装：
  - `PageHeader`：统一“标题/说明/操作区”
  - `NativeSelect`：统一所有原生 `<select>` 的外观（并保持 Server Component 表单提交能力）
- 顶部导航继续保留，但做工业极简重绘（层次更克制、选中态更明确）。
- 样板页完成后，按“列表页模板 / 表单页模板 / 详情页模板”批量迁移。

## 交付清单（按任务顺序）

### Task 0：文档与约束

- 更新 `docs/design/asset-ledger-ui-spec.md`：补齐“视觉系统（工业极简）”章节（含 token/排版/组件约束）。
- 更新 `README.md`：补充 UI 规范链接。
- 新增本计划文档（本文件）。

### Task 1：Design Tokens + 仅浅色

- `src/app/globals.css`：
  - 移除 `prefers-color-scheme: dark` 的 `color-scheme: dark`
  - 强制 `html { color-scheme: light; }`
  - 替换 `:root` token 为“工业极简”浅色方案（冷白底 + 工业蓝点缀）
  - `body` base apply 增加 `font-sans`
- `tailwind.config.js`：补齐 `fontFamily.sans`（Geist + 中文 fallback）

### Task 2：RootLayout 容器化 + Toaster 固定浅色

- `src/app/layout.tsx`：
  - `body` 增加 `font-sans`
  - `main` 增加 `bg-muted/30`，并内包 `max-w-[1600px]` 容器
- `src/components/ui/sonner.tsx`：
  - 移除 `next-themes` 依赖
  - Toaster 固定 `theme="light"`

### Task 3：新增 PageHeader

- 新增 `src/components/layout/page-header.tsx`：统一页面标题/描述/右侧操作区结构。

### Task 4：新增 NativeSelect

- 新增 `src/components/ui/native-select.tsx`：统一原生 `<select>` 外观（对齐 Input 高度与 focus ring）。
- 替换所有散落 `<select className="h-9 ...">` 为 `NativeSelect`（先从 `/runs` 与配置表单开始）。

### Task 5：顶部导航重绘（保留结构）

- `src/app/layout.tsx` header：`bg-background/80 backdrop-blur` + 线框
- `src/components/nav/app-top-nav.tsx`：active 状态更克制但更明确（底部细线 + `font-semibold`）

### Task 6：样板页 1（/assets）

- 引入 `PageHeader`
- 拆分为：筛选 Card + 表格 Card
- 表格区增加 meta（共 X 条 / 已选 Y 条）

### Task 7：样板页 2（/assets/[uuid]）

- `PageHeader` 替换原顶栏
- 大屏两栏栅格（左信息密度高 / 右辅助与关系链）

### Task 8：全站铺开

- 列表页/表单页/其它页面逐页迁移到同一套结构与组件约束。

### Task 9：Swagger UI 样式隔离

- 移除 `globals.css` 的 swagger CSS import
- 在 `src/app/api/docs/layout.tsx` 内局部引入 swagger CSS，避免污染全站

### Task 10：回归与验收

- `bun run format:check`
- `bun run lint`
- `bun run type-check`
- 手工验收：登录→资产列表→资产详情→配置/运行→API docs
