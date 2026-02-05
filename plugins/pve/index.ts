#!/usr/bin/env bun

import { createPveAuth, pveGet } from './client';
import { normalizeCluster, normalizeHost, normalizeVm } from './normalize';
import type { CollectorError, CollectorRequestV1, CollectorResponseV1 } from './types';

type PowerState = 'poweredOn' | 'poweredOff' | 'suspended';

function makeResponse(partial: Partial<CollectorResponseV1>): CollectorResponseV1 {
  return {
    schema_version: 'collector-response-v1',
    assets: [],
    relations: [],
    stats: { assets: 0, relations: 0, inventory_complete: false, warnings: [] },
    errors: [],
    ...partial,
  };
}

async function readStdinJson(): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(text);
}

function toPveError(err: unknown, stage: string): CollectorError {
  const status = typeof err === 'object' && err && 'status' in err ? (err as { status?: number }).status : undefined;
  const bodyText =
    typeof err === 'object' && err && 'bodyText' in err ? (err as { bodyText?: string }).bodyText : undefined;

  const cause = err instanceof Error ? err.message : String(err);
  const lower = cause.toLowerCase();

  if (status === 401) {
    return {
      code: 'PVE_AUTH_FAILED',
      category: 'auth',
      message: 'authentication failed',
      retryable: false,
      redacted_context: {
        stage,
        ...(bodyText ? { body_excerpt: bodyText.slice(0, 500) } : {}),
        cause,
      },
    };
  }
  if (status === 403) {
    return {
      code: 'PVE_PERMISSION_DENIED',
      category: 'permission',
      message: 'permission denied',
      retryable: false,
      redacted_context: {
        stage,
        ...(bodyText ? { body_excerpt: bodyText.slice(0, 500) } : {}),
        cause,
      },
    };
  }
  if (status === 429) {
    return {
      code: 'PVE_RATE_LIMIT',
      category: 'rate_limit',
      message: 'rate limited',
      retryable: true,
      redacted_context: {
        stage,
        ...(bodyText ? { body_excerpt: bodyText.slice(0, 500) } : {}),
        cause,
      },
    };
  }

  // Config/credential issues (fail-fast; not retryable)
  if (
    lower.includes('unsupported credential payload') ||
    lower.includes('missing api_token_id') ||
    lower.includes('missing api_token_secret') ||
    lower.includes('missing username') ||
    lower.includes('missing password')
  ) {
    return {
      code: 'PVE_CONFIG_INVALID',
      category: 'config',
      message: 'invalid pve credential/config',
      retryable: false,
      redacted_context: { stage, cause },
    };
  }

  // Parse/shape issues (fail-fast; not retryable)
  if (lower.includes('invalid json') || lower.includes('unexpected response')) {
    return {
      code: 'PVE_PARSE_ERROR',
      category: 'parse',
      message: 'pve response parse error',
      retryable: false,
      redacted_context: {
        stage,
        ...(status ? { status } : {}),
        ...(bodyText ? { body_excerpt: bodyText.slice(0, 500) } : {}),
        cause,
      },
    };
  }

  const tlsLike = cause.toLowerCase().includes('certificate') || cause.toLowerCase().includes('tls');
  return {
    code: tlsLike ? 'PVE_TLS_ERROR' : 'PVE_NETWORK_ERROR',
    category: 'network',
    message: tlsLike ? 'tls error' : 'pve request failed',
    retryable: !tlsLike,
    redacted_context: {
      stage,
      ...(status ? { status } : {}),
      ...(bodyText ? { body_excerpt: bodyText.slice(0, 500) } : {}),
      cause,
    },
  };
}

function clampPositiveInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0) return value;
  return fallback;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const s = typeof v === 'string' ? v.trim() : '';
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function isIPv4(input: string): boolean {
  const s = input.trim();
  const parts = s.split('.');
  if (parts.length !== 4) return false;
  for (const p of parts) {
    if (p.length === 0 || p.length > 3) return false;
    if (!/^\d+$/.test(p)) return false;
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return false;
  }
  return true;
}

function normalizeMaybeCidrIp(value: string): string {
  const s = value.trim();
  const idx = s.indexOf('/');
  return idx >= 0 ? s.slice(0, idx).trim() : s;
}

function isUselessIp(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '0.0.0.0';
}

