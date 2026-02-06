import { describe, expect, it } from 'vitest';

import { validateNormalizedV1 } from '@/lib/schema/validate';
import { normalizeNode } from '../normalize';

describe('solarwinds normalizeNode', () => {
  it('emits a valid normalized-v1 payload (with monitor attributes)', () => {
    const node = normalizeNode({
      NodeID: 123,
      SysName: 'vm-01.example.com',
      DNS: 'vm-01.example.com',
      IPAddress: '192.0.2.10',
      Status: 1,
      StatusDescription: 'Up',
      UnManaged: false,
      LastSync: '/Date(1760000000000)/',
    });

    expect(node).not.toBeNull();
    const normalized = node!.normalized;

    const result = validateNormalizedV1(normalized);
    expect(result.ok).toBe(true);

    expect(normalized.kind).toBe('host');
    expect(normalized.identity?.hostname).toBe('vm-01.example.com');
    expect(normalized.network?.ip_addresses).toEqual(['192.0.2.10']);
    expect(normalized.os?.fingerprint).toBeUndefined();
    expect(normalized.attributes?.monitor_covered).toBe(true);
    expect(normalized.attributes?.monitor_status).toBe('up');
    expect(normalized.attributes?.monitor_node_id).toBe('123');
    expect(typeof normalized.attributes?.monitor_last_seen_at).toBe('string');
  });

  it('accepts NodeID as a numeric string', () => {
    const node = normalizeNode({
      NodeID: '123',
      SysName: 'vm-01.example.com',
      IPAddress: '192.0.2.10',
      Status: 1,
      UnManaged: false,
    });

    expect(node).not.toBeNull();
    expect(node!.external_id).toBe('123');
  });

  it('marks unmanaged nodes as unmanaged status', () => {
    const node = normalizeNode({
      NodeID: 1,
      SysName: 'vm-02.example.com',
      IPAddress: '198.51.100.11',
      Status: 1,
      UnManaged: true,
    });

    expect(node).not.toBeNull();
    expect(node!.normalized.attributes?.monitor_status).toBe('unmanaged');
  });
});
