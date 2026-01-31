# 资产台账 legacy 字段 → normalized 映射（Host 优先；导入仅作兜底）

版本：v1.1
日期：2026-01-26

## 文档简介

本文档定义历史表格/第三方导出数据到 `normalized-v1` 的字段映射规则，主要面向 **物理机/裸金属（host）** 的导入场景。

- 适用读者：数据导入开发者、运维、数据治理人员。
- 使用方式：导入流程按本文映射规则将 legacy 字段转换为 `normalized-v1` 结构；未来主路径是自动化采集，导入仅作兜底。
- 关联文档：
  - normalized/canonical JSON Schema：`docs/design/asset-ledger-json-schema.md`
  - 采集插件参考：`docs/design/asset-ledger-collector-reference.md`
  - 概念数据模型：`docs/design/asset-ledger-data-model.md`

## 目标与范围

- 本文主要面向 **物理机/裸金属（host）** 的历史表格导入与第三方导出对齐（未来主路径是自动化采集）。
- **VM 不做 legacy 导入**：如未来需要，建议直接由采集插件输出 `normalized-v1`（见 schema），本表不再维护 VM 的列级映射。
- v1 MVP 优先保证以下字段可检索/过滤：**IP、主机名、CPU（数量）、内存（数量）、操作系统**。
- Host 的去重/候选键（导入/采集侧建议）：
  1. `network.bmc_ip`（你们口径的管理地址，优先）
  2. `identity.serial_number`（如可得，强烈建议同时采集/导入）
  3. `network.management_ip`（仅当来源提供“in-band 管理 IP”时作为补充）

Schema 定义见：`docs/design/asset-ledger-json-schema.md`（已新增 `network.bmc_ip`；`network.ilo_ip` 作为历史别名已废弃）。

## 0. 通用清洗/校验规则（强烈建议）

- 字符串：trim；多个分隔符统一（`,` `;` `|` `、` 空格）。
- IP 列表：
  - 拆分后写入 `network.ip_addresses[]`（去重）。
  - `network.ip_addresses[]` **仅放 in-band IP**（业务网/管理网/主机网卡 IP）；不要混入 BMC 地址。
  - BMC 地址写入 `network.bmc_ip`（单值）；如只有历史列 “ILO/iDRAC/IPMI 地址”，直接落这里。
- CPU：仅填 **数量** → `hardware.cpu_count`（整数）；无法可靠解析时写 `attributes.legacy_cpu_raw`。
- 内存：仅填 **数量** → `hardware.memory_bytes`（bytes）；无法可靠解析时写 `attributes.legacy_memory_raw`。
- 操作系统：
  - 名称 → `os.name`
  - 版本（可选） → `os.version`
  - 原始文本建议保留 → `attributes.legacy_os_raw`
- 硬盘（预留）：
  - v1 不强制结构化与计算“分配/已用”；建议先保留原文 → `attributes.legacy_disk_spec`。
  - 如未来要做“分配/已用”，建议预留：
    - `attributes.disk_total_bytes`（number，bytes，总容量/可分配）
    - `attributes.disk_used_bytes`（number，bytes，已用）
  - 说明：BMC/Redfish 通常只能拿到物理盘容量，拿不到文件系统 used；used 需要 OS/Agent/监控侧补齐。
- 敏感信息（如“管理码”）：**禁止明文入库**；仅写 `attributes.management_secret_ref`（密钥引用）。
- “状态/分类/服务级别”等治理字段：如暂未实现台账字段（预设字段集），建议先保留原值到 `attributes.legacy_*`，避免污染结构化字段枚举。

## 1. Host（物理机）字段映射（legacy → normalized-v1）

> “MVP 必填”指：你要求 v1 首屏检索/过滤必须可用的字段。

