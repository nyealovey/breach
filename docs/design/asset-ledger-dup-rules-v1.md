# 资产台账 dup-rules-v1（疑似重复候选规则）

版本：v1.1  
日期：2026-01-26

## 文档简介

本文档沉淀资产台账系统的“疑似重复候选（DuplicateCandidate）”生成规则 `dup-rules-v1`，用于在多来源/迁移场景下提示可能重复的资产记录，并支持人工合并/忽略。

- 适用读者：产品、研发、测试、评审人员。
- 规则定位：**只生成候选，不做自动合并**；规则固定但必须可解释（命中原因 + 证据 + 分数）。
- 关联文档：
  - SRS：`docs/requirements/asset-ledger-srs.md`（FR-07：疑似重复候选）
  - normalized/canonical JSON Schema：`docs/design/asset-ledger-json-schema.md`（候选键字段落点）

## 1. 触发时机与数据口径

- 触发时机：在**每个 Source 的 Run 成功结束后**生成候选（可异步任务）。
- 数据口径：仅基于**成功 Run**产生的快照（`source_record.normalized` 等）计算；失败/取消的 Run **不得**推进去重候选与缺失/下线语义。

## 2. 候选范围（Candidate Scope）

默认约束：

- 排除：任一方 `asset.status=merged` 的资产不参与候选。
- 可包含：`vm` / `host`（`cluster` 默认不生成候选，除非后续明确需要）。

## 3. 候选时间窗（D-01，已决策）

- 候选范围：在管（in_service）+ 最近 `N` 天内出现过（`last_seen_at` within N days）的离线资产。
- 参数：`N = 7`（天；常量固化，不提供 UI 配置）。
- 目的：覆盖迁移场景，同时控制噪音与计算成本。

## 4. 评分与阈值

- 分数：`score ∈ [0,100]`，由规则命中累加（上限 100）。
- 候选创建阈值：`score >= 70` 创建候选；`score < 70` 不创建。
- 置信度标签（UI 展示建议）：
  - `90-100`：高（High）
  - `70-89`：中（Medium）

## 5. 阈值固定（D-02，已决策）

- 固定阈值：创建 `score >= 70`；High `score >= 90`。不提供配置项。

## 6. 规则列表（Rule Set）

> 说明：规则使用 `source_record.normalized` 中的“候选键（candidate keys）”。键不存在时视为不命中；不强制所有来源都提供全部键。

| rule_code                | 适用对象 | 分值 | 命中条件（摘要）                                            | 解释要点                                       |
| ------------------------ | -------- | ---- | ----------------------------------------------------------- | ---------------------------------------------- |
| `vm.machine_uuid_match`  | vm       | 100  | `machine_uuid` 存在且完全相同（SMBIOS/BIOS UUID 等）        | 强信号：同一虚拟机跨平台迁移仍可能保留         |
| `vm.mac_overlap`         | vm       | 90   | `mac_addresses` 交集 ≥ 1                                    | 强信号：需注意 MAC 复用/漂移                   |
| `vm.hostname_ip_overlap` | vm       | 70   | `hostname` 相同且 `ip_addresses` 交集 ≥ 1（取最近一次快照） | 中信号：DHCP/重装会带来误报                    |
| `host.serial_match`      | host     | 100  | `serial_number` 存在且完全相同                              | 强信号：物理机/设备序列号                      |
| `host.bmc_ip_match`      | host     | 90   | `bmc_ip` 存在且完全相同                                     | 强信号：OOB 管理地址通常稳定；仍需注意 IP 复用 |
| `host.mgmt_ip_match`     | host     | 70   | `management_ip` 存在且完全相同                              | 中信号：网段复用会误报                         |

## 7. 候选键集合（D-03，已决策）

- 最小集合：`machine_uuid`、`serial_number`、`mac_addresses`、`hostname`、`ip_addresses`、`bmc_ip`（host）
- 可选：`management_ip`（host，in-band；仅来源可稳定提供时使用）
- 辅助键（用于解释与人工研判；默认不计分）：`os.fingerprint`、`resource.profile`、`identity.cloud_native_id`

## 8. 可解释性：原因与证据（reasons JSON）

