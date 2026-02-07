import { describe, expect, it } from 'vitest';

import { retryDelaysMsForErrorCode, toAliyunError } from '../errors';

describe('aliyun error mapping', () => {
  it('classifies rate limit errors as retryable', () => {
    const err = { code: 'Throttling', statusCode: 429, message: 'Throttling' };
    expect(toAliyunError(err, 'collect')).toMatchObject({
      code: 'ALIYUN_RATE_LIMIT',
      category: 'rate_limit',
      retryable: true,
    });
    expect(retryDelaysMsForErrorCode('ALIYUN_RATE_LIMIT')).toEqual([1000, 2000, 4000, 8000, 16000]);
  });

  it('classifies permission errors as non-retryable', () => {
    const err = { code: 'Forbidden.RAM', statusCode: 403, message: 'forbidden' };
    expect(toAliyunError(err, 'collect')).toMatchObject({
      code: 'ALIYUN_PERMISSION_DENIED',
      category: 'permission',
      retryable: false,
    });
  });

  it('classifies auth errors as non-retryable', () => {
    const err = { code: 'SignatureDoesNotMatch', statusCode: 400, message: 'signature mismatch' };
    expect(toAliyunError(err, 'healthcheck')).toMatchObject({
      code: 'ALIYUN_AUTH_FAILED',
      category: 'auth',
      retryable: false,
    });
  });

  it('classifies network errors as retryable', () => {
    const err = Object.assign(new Error('connect ETIMEDOUT 203.0.113.10:443'), { code: 'ETIMEDOUT' });
    expect(toAliyunError(err, 'collect')).toMatchObject({
      code: 'ALIYUN_NETWORK_ERROR',
      category: 'network',
      retryable: true,
    });
    expect(retryDelaysMsForErrorCode('ALIYUN_NETWORK_ERROR')).toEqual([1000, 2000, 4000]);
  });
});
