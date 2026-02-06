# vCenter 6.5 兼容性验证清单（M1）

> 目的：为 **vCenter Server 6.5** 环境提供可重复的验收步骤与记录模板，覆盖 `detect`、`collect_hosts`、`collect_vms`。
>
> 适用范围：本仓库 vCenter Collector（`plugins/vcenter`）的 Post-MVP 兼容性增强（见 `docs/prds/M1-asset-ledger-vcenter-6.5-compat-v1.0-prd.md`）。

## 0. 前置条件

1. 环境与账号
   - 可访问 vCenter Server 6.5 的 endpoint（例如：`https://vcsa.example.com`）
   - 具备最小权限的账号（至少能枚举并读取 VM/Host/Cluster 的必要信息）
2. Source 配置
   - `sourceType = vcenter`
   - `config.endpoint` 已配置
   - `config.preferred_vcenter_version = 6.5-6.7`（必须）
3. 运行入口
   - Web UI（Sources 页面手动触发）或 API（`POST /api/v1/sources/:id/runs`）
4. 排障入口
   - `/runs`：失败摘要 + 主错误（error.code / reason / retryable）
   - `/runs/:id`：失败原因 + 建议动作（含 redacted_context 脱敏展示）

## 1. detect（必须通过）

### 步骤

1. 触发 `detect` Run（Source → Run mode 选择 `detect`）。
2. 打开 `/runs/:id` 查看详情。

### 期望

- Run 状态：Succeeded
- `detect` 输出 best-effort 包含（字段名可按实现略有差异）：
  - `target_version`（应能体现 `6.5.x` 与 build 信息；若接口不可用则可能为 `unknown`，但应仍能给出 driver/recommended）
  - `driver`（例如：`vcenter-6.5-6.7@v1`）
  - `recommended_preferred_version`（应为 `6.5-6.7`）
- 若版本范围不匹配（例如：配置 `7.0-8.x` 但实际为 6.5）：
  - Run 必须失败
  - 主错误：`VCENTER_API_VERSION_UNSUPPORTED`
  - UI 应展示可执行建议：调整 `preferred_vcenter_version` 为 `6.5-6.7`

## 2. collect_hosts（必须通过）

### 步骤

1. 触发 `collect_hosts` Run。
2. 打开 `/runs/:id` 查看详情。

### 期望

- Run 状态：Succeeded
- `stats.inventory_complete = true`
- 当环境存在 Cluster 时：
  - `relations.length > 0`（至少 `member_of` 关系存在）
  - 若 `relations = 0`，Run 必须失败，主错误为 `INVENTORY_RELATIONS_EMPTY`
- 当环境不存在 Cluster（仅独立 Host）时（边界场景）：
  - Run 允许成功
  - `relations` 可能为 0（仅 Host/无 Cluster）也不应误失败
- Host 关键字段 best-effort：
  - ESXi 版本与 build（来自 SOAP）
  - 硬件字段（CPU/内存）尽力返回
  - 若 SOAP 路径降级（例如 RetrievePropertiesEx 不支持），Run 仍应成功，必要时仅 warning

## 3. collect_vms（必须通过）

### 步骤

1. 触发 `collect_vms` Run。
2. 打开 `/runs/:id` 查看详情。

### 期望

- Run 状态：Succeeded
- `stats.inventory_complete = true`
- VM 必填字段（100% 完整）：
  - `hardware.cpu_count`
  - `hardware.memory_bytes`
  - `runtime.power_state`
  - 若任一缺失：Run 必须失败，主错误为 `INVENTORY_INCOMPLETE`
- 关系要求：
  - VM↔Host 关系尽力输出（例如 `runs_on` / `hosts_vm`）
  - 若存在 VM 但 `relations = 0`：Run 必须失败，主错误为 `INVENTORY_RELATIONS_EMPTY`
- Guest IP best-effort：
  - VMware Tools 缺失/不可用时允许为空，但应尽量以 warning 体现（不影响成功口径）

## 4. 验收记录（请在真实环境执行后填写）

| 日期 | 环境/备注 | vCenter 版本 | build | sourceId | detect runId | collect_hosts runId | collect_vms runId | 结果（Pass/Fail） | 失败原因摘要 |
| ---- | --------- | ------------ | ----- | -------- | ------------ | ------------------- | ----------------- | ----------------- | ------------ |
|      |           |              |       |          |              |                     |                   |                   |              |