为满足“可解释”，候选需持久化命中原因与证据（示例结构）：

```json
{
  "version": "dup-rules-v1",
  "matched_rules": [
    {
      "code": "vm.machine_uuid_match",
      "weight": 100,
      "evidence": {
        "field": "normalized.identity.machine_uuid",
        "a": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        "b": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
      }
    }
  ]
}
```

## 9. 降噪与抑制策略（Ignored Handling）

基础要求：支持“永久忽略”。

### ignored 抑制策略（D-04，已决策）

- 处理：保持 `status=ignored` 不变；再次命中仅更新 `last_observed_at`，默认不再提示。
- 不提供 `reopen` 能力：ignored 为终态。

## 10. 规则测试用例

### 10.1 VM 规则测试用例

#### 10.1.1 `vm.machine_uuid_match`（100 分）

| 用例 ID    | 场景         | 输入 A                                                 | 输入 B                                                 | 预期结果      | 说明                |
| ---------- | ------------ | ------------------------------------------------------ | ------------------------------------------------------ | ------------- | ------------------- |
| VM-UUID-01 | 完全匹配     | `machine_uuid: "550e8400-e29b-41d4-a716-446655440000"` | `machine_uuid: "550e8400-e29b-41d4-a716-446655440000"` | 命中，+100 分 | 标准匹配            |
| VM-UUID-02 | 大小写不敏感 | `machine_uuid: "550E8400-E29B-41D4-A716-446655440000"` | `machine_uuid: "550e8400-e29b-41d4-a716-446655440000"` | 命中，+100 分 | UUID 应大小写不敏感 |
| VM-UUID-03 | 一方缺失     | `machine_uuid: "550e8400-..."`                         | `machine_uuid: null`                                   | 不命中        | 缺失不计分          |
| VM-UUID-04 | 双方缺失     | `machine_uuid: null`                                   | `machine_uuid: null`                                   | 不命中        | 缺失不计分          |
| VM-UUID-05 | 不匹配       | `machine_uuid: "550e8400-..."`                         | `machine_uuid: "660f9500-..."`                         | 不命中        | 不同 UUID           |
| VM-UUID-06 | 格式变体     | `machine_uuid: "550e8400e29b41d4a716446655440000"`     | `machine_uuid: "550e8400-e29b-41d4-a716-446655440000"` | 命中，+100 分 | 应规范化后比较      |

#### 10.1.2 `vm.mac_overlap`（90 分）

| 用例 ID   | 场景            | 输入 A                                                      | 输入 B                                                      | 预期结果     | 说明               |
| --------- | --------------- | ----------------------------------------------------------- | ----------------------------------------------------------- | ------------ | ------------------ |
| VM-MAC-01 | 单 MAC 匹配     | `mac_addresses: ["00:50:56:aa:bb:cc"]`                      | `mac_addresses: ["00:50:56:aa:bb:cc"]`                      | 命中，+90 分 | 交集 = 1           |
| VM-MAC-02 | 多 MAC 部分匹配 | `mac_addresses: ["00:50:56:aa:bb:cc", "00:50:56:dd:ee:ff"]` | `mac_addresses: ["00:50:56:aa:bb:cc", "00:50:56:11:22:33"]` | 命中，+90 分 | 交集 ≥ 1           |
| VM-MAC-03 | 大小写不敏感    | `mac_addresses: ["00:50:56:AA:BB:CC"]`                      | `mac_addresses: ["00:50:56:aa:bb:cc"]`                      | 命中，+90 分 | MAC 应大小写不敏感 |
| VM-MAC-04 | 格式变体        | `mac_addresses: ["00-50-56-aa-bb-cc"]`                      | `mac_addresses: ["00:50:56:aa:bb:cc"]`                      | 命中，+90 分 | 应规范化后比较     |
| VM-MAC-05 | 无交集          | `mac_addresses: ["00:50:56:aa:bb:cc"]`                      | `mac_addresses: ["00:50:56:dd:ee:ff"]`                      | 不命中       | 交集 = 0           |
| VM-MAC-06 | 一方空数组      | `mac_addresses: ["00:50:56:aa:bb:cc"]`                      | `mac_addresses: []`                                         | 不命中       | 空数组视为缺失     |
| VM-MAC-07 | 双方空数组      | `mac_addresses: []`                                         | `mac_addresses: []`                                         | 不命中       | 空数组视为缺失     |

