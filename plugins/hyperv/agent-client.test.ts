import { describe, expect, it } from 'vitest';

import { HypervAgentClientError, postAgentJson } from './agent-client';

describe('hyperv agent-client', () => {
  it('maps fetch network error to HYPERV_AGENT_UNREACHABLE', async () => {
    const err = await postAgentJson(
      {
        baseUrl: 'http://agent.local:8787',
        token: 't',
        tlsVerify: true,
        timeoutMs: 1000,
        fetchImpl: async () => {
          throw new Error('connect ECONNREFUSED');
        },
      },
      '/v1/hyperv/healthcheck',
      { a: 1 },
      'test.stage',
    ).catch((e) => e);

    expect(err).toBeInstanceOf(HypervAgentClientError);
    expect((err as HypervAgentClientError).collectorError.code).toBe('HYPERV_AGENT_UNREACHABLE');
    expect((err as HypervAgentClientError).collectorError.retryable).toBe(true);
  });

  it('maps 401 to HYPERV_AGENT_AUTH_FAILED', async () => {
    const err = await postAgentJson(
      {
        baseUrl: 'http://agent.local:8787',
        token: 'bad',
        tlsVerify: true,
        timeoutMs: 1000,
        fetchImpl: async () => new Response('unauthorized', { status: 401 }),
      },
      '/v1/hyperv/collect',
      { a: 1 },
      'test.collect',
    ).catch((e) => e);

    expect(err).toBeInstanceOf(HypervAgentClientError);
    expect((err as HypervAgentClientError).collectorError.code).toBe('HYPERV_AGENT_AUTH_FAILED');
    expect((err as HypervAgentClientError).collectorError.retryable).toBe(false);
  });

  it('maps non-json body to HYPERV_AGENT_BAD_RESPONSE', async () => {
    const err = await postAgentJson(
      {
        baseUrl: 'http://agent.local:8787',
        token: 't',
        tlsVerify: true,
        timeoutMs: 1000,
        fetchImpl: async () => new Response('not-json', { status: 200 }),
      },
      '/v1/hyperv/collect',
      { a: 1 },
      'test.collect',
    ).catch((e) => e);

    expect(err).toBeInstanceOf(HypervAgentClientError);
    expect((err as HypervAgentClientError).collectorError.code).toBe('HYPERV_AGENT_BAD_RESPONSE');
  });

  it('maps agent permission error to HYPERV_AGENT_PERMISSION_DENIED', async () => {
    const err = await postAgentJson(
      {
        baseUrl: 'http://agent.local:8787',
        token: 't',
        tlsVerify: true,
        timeoutMs: 1000,
        fetchImpl: async () =>
          new Response(JSON.stringify({ ok: false, error: { code: 'AGENT_PERMISSION_DENIED', message: 'nope' } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      },
      '/v1/hyperv/collect',
      { a: 1 },
      'test.collect',
    ).catch((e) => e);

    expect(err).toBeInstanceOf(HypervAgentClientError);
    expect((err as HypervAgentClientError).collectorError.code).toBe('HYPERV_AGENT_PERMISSION_DENIED');
    expect((err as HypervAgentClientError).collectorError.category).toBe('permission');
  });
});
