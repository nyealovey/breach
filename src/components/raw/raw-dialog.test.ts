import { describe, expect, it } from 'vitest';

import { getRawLoadErrorMessage } from './raw-dialog';

describe('getRawLoadErrorMessage', () => {
  it('maps 401 to a login hint', () => {
    expect(getRawLoadErrorMessage(401)).toContain('登录');
  });

  it('maps 403 to a permission hint', () => {
    expect(getRawLoadErrorMessage(403)).toContain('无权限');
  });

  it('includes status for unknown errors', () => {
    expect(getRawLoadErrorMessage(500)).toContain('500');
  });
});
