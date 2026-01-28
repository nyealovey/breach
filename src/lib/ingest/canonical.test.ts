import { describe, expect, it } from 'vitest';

import { buildCanonicalV1 } from '@/lib/ingest/canonical';
import { validateCanonicalV1 } from '@/lib/schema/validate';

describe('canonical builder', () => {
  it('buildCanonicalV1 returns schema-valid canonical-v1 with field provenance', () => {
    const canonical = buildCanonicalV1({
      assetUuid: 'a_1',
      assetType: 'vm',
      sourceId: 'src_1',
      runId: 'run_1',
      collectedAt: '2026-01-28T00:00:00Z',
      normalized: {
        version: 'normalized-v1',
        kind: 'vm',
        identity: { hostname: 'vm-1', machine_uuid: 'uuid-1' },
        network: { mac_addresses: ['aa:bb:cc:dd:ee:ff'] },
      },
      outgoingRelations: [],
    });

    expect(validateCanonicalV1(canonical)).toEqual({ ok: true });
    expect(canonical.version).toBe('canonical-v1');
    expect(canonical.asset_uuid).toBe('a_1');
    expect(canonical.asset_type).toBe('vm');
    expect(canonical.display_name).toBe('vm-1');
    expect((canonical.fields as any).identity.hostname).toMatchObject({
      value: 'vm-1',
      sources: [{ source_id: 'src_1', run_id: 'run_1' }],
    });
  });
});