| 旧字段       | normalized 路径                                    | 说明/转换                                                                                                                                     | 归类                  | MVP 必填 |
| ------------ | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | -------- |
| 主机名       | `identity.hostname`                                | 主机名/ComputerName                                                                                                                           | 通用                  | 是       |
| IP地址       | `network.ip_addresses[]`                           | 多 IP 拆分、去重；不要包含 BMC IP                                                                                                             | 通用                  | 是       |
| ILO 地址     | `network.bmc_ip`                                   | iLO/iDRAC/IPMI/BMC 管理 IP（你们用于去重的管理地址）                                                                                          | 通用                  | 是       |
| （可选）     | `network.management_ip`                            | 仅当你能确定该 IP 是 in-band 管理地址（例如业务网卡/管理网卡的可登录地址）时填写；不要与 `network.bmc_ip` 等同；若只有 BMC 管理地址则保持为空 | 通用                  | 否       |
| CPU          | `hardware.cpu_count`                               | 仅数量（整数）；无法可靠解析则 `attributes.legacy_cpu_raw`                                                                                    | 通用/attributes       | 是       |
| 内存         | `hardware.memory_bytes`                            | 仅数量（bytes）；无法可靠解析则 `attributes.legacy_memory_raw`                                                                                | 通用/attributes       | 是       |
| 操作系统     | `os.name` / `os.version`                           | 可拆分出版本则填 `os.version`；原文保留 `attributes.legacy_os_raw`                                                                            | 通用/attributes       | 是       |
| 产品序列号   | `identity.serial_number`                           | 强烈建议导入/采集（dup 强键）                                                                                                                 | 通用                  | 否       |
| 固定资产编号 | `physical.fixed_asset_id`                          | 盘点/财务口径；建议同时在 `attributes.legacy_fixed_asset_id_raw` 保留原文                                                                     | 物理机扩展/attributes | 否       |
| 地区         | `location.region`                                  | 如“华东/北京机房”等                                                                                                                           | 通用                  | 否       |
| 机柜         | `location.cabinet`                                 | 机柜编号                                                                                                                                      | 通用                  | 否       |
| 位置         | `location.position`                                | U 位/位置描述（建议后续拆 `rack_u`）                                                                                                          | 通用                  | 否       |
| 硬盘         | `hardware.disks[]` / `attributes.legacy_disk_spec` | v1 不强制；能结构化多盘则写 `hardware.disks[]`，否则保留原文                                                                                  | 通用/attributes       | 否       |
| 维保期       | `physical.maintenance_period`                      | 如“3y/36m/2025-2028”；不强制结构化为起止日期                                                                                                  | 物理机扩展            | 否       |
| 采购日期     | `attributes.legacy_purchase_date`                  | 不进入结构化；保留原文用于对账/追溯                                                                                                           | attributes            | 否       |
| 保修截止期   | `attributes.legacy_warranty_end`                   | 不进入结构化；保留原文用于对账/追溯                                                                                                           | attributes            | 否       |
| 状态         | `attributes.legacy_status`                         | 不建议直接映射到 `asset.status`（需枚举对齐）                                                                                                 | attributes            | 否       |
| 服务级别     | `attributes.legacy_service_level`                  | v1 建议先放 attributes，避免枚举污染                                                                                                          | attributes            | 否       |
| 管理码       | `attributes.management_secret_ref`                 | 禁止明文；建议只存 ref/是否已配置                                                                                                             | attributes            | 否       |

## 2. VM（虚拟机）说明（不做 legacy 导入）

- VM 未来如需接入：建议通过采集插件输出 `normalized-v1`，并满足最小候选键（`identity.machine_uuid`/`network.mac_addresses[]`/`network.ip_addresses[]` 等）。
- 本文件不再维护 VM 的列级映射，避免误导导入流程。

## 3. 导入时的优先级/回填规则（Host）

- `network.bmc_ip`：若导入表存在 “ILO/iDRAC/IPMI/BMC” 任一列，优先填；为空则无法按你们口径去重，应提示“弱键导入”。
- `hardware.memory_bytes`：优先规范单位列（如 GB 列）；其次解析自由文本列（如 “256GB”）；再不行写 `attributes.legacy_memory_raw`。
- `os.name/os.version`：优先结构化列；其次从自由文本拆分；再不行写 `attributes.legacy_os_raw`。

## 4. attributes 命名约定（强烈建议）

- legacy 导入/第三方对齐字段统一使用 `legacy_` 前缀：`legacy_status`、`legacy_os_raw`、`legacy_cpu_raw`、`legacy_memory_raw`、`legacy_disk_spec`…
- 对于"暂不使用但要保留"的数值字段，建议以 bytes 为单位并明确后缀：`disk_total_bytes`、`disk_used_bytes`。

## 5. 数据校验规则

### 5.1 必填字段校验

