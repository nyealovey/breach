import { describe, expect, it } from 'vitest';

import { buildClusterInventory, buildStandaloneInventory } from './inventory';

describe('hyperv inventory', () => {
  it('standalone success produces inventory_complete=true and relations>0', () => {
    const res = buildStandaloneInventory({
      host: { hostname: 'NODE1', host_uuid: 'h-1' },
      vms: [
        {
          vm_id: 'vm-1',
          name: 'VM1',
          state: 'Running',
          cpu_count: 2,
          memory_bytes: 1024,
          disks: [{ name: 'SCSI 0:0', size_bytes: 10 }],
        },
      ],
    });

    expect(res.exitCode).toBe(0);
    expect(res.stats.inventory_complete).toBe(true);
    expect(res.relations.length).toBeGreaterThan(0);
  });

  it('normalizes host network + power_state + datastores when provided', () => {
    const res = buildStandaloneInventory({
      host: {
        hostname: 'NODE1',
        host_uuid: 'h-1',
        ip_addresses: ['192.0.2.10', '192.0.2.10', '169.254.1.1'],
        management_ip: '192.0.2.10',
        power_state: 'poweredOn',
        datastores: [
          { name: 'C:', capacity_bytes: 1000 },
          { name: 'D:', capacity_bytes: 2000 },
        ],
        disk_total_bytes: 5000,
      },
      vms: [{ vm_id: 'vm-1', name: 'VM1', state: 'Running' }],
    });

    const host = res.assets.find((a) => a.external_kind === 'host');
    expect(host).toBeTruthy();
    expect((host as any).normalized).toMatchObject({
      network: { ip_addresses: ['192.0.2.10', '169.254.1.1'], management_ip: '192.0.2.10' },
      runtime: { power_state: 'poweredOn' },
      storage: {
        datastores: [
          { name: 'C:', capacity_bytes: 1000 },
          { name: 'D:', capacity_bytes: 2000 },
        ],
      },
      attributes: { disk_total_bytes: 5000, datastore_total_bytes: 3000 },
    });
  });

  it('includes vm hardware.disks when provided', () => {
    const res = buildStandaloneInventory({
      host: { hostname: 'NODE1', host_uuid: 'h-1' },
      vms: [{ vm_id: 'vm-1', name: 'VM1', state: 'Running', disks: [{ name: 'SCSI 0:0', size_bytes: 100 }] }],
    });

    const vm = res.assets.find((a) => a.external_kind === 'vm');
    expect(vm).toBeTruthy();
    const normalized = (vm as any).normalized;
    expect(normalized.hardware.disks).toEqual([{ name: 'SCSI 0:0', size_bytes: 100 }]);
  });

  it('keeps vm disk entries even when size_bytes is missing (best-effort)', () => {
    const res = buildStandaloneInventory({
      host: { hostname: 'NODE1', host_uuid: 'h-1' },
      vms: [{ vm_id: 'vm-1', name: 'VM1', state: 'Running', disks: [{ name: 'SCSI 0:0' }] }],
    });

    const vm = res.assets.find((a) => a.external_kind === 'vm');
    expect(vm).toBeTruthy();
    const normalized = (vm as any).normalized;
    expect(normalized.hardware.disks).toEqual([{ name: 'SCSI 0:0' }]);
  });

  it('maps hyperv vm disk type + tools status into normalized fields (vcenter-aligned)', () => {
    const res = buildStandaloneInventory({
      host: { hostname: 'NODE1', host_uuid: 'h-1' },
      vms: [
        {
          vm_id: 'vm-1',
          name: 'VM1',
          state: 'Running',
          tools_running: true,
          tools_status: 'OK',
          disks: [{ name: 'SCSI 0:0', size_bytes: 100, type: 'thin', file_size_bytes: 50 }],
          disk_file_size_bytes_total: 50,
        },
      ],
    });

    const vm = res.assets.find((a) => a.external_kind === 'vm');
    expect(vm).toBeTruthy();
    const normalized = (vm as any).normalized;
    expect(normalized).toMatchObject({
      runtime: { power_state: 'poweredOn', tools_running: true, tools_status: 'OK' },
      hardware: { disks: [{ name: 'SCSI 0:0', size_bytes: 100, type: 'thin' }] },
      attributes: { disk_file_size_bytes_total: 50 },
    });
  });

  it('dedupes vm network ip/mac addresses', () => {
    const res = buildStandaloneInventory({
      host: { hostname: 'NODE1', host_uuid: 'h-1' },
      vms: [
        {
          vm_id: 'vm-1',
          name: 'VM1',
          state: 'Running',
          ip_addresses: ['192.0.2.11', '192.0.2.11'],
          mac_addresses: ['00:15:5d:12:34:56', '00:15:5d:12:34:56'],
        },
      ],
    });

    const vm = res.assets.find((a) => a.external_kind === 'vm');
    expect(vm).toBeTruthy();
    expect((vm as any).normalized).toMatchObject({
      network: { ip_addresses: ['192.0.2.11'], mac_addresses: ['00:15:5d:12:34:56'] },
    });
  });

  it('standalone without vms still marks inventory_complete=true (host-only inventory)', () => {
    const res = buildStandaloneInventory({ host: { hostname: 'NODE1', host_uuid: 'h-1' }, vms: [] });
    expect(res.exitCode).toBe(0);
    expect(res.errors).toEqual([]);
    expect(res.stats.inventory_complete).toBe(true);
    expect(res.relations).toEqual([]);
  });

  it('cluster success produces member_of relations', () => {
    const res = buildClusterInventory({
      cluster_name: 'CL1',
      nodes: [
        {
          node: 'NODE1',
          host: { hostname: 'NODE1', host_uuid: 'h-1' },
          vms: [{ vm_id: 'vm-1', name: 'VM1', state: 'Running' }],
        },
        { node: 'NODE2', host: { hostname: 'NODE2', host_uuid: 'h-2' }, vms: [] },
      ],
      owner_rows: [{ name: 'VM1', owner_node: 'NODE1' }],
    });

    expect(res.exitCode).toBe(0);
    expect(res.stats.inventory_complete).toBe(true);
    expect(res.relations.some((r) => r.type === 'member_of')).toBe(true);
  });
});
