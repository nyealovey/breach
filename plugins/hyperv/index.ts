#!/usr/bin/env bun

import { runPowershellJson, runPowershellWithTimeout } from './client';
import { normalizeKerberosServiceName } from './kerberos-spn';
import { normalizeCluster, normalizeHost, normalizeVm } from './normalize';
import type { CollectorError, CollectorRequestV1, CollectorResponseV1, HypervCredential } from './types';

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

function toWinrmUsername(cred: HypervCredential): string {
  const username = (cred.username ?? '').trim();
  const domain = typeof cred.domain === 'string' ? cred.domain.trim() : '';
  if (!domain) return username;
  // legacy（winrm-client）使用 "DOMAIN\\user" 触发 NTLM
  return `${domain}\\${username}`;
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

function buildWinrmOptions(request: CollectorRequestV1) {
  const cfg = request.source.config ?? ({} as any);
  const endpoint = (cfg.endpoint ?? '').trim();
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

  const cred = request.source.credential as HypervCredential;
  const rawUsername = (cred.username ?? '').trim();
  const password = (cred.password ?? '').trim();
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

  const kerberosServiceName = normalizeKerberosServiceName(
    typeof cfg.kerberos_service_name === 'string' ? cfg.kerberos_service_name : undefined,
  );
  const kerberosSpnFallback = typeof cfg.kerberos_spn_fallback === 'boolean' ? cfg.kerberos_spn_fallback : false;
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

  const payload = await runPowershellJson<{ host: any; vms: any[] }>(opts, script, 'hyperv.collect', { runId });

  const hostAsset = normalizeHost(payload.host);
  const vmAssets = (Array.isArray(payload.vms) ? payload.vms : []).map((vm) => normalizeVm(vm));

  const assets = [hostAsset, ...vmAssets];
  const relations = vmAssets.flatMap((vm) => [
    {
      type: 'runs_on' as const,
      from: { external_kind: 'vm' as const, external_id: vm.external_id },
      to: { external_kind: 'host' as const, external_id: hostAsset.external_id },
      raw_payload: { type: 'runs_on', vm_external_id: vm.external_id, host_external_id: hostAsset.external_id },
    },
    {
      type: 'hosts_vm' as const,
      from: { external_kind: 'host' as const, external_id: hostAsset.external_id },
      to: { external_kind: 'vm' as const, external_id: vm.external_id },
      raw_payload: { type: 'hosts_vm', vm_external_id: vm.external_id, host_external_id: hostAsset.external_id },
    },
  ]);

  if (relations.length === 0) {
    return {
      response: makeResponse({
        assets,
        relations,
        stats: { assets: assets.length, relations: relations.length, inventory_complete: false, warnings: [] },
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
      stats: { assets: assets.length, relations: relations.length, inventory_complete: true, warnings: [] },
      errors: [],
    }),
    exitCode: 0,
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

  const clusterAsset = normalizeCluster({ name: discovery.cluster_name });

  // Best-effort: map VM Name -> OwnerNode from cluster groups.
  const ownerRows = await listClusterVmOwners(baseOpts, { runId });
  const ownerByName = new Map<string, string>();
  for (const row of ownerRows) {
    if (row.owner_node) ownerByName.set(row.name, row.owner_node);
  }

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

  let nodeResults: Array<{ node: string; hostAsset: ReturnType<typeof normalizeHost>; vmEntries: any[] }> = [];
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

        const hostAsset = normalizeHost(payload.host);
        const vmEntries = Array.isArray(payload.vms) ? payload.vms : [];
        return { node, hostAsset, vmEntries };
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

  const hostAssets = nodeResults.map((r) => r.hostAsset);

  // Build a key->hostExternalId mapping for best-effort VM owner mapping.
  const hostIdByNode = new Map<string, string>();
  for (const r of nodeResults) {
    hostIdByNode.set(r.node, r.hostAsset.external_id);
    const hn =
      r.hostAsset.normalized.identity?.hostname && r.hostAsset.normalized.identity.hostname.trim().length > 0
        ? r.hostAsset.normalized.identity.hostname.trim()
        : null;
    if (hn) hostIdByNode.set(hn, r.hostAsset.external_id);
  }

  // Flatten VM entries with their observed node; then dedupe by vm_id (prefer owner node when available).
  const vmCandidates = nodeResults.flatMap((r) =>
    (Array.isArray(r.vmEntries) ? r.vmEntries : []).map((vm) => ({ node: r.node, vm })),
  );
  const picked = new Map<string, { node: string; vm: any }>();
  for (const c of vmCandidates) {
    const vmId = c && c.vm && typeof c.vm.vm_id === 'string' ? c.vm.vm_id : '';
    if (!vmId) continue;

    const vmName = typeof c.vm.name === 'string' ? c.vm.name : '';
    const preferredNode = vmName && ownerByName.has(vmName) ? ownerByName.get(vmName)! : null;

    if (!picked.has(vmId)) {
      picked.set(vmId, c);
      continue;
    }
    if (preferredNode && c.node === preferredNode) {
      picked.set(vmId, c);
    }
  }

  const vmAssets = Array.from(picked.values()).map((c) => normalizeVm(c.vm));

  const memberOfRelations = hostAssets.map((host) => ({
    type: 'member_of' as const,
    from: { external_kind: 'host' as const, external_id: host.external_id },
    to: { external_kind: 'cluster' as const, external_id: clusterAsset.external_id },
    raw_payload: { type: 'member_of', host_external_id: host.external_id, cluster: clusterAsset.external_id },
  }));

  const runsOnRelations = Array.from(picked.values())
    .map((c) => {
      const vmId = typeof c.vm?.vm_id === 'string' ? c.vm.vm_id : null;
      if (!vmId) return null;
      const vmName = typeof c.vm?.name === 'string' ? c.vm.name : null;
      const ownerNode = vmName && ownerByName.has(vmName) ? ownerByName.get(vmName)! : c.node;
      const hostExternalId = hostIdByNode.get(ownerNode) ?? hostIdByNode.get(c.node) ?? null;
      if (!hostExternalId) return null;
      return {
        type: 'runs_on' as const,
        from: { external_kind: 'vm' as const, external_id: vmId },
        to: { external_kind: 'host' as const, external_id: hostExternalId },
        raw_payload: { type: 'runs_on', vm_external_id: vmId, owner_node: ownerNode },
      };
    })
    .filter((r): r is NonNullable<typeof r> => !!r);

  const hostsVmRelations = runsOnRelations.map((r) => ({
    type: 'hosts_vm' as const,
    from: { external_kind: 'host' as const, external_id: r.to.external_id },
    to: { external_kind: 'vm' as const, external_id: r.from.external_id },
    raw_payload: { type: 'hosts_vm', vm_external_id: r.from.external_id, host_external_id: r.to.external_id },
  }));

  const assets = [clusterAsset, ...hostAssets, ...vmAssets];
  const relations = [...memberOfRelations, ...runsOnRelations, ...hostsVmRelations];

  if (relations.length === 0) {
    return {
      response: makeResponse({
        assets,
        relations,
        stats: { assets: assets.length, relations: relations.length, inventory_complete: false, warnings: [] },
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
      stats: { assets: assets.length, relations: relations.length, inventory_complete: true, warnings: [] },
      errors: [],
    }),
    exitCode: 0,
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

  if (!request.source.config?.endpoint) {
    const response = makeResponse({
      errors: [{ code: 'HYPERV_CONFIG_INVALID', category: 'config', message: 'missing endpoint', retryable: false }],
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
