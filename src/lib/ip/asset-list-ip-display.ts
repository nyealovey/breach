export function parsePrivateIpPrefixes(raw?: string): string[] {
  if (!raw) return [];

  const parts = raw
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }

  return out;
}

export function formatAssetListIpText(ipValue: unknown, privatePrefixes: string[]): string | null {
  if (!Array.isArray(ipValue)) return null;

  const cleaned = ipValue
    .filter((ip): ip is string => typeof ip === 'string')
    .map((ip) => ip.trim())
    .filter((ip) => ip.length > 0);

  if (cleaned.length === 0) return null;

  // Preserve insertion order while de-duping.
  const uniqueIps = Array.from(new Set(cleaned));
  if (privatePrefixes.length === 0) return uniqueIps.join(', ');

  const privateIps: string[] = [];
  const publicIps: string[] = [];

  for (const ip of uniqueIps) {
    const isPrivate = privatePrefixes.some((prefix) => ip.startsWith(prefix));
    if (isPrivate) privateIps.push(ip);
    else publicIps.push(ip);
  }

  const display = publicIps.length > 0 ? publicIps : privateIps;
  return display.length > 0 ? display.join(', ') : null;
}
