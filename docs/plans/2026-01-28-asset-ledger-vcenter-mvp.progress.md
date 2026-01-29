# 资产台账 vCenter MVP v1.0（含增量：凭据模块 + 调度组手动运行）执行进度

- 计划来源：`docs/plans/2026-01-28-asset-ledger-vcenter-mvp.md`
- 需求验收口径：`docs/requirements/asset-ledger-v1.0-traceability.md`（AC-01 ~ AC-09）
- 增量需求：`docs/prds/asset-ledger-vcenter-mvp-credentials-sg-manual-run-v1.0-prd.md`
- 开始日期：2026-01-28
- 最后更新：2026-01-29

## 状态约定

- `TODO`：未开始
- `DOING`：进行中
- `DONE`：已完成
- `BLOCKED`：阻塞（需要外部输入/方案调整）

## 关键对齐点（执行中保持一致）

- 错误码枚举以 `docs/design/asset-ledger-error-codes.md` 第 4 节为单一来源（计划文件内 Task 1 示例代码若与该规范不一致，以规范为准）。

## 总体进度

- 任务完成：20 / 26
- 当前批次：Batch 7（增量进行中：凭据模块 + 调度组手动运行）

## 任务进度（按建议执行顺序）

### Batch 1：基础设施（Task 1-3）

1. Task 1：建立错误码/错误响应最小闭环（Web + Worker 共用）
   - 状态：DONE
   - 产出：`src/lib/errors/*`、`src/lib/http/*` + 最小单测占位

2. Task 2：建立测试基座（Vitest）并接入最小单测
   - 状态：DONE
   - 产出：`vitest.config.ts`、`src/test/setup.ts`、timezone 单测、`bun test`

3. Task 3：UI 基座（Tailwind + shadcn/ui）与通用组件选型落地
   - 状态：DONE
   - 产出：Tailwind 配置、`components.json`、`src/components/ui/*`、`src/lib/ui/cn.ts`、基础布局

### Batch 2：数据模型 + 认证/加密（Task 4-6）

4. Task 4：Prisma 数据模型补齐 v1.0（含分区迁移脚手架）
   - 状态：DONE

5. Task 5：认证与会话（admin 初始化、登录、登出、改密）
   - 状态：DONE

6. Task 6：凭据加密（AES-256-GCM）工具
   - 状态：DONE

### Batch 3：配置管理（Task 7-9）

7. Task 7：调度组 API + UI（含 scheduler 事件）
   - 状态：DONE

8. Task 8：Source API + UI（软删除、最近 Run 摘要、凭据更新）
   - 状态：DONE

9. Task 9：Run API + UI（手动触发、列表/详情、单飞抑制审计；不做 cancel）
   - 状态：DONE

### Batch 4：采集核心（Task 10-12）

10. Task 10：vCenter Collector Plugin（TypeScript）
    - 状态：DONE

11. Task 11：Collector 契约对齐 + Schema 校验（Ajv）
    - 状态：DONE

12. Task 12：Ingest Pipeline（raw 入账、绑定、关系 upsert、canonical-v1）
    - 状态：DONE

### Batch 5：资产展示（Task 13-14）

13. Task 13：Asset API + UI
    - 状态：DONE
    - 产出：`/api/v1/assets*`（列表/详情/来源明细/关系）+ `/assets`（列表/详情）+ 对应 API 单测

14. Task 14：Raw 查看入口 + 审计（admin-only）
    - 状态：DONE
    - 产出：`/api/v1/source-records/:recordId/raw`（admin-only + 解压 + 脱敏 + 审计）+ RawDialog 入口 + 脱敏/接口单测

### Batch 6：日志规范 + 交付物（Task 16/15/17）

15. Task 16：日志规范落地（http.request / schedule_group.triggered / run.finished）
    - 状态：DONE
    - 产出：结构化宽事件 logger（`src/lib/logging/logger.ts`）+ middleware/http.request + scheduler/worker 域事件 + 单测

16. Task 15：OpenAPI/Swagger（openapi.json + /api/docs）
    - 状态：DONE
    - 产出：`/api/openapi.json` + `/api/docs`（Swagger UI）+ spec 单测

17. Task 17：E2E 闭环验收（Playwright）与最小集成测试
    - 状态：DONE
    - 产出：Playwright 配置 + `e2e/admin.spec.ts`（可跳过运行；避免与 Vitest 冲突已做隔离）

### Batch 7：增量（Task 18-26，凭据模块 + 调度组手动运行）

18. Task 18：扩展错误码（Credential Not Found）
    - 状态：DONE

19. Task 19：数据模型（Credential 实体 + Source 绑定）
    - 状态：DONE

20. Task 20：定义 Credential Zod Schema（按 SourceType 字段变化）
    - 状态：DONE

21. Task 21：Credentials API（CRUD + usageCount + 删除限制）
    - 状态：TODO

22. Task 22：Source API 改造（绑定 credentialId + 返回摘要 + 移除旧凭据入口）
    - 状态：TODO

23. Task 23：Worker/Scheduler 使用新 Credential（不再读取旧字段）
    - 状态：TODO

24. Task 24：调度组手动运行 API（批量 collect/manual）
    - 状态：TODO

25. Task 25：Web UI（Credentials 页面 + Source 表单绑定 + 调度组运行按钮）
    - 状态：TODO

26. Task 26：OpenAPI/Docs/E2E 更新（交付收尾）
    - 状态：TODO