#### 10.1.3 `vm.hostname_ip_overlap`（70 分）

| 用例 ID   | 场景                      | 输入 A                                                       | 输入 B                                                       | 预期结果     | 说明                        |
| --------- | ------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ | ------------ | --------------------------- |
| VM-HIP-01 | 完全匹配                  | `hostname: "web-01", ip_addresses: ["10.0.0.1"]`             | `hostname: "web-01", ip_addresses: ["10.0.0.1"]`             | 命中，+70 分 | hostname 相同且 IP 交集 ≥ 1 |
| VM-HIP-02 | hostname 匹配但 IP 无交集 | `hostname: "web-01", ip_addresses: ["10.0.0.1"]`             | `hostname: "web-01", ip_addresses: ["10.0.0.2"]`             | 不命中       | 需同时满足两个条件          |
| VM-HIP-03 | IP 匹配但 hostname 不同   | `hostname: "web-01", ip_addresses: ["10.0.0.1"]`             | `hostname: "web-02", ip_addresses: ["10.0.0.1"]`             | 不命中       | 需同时满足两个条件          |
| VM-HIP-04 | hostname 大小写不敏感     | `hostname: "WEB-01", ip_addresses: ["10.0.0.1"]`             | `hostname: "web-01", ip_addresses: ["10.0.0.1"]`             | 命中，+70 分 | hostname 应大小写不敏感     |
| VM-HIP-05 | 多 IP 部分匹配            | `hostname: "web-01", ip_addresses: ["10.0.0.1", "10.0.0.2"]` | `hostname: "web-01", ip_addresses: ["10.0.0.2", "10.0.0.3"]` | 命中，+70 分 | IP 交集 ≥ 1                 |
| VM-HIP-06 | hostname 缺失             | `hostname: null, ip_addresses: ["10.0.0.1"]`                 | `hostname: "web-01", ip_addresses: ["10.0.0.1"]`             | 不命中       | hostname 缺失不计分         |

### 10.2 Host 规则测试用例

#### 10.2.1 `host.serial_match`（100 分）

| 用例 ID    | 场景         | 输入 A                          | 输入 B                          | 预期结果      | 说明                 |
| ---------- | ------------ | ------------------------------- | ------------------------------- | ------------- | -------------------- |
| HOST-SN-01 | 完全匹配     | `serial_number: "CN12345678"`   | `serial_number: "CN12345678"`   | 命中，+100 分 | 标准匹配             |
| HOST-SN-02 | 大小写不敏感 | `serial_number: "cn12345678"`   | `serial_number: "CN12345678"`   | 命中，+100 分 | 序列号应大小写不敏感 |
| HOST-SN-03 | 一方缺失     | `serial_number: "CN12345678"`   | `serial_number: null`           | 不命中        | 缺失不计分           |
| HOST-SN-04 | 不匹配       | `serial_number: "CN12345678"`   | `serial_number: "CN87654321"`   | 不命中        | 不同序列号           |
| HOST-SN-05 | 空字符串     | `serial_number: ""`             | `serial_number: "CN12345678"`   | 不命中        | 空字符串视为缺失     |
| HOST-SN-06 | 占位符值     | `serial_number: "To Be Filled"` | `serial_number: "To Be Filled"` | 不命中        | 应过滤已知占位符     |

#### 10.2.2 `host.bmc_ip_match`（90 分）

| 用例 ID     | 场景        | 输入 A                                              | 输入 B                  | 预期结果     | 说明           |
| ----------- | ----------- | --------------------------------------------------- | ----------------------- | ------------ | -------------- |
| HOST-BMC-01 | 完全匹配    | `bmc_ip: "10.10.9.11"`                              | `bmc_ip: "10.10.9.11"`  | 命中，+90 分 | 标准匹配       |
| HOST-BMC-02 | 一方缺失    | `bmc_ip: "10.10.9.11"`                              | `bmc_ip: null`          | 不命中       | 缺失不计分     |
| HOST-BMC-03 | 不匹配      | `bmc_ip: "10.10.9.11"`                              | `bmc_ip: "10.10.9.12"`  | 不命中       | 不同 IP        |
| HOST-BMC-04 | IPv6 匹配   | `bmc_ip: "2001:db8::1"`                             | `bmc_ip: "2001:db8::1"` | 命中，+90 分 | 支持 IPv6      |
| HOST-BMC-05 | IPv6 规范化 | `bmc_ip: "2001:0db8:0000:0000:0000:0000:0000:0001"` | `bmc_ip: "2001:db8::1"` | 命中，+90 分 | 应规范化后比较 |

