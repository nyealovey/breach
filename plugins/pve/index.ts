#!/usr/bin/env bun

import { createPveAuth, pveGet } from './client';
import { normalizeCluster, normalizeHost, normalizeVm } from './normalize';
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

  if (status === 401) {
    return { code: 'PVE_AUTH_FAILED', category: 'auth', message: 'authentication failed', retryable: false };
  }
  if (status === 403) {
    return { code: 'PVE_PERMISSION_DENIED', category: 'permission', message: 'permission denied', retryable: false };
  }
  if (status === 429) {
    return { code: 'PVE_RATE_LIMIT', category: 'rate_limit', message: 'rate limited', retryable: true };
  }

  const cause = err instanceof Error ? err.message : String(err);
  const lower = cause.toLowerCase();

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

async function collect(request: CollectorRequestV1): Promise<{ response: CollectorResponseV1; exitCode: number }> {
  const cfg = request.source.config;
  const endpoint = cfg.endpoint;
  const tlsVerify = cfg.tls_verify ?? true;
  const timeoutMs = cfg.timeout_ms ?? 60_000;
  const maxParallelNodes = clampPositiveInt(cfg.max_parallel_nodes, 5);
  const configuredScope = cfg.scope ?? 'auto';

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

    // Best-effort: cluster discovery.
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

    const clusterMode = configuredScope !== 'standalone' && !!clusterName;

    const nodes = await pveGet<Array<{ node: string }>>({
      endpoint,
      path: '/api2/json/nodes',
      authHeaders: auth.headers,
      tlsVerify,
      timeoutMs,
    });

    const nodeNames = nodes.map((n) => (typeof n?.node === 'string' ? n.node.trim() : '')).filter((n) => n.length > 0);

    const hostStatuses = await mapLimit(nodeNames, maxParallelNodes, async (node) => {
      const status = await pveGet<unknown>({
        endpoint,
        path: `/api2/json/nodes/${encodeURIComponent(node)}/status`,
        authHeaders: auth.headers,
        tlsVerify,
        timeoutMs,
      }).catch(() => null);
      return { node, status };
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

    const hostAssets = hostStatuses.map((r) =>
      normalizeHost({ node: r.node, status: r.status, version: versionString }),
    );
    const vmAssets = vmInputs.map((vm) => normalizeVm(vm));

    const assets = [...(clusterAsset ? [clusterAsset] : []), ...hostAssets, ...vmAssets];

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
  } catch (err) {
    return {
      response: makeResponse({
        errors: [toPveError(err, 'collect')],
        stats: { assets: 0, relations: 0, inventory_complete: false, warnings: [] },
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
