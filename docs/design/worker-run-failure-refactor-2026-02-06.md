# Worker Run 失败分支样板收敛（2026-02-06）

## 背景与问题

`src/bin/worker.ts` 的 `processRun()` 内存在大量失败分支，每个分支都重复：

- `prisma.run.update({ status: 'Failed', finishedAt, errorSummary, errors, ... })`
- 返回 `ProcessResult` 的固定字段（`status/errorsCount/warningsCount/pluginExitCode/...`）

重复导致的问题：

- 修改失败落库字段时需要全局搜索多处，容易漏改
- 同一类错误的落库字段可能逐渐不一致（drift）
- 阅读时噪音大，掩盖了真正的业务分支逻辑

## 本次改动

在 `src/bin/worker.ts` 增加两个极小 helper：

- `markRunFailed(...)`：统一失败落库的最小字段集（`status/finishedAt/errorSummary/errors`，并按需带上 `warnings/detectResult/stats`）。
- `failRun(...)`：调用 `markRunFailed` 后返回标准化的 `ProcessResult`（默认 `errorsCount=1`、`warningsCount=0`）。

并将 `processRun()` 内的多处失败分支改为 `return failRun({ ... })`。

同时把 `detectResult/stats` 的 Prisma JSON 形态在通过响应校验后统一计算一次并复用，避免重复转换表达式在多处复制粘贴。

## 预期行为（不变）

- 所有失败分支仍会写入 `Run` 表：`status='Failed'`、`finishedAt`、`errorSummary`、`errors`（以及原本就写入的可选字段）。
- `pluginExitCode`、`errorsCount`、`warningsCount` 的返回值语义不变（对应原逻辑）。

## 验证建议

- 本地跑 `npm run lint`、`npm run format:check`
- 手工跑一次 worker（若环境齐备）：
  - 插件启动失败/超时/非零退出码/响应解析失败等路径应仍能落库并输出 `run.finished` 日志
