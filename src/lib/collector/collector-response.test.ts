import { describe, expect, it } from 'vitest';

import { ErrorCode } from '@/lib/errors/error-codes';
import { parseCollectorResponse, validateCollectorResponse } from '@/lib/collector/collector-response';

describe('collector response validation', () => {
  it('parses strict collector json output', () => {
    const stdout = JSON.stringify({
      schema_version: 'collector-response-v1',
      assets: [],
      relations: [],
      stats: { assets: 0, relations: 0, inventory_complete: true, warnings: [] },
      errors: [],
    });

    const result = parseCollectorResponse(stdout);
    expect(result.ok).toBe(true);
  });

  it('recovers collector json when stdout contains extra non-json logs', () => {
    const stdout = [
      '[debug] plugin start',
      JSON.stringify({
        schema_version: 'collector-response-v1',
        assets: [],
        relations: [],
        stats: { assets: 0, relations: 0, inventory_complete: true, warnings: [] },
        errors: [],
      }),
      '[debug] plugin end',
    ].join('\n');

    const result = parseCollectorResponse(stdout);
    expect(result.ok).toBe(true);
  });

  it('returns PLUGIN_OUTPUT_INVALID_JSON when stdout cannot be recovered to json', () => {
    const stdout = '[debug] plugin crashed before writing output';
    const result = parseCollectorResponse(stdout);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.PLUGIN_OUTPUT_INVALID_JSON);
      expect(result.error.redacted_context).toMatchObject({
        parse_attempt: 'strict_then_recovery',
        stdout_length: stdout.length,
      });
    }
  });

  it('rejects unsupported collector-response schema_version', () => {
    const result = parseCollectorResponse(JSON.stringify({ schema_version: 'collector-response-v0' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ErrorCode.PLUGIN_SCHEMA_VERSION_UNSUPPORTED);
  });

  it('rejects unsupported schema_version even after recovery parse', () => {
    const stdout = `extra log\n${JSON.stringify({ schema_version: 'collector-response-v0' })}\ntrailing log`;
    const result = parseCollectorResponse(stdout);

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

  it('accepts directory payload when domains/users are arrays', () => {
    const response = {
      schema_version: 'collector-response-v1',
      assets: [],
      relations: [],
      directory: { domains: [], users: [] },
      stats: { assets: 0, relations: 0, inventory_complete: true, warnings: [] },
      errors: [],
    };

    const result = validateCollectorResponse(response);
    expect(result.ok).toBe(true);
  });

  it('rejects invalid directory payload shape', () => {
    const response = {
      schema_version: 'collector-response-v1',
      assets: [],
      relations: [],
      directory: { domains: {} },
      stats: { assets: 0, relations: 0, inventory_complete: true, warnings: [] },
      errors: [],
    };

    const result = validateCollectorResponse(response);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ErrorCode.SCHEMA_VALIDATION_FAILED);
  });
});