#### 10.2.3 `host.mgmt_ip_match`（70 分）

| 用例 ID      | 场景     | 输入 A                       | 输入 B                       | 预期结果     | 说明       |
| ------------ | -------- | ---------------------------- | ---------------------------- | ------------ | ---------- |
| HOST-MGMT-01 | 完全匹配 | `management_ip: "10.10.1.1"` | `management_ip: "10.10.1.1"` | 命中，+70 分 | 标准匹配   |
| HOST-MGMT-02 | 一方缺失 | `management_ip: "10.10.1.1"` | `management_ip: null`        | 不命中       | 缺失不计分 |
| HOST-MGMT-03 | 不匹配   | `management_ip: "10.10.1.1"` | `management_ip: "10.10.1.2"` | 不命中       | 不同 IP    |

### 10.3 组合规则测试用例

| 用例 ID  | 场景          | 命中规则                                   | 预期分数    | 预期结果           |
| -------- | ------------- | ------------------------------------------ | ----------- | ------------------ |
| COMBO-01 | VM 强信号     | `vm.machine_uuid_match`                    | 100         | 创建候选（High）   |
| COMBO-02 | VM 双强信号   | `vm.machine_uuid_match` + `vm.mac_overlap` | 100（上限） | 创建候选（High）   |
| COMBO-03 | VM 中信号     | `vm.hostname_ip_overlap`                   | 70          | 创建候选（Medium） |
| COMBO-04 | VM 无命中     | 无                                         | 0           | 不创建候选         |
| COMBO-05 | Host 强信号   | `host.serial_match`                        | 100         | 创建候选（High）   |
| COMBO-06 | Host 双强信号 | `host.serial_match` + `host.bmc_ip_match`  | 100（上限） | 创建候选（High）   |
| COMBO-07 | Host 中信号   | `host.mgmt_ip_match`                       | 70          | 创建候选（Medium） |
| COMBO-08 | Host 弱组合   | `host.bmc_ip_match` + `host.mgmt_ip_match` | 100（上限） | 创建候选（High）   |

## 11. 边界条件与特殊场景

### 11.1 数据边界条件

| 边界条件                                              | 处理方式             | 说明                 |
| ----------------------------------------------------- | -------------------- | -------------------- |
| 字段值为 `null`                                       | 视为缺失，不参与匹配 | 缺失不计分           |
| 字段值为空字符串 `""`                                 | 视为缺失，不参与匹配 | 空字符串等同于 null  |
| 字段值为空数组 `[]`                                   | 视为缺失，不参与匹配 | 空数组等同于 null    |
| 字段值为占位符（如 "N/A", "Unknown", "To Be Filled"） | 视为缺失，不参与匹配 | 应维护占位符黑名单   |
| 字段值包含前后空格                                    | 应 trim 后比较       | 避免空格导致误判     |
| 字段值大小写不一致                                    | 应统一转换后比较     | UUID/MAC/hostname 等 |

### 11.2 占位符黑名单

以下值应被视为"缺失"，不参与匹配：

```typescript
const PLACEHOLDER_BLACKLIST = [
  // 通用占位符
  'N/A',
  'n/a',
  'NA',
  'na',
  'Unknown',
  'unknown',
  'UNKNOWN',
  'None',
  'none',
  'NONE',
  'Null',
  'null',
  'NULL',
  '-',
  '--',
  '---',
  '0',
  '00000000-0000-0000-0000-000000000000',

  // 序列号占位符
  'To Be Filled',
  'To be filled by O.E.M.',
  'Default string',
  'System Serial Number',
  'Not Specified',
  'Not Available',
  'XXXXXXXXXX',
  'xxxxxxxxxxxx',

  // MAC 地址占位符
  '00:00:00:00:00:00',
  'FF:FF:FF:FF:FF:FF',
];
```

