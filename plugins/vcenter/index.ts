#!/usr/bin/env bun

import {
  createSession,
  getVcenterSystemVersion,
  getVmDetail,
  getVmGuestNetworking,
  getVmGuestNetworkingInfo,
  getVmTools,
  listClusters,
  listHosts,
  listHostsByCluster,
  listVMsByHost,
} from './client';
import { buildRelations, normalizeCluster, normalizeHost, normalizeVM } from './normalize';
import { collectHostSoapDetails } from './soap';
import type { CollectorError, CollectorRequestV1, CollectorResponseV1 } from './types';

type PreferredVcenterVersion = '6.5-6.7' | '7.0-8.x';

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
  return { code: 'VCENTER_NETWORK_ERROR', category: 'network', message: 'vcenter request failed', retryable: true };
}

function toVcenterError(err: unknown, stage: string): CollectorError {
  const status = typeof err === 'object' && err && 'status' in err ? (err as { status?: number }).status : undefined;
  const bodyText =
    typeof err === 'object' && err && 'bodyText' in err ? (err as { bodyText?: string }).bodyText : undefined;

  const base = toAuthError(status);
  return {
    ...base,
    redacted_context: {
      stage,
      ...(status ? { status } : {}),
      ...(bodyText ? { body_excerpt: bodyText.slice(0, 500) } : {}),
      cause: err instanceof Error ? err.message : String(err),
    },
  };
}

function parseMajorMinor(version: string): { major: number; minor: number } | null {
  const m = version.trim().match(/^(\d+)\.(\d+)/);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return null;
  return { major, minor };
}

function recommendPreferredVersion(detectedVersion: string | null): PreferredVcenterVersion | null {
  if (!detectedVersion) return null;
  const parsed = parseMajorMinor(detectedVersion);
  if (!parsed) return null;
  if (parsed.major >= 7) return '7.0-8.x';
  return '6.5-6.7';
}

function buildDetectPayload(params: {
  configuredPreferredVersion?: PreferredVcenterVersion;
  detectedVersion: string | null;
  detectedBuild: string | null;
}): Record<string, unknown> {
  const targetVersion = params.detectedVersion
    ? params.detectedBuild
      ? `${params.detectedVersion} (build ${params.detectedBuild})`
      : params.detectedVersion
    : 'unknown';

  const recommended =
    recommendPreferredVersion(params.detectedVersion) ?? params.configuredPreferredVersion ?? '7.0-8.x';
  const driver = `vcenter-${params.configuredPreferredVersion ?? 'auto'}@v1`;

  return {
    target_version: targetVersion,
    capabilities: {
      system_version_endpoint: params.detectedVersion !== null,
      ...(params.detectedBuild ? { build: params.detectedBuild } : {}),
      ...(params.configuredPreferredVersion ? { preferred_vcenter_version: params.configuredPreferredVersion } : {}),
    },
    driver,
    recommended_preferred_version: recommended,
  };
}

function shouldFailRelations(params: {
  mode: 'collect' | 'collect_hosts' | 'collect_vms';
  vmCount: number;
  clusterCount: number;
  relationsCount: number;
}): boolean {
  if (params.relationsCount > 0) return false;

  if (params.mode === 'collect_vms') return params.vmCount > 0;
  if (params.mode === 'collect_hosts') return params.clusterCount > 0;
  // collect: if any VM or Cluster exists, relations must not be empty
  return params.vmCount > 0 || params.clusterCount > 0;
}

function validateVmRequiredFields(assets: CollectorResponseV1['assets']): CollectorError | null {
  for (const asset of assets) {
    if (asset.external_kind !== 'vm') continue;

    const cpu = asset.normalized.hardware?.cpu_count;
    const mem = asset.normalized.hardware?.memory_bytes;
    const power = asset.normalized.runtime?.power_state;

    const missing: string[] = [];
    if (cpu === undefined) missing.push('hardware.cpu_count');
    if (mem === undefined) missing.push('hardware.memory_bytes');
    if (power === undefined) missing.push('runtime.power_state');

    if (missing.length > 0) {
      return {
        code: 'INVENTORY_INCOMPLETE',
        category: 'schema',
        message: 'vm missing required fields',
        retryable: false,
        redacted_context: {
          vm_id: asset.external_id,
          missing_fields: missing,
        },
      };
    }
  }

  return null;
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
    return { response: makeResponse({ errors: [toVcenterError(err, 'healthcheck')] }), exitCode: 1 };
  }
}

