import { describe, expect, it } from 'vitest';

import { buildRelations, normalizeCluster, normalizeHost, normalizeVM } from '../normalize';

describe('vcenter normalize', () => {
  it('normalizeVM maps machine_uuid/hostname/mac_addresses/cpu/memory with IPv4 only', () => {
    const raw = {
      vm: 'vm-1',
      identity: { instance_uuid: 'uuid-1' },
      name: 'vm1-display-name', // This is VM display name, not hostname
      cpu: { count: 4 },
      memory: { size_MiB: 8192 },
      power_state: 'POWERED_ON' as const,
      guest_OS: 'RHEL_8_64',
      nics: { '4000': { mac_address: 'aa:bb:cc:dd:ee:ff' }, '4001': { mac_address: 'aa:bb:cc:dd:ee:00' } },
      disks: { '2000': { capacity: 107374182400, label: 'Hard disk 1' } },
      host: 'host-1',
      guest_networking: [
        {
          ip: {
            ip_addresses: [
              { ip_address: '192.168.1.100' }, // IPv4 - should be included
              { ip_address: 'fe80::1' }, // IPv6 - should be filtered out
              { ip_address: '10.0.0.5' }, // IPv4 - should be included
            ],
          },
        },
      ],
      guest_networking_info: {
        dns_values: {
          host_name: 'vm1-guest-hostname', // This is the actual machine name
        },
      },
    };

    const asset = normalizeVM(raw);

    expect(asset.external_kind).toBe('vm');
    expect(asset.external_id).toBe('vm-1');
    expect(asset.normalized).toMatchObject({
      version: 'normalized-v1',
      kind: 'vm',
      identity: {
        machine_uuid: 'uuid-1',
        hostname: 'vm1-guest-hostname', // Should be guest hostname, not VM name
      },
      network: {
        mac_addresses: ['aa:bb:cc:dd:ee:ff', 'aa:bb:cc:dd:ee:00'],
        ip_addresses: ['192.168.1.100', '10.0.0.5'], // Only IPv4
      },
      hardware: {
        cpu_count: 4,
        memory_bytes: 8192 * 1024 * 1024,
        disks: [{ name: 'Hard disk 1', size_bytes: 107374182400 }],
      },
      os: { fingerprint: 'RHEL_8_64' },
      runtime: { power_state: 'poweredOn' },
    });
  });

  it('normalizeVM tolerates vCenter detail shapes (identity.instance_uuid + nics object)', () => {
    const raw = {
      vm: 'vm-26',
      identity: { instance_uuid: 'uuid-26', name: 'vm-26-name' },
      nics: { '4000': { mac_address: '00:50:56:96:aa:8c' } },
    };

    const asset = normalizeVM(raw as any);

    expect(asset.normalized).toMatchObject({
      version: 'normalized-v1',
      kind: 'vm',
      identity: { machine_uuid: 'uuid-26' }, // hostname is undefined without guest_networking_info
      network: { mac_addresses: ['00:50:56:96:aa:8c'] },
    });
    // hostname should be undefined when guest_networking_info is not available
    expect(asset.normalized.identity?.hostname).toBeUndefined();
  });

  it('buildRelations creates vm -> host, host -> vm, and host -> cluster edges', () => {
    const vmRaw = { vm: 'vm-1', host: 'host-1' };
    const hostRaw = {
      host: 'host-1',
      cluster: 'domain-c7',
      hardware: { system_info: { serial_number: 'SN123' } },
      vnics: [{ ip: { ip_address: '192.168.1.10' } }],
    };
    const clusterRaw = { cluster: 'domain-c7', name: 'Cluster A' };

    const vm = normalizeVM(vmRaw);
    const host = normalizeHost(hostRaw);
    const cluster = normalizeCluster(clusterRaw);

    const relations = buildRelations([vmRaw], [hostRaw], [clusterRaw]);

    expect(relations).toEqual([
      {
        type: 'runs_on',
        from: { external_kind: 'vm', external_id: vm.external_id },
        to: { external_kind: 'host', external_id: host.external_id },
        raw_payload: { vm: 'vm-1', host: 'host-1' },
      },
      {
        type: 'hosts_vm',
        from: { external_kind: 'host', external_id: host.external_id },
        to: { external_kind: 'vm', external_id: vm.external_id },
        raw_payload: { host: 'host-1', vm: 'vm-1' },
      },
      {
        type: 'member_of',
        from: { external_kind: 'host', external_id: host.external_id },
        to: { external_kind: 'cluster', external_id: cluster.external_id },
        raw_payload: { host: 'host-1', cluster: 'domain-c7' },
      },
    ]);
  });
});
