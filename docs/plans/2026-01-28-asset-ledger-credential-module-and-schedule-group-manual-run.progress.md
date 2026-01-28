# 资产台账 - 凭据模块与调度组手动运行 v1.0 执行进度

- 计划来源：`docs/plans/2026-01-28-asset-ledger-credential-module-and-schedule-group-manual-run.md`
- 需求来源：`docs/prds/asset-ledger-credential-module-and-schedule-group-manual-run-v1.0-prd.md`
- 开始日期：2026-01-28
- 最后更新：2026-01-28

## 状态约定

- `TODO`：未开始
- `DOING`：进行中
- `DONE`：已完成
- `BLOCKED`：阻塞（需要外部输入/方案调整）

## 关键对齐点（执行中保持一致）

- 不做历史数据迁移：不迁移旧 `Source.credentialCiphertext`；新实现也不读取旧字段。
- 不回显明文：任何 API 响应/日志/UI 禁止出现明文 secret（password/token/AK/SK）。
- 删除口径：Credential 的 `usageCount` 仅统计 `Source.deletedAt IS NULL` 的引用；建议 Source 软删除时清空 `credentialId` 以匹配口径。
- 调度组手动运行必须并发安全：同一事务内检查活动 Run + 创建 Run，并使用 `FOR UPDATE SKIP LOCKED`。

## 总体进度

- 任务完成：0 / 9
- 当前批次：未开始

## 任务进度（按建议执行顺序）

### Batch 1：规范与数据模型（Task 1-2）

1. Task 1：扩展错误码（Credential Not Found）
   - 状态：TODO

2. Task 2：数据模型（Credential 实体 + Source 绑定）
   - 状态：TODO

### Batch 2：Credential 核心（Task 3-4）

3. Task 3：定义 Credential Zod Schema（按 SourceType 字段变化）
   - 状态：TODO

4. Task 4：Credentials API（CRUD + usageCount + 删除限制）
   - 状态：TODO

### Batch 3：Source/Worker/Scheduler 集成（Task 5-6）

5. Task 5：Source API 改造（绑定 credentialId + 返回摘要 + 移除旧凭据入口）
   - 状态：TODO

6. Task 6：Worker/Scheduler 使用新 Credential（不再读取旧字段）
   - 状态：TODO

### Batch 4：调度组手动运行（Task 7）

7. Task 7：调度组手动运行 API（批量 collect/manual）
   - 状态：TODO

### Batch 5：Web UI（Task 8）

8. Task 8：Web UI（Credentials 页面 + Source 表单绑定 + 调度组运行按钮）
   - 状态：TODO

### Batch 6：交付收尾（Task 9）

9. Task 9：OpenAPI/Docs/E2E 更新（交付收尾）
   - 状态：TODO

