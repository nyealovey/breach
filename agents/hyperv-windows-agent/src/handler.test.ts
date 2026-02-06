import { describe, expect, it } from 'vitest';

import { createHandler } from './handler';
import type { HypervAgentLogger } from './logger';
import { PowerShellExecError, PowerShellParseError } from './powershell';

describe('hyperv windows agent handler', () => {
  function makeLogger(): { logger: HypervAgentLogger; events: any[] } {
    const events: any[] = [];
    const logger: HypervAgentLogger = {
      debug: (e) => events.push({ level: 'debug', ...e }),
      info: (e) => events.push({ level: 'info', ...e }),
      error: (e) => events.push({ level: 'error', ...e }),
    };
    return { logger, events };
  }

  it('serves /health without auth', async () => {
    const { logger, events } = makeLogger();
    const handler = createHandler({ token: 't', deps: { run: async () => ({}) }, logger });
    const res = await handler(new Request('http://localhost/health', { method: 'GET' }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.data.service).toBe('hyperv-windows-agent');
    expect(typeof body.data.ts).toBe('string');
    expect(events).toHaveLength(1);
    expect(events[0].status_code).toBe(200);
    expect(events[0].outcome).toBe('success');
  });

  it('rejects unauthorized requests', async () => {
    const { logger, events } = makeLogger();
    const handler = createHandler({ token: 't', deps: { run: async () => ({}) }, logger });
    const res = await handler(
      new Request('http://localhost/v1/hyperv/healthcheck', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source_id: 's',
          run_id: 'r',
          mode: 'healthcheck',
          now: new Date().toISOString(),
          endpoint: 'host01.example.com',
          scope: 'auto',
          max_parallel_nodes: 5,
        }),
      }),
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('AGENT_PERMISSION_DENIED');
    expect(events).toHaveLength(1);
    expect(events[0].outcome).toBe('auth_failed');
    expect(events[0].status_code).toBe(401);
  });

  it('returns ok envelope on success', async () => {
    const { logger, events } = makeLogger();
    const handler = createHandler({ token: 't', deps: { run: async () => ({ hello: 'world' }) }, logger });
    const res = await handler(
      new Request('http://localhost/v1/hyperv/detect', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
        body: JSON.stringify({
          source_id: 's',
          run_id: 'r',
          mode: 'detect',
          now: new Date().toISOString(),
          endpoint: 'host01.example.com',
          scope: 'auto',
          max_parallel_nodes: 5,
        }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.data.hello).toBe('world');
    expect(events).toHaveLength(1);
    expect(events[0].outcome).toBe('success');
    expect(events[0].status_code).toBe(200);
    expect(JSON.stringify(events[0])).not.toContain('Bearer');
  });

  it('maps Access is denied to AGENT_PERMISSION_DENIED (403)', async () => {
    const { logger, events } = makeLogger();
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
      logger,
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
          endpoint: 'host01.example.com',
          scope: 'standalone',
          max_parallel_nodes: 5,
        }),
      }),
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('AGENT_PERMISSION_DENIED');
    expect(events).toHaveLength(1);
    expect(events[0].outcome).toBe('permission_denied');
    expect(events[0].status_code).toBe(403);
  });

  it('maps parse errors to AGENT_PS_ERROR', async () => {
    const { logger, events } = makeLogger();
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
      logger,
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
          endpoint: 'host01.example.com',
          scope: 'standalone',
          max_parallel_nodes: 5,
        }),
      }),
    );

    expect(res.status).toBe(500);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('AGENT_PS_ERROR');
    expect(events).toHaveLength(1);
    expect(events[0].outcome).toBe('error');
    expect(events[0].status_code).toBe(500);
  });

  it('maps kerberos spn errors to AGENT_KERBEROS_SPN (422)', async () => {
    const { logger, events } = makeLogger();
    const handler = createHandler({
      token: 't',
      deps: {
        run: async () => {
          throw new PowerShellExecError('powershell exited non-zero', {
            exitCode: 1,
            stdout: '',
            stderr:
              '[host01.example.com] 连接到远程服务器 host01.example.com 失败: WinRM 无法处理此请求。使用 Kerberos 身份验证时发生以下错误: 找不到计算机 host01.example.com。',
          });
        },
      },
      logger,
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
          endpoint: 'host01.example.com',
          scope: 'standalone',
          max_parallel_nodes: 5,
        }),
      }),
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('AGENT_KERBEROS_SPN');
    expect(typeof body.error.context?.hint).toBe('string');
    expect(events).toHaveLength(1);
    expect(events[0].outcome).toBe('kerberos_spn');
    expect(events[0].status_code).toBe(422);
  });

  it('rejects collect when scope=auto', async () => {
    const { logger, events } = makeLogger();
    let called = false;
    const handler = createHandler({
      token: 't',
      deps: {
        run: async () => {
          called = true;
          return {};
        },
      },
      logger,
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
          endpoint: 'host01.example.com',
          scope: 'auto',
          max_parallel_nodes: 5,
        }),
      }),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('AGENT_INVALID_REQUEST');
    expect(body.error.message).toBe('scope must be explicit for collect');
    expect(called).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0].outcome).toBe('invalid_request');
    expect(events[0].status_code).toBe(400);
  });
});
