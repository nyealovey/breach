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
  systemVendor?: string;
  systemModel?: string;
  ipAddresses?: string[];
  managementIp?: string;
};

import { XMLParser } from 'fast-xml-parser';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SOAP_DEBUG = toBooleanValue(process.env.ASSET_LEDGER_DEBUG) ?? false;

// DEBUG: 写入调试日志到文件
function debugLog(hostId: string, message: string, data?: unknown) {
  if (!SOAP_DEBUG) return;
  try {
    const logsDir = join(process.cwd(), 'logs');
    mkdirSync(logsDir, { recursive: true });
    const logFile = join(logsDir, `vcenter-soap-debug-${new Date().toISOString().slice(0, 10)}.log`);
    const payload = {
      ts: new Date().toISOString(),
      level: 'debug',
      component: 'vcenter.soap',
      host_id: hostId,
      message,
      ...(data !== undefined ? { data } : {}),
    };
    appendFileSync(logFile, `${JSON.stringify(payload)}\n`);
  } catch {
    // 忽略日志写入错误
  }
}

const SOAP_DEBUG_EXCERPT_LIMIT = 2000;

function excerpt(text: string, limit = SOAP_DEBUG_EXCERPT_LIMIT): string {
  return text.length > limit ? text.slice(0, limit) : text;
}

function summarizeValue(value: unknown, maxKeys = 50): Record<string, unknown> {
  if (value === null) return { type: 'null' };

  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      ...(value.length > 0 ? { first: summarizeValue(value[0], maxKeys) } : {}),
    };
  }

  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') return { type: 'string', length: value.length, excerpt: excerpt(value, 200) };
    return { type: typeof value };
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  return { type: 'object', key_count: keys.length, keys: keys.slice(0, maxKeys) };
}

const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false });

function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function parseSoapFaultString(xml: string): string | undefined {
  try {
    const parsed = parser.parse(xml) as Record<string, unknown>;
    const envelope = parsed.Envelope as Record<string, unknown> | undefined;
    const body = envelope?.Body as Record<string, unknown> | undefined;
    const fault = body?.Fault as Record<string, unknown> | undefined;
    return toStringValue(fault?.faultstring);
  } catch {
    return undefined;
  }
}

function toStringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function toNumberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return undefined;
}

function toBooleanValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  return undefined;
}

function isIPv4(ip: string): boolean {
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipv4Pattern.test(ip)) return false;

  // Ensure each octet is within 0-255.
  const parts = ip.split('.').map((part) => Number(part));
  return parts.length === 4 && parts.every((n) => Number.isFinite(n) && n >= 0 && n <= 255);
}

// 收集 SCSI 磁盘设备（lunType === "disk" 且有 capacity）
function collectScsiDisks(node: unknown, out: Array<Record<string, unknown>>) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) collectScsiDisks(item, out);
    return;
  }
  if (typeof node !== 'object') return;

  const record = node as Record<string, unknown>;
  // 匹配 lunType === "disk" 且有 capacity 的设备
  const lunType = toStringValue(record.lunType);
  if (lunType === 'disk' && 'capacity' in record) {
    out.push(record);
  }
  for (const value of Object.values(record)) collectScsiDisks(value, out);
}

function collectObjectsWithNvmeNamespace(node: unknown, out: Array<Record<string, unknown>>) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) collectObjectsWithNvmeNamespace(item, out);
    return;
  }
  if (typeof node !== 'object') return;

  const record = node as Record<string, unknown>;
  const hasBlockSize = 'blockSize' in record || 'block_size' in record;
  const hasCapacityInBlocks = 'capacityInBlocks' in record || 'capacity_in_blocks' in record;
  if (hasBlockSize && hasCapacityInBlocks) out.push(record);

  for (const value of Object.values(record)) collectObjectsWithNvmeNamespace(value, out);
}

type VirtualNicCandidate = {
  device?: string;
  portgroup?: string;
  ipAddress?: string;
};

