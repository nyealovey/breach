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
  let soapFail = false;
  let soapRetrievePropertiesExUnsupported = false;
  let soapNvmeTopologyUnsupported = false;
  let soapLoginCookie = 'vmware_soap_session="soap-123"';
  const server = createServer((req, res) => {
    const url = req.url ?? '';
    const parsedUrl = new URL(url, 'http://localhost');
    const pathname = parsedUrl.pathname;
    const searchParams = parsedUrl.searchParams;
    const method = req.method ?? 'GET';

    // Minimal SOAP mock for /sdk.
    if (method === 'POST' && pathname === '/sdk') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString('utf8');
      });
      req.on('end', () => {
        if (soapFail) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'text/xml; charset=utf-8');
          res.end(`<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <Fault xmlns="http://schemas.xmlsoap.org/soap/envelope/">
      <faultcode>500</faultcode>
      <faultstring>soap failure</faultstring>
    </Fault>
  </soapenv:Body>
</soapenv:Envelope>`);
          return;
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/xml; charset=utf-8');

        if (body.includes('RetrieveServiceContent')) {
          res.end(`<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <RetrieveServiceContentResponse xmlns="urn:vim25">
      <returnval>
        <sessionManager>SessionManager</sessionManager>
        <propertyCollector>propertyCollector</propertyCollector>
      </returnval>
    </RetrieveServiceContentResponse>
  </soapenv:Body>
</soapenv:Envelope>`);
          return;
        }

        if (body.includes('Login')) {
          res.setHeader('Set-Cookie', `${soapLoginCookie}; Path=/sdk; HttpOnly`);
          res.end(`<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <LoginResponse xmlns="urn:vim25">
      <returnval />
    </LoginResponse>
  </soapenv:Body>
</soapenv:Envelope>`);
          return;
        }

        // Require the cookie for property retrieval, to ensure caller correctly preserves session.
        const cookie = req.headers.cookie ?? '';
        if (!cookie.includes(soapLoginCookie)) {
          res.statusCode = 401;
          res.end(`<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <Fault xmlns="http://schemas.xmlsoap.org/soap/envelope/">
      <faultcode>401</faultcode>
      <faultstring>missing cookie</faultstring>
    </Fault>
  </soapenv:Body>
</soapenv:Envelope>`);
          return;
        }

        if (soapRetrievePropertiesExUnsupported && body.includes('RetrievePropertiesEx')) {
          res.statusCode = 500;
          res.end(`<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <soapenv:Fault>
      <faultcode>ServerFaultCode</faultcode>
      <faultstring>Unable to resolve WSDL method name RetrievePropertiesEx in vim.version.version3 (vim25/2.5u2)</faultstring>
    </soapenv:Fault>
  </soapenv:Body>
</soapenv:Envelope>`);
          return;
        }

        if (soapNvmeTopologyUnsupported && body.includes('RetrievePropertiesEx') && body.includes('nvmeTopology')) {
          res.statusCode = 500;
          res.end(`<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <soapenv:Fault>
      <faultcode>ServerFaultCode</faultcode>
      <faultstring>InvalidProperty: config.storageDevice.nvmeTopology</faultstring>
    </soapenv:Fault>
  </soapenv:Body>
</soapenv:Envelope>`);
          return;
        }

        if (body.includes('RetrievePropertiesEx')) {
          if (body.includes('<vim25:type>Datastore</vim25:type>')) {
            // Datastore summaries for host datastore aggregation.
            res.end(`<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <RetrievePropertiesExResponse xmlns="urn:vim25">
      <returnval>
        <objects>
          <obj type="Datastore">datastore-1</obj>
          <propSet><name>summary.name</name><val>local-vmfs-1</val></propSet>
          <propSet><name>summary.type</name><val>VMFS</val></propSet>
          <propSet><name>summary.capacity</name><val>1000</val></propSet>
        </objects>
        <objects>
          <obj type="Datastore">datastore-2</obj>
          <propSet><name>summary.name</name><val>remote-nfs</val></propSet>
          <propSet><name>summary.type</name><val>NFS</val></propSet>
          <propSet><name>summary.capacity</name><val>9999</val></propSet>
        </objects>
        <objects>
          <obj type="Datastore">datastore-3</obj>
          <propSet><name>summary.name</name><val>vsanDatastore</val></propSet>
          <propSet><name>summary.type</name><val>vsan</val></propSet>
          <propSet><name>summary.capacity</name><val>8888</val></propSet>
        </objects>
      </returnval>
    </RetrievePropertiesExResponse>
  </soapenv:Body>
</soapenv:Envelope>`);
            return;
          }

          // Provide one host worth of properties.
          res.end(`<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <RetrievePropertiesExResponse xmlns="urn:vim25">
      <returnval>
        <objects>
          <obj type="HostSystem">host-1</obj>
          <propSet><name>summary.config.product.version</name><val>7.0.3</val></propSet>
          <propSet><name>summary.config.product.build</name><val>20036589</val></propSet>
          <propSet><name>summary.hardware.numCpuCores</name><val>32</val></propSet>
          <propSet><name>summary.hardware.memorySize</name><val>274877906944</val></propSet>
          <propSet><name>hardware.systemInfo.vendor</name><val>HP</val></propSet>
          <propSet><name>hardware.systemInfo.model</name><val>ProLiant DL380p Gen8</val></propSet>
          <propSet><name>hardware.systemInfo.serialNumber</name><val>SN-123</val></propSet>
          <propSet>
            <name>config.network.vnic</name>
            <val>
              <HostVirtualNic>
                <device>vmk0</device>
                <portgroup>Management Network</portgroup>
                <spec><ip><ipAddress>192.168.1.10</ipAddress></ip></spec>
              </HostVirtualNic>
            </val>
          </propSet>
          <propSet>
            <name>datastore</name>
            <val>
              <ManagedObjectReference type="Datastore">datastore-1</ManagedObjectReference>
              <ManagedObjectReference type="Datastore">datastore-2</ManagedObjectReference>
              <ManagedObjectReference type="Datastore">datastore-3</ManagedObjectReference>
            </val>
          </propSet>
          <propSet>
            <name>config.storageDevice.scsiLun</name>
            <val>
              <ScsiLun>
                <lunType>disk</lunType>
                <capacity><blockSize>512</blockSize><block>7814037168</block></capacity>
              </ScsiLun>
            </val>
          </propSet>
        </objects>
      </returnval>
    </RetrievePropertiesExResponse>
  </soapenv:Body>
</soapenv:Envelope>`);
          return;
        }

        if (body.includes('RetrieveProperties')) {
          if (body.includes('<vim25:type>Datastore</vim25:type>')) {
            // Datastore summaries for legacy RetrieveProperties.
            res.end(`<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <RetrievePropertiesResponse xmlns="urn:vim25">
      <returnval>
        <obj type="Datastore">datastore-1</obj>
        <propSet><name>summary.name</name><val>local-vmfs-1</val></propSet>
        <propSet><name>summary.type</name><val>VMFS</val></propSet>
        <propSet><name>summary.capacity</name><val>1000</val></propSet>
      </returnval>
      <returnval>
        <obj type="Datastore">datastore-2</obj>
        <propSet><name>summary.name</name><val>remote-nfs</val></propSet>
        <propSet><name>summary.type</name><val>NFS</val></propSet>
        <propSet><name>summary.capacity</name><val>9999</val></propSet>
      </returnval>
      <returnval>
        <obj type="Datastore">datastore-3</obj>
        <propSet><name>summary.name</name><val>vsanDatastore</val></propSet>
        <propSet><name>summary.type</name><val>vsan</val></propSet>
        <propSet><name>summary.capacity</name><val>8888</val></propSet>
      </returnval>
    </RetrievePropertiesResponse>
  </soapenv:Body>
</soapenv:Envelope>`);
            return;
          }

          // Provide one host worth of properties (older API without *Ex).
          res.end(`<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <RetrievePropertiesResponse xmlns="urn:vim25">
      <returnval>
        <obj type="HostSystem">host-1</obj>
        <propSet><name>summary.config.product.version</name><val>7.0.3</val></propSet>
        <propSet><name>summary.config.product.build</name><val>20036589</val></propSet>
        <propSet><name>summary.hardware.numCpuCores</name><val>32</val></propSet>
        <propSet><name>summary.hardware.memorySize</name><val>274877906944</val></propSet>
        <propSet><name>hardware.systemInfo.vendor</name><val>HP</val></propSet>
        <propSet><name>hardware.systemInfo.model</name><val>ProLiant DL380p Gen8</val></propSet>
        <propSet><name>hardware.systemInfo.serialNumber</name><val>SN-123</val></propSet>
        <propSet>
          <name>config.network.vnic</name>
          <val>
            <HostVirtualNic>
              <device>vmk0</device>
              <portgroup>Management Network</portgroup>
              <spec><ip><ipAddress>192.168.1.10</ipAddress></ip></spec>
            </HostVirtualNic>
          </val>
        </propSet>
        <propSet>
          <name>datastore</name>
          <val>
            <ManagedObjectReference type="Datastore">datastore-1</ManagedObjectReference>
            <ManagedObjectReference type="Datastore">datastore-2</ManagedObjectReference>
            <ManagedObjectReference type="Datastore">datastore-3</ManagedObjectReference>
          </val>
        </propSet>
        <propSet>
          <name>config.storageDevice.scsiLun</name>
          <val>
            <ScsiLun>
              <lunType>disk</lunType>
              <capacity><blockSize>512</blockSize><block>7814037168</block></capacity>
            </ScsiLun>
          </val>
        </propSet>
      </returnval>
    </RetrievePropertiesResponse>
  </soapenv:Body>
</soapenv:Envelope>`);
          return;
        }

        res.end(`<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <Fault xmlns="http://schemas.xmlsoap.org/soap/envelope/">
      <faultcode>400</faultcode>
      <faultstring>unsupported soap op</faultstring>
    </Fault>
  </soapenv:Body>
</soapenv:Envelope>`);
      });
      return;
    }

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

    if (method === 'GET' && pathname === '/api/vcenter/vm' && searchParams.get('hosts') === 'host-1') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify([{ vm: 'vm-1' }]));
      return;
    }

    if (method === 'GET' && pathname === '/api/vcenter/vm' && !searchParams.has('hosts')) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify([{ vm: 'vm-1' }]));
      return;
    }
    if (method === 'GET' && pathname === '/api/vcenter/vm/vm-1') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          vm: 'vm-1',
          instance_uuid: 'uuid-1',
          name: 'vm-1-name',
          power_state: 'poweredOn',
        }),
      );
      return;
    }

    if (method === 'GET' && pathname === '/api/vcenter/vm/vm-1/guest/networking/interfaces') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify([
          {
            mac_address: 'aa:bb:cc:dd:ee:ff',
            ip: { ip_addresses: [{ ip_address: '10.10.100.106' }, { ip_address: 'fe80::1' }] },
          },
        ]),
      );
      return;
    }

    if (method === 'GET' && pathname === '/api/vcenter/vm/vm-1/guest/networking') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ dns_values: { host_name: 'vm1.local' } }));
      return;
    }

    if (method === 'GET' && pathname === '/api/vcenter/host' && searchParams.get('clusters') === 'domain-c7') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify([{ host: 'host-1' }]));
      return;
    }

    if (method === 'GET' && pathname === '/api/vcenter/host' && !searchParams.has('clusters')) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify([{ host: 'host-1', name: 'esxi-01', connection_state: 'CONNECTED', power_state: 'POWERED_ON' }]),
      );
      return;
    }

    if (method === 'GET' && pathname === '/api/vcenter/cluster') {
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
    expect(parsed.relations).toHaveLength(3);
    expect(parsed.stats).toEqual({ assets: 3, relations: 3, inventory_complete: true, warnings: [] });
    expect(parsed.assets.map((a) => a.normalized.version)).toEqual(['normalized-v1', 'normalized-v1', 'normalized-v1']);

    const host = parsed.assets.find((a) => a.external_kind === 'host' && a.external_id === 'host-1');
    expect(host).toBeTruthy();
    expect(host?.normalized).toMatchObject({
      os: { name: 'ESXi', version: '7.0.3', fingerprint: '20036589' },
      hardware: { cpu_count: 32, memory_bytes: 274877906944 },
      identity: { serial_number: 'SN-123', vendor: 'HP', model: 'ProLiant DL380p Gen8' },
      network: { management_ip: '192.168.1.10', ip_addresses: ['192.168.1.10'] },
      attributes: { disk_total_bytes: 512 * 7814037168, datastore_total_bytes: 1000 },
    });
  });

  it('collect falls back to RetrieveProperties when RetrievePropertiesEx is unsupported', async () => {
    soapRetrievePropertiesExUnsupported = true;
    try {
      const request = {
        schema_version: 'collector-request-v1',
        source: {
          source_id: 'src_1',
          source_type: 'vcenter',
          config: { endpoint },
          credential: { username: 'user', password: 'pass' },
        },
        request: { run_id: 'run_2_fallback', mode: 'collect', now: new Date().toISOString() },
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
      expect(parsed.relations).toHaveLength(3);
      expect(parsed.stats).toEqual({ assets: 3, relations: 3, inventory_complete: true, warnings: [] });

      const host = parsed.assets.find((a) => a.external_kind === 'host' && a.external_id === 'host-1');
      expect(host).toBeTruthy();
      expect(host?.normalized).toMatchObject({
        os: { name: 'ESXi', version: '7.0.3', fingerprint: '20036589' },
        hardware: { cpu_count: 32, memory_bytes: 274877906944 },
        identity: { serial_number: 'SN-123', vendor: 'HP', model: 'ProLiant DL380p Gen8' },
        network: { management_ip: '192.168.1.10', ip_addresses: ['192.168.1.10'] },
        attributes: { disk_total_bytes: 512 * 7814037168, datastore_total_bytes: 1000 },
      });
    } finally {
      soapRetrievePropertiesExUnsupported = false;
    }
  });

  it('collect retries without nvmeTopology when the property is unsupported', async () => {
    soapNvmeTopologyUnsupported = true;
    try {
      const request = {
        schema_version: 'collector-request-v1',
        source: {
          source_id: 'src_1',
          source_type: 'vcenter',
          config: { endpoint },
          credential: { username: 'user', password: 'pass' },
        },
        request: { run_id: 'run_2_nvme_fallback', mode: 'collect', now: new Date().toISOString() },
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

      // SOAP should succeed after retry, so no warnings.
      expect(parsed.stats.warnings).toEqual([]);

      const host = parsed.assets.find((a) => a.external_kind === 'host' && a.external_id === 'host-1');
      expect(host).toBeTruthy();
      expect(host?.normalized).toMatchObject({
        os: { name: 'ESXi', version: '7.0.3', fingerprint: '20036589' },
        hardware: { cpu_count: 32, memory_bytes: 274877906944 },
        identity: { serial_number: 'SN-123', vendor: 'HP', model: 'ProLiant DL380p Gen8' },
        network: { management_ip: '192.168.1.10', ip_addresses: ['192.168.1.10'] },
        attributes: { disk_total_bytes: 512 * 7814037168, datastore_total_bytes: 1000 },
      });
    } finally {
      soapNvmeTopologyUnsupported = false;
    }
  });

  it('collect tolerates SOAP failures and continues', async () => {
    soapFail = true;
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
      expect(parsed.relations.length).toBe(3);
      expect(parsed.stats.inventory_complete).toBe(true);
      expect(parsed.stats.warnings.length).toBeGreaterThan(0);
    } finally {
      soapFail = false;
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
