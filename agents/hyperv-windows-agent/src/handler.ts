import { isAuthorized } from './auth';
import { PowerShellExecError, PowerShellParseError } from './powershell';

export type HypervAgentMode = 'healthcheck' | 'detect' | 'collect';
export type HypervAgentScope = 'auto' | 'standalone' | 'cluster';

export type HypervAgentRequest = {
  source_id: string;
  run_id: string;
  mode: HypervAgentMode;
  now: string;
  scope: HypervAgentScope;
  max_parallel_nodes: number;
};

export type HypervAgentDeps = {
  run: (mode: HypervAgentMode, input: HypervAgentRequest) => Promise<unknown>;
};

type AgentOk<T> = { ok: true; data: T };
type AgentErr = { ok: false; error: { code: string; message: string; context?: Record<string, unknown> } };

function json(status: number, body: AgentOk<unknown> | AgentErr): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function nonEmptyString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function asScope(v: unknown): HypervAgentScope | null {
  return v === 'auto' || v === 'standalone' || v === 'cluster' ? v : null;
}

function asMode(v: unknown): HypervAgentMode | null {
  return v === 'healthcheck' || v === 'detect' || v === 'collect' ? v : null;
}

function excerpt(text: string, limit = 500): string {
  const trimmed = text.trim();
  return trimmed.length > limit ? trimmed.slice(0, limit) : trimmed;
}

function looksLikePermissionDenied(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('access is denied') ||
    lower.includes('unauthorizedaccessexception') ||
    lower.includes('e_accessdenied')
  );
}

function parseRequestBody(
  raw: unknown,
  routeMode: HypervAgentMode,
): { ok: true; value: HypervAgentRequest } | { ok: false; error: AgentErr } {
  if (!isRecord(raw)) {
    return {
      ok: false,
      error: { ok: false, error: { code: 'AGENT_INVALID_REQUEST', message: 'invalid request body' } },
    };
  }

  const source_id = nonEmptyString(raw.source_id);
  const run_id = nonEmptyString(raw.run_id);
  const now = nonEmptyString(raw.now);
  const scope = asScope(raw.scope);
  const max_parallel_nodes =
    typeof raw.max_parallel_nodes === 'number' &&
    Number.isFinite(raw.max_parallel_nodes) &&
    Number.isInteger(raw.max_parallel_nodes) &&
    raw.max_parallel_nodes > 0
      ? raw.max_parallel_nodes
      : 5;

  if (!source_id || !run_id || !now || !scope) {
    return {
      ok: false,
      error: {
        ok: false,
        error: {
          code: 'AGENT_INVALID_REQUEST',
          message: 'missing required fields',
          context: {
            ...(source_id ? {} : { missing: 'source_id' }),
            ...(run_id ? {} : { missing: 'run_id' }),
            ...(now ? {} : { missing: 'now' }),
            ...(scope ? {} : { missing: 'scope' }),
          },
        },
      },
    };
  }

  // mode 以路由为准；仅用于诊断一致性（允许不同以便兼容）。
  const bodyMode = asMode(raw.mode);
  if (bodyMode && bodyMode !== routeMode) {
    // ignore
  }

  return {
    ok: true,
    value: {
      source_id,
      run_id,
      mode: routeMode,
      now,
      scope,
      max_parallel_nodes,
    },
  };
}

export function createHandler(config: { token: string; deps: HypervAgentDeps }) {
  return async function handler(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const requestId = req.headers.get('x-request-id') ?? null;

    if (req.method !== 'POST') {
      return json(405, { ok: false, error: { code: 'AGENT_INVALID_REQUEST', message: 'method not allowed' } });
    }

    const routeMode: HypervAgentMode | null =
      path === '/v1/hyperv/healthcheck'
        ? 'healthcheck'
        : path === '/v1/hyperv/detect'
          ? 'detect'
          : path === '/v1/hyperv/collect'
            ? 'collect'
            : null;

    if (!routeMode) {
      return json(404, { ok: false, error: { code: 'AGENT_INVALID_REQUEST', message: 'not found' } });
    }

    if (!isAuthorized(req.headers, config.token)) {
      return json(401, {
        ok: false,
        error: {
          code: 'AGENT_PERMISSION_DENIED',
          message: 'unauthorized',
          context: { path, ...(requestId ? { request_id: requestId } : {}) },
        },
      });
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return json(400, { ok: false, error: { code: 'AGENT_INVALID_REQUEST', message: 'invalid json' } });
    }

    const parsed = parseRequestBody(raw, routeMode);
    if (!parsed.ok) return json(400, parsed.error);

    try {
      const data = await config.deps.run(routeMode, parsed.value);
      return json(200, { ok: true, data });
    } catch (err) {
      if (err instanceof PowerShellExecError) {
        const combined = `${err.stderr}\n${err.stdout}`;
        const permissionDenied = looksLikePermissionDenied(combined);
        const status = permissionDenied ? 403 : 500;
        return json(status, {
          ok: false,
          error: {
            code: permissionDenied ? 'AGENT_PERMISSION_DENIED' : 'AGENT_PS_ERROR',
            message: permissionDenied ? 'permission denied' : 'powershell failed',
            context: {
              stage: routeMode,
              ...(requestId ? { request_id: requestId } : {}),
              exit_code: err.exitCode,
              stderr_excerpt: excerpt(err.stderr, 500),
              stdout_excerpt: excerpt(err.stdout, 500),
            },
          },
        });
      }

      if (err instanceof PowerShellParseError) {
        return json(500, {
          ok: false,
          error: {
            code: 'AGENT_PS_ERROR',
            message: 'powershell output is not json',
            context: {
              stage: routeMode,
              ...(requestId ? { request_id: requestId } : {}),
              stdout_excerpt: excerpt(err.stdout, 500),
              stderr_excerpt: excerpt(err.stderr, 500),
            },
          },
        });
      }

      return json(500, {
        ok: false,
        error: {
          code: 'AGENT_INTERNAL',
          message: 'internal error',
          context: {
            stage: routeMode,
            ...(requestId ? { request_id: requestId } : {}),
            cause: err instanceof Error ? err.message : String(err),
          },
        },
      });
    }
  };
}
