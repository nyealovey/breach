# Hyper-V WinRM Kerberos SPN Strategy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 Hyper-V WinRM Kerberos 连接在默认情况下“只用 WSMAN SPN + 不做 hostname guess”，避免出现 `HTTP/<host>@REALM` 等误导性报错；同时保留可选的兼容 fallback（WSMAN/HTTP/HOST + short hostname）用于少数环境排障。

**Architecture:** 在 TypeScript 侧统一计算 Kerberos SPN 选择策略（service candidates + hostname overrides），并将该策略透传给 `pywinrm` 包装脚本与 `curl --negotiate` 路径；Python 侧不再自行“猜测/扩展”候选项，只按输入执行。默认策略为 strict（单次尝试），可通过 Source config 显式开启 fallback。

**Tech Stack:** Bun/TypeScript（plugins/hyperv）、pywinrm（Python wrapper）、curl + SPNEGO、vitest（纯函数单测）、现有 Hyper-V runbook/README 文档。

---

### Task 1: Kerberos SPN 策略 helper（TDD）

**Files:**

- Create: `plugins/hyperv/kerberos-spn.ts`
- Test: `plugins/hyperv/kerberos-spn.test.ts`

**Step 1: 写 failing tests**

- 默认 strict：`service_candidates=["WSMAN"]`、`hostname_overrides=[null]`
- fallback 开启：`service_candidates` 依次尝试（优先用户选择，其次补齐 `WSMAN/HTTP/HOST` 去重），`hostname_overrides` 追加 short hostname（仅当输入 host 为 FQDN）
- 输入非法 service name 时：回退到 `WSMAN`

**Step 2: 运行测试确认失败**
Run: `bun run test plugins/hyperv/kerberos-spn.test.ts`  
Expected: FAIL（模块不存在）

**Step 3: 最小实现**

- `normalizeKerberosServiceName(input?: string): "WSMAN" | "HTTP" | "HOST"`
- `buildKerberosSpnStrategy({ host, preferredServiceName, enableFallback, hostnameOverride }): { serviceCandidates: ("WSMAN"|"HTTP"|"HOST")[]; hostnameOverrides: Array<string | null> }`

**Step 4: 运行测试确认通过**
Run: `bun run test plugins/hyperv/kerberos-spn.test.ts`  
Expected: PASS

---

### Task 2: Source config 贯通（strict 默认）

**Files:**

- Modify: `plugins/hyperv/index.ts`
- Modify: `plugins/hyperv/client.ts`

**Step 1: buildWinrmOptions() 读取新字段（可选）**

- `kerberos_service_name?: "WSMAN"|"HTTP"|"HOST"`（默认 WSMAN）
- `kerberos_spn_fallback?: boolean`（默认 false）
- `kerberos_hostname_override?: string`（默认不设置）

**Step 2: 在 Kerberos 路径使用统一策略**

- `runPowershellPywinrm()`：把 `serviceCandidates/hostnameOverrides` 作为 JSON 入参传给 Python
- `runPowershellKerberos()`（curl 路径）：用同一策略替换现有 `curlSoapWithServiceNameFallback()` 的内置候选列表（默认只用 WSMAN）

---

### Task 3: pywinrm 包装脚本按“输入策略”执行

**Files:**

- Modify: `plugins/hyperv/winrm-kerberos.py`

**Step 1: 解析可选输入字段**

- `kerberos_service_candidates`（list[str]，缺省则按 strict：`["WSMAN"]`）
- `kerberos_hostname_overrides`（list[str|null]，缺省则 `[None]`）

**Step 2: 移除脚本内的自动猜测**

- 不再在 Python 内部拼 `["WSMAN","HTTP","HOST"]` 或 short hostname；全部交给 TS 策略层决定
- 仍只捕获 `KerberosExchangeError` 作为“可重试候选”的依据；其他错误（例如 HTTP 503）直接返回，避免误导性重试

---

### Task 4: 文档同步（用户可见变更）

**Files:**

- Modify: `README.md`
- Modify: `docs/runbooks/hyperv-collector-checklist.md`

**Step 1: Source config 文档补齐**

- 说明 `kerberos_service_name / kerberos_spn_fallback / kerberos_hostname_override` 的用途与默认值
- 明确“WinRM Kerberos 常见 SPN 为 WSMAN；curl/requests 默认 HTTP 可能导致 `HTTP/<host>` not found”

**Step 2: 新增 503 排障条目**

- 解释 `Bad HTTP response ... Code 503` 常见含义：目标 WinRM 服务未运行/未就绪/端口被非 WinRM 服务接管
- 给出目标机侧最小排障命令（不要求采集侧自动修复）：`Get-Service WinRM`、`winrm quickconfig`、`winrm enumerate winrm/config/listener`、事件日志 `Microsoft-Windows-WinRM/Operational`

---

### Task 5: 验证（必须）

**Step 1: 单测**

- Run: `bun run test`

**Step 2: 静态检查**

- Run: `bun run format:check`
- Run: `bun run lint`
- Run: `bun run type-check`

Expected: 全部通过。
