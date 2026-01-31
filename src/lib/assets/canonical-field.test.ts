import { describe, expect, it } from 'vitest';

import { flattenCanonicalFields } from '@/lib/assets/canonical-field';

describe('canonical field utilities', () => {
  it('flattens canonical.fields leaf FieldValue nodes and keeps unexpected scalars visible', () => {
    const fields = {
      identity: {
        hostname: { value: 'vm-01', sources: [{ source_id: 's1' }, { source_id: 's2' }], conflict: true },
      },
      hardware: {
        memory_bytes: { value: 1024, sources: [] },
      },
      attributes: {
        custom_key: { value: 'custom_value', sources: [{ source_id: 's1' }] },
      },
      weirdScalar: 123,
    };

    const flattened = flattenCanonicalFields(fields);

    expect(flattened).toEqual(
      expect.arrayContaining([
        { path: 'identity.hostname', value: 'vm-01', sourcesCount: 2, conflict: true },
        { path: 'hardware.memory_bytes', value: 1024, sourcesCount: 0, conflict: false },
        { path: 'attributes.custom_key', value: 'custom_value', sourcesCount: 1, conflict: false },
        { path: 'weirdScalar', value: 123, sourcesCount: 0, conflict: false },
      ]),
    );
  });
});
