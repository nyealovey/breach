import { describe, expect, it } from 'vitest';

import { buildInventoryFromAgentPayload } from './agent-payload';

describe('hyperv agent payload', () => {
  it('fails with HYPERV_PARSE_ERROR when scope is missing', () => {
    const res = buildInventoryFromAgentPayload({ host: { hostname: 'NODE1' }, vms: [] });
    expect(res.exitCode).toBe(1);
    expect(res.errors[0]).toMatchObject({
      code: 'HYPERV_PARSE_ERROR',
      category: 'parse',
      message: 'invalid agent payload',
      retryable: false,
    });
  });
});
