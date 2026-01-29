import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type PluginResult = { exitCode: number | null; stdout: string; stderr: string };

function runCollector(request: unknown): Promise<PluginResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('bun', ['plugins/vcenter/index.ts'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    child.on('error', (err) => reject(err));
    child.stdout.on('data', (buf) => {
      stdout += buf.toString('utf8');
    });
    child.stderr.on('data', (buf) => {
      stderr += buf.toString('utf8');
    });

    child.stdin.write(JSON.stringify(request));
    child.stdin.end();

    child.on('close', (code) => {
      resolve({ exitCode: code ?? null, stdout, stderr });
    });
  });
}

describe('vcenter plugin integration (mock vSphere REST)', () => {
  let endpoint = '';
  let hostDetailNotFound = false;
  const server = createServer((req, res) => {
    const url = req.url ?? '';
    const method = req.method ?? 'GET';

    // Minimal Basic auth check for POST /api/session.
    if (method === 'POST' && url === '/api/session') {
      const auth = req.headers.authorization ?? '';
      if (auth !== `Basic ${Buffer.from('user:pass').toString('base64')}`) {
        res.statusCode = 401;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify('token-123'));
      return;
    }

    // The remaining endpoints only require the session header.
    if (req.headers['vmware-api-session-id'] !== 'token-123') {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'missing-session' }));
      return;
    }

    if (method === 'GET' && url === '/api/vcenter/vm') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify([{ vm: 'vm-1' }]));
      return;
    }
    if (method === 'GET' && url === '/api/vcenter/vm/vm-1') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          vm: 'vm-1',
          instance_uuid: 'uuid-1',
          guest: { host_name: 'vm1.local' },
          nics: [{ mac_address: 'aa:bb:cc:dd:ee:ff' }],
          host: 'host-1',
        }),
      );
      return;
    }

    if (method === 'GET' && url === '/api/vcenter/host') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify([{ host: 'host-1' }]));
      return;
    }
    if (method === 'GET' && url === '/api/vcenter/host/host-1') {
      if (hostDetailNotFound) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'not_found' }));
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          host: 'host-1',
          cluster: 'domain-c7',
          hardware: { system_info: { serial_number: 'SN123' } },
          vnics: [{ ip: { ip_address: '192.168.1.10' } }],
        }),
      );
      return;
    }

    if (method === 'GET' && url === '/api/vcenter/cluster') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify([{ cluster: 'domain-c7', name: 'Cluster A' }]));
      return;
    }

    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'not_found', method, url }));
  });

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected numeric address');
    endpoint = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('healthcheck succeeds', async () => {
    const request = {
      schema_version: 'collector-request-v1',
      source: {
        source_id: 'src_1',
        source_type: 'vcenter',
        config: { endpoint },
        credential: { username: 'user', password: 'pass' },
      },
      request: { run_id: 'run_1', mode: 'healthcheck', now: new Date().toISOString() },
    };

    const result = await runCollector(request);
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout) as { schema_version: string; errors?: unknown[] };
    expect(parsed.schema_version).toBe('collector-response-v1');
    expect(parsed.errors ?? []).toEqual([]);
  });

  it('detect returns driver info', async () => {
    const request = {
      schema_version: 'collector-request-v1',
      source: {
        source_id: 'src_1',
        source_type: 'vcenter',
        config: { endpoint },
        credential: { username: 'user', password: 'pass' },
      },
      request: { run_id: 'run_detect', mode: 'detect', now: new Date().toISOString() },
    };

    const result = await runCollector(request);
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout) as { schema_version: string; detect?: { driver?: string } };
    expect(parsed.schema_version).toBe('collector-response-v1');
    expect(parsed.detect?.driver).toBe('vcenter@v1');
  });

  it('collect returns assets + relations', async () => {
    const request = {
      schema_version: 'collector-request-v1',
      source: {
        source_id: 'src_1',
        source_type: 'vcenter',
        config: { endpoint },
        credential: { username: 'user', password: 'pass' },
      },
      request: { run_id: 'run_2', mode: 'collect', now: new Date().toISOString() },
    };

    const result = await runCollector(request);
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout) as {
      schema_version: string;
      assets: Array<{ external_kind: string; external_id: string; normalized: { version: string } }>;
      relations: unknown[];
      stats: { assets: number; relations: number; inventory_complete: boolean; warnings: unknown[] };
      errors?: unknown[];
    };

    expect(parsed.schema_version).toBe('collector-response-v1');
    expect(parsed.errors ?? []).toEqual([]);
    expect(parsed.assets).toHaveLength(3);
    expect(parsed.relations).toHaveLength(2);
    expect(parsed.stats).toEqual({ assets: 3, relations: 2, inventory_complete: true, warnings: [] });
    expect(parsed.assets.map((a) => a.normalized.version)).toEqual(['normalized-v1', 'normalized-v1', 'normalized-v1']);
  });

  it('collect tolerates missing host detail endpoint (404) and continues', async () => {
    hostDetailNotFound = true;
    try {
      const request = {
        schema_version: 'collector-request-v1',
        source: {
          source_id: 'src_1',
          source_type: 'vcenter',
          config: { endpoint },
          credential: { username: 'user', password: 'pass' },
        },
        request: { run_id: 'run_2b', mode: 'collect', now: new Date().toISOString() },
      };

      const result = await runCollector(request);
      expect(result.exitCode).toBe(0);

      const parsed = JSON.parse(result.stdout) as {
        schema_version: string;
        assets: unknown[];
        relations: unknown[];
        stats: { inventory_complete: boolean; warnings: unknown[] };
        errors?: unknown[];
      };

      expect(parsed.schema_version).toBe('collector-response-v1');
      expect(parsed.errors ?? []).toEqual([]);
      expect(parsed.assets.length).toBe(3);
      expect(parsed.relations.length).toBe(1);
      expect(parsed.stats.inventory_complete).toBe(true);
      expect(parsed.stats.warnings.length).toBe(1);
    } finally {
      hostDetailNotFound = false;
    }
  });

  it('healthcheck returns VCENTER_AUTH_FAILED when session creation fails', async () => {
    const request = {
      schema_version: 'collector-request-v1',
      source: {
        source_id: 'src_1',
        source_type: 'vcenter',
        config: { endpoint },
        credential: { username: 'user', password: 'wrong' },
      },
      request: { run_id: 'run_3', mode: 'healthcheck', now: new Date().toISOString() },
    };

    const result = await runCollector(request);
    expect(result.exitCode).not.toBe(0);

    const parsed = JSON.parse(result.stdout) as { schema_version: string; errors?: Array<{ code?: string }> };
    expect(parsed.schema_version).toBe('collector-response-v1');
    expect(parsed.errors?.[0]?.code).toBe('VCENTER_AUTH_FAILED');
  });
});
