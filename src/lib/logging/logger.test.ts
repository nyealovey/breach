import { describe, expect, it, vi } from 'vitest';

import { logEvent } from '@/lib/logging/logger';

describe('logEvent', () => {
  it('emits a single JSON line and truncates *_excerpt fields', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logEvent({
      level: 'info',
      service: 'web',
      event_type: 'http.request',
      request_id: 'req_1',
      stderr_excerpt: 'x'.repeat(3000),
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0]?.[0];
    expect(typeof line).toBe('string');

    const obj = JSON.parse(line as string) as any;
    expect(obj.event_type).toBe('http.request');
    expect(obj.request_id).toBe('req_1');
    expect(typeof obj.ts).toBe('string');
    expect(obj.stderr_excerpt.length).toBe(2000);

    spy.mockRestore();
  });
});