| 字段                    | 校验规则             | 失败处理                                  |
| ----------------------- | -------------------- | ----------------------------------------- |
| `identity.hostname`     | 非空，长度 1-255     | 拒绝导入，记录错误                        |
| `network.bmc_ip`        | 非空，合法 IPv4/IPv6 | 警告"弱键导入"，允许继续                  |
| `hardware.cpu_count`    | 正整数，范围 1-1024  | 写入 `attributes.legacy_cpu_raw`，继续    |
| `hardware.memory_bytes` | 正整数，范围 1-64TB  | 写入 `attributes.legacy_memory_raw`，继续 |
| `os.name`               | 非空，长度 1-100     | 写入 `attributes.legacy_os_raw`，继续     |

### 5.2 格式校验

| 字段                      | 格式要求                | 示例                       |
| ------------------------- | ----------------------- | -------------------------- |
| `network.ip_addresses[]`  | 合法 IPv4/IPv6          | `10.10.1.1`, `2001:db8::1` |
| `network.bmc_ip`          | 合法 IPv4/IPv6          | `10.10.9.11`               |
| `identity.serial_number`  | 字母数字，长度 1-50     | `CN12345678`               |
| `physical.fixed_asset_id` | 字母数字横杠，长度 1-50 | `FA-2025-0001`             |
| `location.cabinet`        | 字母数字，长度 1-20     | `A01`, `B-12`              |

### 5.3 去重校验

导入前必须检查以下候选键是否已存在：

```typescript
// 去重优先级（按顺序匹配）
const deduplicationKeys = [
  'network.bmc_ip', // 优先级 1：BMC 管理地址
  'identity.serial_number', // 优先级 2：产品序列号
  'identity.hostname', // 优先级 3：主机名（弱键）
];
```

### 5.4 校验结果分类

| 级别      | 说明                      | 处理方式           |
| --------- | ------------------------- | ------------------ |
| `error`   | 必填字段缺失/格式严重错误 | 拒绝该行，记录错误 |
| `warning` | 弱键导入/格式轻微问题     | 允许导入，记录警告 |
| `info`    | 字段回填/默认值使用       | 允许导入，记录信息 |

## 6. 迁移脚本示例

### 6.1 CSV 导入脚本（TypeScript）

