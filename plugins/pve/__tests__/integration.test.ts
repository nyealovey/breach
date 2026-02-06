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
  let guestAgentEnabled = true;
  let guestAgentResponseWrapper: 'direct' | 'result' = 'direct';
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

    if (method === 'GET' && pathname === '/api2/json/nodes/node1/network') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          data: [
            { iface: 'lo', type: 'loopback', address: '127.0.0.1/8' },
            { iface: 'vmbr0', type: 'bridge', address: '192.0.2.10/24' },
          ],
        }),
      );
      return;
    }

    if (method === 'GET' && pathname === '/api2/json/nodes/node1/storage') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          data: [
            { storage: 'local-lvm', type: 'lvmthin', shared: 0, total: 1000, used: 100, avail: 900 },
            { storage: 'nfs-share', type: 'nfs', shared: 1, total: 2000, used: 400, avail: 1600 },
          ],
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

    if (method === 'GET' && pathname === '/api2/json/nodes/node1/qemu/100/config') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          data: {
            name: 'vm-100',
            scsi0: 'local-lvm:vm-100-disk-0,discard=on,size=32G',
            ide2: 'local-lvm:cloudinit,media=cdrom',
            net0: 'virtio=02:00:00:00:00:01,bridge=vmbr0',
          },
        }),
      );
      return;
    }

    if (method === 'GET' && pathname === '/api2/json/nodes/node1/qemu/100/agent/network-get-interfaces') {
      if (!guestAgentEnabled) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ data: null, errors: [{ msg: 'guest agent not running' }] }));
        return;
      }
      const ifaceList = [
        {
          name: 'lo',
          'ip-addresses': [{ 'ip-address-type': 'ipv4', 'ip-address': '127.0.0.1', prefix: 8 }],
        },
        {
          name: 'eth0',
          'ip-addresses': [
            { 'ip-address-type': 'ipv4', 'ip-address': '192.0.2.11', prefix: 24 },
            { 'ip-address-type': 'ipv6', 'ip-address': 'fe80::1', prefix: 64 },
          ],
        },
      ];
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          data: guestAgentResponseWrapper === 'result' ? { result: ifaceList } : ifaceList,
        }),
      );
      return;
    }

    if (method === 'GET' && pathname === '/api2/json/nodes/node1/qemu/100/agent/get-host-name') {
      if (!guestAgentEnabled) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ data: null, errors: [{ msg: 'guest agent not running' }] }));
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          data:
            guestAgentResponseWrapper === 'result'
              ? { result: { 'host-name': 'vm-100-guest' } }
              : { 'host-name': 'vm-100-guest' },
        }),
      );
      return;
    }

    if (method === 'GET' && pathname === '/api2/json/nodes/node1/qemu/100/agent/get-osinfo') {
      if (!guestAgentEnabled) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ data: null, errors: [{ msg: 'guest agent not running' }] }));
        return;
      }
      const osinfo = { name: 'Ubuntu', 'version-id': '22.04', 'pretty-name': 'Ubuntu 22.04.3 LTS' };
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          data: guestAgentResponseWrapper === 'result' ? { result: osinfo } : osinfo,
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
      res.end(
        JSON.stringify({
          data: [
            { type: 'cluster', name: 'pve-cluster' },
            { type: 'node', name: 'node1', online: 1 },
          ],
        }),
      );
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
    guestAgentEnabled = true;
    guestAgentResponseWrapper = 'direct';
    const request = {
      schema_version: 'collector-request-v1',
      source: {
        source_id: 'src_1',
        source_type: 'pve',
        config: { endpoint, tls_verify: true, timeout_ms: 1000, scope: 'standalone', max_parallel_nodes: 5 },
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
    expect(parsed.stats.warnings ?? []).toEqual([]);
    expect(parsed.assets).toHaveLength(2);
    expect(parsed.relations).toHaveLength(2);

    const host = parsed.assets.find((a) => a.external_kind === 'host' && a.external_id === 'node1');
    expect(host).toBeTruthy();
    expect(host?.normalized).toMatchObject({
      identity: { hostname: 'node1' },
      os: { name: 'Proxmox VE', version: '8.1.0' },
      hardware: { cpu_count: 8, memory_bytes: 17179869184 },
      network: { ip_addresses: ['192.0.2.10'], management_ip: '192.0.2.10' },
      runtime: { power_state: 'poweredOn' },
      storage: {
        datastores: [{ name: 'local-lvm', capacity_bytes: 1000 }],
      },
      attributes: { datastore_total_bytes: 1000 },
    });

    const vm = parsed.assets.find((a) => a.external_kind === 'vm' && a.external_id === 'node1:100');
    expect(vm).toBeTruthy();
    expect(vm?.normalized).toMatchObject({
      identity: { cloud_native_id: '100', caption: 'vm-100', hostname: 'vm-100-guest' },
      hardware: {
        cpu_count: 2,
        memory_bytes: 2147483648,
        disks: [{ name: 'scsi0', size_bytes: 34359738368 }],
      },
      os: { name: 'Ubuntu', version: '22.04', fingerprint: 'Ubuntu 22.04.3 LTS' },
      runtime: { power_state: 'poweredOn', tools_running: true },
      network: { ip_addresses: ['192.0.2.11'], mac_addresses: ['02:00:00:00:00:01'] },
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

  it('collect extracts vm ip when guest agent wraps interfaces under result', async () => {
    guestAgentEnabled = true;
    guestAgentResponseWrapper = 'result';
    try {
      const request = {
        schema_version: 'collector-request-v1',
        source: {
          source_id: 'src_1',
          source_type: 'pve',
          config: { endpoint, tls_verify: true, timeout_ms: 1000, scope: 'standalone', max_parallel_nodes: 5 },
          credential: { auth_type: 'api_token', api_token_id: 'user@pam!tokenid', api_token_secret: 'secret' },
        },
        request: { run_id: 'run_collect_result_wrapper', mode: 'collect', now: new Date().toISOString() },
      };

      const result = await runCollector(request);
      expect(result.exitCode).toBe(0);

      const parsed = JSON.parse(result.stdout) as {
        assets: Array<{ external_kind: string; external_id: string; normalized: Record<string, unknown> }>;
        errors?: unknown[];
      };

      expect(parsed.errors ?? []).toEqual([]);

      const vm = parsed.assets.find((a) => a.external_kind === 'vm' && a.external_id === 'node1:100');
      expect(vm).toBeTruthy();
      expect(vm?.normalized).toMatchObject({
        identity: { hostname: 'vm-100-guest' },
        os: { name: 'Ubuntu', version: '22.04', fingerprint: 'Ubuntu 22.04.3 LTS' },
        network: { ip_addresses: ['192.0.2.11'] },
        runtime: { tools_running: true },
      });
    } finally {
      guestAgentResponseWrapper = 'direct';
    }
  });

  it('collect warns when guest agent is unavailable', async () => {
    guestAgentEnabled = false;
    try {
      const request = {
        schema_version: 'collector-request-v1',
        source: {
          source_id: 'src_1',
          source_type: 'pve',
          config: { endpoint, tls_verify: true, timeout_ms: 1000, scope: 'standalone', max_parallel_nodes: 5 },
          credential: { auth_type: 'api_token', api_token_id: 'user@pam!tokenid', api_token_secret: 'secret' },
        },
        request: { run_id: 'run_collect_guest_agent_missing', mode: 'collect', now: new Date().toISOString() },
      };

      const result = await runCollector(request);
      expect(result.exitCode).toBe(0);

      const parsed = JSON.parse(result.stdout) as {
        schema_version: string;
        assets: Array<{ external_kind: string; external_id: string; normalized: Record<string, unknown> }>;
        stats: { inventory_complete: boolean; warnings?: unknown[] };
        errors?: unknown[];
      };

      expect(parsed.schema_version).toBe('collector-response-v1');
      expect(parsed.errors ?? []).toEqual([]);
      expect(parsed.stats.inventory_complete).toBe(true);

      const warnings = Array.isArray(parsed.stats.warnings) ? parsed.stats.warnings : [];
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'PVE_GUEST_AGENT_UNAVAILABLE' })]),
      );

      const vm = parsed.assets.find((a) => a.external_kind === 'vm' && a.external_id === 'node1:100');
      expect(vm).toBeTruthy();
      expect(vm?.normalized).toMatchObject({
        identity: { cloud_native_id: '100', caption: 'vm-100' },
        hardware: { cpu_count: 2, memory_bytes: 2147483648 },
        runtime: { power_state: 'poweredOn', tools_running: false },
      });
      // ip_addresses should be absent when guest agent is unavailable.
      expect((vm?.normalized as any)?.network?.ip_addresses ?? []).toEqual([]);
    } finally {
      guestAgentEnabled = true;
    }
  });

  it('collect works with user_password credentials', async () => {
    const request = {
      schema_version: 'collector-request-v1',
      source: {
        source_id: 'src_1',
        source_type: 'pve',
        config: { endpoint, tls_verify: true, timeout_ms: 1000, scope: 'standalone' },
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

  it('collect works with user_password credentials (realm field)', async () => {
    const request = {
      schema_version: 'collector-request-v1',
      source: {
        source_id: 'src_1',
        source_type: 'pve',
        config: { endpoint, tls_verify: true, timeout_ms: 1000, scope: 'standalone' },
        credential: { auth_type: 'user_password', username: 'root', realm: 'pam', password: 'pass' },
      },
      request: { run_id: 'run_collect_pw_realm', mode: 'collect', now: new Date().toISOString() },
    };

    const result = await runCollector(request);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { errors?: unknown[]; stats?: { inventory_complete?: boolean } };
    expect(parsed.errors ?? []).toEqual([]);
    expect(parsed.stats?.inventory_complete).toBe(true);
  });

  it('collect defaults realm to pam when username has no @realm', async () => {
    const request = {
      schema_version: 'collector-request-v1',
      source: {
        source_id: 'src_1',
        source_type: 'pve',
        config: { endpoint, tls_verify: true, timeout_ms: 1000, scope: 'standalone' },
        credential: { auth_type: 'user_password', username: 'root', password: 'pass' },
      },
      request: { run_id: 'run_collect_pw_default_realm', mode: 'collect', now: new Date().toISOString() },
    };

    const result = await runCollector(request);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { errors?: unknown[]; stats?: { inventory_complete?: boolean } };
    expect(parsed.errors ?? []).toEqual([]);
    expect(parsed.stats?.inventory_complete).toBe(true);
  });

  it('collect includes cluster asset + host->cluster relations when scope=cluster', async () => {
    clusterEnabled = true;
    try {
      const request = {
        schema_version: 'collector-request-v1',
        source: {
          source_id: 'src_1',
          source_type: 'pve',
          config: { endpoint, tls_verify: true, timeout_ms: 1000, scope: 'cluster' },
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
