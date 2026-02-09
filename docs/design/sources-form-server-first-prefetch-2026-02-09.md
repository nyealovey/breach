# Sources 新建/编辑页服务端预取优化（2026-02-09）

## 背景

`sources/new` 与 `sources/[id]/edit` 页面在首屏阶段存在多次客户端拉取：

- 新建页默认会在客户端请求一次凭据列表。
- 编辑页会先请求 source 详情，再按 sourceType 请求凭据，Hyper-V agent 模式下再请求 agent 列表。

这会导致首屏请求瀑布与表单初始化抖动。

## 目标

- 将“首屏必需数据”前移到服务端准备。
- 保留现有客户端联动逻辑（切换 sourceType / connection method 后仍实时请求）。
- 减少首屏 API 请求数量与等待时间。

## 方案

### 1) 新建页：预取默认 vCenter 凭据

- `src/app/sources/new/page.tsx`
  - 服务端调用 `listCredentials({ type: vcenter, pageSize: 100 })`。
  - 以 `initialData.credentials` 注水给客户端。
- `src/app/sources/new/page.client.tsx`
  - `credentials` 初值改为服务端注水。
  - 增加 `skipInitialCredentialsFetchRef`，首次渲染且 `sourceType=vcenter` 时跳过重复请求。

### 2) 编辑页：预取 source + 当前凭据 + (可选) hyperv agents

- `src/app/sources/[id]/edit/page.tsx`
  - 服务端读取 `getSource(id)`；不存在时 `notFound()`。
  - 并行预取：
    - 当前 `sourceType` 的 `credentials`
    - 若 `sourceType=hyperv` 且 `connection_method=agent`，预取 `hyperv` agents
  - 注水到 `initialData`。

- `src/app/sources/[id]/edit/page.client.tsx`
  - 删除“首屏 fetch source 详情”流程，改为直接使用 `initialData.source` 初始化表单状态。
  - `credentials/hypervAgents` 初值来自服务端注水。
  - 增加两个 skip ref，避免首屏重复请求：
    - `skipInitialCredentialsFetchRef`
    - `skipInitialHypervAgentsFetchRef`

### 3) 新增共享页面类型

- `src/lib/sources/page-data.ts`
  - 统一声明 sources 表单页的初始数据结构（new/edit）与 option 类型。

## 兼容性

- 不修改 API 协议。
- 不改变表单字段语义与保存逻辑。
- 客户端交互行为保持一致（仅优化首屏数据来源与请求时机）。

## 验证

- `bun run lint`
- `bun run type-check`
- `bun run build`

均通过。
