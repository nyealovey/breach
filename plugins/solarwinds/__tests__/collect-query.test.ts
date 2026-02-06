import { describe, expect, it } from 'vitest';

import { buildCollectNodesSwql, buildDetectNodesCountSwql, buildServerOnlyWhereClause } from '../collect-query';

describe('solarwinds collect query', () => {
  it('always constrains collection to servers', () => {
    const swql = buildCollectNodesSwql({ pageSize: 500, includeUnmanaged: true });
    expect(swql).toContain('AND IsServer = true');
  });

  it('adds unmanaged filter when include_unmanaged=false', () => {
    const swql = buildCollectNodesSwql({ pageSize: 500, includeUnmanaged: false });
    expect(swql).toContain('AND UnManaged = false');
  });

  it('does not add unmanaged filter when include_unmanaged=true', () => {
    const swql = buildCollectNodesSwql({ pageSize: 500, includeUnmanaged: true });
    expect(swql).not.toContain('AND UnManaged = false');
  });

  it('builds server-only where clause for include_unmanaged=true', () => {
    const where = buildServerOnlyWhereClause({ includeUnmanaged: true });
    expect(where).toBe('IsServer = true');
  });

  it('builds server-only where clause for include_unmanaged=false', () => {
    const where = buildServerOnlyWhereClause({ includeUnmanaged: false });
    expect(where).toBe('IsServer = true AND UnManaged = false');
  });

  it('builds detect count query with server-only filter', () => {
    const swql = buildDetectNodesCountSwql({ includeUnmanaged: false });
    expect(swql).toContain('SELECT COUNT(*) AS total FROM Orion.Nodes');
    expect(swql).toContain('WHERE IsServer = true AND UnManaged = false');
  });
});
