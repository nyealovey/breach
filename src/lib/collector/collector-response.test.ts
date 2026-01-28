import { describe, expect, it } from 'vitest';

import { ErrorCode } from '@/lib/errors/error-codes';
import { parseCollectorResponse, validateCollectorResponse } from '@/lib/collector/collector-response';

describe('collector response validation', () => {
  it('rejects unsupported collector-response schema_version', () => {
    const result = parseCollectorResponse(JSON.stringify({ schema_version: 'collector-response-v0' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ErrorCode.PLUGIN_SCHEMA_VERSION_UNSUPPORTED);
  });

  it('rejects response when any asset.normalized fails normalized-v1 schema', () => {
    const response = {
      schema_version: 'collector-response-v1',
      assets: [
        {
          external_kind: 'vm',
          external_id: 'vm-1',
          normalized: { kind: 'vm' }, // missing version
          raw_payload: {},
        },
      ],
      relations: [],
      stats: { assets: 1, relations: 0, inventory_complete: true, warnings: [] },
      errors: [],
    };

    const result = validateCollectorResponse(response);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ErrorCode.SCHEMA_VALIDATION_FAILED);
  });
});
