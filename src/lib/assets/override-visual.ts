export type OverrideVisualMeta = {
  title: string;
  borderClassName: string;
};

export function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveOverrideAndCurrentValue(input: { overrideText: unknown; collectedText: unknown }): {
  overrideText: string | null;
  collectedText: string | null;
  currentText: string | null;
  mismatch: boolean;
} {
  const overrideText = normalizeOptionalText(input.overrideText);
  const collectedText = normalizeOptionalText(input.collectedText);
  const currentText = overrideText ?? collectedText;
  const mismatch = overrideText !== null && collectedText !== null && overrideText !== collectedText;
  return { overrideText, collectedText, currentText, mismatch };
}

export function getOverrideVisualMeta(input: {
  overrideText: string | null;
  collectedText: string | null;
  mismatch?: boolean;
}): OverrideVisualMeta {
  const hasOverride = Boolean(input.overrideText);
  const collectedEmpty = !input.collectedText;
  const mismatch =
    input.mismatch ?? (hasOverride && Boolean(input.collectedText) && input.overrideText !== input.collectedText);
  const collectedMatches = hasOverride && Boolean(input.collectedText) && input.overrideText === input.collectedText;

  const title = hasOverride
    ? mismatch
      ? '覆盖≠采集'
      : collectedEmpty
        ? '覆盖空值'
        : collectedMatches
          ? '覆盖=采集'
          : '覆盖'
    : '未覆盖';

  const borderClassName = hasOverride
    ? mismatch
      ? 'border-destructive'
      : 'border-blue-600 dark:border-blue-500'
    : 'border-slate-300 dark:border-slate-600';
  const finalBorderClassName =
    hasOverride && !mismatch && !collectedEmpty
      ? collectedMatches
        ? 'border-emerald-600 dark:border-emerald-500'
        : borderClassName
      : borderClassName;

  return { title, borderClassName: finalBorderClassName };
}
