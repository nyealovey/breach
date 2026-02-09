# 资产页 Server 读路径对齐（2026-02-09）

## 背景

在资产模块完成 Server-first 改造后，`/assets` 与 `/assets/[uuid]` 的 Server Page 仍通过 `buildInternalRequest + app/api/v1/*` 做内部读调用。

这会带来两类问题：

1. Server Component 读路径不够“直连数据层”，与 Next.js 数据模式最佳实践不一致；
2. 页面读模型与 API 路由重复串联，后续维护时容易产生漂移。

## 本次改造目标

- 保持功能与接口行为一致；
- 让 Server Page 首屏读取改为直接查询服务层（Prisma + 纯映射）；
- 不改写客户端交互路径（客户端后续请求仍走 `/api/v1/*`）。

## 变更内容

### 1) 新增资产服务端读服务层

- 新增 `src/lib/assets/server-data.ts`：
  - 资产列表首屏读取（含 URL 查询解析、分页、映射、台账字段组装）；
  - 资产筛选选项读取（ledger fields options）；
  - 来源摘要读取（source summary）；
  - 列偏好读取（`assets.table.columns.v2`）；
  - 资产详情首屏读取（详情、来源记录、关系、历史首屏）。

### 2) `/assets` 改为直连服务层

- `src/app/assets/page.tsx`
  - 移除对以下 Route Handler 的内部调用：
    - `/api/v1/assets`
    - `/api/v1/assets/ledger-fields/options`
    - `/api/v1/sources/summary`
    - `/api/v1/me/preferences`
  - 改为调用 `readAssetsPageServerData()` 注入首屏 `initialData`。

### 3) `/assets/[uuid]` 改为直连服务层

- `src/app/assets/[uuid]/page.tsx`
  - 移除对以下 Route Handler 的内部调用：
    - `/api/v1/assets/[uuid]`
    - `/api/v1/assets/[uuid]/source-records`
    - `/api/v1/assets/[uuid]/relations`
    - `/api/v1/assets/[uuid]/history`
  - 改为调用 `readAssetDetailPageServerData()` 注入首屏数据；
  - merged 资产仍保持服务端重定向行为。

## 兼容性说明

- 外部 API 路由契约保持不变；
- 客户端后续增量请求路径保持不变；
- 页面首屏体验与行为保持一致，仅调整服务器端数据读取路径。

## 验证

- `bun run lint`
- `bun run type-check`
- `bun run build`
- `bun run format:check`
