# vCenter SOAP Debug Logging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 vCenter SOAP（vim25）采集链路补齐可控的 debug 日志开关（.env），并增加用于排障/探索 ESXi 可采集字段的 debug 观测点（不污染插件 stdout）。

**Architecture:** 引入单一环境变量 `ASSET_LEDGER_DEBUG`（boolean）作为 debug 总开关；worker 侧仅在开关开启时回显插件 `stderr`；vCenter SOAP 侧仅在开关开启时写入 `logs/vcenter-soap-debug-YYYY-MM-DD.log`（JSONL），并补充关键阶段与关键字段的调试上下文（含 excerpt 截断）。

**Tech Stack:** TypeScript, Bun（插件执行）, Next.js（Web）, Zod + @t3-oss/env-nextjs（环境变量校验）, Vitest（单测）

---

### Task 1: 增加 debug 开关环境变量并写文档

**Files:**

- Modify: `src/lib/env/server.ts`
- Modify: `.env`
- Modify: `README.md`

**Step 1: 更新 env schema**

- 在 `src/lib/env/server.ts` 新增 `ASSET_LEDGER_DEBUG`（默认 `false`，支持 `true/false/1/0`，大小写不敏感）

**Step 2: 增加 .env 示例**

- 在 `.env` 增加 `ASSET_LEDGER_DEBUG="false"`（本地默认关闭）

**Step 3: 更新 README 环境变量说明**

- 在“环境变量（服务端）”列表中补充 `ASSET_LEDGER_DEBUG` 的用途与影响范围（worker 回显插件 stderr + vCenter SOAP debug 文件）

**Step 4: 运行格式化检查**

Run: `bun run format:check`
Expected: PASS

---

### Task 2: 给现有 debug 输出加开关（避免噪音）

**Files:**

- Modify: `src/bin/worker.ts`
- Modify: `plugins/vcenter/soap.ts`

**Step 1: worker 侧仅在 debug 开启时回显插件 stderr**

- 将 `src/bin/worker.ts` 的 `[Worker DEBUG] Plugin stderr ...` 输出用 `serverEnv.ASSET_LEDGER_DEBUG` 包裹

**Step 2: SOAP debugLog 仅在 debug 开启时写文件**

- 将 `plugins/vcenter/soap.ts` 的 `debugLog(...)` 改成“debug 未开启则直接 return”

**Step 3: 运行 lint + type-check**

Run: `bun run lint`
Expected: PASS

Run: `bun run type-check`
Expected: PASS

---

### Task 3: 增加 vCenter SOAP 采集链路 debug 观测点

**Files:**

- Modify: `plugins/vcenter/soap.ts`

**Step 1: 关键阶段日志**

- `collectHostSoapDetails`：
  - start：sdkEndpoint、hostIds 数量、timeoutMs、请求的 pathSet（不记录 username/password）
  - RetrieveServiceContent：status + body_excerpt（仅当失败或 debug）
  - Login：status + 是否拿到 cookie（不记录 cookie 值）
  - RetrievePropertiesEx / RetrieveProperties：status、是否触发兼容性降级、faultstring_excerpt（若存在）
  - end：返回 host 数量 + 每个 host 的关键结果摘要（版本/build、磁盘总量是否解析成功、管理 IP 是否解析成功）

**Step 2: 关键字段原始值（探索可采集信息）**

- 在 `parseHostSoapDetailsFromObjectContents`：
  - 除 `scsiLun` / `nvmeTopology` 外，增加对 `config.network.vnic` / `config.network.consoleVnic` 的 raw dump（debug 开启时）
  - 对每个 `val` 增加 `shape`（key 列表/深度受限）辅助阅读，避免必须打开完整嵌套

**Step 3: 运行单测**

Run: `bun run test`
Expected: PASS

---

### Task 4: 添加 env 解析单测（防止 boolean 误解析）

**Files:**

- Create: `src/lib/env/server.test.ts`

**Step 1: 覆盖 true/false/1/0/缺省 的解析行为**

- 使用 `vi.resetModules()` + 动态 import `@/lib/env/server`，在 import 前设置 `process.env`（至少包含 `DATABASE_URL`）

**Step 2: 运行单测**

Run: `bun run test`
Expected: PASS

---

### Task 5: 最终验证

Run:

- `bun run format:check`
- `bun run lint`
- `bun run type-check`
- `bun run test`

Expected: 全部 PASS