async function detect(request: CollectorRequestV1): Promise<{ response: CollectorResponseV1; exitCode: number }> {
  try {
    const endpoint = request.source.config.endpoint;
    const token = await createSession(endpoint, request.source.credential.username, request.source.credential.password);
    if (!token) throw new Error('session token empty');

    const configuredPreferred = request.source.config.preferred_vcenter_version;
    const systemVersion = await getVcenterSystemVersion(endpoint, token);

    const detectedVersion = systemVersion?.version ?? null;
    const detectedBuild = systemVersion?.build ?? null;

    const detectPayload = buildDetectPayload({
      configuredPreferredVersion: configuredPreferred,
      detectedVersion,
      detectedBuild,
    });

    const recommended = detectPayload.recommended_preferred_version as PreferredVcenterVersion;
    if (configuredPreferred && detectedVersion && configuredPreferred !== recommended) {
      return {
        response: makeResponse({
          detect: detectPayload,
          errors: [
            {
              code: 'VCENTER_API_VERSION_UNSUPPORTED',
              category: 'parse',
              message: 'vcenter api version unsupported',
              retryable: false,
              redacted_context: {
                detected_version: detectedVersion,
                preferred_vcenter_version: configuredPreferred,
                recommended_preferred_version: recommended,
              },
            },
          ],
        }),
        exitCode: 1,
      };
    }

    return {
      response: makeResponse({
        detect: detectPayload,
        errors: [],
      }),
      exitCode: 0,
    };
  } catch (err) {
    return { response: makeResponse({ errors: [toVcenterError(err, 'detect')] }), exitCode: 1 };
  }
}