### 11.3 特殊场景处理

#### 11.3.1 同一来源内的资产

| 场景                           | 处理方式     | 说明                 |
| ------------------------------ | ------------ | -------------------- |
| 同一 Source 内两个资产命中规则 | 正常创建候选 | 可能是来源侧数据问题 |
| 同一 Asset 的不同 SourceLink   | 不创建候选   | 已绑定到同一资产     |

#### 11.3.2 已合并资产

| 场景                       | 处理方式         | 说明               |
| -------------------------- | ---------------- | ------------------ |
| 一方 `status=merged`       | 排除，不参与候选 | 已合并资产不再参与 |
| 双方 `status=merged`       | 排除，不参与候选 | 已合并资产不再参与 |
| 合并后新资产与其他资产命中 | 正常创建候选     | 主资产继续参与去重 |

#### 11.3.3 时间窗边界

| 场景                           | 处理方式       | 说明         |
| ------------------------------ | -------------- | ------------ |
| `last_seen_at` 恰好在 N 天边界 | 包含（≤ N 天） | 边界值应包含 |
| `last_seen_at` 超过 N 天       | 排除           | 超出时间窗   |
| `last_seen_at` 为 null         | 排除           | 无法判断时间 |

### 11.4 性能边界

| 场景                  | 阈值           | 处理方式               |
| --------------------- | -------------- | ---------------------- |
| 单次 Run 产生资产数量 | > 10,000       | 分批处理，避免内存溢出 |
| 候选计算超时          | > 5 分钟       | 记录警告，继续处理     |
| 候选数量过多          | > 1,000 条/Run | 记录警告，建议人工介入 |

## 12. 规则实现参考（TypeScript）

