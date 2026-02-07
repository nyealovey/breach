export type BackupState = 'success' | 'warning' | 'failed' | 'unknown' | 'not_covered';

type BackupBadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

function cleanState(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const v = input.trim().toLowerCase();
  return v.length > 0 ? v : null;
}

export function normalizeBackupState(input: unknown): BackupState | null {
  const v = cleanState(input);
  if (!v) return null;
  if (v === 'success' || v === 'warning' || v === 'failed' || v === 'unknown' || v === 'not_covered') return v;
  return 'unknown';
}

export function backupStateToBadgeVariant(state: BackupState): BackupBadgeVariant {
  if (state === 'failed') return 'destructive';
  if (state === 'warning') return 'secondary';
  if (state === 'success') return 'default';
  return 'outline';
}

export function backupStateLabelZh(state: BackupState): string {
  if (state === 'success') return '成功';
  if (state === 'warning') return '告警';
  if (state === 'failed') return '失败';
  if (state === 'not_covered') return '未覆盖';
  return '未知';
}

export function backupStateDisplay(args: {
  backupCovered: boolean | null | undefined;
  backupState: string | null | undefined;
}): { state: BackupState; labelZh: string; variant: BackupBadgeVariant } | null {
  const covered = args.backupCovered ?? null;
  const normalized = normalizeBackupState(args.backupState);

  if (covered === null && normalized === null) return null;

  const state: BackupState = covered === false ? 'not_covered' : (normalized ?? 'unknown');
  return {
    state,
    labelZh: backupStateLabelZh(state),
    variant: backupStateToBadgeVariant(state),
  };
}
