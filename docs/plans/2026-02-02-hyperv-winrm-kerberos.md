# Hyper-V WinRM Kerberos Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在不改 Hyper-V 服务器 WinRM 默认配置（Basic 关闭、Kerberos/Negotiate 开启）的前提下，让 Hyper-V 采集支持 Kerberos（SPNEGO），并补齐可观测性与 UI/文档说明。

**Architecture:** 采集侧优先走 Kerberos：通过系统 `kinit` 获取临时票据缓存（`KRB5CCNAME` 指向临时文件），再用 `curl --negotiate` 调用 WinRM `/wsman`（WSMan SOAP：CreateShell/Command/Receive/Delete）执行 PowerShell；`auth_method=auto` 时 Kerberos 失败可降级到 legacy `winrm-client`（basic/ntlm）以兼容特殊环境。

**Tech Stack:** Bun/TypeScript、WinRM/WSMan SOAP、`kinit`/`curl --negotiate`、vitest（纯函数单测）、Next.js（配置表单）。

---

### Task 1: Kerberos principal/realm 推导 helper（TDD）

**Files:**

- Create: `plugins/hyperv/kerberos.ts`
- Create: `plugins/hyperv/kerberos.test.ts`

**Step 1: 写 failing tests**

- username 为 UPN（`user@corp.example.com`）时：优先使用原始 principal，并补充 realm 大写变体（如适用）
- username 无 `@` 且 domain=`corp`、host realm=`EXAMPLE.COM` 时：生成候选 principal（`user@CORP.EXAMPLE.COM`、`user@EXAMPLE.COM`），去重且保持顺序
- realm 缺失且无法推导时：返回空数组（由调用方抛出可读错误）

**Step 2: 运行测试确认失败**
Run: `bun run test plugins/hyperv/kerberos.test.ts`
Expected: FAIL（模块不存在）

**Step 3: 最小实现**

- `buildKerberosPrincipalCandidates({ rawUsername, domain, realmFromHost })`

**Step 4: 运行测试确认通过**
Run: `bun run test plugins/hyperv/kerberos.test.ts`
Expected: PASS

---

### Task 2: WinRM Kerberos 传输层（kinit + curl negotiate）

**Files:**

- Modify: `plugins/hyperv/client.ts`

**Step 1: 接入 helper**

- `resolveKerberosHost()` 产出 `resolvedHost` 与 `realmFromHost`
- 使用 `buildKerberosPrincipalCandidates()` 多次尝试 `kinit`，成功即继续；全部失败则抛出带提示的错误（建议填写 FQDN / 使用 UPN）

**Step 2: 修正 WSMan SOAP 细节**

- `s:mustUnderstand` 属性名修正（避免服务端严格校验失败）
- `WINRS_CODEPAGE` 调整为 `65001`（UTF-8），并用 `utf8` 解码 stream base64

**Step 3: Debug 事件补齐**

- Kerberos：记录 `resolved_host/realm_candidates/principal_used`
- curl：记录 `op/status/duration_ms/outcome`（不落盘请求体/响应全文，仅必要 excerpt）

---

### Task 3: 贯通 config（auth_method）与默认行为

**Files:**

- Modify: `plugins/hyperv/index.ts`
- Modify: `plugins/hyperv/types.ts`（如需补充注释/约束）

**Step 1: buildWinrmOptions() 补齐字段**

- `authMethod = cfg.auth_method ?? 'auto'`
- `rawUsername = cred.username`
- `domain = cred.domain`
- `username`（legacy 用：domain 存在时 `DOMAIN\\user`，否则 raw username）

**Step 2: 错误归因增强**

- `kinit`/`curl` 不存在（ENOENT）→ `HYPERV_CONFIG_INVALID`（提示需要安装 Kerberos client/curl negotiate）
- Kerberos realm 推导失败 → `HYPERV_CONFIG_INVALID`（提示填写 FQDN/UPN）

---

### Task 4: UI 表单与文档同步

**Files:**

- Modify: `src/app/sources/new/page.tsx`
- Modify: `src/app/sources/[id]/edit/page.tsx`
- Modify: `src/app/credentials/new/page.tsx`
- Modify: `src/app/credentials/[id]/edit/page.tsx`
- Modify: `README.md`
- Modify: `docs/runbooks/hyperv-collector-checklist.md`

**Step 1: Source 配置项**

- 增加 `auth_method` 下拉：`auto/kerberos/ntlm/basic`（默认 `auto`）
- （可选）将 Hyper-V 的默认 scheme/port 调整为 `http/5985` 并在说明中提示默认 WinRM 常见为 HTTP

**Step 2: Credential 提示文案**

- domain 文案改为：`auto/kerberos` 优先用于 Kerberos realm 推导；失败时才会以 `DOMAIN\\username` 走 NTLM（legacy fallback）
- 推荐填 UPN（`user@domain`）以提升 Kerberos 成功率

**Step 3: 文档**

- README：补充 Kerberos 依赖（`kinit` + `curl --negotiate`）与 debug 日志说明
- runbook：补充 `auth_method` 语义、默认 WinRM 推荐配置与排障方法

---

### Task 5: 验证（必须）

**Step 1: 格式化/静态检查**

- Run: `bun run format:check`
- Run: `bun run lint`
- Run: `bun run type-check`

**Step 2: 单测**

- Run: `bun run test`

Expected: 全部通过（无新增 TS/ESLint 错误）。
