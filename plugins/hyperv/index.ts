#!/usr/bin/env bun

import { HypervAgentClientError, postAgentJson } from './agent-client';
import { runPowershellJson, runPowershellWithTimeout } from './client';
import { buildClusterInventory, buildStandaloneInventory } from './inventory';
import { normalizeKerberosServiceName } from './kerberos-spn';
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

    return {
      response: makeResponse({
        assets: built.assets,
        relations: built.relations,
        stats: built.stats,
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
$err = $null
try {
  if (Get-Command Get-Cluster -ErrorAction Stop) {
    $c = Get-Cluster -ErrorAction Stop
    $isCluster = $true
    $clusterName = $c.Name
    try { $nodes = Get-ClusterNode -ErrorAction Stop | ForEach-Object { $_.Name } } catch { $nodes = @() }
  }
} catch {
  $err = $_.Exception.Message
}
[pscustomobject]@{ is_cluster = $isCluster; cluster_name = $clusterName; nodes = $nodes; error = $err } | ConvertTo-Json -Compress -Depth 6
`.trim();

  const raw = await runPowershellJson<Record<string, unknown>>(opts, script, 'hyperv.cluster.discovery', meta);
  const nodes =
    raw && typeof raw === 'object' && 'nodes' in raw && Array.isArray((raw as any).nodes)
      ? ((raw as any).nodes as unknown[])
          .map((v) => (typeof v === 'string' ? v.trim() : ''))
          .filter((v) => v.length > 0)
      : [];

  return {
    is_cluster: !!(raw && typeof raw === 'object' && (raw as any).is_cluster === true),
    cluster_name:
      raw && typeof raw === 'object' && typeof (raw as any).cluster_name === 'string'
        ? (raw as any).cluster_name
        : null,
    nodes,
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

$hostName = $env:COMPUTERNAME
$bios = $null
try { $bios = Get-CimInstance -ClassName Win32_BIOS -ErrorAction Stop | Select-Object -First 1 } catch { $bios = $null }
$cs = $null
try { $cs = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop | Select-Object -First 1 } catch { $cs = $null }
$csp = $null
try { $csp = Get-CimInstance -ClassName Win32_ComputerSystemProduct -ErrorAction Stop | Select-Object -First 1 } catch { $csp = $null }
$os = $null
try { $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop | Select-Object -First 1 } catch { $os = $null }

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
}

$vms = @()
try {
  $vms = Get-VM -ErrorAction Stop | ForEach-Object {
    [pscustomobject]@{
      vm_id = [string]$_.VMId
      name = $_.Name
      state = $_.State.ToString()
      cpu_count = $_.ProcessorCount
      memory_bytes = [int64]$_.MemoryStartup
    }
  }
} catch {
  throw
}

[pscustomobject]@{ host = $host; vms = $vms } | ConvertTo-Json -Compress -Depth 6
`.trim();

  const payload = await runPowershellJson<unknown>(opts, script, 'hyperv.collect', { runId });
  const built = buildStandaloneInventory(payload);
  return {
    response: makeResponse({
      assets: built.assets,
      relations: built.relations,
      stats: built.stats,
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

$hostName = $env:COMPUTERNAME
$bios = $null
try { $bios = Get-CimInstance -ClassName Win32_BIOS -ErrorAction Stop | Select-Object -First 1 } catch { $bios = $null }
$cs = $null
try { $cs = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop | Select-Object -First 1 } catch { $cs = $null }
$csp = $null
try { $csp = Get-CimInstance -ClassName Win32_ComputerSystemProduct -ErrorAction Stop | Select-Object -First 1 } catch { $csp = $null }
$os = $null
try { $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop | Select-Object -First 1 } catch { $os = $null }

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
}

$vms = @()
$vms = Get-VM -ErrorAction Stop | ForEach-Object {
  [pscustomobject]@{
    vm_id = [string]$_.VMId
    name = $_.Name
    state = $_.State.ToString()
    cpu_count = $_.ProcessorCount
    memory_bytes = [int64]$_.MemoryStartup
  }
}

[pscustomobject]@{ host = $host; vms = $vms } | ConvertTo-Json -Compress -Depth 6
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

  const built = buildClusterInventory({
    scope: 'cluster',
    cluster_name: discovery.cluster_name,
    nodes: nodeResults,
    owner_rows: ownerRows,
  });
  return {
    response: makeResponse({
      assets: built.assets,
      relations: built.relations,
      stats: built.stats,
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
