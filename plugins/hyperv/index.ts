#!/usr/bin/env bun

import { HypervAgentClientError, postAgentJson } from './agent-client';
import { runPowershellJson, runPowershellWithTimeout } from './client';
import { buildClusterInventory, buildStandaloneInventory } from './inventory';
import { normalizeKerberosServiceName } from './kerberos-spn';
import type { NormalizedAsset } from './normalize';
import type { CollectorError, CollectorRequestV1, CollectorResponseV1 } from './types';

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

function getRunId(request: CollectorRequestV1): string | undefined {
  const runId = request.request?.run_id;
  if (typeof runId !== 'string') return undefined;
  const trimmed = runId.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function readStdinJson(): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(text);
}

function clampPositiveInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0) return value;
  return fallback;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const safeLimit = Math.max(1, Math.floor(limit));
  const results: R[] = new Array(items.length);
  let idx = 0;

  const workers = new Array(Math.min(safeLimit, items.length)).fill(null).map(async () => {
    while (true) {
      const current = idx++;
      if (current >= items.length) return;
      results[current] = await fn(items[current]!);
    }
  });

  await Promise.all(workers);
  return results;
}

type PowerState = 'poweredOn' | 'poweredOff' | 'suspended';

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

function mapClusterNodeStateToPowerState(state: unknown): PowerState | undefined {
  const v = typeof state === 'string' ? state.trim().toLowerCase() : '';
  if (!v) return undefined;
  if (v === 'up' || v.includes('up')) return 'poweredOn';
  if (v === 'down' || v.includes('down')) return 'poweredOff';
  if (v.includes('paused') || v.includes('pause')) return 'suspended';
  return undefined;
}

function computeCollectWarnings(assets: NormalizedAsset[]): WarningIssue[] {
  const warningsCollector = createWarningCollector({ sampleLimitPerCode: 10 });

  for (const asset of assets) {
    const n = asset.normalized as any;

    if (asset.external_kind === 'vm') {
      const power = n?.runtime?.power_state;
      const ips = n?.network?.ip_addresses;
      const macs = n?.network?.mac_addresses;
      const disks = n?.hardware?.disks;
      const isOn = typeof power === 'string' && power.trim() === 'poweredOn';
      const hasIp = Array.isArray(ips) && ips.length > 0;
      const hasMac = Array.isArray(macs) && macs.length > 0;
      const hasDisks = Array.isArray(disks) && disks.length > 0;

      if (isOn && !hasIp) {
        warningsCollector.record({
          code: 'HYPERV_VM_IP_UNAVAILABLE',
          category: 'parse',
          message: 'vm ip_addresses missing (integration services may be unavailable)',
          retryable: false,
          redacted_context: {
            stage: 'collect.vm.ip',
            vm_external_id: asset.external_id,
            field: 'network.ip_addresses',
            tools_running: typeof n?.runtime?.tools_running === 'boolean' ? n.runtime.tools_running : null,
            tools_status: typeof n?.runtime?.tools_status === 'string' ? n.runtime.tools_status : null,
          },
        });
      }

      if (isOn && !hasMac) {
        warningsCollector.record({
          code: 'HYPERV_VM_MAC_UNAVAILABLE',
          category: 'parse',
          message: 'vm mac_addresses missing; network.mac_addresses may be empty',
          retryable: false,
          redacted_context: {
            stage: 'collect.vm.mac',
            vm_external_id: asset.external_id,
            field: 'network.mac_addresses',
          },
        });
      }

      if (!hasDisks) {
        warningsCollector.record({
          code: 'HYPERV_VM_DISKS_MISSING',
          category: 'parse',
          message: 'vm disks missing; hardware.disks may be empty',
          retryable: false,
          redacted_context: {
            stage: 'collect.vm.disks',
            vm_external_id: asset.external_id,
            field: 'hardware.disks',
          },
        });
      } else {
        const hasAnySize = (disks as unknown[]).some((d) => {
          if (!d || typeof d !== 'object' || Array.isArray(d)) return false;
          const size = (d as Record<string, unknown>).size_bytes;
          return typeof size === 'number' && Number.isFinite(size) && size >= 0;
        });
        if (!hasAnySize) {
          warningsCollector.record({
            code: 'HYPERV_VM_DISK_SIZE_UNAVAILABLE',
            category: 'parse',
            message: 'vm disk sizes missing; hardware.disks[].size_bytes may be empty',
            retryable: false,
            redacted_context: {
              stage: 'collect.vm.disks.size',
              vm_external_id: asset.external_id,
              field: 'hardware.disks',
            },
          });
        }
      }
      continue;
    }

    if (asset.external_kind === 'host') {
      const mgmt = n?.network?.management_ip;
      const ips = n?.network?.ip_addresses;
      const hasIp = Array.isArray(ips) && ips.length > 0;
      const hasMgmt = typeof mgmt === 'string' && mgmt.trim().length > 0;
      if (!hasMgmt && !hasIp) {
        warningsCollector.record({
          code: 'HYPERV_HOST_IP_UNAVAILABLE',
          category: 'parse',
          message: 'host ip_addresses missing; host IP fields may be empty',
          retryable: false,
          redacted_context: {
            stage: 'collect.host.ip',
            host_external_id: asset.external_id,
            field: 'network.ip_addresses',
          },
        });
      }

      const datastores = n?.storage?.datastores;
      const hasDatastores = Array.isArray(datastores) && datastores.length > 0;
      if (!hasDatastores) {
        warningsCollector.record({
          code: 'HYPERV_HOST_DATASTORES_MISSING',
          category: 'parse',
          message: 'host datastores missing; storage.datastores may be empty',
          retryable: false,
          redacted_context: {
            stage: 'collect.host.datastores',
            host_external_id: asset.external_id,
            field: 'storage.datastores',
          },
        });
      }
    }
  }

  return warningsCollector.flush();
}

function getConnectionMethod(request: CollectorRequestV1): 'winrm' | 'agent' {
  const method = request.source.config?.connection_method;
  return method === 'agent' ? 'agent' : 'winrm';
}

function buildAgentOptions(request: CollectorRequestV1) {
  const cfg = request.source.config;
  if (cfg.connection_method !== 'agent') throw new Error('invalid config: connection_method must be agent');

  const baseUrl = cfg.agent_url.trim();
  if (!baseUrl) throw new Error('invalid config: missing agent_url');

  const tlsVerify = cfg.agent_tls_verify ?? true;
  const timeoutMs = clampPositiveInt(cfg.agent_timeout_ms, 60_000);

  const cred = request.source.credential;
  if (cred.auth !== 'agent') throw new Error('invalid config: missing agent token');
  const token = cred.token.trim();
  if (!token) throw new Error('invalid config: missing agent token');

  return {
    baseUrl,
    token,
    tlsVerify: !!tlsVerify,
    timeoutMs,
    requestId: getRunId(request),
  };
}

