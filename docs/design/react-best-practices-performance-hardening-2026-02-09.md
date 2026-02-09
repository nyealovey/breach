# React 最佳实践性能收口（2026-02-09）

## 背景

基于 React/Vercel 最佳实践扫描结果，本次针对资产与来源相关页面做一次性性能收口，目标是：

- 降低高频输入导致的请求风暴；
- 消除重复触发的副作用请求；
- 让可中断的请求在路由/状态切换时及时取消；
- 降低渲染阶段的大对象序列化开销。

## 改造内容

### 1) 资产列表筛选请求防抖

- 文件：`src/app/assets/page.client.tsx`
- 变更：
  - 对文本类筛选（搜索词、品牌、型号、地区、公司等）引入 300ms 防抖，仅用于数据拉取；
  - URL 同步与筛选状态仍保持即时更新；
  - 列表请求改为基于 `fetchQuery`（防抖后的查询）触发。

效果：减少连续输入期间的重复请求，避免请求风暴。

### 2) 列表/详情请求支持取消

- 文件：
  - `src/app/assets/page.client.tsx`
  - `src/app/assets/[uuid]/page.client.tsx`
  - `src/app/source-records/[recordId]/page.client.tsx`
  - `src/app/duplicate-candidates/[candidateId]/page.client.tsx`
  - `src/app/duplicate-candidates/[candidateId]/merge/page.client.tsx`
- 变更：
  - 为可取消的读取请求引入 `AbortController`；
  - 在 effect cleanup 时主动 `abort()`；
  - 忽略 `AbortError`，避免无意义错误分支。
  - 重复候选列表/详情页的读取从页面内 Server Action 调用切到 `fetch /api/v1/*`，统一走可取消请求路径。

效果：切页、切筛选、快速切换详情时，过期请求不会继续占用网络与状态更新。

### 3) Hyper-V 代理列表重复请求修复

- 文件：
  - `src/app/sources/new/page.client.tsx`
  - `src/app/sources/[id]/edit/page.client.tsx`
- 变更：
  - 凭据/代理/来源详情读取从页面内 Server Action 调用切换为 `fetch /api/v1/*`；
  - 读取请求统一支持 `AbortController` 取消；
  - 清理不再使用的来源读取型 Server Action 导出（`src/app/sources/actions.ts`）；
  - 移除 `hypervAgentId` 对加载代理 effect 的依赖；
  - 自动选中单个代理改为函数式更新，避免 state 更新反向触发重复请求。

效果：同一交互路径下代理列表只按真正条件变化重拉。

### 4) 大 JSON 渲染开销优化

- 文件：
  - `src/app/source-records/[recordId]/page.client.tsx`
  - `src/app/assets/[uuid]/page.client.tsx`
- 变更：
  - 预先 memo 化大 JSON 文本（展示与复制共用）；
  - canonical 字段/快照展示避免每次渲染重复 `JSON.stringify`；
  - 稳定序列化增加 `WeakMap` 缓存，减少重复深度排序与序列化。

效果：大对象页面交互时的主线程抖动下降。

### 5) Sources Server Action 分层一致性与鉴权补齐

- 文件：
  - `src/app/sources/actions.ts`
  - `src/app/sources/[id]/edit/page.client.tsx`
- 变更：
  - `sources` 模块的 Server Action 不再通过 `buildInternalRequest + route.ts` 直调 API Route；
  - 统一改为 Action 内直接走 Prisma + 领域校验（与 API Route 规则保持一致）；
  - 补齐 `requireServerAdminSession()`，确保 Server Action 与 API 路由拥有同等级鉴权；
  - 编辑页首屏加载 effect 去掉 `active` 标记，统一由 `AbortController` 控制取消与收尾。

效果：减少层间耦合与额外调用路径，避免 Server Action 认证遗漏风险，并统一请求取消语义。

## 验证

- `bun run lint`
- `bun run type-check`
- `bun run build`
- `bun run format:check`
