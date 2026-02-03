export type KerberosServiceName = 'WSMAN' | 'HTTP' | 'HOST';

function uniq<T>(values: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const v of values) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export function normalizeKerberosServiceName(input: string | undefined): KerberosServiceName {
  const normalized = typeof input === 'string' ? input.trim().toUpperCase() : '';
  if (normalized === 'WSMAN') return 'WSMAN';
  if (normalized === 'HTTP') return 'HTTP';
  if (normalized === 'HOST') return 'HOST';
  return 'WSMAN';
}

export type BuildKerberosSpnStrategyInput = {
  host: string;
  preferredServiceName: string | undefined;
  enableFallback: boolean;
  hostnameOverride: string | undefined;
};

export function buildKerberosSpnStrategy(input: BuildKerberosSpnStrategyInput): {
  serviceCandidates: KerberosServiceName[];
  hostnameOverrides: Array<string | null>;
} {
  const preferred = normalizeKerberosServiceName(input.preferredServiceName);

  const serviceCandidates = uniq([
    preferred,
    ...(input.enableFallback ? (['WSMAN', 'HTTP', 'HOST'] satisfies KerberosServiceName[]) : []),
  ]);

  const explicitHostnameOverride =
    typeof input.hostnameOverride === 'string' && input.hostnameOverride.trim().length > 0
      ? input.hostnameOverride.trim()
      : null;

  // For strict mode, keep it to a single try:
  // - hostnameOverride set: use it
  // - otherwise: let GSS resolve from URL host (override=null)
  if (!input.enableFallback) {
    return {
      serviceCandidates,
      hostnameOverrides: [explicitHostnameOverride],
    };
  }

  // Fallback mode: only guess short hostname when caller didn't specify an override.
  const hostnameOverrides: Array<string | null> = [explicitHostnameOverride];
  if (!explicitHostnameOverride) {
    const host = input.host.trim();
    if (host.includes('.')) {
      const short = host.split('.', 1)[0]?.trim() ?? '';
      if (short) hostnameOverrides.push(short);
    }
  }

  return { serviceCandidates, hostnameOverrides: uniq(hostnameOverrides) };
}
