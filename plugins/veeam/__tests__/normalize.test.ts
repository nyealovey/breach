import { describe, expect, it } from 'vitest';

import { validateNormalizedV1 } from '@/lib/schema/validate';
import { normalizeBackupSignals } from '../normalize';

describe('veeam normalizeBackupSignals', () => {
  it('emits valid normalized-v1 payloads with backup attributes and last7 history', () => {
    const assets = normalizeBackupSignals({
      sessions: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          name: 'Job A',
          jobId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          sessionType: 'BackupJob',
          creationTime: '2026-02-07T00:00:00.000Z',
          endTime: '2026-02-07T00:10:00.000Z',
        },
      ],
      taskSessionsBySessionId: new Map([
        [
          '11111111-1111-1111-1111-111111111111',
          [
            {
              id: '22222222-2222-2222-2222-222222222222',
              type: 'Backup',
              sessionId: '11111111-1111-1111-1111-111111111111',
              sessionType: 'BackupJob',
              creationTime: '2026-02-07T00:00:10.000Z',
              endTime: '2026-02-07T00:09:59.000Z',
              name: 'vm-01.example.com',
              state: 'Stopped',
              result: { result: 'Success', message: 'OK' },
              progress: { processedSize: 123, readSize: 456, transferredSize: 789, duration: '00:09:49' },
              repositoryId: '33333333-3333-3333-3333-333333333333',
            },
          ],
        ],
      ]),
    });

    expect(assets).toHaveLength(1);

    const only = assets[0]!;
    expect(only.external_kind).toBe('vm');
    expect(only.external_id).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa|vm-01.example.com');

    const normalized = only.normalized;
    const validated = validateNormalizedV1(normalized);
    expect(validated.ok).toBe(true);

    expect(normalized.kind).toBe('vm');
    expect(normalized.identity?.caption).toBe('vm-01.example.com');
    expect(normalized.attributes?.backup_covered).toBe(true);
    expect(normalized.attributes?.backup_state).toBe('success');
    expect(normalized.attributes?.backup_last_result).toBe('Success');
    expect(normalized.attributes?.backup_last_success_at).toBe('2026-02-07T00:09:59.000Z');

    const raw = only.raw_payload as any;
    expect(raw?.history_last7?.length).toBe(1);
    expect(raw?.history_last7?.[0]?.result).toBe('Success');
  });

  it('limits history_last7 to 7 items sorted by end_time desc', () => {
    const sessionId = '11111111-1111-1111-1111-111111111111';
    const jobId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const tasks = Array.from({ length: 10 }, (_, i) => ({
      id: `22222222-2222-2222-2222-${String(i).padStart(12, '0')}`,
      type: 'Backup',
      sessionId,
      sessionType: 'BackupJob',
      creationTime: `2026-02-07T00:00:${String(i).padStart(2, '0')}.000Z`,
      endTime: `2026-02-07T00:00:${String(i).padStart(2, '0')}.000Z`,
      name: 'vm-01.example.com',
      state: 'Stopped',
      result: { result: i % 2 === 0 ? 'Success' : 'Warning', message: 'x' },
    }));

    const assets = normalizeBackupSignals({
      sessions: [
        {
          id: sessionId,
          name: 'Job A',
          jobId,
          sessionType: 'BackupJob',
          creationTime: '2026-02-07T00:00:00.000Z',
          endTime: '2026-02-07T00:10:00.000Z',
        },
      ],
      taskSessionsBySessionId: new Map([[sessionId, tasks]]),
    });

    expect(assets).toHaveLength(1);
    const raw = assets[0]!.raw_payload as any;
    expect(raw.history_last7).toHaveLength(7);
    expect(raw.history_last7[0].end_time).toBe('2026-02-07T00:00:09.000Z');
    expect(raw.history_last7[6].end_time).toBe('2026-02-07T00:00:03.000Z');
  });
});
