#!/usr/bin/env bun

import { createSession, getHostDetail, getVmDetail, listClusters, listHosts, listVMs } from './client';
import { buildRelations, normalizeCluster, normalizeHost, normalizeVM } from './normalize';
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

function toAuthError(status: number | undefined): CollectorError {
  if (status === 401) {
    return { code: 'VCENTER_AUTH_FAILED', category: 'auth', message: 'authentication failed', retryable: false };
  }
  if (status === 403) {
    return {
      code: 'VCENTER_PERMISSION_DENIED',
      category: 'permission',
      message: 'permission denied',
      retryable: false,
    };
  }
  return { code: 'VCENTER_NETWORK_ERROR', category: 'network', message: 'failed to create session', retryable: true };
}

async function healthcheck(request: CollectorRequestV1): Promise<{ response: CollectorResponseV1; exitCode: number }> {
  try {
    const token = await createSession(
      request.source.config.endpoint,
      request.source.credential.username,
      request.source.credential.password,
    );
    // Ensure token is used (avoids lint about unused and keeps intent explicit).
    if (!token) throw new Error('session token empty');
    return { response: makeResponse({ errors: [] }), exitCode: 0 };
  } catch (err) {
    const status = (err as { status?: number }).status;
    return { response: makeResponse({ errors: [toAuthError(status)] }), exitCode: 1 };
  }
}

async function detect(request: CollectorRequestV1): Promise<{ response: CollectorResponseV1; exitCode: number }> {
  try {
    const token = await createSession(
      request.source.config.endpoint,
      request.source.credential.username,
      request.source.credential.password,
    );
    if (!token) throw new Error('session token empty');

    return {
      response: makeResponse({
        detect: { target_version: 'unknown', capabilities: {}, driver: 'vcenter@v1' },
        errors: [],
      }),
      exitCode: 0,
    };
  } catch (err) {
    const status = (err as { status?: number }).status;
    return { response: makeResponse({ errors: [toAuthError(status)] }), exitCode: 1 };
  }
}

async function collect(request: CollectorRequestV1): Promise<{ response: CollectorResponseV1; exitCode: number }> {
  try {
    const endpoint = request.source.config.endpoint;
    const token = await createSession(endpoint, request.source.credential.username, request.source.credential.password);

    const [vmSummaries, hostSummaries, clusters] = await Promise.all([
      listVMs(endpoint, token),
      listHosts(endpoint, token),
      listClusters(endpoint, token),
    ]);

    const [vmDetails, hostDetails] = await Promise.all([
      Promise.all(vmSummaries.map((vm) => getVmDetail(endpoint, token, vm.vm))),
      Promise.all(hostSummaries.map((host) => getHostDetail(endpoint, token, host.host))),
    ]);

    const vmAssets = vmDetails.map((vm) => normalizeVM(vm as any));
    const hostAssets = hostDetails.map((host) => normalizeHost(host as any));
    const clusterAssets = clusters.map((cluster) => normalizeCluster(cluster as any));

    const assets = [...vmAssets, ...hostAssets, ...clusterAssets];
    const relations = buildRelations(vmDetails as any, hostDetails as any, clusters as any);

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
    const status = (err as { status?: number }).status;
    return {
      response: makeResponse({
        errors: [toAuthError(status)],
        stats: { assets: 0, relations: 0, inventory_complete: false, warnings: [] },
      }),
      exitCode: 1,
    };
  }
}

async function main(): Promise<number> {
  // v1.0 allows self-signed certs. We intentionally disable TLS verification for plugin requests.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

  let parsed: unknown;
  try {
    parsed = await readStdinJson();
  } catch {
    const response = makeResponse({
      errors: [{ code: 'VCENTER_PARSE_ERROR', category: 'parse', message: 'invalid input json', retryable: false }],
    });
    process.stdout.write(`${JSON.stringify(response)}\n`);
    return 1;
  }

  const request = parsed as CollectorRequestV1;
  if (request.schema_version !== 'collector-request-v1') {
    const response = makeResponse({
      errors: [
        { code: 'VCENTER_CONFIG_INVALID', category: 'config', message: 'unsupported schema_version', retryable: false },
      ],
    });
    process.stdout.write(`${JSON.stringify(response)}\n`);
    return 1;
  }

  if (request.source.source_type !== 'vcenter') {
    const response = makeResponse({
      errors: [
        { code: 'VCENTER_CONFIG_INVALID', category: 'config', message: 'unsupported source_type', retryable: false },
      ],
    });
    process.stdout.write(`${JSON.stringify(response)}\n`);
    return 1;
  }

  if (!request.source.config?.endpoint) {
    const response = makeResponse({
      errors: [{ code: 'VCENTER_CONFIG_INVALID', category: 'config', message: 'missing endpoint', retryable: false }],
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
