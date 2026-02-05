function isLinkLocalIpv4(ip: string): boolean {
  // 169.254.0.0/16 (RFC 3927) – typical "APIPA" addresses, not useful for inventory display.
  return ip.startsWith('169.254.');
}

function normalizeIpCandidate(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function filterIpAddressesForDisplay(input: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of input) {
    const ip = normalizeIpCandidate(raw);
    if (!ip) continue;
    if (isLinkLocalIpv4(ip)) continue;
    if (seen.has(ip)) continue;
    seen.add(ip);
    out.push(ip);
  }

  return out;
}

export function formatIpAddressesForDisplay(value: unknown): string | null {
  const raw: string[] = [];

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') raw.push(item);
    }
  } else if (typeof value === 'string') {
    raw.push(value);
  } else {
    return null;
  }

  const cleaned = filterIpAddressesForDisplay(raw);
  return cleaned.length > 0 ? cleaned.join(', ') : null;
}
