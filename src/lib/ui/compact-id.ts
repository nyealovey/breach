type CompactIdOptions = {
  head?: number;
  tail?: number;
  separator?: string;
};

const DEFAULT_SEPARATOR = '\u2026';

export function compactId(id: string, options: CompactIdOptions = {}): string {
  const head = Math.max(0, options.head ?? 8);
  const tail = Math.max(0, options.tail ?? 7);
  const separator = options.separator ?? DEFAULT_SEPARATOR;

  if (id.length <= head + tail + separator.length) return id;
  if (tail === 0) return `${id.slice(0, head)}${separator}`;
  if (head === 0) return `${separator}${id.slice(-tail)}`;

  return `${id.slice(0, head)}${separator}${id.slice(-tail)}`;
}
