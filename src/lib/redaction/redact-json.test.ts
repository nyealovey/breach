import { describe, expect, it } from 'vitest';

import { redactJsonSecrets } from '@/lib/redaction/redact-json';

describe('redactJsonSecrets', () => {
  it('redacts known secret keys recursively', () => {
    const input = {
      password: 'p',
      nested: { token: 't', safe: 'ok' },
      list: [{ accessKey: 'x' }, { access_key: 'y' }, { ak: 'a', sk: 's' }],
    };

    expect(redactJsonSecrets(input)).toEqual({
      password: '***',
      nested: { token: '***', safe: 'ok' },
      list: [{ accessKey: '***' }, { access_key: '***' }, { ak: '***', sk: '***' }],
    });
  });

  it('leaves primitives unchanged', () => {
    expect(redactJsonSecrets('x')).toBe('x');
    expect(redactJsonSecrets(1)).toBe(1);
    expect(redactJsonSecrets(null)).toBe(null);
  });
});
