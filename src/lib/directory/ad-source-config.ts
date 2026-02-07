export const AD_SOURCE_PURPOSES = ['auth_collect', 'collect_only', 'auth_only'] as const;

export type AdSourcePurpose = (typeof AD_SOURCE_PURPOSES)[number];

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeLowerString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeUpn(input: string): string {
  return input.trim().toLowerCase();
}

export function extractUpnSuffix(upn: string): string | null {
  const normalized = normalizeUpn(upn);
  const atIndex = normalized.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === normalized.length - 1) return null;
  const suffix = normalized.slice(atIndex + 1).trim();
  return suffix.length > 0 ? suffix : null;
}

export function normalizeUpnSuffixes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const unique = new Set<string>();
  for (const item of value) {
    const normalized = normalizeLowerString(item);
    if (!normalized) continue;
    const clean = normalized.startsWith('@') ? normalized.slice(1) : normalized;
    if (clean.length === 0) continue;
    unique.add(clean);
  }

  return Array.from(unique).sort((a, b) => a.localeCompare(b));
}

export function readAdPurpose(config: unknown): AdSourcePurpose | null {
  const record = asRecord(config);
  if (!record) return null;

  const raw = record.purpose;
  if (raw === 'auth_collect' || raw === 'collect_only' || raw === 'auth_only') return raw;
  return null;
}

export function readAdServerUrl(config: unknown): string | null {
  const record = asRecord(config);
  if (!record) return null;

  const fromServerUrl = typeof record.server_url === 'string' ? record.server_url.trim() : '';
  if (fromServerUrl) return fromServerUrl;

  const fromEndpoint = typeof record.endpoint === 'string' ? record.endpoint.trim() : '';
  return fromEndpoint || null;
}

export function readAdBaseDn(config: unknown): string | null {
  const record = asRecord(config);
  if (!record) return null;

  const value = typeof record.base_dn === 'string' ? record.base_dn.trim() : '';
  return value || null;
}

export function readAdUpnSuffixes(config: unknown): string[] {
  const record = asRecord(config);
  if (!record) return [];
  return normalizeUpnSuffixes(record.upn_suffixes);
}

export function isAdAuthPurpose(purpose: AdSourcePurpose): boolean {
  return purpose === 'auth_collect' || purpose === 'auth_only';
}

export function isAdCollectPurpose(purpose: AdSourcePurpose): boolean {
  return purpose === 'auth_collect' || purpose === 'collect_only';
}

export function isLikelyUpn(input: string): boolean {
  const normalized = normalizeUpn(input);
  const suffix = extractUpnSuffix(normalized);
  if (!suffix) return false;
  return !normalized.includes(' ') && suffix.includes('.');
}
