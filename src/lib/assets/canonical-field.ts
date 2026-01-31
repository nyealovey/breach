export type FlattenedCanonicalField = {
  path: string;
  value: unknown;
  sourcesCount: number;
  conflict: boolean;
};

function isFieldValue(node: unknown): node is { value: unknown; sources: unknown[]; conflict?: boolean } {
  if (!node || typeof node !== 'object') return false;
  if (!('value' in node) || !('sources' in node)) return false;
  return Array.isArray((node as { sources: unknown[] }).sources);
}

function flattenNode(node: unknown, prefix: string[]): FlattenedCanonicalField[] {
  if (isFieldValue(node)) {
    return [
      {
        path: prefix.join('.'),
        value: node.value,
        sourcesCount: node.sources.length,
        conflict: node.conflict === true,
      },
    ];
  }

  if (node && typeof node === 'object' && !Array.isArray(node)) {
    const out: FlattenedCanonicalField[] = [];
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      out.push(...flattenNode(value, [...prefix, key]));
    }
    return out;
  }

  // Unexpected scalar, keep it visible for debugging.
  return [{ path: prefix.join('.'), value: node, sourcesCount: 0, conflict: false }];
}

export function flattenCanonicalFields(fields: unknown): FlattenedCanonicalField[] {
  return flattenNode(fields, []);
}