function extractNodeIpInfo(network: unknown): { ip_addresses: string[]; management_ip?: string } {
  if (!Array.isArray(network)) return { ip_addresses: [] };

  const candidates: Array<{ iface: string; ip: string }> = [];

  for (const row of network) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const obj = row as Record<string, unknown>;
    const iface =
      typeof obj.iface === 'string' ? obj.iface.trim() : typeof obj.name === 'string' ? obj.name.trim() : '';
    const address =
      typeof obj.address === 'string' ? obj.address : typeof obj.address4 === 'string' ? obj.address4 : '';
    const ip = normalizeMaybeCidrIp(address);
    if (!iface || !ip || !isIPv4(ip) || isUselessIp(ip)) continue;
    candidates.push({ iface, ip });
  }

  const preferred = candidates.find((c) => c.iface === 'vmbr0')?.ip ?? null;
  const ip_addresses = uniqueStrings(candidates.map((c) => c.ip));
  const management_ip = preferred ?? ip_addresses[0];

  return { ip_addresses, management_ip: management_ip && isIPv4(management_ip) ? management_ip : undefined };
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function extractNodeDatastores(storage: unknown): Array<{ name: string; capacity_bytes: number }> {
  if (!Array.isArray(storage)) return [];
  const out: Array<{ name: string; capacity_bytes: number }> = [];
  for (const row of storage) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const obj = row as Record<string, unknown>;
    const name = typeof obj.storage === 'string' ? obj.storage.trim() : '';
    const total = toFiniteNumber(obj.total);
    if (!name || total === undefined || total < 0) continue;
    out.push({ name, capacity_bytes: Math.trunc(total) });
  }
  return out;
}

function parseSizeBytes(value: string): number | undefined {
  const s = value.trim();
  const m = /^(\d+(?:\.\d+)?)([KMGTPE]?)(?:i?B)?$/i.exec(s);
  if (!m) return undefined;
  const num = Number(m[1]);
  if (!Number.isFinite(num) || num < 0) return undefined;
  const unit = (m[2] ?? '').toUpperCase();
  const pow =
    unit === 'K' ? 1 : unit === 'M' ? 2 : unit === 'G' ? 3 : unit === 'T' ? 4 : unit === 'P' ? 5 : unit === 'E' ? 6 : 0;
  const bytes = num * 1024 ** pow;
  if (!Number.isFinite(bytes) || bytes < 0) return undefined;
  const int = Math.trunc(bytes);
  return Number.isSafeInteger(int) ? int : undefined;
}

function parseDiskSizeFromConfigValue(value: string): number | undefined {
  // Typical PVE syntax: "... ,size=32G,..." or "size=8G"
  const parts = value.split(',').map((p) => p.trim());
  const sizePart = parts.find((p) => p.toLowerCase().startsWith('size='));
  if (!sizePart) return undefined;
  const raw = sizePart.slice('size='.length).trim();
  return parseSizeBytes(raw);
}

function parseVmDisksFromConfig(input: {
  type: 'qemu' | 'lxc';
  config: unknown;
}): Array<{ name?: string; size_bytes?: number }> {
  if (!input.config || typeof input.config !== 'object' || Array.isArray(input.config)) return [];
  const cfg = input.config as Record<string, unknown>;

  const out: Array<{ name?: string; size_bytes?: number }> = [];

  const shouldIncludeKey = (key: string) => {
    if (input.type === 'qemu') {
      return /^(scsi|virtio|sata|ide)\d+$/.test(key) || key === 'efidisk0';
    }
    // lxc
    return key === 'rootfs' || /^mp\d+$/.test(key);
  };

  for (const [key, rawValue] of Object.entries(cfg)) {
    if (!shouldIncludeKey(key)) continue;
    if (typeof rawValue !== 'string') continue;
    const sizeBytes = parseDiskSizeFromConfigValue(rawValue);
    if (sizeBytes === undefined) continue;
    out.push({ name: key, size_bytes: sizeBytes });
  }

  return out;
}

function normalizeMacAddress(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  // Common formats:
  // - aa:bb:cc:dd:ee:ff
  // - aa-bb-cc-dd-ee-ff
  // - aabbccddeeff
  const hexOnly = lower.replace(/[^0-9a-f]/g, '');
  if (hexOnly.length === 12 && /^[0-9a-f]{12}$/.test(hexOnly)) {
    return hexOnly.match(/.{2}/g)!.join(':');
  }

  const normalized = lower.replace(/-/g, ':');
  if (/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(normalized)) return normalized;

  return null;
}

