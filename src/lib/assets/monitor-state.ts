export type MonitorState = 'up' | 'warning' | 'down' | 'unmanaged' | 'unknown' | 'not_covered';

export type MonitorBadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

function cleanState(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const v = input.trim().toLowerCase();
  return v.length > 0 ? v : null;
}

export function normalizeMonitorState(input: unknown): MonitorState | null {
  const v = cleanState(input);
  if (!v) return null;
  if (v === 'up' || v === 'warning' || v === 'down' || v === 'unmanaged' || v === 'unknown' || v === 'not_covered')
    return v;
  return 'unknown';
}

export function monitorStateToBadgeVariant(state: MonitorState): MonitorBadgeVariant {
  if (state === 'down') return 'destructive';
  if (state === 'warning') return 'secondary';
  if (state === 'up') return 'default';
  return 'outline';
}

export function monitorStateLabelZh(state: MonitorState): string {
  if (state === 'up') return '正常';
  if (state === 'warning') return '告警';
  if (state === 'down') return '宕机';
  if (state === 'unmanaged') return '未托管';
  if (state === 'not_covered') return '未覆盖';
  return '未知';
}

export function monitorStateDisplay(args: {
  monitorCovered: boolean | null | undefined;
  monitorState: string | null | undefined;
}): { state: MonitorState; labelZh: string; variant: MonitorBadgeVariant } | null {
  const covered = args.monitorCovered ?? null;
  const normalized = normalizeMonitorState(args.monitorState);

  if (covered === null && normalized === null) return null;

  const state: MonitorState = covered === false ? 'not_covered' : (normalized ?? 'unknown');
  return {
    state,
    labelZh: monitorStateLabelZh(state),
    variant: monitorStateToBadgeVariant(state),
  };
}
