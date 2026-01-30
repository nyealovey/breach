# vCenter Host ESXi 版本/构建号 + 硬件规格 + 本地盘总量（SOAP）Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** vCenter 插件在 collect 时通过 vSphere SOAP（`/sdk` + `RetrievePropertiesEx`）批量补齐 Host（ESXi）的 `os.version/os.fingerprint`、`hardware.cpu_count/hardware.memory_bytes` 与 `attributes.disk_total_bytes`，并在 `/assets` 列表展示；搜索 `q` 支持按 `ESXi`/`7.0.3` 命中 Host，但不支持按 build（`os.fingerprint`）命中 Host。

**Architecture:** vCenter 插件继续用 vSphere REST API 获取 inventory（Host/Cluster/VM 列表与关系），但 Host 的 ESXi 版本/构建号、CPU/内存、本地物理盘总量全部改为 SOAP（vim25）采集；核心侧不新增 DB 列，仅通过 normalized → canonical 的字段承接，列表 API 读取 canonical 聚合字段返回给 UI。

**Tech Stack:** Bun + TypeScript（plugins/vcenter）、Next.js App Router（API/UI）、Vitest、`fast-xml-parser`（SOAP XML 解析）。

---

### Task 0: 引入 SOAP XML 解析依赖（fast-xml-parser）

**Files:**

- Modify: `package.json`
- Modify: `bun.lock`

**Step 1: 添加依赖**

Run: `bun add fast-xml-parser`

Expected: `package.json` 增加依赖，`bun.lock` 更新。

**Step 2: 验证可被 TS/Node 环境导入**

Run: `node -e \"import('fast-xml-parser').then(() => console.log('ok')).catch((e) => (console.error(e), process.exit(1)))\"`

Expected: 输出 `ok`

---

### Task 1: 为 SOAP Host 解析写最小失败用例（RED）

**Files:**

- Create: `plugins/vcenter/soap.ts`
- Test: `plugins/vcenter/__tests__/soap.test.ts`

**Step 1: 写失败测试（成功解析 version/build/cpu/memory + 本地盘总量）**

`plugins/vcenter/__tests__/soap.test.ts`：

```ts
import { describe, expect, it } from 'vitest';

import { parseRetrievePropertiesExHostResult } from '../soap';

it('parses RetrievePropertiesEx host properties + localDisk total', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <RetrievePropertiesExResponse xmlns="urn:vim25">
      <returnval>
        <objects>
          <obj type="HostSystem">host-1</obj>
          <propSet><name>summary.config.product.version</name><val>7.0.3</val></propSet>
          <propSet><name>summary.config.product.build</name><val>20036589</val></propSet>
          <propSet><name>summary.hardware.numCpuCores</name><val>32</val></propSet>
          <propSet><name>summary.hardware.memorySize</name><val>274877906944</val></propSet>
          <propSet>
            <name>config.storageDevice.scsiLun</name>
            <val>
              <HostScsiDisk>
                <localDisk>true</localDisk>
                <capacity><blockSize>512</blockSize><block>7814037168</block></capacity>
              </HostScsiDisk>
              <HostScsiDisk>
                <localDisk>false</localDisk>
                <capacity><blockSize>512</blockSize><block>1</block></capacity>
              </HostScsiDisk>
            </val>
          </propSet>
        </objects>
      </returnval>
    </RetrievePropertiesExResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

  const out = parseRetrievePropertiesExHostResult(xml);
  expect(out.get('host-1')).toMatchObject({
    esxiVersion: '7.0.3',
    esxiBuild: '20036589',
    cpuCores: 32,
    memoryBytes: 274877906944,
    diskTotalBytes: 512 * 7814037168,
  });
});
```

**Step 2: 运行测试并确认失败**

Run: `bun run test plugins/vcenter/__tests__/soap.test.ts`  
Expected: FAIL（因为 `plugins/vcenter/soap.ts` 还不存在/函数未导出）。

---

### Task 2: 实现 SOAP XML 解析（GREEN）

**Files:**

- Modify: `plugins/vcenter/soap.ts`
- Test: `plugins/vcenter/__tests__/soap.test.ts`

**Step 1: 最小实现 XML → host details Map**

`plugins/vcenter/soap.ts`（示意）：

```ts
import { XMLParser } from 'fast-xml-parser';

export type HostSoapDetails = {
  esxiVersion?: string;
  esxiBuild?: string;
  cpuCores?: number;
  memoryBytes?: number;
  diskTotalBytes?: number;
  cpuModel?: string;
  cpuMhz?: number;
  cpuPackages?: number;
  cpuThreads?: number;
};

const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false });

export function parseRetrievePropertiesExHostResult(xml: string): Map<string, HostSoapDetails> {
  // 1) 定位 Body/RetrievePropertiesExResponse/returnval/objects
  // 2) 遍历 objects：按 propSet.name → propSet.val 取值
  // 3) 对 config.storageDevice.scsiLun：只统计 localDisk==true 的 HostScsiDisk.capacity
  return new Map();
}
```

**Step 2: 运行测试并确认通过**

Run: `bun run test plugins/vcenter/__tests__/soap.test.ts`  
Expected: PASS

---