```typescript
import { parse } from 'csv-parse/sync';
import { z } from 'zod';

// 导入行 schema
const LegacyHostRowSchema = z.object({
  主机名: z.string().min(1),
  IP地址: z.string().optional(),
  ILO地址: z.string().optional(),
  CPU: z.string().optional(),
  内存: z.string().optional(),
  操作系统: z.string().optional(),
  产品序列号: z.string().optional(),
  固定资产编号: z.string().optional(),
  地区: z.string().optional(),
  机柜: z.string().optional(),
  位置: z.string().optional(),
});

// 转换为 normalized-v1
function transformToNormalized(row: z.infer<typeof LegacyHostRowSchema>): {
  normalized: NormalizedV1;
  warnings: string[];
  errors: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];

  const normalized: NormalizedV1 = {
    version: 'normalized-v1',
    kind: 'host',
    identity: {
      hostname: row.主机名.trim(),
    },
    network: {},
    hardware: {},
    os: {},
    location: {},
    physical: {},
    attributes: {},
  };

  // IP 地址处理
  if (row.IP地址) {
    const ips = parseIpList(row.IP地址);
    if (ips.valid.length > 0) {
      normalized.network!.ip_addresses = ips.valid;
    }
    if (ips.invalid.length > 0) {
      warnings.push(`无效 IP 已忽略: ${ips.invalid.join(', ')}`);
    }
  }

  // BMC 地址处理
  if (row.ILO地址) {
    const bmcIp = row.ILO地址.trim();
    if (isValidIp(bmcIp)) {
      normalized.network!.bmc_ip = bmcIp;
    } else {
      warnings.push(`BMC IP 格式无效: ${bmcIp}，将作为弱键导入`);
    }
  } else {
    warnings.push('缺少 BMC IP，将作为弱键导入');
  }

  // CPU 处理
  if (row.CPU) {
    const cpuCount = parseCpuCount(row.CPU);
    if (cpuCount !== null) {
      normalized.hardware!.cpu_count = cpuCount;
    } else {
      normalized.attributes!.legacy_cpu_raw = row.CPU;
      warnings.push(`CPU 格式无法解析: ${row.CPU}`);
    }
  }

  // 内存处理
  if (row.内存) {
    const memoryBytes = parseMemoryBytes(row.内存);
    if (memoryBytes !== null) {
      normalized.hardware!.memory_bytes = memoryBytes;
    } else {
      normalized.attributes!.legacy_memory_raw = row.内存;
      warnings.push(`内存格式无法解析: ${row.内存}`);
    }
  }

  // 操作系统处理
  if (row.操作系统) {
    const os = parseOs(row.操作系统);
    normalized.os!.name = os.name;
    if (os.version) normalized.os!.version = os.version;
    normalized.attributes!.legacy_os_raw = row.操作系统;
  }

  // 其他字段
  if (row.产品序列号) normalized.identity!.serial_number = row.产品序列号.trim();
  if (row.固定资产编号) normalized.physical!.fixed_asset_id = row.固定资产编号.trim();
  if (row.地区) normalized.location!.region = row.地区.trim();
  if (row.机柜) normalized.location!.cabinet = row.机柜.trim();
  if (row.位置) normalized.location!.position = row.位置.trim();

  return { normalized, warnings, errors };
}

// 批量导入函数
async function importLegacyHosts(csvContent: string): Promise<ImportResult> {
  const records = parse(csvContent, { columns: true, skip_empty_lines: true });
  const results: ImportResult = {
    total: records.length,
    success: 0,
    failed: 0,
    warnings: 0,
    details: [],
  };

  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    const rowNum = i + 2; // CSV 行号（含表头）

    try {
      const parsed = LegacyHostRowSchema.parse(row);
      const { normalized, warnings, errors } = transformToNormalized(parsed);

      if (errors.length > 0) {
        results.failed++;
        results.details.push({ row: rowNum, status: 'error', messages: errors });
        continue;
      }

      // 去重检查
      const existing = await findExistingAsset(normalized);
      if (existing) {
        results.details.push({
          row: rowNum,
          status: 'skipped',
          messages: [`已存在相同资产: ${existing.asset_uuid}`],
        });
        continue;
      }

      // 写入数据库
      await createSourceRecord(normalized);
      results.success++;
      if (warnings.length > 0) {
        results.warnings++;
        results.details.push({ row: rowNum, status: 'warning', messages: warnings });
      }
    } catch (e) {
      results.failed++;
      results.details.push({
        row: rowNum,
        status: 'error',
        messages: [e instanceof Error ? e.message : '未知错误'],
      });
    }
  }

  return results;
}
```

### 6.2 辅助函数

```typescript
// IP 列表解析
function parseIpList(raw: string): { valid: string[]; invalid: string[] } {
  const separators = /[,;|、\s]+/;
  const parts = raw
    .split(separators)
    .map((s) => s.trim())
    .filter(Boolean);
  const valid: string[] = [];
  const invalid: string[] = [];

  for (const part of parts) {
    if (isValidIp(part)) {
      valid.push(part);
    } else {
      invalid.push(part);
    }
  }

  return { valid: [...new Set(valid)], invalid };
}

// IP 格式校验
function isValidIp(ip: string): boolean {
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
  return ipv4Regex.test(ip) || ipv6Regex.test(ip);
}

// CPU 数量解析
function parseCpuCount(raw: string): number | null {
  const match = raw.match(/(\d+)/);
  if (match) {
    const count = parseInt(match[1], 10);
    if (count > 0 && count <= 1024) return count;
  }
  return null;
}

// 内存解析（转为 bytes）
function parseMemoryBytes(raw: string): number | null {
  const match = raw.match(/(\d+(?:\.\d+)?)\s*(GB|MB|TB|G|M|T)?/i);
  if (!match) return null;

  const value = parseFloat(match[1]);
  const unit = (match[2] || 'GB').toUpperCase();

  const multipliers: Record<string, number> = {
    TB: 1024 ** 4,
    T: 1024 ** 4,
    GB: 1024 ** 3,
    G: 1024 ** 3,
    MB: 1024 ** 2,
    M: 1024 ** 2,
  };

  const bytes = value * (multipliers[unit] || 1024 ** 3);
  if (bytes > 0 && bytes <= 64 * 1024 ** 4) return Math.round(bytes);
  return null;
}

// 操作系统解析
function parseOs(raw: string): { name: string; version?: string } {
  // 常见模式匹配
  const patterns = [
    /^(Windows Server)\s*(\d{4}(?:\s*R\d)?)/i,
    /^(Ubuntu)\s*(\d+\.\d+)/i,
    /^(CentOS)\s*(\d+(?:\.\d+)?)/i,
    /^(Red Hat Enterprise Linux|RHEL)\s*(\d+(?:\.\d+)?)/i,
    /^(ESXi)\s*(\d+(?:\.\d+)?)/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match) {
      return { name: match[1], version: match[2] };
    }
  }

  return { name: raw.trim() };
}
```

