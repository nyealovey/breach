# 资产筛选跨页面保留（sessionStorage）设计说明

## 背景

资产列表页的筛选状态此前仅依赖 URL。
当用户从资产页跳转到其他页面后再回到 `/assets`（无 query），筛选会丢失。

## 目标

- 在同一浏览器标签页内，支持“离开资产页再回来”自动恢复筛选。
- 保留 URL 作为可分享、可回放的状态来源。
- 提供显式“清除筛选”按钮，并同步清理缓存。

## 方案

采用 **URL + sessionStorage** 双轨，并约定优先级：

1. URL 有有效筛选参数：按 URL 恢复，并写入 sessionStorage。
2. URL 无有效筛选参数：若 sessionStorage 有缓存，则用缓存恢复并回写 URL。
3. 两者都无：使用默认筛选。

存储键：`assets.list.filters.v1`

## 清除筛选按钮行为

资产页新增“清除筛选”按钮，点击后：

- 重置为默认筛选状态（包含分页默认值）
- 清空 URL 筛选参数
- 清除 `sessionStorage` 缓存（`assets.list.filters.v1`）

## 安全与容错

- 持久化数据通过 `asset-list-url` 的 parse/build 规则做白名单归一化。
- 非法/损坏缓存按 `null` 处理，不影响页面正常加载。
- `sessionStorage` 不可用（安全模式/隐私限制）时静默降级，仅使用 URL。

## 非目标

- 本次不引入 Redux/Zustand 等全局状态库。
- 本次不做跨标签页/跨浏览器重启持久化（如需该能力可升级 localStorage）。
- 本次不扩展到全站其他列表页。