function collectVirtualNicCandidates(node: unknown, out: VirtualNicCandidate[]) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) collectVirtualNicCandidates(item, out);
    return;
  }
  if (typeof node !== 'object') return;

  const record = node as Record<string, unknown>;
  const device = toStringValue(record.device);
  const portgroup = toStringValue(record.portgroup);

  const spec = record.spec && typeof record.spec === 'object' ? (record.spec as Record<string, unknown>) : undefined;
  const ip = spec?.ip && typeof spec.ip === 'object' ? (spec.ip as Record<string, unknown>) : undefined;
  const ipAddress = toStringValue(ip?.ipAddress ?? ip?.ip_address);

  const isVmkOrVswif = device ? /^vmk\d+$/i.test(device) || /^vswif\d+$/i.test(device) : false;
  if (isVmkOrVswif && ipAddress && isIPv4(ipAddress.trim())) {
    out.push({ device, portgroup, ipAddress: ipAddress.trim() });
  }

  for (const value of Object.values(record)) collectVirtualNicCandidates(value, out);
}

function scoreVirtualNicCandidate(c: VirtualNicCandidate): number {
  const device = (c.device ?? '').trim().toLowerCase();
  const portgroup = (c.portgroup ?? '').trim().toLowerCase();

  let score = 0;
  if (device === 'vmk0' || device === 'vswif0') score += 100;
  if (portgroup.includes('management')) score += 10;
  return score;
}

function parseHostIps(val: unknown): { ipAddresses?: string[]; managementIp?: string } {
  const candidates: VirtualNicCandidate[] = [];
  collectVirtualNicCandidates(val, candidates);

  const ipAddresses = Array.from(
    new Set(
      candidates
        .map((c) => c.ipAddress)
        .filter((ip): ip is string => typeof ip === 'string' && ip.trim().length > 0 && isIPv4(ip.trim())),
    ),
  );

  if (ipAddresses.length === 0) return {};

  const management = candidates
    .filter((c) => c.ipAddress && ipAddresses.includes(c.ipAddress))
    .sort((a, b) => scoreVirtualNicCandidate(b) - scoreVirtualNicCandidate(a))[0]?.ipAddress;

  return { ipAddresses, managementIp: management ?? ipAddresses[0] };
}

function parseCapacityBytes(capacity: unknown): number | undefined {
  if (!capacity || typeof capacity !== 'object') return undefined;
  const cap = capacity as Record<string, unknown>;

  const blockSize = toNumberValue(cap.blockSize);
  const block = toNumberValue(cap.block);
  if (blockSize !== undefined && block !== undefined) return blockSize * block;

  // Best-effort fallbacks for potential alternative shapes.
  const byteSize = toNumberValue(cap.byteSize);
  if (byteSize !== undefined) return byteSize;

  const bytes = toNumberValue(cap.bytes);
  if (bytes !== undefined) return bytes;

  return undefined;
}

// 计算 SCSI 磁盘总容量
// 根据实际 vCenter SOAP 响应，磁盘数据结构为：
// ScsiLun 数组，其中 lunType === "disk" 的设备有 capacity 对象
function parseDiskTotalBytes(val: unknown): number | undefined {
  const disks: Array<Record<string, unknown>> = [];
  collectScsiDisks(val, disks);

  if (disks.length === 0) return undefined;

  let sum = 0;
  for (const disk of disks) {
    const bytes = parseCapacityBytes(disk.capacity);
    if (bytes === undefined) continue; // 跳过无法解析容量的磁盘
    sum += bytes;
  }

  return Number.isFinite(sum) && sum >= 0 ? sum : undefined;
}

