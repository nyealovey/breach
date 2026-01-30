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

import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false });

function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
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
  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return undefined;
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

  const localDisks = candidates.filter((d) => toBooleanValue(d.localDisk) === true);
  if (localDisks.length === 0) return undefined;

  let sum = 0;
  for (const disk of localDisks) {
    const bytes = parseCapacityBytes(disk.capacity);
    if (bytes === undefined) return undefined;
    sum += bytes;
  }

  return Number.isFinite(sum) && sum > 0 ? sum : undefined;
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

export function parseRetrievePropertiesExHostResult(xml: string): Map<string, HostSoapDetails> {
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const envelope = parsed.Envelope as Record<string, unknown> | undefined;
  const body = envelope?.Body as Record<string, unknown> | undefined;

  const response = body?.RetrievePropertiesExResponse as Record<string, unknown> | undefined;
  const returnval = response?.returnval as Record<string, unknown> | undefined;
  const objects = toArray(returnval?.objects as unknown);

  const out = new Map<string, HostSoapDetails>();
  for (const object of objects) {
    if (!object || typeof object !== 'object') continue;
    const objRecord = object as Record<string, unknown>;

    const hostId = toStringValue(objRecord.obj);
    if (!hostId) continue;

    const details: HostSoapDetails = {};
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
      } else if (name === 'config.storageDevice.scsiLun') {
        details.diskTotalBytes = parseDiskTotalBytes(val);
      }
    }

    out.set(hostId, details);
  }

  return out;
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
    'config.storageDevice.scsiLun',
  ];

  const propSetXml = [
    `<vim25:type>HostSystem</vim25:type>`,
    ...pathSet.map((p) => `<vim25:pathSet>${p}</vim25:pathSet>`),
  ].join('');
  const objectSetXml = hostIds
    .map((id) => `<vim25:objectSet><vim25:obj type="HostSystem">${id}</vim25:obj></vim25:objectSet>`)
    .join('');

  const retrieveRes = await soapPost({
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
  if (retrieveRes.status < 200 || retrieveRes.status >= 300) {
    throw makeHttpError({ op: 'RetrievePropertiesEx', status: retrieveRes.status, bodyText: retrieveRes.bodyText });
  }

  return parseRetrievePropertiesExHostResult(retrieveRes.bodyText);
}
