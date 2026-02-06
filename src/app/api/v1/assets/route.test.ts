import { describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/v1/assets/route';
import { requireUser } from '@/lib/auth/require-user';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/auth/require-user', () => ({ requireUser: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const asset = {
    count: vi.fn(),
    findMany: vi.fn(),
  };

  return {
    prisma: {
      asset,
      $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
    },
  };
});

describe('GET /api/v1/assets', () => {
  it('returns okPaginated with request id header', async () => {
    (requireUser as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);

    (prisma.asset.count as any).mockResolvedValue(1);
    (prisma.asset.findMany as any).mockResolvedValue([
      {
        uuid: '550e8400-e29b-41d4-a716-446655440000',
        assetType: 'vm',
        status: 'in_service',
        displayName: 'vm-01',
        machineNameOverride: 'vm-guest-override',
        operationalState: {
          monitorCovered: true,
          monitorState: 'up',
          monitorStatus: 'Up',
          monitorUpdatedAt: new Date('2026-02-06T00:00:00.000Z'),
        },
        ledgerFields: null,
        createdAt: new Date('2026-01-28T00:00:00.000Z'),
        runSnapshots: [
          {
            canonical: {
              version: 'canonical-v1',
              asset_uuid: '550e8400-e29b-41d4-a716-446655440000',
              asset_type: 'vm',
              status: 'in_service',
              display_name: 'vm-01',
              last_seen_at: '2026-01-28T00:00:00.000Z',
              fields: {
                identity: {
                  hostname: { value: 'vm-guest-collected', sources: [{ source_id: 'src_1', run_id: 'run_1' }] },
                  caption: { value: 'vm-01', sources: [{ source_id: 'src_1', run_id: 'run_1' }] },
                },
                network: {
                  ip_addresses: {
                    value: ['10.10.100.106'],
                    sources: [{ source_id: 'src_1', run_id: 'run_1' }],
                  },
                },
                os: {
                  name: { value: 'Ubuntu', sources: [{ source_id: 'src_1', run_id: 'run_1' }] },
                  version: { value: '20.04', sources: [{ source_id: 'src_1', run_id: 'run_1' }] },
                },
                hardware: {
                  cpu_count: { value: 4, sources: [{ source_id: 'src_1', run_id: 'run_1' }] },
                  memory_bytes: { value: 8589934592, sources: [{ source_id: 'src_1', run_id: 'run_1' }] },
                  disks: {
                    value: [{ name: 'Hard disk 1', size_bytes: 53687091200, type: 'thin' }],
                    sources: [{ source_id: 'src_1', run_id: 'run_1' }],
                  },
                },
                runtime: {
                  power_state: { value: 'poweredOn', sources: [{ source_id: 'src_1', run_id: 'run_1' }] },
                },
              },
              relations: {
                outgoing: [
                  {
                    type: 'runs_on',
                    to: { asset_uuid: 'host_1', asset_type: 'host', display_name: '10.10.103.36' },
                  },
                ],
              },
            },
          },
        ],
      },
    ] as any);

    const req = new Request('http://localhost/api/v1/assets?page=1&pageSize=20');
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Request-ID')).toBe('req_test');

    const body = (await res.json()) as any;
    expect(body.pagination).toEqual({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
    expect(body.data).toEqual([
      {
        assetUuid: '550e8400-e29b-41d4-a716-446655440000',
        assetType: 'vm',
        status: 'in_service',
        brand: null,
        model: null,
        machineName: 'vm-guest-override',
        machineNameOverride: 'vm-guest-override',
        machineNameCollected: 'vm-guest-collected',
        machineNameMismatch: true,
        vmName: 'vm-01',
        hostName: '10.10.103.36',
        os: 'Ubuntu 20.04',
        osCollected: 'Ubuntu 20.04',
        osOverrideText: null,
        vmPowerState: 'poweredOn',
        toolsRunning: null,
        ip: '10.10.100.106',
        ipCollected: '10.10.100.106',
        ipOverrideText: null,
        recordedAt: '2026-01-28T00:00:00.000Z',
        monitorCovered: true,
        monitorState: 'up',
        monitorStatus: 'Up',
        monitorUpdatedAt: '2026-02-06T00:00:00.000Z',
        ledgerFields: {
          region: null,
          company: null,
          department: null,
          systemCategory: null,
          systemLevel: null,
          bizOwner: null,
          maintenanceDueDate: null,
          purchaseDate: null,
          bmcIp: null,
          cabinetNo: null,
          rackPosition: null,
          managementCode: null,
          fixedAssetNo: null,
        },
        cpuCount: 4,
        memoryBytes: 8589934592,
        totalDiskBytes: 53687091200,
      },
    ]);
  });

  it('returns ESXi host cpuCount from attributes.cpu_threads and totalDiskBytes from attributes.datastore_total_bytes (preferred)', async () => {
    (requireUser as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);

    (prisma.asset.count as any).mockResolvedValue(1);
    (prisma.asset.findMany as any).mockResolvedValue([
      {
        uuid: '550e8400-e29b-41d4-a716-446655440001',
        assetType: 'host',
        status: 'in_service',
        displayName: 'esxi-01',
        machineNameOverride: null,
        createdAt: new Date('2026-01-30T00:00:00.000Z'),
        runSnapshots: [
          {
            canonical: {
              version: 'canonical-v1',
              asset_uuid: '550e8400-e29b-41d4-a716-446655440001',
              asset_type: 'host',
              status: 'in_service',
              display_name: 'esxi-01',
              last_seen_at: '2026-01-30T00:00:00.000Z',
              fields: {
                identity: {
                  hostname: { value: 'esxi-01', sources: [{ source_id: 'src_1', run_id: 'run_1' }] },
                  vendor: { value: 'Dell', sources: [{ source_id: 'src_1', run_id: 'run_1' }] },
                  model: { value: 'R740', sources: [{ source_id: 'src_1', run_id: 'run_1' }] },
                },
                os: {
                  name: { value: 'ESXi', sources: [{ source_id: 'src_1', run_id: 'run_1' }] },
                  version: { value: '7.0.3', sources: [{ source_id: 'src_1', run_id: 'run_1' }] },
                  fingerprint: { value: '20036589', sources: [{ source_id: 'src_1', run_id: 'run_1' }] },
                },
                hardware: {
                  cpu_count: { value: 32, sources: [{ source_id: 'src_1', run_id: 'run_1' }] },
                  memory_bytes: { value: 274877906944, sources: [{ source_id: 'src_1', run_id: 'run_1' }] },
                  // Deliberately include disks to ensure host does NOT use this sum.
                  disks: {
                    value: [{ name: 'ignored', size_bytes: 123, type: 'thin' }],
                    sources: [{ source_id: 'src_1', run_id: 'run_1' }],
                  },
                },
                attributes: {
                  cpu_threads: { value: 64, sources: [{ source_id: 'src_1', run_id: 'run_1' }] },
                  datastore_total_bytes: { value: 1234, sources: [{ source_id: 'src_1', run_id: 'run_1' }] },
                  disk_total_bytes: { value: 999, sources: [{ source_id: 'src_1', run_id: 'run_1' }] },
                },
              },
              relations: { outgoing: [] },
            },
          },
        ],
      },
    ] as any);

    const req = new Request('http://localhost/api/v1/assets?page=1&pageSize=20&asset_type=host');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data[0]).toMatchObject({
      assetType: 'host',
      machineName: 'esxi-01',
      vmName: null,
      hostName: null,
      os: 'ESXi 7.0.3',
      brand: 'Dell',
      model: 'R740',
      cpuCount: 64,
      memoryBytes: 274877906944,
      totalDiskBytes: 1234,
      recordedAt: '2026-01-30T00:00:00.000Z',
    });
  });

  it('does not fall back to os.fingerprint for hosts when version is missing', async () => {
    (requireUser as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);

    (prisma.asset.count as any).mockResolvedValue(1);
    (prisma.asset.findMany as any).mockResolvedValue([
      {
        uuid: '550e8400-e29b-41d4-a716-446655440002',
        assetType: 'host',
        status: 'in_service',
        displayName: 'esxi-02',
        machineNameOverride: null,
        createdAt: new Date('2026-01-30T00:00:00.000Z'),
        runSnapshots: [
          {
            canonical: {
              version: 'canonical-v1',
              asset_uuid: '550e8400-e29b-41d4-a716-446655440002',
              asset_type: 'host',
              status: 'in_service',
              display_name: 'esxi-02',
              last_seen_at: '2026-01-30T00:00:00.000Z',
              fields: {
                identity: {
                  hostname: { value: 'esxi-02', sources: [{ source_id: 'src_1', run_id: 'run_1' }] },
                },
                os: {
                  name: { value: 'ESXi', sources: [{ source_id: 'src_1', run_id: 'run_1' }] },
                  fingerprint: { value: '20036589', sources: [{ source_id: 'src_1', run_id: 'run_1' }] },
                },
              },
              relations: { outgoing: [] },
            },
          },
        ],
      },
    ] as any);

    const req = new Request('http://localhost/api/v1/assets?page=1&pageSize=20&asset_type=host');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data[0].os).toBeNull();
  });

  it('filters assets by source_type via asset sourceLinks', async () => {
    (requireUser as any).mockResolvedValue({
      ok: true,
      requestId: 'req_test',
      session: { user: { id: 'u1' } },
    } as any);

    (prisma.asset.count as any).mockResolvedValue(0);
    (prisma.asset.findMany as any).mockResolvedValue([] as any);

    const req = new Request('http://localhost/api/v1/assets?page=1&pageSize=20&source_type=pve');
    const res = await GET(req);

    expect(res.status).toBe(200);

    expect((prisma.asset.count as any).mock.calls.at(-1)[0].where).toMatchObject({
      AND: expect.arrayContaining([{ sourceLinks: { some: { source: { sourceType: 'pve' } } } }]),
    });
    expect((prisma.asset.findMany as any).mock.calls.at(-1)[0].where).toMatchObject({
      AND: expect.arrayContaining([{ sourceLinks: { some: { source: { sourceType: 'pve' } } } }]),
    });
  });
});
