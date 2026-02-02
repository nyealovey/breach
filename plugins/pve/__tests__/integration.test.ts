import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type PluginResult = { exitCode: number | null; stdout: string; stderr: string };

function runCollector(request: unknown): Promise<PluginResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('bun', ['plugins/pve/index.ts'], {
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

    child.on('close', (code) => resolve({ exitCode: code ?? null, stdout, stderr }));
  });
}

describe('pve plugin integration (mock PVE API)', () => {
  let endpoint = '';
  let clusterEnabled = false;
  let pveVersion = '8.1.0';
  const tokenHeader = 'PVEAPIToken=user@pam!tokenid=secret';
  const ticketValue = 'ticket-123';

  const server = createServer((req, res) => {
    const url = req.url ?? '';
    const parsedUrl = new URL(url, 'http://localhost');
    const pathname = parsedUrl.pathname;
    const method = req.method ?? 'GET';

    const isAuthed = () => {
      const auth = req.headers.authorization ?? '';
      const cookie = req.headers.cookie ?? '';
      return auth === tokenHeader || cookie.includes(`PVEAuthCookie=${ticketValue}`);
    };

    if (method === 'POST' && pathname === '/api2/json/access/ticket') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString('utf8');
      });
      req.on('end', () => {
        const params = new URLSearchParams(body);
        const username = params.get('username');
        const password = params.get('password');
        if (username !== 'root@pam' || password !== 'pass') {
          res.statusCode = 401;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ data: null, errors: [{ msg: 'auth failed' }] }));
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ data: { ticket: ticketValue } }));
      });
      return;
    }

    // Everything else requires auth.
    if (!isAuthed()) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: null, errors: [{ msg: 'unauthorized' }] }));
      return;
    }

    if (method === 'GET' && pathname === '/api2/json/version') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: { version: pveVersion } }));
      return;
    }

    if (method === 'GET' && pathname === '/api2/json/nodes') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: [{ node: 'node1' }] }));
      return;
    }

    if (method === 'GET' && pathname === '/api2/json/nodes/node1/status') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          data: { cpuinfo: { cpus: 8 }, memory: { total: 17179869184 } },
        }),
      );
      return;
    }

    if (method === 'GET' && pathname === '/api2/json/nodes/node1/qemu') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          data: [{ vmid: 100, name: 'vm-100', status: 'running', maxmem: 2147483648, maxcpu: 2 }],
        }),
      );
      return;
    }

    if (method === 'GET' && pathname === '/api2/json/nodes/node1/lxc') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: [] }));
      return;
    }

    if (method === 'GET' && pathname === '/api2/json/cluster/status') {
      if (!clusterEnabled) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ data: null, errors: [{ msg: 'not clustered' }] }));
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: [{ type: 'cluster', name: 'pve-cluster' }] }));
      return;
    }

    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'not_found', method, url }));
  });

  beforeAll(async () => {
    // Bind to loopback to avoid sandbox restrictions on 0.0.0.0.
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected numeric address');
    endpoint = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('healthcheck succeeds (api_token)', async () => {
    const request = {
      schema_version: 'collector-request-v1',
      source: {
        source_id: 'src_1',
        source_type: 'pve',
        config: { endpoint, tls_verify: true, timeout_ms: 1000 },
        credential: { auth_type: 'api_token', api_token_id: 'user@pam!tokenid', api_token_secret: 'secret' },
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
        source_type: 'pve',
        config: { endpoint, scope: 'auto', tls_verify: true, timeout_ms: 1000 },
        credential: { auth_type: 'api_token', api_token_id: 'user@pam!tokenid', api_token_secret: 'secret' },
      },
      request: { run_id: 'run_detect', mode: 'detect', now: new Date().toISOString() },
    };

    const result = await runCollector(request);
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout) as { schema_version: string; detect?: { driver?: string } };
    expect(parsed.schema_version).toBe('collector-response-v1');
    expect(parsed.detect?.driver).toBe('pve-auto@v1');
  });

  it('collect returns host + vm assets + relations', async () => {
    const request = {
      schema_version: 'collector-request-v1',
      source: {
        source_id: 'src_1',
        source_type: 'pve',
        config: { endpoint, tls_verify: true, timeout_ms: 1000, max_parallel_nodes: 5 },
        credential: { auth_type: 'api_token', api_token_id: 'user@pam!tokenid', api_token_secret: 'secret' },
      },
      request: { run_id: 'run_collect', mode: 'collect', now: new Date().toISOString() },
    };

    const result = await runCollector(request);
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout) as {
      schema_version: string;
      assets: Array<{ external_kind: string; external_id: string; normalized: Record<string, unknown> }>;
      relations: Array<{
        type: string;
        from: { external_kind: string; external_id: string };
        to: { external_kind: string; external_id: string };
      }>;
      stats: { assets: number; relations: number; inventory_complete: boolean; warnings: unknown[] };
      errors?: unknown[];
    };

    expect(parsed.schema_version).toBe('collector-response-v1');
    expect(parsed.errors ?? []).toEqual([]);
    expect(parsed.stats.inventory_complete).toBe(true);
    expect(parsed.assets).toHaveLength(2);
    expect(parsed.relations).toHaveLength(2);

    const host = parsed.assets.find((a) => a.external_kind === 'host' && a.external_id === 'node1');
    expect(host).toBeTruthy();
    expect(host?.normalized).toMatchObject({
      identity: { hostname: 'node1' },
      os: { name: 'Proxmox VE', version: '8.1.0' },
      hardware: { cpu_count: 8, memory_bytes: 17179869184 },
    });

    const vm = parsed.assets.find((a) => a.external_kind === 'vm' && a.external_id === 'node1:100');
    expect(vm).toBeTruthy();
    expect(vm?.normalized).toMatchObject({
      identity: { cloud_native_id: '100', caption: 'vm-100' },
      hardware: { cpu_count: 2, memory_bytes: 2147483648 },
      runtime: { power_state: 'poweredOn' },
    });

    expect(parsed.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'runs_on',
          from: { external_kind: 'vm', external_id: 'node1:100' },
          to: { external_kind: 'host', external_id: 'node1' },
        }),
        expect.objectContaining({
          type: 'hosts_vm',
          from: { external_kind: 'host', external_id: 'node1' },
          to: { external_kind: 'vm', external_id: 'node1:100' },
        }),
      ]),
    );
  });

  it('collect works with user_password credentials', async () => {
    const request = {
      schema_version: 'collector-request-v1',
      source: {
        source_id: 'src_1',
        source_type: 'pve',
        config: { endpoint, tls_verify: true, timeout_ms: 1000 },
        credential: { username: 'root@pam', password: 'pass' },
      },
      request: { run_id: 'run_collect_pw', mode: 'collect', now: new Date().toISOString() },
    };

    const result = await runCollector(request);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { errors?: unknown[]; stats?: { inventory_complete?: boolean } };
    expect(parsed.errors ?? []).toEqual([]);
    expect(parsed.stats?.inventory_complete).toBe(true);
  });

  it('collect includes cluster asset + host->cluster relations when cluster is detected', async () => {
    clusterEnabled = true;
    try {
      const request = {
        schema_version: 'collector-request-v1',
        source: {
          source_id: 'src_1',
          source_type: 'pve',
          config: { endpoint, tls_verify: true, timeout_ms: 1000, scope: 'auto' },
          credential: { auth_type: 'api_token', api_token_id: 'user@pam!tokenid', api_token_secret: 'secret' },
        },
        request: { run_id: 'run_collect_cluster', mode: 'collect', now: new Date().toISOString() },
      };

      const result = await runCollector(request);
      expect(result.exitCode).toBe(0);

      const parsed = JSON.parse(result.stdout) as {
        assets: Array<{ external_kind: string; external_id: string; normalized: Record<string, unknown> }>;
        relations: Array<{
          type: string;
          from: { external_kind: string; external_id: string };
          to: { external_kind: string; external_id: string };
        }>;
        stats: { inventory_complete: boolean };
        errors?: unknown[];
      };

      expect(parsed.errors ?? []).toEqual([]);
      expect(parsed.stats.inventory_complete).toBe(true);

      const cluster = parsed.assets.find((a) => a.external_kind === 'cluster' && a.external_id === 'pve-cluster');
      expect(cluster).toBeTruthy();
      expect(cluster?.normalized).toMatchObject({ identity: { caption: 'pve-cluster' } });

      expect(parsed.relations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'member_of',
            from: { external_kind: 'host', external_id: 'node1' },
            to: { external_kind: 'cluster', external_id: 'pve-cluster' },
          }),
        ]),
      );
    } finally {
      clusterEnabled = false;
    }
  });

  it('works with 5.x-style version strings', async () => {
    pveVersion = '5.4-13';
    try {
      const request = {
        schema_version: 'collector-request-v1',
        source: {
          source_id: 'src_1',
          source_type: 'pve',
          config: { endpoint, tls_verify: true, timeout_ms: 1000 },
          credential: { auth_type: 'api_token', api_token_id: 'user@pam!tokenid', api_token_secret: 'secret' },
        },
        request: { run_id: 'run_5x', mode: 'detect', now: new Date().toISOString() },
      };

      const result = await runCollector(request);
      expect(result.exitCode).toBe(0);

      const parsed = JSON.parse(result.stdout) as { detect?: { target_version?: string } };
      expect(parsed.detect?.target_version).toBe('5.4-13');
    } finally {
      pveVersion = '8.1.0';
    }
  });
});
