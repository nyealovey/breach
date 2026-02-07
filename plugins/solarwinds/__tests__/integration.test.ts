import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseCollectorResponse, validateCollectorResponse } from '@/lib/collector/collector-response';
import { resolveBunBin } from '../../__tests__/bun-bin';

type PluginResult = { exitCode: number | null; stdout: string; stderr: string };

function runCollector(request: unknown): Promise<PluginResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveBunBin(), ['plugins/solarwinds/index.ts'], {
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
  let collectedNodeQueries: string[] = [];
  let detectCountQueries: string[] = [];

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

      const rows = [
        {
          NodeID: 1,
          SysName: 'host-01.example.com',
          DNS: 'host-01.example.com',
          IPAddress: '192.0.2.10',
          Status: 1,
          StatusDescription: 'Up',
          UnManaged: false,
          IsServer: true,
          LastSync: '/Date(1760000000000)/',
        },
        {
          NodeID: 2,
          SysName: 'sw-core-01.example.com',
          DNS: 'sw-core-01.example.com',
          IPAddress: '192.0.2.20',
          Status: 1,
          StatusDescription: 'Up',
          UnManaged: false,
          IsServer: false,
          LastSync: '/Date(1760000000000)/',
        },
        {
          NodeID: 3,
          SysName: 'host-02.example.com',
          DNS: 'host-02.example.com',
          IPAddress: '198.51.100.10',
          Status: 2,
          StatusDescription: 'Down',
          UnManaged: true,
          IsServer: true,
          LastSync: '/Date(1760000000000)/',
        },
        {
          NodeID: 4,
          SysName: 'fw-edge-01.example.com',
          DNS: 'fw-edge-01.example.com',
          IPAddress: '198.51.100.20',
          Status: 1,
          StatusDescription: 'Up',
          UnManaged: false,
          IsServer: false,
          LastSync: '/Date(1760000000000)/',
        },
      ];

      const includeServerOnly = /\bIsServer\s*=\s*true\b/i.test(q);
      const includeUnmanaged = !/\bUnManaged\s*=\s*false\b/i.test(q);

      if (q.includes('COUNT(*)')) {
        if (q.includes('FROM Orion.Nodes')) detectCountQueries.push(q);
        const filtered = rows
          .filter((row) => (includeServerOnly ? row.IsServer : true))
          .filter((row) => (includeUnmanaged ? true : row.UnManaged === false));
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ results: [{ total: filtered.length }], totalRows: 1 }));
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
      const topMatch = /SELECT\s+TOP\s+(\d+)/i.exec(q);
      const pageSize = Number(topMatch?.[1] ?? 500);
      if (q.includes('FROM Orion.Nodes')) collectedNodeQueries.push(q);

      const results = rows
        .filter((row) => row.NodeID > lastId)
        .filter((row) => (includeServerOnly ? row.IsServer : true))
        .filter((row) => (includeUnmanaged ? true : row.UnManaged === false))
        .slice(0, pageSize);

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

  it('detect returns server-only nodes_total count', async () => {
    detectCountQueries = [];
    const request = {
      schema_version: 'collector-request-v1',
      source: {
        source_id: 'src_sw',
        source_type: 'solarwinds',
        config: { endpoint, tls_verify: true, timeout_ms: 10_000, include_unmanaged: false },
        credential: { username: 'user', password: 'pass' },
      },
      request: { run_id: 'run_detect_1', mode: 'detect', now: new Date('2026-02-06T00:00:00.000Z').toISOString() },
    };

    const { exitCode, stdout } = await runCollector(request);
    expect(exitCode).toBe(0);

    const parsed = parseCollectorResponse(stdout);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const detect = parsed.response.detect as {
      capabilities?: { nodes_total?: number; include_unmanaged?: boolean };
    };

    expect(detect.capabilities?.include_unmanaged).toBe(false);
    expect(detect.capabilities?.nodes_total).toBe(1);
    expect(detectCountQueries.length).toBeGreaterThan(0);
    expect(detectCountQueries.every((q) => /\bIsServer\s*=\s*true\b/i.test(q))).toBe(true);
    expect(detectCountQueries.some((q) => /\bUnManaged\s*=\s*false\b/i.test(q))).toBe(true);
  });

  it('collect enumerates nodes with inventory_complete=true', async () => {
    collectedNodeQueries = [];
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
    expect(parsed.response.assets?.length).toBe(2);
    expect(parsed.response.assets?.map((a) => a.external_id)).toEqual(['1', '3']);
    expect(collectedNodeQueries.length).toBeGreaterThan(0);
    expect(collectedNodeQueries.every((q) => /\bIsServer\s*=\s*true\b/i.test(q))).toBe(true);
    const first = parsed.response.assets?.[0]?.normalized as any;
    expect(first?.os?.fingerprint).toBeUndefined();
  });

  it('collect with include_unmanaged=false excludes unmanaged servers', async () => {
    collectedNodeQueries = [];
    const request = {
      schema_version: 'collector-request-v1',
      source: {
        source_id: 'src_sw',
        source_type: 'solarwinds',
        config: { endpoint, tls_verify: true, timeout_ms: 10_000, page_size: 10, include_unmanaged: false },
        credential: { username: 'user', password: 'pass' },
      },
      request: { run_id: 'run_2', mode: 'collect', now: new Date('2026-02-06T00:00:00.000Z').toISOString() },
    };

    const { exitCode, stdout } = await runCollector(request);
    expect(exitCode).toBe(0);

    const parsed = parseCollectorResponse(stdout);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.response.assets?.map((a) => a.external_id)).toEqual(['1']);
  });
});