function buildAgentRequestBody(request: CollectorRequestV1) {
  const cfg = request.source.config ?? ({} as any);
  const endpoint = typeof cfg.endpoint === 'string' ? cfg.endpoint.trim() : '';
  if (!endpoint) throw new Error('invalid config: missing endpoint');
  const maxParallelNodes = clampPositiveInt(cfg.max_parallel_nodes, 5);
  const scope = cfg.scope ?? 'auto';
  return {
    source_id: request.source.source_id,
    run_id: request.request.run_id,
    mode: request.request.mode,
    now: request.request.now,
    endpoint,
    scope,
    max_parallel_nodes: maxParallelNodes,
  };
}

function toHypervError(err: unknown, stage: string): CollectorError {
  const cause = err instanceof Error ? err.message : String(err);
  const lower = cause.toLowerCase();
  const winrmHttp =
    err && typeof err === 'object' && !Array.isArray(err) && 'winrm_http' in (err as Record<string, unknown>)
      ? (err as Record<string, unknown>).winrm_http
      : undefined;
  const winrmHttpContext =
    winrmHttp && typeof winrmHttp === 'object' && !Array.isArray(winrmHttp) ? winrmHttp : undefined;

  // Config/credential issues (fail-fast)
  if (
    lower.includes('missing endpoint') ||
    lower.includes('invalid config') ||
    lower.includes('missing username') ||
    lower.includes('missing password') ||
    lower.includes('kerberos requires') ||
    lower.includes('enoent')
  ) {
    return {
      code: 'HYPERV_CONFIG_INVALID',
      category: 'config',
      message: 'invalid hyperv config/credential',
      retryable: false,
      redacted_context: { stage, cause },
    };
  }

  // Timeout
  if (
    lower.includes('timeout') ||
    (typeof err === 'object' && err && 'name' in err && (err as any).name === 'TimeoutError')
  ) {
    return {
      code: 'HYPERV_NETWORK_ERROR',
      category: 'network',
      message: 'hyperv request timed out',
      retryable: true,
      redacted_context: { stage, cause },
    };
  }

  // Auth / permission hints
  if (
    lower.includes('authentication failed') ||
    lower.includes('unauthorized') ||
    lower.includes('failed to process the request: 401') ||
    lower.includes('ntlm authentication failed') ||
    lower.includes('kinit failed') ||
    lower.includes('createshell failed with status 401') ||
    lower.includes('command failed with status 401')
  ) {
    return {
      code: 'HYPERV_AUTH_FAILED',
      category: 'auth',
      message: 'authentication failed',
      retryable: false,
      redacted_context: { stage, cause, ...(winrmHttpContext ? { winrm_http: winrmHttpContext } : {}) },
    };
  }
  if (lower.includes('access is denied') || lower.includes('failed to process the request: 403')) {
    return {
      code: 'HYPERV_PERMISSION_DENIED',
      category: 'permission',
      message: 'permission denied',
      retryable: false,
      redacted_context: { stage, cause, ...(winrmHttpContext ? { winrm_http: winrmHttpContext } : {}) },
    };
  }

  // Parse/shape issues
  if (lower.includes('invalid json') || lower.includes('data parsing error') || lower.includes('soap fault')) {
    const bodyText =
      typeof err === 'object' && err && 'bodyText' in err ? (err as { bodyText?: string }).bodyText : undefined;
    return {
      code: 'HYPERV_PARSE_ERROR',
      category: 'parse',
      message: 'hyperv response parse error',
      retryable: false,
      redacted_context: { stage, ...(bodyText ? { body_excerpt: bodyText.slice(0, 500) } : {}), cause },
    };
  }

  const tlsLike = lower.includes('certificate') || lower.includes('tls') || lower.includes('self signed');
  return {
    code: tlsLike ? 'HYPERV_TLS_ERROR' : 'HYPERV_NETWORK_ERROR',
    category: 'network',
    message: tlsLike ? 'tls error' : 'hyperv request failed',
    retryable: !tlsLike,
    redacted_context: { stage, cause },
  };
}

function toHypervAgentError(err: unknown, stage: string): CollectorError {
  if (err instanceof HypervAgentClientError) return err.collectorError;
  return toHypervError(err, stage);
}

function buildWinrmOptions(request: CollectorRequestV1) {
  const cfg = request.source.config;
  if (cfg.connection_method === 'agent') throw new Error('invalid config: missing endpoint');

  const endpoint = cfg.endpoint.trim();
  if (!endpoint) throw new Error('missing endpoint');

  const scheme = (cfg.scheme === 'http' || cfg.scheme === 'https' ? cfg.scheme : 'http') as 'http' | 'https';
  const port =
    typeof cfg.port === 'number' && Number.isFinite(cfg.port) && Number.isInteger(cfg.port) && cfg.port > 0
      ? cfg.port
      : scheme === 'https'
        ? 5986
        : 5985;

  const tlsVerify = cfg.tls_verify ?? true;
  const timeoutMs = clampPositiveInt(cfg.timeout_ms, 60_000);

  const cred = request.source.credential;
  if (cred.auth === 'agent') throw new Error('invalid config: missing username');

  const rawUsername = cred.username.trim();
  const password = cred.password.trim();
  if (!rawUsername) throw new Error('missing username');
  if (!password) throw new Error('missing password');

  const authMethod =
    cfg.auth_method === 'kerberos' ||
    cfg.auth_method === 'ntlm' ||
    cfg.auth_method === 'basic' ||
    cfg.auth_method === 'auto'
      ? cfg.auth_method
      : 'auto';

  const domain = typeof cred.domain === 'string' && cred.domain.trim().length > 0 ? cred.domain.trim() : undefined;
  const legacyUsername = domain ? `${domain}\\${rawUsername}` : rawUsername;
  const username = authMethod === 'basic' ? rawUsername : legacyUsername;

  const kerberosServiceName = normalizeKerberosServiceName(cfg.kerberos_service_name);
  const kerberosSpnFallback = cfg.kerberos_spn_fallback ?? false;
  const kerberosHostnameOverride =
    typeof cfg.kerberos_hostname_override === 'string' && cfg.kerberos_hostname_override.trim().length > 0
      ? cfg.kerberos_hostname_override.trim()
      : undefined;

  return {
    host: endpoint,
    port,
    useHttps: scheme === 'https',
    rejectUnauthorized: !!tlsVerify,
    timeoutMs,
    username,
    password,
    authMethod,
    domain,
    rawUsername,
    kerberosServiceName,
    kerberosSpnFallback,
    kerberosHostnameOverride,
  };
}

function buildWinrmOptionsForHost(base: ReturnType<typeof buildWinrmOptions>, host: string) {
  return { ...base, host };
}

async function healthcheck(request: CollectorRequestV1): Promise<{ response: CollectorResponseV1; exitCode: number }> {
  try {
    const opts = buildWinrmOptions(request);
    const runId = getRunId(request);

    // Minimal baseline: can run a trivial command and (best-effort) list VM cmdlet presence.
    const script = `
$ErrorActionPreference = 'Stop'
$canList = $false
try {
  if (Get-Command Get-VM -ErrorAction Stop) { $canList = $true }
} catch { $canList = $false }
[pscustomobject]@{ ok = $true; can_list_vms = $canList } | ConvertTo-Json -Compress
`.trim();

    await runPowershellWithTimeout(opts, script, 'hyperv.healthcheck', { runId });
    return { response: makeResponse({ errors: [] }), exitCode: 0 };
  } catch (err) {
    return { response: makeResponse({ errors: [toHypervError(err, 'healthcheck')] }), exitCode: 1 };
  }
}

