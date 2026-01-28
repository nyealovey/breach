import { describe, expect, it } from 'vitest';

import { getOpenApiSpec } from '@/lib/openapi/spec';

describe('getOpenApiSpec', () => {
  it('returns an OpenAPI document with basic info and paths', () => {
    const spec = getOpenApiSpec();
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info?.title).toBeTruthy();
    expect(spec.paths).toBeTruthy();
  });
});
