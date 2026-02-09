# Assets 列表表格渲染模块化拆分（2026-02-09）

## 背景

在完成对话框动态拆分后，`src/app/assets/page.client.tsx` 仍承载了完整的表格渲染逻辑（列头、单元格条件渲染、分页与行级操作），主文件体积和首包解析压力依旧偏高。

## 目标

- 继续降低 `assets/page.client.tsx` 主模块体积。
- 将“高复杂度表格渲染”独立为单模块，便于后续迭代和按需分包。
- 保持筛选、分页、勾选、编辑入口、查看详情等行为不变。

## 方案

### 1) 新增表格渲染组件

新增文件：`src/app/assets/components/assets-table-content.tsx`

封装内容：

- 列表加载/空态/表格主体渲染
- 各列单元格显示规则（状态、电源、监控、台账字段等）
- 行级操作（编辑入口预加载 + 查看详情）
- 分页器和每页数量切换

### 2) 页面侧改为动态引入表格组件

`src/app/assets/page.client.tsx` 新增：

- `AssetsTableContent` 的 `next/dynamic` 引入

并将原先内联的大段 JSX 替换为组件调用，页面仅保留：

- 状态管理
- 数据请求
- 业务处理函数（选择、分页、保存等）

### 3) 回调显式化

为避免子组件直接依赖页面内部状态，页面新增并下发以下回调：

- `handleSelectAllCurrentPage`
- `handleToggleSelectAsset`
- `handlePageSizeChange`
- `handlePrevPage`
- `handleNextPage`

使表格组件职责聚焦在“渲染与事件上抛”。

## 兼容性

- 未改动 API 协议。
- 未修改筛选参数语义。
- 页面交互行为保持一致。

## 验证

- `bun run lint`
- `bun run type-check`
- `bun run build`
- `bun run format:check`

均通过。
