import { describe, expect, it } from 'vitest';

import { getPrimaryRunIssue, parseRunIssues, sanitizeRedactedContext } from '@/lib/runs/run-issues';

describe('parseRunIssues', () => {
  it('filters invalid items and keeps minimal fields', () => {
    expect(
      parseRunIssues([
        null,
        123,
        { code: '' },
        { code: 'VCENTER_AUTH_FAILED', message: 'x', retryable: false, category: 'auth' },
      ]),
    ).toEqual([
      { code: 'VCENTER_AUTH_FAILED', category: 'auth', message: 'x', retryable: false, redacted_context: undefined },
    ]);
  });
});

describe('getPrimaryRunIssue', () => {
  it('returns errors[0] when available', () => {
    expect(
      getPrimaryRunIssue({
        status: 'Failed',
        errors: [{ code: 'VCENTER_AUTH_FAILED', message: 'authentication failed', retryable: false }],
      }),
    ).toMatchObject({ code: 'VCENTER_AUTH_FAILED', message: 'authentication failed', retryable: false });
  });

  it('falls back to errorSummary when Failed but errors is empty', () => {
    expect(getPrimaryRunIssue({ status: 'Failed', errors: [], errorSummary: 'plugin crashed' })).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'plugin crashed',
      missingStructuredErrors: true,
    });
  });
});

describe('sanitizeRedactedContext', () => {
  it('drops sensitive keys and redacts urls/ips in values', () => {
    const out = sanitizeRedactedContext({
      stage: 'collect',
      endpoint: 'https://vcenter.example.com',
      username: 'admin',
      cause: 'request to https://vcenter.example.com failed from 10.10.10.10',
      host_id: 'host-123',
      token: 'abc',
      body_excerpt: '{"url":"https://x.y"}',
    });

    expect(out).toEqual({
      stage: 'collect',
      cause: 'request to [REDACTED_URL] failed from [REDACTED_IP]',
      host_id: 'host-123',
      body_excerpt: '{"url":"[REDACTED_URL]"}',
    });
  });
});