async function collectHosts(request: CollectorRequestV1): Promise<{ response: CollectorResponseV1; exitCode: number }> {
  try {
    const endpoint = request.source.config.endpoint;
    const preferred = request.source.config.preferred_vcenter_version;
    if (!preferred) {
      return {
        response: makeResponse({
          errors: [
            {
              code: 'VCENTER_CONFIG_INVALID',
              category: 'config',
              message: 'missing preferred_vcenter_version',
              retryable: false,
              redacted_context: { mode: 'collect_hosts' },
            },
          ],
        }),
        exitCode: 1,
      };
    }

    const token = await createSession(endpoint, request.source.credential.username, request.source.credential.password);

    const warnings: unknown[] = [];

    const systemVersion = await getVcenterSystemVersion(endpoint, token);
    const detectedVersion = systemVersion?.version ?? null;
    const recommended = recommendPreferredVersion(detectedVersion);
    if (recommended && detectedVersion && recommended !== preferred) {
      const detectPayload = buildDetectPayload({
        configuredPreferredVersion: preferred,
        detectedVersion,
        detectedBuild: systemVersion?.build ?? null,
      });
      return {
        response: makeResponse({
          detect: detectPayload,
          errors: [
            {
              code: 'VCENTER_API_VERSION_UNSUPPORTED',
              category: 'parse',
              message: 'vcenter api version unsupported',
              retryable: false,
              redacted_context: {
                detected_version: detectedVersion,
                preferred_vcenter_version: preferred,
                recommended_preferred_version: recommended,
              },
            },
          ],
          stats: { assets: 0, relations: 0, inventory_complete: false, warnings },
        }),
        exitCode: 1,
      };
    }

    // Hosts + clusters (REST)
    const [hostSummaries, clusters] = await Promise.all([listHosts(endpoint, token), listClusters(endpoint, token)]);

    // Best-effort: fetch Host details via SOAP (vim25). Failures should not abort the whole run.
    const hostSoapPromise = collectHostSoapDetails({
      endpoint,
      username: request.source.credential.username,
      password: request.source.credential.password,
      hostIds: hostSummaries.map((h) => h.host),
      runId: request.request.run_id,
    }).catch((err) => {
      const status =
        typeof err === 'object' && err && 'status' in err ? (err as { status?: number }).status : undefined;
      const bodyText =
        typeof err === 'object' && err && 'bodyText' in err ? (err as { bodyText?: string }).bodyText : undefined;
      warnings.push({
        code: 'VCENTER_SOAP_FAILED',
        category: 'network',
        message: 'failed to collect host details via SOAP; host fields may be missing',
        redacted_context: {
          stage: 'soap_collect',
          ...(status ? { status } : {}),
          ...(bodyText ? { body_excerpt: bodyText.slice(0, 500) } : {}),
          cause: err instanceof Error ? err.message : String(err),
        },
      });
      return new Map();
    });

    // Build Host-to-Cluster mapping by querying Hosts per cluster
    const hostToClusterMap = new Map<string, string>();
    await Promise.all(
      clusters.map(async (cluster) => {
        const hostsInCluster = await listHostsByCluster(endpoint, token, cluster.cluster);
        for (const host of hostsInCluster) hostToClusterMap.set(host.host, cluster.cluster);
      }),
    );

    const hostSoapDetails = await hostSoapPromise;
    const hostDetails = hostSummaries.map((hostSummary) => {
      const soap = hostSoapDetails.get(hostSummary.host);
      if (!soap) {
        warnings.push({
          code: 'VCENTER_HOST_SOAP_MISSING',
          category: 'parse',
          message: 'missing SOAP host details; some fields may be empty',
          redacted_context: { host_id: hostSummary.host },
        });
      }

      // Validate and warn on missing/invalid diskTotalBytes (best-effort; no fallback).
      const diskTotalBytes = soap?.diskTotalBytes;
      if (soap && diskTotalBytes === undefined) {
        warnings.push({
          code: 'VCENTER_HOST_DISK_TOTAL_MISSING',
          category: 'parse',
          message: 'failed to compute local disk total bytes for host',
          redacted_context: { host_id: hostSummary.host, field: 'attributes.disk_total_bytes' },
        });
      }

      // Validate and warn on missing datastoreTotalBytes (best-effort).
      const datastoreTotalBytes = soap?.datastoreTotalBytes;
      if (soap && datastoreTotalBytes === undefined) {
        warnings.push({
          code: 'VCENTER_HOST_DATASTORE_TOTAL_MISSING',
          category: 'parse',
          message: 'failed to compute datastore total bytes for host',
          redacted_context: { host_id: hostSummary.host, field: 'attributes.datastore_total_bytes' },
        });
      }

      // Validate and warn on missing datastore breakdown (best-effort).
      const datastores = soap?.datastores;
      if (soap && datastores === undefined) {
        warnings.push({
          code: 'VCENTER_HOST_DATASTORES_MISSING',
          category: 'parse',
          message: 'failed to collect datastore breakdown for host',
          redacted_context: { host_id: hostSummary.host, field: 'storage.datastores' },
        });
      }

      return {
        ...hostSummary,
        cluster: hostToClusterMap.get(hostSummary.host),
        soap,
      } as Record<string, unknown>;
    });

    const hostAssets = hostDetails.map((host) => normalizeHost(host as any));
    const clusterAssets = clusters.map((cluster) => normalizeCluster(cluster as any));

    const assets = [...hostAssets, ...clusterAssets];
    const relations = buildRelations([], hostDetails as any, clusters as any);

    if (
      shouldFailRelations({
        mode: 'collect_hosts',
        vmCount: 0,
        clusterCount: clusters.length,
        relationsCount: relations.length,
      })
    ) {
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
              redacted_context: { mode: 'collect_hosts', assets: assets.length, clusters: clusters.length },
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
        errors: [toVcenterError(err, 'collect_hosts')],
        stats: { assets: 0, relations: 0, inventory_complete: false, warnings: [] },
      }),
      exitCode: 1,
    };
  }
}

