export type LatestBackupSummary = {
  latestBackupAt: string | null;
  latestBackupProcessedSize: number | null;
};

function pickBackupTime(input: Record<string, unknown>): string | null {
  const endTime = typeof input.end_time === 'string' && input.end_time.trim().length > 0 ? input.end_time : null;
  if (endTime) return endTime;

  const startTime =
    typeof input.start_time === 'string' && input.start_time.trim().length > 0 ? input.start_time : null;
  return startTime;
}

function pickProcessedSize(input: Record<string, unknown>): number | null {
  const size = input.processed_size;
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return null;
  return size;
}

export function pickLatestBackupSummary(raw: unknown): LatestBackupSummary {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { latestBackupAt: null, latestBackupProcessedSize: null };
  }

  const history = (raw as Record<string, unknown>).history_last7;
  if (!Array.isArray(history)) {
    return { latestBackupAt: null, latestBackupProcessedSize: null };
  }

  const latest = history.find((item) => item && typeof item === 'object' && !Array.isArray(item));
  if (!latest || typeof latest !== 'object' || Array.isArray(latest)) {
    return { latestBackupAt: null, latestBackupProcessedSize: null };
  }

  const latestRecord = latest as Record<string, unknown>;
  return {
    latestBackupAt: pickBackupTime(latestRecord),
    latestBackupProcessedSize: pickProcessedSize(latestRecord),
  };
}
