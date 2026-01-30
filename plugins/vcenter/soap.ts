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

function collectObjectsWithLocalDisk(node: unknown, out: Array<Record<string, unknown>>) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) collectObjectsWithLocalDisk(item, out);
    return;
  }
  if (typeof node !== 'object') return;

  const record = node as Record<string, unknown>;
  if ('localDisk' in record) out.push(record);
  for (const value of Object.values(record)) collectObjectsWithLocalDisk(value, out);
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

function parseDiskTotalBytes(val: unknown): number | undefined {
  const candidates: Array<Record<string, unknown>> = [];
  collectObjectsWithLocalDisk(val, candidates);

  if (candidates.length === 0) return undefined;

  const localDisks: Array<Record<string, unknown>> = [];
  for (const disk of candidates) {
    const localFlag = toBooleanValue(disk.localDisk);
    if (localFlag === undefined) return undefined;
    if (localFlag) localDisks.push(disk);
  }
  // Host has disks we can classify but none are local disks: total = 0 bytes.
  if (localDisks.length === 0) return 0;

  let sum = 0;
  for (const disk of localDisks) {
    const bytes = parseCapacityBytes(disk.capacity);
    if (bytes === undefined) return undefined;
    sum += bytes;
  }

  return Number.isFinite(sum) && sum >= 0 ? sum : undefined;
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
        details.diskTotalBytes = parseDiskTotalBytes(val);
      } else if (name === 'config.network.vnic' || name === 'config.network.consoleVnic') {
        ipCandidates.push(parseHostIps(val));
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
  if (serviceContentRes.status < 200 || serviceContentRes.status >= 300) {
    throw makeHttpError({
      op: 'RetrieveServiceContent',
      status: serviceContentRes.status,
      bodyText: serviceContentRes.bodyText,
    });
  }
  const { sessionManager, propertyCollector } = parseRetrieveServiceContent(serviceContentRes.bodyText);

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
  if (loginRes.status < 200 || loginRes.status >= 300) {
    throw makeHttpError({ op: 'Login', status: loginRes.status, bodyText: loginRes.bodyText });
  }
  const cookie = extractCookie(loginRes.headers);
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
  ];

  const propSetXml = [
    `<vim25:type>HostSystem</vim25:type>`,
    ...pathSet.map((p) => `<vim25:pathSet>${p}</vim25:pathSet>`),
  ].join('');
  const objectSetXml = hostIds
    .map((id) => `<vim25:objectSet><vim25:obj type="HostSystem">${id}</vim25:obj></vim25:objectSet>`)
    .join('');

  const retrieveExRes = await soapPost({
    sdkEndpoint,
    timeoutMs,
    cookie,
    bodyXml: soapEnvelope(
      `<vim25:RetrievePropertiesEx>
        <vim25:_this type="PropertyCollector">${propertyCollector}</vim25:_this>
        <vim25:specSet>
          <vim25:propSet>${propSetXml}</vim25:propSet>
          ${objectSetXml}
        </vim25:specSet>
      </vim25:RetrievePropertiesEx>`,
    ),
  });
  if (retrieveExRes.status >= 200 && retrieveExRes.status < 300) {
    return parseRetrievePropertiesExHostResult(retrieveExRes.bodyText);
  }

  // Some old vSphere/vCenter deployments don't support RetrievePropertiesEx (vim25/2.5u2).
  // Fall back to RetrieveProperties when we can confidently detect this incompatibility.
  const faultString = parseSoapFaultString(retrieveExRes.bodyText);
  const faultLower = faultString?.toLowerCase();
  const exUnsupported =
    retrieveExRes.status === 500 &&
    faultLower?.includes('unable to resolve wsdl method name') &&
    faultLower.includes('retrievepropertiesex');
  if (exUnsupported) {
    const retrieveRes = await soapPost({
      sdkEndpoint,
      timeoutMs,
      cookie,
      bodyXml: soapEnvelope(
        `<vim25:RetrieveProperties>
          <vim25:_this type="PropertyCollector">${propertyCollector}</vim25:_this>
          <vim25:specSet>
            <vim25:propSet>${propSetXml}</vim25:propSet>
            ${objectSetXml}
          </vim25:specSet>
        </vim25:RetrieveProperties>`,
      ),
    });
    if (retrieveRes.status < 200 || retrieveRes.status >= 300) {
      throw makeHttpError({ op: 'RetrieveProperties', status: retrieveRes.status, bodyText: retrieveRes.bodyText });
    }
    return parseRetrievePropertiesHostResult(retrieveRes.bodyText);
  }

  throw makeHttpError({ op: 'RetrievePropertiesEx', status: retrieveExRes.status, bodyText: retrieveExRes.bodyText });
}