async function detect(request: CollectorRequestV1): Promise<{ response: CollectorResponseV1; exitCode: number }> {
  try {
    const opts = buildWinrmOptions(request);
    const runId = getRunId(request);
    const configuredScope = request.source.config?.scope ?? 'auto';

    const script = `
$ErrorActionPreference = 'Stop'
$os = $null
try {
  $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop | Select-Object -First 1
} catch { $os = $null }

$isCluster = $false
$clusterName = $null
$nodeCount = $null
try {
  if (Get-Command Get-Cluster -ErrorAction Stop) {
    $c = Get-Cluster -ErrorAction Stop
    $isCluster = $true
    $clusterName = $c.Name
    try { $nodeCount = (Get-ClusterNode -ErrorAction Stop | Measure-Object).Count } catch { $nodeCount = $null }
  }
} catch { $isCluster = $false }

$isS2d = $null
try {
  if ($isCluster -and (Get-Command Get-ClusterS2D -ErrorAction SilentlyContinue)) {
    $s2d = Get-ClusterS2D -ErrorAction Stop
    $isS2d = [bool]$s2d.S2DEnabled
  }
} catch { $isS2d = $null }

$canListVms = $false
try {
  if (Get-Command Get-VM -ErrorAction Stop) { $null = Get-VM -ErrorAction Stop | Select-Object -First 1; $canListVms = $true }
} catch { $canListVms = $false }

$recommendedScope = if ($isCluster) { 'cluster' } else { 'standalone' }

[pscustomobject]@{
  target_version = if ($os) { $os.Version } else { $null }
  capabilities = [pscustomobject]@{
    is_cluster = $isCluster
    cluster_name = $clusterName
    node_count = $nodeCount
    is_s2d = $isS2d
    can_list_vms = $canListVms
    can_map_vm_to_host = $canListVms
    recommended_scope = $recommendedScope
    configured_scope = '${configuredScope}'
  }
  driver = 'hyperv-winrm-v1'
} | ConvertTo-Json -Compress -Depth 6
`.trim();

    const detectResult = await runPowershellJson<Record<string, unknown>>(opts, script, 'hyperv.detect', { runId });

    return {
      response: makeResponse({
        detect: detectResult,
        assets: [],
        relations: [],
        stats: { assets: 0, relations: 0, inventory_complete: false, warnings: [] },
        errors: [],
      }),
      exitCode: 0,
    };
  } catch (err) {
    return { response: makeResponse({ errors: [toHypervError(err, 'detect')] }), exitCode: 1 };
  }
}

async function healthcheckAgent(
  request: CollectorRequestV1,
): Promise<{ response: CollectorResponseV1; exitCode: number }> {
  try {
    const opts = buildAgentOptions(request);
    const body = buildAgentRequestBody(request);
    await postAgentJson<unknown>(opts, '/v1/hyperv/healthcheck', body, 'hyperv.healthcheck.agent');
    return { response: makeResponse({ errors: [] }), exitCode: 0 };
  } catch (err) {
    return { response: makeResponse({ errors: [toHypervAgentError(err, 'healthcheck.agent')] }), exitCode: 1 };
  }
}

async function detectAgent(request: CollectorRequestV1): Promise<{ response: CollectorResponseV1; exitCode: number }> {
  try {
    const opts = buildAgentOptions(request);
    const body = buildAgentRequestBody(request);
    const detectResult = await postAgentJson<unknown>(opts, '/v1/hyperv/detect', body, 'hyperv.detect.agent');
    return {
      response: makeResponse({
        detect: detectResult,
        assets: [],
        relations: [],
        stats: { assets: 0, relations: 0, inventory_complete: false, warnings: [] },
        errors: [],
      }),
      exitCode: 0,
    };
  } catch (err) {
    return { response: makeResponse({ errors: [toHypervAgentError(err, 'detect.agent')] }), exitCode: 1 };
  }
}

async function collectAgent(request: CollectorRequestV1): Promise<{ response: CollectorResponseV1; exitCode: number }> {
  try {
    const opts = buildAgentOptions(request);
    const body = buildAgentRequestBody(request);
    const raw = await postAgentJson<unknown>(opts, '/v1/hyperv/collect', body, 'hyperv.collect.agent');

    const scope = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as any).scope : null;
    const built =
      scope === 'cluster' || (raw && typeof raw === 'object' && !Array.isArray(raw) && 'cluster_name' in raw)
        ? buildClusterInventory(raw)
        : buildStandaloneInventory(raw);
    const warnings = computeCollectWarnings(built.assets);

    return {
      response: makeResponse({
        assets: built.assets,
        relations: built.relations,
        stats: { ...built.stats, warnings },
        errors: built.errors,
      }),
      exitCode: built.exitCode,
    };
  } catch (err) {
    return { response: makeResponse({ errors: [toHypervAgentError(err, 'collect.agent')] }), exitCode: 1 };
  }
}

type ClusterDiscovery = {
  is_cluster: boolean;
  cluster_name: string | null;
  nodes: string[];
  node_states: Record<string, string>;
  error: string | null;
};

async function discoverCluster(
  opts: ReturnType<typeof buildWinrmOptions>,
  meta?: { runId?: string },
): Promise<ClusterDiscovery> {
  const script = `
$ErrorActionPreference = 'Stop'
$isCluster = $false
$clusterName = $null
$nodes = @()
$nodeStates = @()
$err = $null
try {
  if (Get-Command Get-Cluster -ErrorAction Stop) {
    $c = Get-Cluster -ErrorAction Stop
    $isCluster = $true
    $clusterName = $c.Name
    try {
      $rows = Get-ClusterNode -ErrorAction Stop
      $nodes = $rows | ForEach-Object { $_.Name }
      $nodeStates = $rows | ForEach-Object { [pscustomobject]@{ name = $_.Name; state = $_.State.ToString() } }
    } catch {
      $nodes = @()
      $nodeStates = @()
    }
  }
} catch {
  $err = $_.Exception.Message
}
[pscustomobject]@{ is_cluster = $isCluster; cluster_name = $clusterName; nodes = $nodes; node_states = $nodeStates; error = $err } | ConvertTo-Json -Compress -Depth 6
`.trim();

  const raw = await runPowershellJson<Record<string, unknown>>(opts, script, 'hyperv.cluster.discovery', meta);
  const nodes =
    raw && typeof raw === 'object' && 'nodes' in raw && Array.isArray((raw as any).nodes)
      ? ((raw as any).nodes as unknown[])
          .map((v) => (typeof v === 'string' ? v.trim() : ''))
          .filter((v) => v.length > 0)
      : [];

  const node_states: Record<string, string> = {};
  const nodeStatesRaw =
    raw && typeof raw === 'object' && 'node_states' in raw && Array.isArray((raw as any).node_states)
      ? ((raw as any).node_states as unknown[])
      : [];
  for (const row of nodeStatesRaw) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const obj = row as Record<string, unknown>;
    const name = typeof obj.name === 'string' ? obj.name.trim() : '';
    const state = typeof obj.state === 'string' ? obj.state.trim() : '';
    if (!name || !state) continue;
    node_states[name] = state;
  }

  return {
    is_cluster: !!(raw && typeof raw === 'object' && (raw as any).is_cluster === true),
    cluster_name:
      raw && typeof raw === 'object' && typeof (raw as any).cluster_name === 'string'
        ? (raw as any).cluster_name
        : null,
    nodes,
    node_states,
    error: raw && typeof raw === 'object' && typeof (raw as any).error === 'string' ? (raw as any).error : null,
  };
}

