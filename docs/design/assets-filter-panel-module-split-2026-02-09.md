# Assets 筛选面板模块化拆分（2026-02-09）

## 背景

在完成对话框与表格渲染拆分后，`src/app/assets/page.client.tsx` 中筛选区域仍包含大量 JSX 与状态更新逻辑，主文件可读性和维护成本仍偏高。

## 目标

- 继续压缩 `assets/page.client.tsx` 主文件复杂度。
- 将筛选面板与页面主业务逻辑（请求、选择、弹窗）解耦。
- 保持筛选行为、URL 同步与 API 查询语义不变。

## 方案

### 1) 新增筛选面板组件

新增文件：`src/app/assets/components/assets-filter-panel.tsx`

组件承载：

- 全局搜索输入与“清除筛选”按钮
- 快捷筛选区（IP 缺失、机器名缺失、机器名不一致、最近新增）
- 资产字段筛选区（类型、状态、来源、技术、品牌、型号、电源、操作系统）
- 台账字段筛选区（地区、公司、部门、系统分类/分级、业务对接人员）

### 2) 页面侧改为组合组件

`src/app/assets/page.client.tsx` 不再内联第一张筛选 Card，改为：

- 传入 `filters`、`setFilters`
- 传入 `sourceOptions` 与 `ledgerFieldFilterOptions`
- 传入 `hasActiveFilters` 与 `handleClearFilters`

### 3) 同步类型导出

为组件复用筛选状态类型，将 `AssetListFiltersState` 从页面内局部类型改为导出类型，避免重复定义。

### 4) 细节优化

在表格组件中将 `showToolsNotRunning` 的计算从“每列重复计算”调整为“每行计算一次”，减少渲染时的重复逻辑。

## 兼容性

- 未改动后端 API 与请求参数协议。
- 未变更筛选项语义。
- 页面交互行为保持一致。

## 验证

- `bun run lint`
- `bun run type-check`
- `bun run build`
- `bun run format:check`

均通过。
