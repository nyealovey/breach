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

  it('standalone without vms fails with INVENTORY_RELATIONS_EMPTY', () => {
    const res = buildStandaloneInventory({ host: { hostname: 'NODE1', host_uuid: 'h-1' }, vms: [] });
    expect(res.exitCode).toBe(1);
    expect(res.errors[0]?.code).toBe('INVENTORY_RELATIONS_EMPTY');
    expect(res.stats.inventory_complete).toBe(false);
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
