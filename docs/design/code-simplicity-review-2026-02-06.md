# Code Simplicity Review (2026-02-06)

## Simplification Analysis

### Core Purpose

这套代码的核心目标很明确：

- 提供“资产台账系统”的 Web 控制台（资产列表/详情/重复合并等），支持筛选、导出、编辑覆盖值（override/source/effective 三态）。
- 提供对应的 API（Next.js Route Handlers）来查询/更新资产、台账字段、SolarWinds 同步、重复候选等。
- 通过 `worker/scheduler + plugins` 运行采集与入库，把数据落到 PostgreSQL/Prisma。

本次简化审查主要聚焦在几个“复杂度热点”（大文件、重复逻辑、容易漂移的多处声明）上。

### Unnecessary Complexity Found

- `src/app/assets/page.tsx:320`：资产列表页用大量离散 `useState` 存筛选项，导致：
  - `query` 的派生逻辑 + 依赖数组非常长（`src/app/assets/page.tsx:361`）。
  - URL ⇄ state 同步需要两段 `useEffect`，每次都要逐字段 set（`src/app/assets/page.tsx:448` / `src/app/assets/page.tsx:476`）。
  - 认知负担大，新增/删除筛选字段时容易漏改（依赖数组、URL 同步、API 请求参数三处）。
  - 简化建议：把筛选态收敛成单个对象（例如 `filters` / `urlState`），统一默认值与序列化；输入控件用 `setFilters((s) => ({ ...s, field: next }))`。这样可直接删掉 `skipNextUrlSyncRef` 一类“防振荡”逻辑。

- `src/app/assets/page.tsx:587`：同一个 `query` 被重复展开两次构造 URL 参数；而 API 请求参数又通过 `forEach -> params.set` 再拷贝一次（`src/app/assets/page.tsx:592` / `src/app/assets/page.tsx:620`）。
  - 简化建议：把 `buildAssetListUrlSearchParams(query)` 的结果当作唯一 source of truth，直接 `fetch(/api/v1/assets?${urlParams})`；URL 同步与 API 请求复用同一份 `URLSearchParams`。

- `src/app/assets/page.tsx:226`：`powerStateLabel()` 只是转调 `powerStateLabelZh()`，属于“无收益封装”。
  - 简化建议：删掉 wrapper，直接引用原函数。

- `src/app/assets/page.tsx:514`：同文件里多段 `useEffect` 重复 “`let active=true; fetch; if(active) setState; cleanup`” 模板（例如 `src/app/assets/page.tsx:514` / `src/app/assets/page.tsx:533` / `src/app/assets/page.tsx:587`）。
  - 简化建议：优先用 `AbortController` 替代 `active`（更少样板，也更贴近 fetch 语义）；如果仍觉得重复，再考虑一个非常小的本地 helper（避免引入大而全的数据请求框架）。

- `src/app/assets/[uuid]/page.tsx:241`：资产详情页重复了与列表页一致的 `loadMe` 模板（同样的 `active` + role 解析），并且在加载失败/成功路径里重复 reset 多个 state（`src/app/assets/[uuid]/page.tsx:272` / `src/app/assets/[uuid]/page.tsx:294`）。
  - 简化建议：把“role 获取”抽成 1 个最小 hook（例如 `useMeRole()`），让页面只关心 `isAdmin`；把 reset 聚合成一个 `resetLedgerEdit()` 小函数（只做本页需要的事，不做通用抽象）。

- `src/lib/assets/asset-list-query.ts:57`：`parseIpMissing/parseMachineNameMissing/parseMachineNameVmNameMismatch` 三个函数完全同构；`parseAssetType/parseSourceType` 也高度相似（`src/lib/assets/asset-list-query.ts:29` / `src/lib/assets/asset-list-query.ts:35`）。
  - 简化建议：用 `parseTrueFlag()` + `parseEnum()` 这类极小 helper 收敛重复，减少维护点。

