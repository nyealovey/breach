# Assets 列表页重型对话框按需加载（2026-02-09）

## 背景

`src/app/assets/page.client.tsx` 文件体积较大（约 2k+ 行），并且将 3 个重型对话框都打进了初始客户端包：

- 列设置对话框
- 批量设置台账字段对话框
- 编辑资产字段对话框（含 SolarWinds 候选节点列表）

这会放大 `/assets` 首屏 JS 负载，不符合 Next.js / Vercel React 的“按需加载重型交互模块”建议。

## 目标

- 将重型对话框从主页面组件拆分为独立模块。
- 使用 `next/dynamic` 在需要时加载，降低初始 bundle 压力。
- 保持现有交互行为与数据写回逻辑不变。

## 方案

### 1) 拆分 3 个独立客户端组件

新增目录：`src/app/assets/components/`

- `column-settings-dialog.tsx`
- `bulk-set-ledger-dialog.tsx`
- `edit-asset-dialog.tsx`

页面仅保留状态与业务处理函数，对话框渲染结构迁移到子组件。

### 2) 动态导入并关闭 SSR

在 `src/app/assets/page.client.tsx` 中引入：

- `ColumnSettingsDialog`
- `BulkSetLedgerDialog`
- `EditAssetDialog`

统一通过 `next/dynamic(..., { ssr: false })` 注册，避免这 3 个重型模块进入服务端渲染路径。

### 3) 仅在打开时挂载对话框

由“始终渲染（open=false）”改为：

- `columnSettingsOpen ? <ColumnSettingsDialog ... /> : null`
- `bulkSetOpen ? <BulkSetLedgerDialog ... /> : null`
- `editAssetOpen ? <EditAssetDialog ... /> : null`

确保未使用时不触发模块加载。

### 4) 预加载优化（减少首次打开延迟）

新增 `preload*Dialog` 方法，并在相关入口按钮上添加 `onMouseEnter/onFocus` 触发预加载：

- 列设置按钮
- 批量设置按钮
- 表格行“编辑/覆盖字段”按钮

在降低首屏负载的同时，尽量避免首次打开对话框的体感卡顿。

## 行为兼容性

- 列配置保存、恢复默认、取消逻辑保持一致。
- 批量设置台账字段与列表回写逻辑保持一致。
- 编辑资产字段、SolarWinds 采集/候选选择、覆盖草稿保存逻辑保持一致。

## 验证

- `bun run lint`
- `bun run type-check`
- `bun run build`

均通过。
