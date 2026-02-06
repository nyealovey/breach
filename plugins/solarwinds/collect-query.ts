export function buildServerOnlyWhereClause(input: { includeUnmanaged: boolean }): string {
  const unmanagedFilter = input.includeUnmanaged ? '' : ' AND UnManaged = false';
  return `IsServer = true${unmanagedFilter}`;
}

export function buildDetectNodesCountSwql(input: { includeUnmanaged: boolean }): string {
  return `SELECT COUNT(*) AS total FROM Orion.Nodes WHERE ${buildServerOnlyWhereClause({
    includeUnmanaged: input.includeUnmanaged,
  })}`;
}

export function buildCollectNodesSwql(input: { pageSize: number; includeUnmanaged: boolean }): string {
  const unmanagedFilter = input.includeUnmanaged ? '' : '\n        AND UnManaged = false';

  return `SELECT TOP ${input.pageSize}
        NodeID,
        Caption,
        SysName,
        DNS,
        IPAddress,
        Status,
        StatusDescription,
        UnManaged,
        IsServer,
        LastSync
      FROM Orion.Nodes
      WHERE NodeID > @lastId
        AND IsServer = true${unmanagedFilter}
      ORDER BY NodeID`;
}