- `src/lib/assets/asset-list-query.ts:229`：多处硬编码逐个 `if (query.xxx) and.push(buildLedgerEffectiveContainsWhere('key', query.xxx))`；`q` 搜索里又对多组 ledger key 重复追加（`src/lib/assets/asset-list-query.ts:313`）。
  - 简化建议：把可搜索 ledger key 列表做成数组常量（或从 `ledger-fields-v1` 导出 keys），用 loop 生成 where 条件；能显著减少重复，并且新增字段时不容易漏。

- `src/lib/ledger/ledger-fields-v1.ts:58`：`LEDGER_FIELDS_V1` 已经是 key 的单一列表，但 `LEDGER_FIELDS_V1_DB_SELECT` 与 `buildEmptyLedgerFieldsV1` 又手写了一遍同样的 key 集合（`src/lib/ledger/ledger-fields-v1.ts:150`）。
  - 风险：新增 ledger 字段时极易出现“更新了 meta，忘了更新 select/empty/default”的漂移 bug。
  - 简化建议：从 `LEDGER_FIELDS_V1` 生成 `DB_SELECT` 与 empty 结构（允许有限 `as` 断言，换取维护点减少）。

- `src/lib/openapi/spec.ts:58`：OpenAPI 的 `LedgerFieldsV1Schema` 再次枚举 ledger keys（与 `ledger-fields-v1` 形成三处重复：schema/type/UI）。
  - 简化建议：至少导出一份 `LEDGER_FIELD_KEYS_V1` 常量作为唯一 key 源；OpenAPI schema 与服务端逻辑从同一处生成，避免“文档与实现漂移”。

- `src/bin/worker.ts:172`：`processRun()` 里多处失败分支重复 `prisma.run.update({ status: 'Failed', finishedAt, errorSummary, errors })` 然后 return（`src/bin/worker.ts:179` / `src/bin/worker.ts:199` / `src/bin/worker.ts:222` / `src/bin/worker.ts:244` ...）。
  - 简化建议：引入一个局部 `failRun(run, errorSummary, error, pluginExitCode?)` helper（只在 `worker.ts` 内部），把样板代码收敛；不仅减行数，还能强制失败写库字段一致。

- `src/app/api/v1/assets/[uuid]/solarwinds/collect/route.ts:118`：`Record<LedgerFieldKey, string|null>` 的初始化与 map 回写都手写 key 列表（`src/app/api/v1/assets/[uuid]/solarwinds/collect/route.ts:120` / `src/app/api/v1/assets/[uuid]/solarwinds/collect/route.ts:148`）。
  - 简化建议：从 ledger key 列表生成空对象与 source map（同上，减少漂移）。

- Canonical 字段读取 helper 在多处重复实现（甚至签名不一致）：
  - `src/app/api/v1/assets/route.ts:13`
  - `src/bin/backfill-asset-derived-fields.ts:3`
  - `src/app/duplicate-candidates/[candidateId]/page.tsx:79`
  - `src/app/duplicate-candidates/[candidateId]/merge/page.tsx:61`
  - 简化建议：在 `src/lib/assets/` 下提供 1 个最小 helper（例如 `getCanonicalValue(fields, pathParts|pathString)`），统一“FieldValue.value”解包规则，让调用点只关心业务字段。

### Code to Remove

- `src/app/assets/page.tsx:226`：删除 `powerStateLabel()` wrapper（无收益封装）。
  - 预计减少：~3 LOC

- `src/app/assets/page.tsx:448` + `src/app/assets/page.tsx:476` + `src/app/assets/page.tsx:361`：把“筛选项状态 + URL 同步 + query 派生”收敛到单对象状态后，可删除大量逐字段 set 与重复展开。
  - 预计减少：~150-250 LOC（取决于实现方式）

- `src/app/assets/page.tsx:592`：删除 `urlParams -> params` 的二次拷贝，直接复用 `URLSearchParams`。
  - 预计减少：~5-15 LOC

- `src/lib/assets/asset-list-query.ts:57`：合并同构 parse 函数、用循环生成 ledger where。
  - 预计减少：~30-60 LOC

