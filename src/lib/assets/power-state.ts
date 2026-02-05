export type NormalizedPowerState = 'poweredOn' | 'poweredOff' | 'suspended';

/**
 * Normalize power state values from various collectors/APIs to our canonical enum.
 *
 * Known inputs:
 * - canonical: poweredOn | poweredOff | suspended
 * - vCenter REST: POWERED_ON | POWERED_OFF | SUSPENDED (Host may return STANDBY)
 */
export function normalizePowerState(input: string): NormalizedPowerState | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (trimmed === 'poweredOn' || trimmed === 'poweredOff' || trimmed === 'suspended') return trimmed;

  const upper = trimmed.toUpperCase();
  if (upper === 'POWERED_ON') return 'poweredOn';
  if (upper === 'POWERED_OFF') return 'poweredOff';
  if (upper === 'SUSPENDED' || upper === 'STANDBY') return 'suspended';

  // Be tolerant of case/format differences.
  const lower = trimmed.toLowerCase();
  if (lower === 'poweredon') return 'poweredOn';
  if (lower === 'poweredoff') return 'poweredOff';
  if (lower === 'standby' || lower === 'stand_by') return 'suspended';

  return null;
}

export function powerStateLabelZh(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '-';

  const normalized = normalizePowerState(trimmed);
  if (normalized === 'poweredOn') return '运行';
  if (normalized === 'poweredOff') return '关机';
  if (normalized === 'suspended') return '挂起';

  return trimmed;
}
