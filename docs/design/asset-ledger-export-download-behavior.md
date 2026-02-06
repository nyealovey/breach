# 资产导出下载行为（一次性下载 + 预取保护）

版本：v1.0  
日期：2026-02-06

## 背景

导出下载接口 `/api/v1/exports/asset-ledger/:exportId/download` 采用“一次性下载”语义：

- 当 `status=Succeeded` 且存在 `fileBytes` 时，首次下载成功；
- 成功后立即将导出任务置为 `Expired`，并清空 `fileBytes`；
- 再次下载同一 `exportId` 会返回 `CONFIG_EXPORT_EXPIRED`（HTTP 410）。

在前端若使用 `next/link` 指向该接口，可能被路由预取（prefetch）提前触发 GET，从而意外消耗一次性下载。

## 设计决策

1. 下载入口使用原生 `<a href>`，不使用 `next/link`。
2. 下载接口增加预取请求保护：
   - 检测 `purpose: prefetch` / `sec-purpose: prefetch` / `next-router-prefetch` / `x-middleware-prefetch`；
   - 预取请求返回 `204`，且不读取/更新导出记录。

## 结果

- 保留一次性下载的安全语义；
- 避免前端预取导致“未点击即过期”的体验问题；
- 真实点击下载路径行为保持不变。