function parseNvmeTotalBytes(val: unknown): number | undefined {
  const candidates: Array<Record<string, unknown>> = [];
  collectObjectsWithNvmeNamespace(val, candidates);
  if (candidates.length === 0) return undefined;

  // Defensive de-dupe: some APIs may surface the same namespace multiple times in topology paths.
  const seen = new Set<string>();

  let sum = 0;
  for (const ns of candidates) {
    const key = toStringValue(ns.uuid ?? ns.id);
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }

    const blockSize = toNumberValue(ns.blockSize ?? ns.block_size);
    const capacityInBlocks = toNumberValue(ns.capacityInBlocks ?? ns.capacity_in_blocks);
    if (blockSize === undefined || capacityInBlocks === undefined) return undefined;

    const bytes = blockSize * capacityInBlocks;
    if (!Number.isFinite(bytes) || bytes < 0) return undefined;
    sum += bytes;
  }

  return Number.isFinite(sum) && sum >= 0 ? sum : undefined;
}

function addDiskTotalBytes(details: HostSoapDetails, bytes: number | undefined) {
  if (bytes === undefined) return;
  details.diskTotalBytes = (details.diskTotalBytes ?? 0) + bytes;
}

function toSdkEndpoint(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/, '');
  if (trimmed.endsWith('/sdk')) return trimmed;
  return `${trimmed}/sdk`;
}

