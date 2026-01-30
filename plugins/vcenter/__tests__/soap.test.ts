import { expect, it } from 'vitest';

import { parseRetrievePropertiesExHostResult } from '../soap';

// 新逻辑：基于 lunType === "disk" 来识别磁盘，不再依赖 localDisk 字段
it('parses RetrievePropertiesEx host properties + disk total (lunType=disk)', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
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
          <propSet>
            <name>config.storageDevice.scsiLun</name>
            <val>
              <ScsiLun>
                <lunType>storageArrayController</lunType>
              </ScsiLun>
              <ScsiLun>
                <lunType>disk</lunType>
                <capacity><blockSize>512</blockSize><block>7814037168</block></capacity>
              </ScsiLun>
              <ScsiLun>
                <lunType>disk</lunType>
                <capacity><blockSize>512</blockSize><block>1000000</block></capacity>
              </ScsiLun>
            </val>
          </propSet>
        </objects>
      </returnval>
    </RetrievePropertiesExResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

  const out = parseRetrievePropertiesExHostResult(xml);
  expect(out.get('host-1')).toMatchObject({
    esxiVersion: '7.0.3',
    esxiBuild: '20036589',
    cpuCores: 32,
    memoryBytes: 274877906944,
    diskTotalBytes: 512 * 7814037168 + 512 * 1000000,
  });
});

it('returns undefined when no disk devices found', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <RetrievePropertiesExResponse xmlns="urn:vim25">
      <returnval>
        <objects>
          <obj type="HostSystem">host-1</obj>
          <propSet>
            <name>config.storageDevice.scsiLun</name>
            <val>
              <ScsiLun>
                <lunType>storageArrayController</lunType>
              </ScsiLun>
            </val>
          </propSet>
        </objects>
      </returnval>
    </RetrievePropertiesExResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

  const out = parseRetrievePropertiesExHostResult(xml);
  expect(out.get('host-1')?.diskTotalBytes).toBeUndefined();
});

it('parses disk with lunType=disk and capacity', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <RetrievePropertiesExResponse xmlns="urn:vim25">
      <returnval>
        <objects>
          <obj type="HostSystem">host-1</obj>
          <propSet>
            <name>config.storageDevice.scsiLun</name>
            <val>
              <ScsiLun>
                <lunType>disk</lunType>
                <capacity><blockSize>512</blockSize><block>10</block></capacity>
              </ScsiLun>
            </val>
          </propSet>
        </objects>
      </returnval>
    </RetrievePropertiesExResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

  const out = parseRetrievePropertiesExHostResult(xml);
  expect(out.get('host-1')?.diskTotalBytes).toBe(512 * 10);
});

it('parses multiple disks and sums capacity', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <RetrievePropertiesExResponse xmlns="urn:vim25">
      <returnval>
        <objects>
          <obj type="HostSystem">host-1</obj>
          <propSet>
            <name>config.storageDevice.scsiLun</name>
            <val>
              <ScsiLun>
                <lunType>disk</lunType>
                <capacity><blockSize>512</blockSize><block>10</block></capacity>
              </ScsiLun>
              <ScsiLun>
                <lunType>disk</lunType>
                <capacity><blockSize>512</blockSize><block>20</block></capacity>
              </ScsiLun>
            </val>
          </propSet>
        </objects>
      </returnval>
    </RetrievePropertiesExResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

  const out = parseRetrievePropertiesExHostResult(xml);
  expect(out.get('host-1')?.diskTotalBytes).toBe(512 * 10 + 512 * 20);
});

it('parses nvmeTopology namespaces into diskTotalBytes', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <RetrievePropertiesExResponse xmlns="urn:vim25">
      <returnval>
        <objects>
          <obj type="HostSystem">host-1</obj>
          <propSet>
            <name>config.storageDevice.nvmeTopology</name>
            <val>
              <HostNvmeTopology>
                <adapter>
                  <HostNvmeTopologyInterface>
                    <connectedController>
                      <HostNvmeController>
                        <attachedNamespace>
                          <HostNvmeNamespace>
                            <uuid>ns-1</uuid>
                            <blockSize>512</blockSize>
                            <capacityInBlocks>10</capacityInBlocks>
                          </HostNvmeNamespace>
                        </attachedNamespace>
                      </HostNvmeController>
                    </connectedController>
                  </HostNvmeTopologyInterface>
                </adapter>
              </HostNvmeTopology>
            </val>
          </propSet>
        </objects>
      </returnval>
    </RetrievePropertiesExResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

  const out = parseRetrievePropertiesExHostResult(xml);
  expect(out.get('host-1')?.diskTotalBytes).toBe(512 * 10);
});

it('parses system model + management ip (prefers vmk0)', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <RetrievePropertiesExResponse xmlns="urn:vim25">
      <returnval>
        <objects>
          <obj type="HostSystem">host-1</obj>
          <propSet><name>hardware.systemInfo.vendor</name><val>HP</val></propSet>
          <propSet><name>hardware.systemInfo.model</name><val>ProLiant DL380p Gen8</val></propSet>
          <propSet>
            <name>config.network.vnic</name>
            <val>
              <HostVirtualNic>
                <device>vmk1</device>
                <portgroup>vMotion</portgroup>
                <spec><ip><ipAddress>10.0.0.2</ipAddress></ip></spec>
              </HostVirtualNic>
              <HostVirtualNic>
                <device>vmk0</device>
                <portgroup>Management Network</portgroup>
                <spec><ip><ipAddress>192.168.1.10</ipAddress></ip></spec>
              </HostVirtualNic>
            </val>
          </propSet>
        </objects>
      </returnval>
    </RetrievePropertiesExResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

  const out = parseRetrievePropertiesExHostResult(xml);
  expect(out.get('host-1')).toMatchObject({
    systemVendor: 'HP',
    systemModel: 'ProLiant DL380p Gen8',
    managementIp: '192.168.1.10',
  });
  expect(out.get('host-1')?.ipAddresses).toEqual(expect.arrayContaining(['10.0.0.2', '192.168.1.10']));
});

it('parses host system serial number', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <RetrievePropertiesExResponse xmlns="urn:vim25">
      <returnval>
        <objects>
          <obj type="HostSystem">host-1</obj>
          <propSet><name>hardware.systemInfo.serialNumber</name><val>SN-123</val></propSet>
        </objects>
      </returnval>
    </RetrievePropertiesExResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

  const out = parseRetrievePropertiesExHostResult(xml);
  expect(out.get('host-1')?.systemSerialNumber).toBe('SN-123');
});