```typescript
/**
 * 疑似重复规则定义
 */
interface DupRule {
  code: string;
  assetType: 'vm' | 'host';
  weight: number;
  match: (a: NormalizedV1, b: NormalizedV1) => MatchResult | null;
}

interface MatchResult {
  code: string;
  weight: number;
  evidence: {
    field: string;
    a: unknown;
    b: unknown;
  };
}

/**
 * 规则集合
 */
const DUP_RULES: DupRule[] = [
  {
    code: 'vm.machine_uuid_match',
    assetType: 'vm',
    weight: 100,
    match: (a, b) => {
      const uuidA = normalizeUuid(a.identity?.machine_uuid);
      const uuidB = normalizeUuid(b.identity?.machine_uuid);
      if (!uuidA || !uuidB) return null;
      if (uuidA !== uuidB) return null;
      return {
        code: 'vm.machine_uuid_match',
        weight: 100,
        evidence: {
          field: 'identity.machine_uuid',
          a: a.identity?.machine_uuid,
          b: b.identity?.machine_uuid,
        },
      };
    },
  },
  {
    code: 'vm.mac_overlap',
    assetType: 'vm',
    weight: 90,
    match: (a, b) => {
      const macsA = normalizeMacs(a.network?.mac_addresses);
      const macsB = normalizeMacs(b.network?.mac_addresses);
      if (macsA.length === 0 || macsB.length === 0) return null;
      const overlap = macsA.filter((m) => macsB.includes(m));
      if (overlap.length === 0) return null;
      return {
        code: 'vm.mac_overlap',
        weight: 90,
        evidence: {
          field: 'network.mac_addresses',
          a: a.network?.mac_addresses,
          b: b.network?.mac_addresses,
        },
      };
    },
  },
  {
    code: 'vm.hostname_ip_overlap',
    assetType: 'vm',
    weight: 70,
    match: (a, b) => {
      const hostnameA = normalizeHostname(a.identity?.hostname);
      const hostnameB = normalizeHostname(b.identity?.hostname);
      if (!hostnameA || !hostnameB || hostnameA !== hostnameB) return null;

      const ipsA = normalizeIps(a.network?.ip_addresses);
      const ipsB = normalizeIps(b.network?.ip_addresses);
      if (ipsA.length === 0 || ipsB.length === 0) return null;

      const overlap = ipsA.filter((ip) => ipsB.includes(ip));
      if (overlap.length === 0) return null;

      return {
        code: 'vm.hostname_ip_overlap',
        weight: 70,
        evidence: {
          field: 'identity.hostname + network.ip_addresses',
          a: { hostname: a.identity?.hostname, ips: a.network?.ip_addresses },
          b: { hostname: b.identity?.hostname, ips: b.network?.ip_addresses },
        },
      };
    },
  },
  {
    code: 'host.serial_match',
    assetType: 'host',
    weight: 100,
    match: (a, b) => {
      const snA = normalizeSerial(a.identity?.serial_number);
      const snB = normalizeSerial(b.identity?.serial_number);
      if (!snA || !snB) return null;
      if (snA !== snB) return null;
      return {
        code: 'host.serial_match',
        weight: 100,
        evidence: {
          field: 'identity.serial_number',
          a: a.identity?.serial_number,
          b: b.identity?.serial_number,
        },
      };
    },
  },
  {
    code: 'host.bmc_ip_match',
    assetType: 'host',
    weight: 90,
    match: (a, b) => {
      const bmcA = normalizeIp(a.network?.bmc_ip);
      const bmcB = normalizeIp(b.network?.bmc_ip);
      if (!bmcA || !bmcB) return null;
      if (bmcA !== bmcB) return null;
      return {
        code: 'host.bmc_ip_match',
        weight: 90,
        evidence: {
          field: 'network.bmc_ip',
          a: a.network?.bmc_ip,
          b: b.network?.bmc_ip,
        },
      };
    },
  },
  {
    code: 'host.mgmt_ip_match',
    assetType: 'host',
    weight: 70,
    match: (a, b) => {
      const mgmtA = normalizeIp(a.network?.management_ip);
      const mgmtB = normalizeIp(b.network?.management_ip);
      if (!mgmtA || !mgmtB) return null;
      if (mgmtA !== mgmtB) return null;
      return {
        code: 'host.mgmt_ip_match',
        weight: 70,
        evidence: {
          field: 'network.management_ip',
          a: a.network?.management_ip,
          b: b.network?.management_ip,
        },
      };
    },
  },
];

/**
 * 计算两个资产的疑似重复分数
 */
function calculateDupScore(
  a: NormalizedV1,
  b: NormalizedV1,
  assetType: 'vm' | 'host',
): { score: number; reasons: MatchResult[] } {
  const applicableRules = DUP_RULES.filter((r) => r.assetType === assetType);
  const reasons: MatchResult[] = [];
  let score = 0;

  for (const rule of applicableRules) {
    const result = rule.match(a, b);
    if (result) {
      reasons.push(result);
      score += result.weight;
    }
  }

  // 分数上限 100
  return { score: Math.min(score, 100), reasons };
}

/**
 * 规范化函数
 */
function normalizeUuid(uuid: string | undefined | null): string | null {
  if (!uuid || isPlaceholder(uuid)) return null;
  return uuid.toLowerCase().replace(/-/g, '');
}

function normalizeMacs(macs: string[] | undefined | null): string[] {
  if (!macs || macs.length === 0) return [];
  return macs.map((m) => m.toLowerCase().replace(/[:-]/g, '')).filter((m) => !isPlaceholder(m));
}

function normalizeHostname(hostname: string | undefined | null): string | null {
  if (!hostname || isPlaceholder(hostname)) return null;
  return hostname.toLowerCase().trim();
}

function normalizeIps(ips: string[] | undefined | null): string[] {
  if (!ips || ips.length === 0) return [];
  return ips.map((ip) => normalizeIp(ip)).filter((ip): ip is string => ip !== null);
}

function normalizeIp(ip: string | undefined | null): string | null {
  if (!ip || isPlaceholder(ip)) return null;
  // 简化处理：实际应使用 IP 解析库
  return ip.trim().toLowerCase();
}

function normalizeSerial(sn: string | undefined | null): string | null {
  if (!sn || isPlaceholder(sn)) return null;
  return sn.toUpperCase().trim();
}

function isPlaceholder(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return PLACEHOLDER_BLACKLIST.some((p) => p.toLowerCase() === normalized);
}
```
