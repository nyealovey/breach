import { describe, expect, it } from 'vitest';

import {
  ASSET_LEDGER_EXPORT_V1_COLUMNS,
  buildAssetLedgerExportV1Csv,
  buildAssetLedgerExportV1Row,
  escapeCsvField,
  toCsvLine,
} from '@/lib/exports/asset-ledger-export-v1';

describe('asset-ledger-export-v1', () => {
  it('escapes RFC4180 special chars', () => {
    expect(escapeCsvField('plain')).toBe('plain');
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('a\nb')).toBe('"a\nb"');
    expect(escapeCsvField('a"b')).toBe('"a""b"');
    expect(escapeCsvField('a,"b"\n')).toBe('"a,""b""\n"');
  });

  it('builds header with stable column order', () => {
    const header = toCsvLine([...ASSET_LEDGER_EXPORT_V1_COLUMNS]);
    expect(header).toBe(
      'asset_uuid,asset_type,status,display_name,last_seen_at,source_id,source_type,region,company,department,systemCategory,systemLevel,bizOwner,maintenanceDueDate,purchaseDate,bmcIp,cabinetNo,rackPosition,managementCode,fixedAssetNo',
    );
  });

  it('joins multi-source summary with stable order', () => {
    const row = buildAssetLedgerExportV1Row({
      asset: {
        uuid: 'a1',
        assetType: 'vm',
        status: 'in_service',
        displayName: 'vm-1',
        lastSeenAt: new Date('2026-01-31T12:34:56Z'),
      },
      sourceLinks: [
        { sourceId: 'src_b', sourceType: 'vcenter' },
        { sourceId: 'src_a', sourceType: 'pve' },
      ],
      ledgerFields: null,
    });

    expect(row.source_id).toBe('src_a;src_b');
    expect(row.source_type).toBe('pve;vcenter');
  });

  it('leaves host-only ledger fields empty for vm', () => {
    const row = buildAssetLedgerExportV1Row({
      asset: {
        uuid: 'a1',
        assetType: 'vm',
        status: 'in_service',
        displayName: null,
        lastSeenAt: null,
      },
      sourceLinks: [],
      ledgerFields: {
        regionSource: null,
        regionOverride: 'r1',
        companySource: null,
        companyOverride: 'c1',
        departmentSource: null,
        departmentOverride: null,
        systemCategorySource: null,
        systemCategoryOverride: null,
        systemLevelSource: null,
        systemLevelOverride: null,
        bizOwnerSource: null,
        bizOwnerOverride: null,
        maintenanceDueDateSource: null,
        maintenanceDueDateOverride: new Date('2026-01-01T00:00:00Z'),
        purchaseDateSource: null,
        purchaseDateOverride: new Date('2026-01-02T00:00:00Z'),
        bmcIpSource: null,
        bmcIpOverride: '10.0.0.1',
        cabinetNoSource: null,
        cabinetNoOverride: 'A-01',
        rackPositionSource: null,
        rackPositionOverride: 'U10',
        managementCodeSource: null,
        managementCodeOverride: 'M1',
        fixedAssetNoSource: null,
        fixedAssetNoOverride: 'FA1',
      },
    });

    expect(row.region).toBe('r1');
    expect(row.company).toBe('c1');
    expect(row.maintenanceDueDate).toBe('');
    expect(row.bmcIp).toBe('');
  });

  it('generates csv with newline termination', () => {
    const csv = buildAssetLedgerExportV1Csv([
      {
        asset_uuid: 'a1',
        asset_type: 'vm',
        status: 'in_service',
        display_name: 'a,b',
        last_seen_at: '',
        source_id: '',
        source_type: '',
        region: '',
        company: '',
        department: '',
        systemCategory: '',
        systemLevel: '',
        bizOwner: '',
        maintenanceDueDate: '',
        purchaseDate: '',
        bmcIp: '',
        cabinetNo: '',
        rackPosition: '',
        managementCode: '',
        fixedAssetNo: '',
      },
    ]);

    expect(csv.endsWith('\n')).toBe(true);
    const lines = csv.trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(
      toCsvLine(['a1', 'vm', 'in_service', 'a,b', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']),
    );
  });
});
