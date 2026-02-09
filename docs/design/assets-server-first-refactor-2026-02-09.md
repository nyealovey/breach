# 资产页面 Server-first 一次性重构说明（2026-02-09）

## 背景

- 项目处于“未上线、无历史数据、功能已稳定”阶段。
- 资产列表与资产详情此前主要由客户端在首屏发起多次请求，和仓库内多数页面的 Server-first 模式不一致。
- 本次按“一次性破坏性重构”执行，不保留开关分支。

## 目标

1. 保持功能与交互行为一致（URL、筛选、编辑、批量、历史等）。
2. 将首屏数据加载迁移到服务端，客户端聚焦交互与后续增量请求。
3. 不修改数据库结构，不修改 `/api/v1/**` 接口契约。

## 改造范围

### 1) `/assets`

- `src/app/assets/page.tsx`
  - 从纯壳组件改为 Server Page。
  - 服务端并发加载：
    - `/api/v1/sources/summary`
    - `/api/v1/assets/ledger-fields/options`
    - `/api/v1/me/preferences?key=assets.table.columns.v2`
    - `/api/v1/assets?...`（基于 URL 还原 query，并补齐 `exclude_asset_type=cluster` 与 VM/Host 推导逻辑）
  - 将结果作为 `initialData` 传给客户端页。

- `src/app/assets/page.client.tsx`
  - 新增 `initialData` 入参并用于初始化状态。
  - 删除首屏重复拉取角色/来源/筛选项/列偏好的 effect。
  - 在列表查询 effect 中增加“首屏 query 命中即跳过首次 fetch”的短路逻辑。
  - 保留原有客户端交互与后续请求（筛选变化、批量操作、编辑等）。

### 2) `/assets/[uuid]`

- `src/app/assets/[uuid]/page.tsx`
  - 新增 Server Page 包装层。
  - 服务端并发加载：
    - 资产详情 `/api/v1/assets/[uuid]`
    - 来源记录 `/api/v1/assets/[uuid]/source-records`
    - 关系 `/api/v1/assets/[uuid]/relations`
    - 历史首页 `/api/v1/assets/[uuid]/history?limit=20`
  - 若资产已 merged 且存在目标 UUID，服务端直接重定向到目标资产详情页。
  - 将数据通过 `initialData` 传给客户端页。

- `src/app/assets/[uuid]/page.client.tsx`
  - 原详情页客户端实现迁移到 `page.client.tsx`。
  - 新增 `initialData` 入参并用于初始化 asset/sourceRecords/relations/history/role。
  - 移除首屏 `auth/me` 与详情三接口拉取 effect。
  - 保留历史筛选、链路推导、编辑保存、手动采集等交互逻辑。
  - 历史列表增加“首屏已注入时跳过首次请求”的短路逻辑。

## 兼容性与风险

- API 契约保持不变：外部调用方与测试无需按接口层改造。
- 页面行为保持一致：仍可通过客户端交互触发原有 API。
- 风险点主要在“Server 注入数据结构与客户端状态对齐”；已通过类型与兜底默认值降低风险。

## 验证清单

- `bun run lint`
- `bun run type-check`
- `bun run build`
- 关键手测：
  - 资产列表筛选/分页/列偏好
  - 资产编辑与批量台账字段更新
  - 资产详情历史分页与筛选
  - merged 资产跳转
