# Next/React 最佳实践整改（2026-02-09）

## 背景

针对项目中基于 `next-best-practices` 与 `vercel-react-best-practices` 识别出的实现问题，完成一次集中整改，目标是：

1. 消除可避免的串行 I/O，降低接口与 Server Action 尾延迟。
2. 消除客户端日期渲染的 hydration 不一致风险。
3. 降低大体积客户端组件的重复派生计算开销。

## 变更范围

### 1) sources API 路由并行化校验查询

- 文件：`src/app/api/v1/sources/route.ts`
- 文件：`src/app/api/v1/sources/[id]/route.ts`

将 `scheduleGroup` / `credential` / `agent` 的数据库校验从串行 `await` 改为 `Promise.all` 并行执行，保留原有校验语义与错误码。

### 2) sources Server Actions 并行化校验查询

- 文件：`src/app/sources/actions.ts`

在 `createSourceAction` 与 `updateSourceAction` 中，同步将 `scheduleGroup` / `credential` / `agent` 校验改为并行执行，保持返回错误文本与行为一致。

### 3) source-record 页面并行化请求参数读取

- 文件：`src/app/source-records/[recordId]/page.tsx`

将 `requireServerSession()`、`params`、`searchParams` 合并为 `Promise.all` 并发等待，减少页面首段串行等待。

### 4) 客户端日期格式渲染稳定化（避免 hydration 偏差）

- 文件：`src/app/assets/components/assets-table-content.tsx`
- 文件：`src/app/assets/[uuid]/page.client.tsx`

统一改为 `Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', ... })` 的固定时区格式化，避免服务端与客户端处于不同时区时的初始文本不一致。

### 5) 资产页客户端派生计算优化与冗余清理

- 文件：`src/app/assets/page.client.tsx`

将列分组相关 `filter` 派生结果上提为模块级常量，避免每次渲染重复计算；同时在资产页统一为固定时区的日期格式化实现。

### 6) 资产详情数据读取去除串行 waterfall

- 文件：`src/lib/assets/server-data.ts`

在 `readAssetDetail` 中，将 `assetRunSnapshot` 与 `veeam signal` 两个互不依赖的查询从串行 `await` 改为 `Promise.all` 并行执行，降低资产详情页服务端读取尾延迟。

### 7) 资产列表页补齐 Suspense 边界

- 文件：`src/app/assets/page.tsx`
- 文件：`src/app/assets/page.client.tsx`

`page.client.tsx` 使用了 `useSearchParams`，因此在 `page.tsx` 对客户端页面组件增加 `Suspense` 边界与加载回退，避免静态路由场景的 CSR bailout 风险。

## 影响说明

- 业务接口契约、错误码、校验规则未变。
- 资产相关页面的时间文本现在固定以 `Asia/Shanghai` 时区展示，首屏 hydration 一致性提升。
- 资产详情页读取路径减少不必要串行等待，首屏数据更快返回。
- 资产列表页在 Next.js 推荐的渲染边界上更稳健，仅涉及性能与稳定性优化，不引入新功能。
