import { describe, expect, it } from 'vitest';

import { validateCanonicalV1, validateNormalizedV1 } from '@/lib/schema/validate';

describe('schema validation', () => {
  it('accepts a minimal normalized-v1 vm payload', () => {
    const input = {
      version: 'normalized-v1',
      kind: 'vm',
      identity: { hostname: 'vm-1', machine_uuid: 'uuid-1' },
      network: { mac_addresses: ['aa:bb:cc:dd:ee:ff'] },
    };

    expect(validateNormalizedV1(input)).toEqual({ ok: true });
  });

  it('rejects normalized-v1 payload without required fields', () => {
    const input = { kind: 'vm' };

    const result = validateNormalizedV1(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.length).toBeGreaterThan(0);
  });

  it('accepts a minimal canonical-v1 payload', () => {
    const input = {
      version: 'canonical-v1',
      asset_uuid: 'a_1',
      asset_type: 'vm',
      status: 'in_service',
      display_name: 'vm-1',
      fields: {},
      relations: { outgoing: [] },
    };

    expect(validateCanonicalV1(input)).toEqual({ ok: true });
  });

  it('rejects canonical-v1 payload with invalid date-time formats', () => {
    const input = {
      version: 'canonical-v1',
      asset_uuid: 'a_1',
      asset_type: 'vm',
      status: 'in_service',
      display_name: 'vm-1',
      last_seen_at: 'not-a-date',
      fields: {},
      relations: {
        outgoing: [
          {
            type: 'runs_on',
            to: { asset_uuid: 'h_1', display_name: 'host-1' },
            last_seen_at: 'still-not-a-date',
          },
        ],
      },
    };

    expect(validateCanonicalV1(input).ok).toBe(false);
  });

  it('accepts normalized-v1 host payload with storage.datastores', () => {
    const input = {
      version: 'normalized-v1',
      kind: 'host',
      identity: { hostname: 'esxi-01' },
      storage: {
        datastores: [
          { name: 'datastore1', capacity_bytes: 1024 },
          { name: 'datastore2', capacity_bytes: 2048 },
        ],
      },
    };

    expect(validateNormalizedV1(input)).toEqual({ ok: true });
  });
});
