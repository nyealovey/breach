export type CandidateReason = {
  code: string;
  weight: number;
  evidence?: { field?: string; a?: unknown; b?: unknown };
};

export function extractCandidateReasons(_input: unknown): CandidateReason[] {
  const list = Array.isArray(_input)
    ? _input
    : _input &&
        typeof _input === 'object' &&
        !Array.isArray(_input) &&
        'matched_rules' in (_input as Record<string, unknown>)
      ? (_input as Record<string, unknown>).matched_rules
      : null;

  if (!Array.isArray(list)) return [];
  return list.filter((item): item is CandidateReason => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const code = (item as Record<string, unknown>).code;
    const weight = (item as Record<string, unknown>).weight;
    return typeof code === 'string' && code.trim().length > 0 && typeof weight === 'number' && Number.isFinite(weight);
  });
}

export type CandidateFieldCompareStatus = 'match' | 'mismatch' | 'missing';

export function compareCandidateFieldValues(_a: unknown, _b: unknown): CandidateFieldCompareStatus {
  const aMissing = isMissingComparableValue(_a);
  const bMissing = isMissingComparableValue(_b);
  if (aMissing && bMissing) return 'missing';
  if (aMissing || bMissing) return 'mismatch';

  return isEqualish(_a, _b) ? 'match' : 'mismatch';
}

function isMissingComparableValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function normalizeComparable(value: unknown): unknown {
  if (typeof value === 'string') return value.trim();
  if (
    Array.isArray(value) &&
    value.every((v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
  ) {
    return [...value]
      .map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v))
      .sort((a, b) => String(a).localeCompare(String(b)));
  }
  return value;
}

function isEqualish(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalizeComparable(a)) === JSON.stringify(normalizeComparable(b));
}
