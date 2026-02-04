# Config Center Agents + Hyper-V Source Agent Selector

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在“配置中心”新增“代理(Agents)”模块，集中管理采集代理(endpoint/type/超时/TLS)，并在 Hyper-V 来源选择 `connection_method=agent` 时通过下拉框引用已配置代理（不再在 Source.config 里手填 agent_url）。

**Architecture:** 新增 Prisma `Agent` 模型并在 `Source` 上增加可选 `agentId` 关联；Sources API 在 Hyper-V + agent 模式下优先使用 `agentId`，并保持对旧 `config.agent_url` 的兼容。worker 执行插件前将 `Agent` 配置注入到 pluginInput 的 `source.config` 中（向下兼容插件现有 `agent_url/agent_tls_verify/agent_timeout_ms` 读取逻辑）。Windows Hyper-V Agent 增加无鉴权 `GET /health` 用于连通性检测。

**Tech Stack:** Next.js App Router, Bun, Prisma, Vitest.

---

### Task 1: 完成“新建来源”Hyper-V Agent 下拉框

**Files:**

- Modify: `src/app/sources/new/page.tsx`

**Step 1: 加载可用代理**

- 当 `sourceType===hyperv && hypervConnectionMethod===agent` 时，GET `/api/v1/agents?agentType=hyperv&enabled=true&pageSize=100`。

**Step 2: 表单联动与校验**

- Hyper-V + agent：必须选择代理（`agentId`），且 endpoint 仍必填（endpoint 指目标 Hyper-V 主机/集群）。
- 提交 payload：顶层写入 `agentId`；不再提交 `config.agent_url/*`。

**Step 3: 运行校验**

- Run: `bun run type-check`
- Expected: exit 0

---

### Task 2: 完成“编辑来源”Hyper-V Agent 下拉框

**Files:**

- Modify: `src/app/sources/[id]/edit/page.tsx`

**Step 1: SourceDetail 增加 agentId/agent 字段**

- 读取 `/api/v1/sources/:id` 返回的 `agent`/`agentId`。

**Step 2: 加载代理列表并回填已选项**

- 同 Task 1 的 agents query；回填下拉。

**Step 3: 更新 PUT payload**

- Hyper-V + agent：提交顶层 `agentId`；非 agent 模式：提交 `agentId:null`。

**Step 4: 运行校验**

- Run: `bun run type-check`
- Expected: exit 0

---

### Task 3: worker 注入 Agent 配置（保持插件兼容）

**Files:**

- Modify: `src/bin/worker.ts`

**Step 1: 解析 Hyper-V agent 模式**

- 若 `source.sourceType===hyperv && source.config.connection_method===agent`：
  - 若 `source.agentId` 存在：查询 `Agent`（enabled=true 且 agentType=hyperv）
  - 将 `{ agent_url, agent_tls_verify, agent_timeout_ms }` 写入 `pluginInput.source.config`
  - 若找不到/停用：Fail run（config error）。

**Step 2: 兼容旧配置**

- 若无 `agentId`，但 `config.agent_url` 存在：继续按旧逻辑运行（不注入）。

**Step 3: 运行校验**

- Run: `bun run type-check`
- Expected: exit 0

---

### Task 4: Windows Hyper-V Agent 增加 `/health`

**Files:**

- Modify: `agents/hyperv-windows-agent/src/server.ts`
- Test: `agents/hyperv-windows-agent/src/handler.test.ts` (或新增测试文件)

**Step 1: 增加无鉴权健康检查**

- `GET /health` → 200 JSON `{ ok: true, service: hyperv-windows-agent, ts: <iso> }`

**Step 2: 测试**

- 断言 `/health` 不需要 Authorization 且返回 200。

---

### Task 5: 文档更新（用户可见）

**Files:**

- Modify: `README.md`
- Modify: `docs/runbooks/hyperv-collector-checklist.md`
- Modify: `agents/hyperv-windows-agent/README.md`

**Step 1: README**

- 说明配置中心新增“代理”；Hyper-V 来源 agent 模式下从下拉选择代理；endpoint 仍是目标主机。

**Step 2: runbook**

- 更新为“先配置代理→再配置来源”流程；补充 `/health`。

**Step 3: agent README**

- 增加 `/health` 说明。

---

### Task 6: 最终验证

**Step 1:** `bun run format:check`

**Step 2:** `bun run lint`

**Step 3:** `bun run type-check`

**Step 4:** `bun run test:ci`

Expected: 全部 exit 0
