# 资产详情页拆分「盘点信息 / 调试信息」标签（2026-02-09）

## 背景

资产详情页此前将盘点信息与调试信息混合在同一视图中，日常使用场景下会被调试信息（canonical JSON、来源明细、outgoing 关系表）干扰，影响阅读效率。

本次改造目标是：默认展示盘点信息，调试内容按需进入，降低“默认噪音”。

## 交互与信息架构

- 页面新增两个标签按钮：
  - `盘点信息`（默认）
  - `调试信息`
- 标签状态写入 URL 查询参数 `tab`：
  - `tab=overview` => 盘点信息
  - `tab=debug` => 调试信息
  - 非法值或缺失 => 回退 `overview`
- 标签切换时通过 `history.replaceState` 同步 URL，避免额外路由跳转。

### 盘点信息标签内容

- 盘点摘要
- 最近 7 次备份
- 台账字段
- 字段（结构化）
- 历史 / 时间线（可选）
- 关系链（VM → Host → Cluster）

### 调试信息标签内容

- 调试（Latest Snapshot + 原始 canonical JSON）
- 调试：outgoing 关系表
- 来源明细（NEW/CHANGED/SAME）

## 数据加载策略

- 来源明细从“首屏预加载”改为“进入调试标签后按需加载”：
  - 首次进入 `tab=debug` 时请求 `/api/v1/assets/:uuid/source-records`
  - 成功后缓存在当前页面状态，避免重复请求
  - 失败展示错误信息与“重试”按钮
- 关系数据（`relations`）仍保留首屏加载，因为盘点标签中的关系链依赖该数据。

## 服务端读取调整

- `readAssetDetailPageServerData` 不再在首屏读取 `sourceRecords`，仅保留：
  - `asset`
  - `relations`
  - `history`

## 验收标准

1. 打开 `/assets/:uuid` 默认在盘点信息，不显示来源明细。
2. 打开 `/assets/:uuid?tab=debug` 默认进入调试信息。
3. 切换标签时 URL 中 `tab` 值同步变化，刷新后保持当前标签。
4. 来源明细只在调试标签中加载并展示；加载失败可重试。
5. 关系链保留在盘点标签；outgoing 关系表移入调试标签。

## 二次降噪调整（2026-02-09）

- 历史区块位置调整：
  - 将“历史 / 时间线（可选）”从盘点左列移至“关系链”卡片下方，阅读顺序改为“关系 → 历史”。
- 备份展示收敛：
  - 移除“最近 7 次备份”卡片与其明细渲染代码。
  - 盘点摘要中仅保留“最新备份时间 + 最新处理量（`processed_size`）”。
- 数据返回调整：
  - 资产详情数据从 `backupLast7` 收敛为：
    - `latestBackupAt`
    - `latestBackupProcessedSize`