type ClusterVmOwner = { name: string; owner_node: string | null; group_type: string | null };

async function listClusterVmOwners(
  opts: ReturnType<typeof buildWinrmOptions>,
  meta?: { runId?: string },
): Promise<Array<{ name: string; owner_node: string | null }>> {
  const script = `
$ErrorActionPreference = 'Stop'
$out = @()
try {
  if (Get-Command Get-ClusterGroup -ErrorAction Stop) {
    $out = Get-ClusterGroup -ErrorAction Stop | ForEach-Object {
      [pscustomobject]@{
        name = $_.Name
        group_type = $_.GroupType.ToString()
        owner_node = if ($_.OwnerNode) { $_.OwnerNode.Name } else { $null }
      }
    }
  }
} catch { $out = @() }
$out | ConvertTo-Json -Compress -Depth 4
`.trim();

  const raw = await runPowershellJson<unknown>(opts, script, 'hyperv.cluster.groups', meta).catch(() => null);
  if (!Array.isArray(raw)) return [];

  const rows = raw
    .map((r) => (r && typeof r === 'object' ? (r as ClusterVmOwner) : null))
    .filter((r): r is ClusterVmOwner => !!r);

  return rows
    .filter((r) => {
      const t = (r.group_type ?? '').toLowerCase();
      return t.includes('virtualmachine');
    })
    .map((r) => ({
      name: typeof r.name === 'string' ? r.name : '',
      owner_node: typeof r.owner_node === 'string' ? r.owner_node : null,
    }))
    .filter((r) => r.name.trim().length > 0);
}