async function collectVMs(request: CollectorRequestV1): Promise<{ response: CollectorResponseV1; exitCode: number }> {
  try {
    const endpoint = request.source.config.endpoint;
    const preferred = request.source.config.preferred_vcenter_version;
    if (!preferred) {
      return {
        response: makeResponse({
          errors: [
            {
              code: 'VCENTER_CONFIG_INVALID',
              category: 'config',
              message: 'missing preferred_vcenter_version',
              retryable: false,
              redacted_context: { mode: 'collect_vms' },
            },
          ],
        }),
        exitCode: 1,
      };
    }

    const token = await createSession(endpoint, request.source.credential.username, request.source.credential.password);

    const systemVersion = await getVcenterSystemVersion(endpoint, token);
    const detectedVersion = systemVersion?.version ?? null;
    const recommended = recommendPreferredVersion(detectedVersion);
    if (recommended && detectedVersion && recommended !== preferred) {
      const detectPayload = buildDetectPayload({
        configuredPreferredVersion: preferred,
        detectedVersion,
        detectedBuild: systemVersion?.build ?? null,
      });
      return {
        response: makeResponse({
          detect: detectPayload,
          errors: [
            {
              code: 'VCENTER_API_VERSION_UNSUPPORTED',
              category: 'parse',
              message: 'vcenter api version unsupported',
              retryable: false,
              redacted_context: {
                detected_version: detectedVersion,
                preferred_vcenter_version: preferred,
                recommended_preferred_version: recommended,
              },
            },
          ],
          stats: { assets: 0, relations: 0, inventory_complete: false, warnings: [] },
        }),
        exitCode: 1,
      };
    }

    // VMs only (REST). No SOAP in this mode.
    const hostSummaries = await listHosts(endpoint, token);

    const vmToHostMap = new Map<string, string>();
    const allVmIds = new Set<string>();

    await Promise.all(
      hostSummaries.map(async (host) => {
        const vmsOnHost = await listVMsByHost(endpoint, token, host.host);
        for (const vm of vmsOnHost) {
          vmToHostMap.set(vm.vm, host.host);
          allVmIds.add(vm.vm);
        }
      }),
    );

    const vmDetails = await Promise.all(
      Array.from(allVmIds).map(async (vmId) => {
        const [detail, guestNetworking, guestNetworkingInfo, tools] = await Promise.all([
          getVmDetail(endpoint, token, vmId),
          getVmGuestNetworking(endpoint, token, vmId),
          getVmGuestNetworkingInfo(endpoint, token, vmId),
          getVmTools(endpoint, token, vmId),
        ]);
        return {
          ...(detail as Record<string, unknown>),
          vm: vmId,
          host: vmToHostMap.get(vmId),
          guest_networking: guestNetworking,
          guest_networking_info: guestNetworkingInfo,
          tools,
        };
      }),
    );

    const assets = vmDetails.map((vm) => normalizeVM(vm as any));
    const relations = buildRelations(vmDetails as any, hostSummaries as any, []);

    const requiredError = validateVmRequiredFields(assets);
    if (requiredError) {
      return {
        response: makeResponse({
          assets,
          relations,
          stats: { assets: assets.length, relations: relations.length, inventory_complete: false, warnings: [] },
          errors: [requiredError],
        }),
        exitCode: 1,
      };
    }

    if (
      shouldFailRelations({
        mode: 'collect_vms',
        vmCount: vmDetails.length,
        clusterCount: 0,
        relationsCount: relations.length,
      })
    ) {
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
              redacted_context: { mode: 'collect_vms', assets: assets.length, vms: vmDetails.length },
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
        errors: [toVcenterError(err, 'collect_vms')],
        stats: { assets: 0, relations: 0, inventory_complete: false, warnings: [] },
      }),
      exitCode: 1,
    };
  }
}

