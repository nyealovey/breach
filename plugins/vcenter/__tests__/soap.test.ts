import { expect, it } from 'vitest';

import { parseRetrievePropertiesExHostResult } from '../soap';

it('parses RetrievePropertiesEx host properties + localDisk total', () => {
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
              <HostScsiDisk>
                <localDisk>true</localDisk>
                <capacity><blockSize>512</blockSize><block>7814037168</block></capacity>
              </HostScsiDisk>
              <HostScsiDisk>
                <localDisk>false</localDisk>
                <capacity><blockSize>512</blockSize><block>1</block></capacity>
              </HostScsiDisk>
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
    diskTotalBytes: 512 * 7814037168,
  });
});
