import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
  let soapSerialNumberUnsupported = false;
  let soapNvmeTopologyUnsupported = false;
  let soapLoginCookie = 'vmware_soap_session="soap-123"';
  let restSessionToken = 'token-123';
  let restSessionApiJsonRpcError = false;
  let restApiSessionCalls = 0;
  let restCisSessionCalls = 0;
  let restVcenterApiGetNotAllowed = false;
  let restVcenterApiCalls = 0;
  let restVcenterRestCalls = 0;
  let restVmListHostsParamUnsupported = false;
  let restVmListFilterHostsCalls = 0;
  let restWrapValue = false;
  let restVmDetailFlat = false;
  let restSystemVersion = '7.0.3';
  let restSystemBuild = '20036589';
  const server = createServer((req, res) => {
    const url = req.url ?? '';
    const parsedUrl = new URL(url, 'http://localhost');
    const pathname = parsedUrl.pathname;
    const searchParams = parsedUrl.searchParams;
    const method = req.method ?? 'GET';

    if (pathname.startsWith('/api/vcenter/')) restVcenterApiCalls++;
    if (pathname.startsWith('/rest/vcenter/')) restVcenterRestCalls++;

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

        if (
          soapNvmeTopologyUnsupported &&
          body.includes('<vim25:RetrieveProperties>') &&
          body.includes('nvmeTopology')
        ) {
          res.statusCode = 500;
          res.end(`<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <soapenv:Body>
    <soapenv:Fault>
      <faultcode>ServerFaultCode</faultcode>
      <faultstring></faultstring>
      <detail>
        <InvalidPropertyFault xmlns="urn:vim25" xsi:type="InvalidProperty">
          <name>config.storageDevice.nvmeTopology</name>
        </InvalidPropertyFault>
      </detail>
    </soapenv:Fault>
  </soapenv:Body>
</soapenv:Envelope>`);
          return;
        }

        if (
          soapSerialNumberUnsupported &&
          body.includes('<vim25:RetrieveProperties>') &&
          body.includes('serialNumber')
        ) {
          res.statusCode = 500;
          res.end(`<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <soapenv:Body>
    <soapenv:Fault>
      <faultcode>ServerFaultCode</faultcode>
      <faultstring></faultstring>
      <detail>
        <InvalidPropertyFault xmlns="urn:vim25" xsi:type="InvalidProperty">
          <name>hardware.systemInfo.serialNumber</name>
        </InvalidPropertyFault>
      </detail>
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
	            <name>hardware.systemInfo.otherIdentifyingInfo</name>
	            <val>
	              <HostSystemIdentificationInfo>
	                <identifierType><key>ServiceTag</key><label>ServiceTag</label></identifierType>
	                <identifierValue>SN-123</identifierValue>
	              </HostSystemIdentificationInfo>
	            </val>
	          </propSet>
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
	          <name>hardware.systemInfo.otherIdentifyingInfo</name>
	          <val>
	            <HostSystemIdentificationInfo>
	              <identifierType><key>ServiceTag</key><label>ServiceTag</label></identifierType>
	              <identifierValue>SN-123</identifierValue>
	            </HostSystemIdentificationInfo>
	          </val>
	        </propSet>
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
      restApiSessionCalls++;
      const auth = req.headers.authorization ?? '';
      if (auth !== `Basic ${Buffer.from('user:pass').toString('base64')}`) {
        res.statusCode = 401;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }

      if (restSessionApiJsonRpcError) {
        // Some older deployments/proxies respond with a JSON-RPC error envelope here.
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32600, message: 'Invalid Request' },
          }),
        );
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(restSessionToken));
      return;
    }

    // Legacy session endpoint.
    if (method === 'POST' && url === '/rest/com/vmware/cis/session') {
      restCisSessionCalls++;
      const auth = req.headers.authorization ?? '';
      if (auth !== `Basic ${Buffer.from('user:pass').toString('base64')}`) {
        res.statusCode = 401;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ value: restSessionToken }));
      return;
    }

    if (restVcenterApiGetNotAllowed && method === 'GET' && pathname.startsWith('/api/vcenter/')) {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'text/html; charset=ISO-8859-1');
      res.end(`<!DOCTYPE html>
<html>
<head>
<meta http-equiv="Content-Type" content="text/html;charset=ISO-8859-1"/>
<title>Error 405 HTTP method GET is not supported by this URL</title>
</head>
<body><h2>HTTP ERROR 405 HTTP method GET is not supported by this URL</h2>
<table>
<tr><th>URI:</th><td>${pathname}</td></tr>
<tr><th>STATUS:</th><td>405</td></tr>
<tr><th>MESSAGE:</th><td>HTTP method GET is not supported by this URL</td></tr>
<tr><th>SERVLET:</th><td>servlet 3</td></tr>
</table>
</body>
</html>
`);
      return;
    }

    // The remaining endpoints only require the session header.
    if (req.headers['vmware-api-session-id'] !== restSessionToken) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'missing-session' }));
      return;
    }

    if (
      method === 'GET' &&
      (pathname === '/api/vcenter/system/version' || pathname === '/rest/vcenter/system/version')
    ) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      const payload = { product: 'VMware vCenter Server', version: restSystemVersion, build: restSystemBuild };
      res.end(JSON.stringify(restWrapValue ? { value: payload } : payload));
      return;
    }

    if (
      restVmListHostsParamUnsupported &&
      method === 'GET' &&
      (pathname === '/api/vcenter/vm' || pathname === '/rest/vcenter/vm') &&
      searchParams.has('hosts')
    ) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          type: 'com.vmware.vapi.std.errors.unexpected_input',
          value: {
            messages: [
              {
                args: ['[hosts]', 'operation-input'],
                default_message: "Found unexpected fields [hosts] in structure 'operation-input'.",
                id: 'vapi.data.structure.field.unexpected',
              },
            ],
          },
        }),
      );
      return;
    }

    if (
      method === 'GET' &&
      (pathname === '/api/vcenter/vm' || pathname === '/rest/vcenter/vm') &&
      searchParams.get('filter.hosts') === 'host-1'
    ) {
      restVmListFilterHostsCalls++;
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      const payload = [{ vm: 'vm-1' }];
      res.end(JSON.stringify(restWrapValue ? { value: payload } : payload));
      return;
    }

    if (
      method === 'GET' &&
      (pathname === '/api/vcenter/vm' || pathname === '/rest/vcenter/vm') &&
      searchParams.get('hosts') === 'host-1'
    ) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      const payload = [{ vm: 'vm-1' }];
      res.end(JSON.stringify(restWrapValue ? { value: payload } : payload));
      return;
    }

    if (
      method === 'GET' &&
      (pathname === '/api/vcenter/vm' || pathname === '/rest/vcenter/vm') &&
      !searchParams.has('hosts')
    ) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      const payload = [{ vm: 'vm-1' }];
      res.end(JSON.stringify(restWrapValue ? { value: payload } : payload));
      return;
    }
    if (method === 'GET' && (pathname === '/api/vcenter/vm/vm-1' || pathname === '/rest/vcenter/vm/vm-1')) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      const payload = restVmDetailFlat
        ? {
            vm: 'vm-1',
            name: 'vm-1-name',
            power_state: 'POWERED_ON',
            identity: { instance_uuid: 'uuid-1', name: 'vm-1-name' },
            cpu_count: 4,
            memory_size_MiB: 8192,
          }
        : {
            vm: 'vm-1',
            name: 'vm-1-name',
            power_state: 'POWERED_ON',
            identity: { instance_uuid: 'uuid-1', name: 'vm-1-name' },
            cpu: { count: 4 },
            memory: { size_MiB: 8192 },
          };

      res.end(JSON.stringify(restWrapValue ? { value: payload } : payload));
      return;
    }

    if (
      method === 'GET' &&
      (pathname === '/api/vcenter/vm/vm-1/guest/networking/interfaces' ||
        pathname === '/rest/vcenter/vm/vm-1/guest/networking/interfaces')
    ) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      const payload = [
        {
          mac_address: 'aa:bb:cc:dd:ee:ff',
          ip: { ip_addresses: [{ ip_address: '10.10.100.106' }, { ip_address: 'fe80::1' }] },
        },
      ];
      res.end(JSON.stringify(restWrapValue ? { value: payload } : payload));
      return;
    }

    if (
      method === 'GET' &&
      (pathname === '/api/vcenter/vm/vm-1/guest/networking' || pathname === '/rest/vcenter/vm/vm-1/guest/networking')
    ) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      const payload = { dns_values: { host_name: 'vm1.local' } };
      res.end(JSON.stringify(restWrapValue ? { value: payload } : payload));
      return;
    }

    if (
      method === 'GET' &&
      (pathname === '/api/vcenter/host' || pathname === '/rest/vcenter/host') &&
      searchParams.get('clusters') === 'domain-c7'
    ) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      const payload = [{ host: 'host-1' }];
      res.end(JSON.stringify(restWrapValue ? { value: payload } : payload));
      return;
    }

    if (
      method === 'GET' &&
      (pathname === '/api/vcenter/host' || pathname === '/rest/vcenter/host') &&
      !searchParams.has('clusters')
    ) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      const payload = [{ host: 'host-1', name: 'esxi-01', connection_state: 'CONNECTED', power_state: 'POWERED_ON' }];
      res.end(JSON.stringify(restWrapValue ? { value: payload } : payload));
      return;
    }

    if (method === 'GET' && (pathname === '/api/vcenter/cluster' || pathname === '/rest/vcenter/cluster')) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      const payload = [{ cluster: 'domain-c7', name: 'Cluster A' }];
      res.end(JSON.stringify(restWrapValue ? { value: payload } : payload));
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

  beforeEach(() => {
    soapFail = false;
    soapRetrievePropertiesExUnsupported = false;
    soapSerialNumberUnsupported = false;
    soapNvmeTopologyUnsupported = false;
    soapLoginCookie = 'vmware_soap_session="soap-123"';

    restSessionToken = 'token-123';
    restSessionApiJsonRpcError = false;
    restApiSessionCalls = 0;
    restCisSessionCalls = 0;

    restVcenterApiGetNotAllowed = false;
    restVcenterApiCalls = 0;
    restVcenterRestCalls = 0;

    restVmListHostsParamUnsupported = false;
    restVmListFilterHostsCalls = 0;

    restWrapValue = false;
    restVmDetailFlat = false;
    restSystemVersion = '7.0.3';
    restSystemBuild = '20036589';
  });

  it('healthcheck succeeds', async () => {
    const request = {
      schema_version: 'collector-request-v1',
      source: {
        source_id: 'src_1',
        source_type: 'vcenter',
        config: { endpoint, preferred_vcenter_version: '7.0-8.x' },
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
        config: { endpoint, preferred_vcenter_version: '7.0-8.x' },
        credential: { username: 'user', password: 'pass' },
      },
      request: { run_id: 'run_detect', mode: 'detect', now: new Date().toISOString() },
    };

    const result = await runCollector(request);
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout) as { schema_version: string; detect?: { driver?: string } };
    expect(parsed.schema_version).toBe('collector-response-v1');
    expect(parsed.detect?.driver).toBe('vcenter-7.0-8.x@v1');
  });

  it('collect_hosts returns host + cluster assets + relations', async () => {
    const request = {
      schema_version: 'collector-request-v1',
      source: {
        source_id: 'src_1',
        source_type: 'vcenter',
        config: { endpoint, preferred_vcenter_version: '7.0-8.x' },
        credential: { username: 'user', password: 'pass' },
      },
      request: { run_id: 'run_hosts', mode: 'collect_hosts', now: new Date().toISOString() },
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
    expect(parsed.assets).toHaveLength(2);
    expect(parsed.relations).toHaveLength(1);
    expect(parsed.stats).toEqual({ assets: 2, relations: 1, inventory_complete: true, warnings: [] });

    const host = parsed.assets.find((a) => a.external_kind === 'host' && a.external_id === 'host-1');
    expect(host).toBeTruthy();
    expect(host?.normalized).toMatchObject({
      os: { name: 'ESXi', version: '7.0.3', fingerprint: '20036589' },
      hardware: { cpu_count: 32, memory_bytes: 274877906944 },
      runtime: { power_state: 'poweredOn' },
      identity: { serial_number: 'SN-123', vendor: 'HP', model: 'ProLiant DL380p Gen8' },
      network: { management_ip: '192.168.1.10', ip_addresses: ['192.168.1.10'] },
      storage: { datastores: [{ name: 'local-vmfs-1', capacity_bytes: 1000 }] },
      attributes: { disk_total_bytes: 512 * 7814037168, datastore_total_bytes: 1000 },
    });
  });

  it('collect_hosts retries when hardware.systemInfo.serialNumber is an invalid SOAP property', async () => {
    soapRetrievePropertiesExUnsupported = true;
    soapSerialNumberUnsupported = true;
    try {
      const request = {
        schema_version: 'collector-request-v1',
        source: {
          source_id: 'src_1',
          source_type: 'vcenter',
          config: { endpoint, preferred_vcenter_version: '7.0-8.x' },
          credential: { username: 'user', password: 'pass' },
        },
        request: { run_id: 'run_hosts_serial_fallback', mode: 'collect_hosts', now: new Date().toISOString() },
      };

      const result = await runCollector(request);
      expect(result.exitCode).toBe(0);

      const parsed = JSON.parse(result.stdout) as {
        schema_version: string;
        stats: { warnings: Array<{ code?: string }> };
        errors?: unknown[];
      };
      expect(parsed.schema_version).toBe('collector-response-v1');
      expect(parsed.errors ?? []).toEqual([]);
      expect(parsed.stats.warnings).toEqual([]);
    } finally {
      soapRetrievePropertiesExUnsupported = false;
      soapSerialNumberUnsupported = false;
    }
  });

  it('collect_hosts retries when multiple SOAP properties are invalid (nvmeTopology then serialNumber)', async () => {
    soapRetrievePropertiesExUnsupported = true;
    soapNvmeTopologyUnsupported = true;
    soapSerialNumberUnsupported = true;
    try {
      const request = {
        schema_version: 'collector-request-v1',
        source: {
          source_id: 'src_1',
          source_type: 'vcenter',
          config: { endpoint, preferred_vcenter_version: '7.0-8.x' },
          credential: { username: 'user', password: 'pass' },
        },
        request: { run_id: 'run_hosts_multi_invalid', mode: 'collect_hosts', now: new Date().toISOString() },
      };

      const result = await runCollector(request);
      expect(result.exitCode).toBe(0);

      const parsed = JSON.parse(result.stdout) as {
        schema_version: string;
        stats: { warnings: Array<{ code?: string }> };
        errors?: unknown[];
      };
      expect(parsed.schema_version).toBe('collector-response-v1');
      expect(parsed.errors ?? []).toEqual([]);
      expect(parsed.stats.warnings).toEqual([]);
    } finally {
      soapRetrievePropertiesExUnsupported = false;
      soapNvmeTopologyUnsupported = false;
      soapSerialNumberUnsupported = false;
    }
  });

  it('collect_hosts uses /rest/vcenter/* when preferred_vcenter_version=6.5-6.7', async () => {
    restVcenterApiGetNotAllowed = true;
    restSystemVersion = '6.5.0';
    restSystemBuild = '123456';
    try {
      const request = {
        schema_version: 'collector-request-v1',
        source: {
          source_id: 'src_1',
          source_type: 'vcenter',
          config: { endpoint, preferred_vcenter_version: '6.5-6.7' },
          credential: { username: 'user', password: 'pass' },
        },
        request: { run_id: 'run_hosts_rest_fallback', mode: 'collect_hosts', now: new Date().toISOString() },
      };

      const result = await runCollector(request);
      expect(result.exitCode).toBe(0);
      expect(restVcenterRestCalls).toBeGreaterThan(0);
      expect(restVcenterApiCalls).toBe(0);
      expect(restApiSessionCalls).toBe(0);
      expect(restCisSessionCalls).toBeGreaterThan(0);

      const parsed = JSON.parse(result.stdout) as { schema_version: string; errors?: unknown[] };
      expect(parsed.schema_version).toBe('collector-response-v1');
      expect(parsed.errors ?? []).toEqual([]);
    } finally {
      restVcenterApiGetNotAllowed = false;
      restSystemVersion = '7.0.3';
      restSystemBuild = '20036589';
    }
  });

  it('collect_hosts does not fall back to /rest/vcenter/* when preferred_vcenter_version=7.0-8.x', async () => {
    restVcenterApiGetNotAllowed = true;
    try {
      const request = {
        schema_version: 'collector-request-v1',
        source: {
          source_id: 'src_1',
          source_type: 'vcenter',
          config: { endpoint, preferred_vcenter_version: '7.0-8.x' },
          credential: { username: 'user', password: 'pass' },
        },
        request: { run_id: 'run_hosts_no_rest_fallback', mode: 'collect_hosts', now: new Date().toISOString() },
      };

      const result = await runCollector(request);
      expect(result.exitCode).toBe(1);

      expect(restApiSessionCalls).toBeGreaterThan(0);
      expect(restVcenterApiCalls).toBeGreaterThan(0);
      expect(restVcenterRestCalls).toBe(0);
      expect(restCisSessionCalls).toBe(0);

      const parsed = JSON.parse(result.stdout) as { schema_version: string; errors?: Array<{ code?: string }> };
      expect(parsed.schema_version).toBe('collector-response-v1');
      expect(parsed.errors?.[0]?.code).toBe('VCENTER_NETWORK_ERROR');
    } finally {
      restVcenterApiGetNotAllowed = false;
    }
  });

  it('collect_vms returns vm assets + vm-host relations', async () => {
    const request = {
      schema_version: 'collector-request-v1',
      source: {
        source_id: 'src_1',
        source_type: 'vcenter',
        config: { endpoint, preferred_vcenter_version: '7.0-8.x' },
        credential: { username: 'user', password: 'pass' },
      },
      request: { run_id: 'run_vms', mode: 'collect_vms', now: new Date().toISOString() },
    };

    const result = await runCollector(request);
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout) as {
      schema_version: string;
      assets: Array<{ external_kind: string; external_id: string; normalized: { version: string } }>;
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
    expect(parsed.assets).toHaveLength(1);
    expect(parsed.relations).toHaveLength(2);
    expect(parsed.stats).toEqual({ assets: 1, relations: 2, inventory_complete: true, warnings: [] });

    expect(parsed.assets[0]).toMatchObject({ external_kind: 'vm', external_id: 'vm-1' });
    expect(parsed.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'runs_on',
          from: { external_kind: 'vm', external_id: 'vm-1' },
          to: { external_kind: 'host', external_id: 'host-1' },
        }),
        expect.objectContaining({
          type: 'hosts_vm',
          from: { external_kind: 'host', external_id: 'host-1' },
          to: { external_kind: 'vm', external_id: 'vm-1' },
        }),
      ]),
    );
  });

  it('collect_vms uses filter.hosts when preferred_vcenter_version=6.5-6.7', async () => {
    restVmListHostsParamUnsupported = true;
    restSystemVersion = '6.5.0';
    restSystemBuild = '123456';
    try {
      const request = {
        schema_version: 'collector-request-v1',
        source: {
          source_id: 'src_1',
          source_type: 'vcenter',
          config: { endpoint, preferred_vcenter_version: '6.5-6.7' },
          credential: { username: 'user', password: 'pass' },
        },
        request: { run_id: 'run_vms_filter_hosts', mode: 'collect_vms', now: new Date().toISOString() },
      };

      const result = await runCollector(request);
      expect(result.exitCode).toBe(0);
      expect(restVmListFilterHostsCalls).toBeGreaterThan(0);
      expect(restVcenterApiCalls).toBe(0);
      expect(restApiSessionCalls).toBe(0);
      expect(restCisSessionCalls).toBeGreaterThan(0);
    } finally {
      restVmListHostsParamUnsupported = false;
      restSystemVersion = '7.0.3';
      restSystemBuild = '20036589';
    }
  });

  it('collect_vms does not fall back to filter.hosts when preferred_vcenter_version=7.0-8.x', async () => {
    restVmListHostsParamUnsupported = true;
    try {
      const request = {
        schema_version: 'collector-request-v1',
        source: {
          source_id: 'src_1',
          source_type: 'vcenter',
          config: { endpoint, preferred_vcenter_version: '7.0-8.x' },
          credential: { username: 'user', password: 'pass' },
        },
        request: { run_id: 'run_vms_no_filter_hosts_fallback', mode: 'collect_vms', now: new Date().toISOString() },
      };

      const result = await runCollector(request);
      expect(result.exitCode).toBe(1);

      expect(restVcenterApiCalls).toBeGreaterThan(0);
      expect(restVcenterRestCalls).toBe(0);
      expect(restCisSessionCalls).toBe(0);
      expect(restVmListFilterHostsCalls).toBe(0);

      const parsed = JSON.parse(result.stdout) as { schema_version: string; errors?: Array<{ code?: string }> };
      expect(parsed.schema_version).toBe('collector-response-v1');
      expect(parsed.errors?.[0]?.code).toBe('VCENTER_NETWORK_ERROR');
    } finally {
      restVmListHostsParamUnsupported = false;
    }
  });

  it('collect_vms tolerates { value: ... } wrappers and 6.5-style flat fields', async () => {
    restWrapValue = true;
    restVmDetailFlat = true;
    restSystemVersion = '6.5.0';
    restSystemBuild = '123456';
    try {
      const request = {
        schema_version: 'collector-request-v1',
        source: {
          source_id: 'src_1',
          source_type: 'vcenter',
          config: { endpoint, preferred_vcenter_version: '6.5-6.7' },
          credential: { username: 'user', password: 'pass' },
        },
        request: { run_id: 'run_vms_wrapped', mode: 'collect_vms', now: new Date().toISOString() },
      };

      const result = await runCollector(request);
      expect(result.exitCode).toBe(0);

      const parsed = JSON.parse(result.stdout) as {
        schema_version: string;
        assets: Array<{ external_kind: string; external_id: string; normalized: Record<string, unknown> }>;
        relations: unknown[];
        stats: { assets: number; relations: number; inventory_complete: boolean; warnings: unknown[] };
        errors?: unknown[];
      };

      expect(parsed.schema_version).toBe('collector-response-v1');
      expect(parsed.errors ?? []).toEqual([]);
      expect(parsed.stats.inventory_complete).toBe(true);
      expect(parsed.relations).toHaveLength(2);

      const vm = parsed.assets.find((a) => a.external_kind === 'vm' && a.external_id === 'vm-1');
      expect(vm).toBeTruthy();
      expect(vm?.normalized).toMatchObject({
        hardware: { cpu_count: 4, memory_bytes: 8192 * 1024 * 1024 },
        runtime: { power_state: 'poweredOn' },
      });
    } finally {
      restWrapValue = false;
      restVmDetailFlat = false;
      restSystemVersion = '7.0.3';
      restSystemBuild = '20036589';
    }
  });

  it('collect_vms uses legacy /rest/com/vmware/cis/session when preferred_vcenter_version=6.5-6.7', async () => {
    restSessionApiJsonRpcError = true;
    restSessionToken = 'token-legacy';
    restWrapValue = true;
    restVmDetailFlat = true;
    restSystemVersion = '6.5.0';
    restSystemBuild = '123456';
    try {
      const request = {
        schema_version: 'collector-request-v1',
        source: {
          source_id: 'src_1',
          source_type: 'vcenter',
          config: { endpoint, preferred_vcenter_version: '6.5-6.7' },
          credential: { username: 'user', password: 'pass' },
        },
        request: { run_id: 'run_vms_legacy_session', mode: 'collect_vms', now: new Date().toISOString() },
      };

      const result = await runCollector(request);
      expect(result.exitCode).toBe(0);
      expect(restCisSessionCalls).toBeGreaterThan(0);
      expect(restApiSessionCalls).toBe(0);

      const parsed = JSON.parse(result.stdout) as { schema_version: string; errors?: unknown[] };
      expect(parsed.schema_version).toBe('collector-response-v1');
      expect(parsed.errors ?? []).toEqual([]);
    } finally {
      restSessionApiJsonRpcError = false;
      restSessionToken = 'token-123';
      restWrapValue = false;
      restVmDetailFlat = false;
      restSystemVersion = '7.0.3';
      restSystemBuild = '20036589';
    }
  });

  it('collect_vms does not fall back to legacy session when preferred_vcenter_version=7.0-8.x', async () => {
    restSessionApiJsonRpcError = true;
    try {
      const request = {
        schema_version: 'collector-request-v1',
        source: {
          source_id: 'src_1',
          source_type: 'vcenter',
          config: { endpoint, preferred_vcenter_version: '7.0-8.x' },
          credential: { username: 'user', password: 'pass' },
        },
        request: { run_id: 'run_vms_no_legacy_session_fallback', mode: 'collect_vms', now: new Date().toISOString() },
      };

      const result = await runCollector(request);
      expect(result.exitCode).toBe(1);

      expect(restApiSessionCalls).toBeGreaterThan(0);
      expect(restCisSessionCalls).toBe(0);
      expect(restVcenterApiCalls).toBe(0);
      expect(restVcenterRestCalls).toBe(0);

      const parsed = JSON.parse(result.stdout) as { schema_version: string; errors?: Array<{ code?: string }> };
      expect(parsed.schema_version).toBe('collector-response-v1');
      expect(parsed.errors?.[0]?.code).toBe('VCENTER_NETWORK_ERROR');
    } finally {
      restSessionApiJsonRpcError = false;
    }
  });

  it('collect returns assets + relations', async () => {
    const request = {
      schema_version: 'collector-request-v1',
      source: {
        source_id: 'src_1',
        source_type: 'vcenter',
        config: { endpoint, preferred_vcenter_version: '7.0-8.x' },
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
          config: { endpoint, preferred_vcenter_version: '7.0-8.x' },
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
        storage: { datastores: [{ name: 'local-vmfs-1', capacity_bytes: 1000 }] },
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
          config: { endpoint, preferred_vcenter_version: '7.0-8.x' },
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
        storage: { datastores: [{ name: 'local-vmfs-1', capacity_bytes: 1000 }] },
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
          config: { endpoint, preferred_vcenter_version: '7.0-8.x' },
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
        config: { endpoint, preferred_vcenter_version: '7.0-8.x' },
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
