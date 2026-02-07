# 资产列表筛选状态收敛重构（2026-02-06）

## 目标

- 降低 `src/app/assets/page.tsx` 的状态数量与同步样板代码，减少“新增/删除筛选字段”时的漏改点。
- 保持现有交互与查询语义不变（URL 同步、API 查询、筛选互斥重置规则等）。

## 变更摘要

- 将资产列表页的筛选相关 `useState` 收敛为单个 `filters` 对象状态：
  - 之前：`qInput/statusInput/sourceIdInput/.../page/pageSize` 多个 state 分散维护。
  - 现在：`filters.{...}` 统一维护，事件处理一次性更新多个字段（减少连锁 `setXxx()` 调用）。

- `query` 继续作为“用于 URL/API 的规范化查询对象”：
  - `query` 由 `filters` 派生，负责 trim、`all -> undefined`、以及“VM/Host 互斥筛选隐含资产类型”等规则。
  - URL 同步与 API 请求参数统一使用 `buildAssetListUrlSearchParams(query)`，减少字段展开与二次拷贝。

## 保留的关键行为（必须不变）

- 资产类型切换：
  - 选择非 `vm` 时，清空 VM-only 筛选（电源/IP 缺失/机器名缺失/机器名≠虚拟机名）。
  - 选择非 `host` 时，清空 Host-only 筛选（品牌/型号）。

- VM-only/Host-only 筛选的互斥重置：
  - 开启 VM-only 筛选时：强制切到 `vm`，并清空品牌/型号。
  - 选择品牌/型号时：强制切到 `host`，并清空 VM-only 筛选。

- URL 同步策略：
  - 仍保留“URL -> 本地状态”后跳过一次“本地状态 -> URL”的防振荡逻辑（避免 back/forward 导航时立即改写 URL）。

## 验证建议（手工）

- 在资产列表页：
  - 输入搜索词、切换各筛选项，确认 URL 参数与结果一致。
  - 验证互斥重置：选品牌后再选电源状态（以及反向），确认对方筛选被清空且类型自动切换。
  - 切换每页条数、翻页，确认页码重置与 URL 同步正常。
