type NormalizedV1 = {
  version: 'normalized-v1';
  kind: 'vm' | 'host' | 'cluster';
  identity?: {
    hostname?: string;
    caption?: string;
  };
  network?: {
    ip_addresses?: string[];
  };
  os?: {
    name?: string;
    version?: string;
    fingerprint?: string;
  };
  attributes?: Record<string, string | number | boolean | null>;
};

export type NormalizedAsset = {
  external_kind: 'vm' | 'host' | 'cluster';
  external_id: string;
  normalized: NormalizedV1;
  raw_payload: unknown;
};

export type SessionModel = {
  id?: unknown;
  name?: unknown;
  jobId?: unknown;
  sessionType?: unknown;
  creationTime?: unknown;
  endTime?: unknown;
  state?: unknown;
  result?: unknown;
};

export type TaskSessionModel = {
  id?: unknown;
  type?: unknown;
  sessionId?: unknown;
  sessionType?: unknown;
  creationTime?: unknown;
  endTime?: unknown;
  name?: unknown;
  state?: unknown;
  result?: unknown;
  progress?: unknown;
  repositoryId?: unknown;
  algorithm?: unknown;
  restorePointId?: unknown;
};

type BackupHistoryItemV1 = {
  end_time: string | null;
  start_time: string | null;
  result: string | null;
  message: string | null;
  state: string | null;
  job_id: string | null;
  job_name: string | null;
  session_id: string | null;
  session_name: string | null;
  task_session_id: string | null;
  repository_id: string | null;
  processed_size: number | null;
  read_size: number | null;
  transferred_size: number | null;
  duration: string | null;
};

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function cleanIsoDateTime(value: unknown): string | null {
  const s = cleanString(value);
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function coerceOptionalInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  return null;
}

function extractSessionResult(input: unknown): {
  result: string | null;
  message: string | null;
  isCanceled: boolean | null;
} {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { result: null, message: null, isCanceled: null };
  }

  const obj = input as Record<string, unknown>;
  return {
    result: cleanString(obj.result),
    message: cleanString(obj.message),
    isCanceled: typeof obj.isCanceled === 'boolean' ? obj.isCanceled : null,
  };
}

function extractProgress(input: unknown): {
  duration: string | null;
  processedSize: number | null;
  readSize: number | null;
  transferredSize: number | null;
} {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { duration: null, processedSize: null, readSize: null, transferredSize: null };
  }

  const obj = input as Record<string, unknown>;
  return {
    duration: cleanString(obj.duration),
    processedSize: coerceOptionalInt(obj.processedSize),
    readSize: coerceOptionalInt(obj.readSize),
    transferredSize: coerceOptionalInt(obj.transferredSize),
  };
}

function compareIsoDesc(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b.localeCompare(a);
}

function mapBackupState(result: string | null): 'success' | 'warning' | 'failed' | 'unknown' {
  const r = result?.trim().toLowerCase() ?? null;
  if (r === 'success') return 'success';
  if (r === 'warning') return 'warning';
  if (r === 'failed') return 'failed';
  return 'unknown';
}

function pickLatestSuccessAt(history: BackupHistoryItemV1[]): string | null {
  for (const item of history) {
    if (item.result !== 'Success') continue;
    if (item.end_time) return item.end_time;
  }
  return null;
}

function toHistoryItem(input: { session: SessionModel; task: TaskSessionModel }): BackupHistoryItemV1 | null {
  const taskName = cleanString(input.task.name);
  if (!taskName) return null;

  const sessionId = cleanString(input.session.id) ?? cleanString(input.task.sessionId);
  const sessionName = cleanString(input.session.name);
  const jobId = cleanString(input.session.jobId);
  const jobName = cleanString(input.session.name);

  const startTime = cleanIsoDateTime(input.task.creationTime) ?? cleanIsoDateTime(input.session.creationTime);
  const endTime = cleanIsoDateTime(input.task.endTime) ?? cleanIsoDateTime(input.session.endTime);

  const taskResult = extractSessionResult(input.task.result);
  const taskState = cleanString(input.task.state);
  const progress = extractProgress(input.task.progress);

  return {
    end_time: endTime,
    start_time: startTime,
    result: taskResult.result,
    message: taskResult.message,
    state: taskState,
    job_id: jobId,
    job_name: jobName,
    session_id: sessionId,
    session_name: sessionName,
    task_session_id: cleanString(input.task.id),
    repository_id: cleanString(input.task.repositoryId),
    processed_size: progress.processedSize,
    read_size: progress.readSize,
    transferred_size: progress.transferredSize,
    duration: progress.duration,
  };
}

export function normalizeBackupSignals(args: {
  sessions: SessionModel[];
  taskSessionsBySessionId: Map<string, TaskSessionModel[]>;
}): NormalizedAsset[] {
  const byKey = new Map<string, { jobId: string; objectName: string; history: BackupHistoryItemV1[] }>();

  for (const session of args.sessions) {
    const sessionId = cleanString(session.id);
    if (!sessionId) continue;
    const jobId = cleanString(session.jobId);
    if (!jobId) continue;

    const tasks = args.taskSessionsBySessionId.get(sessionId) ?? [];
    for (const task of tasks) {
      const objectName = cleanString(task.name);
      if (!objectName) continue;

      const key = `${jobId}|${objectName}`;
      const bucket = byKey.get(key) ?? { jobId, objectName, history: [] };

      const item = toHistoryItem({ session, task });
      if (item) bucket.history.push(item);

      byKey.set(key, bucket);
    }
  }

  const out: NormalizedAsset[] = [];
  for (const [key, bucket] of byKey) {
    const historySorted = bucket.history
      .slice()
      .sort((a, b) => compareIsoDesc(a.end_time, b.end_time))
      .slice(0, 7);

    const last = historySorted[0] ?? null;
    const lastResult = last?.result ?? null;
    const backupState = mapBackupState(lastResult);
    const lastSuccessAt = pickLatestSuccessAt(historySorted);

    const objectName = bucket.objectName;

    out.push({
      external_kind: 'vm',
      external_id: key,
      normalized: {
        version: 'normalized-v1',
        kind: 'vm',
        identity: { caption: objectName },
        attributes: {
          backup_covered: true,
          backup_state: backupState,
          backup_last_result: lastResult,
          backup_last_success_at: lastSuccessAt,
          ...(last?.end_time ? { backup_last_end_at: last.end_time } : {}),
          ...(last?.message ? { backup_last_message: last.message } : {}),
        },
      },
      raw_payload: { history_last7: historySorted },
    });
  }

  return out;
}