async function collect(request: CollectorRequestV1): Promise<{ response: CollectorResponseV1; exitCode: number }> {
  try {
    const endpoint = request.source.config.endpoint;
    const preferred = request.source.config.preferred_vcenter_version;
    if (!preferred) {
      return {
        response: makeResponse({
          errors: [
            {
              code: 'VCENTER_CONFIG_INVALID',
              category: 'config',
              message: 'missing preferred_vcenter_version',
              retryable: false,
              redacted_context: { mode: 'collect' },
            },
          ],
        }),
        exitCode: 1,
      };
    }

    const token = await createSession(endpoint, request.source.credential.username, request.source.credential.password);

    const warnings: unknown[] = [];

    const systemVersion = await getVcenterSystemVersion(endpoint, token);
    const detectedVersion = systemVersion?.version ?? null;
    const recommended = recommendPreferredVersion(detectedVersion);
    if (recommended && detectedVersion && recommended !== preferred) {
      const detectPayload = buildDetectPayload({
        configuredPreferredVersion: preferred,
        detectedVersion,
        detectedBuild: systemVersion?.build ?? null,
      });
      return {
        response: makeResponse({
          detect: detectPayload,
          errors: [
            {
              code: 'VCENTER_API_VERSION_UNSUPPORTED',
              category: 'parse',
              message: 'vcenter api version unsupported',
              retryable: false,
              redacted_context: {
                detected_version: detectedVersion,
                preferred_vcenter_version: preferred,
                recommended_preferred_version: recommended,
              },
            },
          ],
          stats: { assets: 0, relations: 0, inventory_complete: false, warnings },
        }),
        exitCode: 1,
      };
    }

    // First, get hosts and clusters
    const [hostSummaries, clusters] = await Promise.all([listHosts(endpoint, token), listClusters(endpoint, token)]);

    // Best-effort: fetch Host details via SOAP (vim25). Failures should not abort the whole run.
    const hostSoapPromise = collectHostSoapDetails({
      endpoint,
      username: request.source.credential.username,
      password: request.source.credential.password,
      hostIds: hostSummaries.map((h) => h.host),
      runId: request.request.run_id,
    }).catch((err) => {
      const status =
        typeof err === 'object' && err && 'status' in err ? (err as { status?: number }).status : undefined;
      const bodyText =
        typeof err === 'object' && err && 'bodyText' in err ? (err as { bodyText?: string }).bodyText : undefined;
      warnings.push({
        code: 'VCENTER_SOAP_FAILED',
        category: 'network',
        message: 'failed to collect host details via SOAP; host fields may be missing',
        redacted_context: {
          stage: 'soap_collect',
          ...(status ? { status } : {}),
          ...(bodyText ? { body_excerpt: bodyText.slice(0, 500) } : {}),
          cause: err instanceof Error ? err.message : String(err),
        },
      });
      return new Map();
    });

    // Build Host-to-Cluster mapping by querying Hosts per cluster
    // This is the only way to get Host-Cluster relationships via vSphere REST API
    const hostToClusterMap = new Map<string, string>();
    await Promise.all(
      clusters.map(async (cluster) => {
        const hostsInCluster = await listHostsByCluster(endpoint, token, cluster.cluster);
        for (const host of hostsInCluster) {
          hostToClusterMap.set(host.host, cluster.cluster);
        }
      }),
    );

    // Build VM-to-Host mapping by querying VMs per host
    // This is the only way to get VM-Host relationships via vSphere REST API
    // @see https://developer.broadcom.com/xapis/vsphere-automation-api/v7.0U2/vcenter/api/vcenter/vm/get/
    const vmToHostMap = new Map<string, string>();
    const allVmIds = new Set<string>();

    await Promise.all(
      hostSummaries.map(async (host) => {
        const vmsOnHost = await listVMsByHost(endpoint, token, host.host);
        for (const vm of vmsOnHost) {
          vmToHostMap.set(vm.vm, host.host);
          allVmIds.add(vm.vm);
        }
      }),
    );

    // Get VM details with host info injected
    const vmDetails = await Promise.all(
      Array.from(allVmIds).map(async (vmId) => {
        const [detail, guestNetworking, guestNetworkingInfo, tools] = await Promise.all([
          getVmDetail(endpoint, token, vmId),
          getVmGuestNetworking(endpoint, token, vmId),
          getVmGuestNetworkingInfo(endpoint, token, vmId),
          getVmTools(endpoint, token, vmId),
        ]);
        return {
          ...(detail as Record<string, unknown>),
          vm: vmId,
          host: vmToHostMap.get(vmId), // Inject host relationship
          guest_networking: guestNetworking,
          guest_networking_info: guestNetworkingInfo, // Inject guest hostname info
          tools: tools, // Inject VMware Tools status
        };
      }),
    );

    // Get Host details with cluster info injected
    const hostSoapDetails = await hostSoapPromise;
    const hostDetails = hostSummaries.map((hostSummary) => {
      const soap = hostSoapDetails.get(hostSummary.host);
      if (!soap) {
        warnings.push({
          code: 'VCENTER_HOST_SOAP_MISSING',
          category: 'parse',
          message: 'missing SOAP host details; some fields may be empty',
          redacted_context: { host_id: hostSummary.host },
        });
      }

      // Validate and warn on missing/invalid diskTotalBytes (best-effort; no fallback).
      const diskTotalBytes = soap?.diskTotalBytes;
      if (soap && diskTotalBytes === undefined) {
        warnings.push({
          code: 'VCENTER_HOST_DISK_TOTAL_MISSING',
          category: 'parse',
          message: 'failed to compute local disk total bytes for host',
          redacted_context: { host_id: hostSummary.host, field: 'attributes.disk_total_bytes' },
        });
      }

      // Validate and warn on missing datastoreTotalBytes (best-effort).
      const datastoreTotalBytes = soap?.datastoreTotalBytes;
      if (soap && datastoreTotalBytes === undefined) {
        warnings.push({
          code: 'VCENTER_HOST_DATASTORE_TOTAL_MISSING',
          category: 'parse',
          message: 'failed to compute datastore total bytes for host',
          redacted_context: { host_id: hostSummary.host, field: 'attributes.datastore_total_bytes' },
        });
      }

      // Validate and warn on missing datastore breakdown (best-effort).
      const datastores = soap?.datastores;
      if (soap && datastores === undefined) {
        warnings.push({
          code: 'VCENTER_HOST_DATASTORES_MISSING',
          category: 'parse',
          message: 'failed to collect datastore breakdown for host',
          redacted_context: { host_id: hostSummary.host, field: 'storage.datastores' },
        });
      }

      return {
        ...hostSummary,
        cluster: hostToClusterMap.get(hostSummary.host), // Inject cluster relationship
        soap,
      } as Record<string, unknown>;
    });

    const vmAssets = vmDetails.map((vm) => normalizeVM(vm as any));
    const hostAssets = hostDetails.map((host) => normalizeHost(host as any));
    const clusterAssets = clusters.map((cluster) => normalizeCluster(cluster as any));

    const assets = [...vmAssets, ...hostAssets, ...clusterAssets];
    const relations = buildRelations(vmDetails as any, hostDetails as any, clusters as any);

    const requiredError = validateVmRequiredFields(assets);
    if (requiredError) {
      return {
        response: makeResponse({
          assets,
          relations,
          stats: { assets: assets.length, relations: relations.length, inventory_complete: false, warnings },
          errors: [requiredError],
        }),
        exitCode: 1,
      };
    }

    if (
      shouldFailRelations({
        mode: 'collect',
        vmCount: vmDetails.length,
        clusterCount: clusters.length,
        relationsCount: relations.length,
      })
    ) {
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
              redacted_context: {
                mode: 'collect',
                assets: assets.length,
                vms: vmDetails.length,
                clusters: clusters.length,
              },
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
        errors: [toVcenterError(err, 'collect')],
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
    mode === 'collect_hosts'
      ? await collectHosts(request)
      : mode === 'collect_vms'
        ? await collectVMs(request)
        : mode === 'collect'
          ? await collect(request)
          : mode === 'detect'
            ? await detect(request)
            : await healthcheck(request);

  process.stdout.write(`${JSON.stringify(result.response)}\n`);
  return result.exitCode;
}

process.exitCode = await main();