async function collectStandalone(
  request: CollectorRequestV1,
): Promise<{ response: CollectorResponseV1; exitCode: number }> {
  const opts = buildWinrmOptions(request);
  const runId = getRunId(request);

  const script = `
$ErrorActionPreference = 'Stop'

function Format-MacAddress([string]$mac) {
  if ([string]::IsNullOrWhiteSpace($mac)) { return $null }
  $m = ([string]$mac).Trim() -replace '[-:]', ''
  $m = $m.ToLower()
  if ($m.Length -ne 12) { return $m }
  return ($m -replace '(.{2})(?=.)','$1:').TrimEnd(':')
}

function Map-VhdTypeToProvisioning([string]$vhdType) {
  if ([string]::IsNullOrWhiteSpace($vhdType)) { return $null }
  $t = ([string]$vhdType).Trim().ToLower()
  if ($t -eq 'dynamic') { return 'thin' }
  if ($t -eq 'fixed') { return 'thick' }
  if ($t -eq 'differencing') { return 'thin' }
  return $null
}

$hostName = $env:COMPUTERNAME
$bios = $null
try { $bios = Get-CimInstance -ClassName Win32_BIOS -ErrorAction Stop | Select-Object -First 1 } catch { $bios = $null }
$cs = $null
try { $cs = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop | Select-Object -First 1 } catch { $cs = $null }
$csp = $null
try { $csp = Get-CimInstance -ClassName Win32_ComputerSystemProduct -ErrorAction Stop | Select-Object -First 1 } catch { $csp = $null }
$os = $null
try { $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop | Select-Object -First 1 } catch { $os = $null }

$diskTotalBytes = $null
try {
  $sum = [int64]0
  $seen = $false
  $drives = Get-CimInstance -ClassName Win32_DiskDrive -ErrorAction Stop
  foreach ($d in $drives) {
    $size = $null
    try { $size = [int64]$d.Size } catch { $size = $null }
    if ($null -ne $size -and $size -gt 0) {
      $sum += $size
      $seen = $true
    }
  }
  if ($seen) { $diskTotalBytes = $sum }
} catch { $diskTotalBytes = $null }

$hostIps = @()
$mgmtIp = $null
try {
  if (Get-Command Get-NetIPAddress -ErrorAction SilentlyContinue) {
    $hostIps = @(
      Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
        ForEach-Object { $_.IPAddress } |
        Where-Object { $_ -and $_ -ne '127.0.0.1' -and $_ -ne '0.0.0.0' } |
        Sort-Object -Unique
    )
  }
} catch { $hostIps = @() }

try {
  $preferred = @($hostIps | Where-Object { -not $_.StartsWith('169.254.') } | Select-Object -First 1)
  if ($preferred -and $preferred.Count -gt 0) { $mgmtIp = $preferred[0] }
  if (-not $mgmtIp -and $hostIps.Count -gt 0) { $mgmtIp = $hostIps[0] }
} catch { $mgmtIp = $null }

$datastores = @()
try {
  $datastores = @(
    Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DriveType=3" -ErrorAction Stop |
      ForEach-Object {
        $name = [string]$_.DeviceID
        if ([string]::IsNullOrWhiteSpace([string]$name)) { return }
        $cap = $null
        try { $cap = [int64]$_.Size } catch { $cap = $null }
        if ($null -eq $cap -or $cap -lt 0) { return }
        [pscustomobject]@{ name = $name; capacity_bytes = $cap }
      } | Where-Object { $_ -ne $null }
  )
} catch { $datastores = @() }

# Best-effort: Cluster Shared Volumes (CSV) as datastores when available.
try {
  if (Get-Command Get-ClusterSharedVolume -ErrorAction SilentlyContinue) {
    $volumes = $null
    try { $volumes = Get-CimInstance -ClassName Win32_Volume -ErrorAction Stop } catch { $volumes = $null }
    $csvs = Get-ClusterSharedVolume -ErrorAction Stop
    foreach ($csv in $csvs) {
      $path = $null
      try { $path = [string]$csv.SharedVolumeInfo.FriendlyVolumeName } catch { $path = $null }
      if ([string]::IsNullOrWhiteSpace([string]$path)) { continue }
      if ($null -eq $volumes) { continue }
      $vol = $volumes | Where-Object { $_.Name -eq $path -or $_.Name -eq ($path + [string][char]92) } | Select-Object -First 1
      if (-not $vol) { continue }
      $cap = $null
      try { $cap = [int64]$vol.Capacity } catch { $cap = $null }
      if ($null -eq $cap -or $cap -lt 0) { continue }
      $datastores += [pscustomobject]@{ name = $path; capacity_bytes = $cap }
    }
  }
} catch { }

$host = [pscustomobject]@{
  hostname = $hostName
  host_uuid = if ($csp) { $csp.UUID } else { $null }
  serial_number = if ($bios) { $bios.SerialNumber } else { $null }
  vendor = if ($cs) { $cs.Manufacturer } else { $null }
  model = if ($cs) { $cs.Model } else { $null }
  os_name = if ($os) { $os.Caption } else { $null }
  os_version = if ($os) { $os.Version } else { $null }
  cpu_count = if ($cs) { $cs.NumberOfLogicalProcessors } else { $null }
  memory_bytes = if ($cs) { [int64]$cs.TotalPhysicalMemory } else { $null }
  ip_addresses = $hostIps
  management_ip = $mgmtIp
  power_state = 'poweredOn'
  datastores = $datastores
  disk_total_bytes = $diskTotalBytes
}

$vmList = @()
$vmList = @(Get-VM -ErrorAction Stop)

$disksByVmId = @{}
$diskFileTotalByVmId = @{}
try {
  if (Get-Command Get-VMHardDiskDrive -ErrorAction SilentlyContinue) {
    $allDrives = @($vmList | Get-VMHardDiskDrive -ErrorAction Stop)
    foreach ($drive in $allDrives) {
      $vmIdStr = $null
      try { $vmIdStr = [string]$drive.VMId } catch { $vmIdStr = $null }
      if ([string]::IsNullOrWhiteSpace([string]$vmIdStr)) { continue }

      if (-not $disksByVmId.ContainsKey($vmIdStr)) { $disksByVmId[$vmIdStr] = @() }
      if (-not $diskFileTotalByVmId.ContainsKey($vmIdStr)) { $diskFileTotalByVmId[$vmIdStr] = $null }

      $diskName = $null
      try {
        $ct = if ($drive.ControllerType) { $drive.ControllerType.ToString() } else { $null }
        $cn = $drive.ControllerNumber
        $cl = $drive.ControllerLocation
        if ($ct -and ($null -ne $cn) -and ($null -ne $cl)) {
          $diskName = ($ct + ' ' + [string]$cn + ':' + [string]$cl)
        }
      } catch { $diskName = $null }

      $sizeBytes = $null
      $fileSizeBytes = $null
      $diskType = $null
      try {
        $path = $null
        try { $path = [string]$drive.Path } catch { $path = $null }

        if (-not [string]::IsNullOrWhiteSpace([string]$path)) {
          if (Get-Command Get-VHD -ErrorAction SilentlyContinue) {
            try {
              $vhd = Get-VHD -Path $path -ErrorAction Stop
              try { $sizeBytes = [int64]$vhd.Size } catch { $sizeBytes = $null }
              try { $fileSizeBytes = [int64]$vhd.FileSize } catch { $fileSizeBytes = $null }
              try { $diskType = Map-VhdTypeToProvisioning ([string]$vhd.VhdType) } catch { $diskType = $null }
            } catch { $sizeBytes = $null; $fileSizeBytes = $null; $diskType = $null }
          } else {
            # Fallback: approximate with file length when Get-VHD is unavailable.
            try {
              $item = Get-Item -LiteralPath $path -ErrorAction Stop
              $fileSizeBytes = [int64]$item.Length
              $sizeBytes = $fileSizeBytes
            } catch { $sizeBytes = $null; $fileSizeBytes = $null }
          }
        } else {
          # Pass-through disks may not have Path; try DiskNumber via Get-Disk.
          $dn = $null
          try { $dn = $drive.DiskNumber } catch { $dn = $null }
          if (($null -ne $dn) -and (Get-Command Get-Disk -ErrorAction SilentlyContinue)) {
            $d = Get-Disk -Number $dn -ErrorAction Stop
            $sizeBytes = [int64]$d.Size
          }
        }
      } catch { }

      if (($null -ne $sizeBytes) -and ($sizeBytes -lt 0)) { $sizeBytes = $null }
      if (($null -ne $fileSizeBytes) -and ($fileSizeBytes -lt 0)) { $fileSizeBytes = $null }

      $entry = [ordered]@{}
      if ($diskName) { $entry.name = $diskName }
      if ($null -ne $sizeBytes) { $entry.size_bytes = $sizeBytes }
      if ($diskType) { $entry.type = $diskType }
      if ($null -ne $fileSizeBytes) { $entry.file_size_bytes = $fileSizeBytes }

      if ($entry.Count -gt 0) {
        $disksByVmId[$vmIdStr] += [pscustomobject]$entry
        if (($null -ne $fileSizeBytes) -and ($fileSizeBytes -ge 0)) {
          if ($null -eq $diskFileTotalByVmId[$vmIdStr]) { $diskFileTotalByVmId[$vmIdStr] = [int64]0 }
          $diskFileTotalByVmId[$vmIdStr] += $fileSizeBytes
        }
      }
    }
  }
} catch { }

$vms = @()
$vms = $vmList | ForEach-Object {
  $vmIdStr = [string]$_.VMId

  $vmDisks = @()
  if ($vmIdStr -and $disksByVmId.ContainsKey($vmIdStr)) { $vmDisks = $disksByVmId[$vmIdStr] }

  $diskFileTotal = $null
  if ($vmIdStr -and $diskFileTotalByVmId.ContainsKey($vmIdStr)) {
    $v = $diskFileTotalByVmId[$vmIdStr]
    if ($null -ne $v) { $diskFileTotal = [int64]$v }
  }

  $toolsRunning = $null
  $toolsStatus = $null
  try {
    if (Get-Command Get-VMIntegrationService -ErrorAction SilentlyContinue) {
      $kvp = $null
      try {
        $kvp = Get-VMIntegrationService -VMId $_.VMId -Name 'Key-Value Pair Exchange' -ErrorAction Stop | Select-Object -First 1
      } catch {
        try {
          $kvp = Get-VMIntegrationService -VMId $_.VMId -ErrorAction Stop | Where-Object { $_.Name -eq 'Key-Value Pair Exchange' } | Select-Object -First 1
        } catch { $kvp = $null }
      }

      if ($kvp) {
        try { $toolsRunning = [bool]$kvp.Enabled } catch { $toolsRunning = $null }
        try { $toolsStatus = [string]$kvp.PrimaryStatusDescription } catch { $toolsStatus = $null }
      }
    }
  } catch { $toolsRunning = $null; $toolsStatus = $null }

  $vmIps = @()
  $vmMacs = @()
  try {
    if (Get-Command Get-VMNetworkAdapter -ErrorAction SilentlyContinue) {
      $nics = Get-VMNetworkAdapter -VMId $_.VMId -ErrorAction Stop
      foreach ($nic in $nics) {
        try {
          $mac = $null
          try { $mac = Format-MacAddress $nic.MacAddress } catch { $mac = $null }
          if ($mac) { $vmMacs += $mac }
        } catch { }

        try {
          $ips = $null
          try { $ips = $nic.IPAddresses } catch { $ips = $null }
          foreach ($ip in $ips) {
            if ([string]::IsNullOrWhiteSpace([string]$ip)) { continue }
            $s = ([string]$ip).Trim()
            if ($s -match '^[0-9]{1,3}([.][0-9]{1,3}){3}$' -and $s -ne '127.0.0.1' -and $s -ne '0.0.0.0') {
              $vmIps += $s
            }
          }
        } catch { }
      }
    }
  } catch { $vmIps = @(); $vmMacs = @() }

  $vmIps = @($vmIps | Sort-Object -Unique)
  $vmMacs = @($vmMacs | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | Sort-Object -Unique)

  [pscustomobject]@{
    vm_id = $vmIdStr
    name = $_.Name
    state = $_.State.ToString()
    cpu_count = $_.ProcessorCount
    memory_bytes = [int64]$_.MemoryStartup
    ip_addresses = $vmIps
    mac_addresses = $vmMacs
    disks = $vmDisks
    disk_file_size_bytes_total = $diskFileTotal
    tools_running = $toolsRunning
    tools_status = $toolsStatus
  }
}

[pscustomobject]@{ host = $host; vms = $vms } | ConvertTo-Json -Compress -Depth 8
`.trim();

  const payload = await runPowershellJson<unknown>(opts, script, 'hyperv.collect', { runId });
  const built = buildStandaloneInventory(payload);
  const warnings = computeCollectWarnings(built.assets);
  return {
    response: makeResponse({
      assets: built.assets,
      relations: built.relations,
      stats: { ...built.stats, warnings },
      errors: built.errors,
    }),
    exitCode: built.exitCode,
  };
}

