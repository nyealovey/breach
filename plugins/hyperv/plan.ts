import type { CollectorError, CollectorRequestV1, CollectorResponseV1 } from './types';

export type HypervCollectPlan =
  | { kind: 'winrm'; scope: 'standalone' | 'cluster'; auth_method: 'kerberos' | 'ntlm' | 'basic' }
  | { kind: 'agent'; scope: 'standalone' | 'cluster' };

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

function configInvalid(
  details: string,
  redacted_context?: Record<string, unknown>,
): {
  ok: false;
  response: CollectorResponseV1;
  exitCode: 1;
} {
  const error: CollectorError = {
    code: 'HYPERV_CONFIG_INVALID',
    category: 'config',
    message: details,
    retryable: false,
    ...(redacted_context ? { redacted_context } : {}),
  };
  return { ok: false, response: makeResponse({ errors: [error] }), exitCode: 1 };
}

function asCollectScope(value: unknown): 'standalone' | 'cluster' | null {
  return value === 'standalone' || value === 'cluster' ? value : null;
}

function asExplicitAuthMethod(value: unknown): 'kerberos' | 'ntlm' | 'basic' | null {
  return value === 'kerberos' || value === 'ntlm' || value === 'basic' ? value : null;
}

/**
 * Strict collect plan:
 * - scope must be explicit (no auto)
 * - winrm auth_method must be explicit (no auto)
 */
export function resolveHypervCollectPlan(
  request: CollectorRequestV1,
): { ok: true; plan: HypervCollectPlan } | { ok: false; response: CollectorResponseV1; exitCode: 1 } {
  const cfg: any = request.source.config as any;
  const kind: 'winrm' | 'agent' = cfg?.connection_method === 'agent' ? 'agent' : 'winrm';

  const scope = asCollectScope(cfg?.scope);
  if (!scope) {
    return configInvalid('scope must be explicit for collect (auto not allowed)', {
      field: 'scope',
      value: cfg?.scope ?? null,
    });
  }

  if (kind === 'agent') return { ok: true, plan: { kind: 'agent', scope } };

  const auth_method = asExplicitAuthMethod(cfg?.auth_method);
  if (!auth_method) {
    return configInvalid('auth_method must be explicit for collect (auto not allowed)', {
      field: 'auth_method',
      value: cfg?.auth_method ?? null,
    });
  }

  return { ok: true, plan: { kind: 'winrm', scope, auth_method } };
}
