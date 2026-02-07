import { describe, expect, it } from 'vitest';

import { validateNormalizedV1 } from '@/lib/schema/validate';

import { normalizeRdsVm } from '../normalize';

describe('aliyun normalize (RDS)', () => {
  it('maps identity/runtime/location and keeps rds fields in attributes', () => {
    const asset = normalizeRdsVm({
      regionId: 'cn-beijing',
      raw: {
        DBInstanceId: 'rm-123',
        DBInstanceDescription: 'rds-prod-1',
        DBInstanceStatus: 'Running',
        connectionString: 'rm-123.mysql.rds.aliyuncs.com',
        engine: 'MySQL',
        engineVersion: '8.0',
        DBInstanceClass: 'rds.mysql.s2.large',
        DBInstanceCPU: '2',
        DBInstanceMemory: 4096,
        connectionMode: 'Standard',
      },
    });

    expect(asset.external_kind).toBe('vm');
    expect(asset.external_id).toBe('rds:rm-123');
    expect(asset.normalized.identity?.cloud_native_id).toBe('rm-123');
    expect(asset.normalized.identity?.caption).toBe('rds-prod-1');
    expect(asset.normalized.identity?.hostname).toBe('rm-123.mysql.rds.aliyuncs.com');
    expect(asset.normalized.location?.region).toBe('cn-beijing');
    expect(asset.normalized.runtime?.power_state).toBe('poweredOn');
    expect(asset.normalized.hardware?.cpu_count).toBe(2);
    expect(asset.normalized.hardware?.memory_bytes).toBe(4096 * 1024 * 1024);
    expect(asset.normalized.attributes?.rds_engine).toBe('MySQL');

    expect(validateNormalizedV1(asset.normalized)).toEqual({ ok: true });
  });

  it('extracts ip_addresses when connection string host is an IP', () => {
    const asset = normalizeRdsVm({
      regionId: 'cn-hangzhou',
      raw: {
        DBInstanceId: 'rm-1',
        DBInstanceStatus: 'Running',
        connectionString: '198.51.100.10:3306',
      },
    });

    expect(asset.normalized.identity?.hostname).toBe('198.51.100.10');
    expect(asset.normalized.network?.ip_addresses).toEqual(['198.51.100.10']);
    expect(validateNormalizedV1(asset.normalized)).toEqual({ ok: true });
  });
});