function soapEnvelope(innerXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:vim25="urn:vim25">
  <soapenv:Body>
    ${innerXml}
  </soapenv:Body>
</soapenv:Envelope>`;
}

function makeHttpError(input: { op: string; status: number; bodyText: string }) {
  const err = new Error(`${input.op} failed with status ${input.status}`);
  (err as { status?: number; bodyText?: string }).status = input.status;
  (err as { status?: number; bodyText?: string }).bodyText = input.bodyText;
  return err;
}

async function soapPost(input: {
  sdkEndpoint: string;
  bodyXml: string;
  cookie?: string;
  timeoutMs: number;
}): Promise<{ status: number; headers: Headers; bodyText: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const res = await fetch(input.sdkEndpoint, {
      method: 'POST',
      headers: {
        'content-type': 'text/xml; charset=utf-8',
        ...(input.cookie ? { cookie: input.cookie } : {}),
      },
      body: input.bodyXml,
      signal: controller.signal,
    });
    const bodyText = await res.text();
    return { status: res.status, headers: res.headers, bodyText };
  } finally {
    clearTimeout(timeout);
  }
}

function parseRetrieveServiceContent(xml: string): { sessionManager: string; propertyCollector: string } {
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const envelope = parsed.Envelope as Record<string, unknown> | undefined;
  const body = envelope?.Body as Record<string, unknown> | undefined;

  const response = body?.RetrieveServiceContentResponse as Record<string, unknown> | undefined;
  const returnval = response?.returnval as Record<string, unknown> | undefined;

  const sessionManager = toStringValue(returnval?.sessionManager);
  const propertyCollector = toStringValue(returnval?.propertyCollector);
  if (!sessionManager || !propertyCollector) throw new Error('RetrieveServiceContent returned unexpected response');

  return { sessionManager, propertyCollector };
}

function extractCookie(headers: Headers): string | undefined {
  const setCookie = headers.get('set-cookie');
  if (!setCookie) return undefined;
  return setCookie.split(';')[0];
}

function parseHostSoapDetailsFromObjectContents(objects: unknown): Map<string, HostSoapDetails> {
  const out = new Map<string, HostSoapDetails>();

  for (const object of toArray(objects as unknown)) {
    if (!object || typeof object !== 'object') continue;
    const objRecord = object as Record<string, unknown>;

    const hostId = toStringValue(objRecord.obj);
    if (!hostId) continue;

    const details: HostSoapDetails = {};
    const ipCandidates: { ipAddresses?: string[]; managementIp?: string }[] = [];
    for (const propSet of toArray(objRecord.propSet as unknown)) {
      if (!propSet || typeof propSet !== 'object') continue;
      const prop = propSet as Record<string, unknown>;
      const name = toStringValue(prop.name);
      const val = prop.val;
      if (!name) continue;

      if (name === 'summary.config.product.version') {
        details.esxiVersion = toStringValue(val);
      } else if (name === 'summary.config.product.build') {
        details.esxiBuild = toStringValue(val);
      } else if (name === 'summary.hardware.numCpuCores') {
        details.cpuCores = toNumberValue(val);
      } else if (name === 'summary.hardware.memorySize') {
        details.memoryBytes = toNumberValue(val);
      } else if (name === 'summary.hardware.cpuModel') {
        details.cpuModel = toStringValue(val);
      } else if (name === 'summary.hardware.cpuMhz') {
        details.cpuMhz = toNumberValue(val);
      } else if (name === 'summary.hardware.numCpuPkgs') {
        details.cpuPackages = toNumberValue(val);
      } else if (name === 'summary.hardware.numCpuThreads') {
        details.cpuThreads = toNumberValue(val);
      } else if (name === 'hardware.systemInfo.vendor') {
        details.systemVendor = toStringValue(val);
      } else if (name === 'hardware.systemInfo.model') {
        details.systemModel = toStringValue(val);
      } else if (name === 'config.storageDevice.scsiLun') {
        const bytes = parseDiskTotalBytes(val);
        // DEBUG: 写入 scsiLun 原始数据 + 解析结果（用于排查不同 ESXi 版本的数据结构差异）
        debugLog(hostId, 'config.storageDevice.scsiLun', {
          shape: summarizeValue(val),
          disk_total_bytes: bytes,
          raw: val,
        });
        addDiskTotalBytes(details, bytes);
      } else if (name === 'config.storageDevice.nvmeTopology') {
        const bytes = parseNvmeTotalBytes(val);
        // DEBUG: 写入 nvmeTopology 原始数据 + 解析结果（用于排查不同 ESXi 版本的数据结构差异）
        debugLog(hostId, 'config.storageDevice.nvmeTopology', {
          shape: summarizeValue(val),
          disk_total_bytes: bytes,
          raw: val,
        });
        addDiskTotalBytes(details, bytes);
      } else if (name === 'config.network.vnic' || name === 'config.network.consoleVnic') {
        const parsed = parseHostIps(val);
        // DEBUG: 写入 vNIC 原始数据（探索可采集字段）+ 解析结果（IP/management IP）
        debugLog(hostId, name, { shape: summarizeValue(val), parsed, raw: val });
        ipCandidates.push(parsed);
      }
    }

    if (ipCandidates.length > 0) {
      const ipAddresses = Array.from(
        new Set(
          ipCandidates
            .flatMap((c) => c.ipAddresses ?? [])
            .map((ip) => ip.trim())
            .filter((ip) => ip.length > 0 && isIPv4(ip)),
        ),
      );
      if (ipAddresses.length > 0) details.ipAddresses = ipAddresses;

      const managementIp = ipCandidates
        .map((c) => c.managementIp)
        .find((ip) => typeof ip === 'string' && ip.length > 0);
      if (managementIp) details.managementIp = managementIp;
      else if (ipAddresses.length > 0) details.managementIp = ipAddresses[0];
    }

    out.set(hostId, details);

    debugLog(hostId, 'host.soap.details', {
      esxi_version: details.esxiVersion,
      esxi_build: details.esxiBuild,
      disk_total_bytes: details.diskTotalBytes,
      management_ip: details.managementIp,
      ip_addresses_count: details.ipAddresses?.length ?? 0,
    });
  }

  return out;
}

export function parseRetrievePropertiesExHostResult(xml: string): Map<string, HostSoapDetails> {
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const envelope = parsed.Envelope as Record<string, unknown> | undefined;
  const body = envelope?.Body as Record<string, unknown> | undefined;

  const response = body?.RetrievePropertiesExResponse as Record<string, unknown> | undefined;
  const returnval = response?.returnval as Record<string, unknown> | undefined;
  return parseHostSoapDetailsFromObjectContents(returnval?.objects);
}

export function parseRetrievePropertiesHostResult(xml: string): Map<string, HostSoapDetails> {
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const envelope = parsed.Envelope as Record<string, unknown> | undefined;
  const body = envelope?.Body as Record<string, unknown> | undefined;

  const response = body?.RetrievePropertiesResponse as Record<string, unknown> | undefined;
  return parseHostSoapDetailsFromObjectContents(response?.returnval);
}

export async function collectHostSoapDetails(input: {
  endpoint: string;
  username: string;
  password: string;
  hostIds: string[];
  timeoutMs?: number;
}): Promise<Map<string, HostSoapDetails>> {
  const hostIds = input.hostIds.filter((id) => id.trim().length > 0);
  if (hostIds.length === 0) return new Map();

  const timeoutMs = input.timeoutMs ?? 30_000;
  const sdkEndpoint = toSdkEndpoint(input.endpoint);

  debugLog('global', 'collectHostSoapDetails.start', {
    sdk_endpoint: sdkEndpoint,
    timeout_ms: timeoutMs,
    host_ids_count: hostIds.length,
    host_ids_sample: hostIds.slice(0, 10),
  });

  // 1) Retrieve service content (SessionManager + PropertyCollector).
  const serviceContentRes = await soapPost({
    sdkEndpoint,
    timeoutMs,
    bodyXml: soapEnvelope(
      `<vim25:RetrieveServiceContent>
        <vim25:_this type="ServiceInstance">ServiceInstance</vim25:_this>
      </vim25:RetrieveServiceContent>`,
    ),
  });
  debugLog('global', 'RetrieveServiceContent.response', {
    status: serviceContentRes.status,
    body_length: serviceContentRes.bodyText.length,
    body_excerpt: excerpt(serviceContentRes.bodyText),
  });
  if (serviceContentRes.status < 200 || serviceContentRes.status >= 300) {
    throw makeHttpError({
      op: 'RetrieveServiceContent',
      status: serviceContentRes.status,
      bodyText: serviceContentRes.bodyText,
    });
  }
  const { sessionManager, propertyCollector } = parseRetrieveServiceContent(serviceContentRes.bodyText);
  debugLog('global', 'RetrieveServiceContent.parsed', {
    session_manager: sessionManager,
    property_collector: propertyCollector,
  });

  // 2) Login and store session cookie.
  const loginRes = await soapPost({
    sdkEndpoint,
    timeoutMs,
    bodyXml: soapEnvelope(
      `<vim25:Login>
        <vim25:_this type="SessionManager">${sessionManager}</vim25:_this>
        <vim25:userName>${input.username}</vim25:userName>
        <vim25:password>${input.password}</vim25:password>
      </vim25:Login>`,
    ),
  });
  debugLog('global', 'Login.response', {
    status: loginRes.status,
    body_length: loginRes.bodyText.length,
    body_excerpt: excerpt(loginRes.bodyText),
  });
  if (loginRes.status < 200 || loginRes.status >= 300) {
    throw makeHttpError({ op: 'Login', status: loginRes.status, bodyText: loginRes.bodyText });
  }
  const cookie = extractCookie(loginRes.headers);
  debugLog('global', 'Login.cookie', { has_cookie: !!cookie });
  if (!cookie) throw new Error('Login did not return session cookie');

  // 3) Retrieve host properties in one batch.
  const pathSet = [
    'summary.config.product.version',
    'summary.config.product.build',
    'summary.hardware.numCpuCores',
    'summary.hardware.memorySize',
    'summary.hardware.cpuModel',
    'summary.hardware.cpuMhz',
    'summary.hardware.numCpuPkgs',
    'summary.hardware.numCpuThreads',
    'hardware.systemInfo.vendor',
    'hardware.systemInfo.model',
    'config.network.vnic',
    'config.network.consoleVnic',
    'config.storageDevice.scsiLun',
    'config.storageDevice.nvmeTopology',
  ];

  const pathSetNoNvme = pathSet.filter((p) => p !== 'config.storageDevice.nvmeTopology');

  const buildPropSetXml = (paths: string[]) =>
    [`<vim25:type>HostSystem</vim25:type>`, ...paths.map((p) => `<vim25:pathSet>${p}</vim25:pathSet>`)].join('');

  const propSetXml = buildPropSetXml(pathSet);
  const propSetNoNvmeXml = buildPropSetXml(pathSetNoNvme);
  const objectSetXml = hostIds
    .map((id) => `<vim25:objectSet><vim25:obj type="HostSystem">${id}</vim25:obj></vim25:objectSet>`)
    .join('');

  const retrievePropertiesEx = async (propXml: string) =>
    soapPost({
      sdkEndpoint,
      timeoutMs,
      cookie,
      bodyXml: soapEnvelope(
        `<vim25:RetrievePropertiesEx>
          <vim25:_this type="PropertyCollector">${propertyCollector}</vim25:_this>
          <vim25:specSet>
            <vim25:propSet>${propXml}</vim25:propSet>
            ${objectSetXml}
          </vim25:specSet>
        </vim25:RetrievePropertiesEx>`,
      ),
    });

  const retrieveProperties = async (propXml: string) =>
    soapPost({
      sdkEndpoint,
      timeoutMs,
      cookie,
      bodyXml: soapEnvelope(
        `<vim25:RetrieveProperties>
          <vim25:_this type="PropertyCollector">${propertyCollector}</vim25:_this>
          <vim25:specSet>
            <vim25:propSet>${propXml}</vim25:propSet>
            ${objectSetXml}
          </vim25:specSet>
        </vim25:RetrieveProperties>`,
      ),
    });

  debugLog('global', 'RetrievePropertiesEx.request', { host_ids_count: hostIds.length, path_set: pathSet });
  const retrieveExRes = await retrievePropertiesEx(propSetXml);
  debugLog('global', 'RetrievePropertiesEx.response', {
    status: retrieveExRes.status,
    body_length: retrieveExRes.bodyText.length,
    body_excerpt: excerpt(retrieveExRes.bodyText),
  });
  if (retrieveExRes.status >= 200 && retrieveExRes.status < 300)
    return (() => {
      const details = parseRetrievePropertiesExHostResult(retrieveExRes.bodyText);
      debugLog('global', 'collectHostSoapDetails.success', {
        op: 'RetrievePropertiesEx',
        hosts_requested: hostIds.length,
        hosts_returned: details.size,
        missing_host_ids_sample: hostIds.filter((id) => !details.has(id)).slice(0, 10),
        hosts_missing_disk_total: Array.from(details.entries())
          .filter(([, d]) => d.diskTotalBytes === undefined)
          .map(([id]) => id)
          .slice(0, 10),
      });
      return details;
    })();

  // Some old vSphere/vCenter deployments don't support RetrievePropertiesEx (vim25/2.5u2).
  // Fall back to RetrieveProperties when we can confidently detect this incompatibility.
  const faultString = parseSoapFaultString(retrieveExRes.bodyText);
  const faultLower = faultString?.toLowerCase();
  const exUnsupported =
    retrieveExRes.status === 500 &&
    faultLower?.includes('unable to resolve wsdl method name') &&
    faultLower.includes('retrievepropertiesex');
  debugLog('global', 'RetrievePropertiesEx.fault', {
    ex_unsupported: exUnsupported,
    fault_string_excerpt: faultString ? excerpt(faultString) : undefined,
  });
  if (exUnsupported) {
    debugLog('global', 'RetrieveProperties.request', { host_ids_count: hostIds.length, path_set: pathSet });
    const retrieveRes = await retrieveProperties(propSetXml);
    debugLog('global', 'RetrieveProperties.response', {
      status: retrieveRes.status,
      body_length: retrieveRes.bodyText.length,
      body_excerpt: excerpt(retrieveRes.bodyText),
    });
    if (retrieveRes.status >= 200 && retrieveRes.status < 300)
      return (() => {
        const details = parseRetrievePropertiesHostResult(retrieveRes.bodyText);
        debugLog('global', 'collectHostSoapDetails.success', {
          op: 'RetrieveProperties',
          hosts_requested: hostIds.length,
          hosts_returned: details.size,
          missing_host_ids_sample: hostIds.filter((id) => !details.has(id)).slice(0, 10),
          hosts_missing_disk_total: Array.from(details.entries())
            .filter(([, d]) => d.diskTotalBytes === undefined)
            .map(([id]) => id)
            .slice(0, 10),
        });
        return details;
      })();

    // Back-compat: nvmeTopology is unavailable on older stacks; retry without it.
    if (pathSetNoNvme.length !== pathSet.length) {
      debugLog('global', 'RetrieveProperties.retry_no_nvme.request', {
        host_ids_count: hostIds.length,
        path_set: pathSetNoNvme,
      });
      const retryRes = await retrieveProperties(propSetNoNvmeXml);
      debugLog('global', 'RetrieveProperties.retry_no_nvme.response', {
        status: retryRes.status,
        body_length: retryRes.bodyText.length,
        body_excerpt: excerpt(retryRes.bodyText),
      });
      if (retryRes.status >= 200 && retryRes.status < 300)
        return (() => {
          const details = parseRetrievePropertiesHostResult(retryRes.bodyText);
          debugLog('global', 'collectHostSoapDetails.success', {
            op: 'RetrieveProperties (no nvmeTopology)',
            hosts_requested: hostIds.length,
            hosts_returned: details.size,
            missing_host_ids_sample: hostIds.filter((id) => !details.has(id)).slice(0, 10),
            hosts_missing_disk_total: Array.from(details.entries())
              .filter(([, d]) => d.diskTotalBytes === undefined)
              .map(([id]) => id)
              .slice(0, 10),
          });
          return details;
        })();
      throw makeHttpError({ op: 'RetrieveProperties', status: retryRes.status, bodyText: retryRes.bodyText });
    }

    throw makeHttpError({ op: 'RetrieveProperties', status: retrieveRes.status, bodyText: retrieveRes.bodyText });
  }

  // Back-compat: nvmeTopology is unavailable on older stacks; retry without it.
  if (pathSetNoNvme.length !== pathSet.length) {
    debugLog('global', 'RetrievePropertiesEx.retry_no_nvme.request', {
      host_ids_count: hostIds.length,
      path_set: pathSetNoNvme,
    });
    const retryRes = await retrievePropertiesEx(propSetNoNvmeXml);
    debugLog('global', 'RetrievePropertiesEx.retry_no_nvme.response', {
      status: retryRes.status,
      body_length: retryRes.bodyText.length,
      body_excerpt: excerpt(retryRes.bodyText),
    });
    if (retryRes.status >= 200 && retryRes.status < 300)
      return (() => {
        const details = parseRetrievePropertiesExHostResult(retryRes.bodyText);
        debugLog('global', 'collectHostSoapDetails.success', {
          op: 'RetrievePropertiesEx (no nvmeTopology)',
          hosts_requested: hostIds.length,
          hosts_returned: details.size,
          missing_host_ids_sample: hostIds.filter((id) => !details.has(id)).slice(0, 10),
          hosts_missing_disk_total: Array.from(details.entries())
            .filter(([, d]) => d.diskTotalBytes === undefined)
            .map(([id]) => id)
            .slice(0, 10),
        });
        return details;
      })();
    throw makeHttpError({ op: 'RetrievePropertiesEx', status: retryRes.status, bodyText: retryRes.bodyText });
  }

  throw makeHttpError({ op: 'RetrievePropertiesEx', status: retrieveExRes.status, bodyText: retrieveExRes.bodyText });
}
