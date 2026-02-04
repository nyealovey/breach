import { describe, expect, it } from 'vitest';

import { createHandler } from './handler';
import { PowerShellExecError, PowerShellParseError } from './powershell';

describe('hyperv windows agent handler', () => {
  it('rejects unauthorized requests', async () => {
    const handler = createHandler({ token: 't', deps: { run: async () => ({}) } });
    const res = await handler(
      new Request('http://localhost/v1/hyperv/healthcheck', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source_id: 's',
          run_id: 'r',
          mode: 'healthcheck',
          now: new Date().toISOString(),
          scope: 'auto',
          max_parallel_nodes: 5,
        }),
      }),
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('AGENT_PERMISSION_DENIED');
  });

  it('returns ok envelope on success', async () => {
    const handler = createHandler({ token: 't', deps: { run: async () => ({ hello: 'world' }) } });
    const res = await handler(
      new Request('http://localhost/v1/hyperv/detect', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
        body: JSON.stringify({
          source_id: 's',
          run_id: 'r',
          mode: 'detect',
          now: new Date().toISOString(),
          scope: 'auto',
          max_parallel_nodes: 5,
        }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.data.hello).toBe('world');
  });

  it('maps Access is denied to AGENT_PERMISSION_DENIED (403)', async () => {
    const handler = createHandler({
      token: 't',
      deps: {
        run: async () => {
          throw new PowerShellExecError('powershell exited non-zero', {
            exitCode: 1,
            stdout: '',
            stderr: 'Access is denied.',
          });
        },
      },
    });

    const res = await handler(
      new Request('http://localhost/v1/hyperv/collect', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
        body: JSON.stringify({
          source_id: 's',
          run_id: 'r',
          mode: 'collect',
          now: new Date().toISOString(),
          scope: 'auto',
          max_parallel_nodes: 5,
        }),
      }),
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('AGENT_PERMISSION_DENIED');
  });

  it('maps parse errors to AGENT_PS_ERROR', async () => {
    const handler = createHandler({
      token: 't',
      deps: {
        run: async () => {
          throw new PowerShellParseError('powershell output is not valid json', {
            stdout: 'not-json',
            stderr: '',
          });
        },
      },
    });

    const res = await handler(
      new Request('http://localhost/v1/hyperv/collect', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
        body: JSON.stringify({
          source_id: 's',
          run_id: 'r',
          mode: 'collect',
          now: new Date().toISOString(),
          scope: 'auto',
          max_parallel_nodes: 5,
        }),
      }),
    );

    expect(res.status).toBe(500);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('AGENT_PS_ERROR');
  });
});