function parseVmMacsFromConfig(input: { type: 'qemu' | 'lxc'; config: unknown }): string[] {
  if (!input.config || typeof input.config !== 'object' || Array.isArray(input.config)) return [];
  const cfg = input.config as Record<string, unknown>;

  const out: string[] = [];
  for (const [key, rawValue] of Object.entries(cfg)) {
    if (!/^net\d+$/.test(key)) continue;
    if (typeof rawValue !== 'string') continue;

    // Typical formats:
    // - qemu: net0 = "virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0,..."
    // - lxc:  net0 = "name=eth0,bridge=vmbr0,hwaddr=AA:BB:CC:DD:EE:FF,..."
    const tokens = rawValue.split(',').map((t) => t.trim());
    for (const t of tokens) {
      const idx = t.indexOf('=');
      if (idx < 0) continue;
      const k = t.slice(0, idx).trim().toLowerCase();
      const v = t.slice(idx + 1).trim();

      // Filter known non-MAC keys to avoid accidental matches.
      if (
        k === 'bridge' ||
        k === 'tag' ||
        k === 'trunks' ||
        k === 'firewall' ||
        k === 'rate' ||
        k === 'mtu' ||
        k === 'queues' ||
        k === 'link_down' ||
        k === 'name' ||
        k === 'type' ||
        k === 'gw' ||
        k === 'gw6' ||
        k === 'ip' ||
        k === 'ip6'
      ) {
        continue;
      }

      const mac = normalizeMacAddress(v);
      if (mac) out.push(mac);
    }
  }

  return uniqueStrings(out);
}

function extractVmHostnameFromConfig(input: { type: 'qemu' | 'lxc'; config: unknown }): string | undefined {
  if (input.type !== 'lxc') return undefined;
  if (!input.config || typeof input.config !== 'object' || Array.isArray(input.config)) return undefined;
  const cfg = input.config as Record<string, unknown>;
  const raw = typeof cfg.hostname === 'string' ? cfg.hostname.trim() : '';
  return raw.length > 0 ? raw : undefined;
}

function extractVmIpFromGuestAgent(payload: unknown): string[] {
  const ifacesRaw = (() => {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    const obj = payload as Record<string, unknown>;
    const candidates = [obj.result, obj.return, obj.interfaces, obj['network-interfaces'], obj['network_interfaces']];
    for (const c of candidates) {
      if (Array.isArray(c)) return c;
    }
    return null;
  })();

  if (!Array.isArray(ifacesRaw)) return [];
  const ips: string[] = [];

  for (const iface of ifacesRaw) {
    if (!iface || typeof iface !== 'object' || Array.isArray(iface)) continue;
    const obj = iface as Record<string, unknown>;
    const addrs =
      (obj['ip-addresses'] as unknown) ??
      (obj.ip_addresses as unknown) ??
      (obj.ipAddresses as unknown) ??
      (obj.addresses as unknown);
    if (!Array.isArray(addrs)) continue;

    for (const addr of addrs) {
      if (!addr || typeof addr !== 'object' || Array.isArray(addr)) continue;
      const a = addr as Record<string, unknown>;
      const ipRaw =
        (a['ip-address'] as unknown) ?? (a.ip_address as unknown) ?? (a.ipAddress as unknown) ?? (a.address as unknown);
      const typeRaw = (a['ip-address-type'] as unknown) ?? (a.ip_address_type as unknown) ?? (a.type as unknown);

      const ipText = typeof ipRaw === 'string' ? normalizeMaybeCidrIp(ipRaw) : '';
      if (!ipText || !isIPv4(ipText) || isUselessIp(ipText)) continue;

      const typeText = typeof typeRaw === 'string' ? typeRaw.trim().toLowerCase() : '';
      const isV4 = typeText ? typeText.includes('ipv4') || typeText === 'v4' : true;
      if (!isV4) continue;

      ips.push(ipText);
    }
  }

  return uniqueStrings(ips);
}

function mapHostPowerStateFromOnline(online: unknown): PowerState | undefined {
  if (online === 1 || online === true) return 'poweredOn';
  if (online === 0 || online === false) return 'poweredOff';
  return undefined;
}