### Task 3: 为 vCenter 插件集成 SOAP 采集写集成测试（RED）

**Files:**

- Modify: `plugins/vcenter/__tests__/integration.test.ts`

**Step 1: 扩展 mock server 支持 `/sdk`（SOAP）并先写断言**

- 让 `collect returns assets + relations` 在 Host 资产的 normalized 中包含：
  - `os.name="ESXi"`、`os.version="7.0.3"`、`os.fingerprint="20036589"`
  - `hardware.cpu_count=32`、`hardware.memory_bytes=274877906944`
  - `attributes.disk_total_bytes` 为预期值

**Step 2: 运行该 test 并确认失败**

Run: `bun run test plugins/vcenter/__tests__/integration.test.ts -t \"collect returns assets\"`  
Expected: FAIL（尚未接入 SOAP）。

---

### Task 4: 插件侧接入 SOAP（GREEN）

**Files:**

- Modify: `plugins/vcenter/index.ts`
- Modify: `plugins/vcenter/normalize.ts`
- Modify: `plugins/vcenter/client.ts`（如需共享 joinUrl/timeout 等）
- Modify: `plugins/vcenter/__tests__/normalize.test.ts`
- Test: `plugins/vcenter/__tests__/integration.test.ts`

**Step 1: 新增 SOAP client（RetrieveServiceContent/Login/RetrievePropertiesEx）**

在 `plugins/vcenter/soap.ts` 增加最小 HTTP 调用：

- SDK endpoint：基于 `endpoint` 自动补齐 `/sdk`
- Cookie 会话：Login 后取 `set-cookie`，后续请求带 `Cookie`
- 超时：30s
- 批量：`RetrievePropertiesEx` 一次拿全量 host 列表的字段（包含本地盘）

**Step 2: 修改 collect：不再调用 REST `getHostDetail`**

- `listHosts` 仍作为 inventory host id 来源
- 对每个 host 注入 `HostSoapDetails`（成功则补齐字段，失败则 warning 且字段缺失）

**Step 3: normalizeHost 映射新增字段**

输出 normalized（Host）：

- `os.name="ESXi"`
- `os.version=<soap_version>`
- `os.fingerprint=<soap_build>`（必采必落库；但 UI/搜索不使用）
- `hardware.cpu_count=<numCpuCores>`
- `hardware.memory_bytes=<memorySize>`
- `attributes.disk_total_bytes=<sum(localDisk capacities)>`
- CPU 明细（可选 attributes）：`cpu_model/cpu_mhz/cpu_packages/cpu_threads`

**Step 4: 运行插件测试**

Run:

- `bun run test plugins/vcenter/__tests__/normalize.test.ts`
- `bun run test plugins/vcenter/__tests__/integration.test.ts`

Expected: PASS

---

### Task 5: 列表 API/UI 对齐 Host 磁盘/OS 与搜索语义（TDD）

**Files:**

- Modify: `src/app/api/v1/assets/route.ts`
- Modify: `src/lib/assets/asset-list-query.ts`
- Test: `src/app/api/v1/assets/route.test.ts`
- Test: `src/lib/assets/asset-list-query.test.ts`（如不存在则新增）

**Step 1: 写失败测试（Host totalDiskBytes 取 attributes.disk_total_bytes）**

- 构造一个 host asset 的 canonical.fields.attributes.disk_total_bytes
- 断言 `GET /api/v1/assets` 返回的该项 `totalDiskBytes` 为该值（而非 hardware.disks 求和）

**Step 2: 写失败测试（Host os 不回退到 fingerprint/build）**

- host canonical：`os.name="ESXi"`, `os.fingerprint="20036589"`, version 缺失
- 断言返回 `os` 为 `null`（UI 展示 `-`），而不是 build

**Step 3: 写失败测试（q 不按 os.fingerprint 命中 Host，但 VM 仍保留 fingerprint fallback）**

- where 条件里：`os.fingerprint` 的 json path 过滤仅对 `assetType=vm` 生效

**Step 4: 最小实现并跑测试**

Run:

- `bun run test src/app/api/v1/assets/route.test.ts`
- `bun run test src/lib/assets/asset-list-query.test.ts`（或对应文件）

Expected: PASS

---

### Task 6: 文档同步（README + 设计文档）

**Files:**

- Modify: `README.md`
- Modify: `docs/design/asset-ledger-collector-reference.md`
- Modify: `docs/design/asset-ledger-api-spec.md`

**Step 1: 更新 vCenter collector reference**

- 说明 Host 侧：ESXi 版本/构建号、CPU/内存、本地盘总量走 SOAP（`/sdk` + `RetrievePropertiesEx`）
- 标注 `os.fingerprint`（build）本期不用于搜索/展示

**Step 2: 更新 API spec（q 搜索范围说明）**

- 保留 VM 的 fingerprint fallback
- 明确 Host 的 build 不纳入 q

**Step 3: README 增补**

- 简述 vCenter 集成对 `/sdk`（SOAP）的依赖与用途（Host 关键盘点字段来源）

---

### Task 7: 全量验证

Run:

- `bun run lint`
- `bun run format:check`
- `bun run type-check`
- `bun run test`

Expected: 全部通过