- `src/bin/worker.ts:172`：抽出 `failRun()`/`finishRun()` 等局部 helper 收敛失败写库样板。
  - 预计减少：~80-140 LOC

- `src/lib/ledger/ledger-fields-v1.ts:58`：从 `LEDGER_FIELDS_V1` 生成 `LEDGER_FIELDS_V1_DB_SELECT` 与 empty ledger。
  - 预计减少：~30-60 LOC（取决于 TS 断言与可读性取舍）

### Simplification Recommendations

1. 先把资产列表页的“筛选状态模型”改成单对象（最大收益、最能降认知负担）。
   - Current: 多个 `useState` + `query useMemo` + 两段 URL 同步 effect（`src/app/assets/page.tsx:320` / `src/app/assets/page.tsx:361` / `src/app/assets/page.tsx:448`）。
   - Proposed: `const [filters, setFilters] = useState<AssetListUrlState>(defaults)`；URL 变化时 `setFilters(parsed)`；本地变更时直接 `router.replace`（或把 URL 当唯一状态源）。
   - Impact: 预计 -150~250 LOC；减少漏改点；去掉 `skipNextUrlSyncRef` 类 workaround。

2. 统一“URL 参数构造”的唯一来源，并复用在 URL 同步与 API 请求。
   - Current: `buildAssetListUrlSearchParams()` 在多个地方重复展开字段（`src/app/assets/page.tsx:484` / `src/app/assets/page.tsx:595`）。
   - Proposed: `const urlParams = useMemo(() => buildAssetListUrlSearchParams(query), [query])`，两处复用。
   - Impact: -20~40 LOC；逻辑更一致，减少 drift。

3. 在 `asset-list-query` 内把“ledger keys”抽成列表并循环生成 where（避免复制粘贴）。
   - Current: 多处显式 `if (query.xxx) ...` + `q` 搜索里再次枚举（`src/lib/assets/asset-list-query.ts:229` / `src/lib/assets/asset-list-query.ts:313`）。
   - Proposed: `const LEDGER_SEARCH_KEYS = [...] as const;` 然后 loop push。
   - Impact: -20~50 LOC；新增字段更不易漏。

4. `worker.ts` 用局部 helper 收敛失败写库分支（只在当前文件内，不做通用框架）。
   - Current: 多段 `prisma.run.update(...Failed...)` + return（`src/bin/worker.ts:172`）。
   - Proposed: `await failRun(run, errorSummary, error, { pluginExitCode })`。
   - Impact: -80~140 LOC；失败落库字段更一致。

5. 把 canonical value 读取统一成一个最小 helper，删掉 4 份重复实现。
   - Current: 多处重复 `getCanonicalFieldValue`（见上方列表）。
   - Proposed: `getCanonicalValue(fields, ['os','name'])` 或 `getCanonicalValue(fields, 'os.name')`。
   - Impact: -30~60 LOC；行为更一致、减少边界差异 bug。

### YAGNI Violations

- `src/app/assets/page.tsx:226` 这类“只转调一次的 wrapper”属于典型的“为了未来可能变化而提前封装”，当前并不提供任何好处。
  - 建议：直接删除，等真的需要适配差异时再引入抽象。

- `src/bin/worker.ts:59` 同时兼容 `inventoryComplete` 和 `inventory_complete` 字段名属于兼容层逻辑。
  - 如果旧格式已经确定不会再出现：建议删掉兼容分支，减少噪音与测试面。
  - 如果必须兼容：建议把兼容逻辑集中到一个 `normalizeStats()` 小函数，避免在多处重复判断（`src/bin/worker.ts:498` 也出现了类似判断）。

### Final Assessment

Total potential LOC reduction: ~6% - 12%（在不引入新框架、以“删重复/删样板”为主的前提下）

Complexity score: High（主要由超大 client page + 多处重复的状态/序列化/映射代码导致）

Recommended action: Proceed with simplifications（优先做“状态模型收敛 + 参数构造复用 + worker 失败写库收敛”，这是低风险且收益最大的组合）