function shouldFailRelations(vmCount: number, runsOnCount: number): boolean {
  if (vmCount === 0) return false;
  return runsOnCount === 0;
}

async function healthcheck(request: CollectorRequestV1): Promise<{ response: CollectorResponseV1; exitCode: number }> {
  const cfg = request.source.config;
  const endpoint = cfg.endpoint;
  const tlsVerify = cfg.tls_verify ?? true;
  const timeoutMs = cfg.timeout_ms ?? 60_000;

  try {
    const auth = await createPveAuth({ endpoint, tlsVerify, timeoutMs, credential: request.source.credential });

    // Minimal permission baseline for inventory enumeration.
    await pveGet({ endpoint, path: '/api2/json/version', authHeaders: auth.headers, tlsVerify, timeoutMs });

    const nodes = await pveGet<Array<{ node: string }>>({
      endpoint,
      path: '/api2/json/nodes',
      authHeaders: auth.headers,
      tlsVerify,
      timeoutMs,
    });

    const firstNode = nodes.find((n) => typeof n?.node === 'string' && n.node.trim().length > 0)?.node;
    if (firstNode) {
      await pveGet({
        endpoint,
        path: `/api2/json/nodes/${encodeURIComponent(firstNode)}/qemu`,
        authHeaders: auth.headers,
        tlsVerify,
        timeoutMs,
      });
    }

    return { response: makeResponse({ errors: [] }), exitCode: 0 };
  } catch (err) {
    return { response: makeResponse({ errors: [toPveError(err, 'healthcheck')] }), exitCode: 1 };
  }
}

async function detect(request: CollectorRequestV1): Promise<{ response: CollectorResponseV1; exitCode: number }> {
  const cfg = request.source.config;
  const endpoint = cfg.endpoint;
  const tlsVerify = cfg.tls_verify ?? true;
  const timeoutMs = cfg.timeout_ms ?? 60_000;

  try {
    const auth = await createPveAuth({ endpoint, tlsVerify, timeoutMs, credential: request.source.credential });

    const version = (await pveGet<Record<string, unknown>>({
      endpoint,
      path: '/api2/json/version',
      authHeaders: auth.headers,
      tlsVerify,
      timeoutMs,
    })) as any;

    const versionString = typeof version?.version === 'string' ? version.version : null;

    // Best-effort: cluster detection.
    let clusterName: string | null = null;
    try {
      const status = await pveGet<Array<Record<string, unknown>>>({
        endpoint,
        path: '/api2/json/cluster/status',
        authHeaders: auth.headers,
        tlsVerify,
        timeoutMs,
      });
      const clusterRow = status.find((row) => (row.type as unknown) === 'cluster') ?? null;
      clusterName = typeof clusterRow?.name === 'string' ? clusterRow.name : null;
    } catch {
      // ignore
    }

    const scopeDetected = clusterName ? 'cluster' : 'standalone';
    const configuredScope = cfg.scope ?? 'auto';
    const driver = `pve-${configuredScope}@v1`;

    return {
      response: makeResponse({
        detect: {
          target_version: versionString ?? 'unknown',
          capabilities: {
            scope_detected: scopeDetected,
            ...(clusterName ? { cluster_name: clusterName } : {}),
          },
          driver,
          recommended_scope: scopeDetected,
        },
        errors: [],
      }),
      exitCode: 0,
    };
  } catch (err) {
    return { response: makeResponse({ errors: [toPveError(err, 'detect')] }), exitCode: 1 };
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  const queue = items.slice();

  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item === undefined) return;
      out.push(await fn(item));
    }
  });

  await Promise.all(workers);
  return out;
}

type WarningIssue = {
  code: string;
  category: string;
  message: string;
  retryable?: boolean;
  redacted_context?: Record<string, unknown>;
};

function createWarningCollector(options?: { sampleLimitPerCode?: number }) {
  const sampleLimit = clampPositiveInt(options?.sampleLimitPerCode, 10);
  const buckets = new Map<string, { total: number; samples: WarningIssue[] }>();

  const record = (issue: WarningIssue) => {
    const key = issue.code.trim();
    if (!key) return;
    const bucket = buckets.get(key) ?? { total: 0, samples: [] };
    bucket.total += 1;
    if (bucket.samples.length < sampleLimit) bucket.samples.push(issue);
    buckets.set(key, bucket);
  };

  const flush = (): WarningIssue[] => {
    const out: WarningIssue[] = [];
    for (const [code, bucket] of buckets.entries()) {
      out.push(...bucket.samples);
      if (bucket.total > bucket.samples.length) {
        out.push({
          code,
          category: bucket.samples[0]?.category ?? 'unknown',
          message: 'more occurrences omitted',
          redacted_context: { occurrences_count: bucket.total, sample_count: bucket.samples.length },
        });
      }
    }
    out.sort((a, b) => a.code.localeCompare(b.code));
    return out;
  };

  return { record, flush };
}

