import type { CollectorError } from './types';

type AgentOkResponse<T> = { ok: true; data: T };
type AgentErrResponse = {
  ok: false;
  error: { code: string; message: string; context?: Record<string, unknown> };
};
type AgentResponse<T> = AgentOkResponse<T> | AgentErrResponse;

export type HypervAgentClientOptions = {
  baseUrl: string;
  token: string;
  tlsVerify: boolean;
  timeoutMs: number;
  requestId?: string;
  fetchImpl?: typeof fetch;
};

export class HypervAgentClientError extends Error {
  readonly collectorError: CollectorError;

  constructor(collectorError: CollectorError) {
    super(collectorError.message);
    this.name = 'HypervAgentClientError';
    this.collectorError = collectorError;
  }
}

function excerpt(text: string, limit = 500): string {
  const trimmed = text.trim();
  return trimmed.length > limit ? trimmed.slice(0, limit) : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toNetworkError(input: { stage: string; url: string; cause: string; timeout: boolean }): CollectorError {
  return {
    code: 'HYPERV_AGENT_UNREACHABLE',
    category: 'network',
    message: input.timeout ? 'agent request timed out' : 'agent unreachable',
    retryable: true,
    redacted_context: { stage: input.stage, url: input.url, cause: input.cause },
  };
}

function toBadResponseError(input: {
  stage: string;
  url: string;
  status: number;
  bodyExcerpt?: string;
  cause?: string;
}): CollectorError {
  return {
    code: 'HYPERV_AGENT_BAD_RESPONSE',
    category: 'parse',
    message: 'agent bad response',
    retryable: false,
    redacted_context: {
      stage: input.stage,
      url: input.url,
      status: input.status,
      ...(input.bodyExcerpt ? { body_excerpt: input.bodyExcerpt } : {}),
      ...(input.cause ? { cause: input.cause } : {}),
    },
  };
}

function toAuthError(input: { stage: string; url: string; status: number; bodyExcerpt?: string }): CollectorError {
  return {
    code: 'HYPERV_AGENT_AUTH_FAILED',
    category: 'auth',
    message: 'agent authentication failed',
    retryable: false,
    redacted_context: {
      stage: input.stage,
      url: input.url,
      status: input.status,
      ...(input.bodyExcerpt ? { body_excerpt: input.bodyExcerpt } : {}),
    },
  };
}

function toPermissionError(input: {
  stage: string;
  url: string;
  status: number;
  bodyExcerpt?: string;
}): CollectorError {
  return {
    code: 'HYPERV_AGENT_PERMISSION_DENIED',
    category: 'permission',
    message: 'agent permission denied',
    retryable: false,
    redacted_context: {
      stage: input.stage,
      url: input.url,
      status: input.status,
      ...(input.bodyExcerpt ? { body_excerpt: input.bodyExcerpt } : {}),
    },
  };
}

export async function postAgentJson<T>(
  opts: HypervAgentClientOptions,
  path: string,
  body: unknown,
  stage: string,
): Promise<T> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = new URL(path, opts.baseUrl).toString();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);

  let res: Response;
  let text = '';
  try {
    const init: RequestInit & { tls?: { rejectUnauthorized?: boolean } } = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${opts.token}`,
        ...(opts.requestId ? { 'x-request-id': opts.requestId } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    };

    // Bun 的 fetch 支持 per-request TLS 配置；Node fetch 不支持，因此仅在 Bun 下设置。
    if (typeof (globalThis as any).Bun !== 'undefined') {
      init.tls = { rejectUnauthorized: opts.tlsVerify };
    }

    res = await fetchImpl(url, init);
    text = await res.text();
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    const timeoutLike = err instanceof Error && err.name === 'AbortError';
    throw new HypervAgentClientError(toNetworkError({ stage, url, cause, timeout: timeoutLike }));
  } finally {
    clearTimeout(timeout);
  }

  const bodyExcerpt = text ? excerpt(text) : undefined;
  const status = res.status;

  // Prefer mapping auth errors even if body isn't valid JSON.
  if (status === 401) throw new HypervAgentClientError(toAuthError({ stage, url, status, bodyExcerpt }));
  if (status === 403) throw new HypervAgentClientError(toPermissionError({ stage, url, status, bodyExcerpt }));

  let parsed: unknown = null;
  try {
    parsed = text ? (JSON.parse(text) as unknown) : null;
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new HypervAgentClientError(toBadResponseError({ stage, url, status, bodyExcerpt, cause }));
  }

  if (!isRecord(parsed) || typeof parsed.ok !== 'boolean') {
    throw new HypervAgentClientError(toBadResponseError({ stage, url, status, bodyExcerpt }));
  }

  const envelope = parsed as AgentResponse<T>;
  if (envelope.ok) {
    if (!('data' in envelope)) {
      throw new HypervAgentClientError(toBadResponseError({ stage, url, status, bodyExcerpt }));
    }
    return envelope.data;
  }

  const agentErr = envelope.error;
  const agentCode = isRecord(agentErr) && typeof agentErr.code === 'string' ? agentErr.code : 'AGENT_INTERNAL';
  const agentMessage = isRecord(agentErr) && typeof agentErr.message === 'string' ? agentErr.message : 'agent error';
  const agentContext = isRecord(agentErr) && isRecord(agentErr.context) ? agentErr.context : undefined;

  if (agentCode === 'AGENT_PERMISSION_DENIED') {
    throw new HypervAgentClientError({
      code: 'HYPERV_AGENT_PERMISSION_DENIED',
      category: 'permission',
      message: 'agent permission denied',
      retryable: false,
      redacted_context: {
        stage,
        url,
        status,
        agent_code: agentCode,
        ...(agentContext ? { agent_context: agentContext } : {}),
      },
    });
  }

  if (agentCode === 'AGENT_INVALID_REQUEST') {
    throw new HypervAgentClientError({
      code: 'HYPERV_AGENT_INVALID_REQUEST',
      category: 'config',
      message: 'agent rejected request',
      retryable: false,
      redacted_context: {
        stage,
        url,
        status,
        agent_code: agentCode,
        ...(agentContext ? { agent_context: agentContext } : {}),
      },
    });
  }

  if (agentCode === 'AGENT_PS_ERROR') {
    throw new HypervAgentClientError({
      code: 'HYPERV_AGENT_PS_ERROR',
      category: 'unknown',
      message: 'agent powershell failed',
      retryable: false,
      redacted_context: {
        stage,
        url,
        status,
        agent_code: agentCode,
        agent_message_excerpt: excerpt(agentMessage, 200),
        ...(agentContext ? { agent_context: agentContext } : {}),
      },
    });
  }

  throw new HypervAgentClientError({
    code: 'HYPERV_AGENT_INTERNAL',
    category: 'unknown',
    message: 'agent request failed',
    retryable: true,
    redacted_context: {
      stage,
      url,
      status,
      agent_code: agentCode,
      agent_message_excerpt: excerpt(agentMessage, 200),
      ...(agentContext ? { agent_context: agentContext } : {}),
    },
  });
}
