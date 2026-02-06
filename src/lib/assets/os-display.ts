export function formatOsForDisplay(input: {
  assetType: string;
  name: unknown;
  version: unknown;
  fingerprint: unknown;
}): string | null {
  const nameStr = typeof input.name === 'string' ? input.name.trim() : '';
  const versionStr = typeof input.version === 'string' ? input.version.trim() : '';
  const fingerprintStr = typeof input.fingerprint === 'string' ? input.fingerprint.trim() : '';

  // Host: only display name+version (do NOT fall back to fingerprint/build).
  if (input.assetType === 'host') {
    if (nameStr && versionStr) return `${nameStr} ${versionStr}`;
    return null;
  }

  if (nameStr && versionStr) return `${nameStr} ${versionStr}`;
  if (nameStr) return nameStr;
  if (versionStr) return versionStr;
  if (fingerprintStr) return fingerprintStr;
  return null;
}