## 7. 回滚方案

### 7.1 导入事务设计

```typescript
// 导入任务记录
interface ImportTask {
  task_id: string;
  source_type: 'legacy_csv';
  file_name: string;
  started_at: Date;
  finished_at?: Date;
  status: 'running' | 'completed' | 'failed' | 'rolled_back';
  total_rows: number;
  success_count: number;
  failed_count: number;
  created_asset_uuids: string[]; // 用于回滚
  created_record_ids: string[]; // 用于回滚
}
```

### 7.2 回滚脚本

```typescript
/**
 * 回滚导入任务
 * @param taskId 导入任务 ID
 */
async function rollbackImportTask(taskId: string): Promise<RollbackResult> {
  const task = await prisma.importTask.findUnique({ where: { task_id: taskId } });

  if (!task) {
    throw new Error(`导入任务不存在: ${taskId}`);
  }

  if (task.status === 'rolled_back') {
    throw new Error(`任务已回滚: ${taskId}`);
  }

  const result: RollbackResult = {
    task_id: taskId,
    deleted_records: 0,
    deleted_assets: 0,
    errors: [],
  };

  await prisma.$transaction(async (tx) => {
    // 1. 删除 source_record
    if (task.created_record_ids.length > 0) {
      const deleted = await tx.sourceRecord.deleteMany({
        where: { id: { in: task.created_record_ids } },
      });
      result.deleted_records = deleted.count;
    }

    // 2. 删除孤立的 asset（无其他 source_record 关联）
    for (const assetUuid of task.created_asset_uuids) {
      const linkCount = await tx.assetSourceLink.count({
        where: { asset_uuid: assetUuid },
      });

      if (linkCount === 0) {
        await tx.asset.delete({ where: { asset_uuid: assetUuid } });
        result.deleted_assets++;
      }
    }

    // 3. 更新任务状态
    await tx.importTask.update({
      where: { task_id: taskId },
      data: {
        status: 'rolled_back',
        rolled_back_at: new Date(),
      },
    });

    // 4. 记录审计
    await tx.auditEvent.create({
      data: {
        event_type: 'import.rolled_back',
        actor_id: getCurrentUserId(),
        subject_type: 'import_task',
        subject_id: taskId,
        payload: {
          deleted_records: result.deleted_records,
          deleted_assets: result.deleted_assets,
        },
      },
    });
  });

  return result;
}
```

### 7.3 回滚检查清单

| 步骤 | 操作            | 验证                             |
| ---- | --------------- | -------------------------------- |
| 1    | 确认导入任务 ID | 任务存在且状态非 `rolled_back`   |
| 2    | 备份当前数据    | 导出受影响的 asset/source_record |
| 3    | 执行回滚脚本    | 检查返回的删除计数               |
| 4    | 验证数据一致性  | 确认无孤立记录                   |
| 5    | 检查审计日志    | 确认回滚事件已记录               |

### 7.4 紧急回滚 SQL（仅限 DBA）

```sql
-- 警告：仅在脚本回滚失败时使用，需 DBA 审批

-- 1. 查看导入任务
SELECT * FROM import_task WHERE task_id = 'xxx';

-- 2. 删除 source_record（按 task_id）
DELETE FROM source_record
WHERE id IN (
  SELECT unnest(created_record_ids) FROM import_task WHERE task_id = 'xxx'
);

-- 3. 删除孤立 asset
DELETE FROM asset
WHERE asset_uuid IN (
  SELECT unnest(created_asset_uuids) FROM import_task WHERE task_id = 'xxx'
)
AND NOT EXISTS (
  SELECT 1 FROM asset_source_link WHERE asset_source_link.asset_uuid = asset.asset_uuid
);

-- 4. 更新任务状态
UPDATE import_task
SET status = 'rolled_back', rolled_back_at = NOW()
WHERE task_id = 'xxx';
```
