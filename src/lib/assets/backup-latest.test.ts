import { describe, expect, it } from 'vitest';

import { pickLatestBackupSummary } from '@/lib/assets/backup-latest';

describe('pickLatestBackupSummary', () => {
  it('returns latest backup time and processed size from first history item', () => {
    const summary = pickLatestBackupSummary({
      history_last7: [
        {
          end_time: '2026-02-09T01:02:03.000Z',
          start_time: '2026-02-09T00:00:00.000Z',
          processed_size: 1024,
        },
      ],
    });

    expect(summary).toEqual({
      latestBackupAt: '2026-02-09T01:02:03.000Z',
      latestBackupProcessedSize: 1024,
    });
  });

  it('falls back to start_time when end_time is missing', () => {
    const summary = pickLatestBackupSummary({
      history_last7: [
        {
          start_time: '2026-02-09T00:00:00.000Z',
          processed_size: 2048,
        },
      ],
    });

    expect(summary).toEqual({
      latestBackupAt: '2026-02-09T00:00:00.000Z',
      latestBackupProcessedSize: 2048,
    });
  });

  it('returns nulls when history is missing or invalid', () => {
    expect(pickLatestBackupSummary({ history_last7: [] })).toEqual({
      latestBackupAt: null,
      latestBackupProcessedSize: null,
    });
    expect(pickLatestBackupSummary({})).toEqual({
      latestBackupAt: null,
      latestBackupProcessedSize: null,
    });
  });
});
