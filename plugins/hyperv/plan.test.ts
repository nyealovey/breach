import { describe, expect, it } from 'vitest';

import { resolveHypervCollectPlan } from './plan';

describe('hyperv collect plan', () => {
  it('rejects collect when scope is auto', () => {
    const res = resolveHypervCollectPlan({
      schema_version: 'collector-request-v1',
      source: {
        source_id: 'src_1',
        source_type: 'hyperv',
        config: { endpoint: 'host01.example.com', scope: 'auto', auth_method: 'kerberos' },
        credential: { username: 'user', password: 'pass' },
      },
      request: { run_id: 'run_1', mode: 'collect', now: new Date().toISOString() },
    } as any);

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.exitCode).toBe(1);
    expect(res.response.errors[0]).toMatchObject({
      code: 'HYPERV_CONFIG_INVALID',
      category: 'config',
      retryable: false,
      message: 'scope must be explicit for collect (auto not allowed)',
    });
  });

  it('rejects winrm collect when auth_method is auto', () => {
    const res = resolveHypervCollectPlan({
      schema_version: 'collector-request-v1',
      source: {
        source_id: 'src_1',
        source_type: 'hyperv',
        config: { endpoint: 'host01.example.com', scope: 'standalone', auth_method: 'auto' },
        credential: { username: 'user', password: 'pass' },
      },
      request: { run_id: 'run_1', mode: 'collect', now: new Date().toISOString() },
    } as any);

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.response.errors[0]).toMatchObject({
      code: 'HYPERV_CONFIG_INVALID',
      message: 'auth_method must be explicit for collect (auto not allowed)',
    });
  });

  it('rejects agent collect when scope is missing', () => {
    const res = resolveHypervCollectPlan({
      schema_version: 'collector-request-v1',
      source: {
        source_id: 'src_1',
        source_type: 'hyperv',
        config: {
          connection_method: 'agent',
          endpoint: 'host01.example.com',
          agent_url: 'http://agent',
          scope: 'auto',
        },
        credential: { auth: 'agent', token: 't' },
      },
      request: { run_id: 'run_1', mode: 'collect', now: new Date().toISOString() },
    } as any);

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.response.errors[0]).toMatchObject({ code: 'HYPERV_CONFIG_INVALID' });
  });

  it('returns explicit winrm plan', () => {
    const res = resolveHypervCollectPlan({
      schema_version: 'collector-request-v1',
      source: {
        source_id: 'src_1',
        source_type: 'hyperv',
        config: { endpoint: 'host01.example.com', scope: 'cluster', auth_method: 'kerberos' },
        credential: { username: 'user', password: 'pass' },
      },
      request: { run_id: 'run_1', mode: 'collect', now: new Date().toISOString() },
    } as any);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan).toEqual({ kind: 'winrm', scope: 'cluster', auth_method: 'kerberos' });
  });

  it('returns explicit agent plan', () => {
    const res = resolveHypervCollectPlan({
      schema_version: 'collector-request-v1',
      source: {
        source_id: 'src_1',
        source_type: 'hyperv',
        config: {
          connection_method: 'agent',
          agent_url: 'http://agent.example.com:8787',
          endpoint: 'host01.example.com',
          scope: 'standalone',
        },
        credential: { auth: 'agent', token: 't' },
      },
      request: { run_id: 'run_1', mode: 'collect', now: new Date().toISOString() },
    } as any);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan).toEqual({ kind: 'agent', scope: 'standalone' });
  });
});
