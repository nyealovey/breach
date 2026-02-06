import { describe, expect, it, vi } from 'vitest';

import { Prisma } from '@prisma/client';
import { buildAssetListWhere, isUuid, parseAssetListQuery } from '@/lib/assets/asset-list-query';

describe('asset list query', () => {
  it('parses supported query params and trims q', () => {
    const params = new URLSearchParams({
      asset_type: 'vm',
      source_id: 'src_1',
      q: '  host-01  ',
      vm_power_state: 'poweredOn',
      ip_missing: 'true',
    });
    expect(parseAssetListQuery(params)).toEqual({
      assetType: 'vm',
      excludeAssetType: undefined,
      sourceId: 'src_1',
      q: 'host-01',
      status: undefined,
      brand: undefined,
      model: undefined,
      region: undefined,
      company: undefined,
      department: undefined,
      systemCategory: undefined,
      systemLevel: undefined,
      bizOwner: undefined,
      os: undefined,
      vmPowerState: 'poweredOn',
      ipMissing: true,
      machineNameMissing: undefined,
      machineNameVmNameMismatch: undefined,
      createdWithinDays: undefined,
    });
  });

  it('parses quick filters (machine_name_missing/vmname_mismatch/created_within_days)', () => {
    const params = new URLSearchParams({
      asset_type: 'vm',
      machine_name_missing: 'true',
      machine_name_vmname_mismatch: 'true',
      created_within_days: '7',
    });

    expect(parseAssetListQuery(params)).toEqual({
      assetType: 'vm',
      excludeAssetType: undefined,
      sourceId: undefined,
      q: undefined,
      status: undefined,
      brand: undefined,
      model: undefined,
      region: undefined,
      company: undefined,
      department: undefined,
      systemCategory: undefined,
      systemLevel: undefined,
      bizOwner: undefined,
      os: undefined,
      vmPowerState: undefined,
      ipMissing: undefined,
      machineNameMissing: true,
      machineNameVmNameMismatch: true,
      createdWithinDays: 7,
    });
  });

  it('parses status/brand/model', () => {
    const params = new URLSearchParams({
      status: 'offline',
      brand: '  Dell  ',
      model: ' R740 ',
    });

    expect(parseAssetListQuery(params)).toEqual({
      assetType: undefined,
      excludeAssetType: undefined,
      sourceId: undefined,
      q: undefined,
      status: 'offline',
      brand: 'Dell',
      model: 'R740',
      region: undefined,
      company: undefined,
      department: undefined,
      systemCategory: undefined,
      systemLevel: undefined,
      bizOwner: undefined,
      os: undefined,
      vmPowerState: undefined,
      ipMissing: undefined,
      machineNameMissing: undefined,
      machineNameVmNameMismatch: undefined,
      createdWithinDays: undefined,
    });
  });

  it('treats unknown asset_type as undefined', () => {
    const params = new URLSearchParams({ asset_type: 'nope' });
    expect(parseAssetListQuery(params)).toEqual({
      assetType: undefined,
      excludeAssetType: undefined,
      sourceId: undefined,
      q: undefined,
      status: undefined,
      brand: undefined,
      model: undefined,
      region: undefined,
      company: undefined,
      department: undefined,
      systemCategory: undefined,
      systemLevel: undefined,
      bizOwner: undefined,
      os: undefined,
      vmPowerState: undefined,
      ipMissing: undefined,
      machineNameMissing: undefined,
      machineNameVmNameMismatch: undefined,
      createdWithinDays: undefined,
    });
  });

  it('parses exclude_asset_type', () => {
    const params = new URLSearchParams({ exclude_asset_type: 'cluster' });
    expect(parseAssetListQuery(params)).toEqual({
      assetType: undefined,
      excludeAssetType: 'cluster',
      sourceId: undefined,
      q: undefined,
      status: undefined,
      brand: undefined,
      model: undefined,
      region: undefined,
      company: undefined,
      department: undefined,
      systemCategory: undefined,
      systemLevel: undefined,
      bizOwner: undefined,
      os: undefined,
      vmPowerState: undefined,
      ipMissing: undefined,
      machineNameMissing: undefined,
      machineNameVmNameMismatch: undefined,
      createdWithinDays: undefined,
    });
  });

  it('detects uuid strings', () => {
    expect(isUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
  });

  it('builds where with filters and non-uuid search', () => {
    const where = buildAssetListWhere({ assetType: 'host', sourceId: 'src_1', q: 'esx' });
    expect(where).toMatchObject({
      AND: expect.arrayContaining([
        { status: { not: 'merged' } },
        { assetType: 'host' },
        { sourceLinks: { some: { sourceId: 'src_1' } } },
        {
          OR: expect.arrayContaining([
            { displayName: { contains: 'esx', mode: 'insensitive' } },
            { machineNameOverride: { contains: 'esx', mode: 'insensitive' } },
            { sourceLinks: { some: { externalId: { contains: 'esx', mode: 'insensitive' } } } },
            {
              outgoingRelations: {
                some: { relationType: 'runs_on', toAsset: { displayName: { contains: 'esx', mode: 'insensitive' } } },
              },
            },
            {
              runSnapshots: {
                some: {
                  canonical: { path: ['fields', 'os', 'name', 'value'], string_contains: 'esx', mode: 'insensitive' },
                },
              },
            },
          ]),
        },
      ]),
    });
  });

  it('builds where with exclude_asset_type', () => {
    const where = buildAssetListWhere({ excludeAssetType: 'cluster' });
    expect(where).toEqual({ AND: [{ status: { not: 'merged' } }, { assetType: { not: 'cluster' } }] });
  });

  it('builds where with status', () => {
    const where = buildAssetListWhere({ status: 'offline' });
    expect(where).toMatchObject({
      AND: expect.arrayContaining([{ status: { not: 'merged' } }, { status: 'offline' }]),
    });
  });

  it('builds where with host-only brand/model filters', () => {
    const where = buildAssetListWhere({ brand: 'Dell', model: 'R740' });
    expect(where).toMatchObject({
      AND: expect.arrayContaining([
        { status: { not: 'merged' } },
        { assetType: 'host' },
        {
          runSnapshots: {
            some: {
              canonical: {
                path: ['fields', 'identity', 'vendor', 'value'],
                string_contains: 'Dell',
                mode: 'insensitive',
              },
            },
          },
        },
        {
          runSnapshots: {
            some: {
              canonical: {
                path: ['fields', 'identity', 'model', 'value'],
                string_contains: 'R740',
                mode: 'insensitive',
              },
            },
          },
        },
      ]),
    });
  });

  it('builds where with vm_power_state (only when assetType=vm)', () => {
    const where = buildAssetListWhere({ assetType: 'vm', vmPowerState: 'poweredOn' });
    expect(where).toMatchObject({
      AND: expect.arrayContaining([
        { status: { not: 'merged' } },
        { assetType: 'vm' },
        {
          runSnapshots: {
            some: { canonical: { path: ['fields', 'runtime', 'power_state', 'value'], equals: 'poweredOn' } },
          },
        },
      ]),
    });

    const ignored = buildAssetListWhere({ assetType: 'host', vmPowerState: 'poweredOn' });
    expect(ignored).toEqual({ AND: [{ status: { not: 'merged' } }, { assetType: 'host' }] });
  });

  it('builds where with ip_missing=true (only when assetType=vm)', () => {
    const where = buildAssetListWhere({ assetType: 'vm', ipMissing: true });
    expect(where).toMatchObject({
      AND: expect.arrayContaining([
        { status: { not: 'merged' } },
        { assetType: 'vm' },
        {
          AND: [
            { OR: [{ ipOverrideText: null }, { ipOverrideText: '' }] },
            {
              OR: [
                {
                  runSnapshots: {
                    some: {
                      canonical: { path: ['fields', 'network', 'ip_addresses', 'value'], equals: Prisma.AnyNull },
                    },
                  },
                },
                {
                  runSnapshots: {
                    some: { canonical: { path: ['fields', 'network', 'ip_addresses', 'value'], equals: [] } },
                  },
                },
              ],
            },
          ],
        },
      ]),
    });

    const ignored = buildAssetListWhere({ assetType: 'host', ipMissing: true });
    expect(ignored).toEqual({ AND: [{ status: { not: 'merged' } }, { assetType: 'host' }] });
  });

  it('builds where with machine_name_missing=true (only when assetType=vm)', () => {
    const where = buildAssetListWhere({ assetType: 'vm', machineNameMissing: true });
    expect(where).toMatchObject({
      AND: expect.arrayContaining([
        { status: { not: 'merged' } },
        { assetType: 'vm' },
        {
          AND: [
            { OR: [{ machineNameOverride: null }, { machineNameOverride: '' }] },
            { OR: [{ collectedHostname: null }, { collectedHostname: '' }] },
          ],
        },
      ]),
    });

    const ignored = buildAssetListWhere({ assetType: 'host', machineNameMissing: true });
    expect(ignored).toEqual({ AND: [{ status: { not: 'merged' } }, { assetType: 'host' }] });
  });

  it('builds where with machine_name_vmname_mismatch=true (only when assetType=vm)', () => {
    const where = buildAssetListWhere({ assetType: 'vm', machineNameVmNameMismatch: true });
    expect(where).toMatchObject({
      AND: expect.arrayContaining([
        { status: { not: 'merged' } },
        { assetType: 'vm' },
        { machineNameVmNameMismatch: true },
      ]),
    });

    const ignored = buildAssetListWhere({ assetType: 'host', machineNameVmNameMismatch: true });
    expect(ignored).toEqual({ AND: [{ status: { not: 'merged' } }, { assetType: 'host' }] });
  });

  it('builds where with createdWithinDays', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-02-05T00:00:00.000Z').getTime());

    const where = buildAssetListWhere({ createdWithinDays: 7 });

    nowSpy.mockRestore();

    const and = (where as any).AND as any[];
    const clause = and.find((c) => c && typeof c === 'object' && c.createdAt && c.createdAt.gte instanceof Date);
    expect(clause?.createdAt?.gte?.toISOString()).toBe('2026-01-29T00:00:00.000Z');
  });

  it('builds where with uuid equality search (not contains)', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const where = buildAssetListWhere({ q: uuid });
    expect(where).toMatchObject({
      AND: expect.arrayContaining([
        { status: { not: 'merged' } },
        {
          OR: expect.arrayContaining([
            { displayName: { contains: uuid, mode: 'insensitive' } },
            { machineNameOverride: { contains: uuid, mode: 'insensitive' } },
            { sourceLinks: { some: { externalId: { contains: uuid, mode: 'insensitive' } } } },
            { uuid },
          ]),
        },
      ]),
    });
  });

  it('restricts os.fingerprint search to VMs (host build is not searchable)', () => {
    const q = '20036589';
    const where = buildAssetListWhere({ q });

    const and = (where as any).AND as any[];
    const or = and?.find((c) => c && typeof c === 'object' && 'OR' in c)?.OR as any[];

    expect(or).toContainEqual({
      assetType: 'vm',
      runSnapshots: {
        some: {
          canonical: { path: ['fields', 'os', 'fingerprint', 'value'], string_contains: q, mode: 'insensitive' },
        },
      },
    });

    // Must not include an unscoped fingerprint clause that would also match hosts.
    expect(or).not.toContainEqual({
      runSnapshots: {
        some: {
          canonical: { path: ['fields', 'os', 'fingerprint', 'value'], string_contains: q, mode: 'insensitive' },
        },
      },
    });
  });

  it('supports ledger-fields-v1 filters (region/company/department/systemCategory/systemLevel/bizOwner)', () => {
    const where = buildAssetListWhere({
      region: 'cn-shanghai',
      company: 'ACME',
      department: 'IT',
      systemCategory: '财经',
      systemLevel: '核心',
      bizOwner: 'Alice',
    });

    const and = (where as any).AND as any[];
    expect(and).toEqual(expect.arrayContaining([{ status: { not: 'merged' } }]));

    expect(and).toContainEqual({
      OR: [
        { ledgerFields: { is: { regionOverride: { contains: 'cn-shanghai', mode: 'insensitive' } } } },
        {
          AND: [
            { ledgerFields: { is: { regionOverride: null } } },
            { ledgerFields: { is: { regionSource: { contains: 'cn-shanghai', mode: 'insensitive' } } } },
          ],
        },
      ],
    });
    expect(and).toContainEqual({
      OR: [
        { ledgerFields: { is: { companyOverride: { contains: 'ACME', mode: 'insensitive' } } } },
        {
          AND: [
            { ledgerFields: { is: { companyOverride: null } } },
            { ledgerFields: { is: { companySource: { contains: 'ACME', mode: 'insensitive' } } } },
          ],
        },
      ],
    });
    expect(and).toContainEqual({
      OR: [
        { ledgerFields: { is: { departmentOverride: { contains: 'IT', mode: 'insensitive' } } } },
        {
          AND: [
            { ledgerFields: { is: { departmentOverride: null } } },
            { ledgerFields: { is: { departmentSource: { contains: 'IT', mode: 'insensitive' } } } },
          ],
        },
      ],
    });
    expect(and).toContainEqual({
      OR: [
        { ledgerFields: { is: { systemCategoryOverride: { contains: '财经', mode: 'insensitive' } } } },
        {
          AND: [
            { ledgerFields: { is: { systemCategoryOverride: null } } },
            { ledgerFields: { is: { systemCategorySource: { contains: '财经', mode: 'insensitive' } } } },
          ],
        },
      ],
    });
    expect(and).toContainEqual({
      OR: [
        { ledgerFields: { is: { systemLevelOverride: { contains: '核心', mode: 'insensitive' } } } },
        {
          AND: [
            { ledgerFields: { is: { systemLevelOverride: null } } },
            { ledgerFields: { is: { systemLevelSource: { contains: '核心', mode: 'insensitive' } } } },
          ],
        },
      ],
    });
    expect(and).toContainEqual({
      OR: [
        { ledgerFields: { is: { bizOwnerOverride: { contains: 'Alice', mode: 'insensitive' } } } },
        {
          AND: [
            { ledgerFields: { is: { bizOwnerOverride: null } } },
            { ledgerFields: { is: { bizOwnerSource: { contains: 'Alice', mode: 'insensitive' } } } },
          ],
        },
      ],
    });
  });

  it('supports os filter via canonical fields.os.name', () => {
    const where = buildAssetListWhere({ os: 'Ubuntu' });
    expect(where).toMatchObject({
      AND: expect.arrayContaining([
        { status: { not: 'merged' } },
        {
          OR: expect.arrayContaining([
            { osOverrideText: { contains: 'Ubuntu', mode: 'insensitive' } },
            {
              runSnapshots: {
                some: {
                  canonical: {
                    path: ['fields', 'os', 'name', 'value'],
                    string_contains: 'Ubuntu',
                    mode: 'insensitive',
                  },
                },
              },
            },
          ]),
        },
      ]),
    });
  });

  it('includes ledger-fields-v1 in q search OR clauses', () => {
    const q = 'ACME';
    const where = buildAssetListWhere({ q });

    const and = (where as any).AND as any[];
    const or = and?.find((c) => c && typeof c === 'object' && 'OR' in c)?.OR as any[];

    expect(or).toContainEqual({
      OR: [
        { ledgerFields: { is: { companyOverride: { contains: q, mode: 'insensitive' } } } },
        {
          AND: [
            { ledgerFields: { is: { companyOverride: null } } },
            { ledgerFields: { is: { companySource: { contains: q, mode: 'insensitive' } } } },
          ],
        },
      ],
    });
    expect(or).toContainEqual({
      OR: [
        { ledgerFields: { is: { bizOwnerOverride: { contains: q, mode: 'insensitive' } } } },
        {
          AND: [
            { ledgerFields: { is: { bizOwnerOverride: null } } },
            { ledgerFields: { is: { bizOwnerSource: { contains: q, mode: 'insensitive' } } } },
          ],
        },
      ],
    });
  });
});