async function collect(request: CollectorRequestV1): Promise<{ response: CollectorResponseV1; exitCode: number }> {
  const cfg = request.source.config;
  const endpoint = cfg.endpoint;
  const tlsVerify = cfg.tls_verify ?? true;
  const timeoutMs = cfg.timeout_ms ?? 60_000;
  const maxParallelNodes = clampPositiveInt(cfg.max_parallel_nodes, 5);
  const configuredScope = cfg.scope ?? 'auto';
  const warningsCollector = createWarningCollector({ sampleLimitPerCode: 10 });

  try {
    const auth = await createPveAuth({ endpoint, tlsVerify, timeoutMs, credential: request.source.credential });

    const version = (await pveGet<Record<string, unknown>>({
      endpoint,
      path: '/api2/json/version',
      authHeaders: auth.headers,
      tlsVerify,
      timeoutMs,
    })) as any;
    const versionString = typeof version?.version === 'string' ? version.version : null;

    // Best-effort: cluster discovery + host online states (for host power_state mapping).
    let clusterName: string | null = null;
    const hostPowerByNode = new Map<string, PowerState>();
    try {
      const status = await pveGet<Array<Record<string, unknown>>>({
        endpoint,
        path: '/api2/json/cluster/status',
        authHeaders: auth.headers,
        tlsVerify,
        timeoutMs,
      });
      const clusterRow = status.find((row) => (row.type as unknown) === 'cluster') ?? null;
      clusterName = typeof clusterRow?.name === 'string' ? clusterRow.name : null;

      for (const row of status) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
        const type = (row as Record<string, unknown>).type;
        if (type !== 'node') continue;
        const name =
          typeof (row as Record<string, unknown>).name === 'string'
            ? ((row as Record<string, unknown>).name as string).trim()
            : typeof (row as Record<string, unknown>).id === 'string'
              ? ((row as Record<string, unknown>).id as string).trim()
              : '';
        if (!name) continue;
        const online = (row as Record<string, unknown>).online;
        const power = mapHostPowerStateFromOnline(online);
        if (power) hostPowerByNode.set(name, power);
      }
    } catch {
      // ignore
    }

    const clusterMode = configuredScope !== 'standalone' && !!clusterName;

    const nodes = await pveGet<Array<{ node: string }>>({
      endpoint,
      path: '/api2/json/nodes',
      authHeaders: auth.headers,
      tlsVerify,
      timeoutMs,
    });

    const nodeNames = nodes.map((n) => (typeof n?.node === 'string' ? n.node.trim() : '')).filter((n) => n.length > 0);

    const hostDetails = await mapLimit(nodeNames, maxParallelNodes, async (node) => {
      const [status, network, storage] = await Promise.all([
        pveGet<unknown>({
          endpoint,
          path: `/api2/json/nodes/${encodeURIComponent(node)}/status`,
          authHeaders: auth.headers,
          tlsVerify,
          timeoutMs,
        }).catch(() => null),
        pveGet<unknown>({
          endpoint,
          path: `/api2/json/nodes/${encodeURIComponent(node)}/network`,
          authHeaders: auth.headers,
          tlsVerify,
          timeoutMs,
        }).catch((err) => {
          warningsCollector.record({
            code: 'PVE_HOST_NETWORK_UNAVAILABLE',
            category: 'network',
            message: 'failed to collect host network info; host IP fields may be missing',
            retryable: true,
            redacted_context: {
              stage: 'collect.host.network',
              node_external_id: node,
              status:
                typeof err === 'object' && err && 'status' in err ? (err as { status?: number }).status : undefined,
              cause: err instanceof Error ? err.message : String(err),
            },
          });
          return null;
        }),
        pveGet<unknown>({
          endpoint,
          path: `/api2/json/nodes/${encodeURIComponent(node)}/storage`,
          authHeaders: auth.headers,
          tlsVerify,
          timeoutMs,
        }).catch((err) => {
          warningsCollector.record({
            code: 'PVE_HOST_STORAGE_UNAVAILABLE',
            category: 'network',
            message: 'failed to collect host storage info; datastore fields may be missing',
            retryable: true,
            redacted_context: {
              stage: 'collect.host.storage',
              node_external_id: node,
              status:
                typeof err === 'object' && err && 'status' in err ? (err as { status?: number }).status : undefined,
              cause: err instanceof Error ? err.message : String(err),
            },
          });
          return null;
        }),
      ]);

      const ipInfo = extractNodeIpInfo(network);
      const datastores = extractNodeDatastores(storage);
      const power_state: PowerState | undefined = clusterMode
        ? hostPowerByNode.get(node)
        : status
          ? 'poweredOn'
          : undefined;

      return {
        node,
        status,
        network,
        storage,
        ipInfo,
        datastores,
        power_state,
      };
    });

    const clusterAsset = clusterMode ? normalizeCluster({ name: clusterName! }) : null;

    const listVmsPerNode = async () => {
      const perNode = await mapLimit(nodeNames, maxParallelNodes, async (node) => {
        const [qemu, lxc] = await Promise.all([
          pveGet<Array<Record<string, unknown>>>({
            endpoint,
            path: `/api2/json/nodes/${encodeURIComponent(node)}/qemu`,
            authHeaders: auth.headers,
            tlsVerify,
            timeoutMs,
          }),
          pveGet<Array<Record<string, unknown>>>({
            endpoint,
            path: `/api2/json/nodes/${encodeURIComponent(node)}/lxc`,
            authHeaders: auth.headers,
            tlsVerify,
            timeoutMs,
          }).catch(() => []),
        ]);
        return { node, qemu, lxc };
      });

      return perNode.flatMap((r) => {
        const qemu = Array.isArray(r.qemu) ? r.qemu : [];
        const lxc = Array.isArray(r.lxc) ? r.lxc : [];
        const out: Array<Parameters<typeof normalizeVm>[0]> = [];

        for (const vm of qemu) {
          const vmid = typeof vm.vmid === 'number' ? vm.vmid : Number(vm.vmid);
          if (!Number.isFinite(vmid)) continue;
          out.push({
            node: r.node,
            type: 'qemu',
            vmid,
            name: typeof vm.name === 'string' ? vm.name : undefined,
            status: typeof vm.status === 'string' ? vm.status : undefined,
            maxmem: typeof vm.maxmem === 'number' ? vm.maxmem : undefined,
            maxcpu: typeof vm.maxcpu === 'number' ? vm.maxcpu : undefined,
            cpus: typeof vm.cpus === 'number' ? vm.cpus : undefined,
          });
        }
        for (const vm of lxc) {
          const vmid = typeof vm.vmid === 'number' ? vm.vmid : Number(vm.vmid);
          if (!Number.isFinite(vmid)) continue;
          out.push({
            node: r.node,
            type: 'lxc',
            vmid,
            name: typeof vm.name === 'string' ? vm.name : undefined,
            status: typeof vm.status === 'string' ? vm.status : undefined,
            maxmem: typeof vm.maxmem === 'number' ? vm.maxmem : undefined,
            maxcpu: typeof vm.maxcpu === 'number' ? vm.maxcpu : undefined,
            cpus: typeof vm.cpus === 'number' ? vm.cpus : undefined,
          });
        }

        return out;
      });
    };

    let vmInputs: Array<Parameters<typeof normalizeVm>[0]> = [];
    if (clusterMode) {
      try {
        const resources = await pveGet<Array<Record<string, unknown>>>({
          endpoint,
          path: '/api2/json/cluster/resources?type=vm',
          authHeaders: auth.headers,
          tlsVerify,
          timeoutMs,
        });

        vmInputs = resources
          .map((row) => ({
            node: typeof row.node === 'string' ? row.node : '',
            type: row.type === 'lxc' ? ('lxc' as const) : ('qemu' as const),
            vmid: typeof row.vmid === 'number' ? row.vmid : Number(row.vmid),
            name: typeof row.name === 'string' ? row.name : undefined,
            status: typeof row.status === 'string' ? row.status : undefined,
            maxmem: typeof row.maxmem === 'number' ? row.maxmem : undefined,
            maxcpu: typeof row.maxcpu === 'number' ? row.maxcpu : undefined,
            cpus: typeof row.cpus === 'number' ? row.cpus : undefined,
          }))
          .filter((vm) => vm.node.trim().length > 0 && Number.isFinite(vm.vmid));
      } catch {
        // Back-compat: some deployments may not allow cluster/resources; fall back to per-node lists.
        vmInputs = await listVmsPerNode();
      }
    } else {
      vmInputs = await listVmsPerNode();
    }

    // Keep these internal (no new UI config knobs); adjust if needed after observing real clusters.
    const maxParallelVm = 20;
    const maxParallelGuestAgent = 10;

    // Fetch per-VM config (for disks) and (best-effort) guest agent IPs for running QEMU VMs.
    const vmWithDetails = await mapLimit(vmInputs, maxParallelVm, async (vm) => {
      const node = vm.node;
      const vmid = vm.vmid;

      // Disks (best-effort)
      const configPath =
        vm.type === 'lxc'
          ? `/api2/json/nodes/${encodeURIComponent(node)}/lxc/${encodeURIComponent(String(vmid))}/config`
          : `/api2/json/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(String(vmid))}/config`;

      const config = await pveGet<unknown>({
        endpoint,
        path: configPath,
        authHeaders: auth.headers,
        tlsVerify,
        timeoutMs,
      }).catch((err) => {
        warningsCollector.record({
          code: 'PVE_VM_CONFIG_UNAVAILABLE',
          category: 'permission',
          message: 'failed to collect vm config; disk fields may be missing',
          retryable: false,
          redacted_context: {
            stage: 'collect.vm.config',
            vm_external_id: `${node}:${vmid}`,
            status: typeof err === 'object' && err && 'status' in err ? (err as { status?: number }).status : undefined,
            cause: err instanceof Error ? err.message : String(err),
          },
        });
        return null;
      });

      const disks = parseVmDisksFromConfig({ type: vm.type, config });
      const mac_addresses = parseVmMacsFromConfig({ type: vm.type, config });
      const hostname = extractVmHostnameFromConfig({ type: vm.type, config });

      return { ...vm, disks, mac_addresses, hostname };
    });

    const runningQemuVms = vmWithDetails.filter(
      (vm) => vm.type === 'qemu' && (vm.status ?? '').toLowerCase() === 'running',
    );
    const guestAgentResults = await mapLimit(runningQemuVms, maxParallelGuestAgent, async (vm) => {
      const node = vm.node;
      const vmid = vm.vmid;
      const externalId = `${node}:${vmid}`;
      const path = `/api2/json/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(String(vmid))}/agent/network-get-interfaces`;
      try {
        const payload = await pveGet<unknown>({
          endpoint,
          path,
          authHeaders: auth.headers,
          tlsVerify,
          timeoutMs,
        });
        const ip_addresses = extractVmIpFromGuestAgent(payload);
        return { externalId, ip_addresses };
      } catch (err) {
        const status =
          typeof err === 'object' && err && 'status' in err ? (err as { status?: number }).status : undefined;
        const bodyText =
          typeof err === 'object' && err && 'bodyText' in err ? (err as { bodyText?: string }).bodyText : undefined;

        warningsCollector.record({
          code: 'PVE_GUEST_AGENT_UNAVAILABLE',
          category: 'parse',
          message: 'qemu guest agent unavailable; vm ip_addresses may be missing',
          retryable: false,
          redacted_context: {
            stage: 'collect.vm.guest_agent.network_get_interfaces',
            vm_external_id: externalId,
            ...(status ? { status } : {}),
            ...(bodyText ? { body_excerpt: bodyText.slice(0, 500) } : {}),
            cause: err instanceof Error ? err.message : String(err),
          },
        });
        return { externalId, ip_addresses: [] as string[] };
      }
    });

    const ipByVmExternalId = new Map<string, string[]>();
    for (const r of guestAgentResults) ipByVmExternalId.set(r.externalId, r.ip_addresses);

    const hostAssets = hostDetails.map((r) =>
      normalizeHost({
        node: r.node,
        status: r.status,
        version: versionString,
        ip_addresses: r.ipInfo.ip_addresses,
        management_ip: r.ipInfo.management_ip,
        power_state: r.power_state,
        datastores: r.datastores,
      }),
    );

    const vmAssets = vmWithDetails.map((vm) =>
      normalizeVm({
        ...vm,
        ip_addresses: ipByVmExternalId.get(`${vm.node}:${vm.vmid}`) ?? undefined,
      }),
    );

    const assets = [...(clusterAsset ? [clusterAsset] : []), ...hostAssets, ...vmAssets];
    const warnings = warningsCollector.flush();

    const memberOfRelations = clusterAsset
      ? nodeNames.map((node) => ({
          type: 'member_of' as const,
          from: { external_kind: 'host' as const, external_id: node },
          to: { external_kind: 'cluster' as const, external_id: clusterAsset.external_id },
          raw_payload: { type: 'member_of', node, cluster: clusterAsset.external_id },
        }))
      : [];

    const vmRelations = vmAssets.flatMap((vm) => {
      const hostExternalId = vm.external_id.split(':')[0];
      if (!hostExternalId) return [];
      return [
        {
          type: 'runs_on' as const,
          from: { external_kind: 'vm' as const, external_id: vm.external_id },
          to: { external_kind: 'host' as const, external_id: hostExternalId },
          raw_payload: { type: 'runs_on', vm_external_id: vm.external_id },
        },
        {
          type: 'hosts_vm' as const,
          from: { external_kind: 'host' as const, external_id: hostExternalId },
          to: { external_kind: 'vm' as const, external_id: vm.external_id },
          raw_payload: { type: 'hosts_vm', vm_external_id: vm.external_id },
        },
      ];
    });

    const relations = [...memberOfRelations, ...vmRelations];
    const runsOnCount = vmRelations.filter((r) => r.type === 'runs_on').length;

    if (shouldFailRelations(vmAssets.length, runsOnCount)) {
      return {
        response: makeResponse({
          assets,
          relations,
          stats: { assets: assets.length, relations: relations.length, inventory_complete: false, warnings },
          errors: [
            {
              code: 'INVENTORY_RELATIONS_EMPTY',
              category: 'parse',
              message: 'relations is empty',
              retryable: false,
              redacted_context: { mode: 'collect', assets: assets.length, vms: vmAssets.length },
            },
          ],
        }),
        exitCode: 1,
      };
    }

    return {
      response: makeResponse({
        assets,
        relations,
        stats: { assets: assets.length, relations: relations.length, inventory_complete: true, warnings },
        errors: [],
      }),
      exitCode: 0,
    };
  } catch (err) {
    return {
      response: makeResponse({
        errors: [toPveError(err, 'collect')],
        stats: { assets: 0, relations: 0, inventory_complete: false, warnings: warningsCollector.flush() },
      }),
      exitCode: 1,
    };
  }
}

