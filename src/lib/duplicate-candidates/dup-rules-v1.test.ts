import { describe, expect, it } from 'vitest';

import { calculateDupScoreV1 } from '@/lib/duplicate-candidates/dup-rules-v1';

describe('dup-rules-v1', () => {
  it('matches vm.machine_uuid_match (case/format-insensitive) and caps score at 100', () => {
    const a = {
      identity: { machine_uuid: 'A0B1C2D3-1111-2222-3333-444455556666' },
      network: { mac_addresses: ['AA:BB:CC:DD:EE:FF'] },
    };
    const b = {
      identity: { machine_uuid: 'a0b1c2d3111122223333444455556666' },
      network: { mac_addresses: ['aa-bb-cc-dd-ee-ff'] },
    };

    const res = calculateDupScoreV1(a, b, 'vm');

    expect(res.score).toBe(100);
    expect(res.reasons.map((r) => r.code).sort()).toEqual(['vm.mac_overlap', 'vm.machine_uuid_match'].sort());
  });

  it('does not treat placeholder UUID as a match', () => {
    const a = { identity: { machine_uuid: '00000000-0000-0000-0000-000000000000' } };
    const b = { identity: { machine_uuid: '00000000000000000000000000000000' } };

    const res = calculateDupScoreV1(a, b, 'vm');
    expect(res.score).toBe(0);
    expect(res.reasons).toEqual([]);
  });

  it('matches vm.mac_overlap and ignores placeholder MACs', () => {
    const ok = calculateDupScoreV1(
      { network: { mac_addresses: ['AA:BB:CC:DD:EE:FF'] } },
      { network: { mac_addresses: ['aa-bb-cc-dd-ee-ff', '11:22:33:44:55:66'] } },
      'vm',
    );
    expect(ok.score).toBe(90);
    expect(ok.reasons[0]?.code).toBe('vm.mac_overlap');
    expect(ok.reasons[0]?.evidence.field).toBe('normalized.network.mac_addresses');

    const placeholder = calculateDupScoreV1(
      { network: { mac_addresses: ['00:00:00:00:00:00'] } },
      { network: { mac_addresses: ['00-00-00-00-00-00'] } },
      'vm',
    );
    expect(placeholder.score).toBe(0);
    expect(placeholder.reasons).toEqual([]);
  });

  it('matches vm.hostname_ip_overlap (hostname + ip overlap)', () => {
    const res = calculateDupScoreV1(
      { identity: { hostname: 'HostA' }, network: { ip_addresses: ['10.0.0.1', '10.0.0.2'] } },
      { identity: { hostname: ' hosta ' }, network: { ip_addresses: ['10.0.0.2'] } },
      'vm',
    );

    expect(res.score).toBe(70);
    expect(res.reasons[0]?.code).toBe('vm.hostname_ip_overlap');
    expect(res.reasons[0]?.evidence.field).toBe('normalized.identity.hostname + normalized.network.ip_addresses');
  });

  it('matches host.serial_match (trim/upper) and ignores placeholders', () => {
    const ok = calculateDupScoreV1(
      { identity: { serial_number: '  abC123  ' } },
      { identity: { serial_number: 'ABC123' } },
      'host',
    );
    expect(ok.score).toBe(100);
    expect(ok.reasons[0]?.code).toBe('host.serial_match');

    const placeholder = calculateDupScoreV1(
      { identity: { serial_number: 'To be filled by O.E.M.' } },
      { identity: { serial_number: 'To Be Filled' } },
      'host',
    );
    expect(placeholder.score).toBe(0);
    expect(placeholder.reasons).toEqual([]);
  });

  it('matches host.bmc_ip_match and host.mgmt_ip_match', () => {
    const bmc = calculateDupScoreV1({ network: { bmc_ip: '10.10.1.1' } }, { network: { bmc_ip: '10.10.1.1' } }, 'host');
    expect(bmc.score).toBe(90);
    expect(bmc.reasons[0]?.code).toBe('host.bmc_ip_match');

    const mgmt = calculateDupScoreV1(
      { network: { management_ip: '10.10.1.1' } },
      { network: { management_ip: '10.10.1.1' } },
      'host',
    );
    expect(mgmt.score).toBe(70);
    expect(mgmt.reasons[0]?.code).toBe('host.mgmt_ip_match');
  });
});
