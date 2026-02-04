# Hyper-V Windows Agent + gMSA Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 Hyper-V 采集从“Linux 直连 WinRM”切换为“Windows 侧 Agent 执行 PowerShell 采集，Linux 插件仅调用 Agent + normalize”，以满足“域内、仅 HTTP、Basic 禁用、仍要求链路信息加密”的约束。

**Architecture:** Linux worker 仍保持 `plugins/hyperv` 的 collector 契约（stdin in / stdout out），但新增 `connection_method=agent` 分支，通过 HTTP 调用 Windows Agent。Windows Agent 以 gMSA 运行，使用 PowerShell 模块（Hyper-V/FailoverClusters）枚举并返回 raw JSON，由插件统一 normalize 为 assets/relations/stats/errors。

**Tech Stack:** Next.js (App Router), Bun + TypeScript, Vitest, Windows PowerShell.

---

### Task 1: 扩展 Hyper-V Source config（connection_method=agent）

**Files:**

- Modify: `src/app/api/v1/sources/route.ts`
- Modify: `src/app/api/v1/sources/[id]/route.ts`

**Step 1: 更新 Source schema**

- 新增 `connection_method: 'winrm'|'agent'`（默认 winrm）
- 当 `agent`：新增 `agent_url/agent_tls_verify/agent_timeout_ms`

**Step 2: 加入条件校验**

- hyperv + agent：必须 `agent_url`
- hyperv + winrm：必须 `endpoint`

**Step 3: 运行校验**

- Run: `bun run type-check`
- Expected: exit 0

---

### Task 2: 升级 Hyper-V Credential 为 union（token 不放 config）

**Files:**

- Modify: `src/lib/credentials/schema.ts`
- Test: `src/lib/credentials/schema.test.ts`

**Step 1: 更新 schema**

- WinRM：`{ auth: 'winrm', domain?, username, password }`
- Agent：`{ auth: 'agent', token }`
- 兼容旧形态：`{ domain?, username, password }` → transform 为 winrm

**Step 2: 写/改测试**

- 覆盖：旧 payload 兼容、agent token 必填、错误信息不泄露

**Step 3: 运行测试**

- Run: `bun run test:ci`
- Expected: exit 0

---

### Task 3: UI 表单联动（Source / Credential）

**Files:**

- Modify: `src/app/sources/new/page.tsx`
- Modify: `src/app/sources/[id]/edit/page.tsx`
- Modify: `src/app/credentials/new/page.tsx`
- Modify: `src/app/credentials/[id]/edit/page.tsx`

**Step 1: Source 表单**

- 增加 connection_method 下拉（winrm/agent）
- 选择 agent：显示并校验 `agent_url/agent_tls_verify/agent_timeout_ms`，隐藏 WinRM 相关字段

**Step 2: Credential 表单**

- Hyper-V credential 增加 “WinRM / Agent token” 切换
- Agent 仅填 token

**Step 3: 运行校验**

- Run: `bun run type-check`
- Expected: exit 0

---

### Task 4: Hyper-V 插件新增 Agent 分支（HTTP 调用 + normalize）

**Files:**

- Create: `plugins/hyperv/agent-client.ts`
- Test: `plugins/hyperv/agent-client.test.ts`
- Create: `plugins/hyperv/inventory.ts`
- Test: `plugins/hyperv/inventory.test.ts`
- Modify: `plugins/hyperv/index.ts`
- Modify: `plugins/hyperv/types.ts`

**Step 1: agent-client**

- Bearer token 鉴权
- timeout / TLS verify
- 将 agent error 映射为 CollectorError（`HYPERV_AGENT_*`）

**Step 2: inventory 构建**

- 成功必须满足：`stats.inventory_complete=true` 且 `relations.length>0`
- 否则返回 `INVENTORY_RELATIONS_EMPTY`

**Step 3: index 分流**

- `connection_method=agent`：调用 `/v1/hyperv/{healthcheck|detect|collect}`
- `connection_method=winrm`：保留 legacy

**Step 4: 运行测试与类型检查**

- Run: `bun run type-check`
- Run: `bun run test:ci`
- Expected: exit 0

---

### Task 5: Windows Hyper-V Agent（Bun HTTP + PowerShell）

**Files:**

- Create: `agents/hyperv-windows-agent/src/server.ts`
- Create: `agents/hyperv-windows-agent/src/auth.ts`
- Create: `agents/hyperv-windows-agent/src/handler.ts`
- Create: `agents/hyperv-windows-agent/src/powershell.ts`
- Create: `agents/hyperv-windows-agent/src/scripts/healthcheck.ps1`
- Create: `agents/hyperv-windows-agent/src/scripts/detect.ps1`
- Create: `agents/hyperv-windows-agent/src/scripts/collect.ps1`
- Test: `agents/hyperv-windows-agent/src/handler.test.ts`
- Create: `agents/hyperv-windows-agent/README.md`

**Step 1: API 形态**

- `POST /v1/hyperv/healthcheck|detect|collect`
- 成功：`{ ok: true, data: ... }`
- 失败：`{ ok: false, error: { code, message, context } }`

**Step 2: token 鉴权**

- `Authorization: Bearer <token>`

**Step 3: PowerShell 执行**

- `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command <script>`
- stdout 解析 JSON；stderr/exit_code 映射为 `AGENT_PS_ERROR`

**Step 4: 运行测试**

- Run: `bun run test:ci`
- Expected: exit 0

---

### Task 6: 文档更新（用户可见）

**Files:**

- Modify: `README.md`
- Modify: `docs/runbooks/hyperv-collector-checklist.md`
- Create/Modify: `agents/hyperv-windows-agent/README.md`

**Step 1: README**

- 说明 hyperv 新增 `connection_method=agent` 与 `credential.auth=agent token`
- 链接到 runbook

**Step 2: runbook**

- 增加 Agent + gMSA 部署/权限/网络/排障清单

---

### Task 7: 最终验证（必须提供证据）

**Step 1: 格式化**

- Run: `bun run format:check`
- Expected: exit 0

**Step 2: lint**

- Run: `bun run lint`
- Expected: exit 0

**Step 3: type-check**

- Run: `bun run type-check`
- Expected: exit 0

**Step 4: test**

- Run: `bun run test:ci`
- Expected: exit 0
