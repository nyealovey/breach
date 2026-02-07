import { describe, expect, it } from 'vitest';

import { getOpenApiSpec } from '@/lib/openapi/spec';

describe('getOpenApiSpec', () => {
  it('returns an OpenAPI document with basic info and paths', () => {
    const spec = getOpenApiSpec();
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info?.title).toBeTruthy();
    expect(spec.paths).toBeTruthy();
  });

  it('includes auth, users, and directory endpoints for AD workflows', () => {
    const spec = getOpenApiSpec();
    const paths = spec.paths ?? {};

    expect(paths['/api/v1/auth/login']).toBeTruthy();
    expect(paths['/api/v1/auth/me']).toBeTruthy();
    expect(paths['/api/v1/auth/password']).toBeTruthy();
    expect(paths['/api/v1/users']).toBeTruthy();
    expect(paths['/api/v1/users/{id}']).toBeTruthy();
    expect(paths['/api/v1/users/{id}/role']).toBeTruthy();
    expect(paths['/api/v1/users/{id}/enabled']).toBeTruthy();
    expect(paths['/api/v1/directory/domains']).toBeTruthy();
    expect(paths['/api/v1/directory/users']).toBeTruthy();
  });
});