class ClusterNodeCollectError extends Error {
  node: string;
  cause: unknown;

  constructor(node: string, cause: unknown) {
    super(`cluster node collect failed: ${node}`);
    this.node = node;
    this.cause = cause;
  }
}

async function collectCluster(
  request: CollectorRequestV1,
): Promise<{ response: CollectorResponseV1; exitCode: number }> {
  const baseOpts = buildWinrmOptions(request);
  const runId = getRunId(request);
  const maxParallelNodes = clampPositiveInt(request.source.config?.max_parallel_nodes, 5);

  const discovery = await discoverCluster(baseOpts, { runId });
  if (!discovery.is_cluster || !discovery.cluster_name || discovery.nodes.length === 0) {
    const error: CollectorError = {
      code: 'HYPERV_CONFIG_INVALID',
      category: 'config',
      message: 'cluster discovery failed',
      retryable: false,
      redacted_context: {
        is_cluster: discovery.is_cluster,
        cluster_name: discovery.cluster_name,
        nodes: discovery.nodes.length,
        ...(discovery.error ? { cause: discovery.error } : {}),
      },
    };
    return { response: makeResponse({ errors: [error] }), exitCode: 1 };
  }

  // Best-effort: map VM Name -> OwnerNode from cluster groups.
  const ownerRows = await listClusterVmOwners(baseOpts, { runId });

  const nodeScript = `
$ErrorActionPreference = 'Stop'

function Format-MacAddress([string]$mac) {
  if ([string]::IsNullOrWhiteSpace($mac)) { return $null }
  $m = ([string]$mac).Trim() -replace '[-:]', ''
  $m = $m.ToLower()
  if ($m.Length -ne 12) { return $m }
  return ($m -replace '(.{2})(?=.)','$1:').TrimEnd(':')
}

function Map-VhdTypeToProvisioning([string]$vhdType) {
  if ([string]::IsNullOrWhiteSpace($vhdType)) { return $null }
  $t = ([string]$vhdType).Trim().ToLower()
  if ($t -eq 'dynamic') { return 'thin' }
  if ($t -eq 'fixed') { return 'thick' }
  if ($t -eq 'differencing') { return 'thin' }
  return $null
}

$hostName = $env:COMPUTERNAME
$bios = $null
try { $bios = Get-CimInstance -ClassName Win32_BIOS -ErrorAction Stop | Select-Object -First 1 } catch { $bios = $null }
$cs = $null
try { $cs = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop | Select-Object -First 1 } catch { $cs = $null }
$csp = $null
try { $csp = Get-CimInstance -ClassName Win32_ComputerSystemProduct -ErrorAction Stop | Select-Object -First 1 } catch { $csp = $null }
$os = $null
try { $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop | Select-Object -First 1 } catch { $os = $null }

$diskTotalBytes = $null
try {
  $sum = [int64]0
  $seen = $false
  $drives = Get-CimInstance -ClassName Win32_DiskDrive -ErrorAction Stop
  foreach ($d in $drives) {
    $size = $null
    try { $size = [int64]$d.Size } catch { $size = $null }
    if ($null -ne $size -and $size -gt 0) {
      $sum += $size
      $seen = $true
    }
  }
  if ($seen) { $diskTotalBytes = $sum }
} catch { $diskTotalBytes = $null }

$hostIps = @()
$mgmtIp = $null
try {
  if (Get-Command Get-NetIPAddress -ErrorAction SilentlyContinue) {
    $hostIps = @(
      Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
        ForEach-Object { $_.IPAddress } |
        Where-Object { $_ -and $_ -ne '127.0.0.1' -and $_ -ne '0.0.0.0' } |
        Sort-Object -Unique
    )
  }
} catch { $hostIps = @() }

try {
  $preferred = @($hostIps | Where-Object { -not $_.StartsWith('169.254.') } | Select-Object -First 1)
  if ($preferred -and $preferred.Count -gt 0) { $mgmtIp = $preferred[0] }
  if (-not $mgmtIp -and $hostIps.Count -gt 0) { $mgmtIp = $hostIps[0] }
} catch { $mgmtIp = $null }

$datastores = @()
try {
  $datastores = @(
    Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DriveType=3" -ErrorAction Stop |
      ForEach-Object {
        $name = [string]$_.DeviceID
        if ([string]::IsNullOrWhiteSpace([string]$name)) { return }
        $cap = $null
        try { $cap = [int64]$_.Size } catch { $cap = $null }
        if ($null -eq $cap -or $cap -lt 0) { return }
        [pscustomobject]@{ name = $name; capacity_bytes = $cap }
      } | Where-Object { $_ -ne $null }
  )
} catch { $datastores = @() }

# Best-effort: Cluster Shared Volumes (CSV) as datastores when available.
try {
  if (Get-Command Get-ClusterSharedVolume -ErrorAction SilentlyContinue) {
    $volumes = $null
    try { $volumes = Get-CimInstance -ClassName Win32_Volume -ErrorAction Stop } catch { $volumes = $null }
    $csvs = Get-ClusterSharedVolume -ErrorAction Stop
    foreach ($csv in $csvs) {
      $path = $null
      try { $path = [string]$csv.SharedVolumeInfo.FriendlyVolumeName } catch { $path = $null }
      if ([string]::IsNullOrWhiteSpace([string]$path)) { continue }
      if ($null -eq $volumes) { continue }
      $vol = $volumes | Where-Object { $_.Name -eq $path -or $_.Name -eq ($path + [string][char]92) } | Select-Object -First 1
      if (-not $vol) { continue }
      $cap = $null
      try { $cap = [int64]$vol.Capacity } catch { $cap = $null }
      if ($null -eq $cap -or $cap -lt 0) { continue }
      $datastores += [pscustomobject]@{ name = $path; capacity_bytes = $cap }
    }
  }
} catch { }

$host = [pscustomobject]@{
  hostname = $hostName
  host_uuid = if ($csp) { $csp.UUID } else { $null }
  serial_number = if ($bios) { $bios.SerialNumber } else { $null }
  vendor = if ($cs) { $cs.Manufacturer } else { $null }
  model = if ($cs) { $cs.Model } else { $null }
  os_name = if ($os) { $os.Caption } else { $null }
  os_version = if ($os) { $os.Version } else { $null }
  cpu_count = if ($cs) { $cs.NumberOfLogicalProcessors } else { $null }
  memory_bytes = if ($cs) { [int64]$cs.TotalPhysicalMemory } else { $null }
  ip_addresses = $hostIps
  management_ip = $mgmtIp
  datastores = $datastores
  disk_total_bytes = $diskTotalBytes
}

$vmList = @()
$vmList = @(Get-VM -ErrorAction Stop)

$disksByVmId = @{}
$diskFileTotalByVmId = @{}
try {
  if (Get-Command Get-VMHardDiskDrive -ErrorAction SilentlyContinue) {
    $allDrives = @($vmList | Get-VMHardDiskDrive -ErrorAction Stop)
    foreach ($drive in $allDrives) {
      $vmIdStr = $null
      try { $vmIdStr = [string]$drive.VMId } catch { $vmIdStr = $null }
      if ([string]::IsNullOrWhiteSpace([string]$vmIdStr)) { continue }

      if (-not $disksByVmId.ContainsKey($vmIdStr)) { $disksByVmId[$vmIdStr] = @() }
      if (-not $diskFileTotalByVmId.ContainsKey($vmIdStr)) { $diskFileTotalByVmId[$vmIdStr] = $null }

      $diskName = $null
      try {
        $ct = if ($drive.ControllerType) { $drive.ControllerType.ToString() } else { $null }
        $cn = $drive.ControllerNumber
        $cl = $drive.ControllerLocation
        if ($ct -and ($null -ne $cn) -and ($null -ne $cl)) {
          $diskName = ($ct + ' ' + [string]$cn + ':' + [string]$cl)
        }
      } catch { $diskName = $null }

      $sizeBytes = $null
      $fileSizeBytes = $null
      $diskType = $null
      try {
        $path = $null
        try { $path = [string]$drive.Path } catch { $path = $null }

        if (-not [string]::IsNullOrWhiteSpace([string]$path)) {
          if (Get-Command Get-VHD -ErrorAction SilentlyContinue) {
            try {
              $vhd = Get-VHD -Path $path -ErrorAction Stop
              try { $sizeBytes = [int64]$vhd.Size } catch { $sizeBytes = $null }
              try { $fileSizeBytes = [int64]$vhd.FileSize } catch { $fileSizeBytes = $null }
              try { $diskType = Map-VhdTypeToProvisioning ([string]$vhd.VhdType) } catch { $diskType = $null }
            } catch { $sizeBytes = $null; $fileSizeBytes = $null; $diskType = $null }
          } else {
            # Fallback: approximate with file length when Get-VHD is unavailable.
            try {
              $item = Get-Item -LiteralPath $path -ErrorAction Stop
              $fileSizeBytes = [int64]$item.Length
              $sizeBytes = $fileSizeBytes
            } catch { $sizeBytes = $null; $fileSizeBytes = $null }
          }
        } else {
          # Pass-through disks may not have Path; try DiskNumber via Get-Disk.
          $dn = $null
          try { $dn = $drive.DiskNumber } catch { $dn = $null }
          if (($null -ne $dn) -and (Get-Command Get-Disk -ErrorAction SilentlyContinue)) {
            $d = Get-Disk -Number $dn -ErrorAction Stop
            $sizeBytes = [int64]$d.Size
          }
        }
      } catch { }

      if (($null -ne $sizeBytes) -and ($sizeBytes -lt 0)) { $sizeBytes = $null }
      if (($null -ne $fileSizeBytes) -and ($fileSizeBytes -lt 0)) { $fileSizeBytes = $null }

      $entry = [ordered]@{}
      if ($diskName) { $entry.name = $diskName }
      if ($null -ne $sizeBytes) { $entry.size_bytes = $sizeBytes }
      if ($diskType) { $entry.type = $diskType }
      if ($null -ne $fileSizeBytes) { $entry.file_size_bytes = $fileSizeBytes }

      if ($entry.Count -gt 0) {
        $disksByVmId[$vmIdStr] += [pscustomobject]$entry
        if (($null -ne $fileSizeBytes) -and ($fileSizeBytes -ge 0)) {
          if ($null -eq $diskFileTotalByVmId[$vmIdStr]) { $diskFileTotalByVmId[$vmIdStr] = [int64]0 }
          $diskFileTotalByVmId[$vmIdStr] += $fileSizeBytes
        }
      }
    }
  }
} catch { }

$vms = @()
$vms = $vmList | ForEach-Object {
  $vmIdStr = [string]$_.VMId

  $vmDisks = @()
  if ($vmIdStr -and $disksByVmId.ContainsKey($vmIdStr)) { $vmDisks = $disksByVmId[$vmIdStr] }

  $diskFileTotal = $null
  if ($vmIdStr -and $diskFileTotalByVmId.ContainsKey($vmIdStr)) {
    $v = $diskFileTotalByVmId[$vmIdStr]
    if ($null -ne $v) { $diskFileTotal = [int64]$v }
  }

  $toolsRunning = $null
  $toolsStatus = $null
  try {
    if (Get-Command Get-VMIntegrationService -ErrorAction SilentlyContinue) {
      $kvp = $null
      try {
        $kvp = Get-VMIntegrationService -VMId $_.VMId -Name 'Key-Value Pair Exchange' -ErrorAction Stop | Select-Object -First 1
      } catch {
        try {
          $kvp = Get-VMIntegrationService -VMId $_.VMId -ErrorAction Stop | Where-Object { $_.Name -eq 'Key-Value Pair Exchange' } | Select-Object -First 1
        } catch { $kvp = $null }
      }

      if ($kvp) {
        try { $toolsRunning = [bool]$kvp.Enabled } catch { $toolsRunning = $null }
        try { $toolsStatus = [string]$kvp.PrimaryStatusDescription } catch { $toolsStatus = $null }
      }
    }
  } catch { $toolsRunning = $null; $toolsStatus = $null }

  $vmIps = @()
  $vmMacs = @()
  try {
    if (Get-Command Get-VMNetworkAdapter -ErrorAction SilentlyContinue) {
      $nics = Get-VMNetworkAdapter -VMId $_.VMId -ErrorAction Stop
      foreach ($nic in $nics) {
        try {
          $mac = $null
          try { $mac = Format-MacAddress $nic.MacAddress } catch { $mac = $null }
          if ($mac) { $vmMacs += $mac }
        } catch { }

        try {
          $ips = $null
          try { $ips = $nic.IPAddresses } catch { $ips = $null }
          foreach ($ip in $ips) {
            if ([string]::IsNullOrWhiteSpace([string]$ip)) { continue }
            $s = ([string]$ip).Trim()
            if ($s -match '^[0-9]{1,3}([.][0-9]{1,3}){3}$' -and $s -ne '127.0.0.1' -and $s -ne '0.0.0.0') {
              $vmIps += $s
            }
          }
        } catch { }
      }
    }
  } catch { $vmIps = @(); $vmMacs = @() }

  $vmIps = @($vmIps | Sort-Object -Unique)
  $vmMacs = @($vmMacs | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | Sort-Object -Unique)

  [pscustomobject]@{
    vm_id = $vmIdStr
    name = $_.Name
    state = $_.State.ToString()
    cpu_count = $_.ProcessorCount
    memory_bytes = [int64]$_.MemoryStartup
    ip_addresses = $vmIps
    mac_addresses = $vmMacs
    disks = $vmDisks
    disk_file_size_bytes_total = $diskFileTotal
    tools_running = $toolsRunning
    tools_status = $toolsStatus
  }
}

[pscustomobject]@{ host = $host; vms = $vms } | ConvertTo-Json -Compress -Depth 8
`.trim();

  let nodeResults: Array<{ node: string; host: any; vms: any[] }> = [];
  try {
    nodeResults = await mapLimit(discovery.nodes, maxParallelNodes, async (node) => {
      const nodeOpts = buildWinrmOptionsForHost(baseOpts, node);
      try {
        const payload = await runPowershellJson<{ host: any; vms: any[] }>(
          nodeOpts,
          nodeScript,
          `hyperv.collect.cluster.node.${node}`,
          { runId },
        );

        const vms = Array.isArray(payload.vms) ? payload.vms : [];
        return { node, host: payload.host, vms };
      } catch (err) {
        throw new ClusterNodeCollectError(node, err);
      }
    });
  } catch (err) {
    if (err instanceof ClusterNodeCollectError) {
      const mapped = toHypervError(err.cause, `collect.cluster.node.${err.node}`);
      const withNode: CollectorError = {
        ...mapped,
        redacted_context: { ...(mapped.redacted_context ?? {}), node: err.node },
      };
      const inventoryIncomplete: CollectorError = {
        code: 'INVENTORY_INCOMPLETE',
        category: 'schema',
        message: 'inventory not complete',
        retryable: mapped.retryable,
        redacted_context: { node: err.node },
      };
      return { response: makeResponse({ errors: [withNode, inventoryIncomplete] }), exitCode: 1 };
    }
    return { response: makeResponse({ errors: [toHypervError(err, 'collect.cluster')] }), exitCode: 1 };
  }

  const nodesWithPower = nodeResults.map((r) => {
    const hostName = typeof r.host?.hostname === 'string' ? r.host.hostname.trim() : '';
    const state = discovery.node_states[r.node] ?? (hostName ? discovery.node_states[hostName] : undefined);
    const power_state = mapClusterNodeStateToPowerState(state) ?? 'poweredOn';
    return { ...r, host: { ...(r.host ?? {}), power_state } };
  });

  const built = buildClusterInventory({
    scope: 'cluster',
    cluster_name: discovery.cluster_name,
    nodes: nodesWithPower,
    owner_rows: ownerRows,
  });
  const warnings = computeCollectWarnings(built.assets);
  return {
    response: makeResponse({
      assets: built.assets,
      relations: built.relations,
      stats: { ...built.stats, warnings },
      errors: built.errors,
    }),
    exitCode: built.exitCode,
  };
}

