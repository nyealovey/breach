# 资产台账系统 - vCenter Host ESXi 版本/构建号采集（SOAP）与资产列表展示 - 产品需求文档（PRD）

> 目标：补齐 Host 的 ESXi 版本信息，并在资产列表（/assets）“操作系统”列展示为 `ESXi 7.0.3`（仅展示 name + version）。数据来源需可追溯（canonical 快照），不依赖人工输入。

## Requirements Description

### Background

- **Business Problem**：
  - vCenter REST（vSphere Automation API）对 Host 的信息较少，无法稳定获得 ESXi 的 `version/build`，导致资产列表 Host 行“操作系统”列为空或不可用。
  - 盘点/排障场景常需要直接看到 ESXi 版本（例如 `ESXi 7.0.3`），否则需要人工登录 vCenter/ESXi 查看，效率低。
- **Target Users**：管理员（admin）、平台研发/采集插件开发者。
- **Value Proposition**：
  - 列表页即可看到关键版本信息，减少切换成本。
  - 使用 vSphere Web Services（SOAP, vim25）采集，字段稳定且可追溯到 source/run。

### Feature Overview

#### Core Features（本次变更）

1. **通过 vSphere Web Services（SOAP / vim25）采集 Host 的 ESXi 版本/构建号**

- SDK endpoint：`https://<vcenter>/sdk`（基于现有 `endpoint` 自动补齐 `/sdk`，不要求用户输入完整路径）。
- 采集字段（HostSystem）：
  - `summary.config.product.version`（必需，用于展示）
  - `summary.config.product.build`（可选，建议采集以备后续排障/筛选使用）
  - `summary.config.product.name`（可选；展示侧统一用 `ESXi`）

2. **资产列表（/assets）Host 行“操作系统”列展示为 `ESXi {version}`**

- 展示示例：`ESXi 7.0.3`
- 本次不在列表展示 build（如 `20036589`），但允许采集并落库。

3. **搜索（q）支持按 ESXi 版本命中 Host**

- 输入 `ESXi` 或 `7.0.3` 可命中对应 Host。
- 若采集了 build（fingerprint/attributes），可选支持 build 搜索（建议支持）。

#### Feature Boundaries（明确不做什么）

- 不做“ESXi 版本 → 风险/漏洞”之类的联动能力（后续需求另立 PRD）。
- 不做 UI 列排序能力（维持现状）。
- 不做 VM Guest OS 的可读化翻译（本 PRD 仅聚焦 Host ESXi 版本）。

## Detailed Requirements

### Data Requirements（字段口径与落点）

#### normalized-v1（Host）

将 SOAP 获取到的 ESXi 信息映射到 Host 的 `normalized.os`：

- `normalized.os.name = "ESXi"`
- `normalized.os.version = <soap_version>`（例如 `7.0.3`）
- `normalized.os.fingerprint = <soap_build>`（可选；例如 `20036589`）

> 说明：
>
> - UI 展示只使用 `name + version`。
> - fingerprint 用于承接 build（后续可能用于排障/筛选/导出）。

#### canonical-v1（Host）

`asset_run_snapshot.canonical.fields.os.*` 必须包含上述字段（若可得），并保留来源信息（source/run/record）。

### Collection Flow（SOAP 采集流程）

> 目标：一次 collect run 内尽量批量化，避免 N+1 SOAP 请求。

1. 复用现有 vCenter REST 会话创建逻辑（或独立 SOAP 登录，视实现选择）：
   - SOAP 通过 `RetrieveServiceContent` 获取 `SessionManager`、`PropertyCollector` 引用；
   - `SessionManager.Login(userName,password)` 登录；
   - 后续 SOAP 请求通过 `Cookie` 维持会话。
2. 获得 Host 列表（已有 REST list hosts 输出的 host id，例如 `host-123`）。
3. 使用 `PropertyCollector.RetrievePropertiesEx` 批量读取所有 Host 的：
   - `summary.config.product.version`
   - `summary.config.product.build`（可选）
4. 将结果回填到对应 Host 的 normalized 中，最终由核心 ingest 写入 canonical 快照。

### UI & API（展示与搜索）

- 资产列表接口 `GET /api/v1/assets` 的 `os` 字段对 Host 行应返回：
  - `ESXi {version}`（由 canonical 解析出来的 `os.name + os.version` 拼接结果）
- 搜索 `q` 至少覆盖：
  - `os.name`、`os.version`（建议同时覆盖 `os.fingerprint`）

### Edge Cases

- SOAP SDK endpoint 不可达 / 登录失败：
  - 不应导致本次 collect 完全失败（除非现有策略要求失败）；
  - 对应 Host 的 `os.*` 缺失，UI 显示 `-`；
  - 需要记录可定位的 warning/error（含阶段、HTTP 状态码、摘要等）。
- 部分 Host 查询失败：
  - 其他 Host 仍能补齐版本；
  - 失败的 Host `os.*` 缺失并产生 warning。

## Design Decisions

### Technical Approach

- 插件侧新增 SOAP 客户端（TypeScript/Bun 可实现）：
  - 以最少依赖实现 SOAP 调用（推荐：HTTP 发送 XML + 解析 XML；不强依赖完整 WSDL 代码生成）。
  - 优先批量 `RetrievePropertiesEx`，避免逐 Host 调用。
- 数据落点：使用 normalized/canonical 的 `os` 结构承接（不新增 DB 列）。

### Constraints

- TLS：沿用现有插件策略（v1 允许自签名；跳过证书校验）。
- 性能：同一 run 内 SOAP 登录最多一次；读取 Host 版本字段尽量 1-2 次批量请求完成。

## Acceptance Criteria

### Functional Acceptance

- [ ] 对接 vCenter 跑一次 collect 后，Host 行“操作系统”列可展示为 `ESXi 7.0.3`（示例）。
- [ ] Host 行不展示“宿主机名”（保持 `-`）。
- [ ] 搜索 `ESXi` 或 `7.0.3` 可命中对应 Host。
- [ ] SOAP 不可用时不影响采集其它数据，且错误/告警可定位。

### Quality Standards

- [ ] 插件侧新增单测/集成测覆盖：SOAP 成功与失败降级路径（至少覆盖 version/build 的解析）。
- [ ] 文档同步：本 PRD + API spec/collector reference 至少更新一处并保持一致。

## Execution Phases

### Phase 1: SOAP 采集能力

- [ ] SOAP 登录（RetrieveServiceContent + Login）与会话复用（Cookie）
- [ ] RetrievePropertiesEx 批量获取 Host ESXi version/build
- [ ] 映射到 normalized.os 并串通到 canonical

### Phase 2: 展示与搜索对齐

- [ ] `GET /api/v1/assets` Host 行 `os` 拼接展示为 `ESXi {version}`
- [ ] `q` 搜索覆盖 `os.name/os.version`（可选覆盖 `os.fingerprint`）

---

**Document Version**: 1.0
**Created**: 2026-01-29
**Clarification Rounds**: 1
**Quality Score**: 92/100