async function main(): Promise<number> {
  let parsed: unknown;
  try {
    parsed = await readStdinJson();
  } catch {
    const response = makeResponse({
      errors: [{ code: 'PVE_PARSE_ERROR', category: 'parse', message: 'invalid input json', retryable: false }],
    });
    process.stdout.write(`${JSON.stringify(response)}\n`);
    return 1;
  }

  const request = parsed as CollectorRequestV1;
  if (request.schema_version !== 'collector-request-v1') {
    const response = makeResponse({
      errors: [
        { code: 'PVE_CONFIG_INVALID', category: 'config', message: 'unsupported schema_version', retryable: false },
      ],
    });
    process.stdout.write(`${JSON.stringify(response)}\n`);
    return 1;
  }

  if (request.source.source_type !== 'pve') {
    const response = makeResponse({
      errors: [
        { code: 'PVE_CONFIG_INVALID', category: 'config', message: 'unsupported source_type', retryable: false },
      ],
    });
    process.stdout.write(`${JSON.stringify(response)}\n`);
    return 1;
  }

  if (!request.source.config?.endpoint) {
    const response = makeResponse({
      errors: [{ code: 'PVE_CONFIG_INVALID', category: 'config', message: 'missing endpoint', retryable: false }],
    });
    process.stdout.write(`${JSON.stringify(response)}\n`);
    return 1;
  }

  const mode = request.request?.mode;
  const result =
    mode === 'collect'
      ? await collect(request)
      : mode === 'detect'
        ? await detect(request)
        : await healthcheck(request);

  process.stdout.write(`${JSON.stringify(result.response)}\n`);
  return result.exitCode;
}

process.exitCode = await main();
