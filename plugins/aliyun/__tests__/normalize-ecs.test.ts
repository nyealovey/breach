import { describe, expect, it } from 'vitest';

import { validateNormalizedV1 } from '@/lib/schema/validate';

import { normalizeEcsVm } from '../normalize';

describe('aliyun normalize (ECS)', () => {
  it('maps identity/hardware/network/runtime/location', () => {
    const asset = normalizeEcsVm({
      regionId: 'cn-hangzhou',
      raw: {
        instanceId: 'i-123',
        instanceName: 'ecs-vm-1',
        hostName: 'ecs-host-1',
        cpu: 2,
        memory: 1024,
        status: 'Running',
        OSName: 'CentOS 7.9 64-bit',
        innerIpAddress: { ipAddress: ['192.0.2.10'] },
        publicIpAddress: { ipAddress: ['203.0.113.10'] },
        networkInterfaces: {
          networkInterface: [
            {
              macAddress: 'aa:bb:cc:dd:ee:ff',
              primaryIpAddress: '192.0.2.10',
              privateIpSets: { privateIpSet: [{ privateIpAddress: '198.51.100.10' }] },
            },
          ],
        },
      },
    });

    expect(asset.external_kind).toBe('vm');
    expect(asset.external_id).toBe('ecs:i-123');
    expect(asset.normalized.identity?.cloud_native_id).toBe('i-123');
    expect(asset.normalized.identity?.caption).toBe('ecs-vm-1');
    expect(asset.normalized.identity?.hostname).toBe('ecs-host-1');
    expect(asset.normalized.location?.region).toBe('cn-hangzhou');
    expect(asset.normalized.hardware?.cpu_count).toBe(2);
    expect(asset.normalized.hardware?.memory_bytes).toBe(1024 * 1024 * 1024);
    expect(asset.normalized.runtime?.power_state).toBe('poweredOn');
    expect(asset.normalized.network?.ip_addresses).toEqual(['192.0.2.10', '203.0.113.10', '198.51.100.10']);
    expect(asset.normalized.network?.mac_addresses).toEqual(['aa:bb:cc:dd:ee:ff']);

    expect(validateNormalizedV1(asset.normalized)).toEqual({ ok: true });
  });
});