async function collect(request: CollectorRequestV1): Promise<{ response: CollectorResponseV1; exitCode: number }> {
  try {
    const runId = getRunId(request);
    const scope = request.source.config?.scope ?? 'auto';
    if (scope === 'cluster') return await collectCluster(request);
    if (scope === 'auto') {
      // Best-effort: if the entry endpoint is cluster-capable, prefer cluster inventory.
      const opts = buildWinrmOptions(request);
      const discovery = await discoverCluster(opts, { runId }).catch(() => null);
      if (discovery?.is_cluster) return await collectCluster(request);
    }

    return await collectStandalone(request);
  } catch (err) {
    return { response: makeResponse({ errors: [toHypervError(err, 'collect')] }), exitCode: 1 };
  }
}

async function main(): Promise<number> {
  let parsed: unknown;
  try {
    parsed = await readStdinJson();
  } catch {
    const response = makeResponse({
      errors: [{ code: 'HYPERV_PARSE_ERROR', category: 'parse', message: 'invalid input json', retryable: false }],
    });
    process.stdout.write(`${JSON.stringify(response)}\n`);
    return 1;
  }

  const request = parsed as CollectorRequestV1;
  if (request.schema_version !== 'collector-request-v1') {
    const response = makeResponse({
      errors: [
        { code: 'HYPERV_CONFIG_INVALID', category: 'config', message: 'unsupported schema_version', retryable: false },
      ],
    });
    process.stdout.write(`${JSON.stringify(response)}\n`);
    return 1;
  }

  if (request.source.source_type !== 'hyperv') {
    const response = makeResponse({
      errors: [
        { code: 'HYPERV_CONFIG_INVALID', category: 'config', message: 'unsupported source_type', retryable: false },
      ],
    });
    process.stdout.write(`${JSON.stringify(response)}\n`);
    return 1;
  }

  const connectionMethod = getConnectionMethod(request);
  const cfg = request.source.config as any;
  if (connectionMethod === 'agent') {
    const agentUrl = typeof cfg.agent_url === 'string' ? cfg.agent_url.trim() : '';
    if (!agentUrl) {
      const response = makeResponse({
        errors: [{ code: 'HYPERV_CONFIG_INVALID', category: 'config', message: 'missing agent_url', retryable: false }],
      });
      process.stdout.write(`${JSON.stringify(response)}\n`);
      return 1;
    }
  } else {
    const endpoint = typeof cfg.endpoint === 'string' ? cfg.endpoint.trim() : '';
    if (!endpoint) {
      const response = makeResponse({
        errors: [{ code: 'HYPERV_CONFIG_INVALID', category: 'config', message: 'missing endpoint', retryable: false }],
      });
      process.stdout.write(`${JSON.stringify(response)}\n`);
      return 1;
    }
  }

  const mode = request.request?.mode;
  const result =
    mode === 'collect'
      ? connectionMethod === 'agent'
        ? await collectAgent(request)
        : await collect(request)
      : mode === 'detect'
        ? connectionMethod === 'agent'
          ? await detectAgent(request)
          : await detect(request)
        : connectionMethod === 'agent'
          ? await healthcheckAgent(request)
          : await healthcheck(request);

  process.stdout.write(`${JSON.stringify(result.response)}\n`);
  return result.exitCode;
}

process.exitCode = await main();
