import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseCollectorResponse, validateCollectorResponse } from '@/lib/collector/collector-response';

type PluginResult = { exitCode: number | null; stdout: string; stderr: string };

function runCollector(request: unknown): Promise<PluginResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('bun', ['plugins/solarwinds/index.ts'], {
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

describe('solarwinds plugin integration (mock SWIS API)', () => {
  let endpoint = '';

  const server = createServer((req, res) => {
    const url = req.url ?? '';
    const parsedUrl = new URL(url, 'http://localhost');
    const pathname = parsedUrl.pathname;
    const method = req.method ?? 'GET';

    if (method !== 'POST' || pathname !== '/SolarWinds/InformationService/v3/Json/Query') {
      res.statusCode = 404;
      res.end('not found');
      return;
    }

    const auth = req.headers.authorization ?? '';
    const expected = `Basic ${Buffer.from('user:pass', 'utf8').toString('base64')}`;
    if (auth !== expected) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ message: 'unauthorized' }));
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString('utf8');
    });
    req.on('end', () => {
      const parsed = JSON.parse(body) as { query?: string; parameters?: Record<string, unknown> };
      const q = parsed.query ?? '';

      if (q.includes('COUNT(*)')) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ results: [{ total: 3 }], totalRows: 1 }));
        return;
      }

      if (q.includes('TOP 1') && q.includes('NodeID')) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ results: [{ NodeID: 1 }], totalRows: 1 }));
        return;
      }

      // collect pagination
      const lastIdRaw = parsed.parameters?.lastId;
      const lastId = typeof lastIdRaw === 'number' ? lastIdRaw : Number(lastIdRaw ?? 0);

      const page1 = [
        {
          NodeID: 1,
          SysName: 'vm-01.example.com',
          DNS: 'vm-01.example.com',
          IPAddress: '192.0.2.10',
          MachineType: 'Windows Server 2019',
          Status: 1,
          StatusDescription: 'Up',
          UnManaged: false,
          LastSync: '/Date(1760000000000)/',
        },
        {
          NodeID: 2,
          SysName: 'vm-02.example.com',
          DNS: 'vm-02.example.com',
          IPAddress: '192.0.2.11',
          MachineType: 'Linux (Generic)',
          Status: 3,
          StatusDescription: 'Warning',
          UnManaged: true,
          LastSync: '/Date(1760000000000)/',
        },
      ];
      const page2 = [
        {
          NodeID: 3,
          SysName: 'vm-03.example.com',
          DNS: 'vm-03.example.com',
          IPAddress: '198.51.100.10',
          MachineType: 'VMware ESXi',
          Status: 2,
          StatusDescription: 'Down',
          UnManaged: false,
          LastSync: '/Date(1760000000000)/',
        },
      ];

      const results = lastId < 2 ? page1 : lastId < 3 ? page2 : [];

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ results, totalRows: results.length }));
    });
  });

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('server did not start');
    endpoint = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('healthcheck succeeds', async () => {
    const request = {
      schema_version: 'collector-request-v1',
      source: {
        source_id: 'src_sw',
        source_type: 'solarwinds',
        config: { endpoint, tls_verify: true, timeout_ms: 10_000 },
        credential: { username: 'user', password: 'pass' },
      },
      request: { run_id: 'run_1', mode: 'healthcheck', now: new Date('2026-02-06T00:00:00.000Z').toISOString() },
    };

    const { exitCode, stdout } = await runCollector(request);
    expect(exitCode).toBe(0);

    const parsed = parseCollectorResponse(stdout);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.response.errors?.length ?? 0).toBe(0);
  });

  it('collect enumerates nodes with inventory_complete=true', async () => {
    const request = {
      schema_version: 'collector-request-v1',
      source: {
        source_id: 'src_sw',
        source_type: 'solarwinds',
        config: { endpoint, tls_verify: true, timeout_ms: 10_000, page_size: 2, include_unmanaged: true },
        credential: { username: 'user', password: 'pass' },
      },
      request: { run_id: 'run_1', mode: 'collect', now: new Date('2026-02-06T00:00:00.000Z').toISOString() },
    };

    const { exitCode, stdout } = await runCollector(request);
    expect(exitCode).toBe(0);

    const parsed = parseCollectorResponse(stdout);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const validate = validateCollectorResponse(parsed.response);
    expect(validate.ok).toBe(true);

    expect((parsed.response.stats as any)?.inventory_complete).toBe(true);
    expect(parsed.response.assets?.length).toBe(3);
    const first = parsed.response.assets?.[0]?.normalized as any;
    expect(first?.os?.fingerprint).toBe('Windows Server 2019');
  });
});
