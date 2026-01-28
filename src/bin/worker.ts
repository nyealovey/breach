import { spawn } from 'node:child_process';

import { parseCollectorResponse, validateCollectorResponse } from '@/lib/collector/collector-response';
import { prisma } from '@/lib/db/prisma';
import { serverEnv } from '@/lib/env/server';
import { ErrorCode } from '@/lib/errors/error-codes';

import type { AppError } from '@/lib/errors/error';
import type { Prisma, Run, Source } from '@prisma/client';

function log(message: string, extra?: Record<string, unknown>) {
  const payload = extra ? ` ${JSON.stringify(extra)}` : '';
  console.log(`[worker] ${message}${payload}`);
}

function logRunFinished(input: {
  run: Run;
  status: 'Succeeded' | 'Failed';
  durationMs: number;
  error?: AppError;
  pluginExitCode: number | null;
  stats?: Prisma.InputJsonValue;
  warningsCount: number;
  errorsCount: number;
}) {
  const statsObj =
    typeof input.stats === 'object' && input.stats ? (input.stats as Record<string, unknown>) : undefined;
  const event = {
    ts: new Date().toISOString(),
    level: input.status === 'Failed' ? 'error' : 'info',
    service: 'worker',
    env: process.env.NODE_ENV ?? 'development',
    event_type: 'run.finished',
    run_id: input.run.id,
    source_id: input.run.sourceId,
    trigger_type: input.run.triggerType,
    mode: input.run.mode,
    status: input.status,
    duration_ms: input.durationMs,
    plugin: {
      timeout_ms: serverEnv.ASSET_LEDGER_PLUGIN_TIMEOUT_MS,
      exit_code: input.pluginExitCode,
      driver: null,
    },
    stats: statsObj
      ? {
          assets: typeof statsObj.assets === 'number' ? statsObj.assets : undefined,
          relations: typeof statsObj.relations === 'number' ? statsObj.relations : undefined,
          inventory_complete:
            typeof statsObj.inventoryComplete === 'boolean'
              ? statsObj.inventoryComplete
              : typeof statsObj.inventory_complete === 'boolean'
                ? statsObj.inventory_complete
                : null,
        }
      : undefined,
    warnings_count: input.warningsCount,
    errors_count: input.errorsCount,
    ...(input.error ? { error: input.error } : {}),
  };

  console.log(JSON.stringify(event));
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function claimQueuedRuns(batchSize: number): Promise<Run[]> {
  return prisma.$queryRaw<Run[]>`
    WITH next AS (
      SELECT id
      FROM "Run"
      WHERE status = 'Queued'
      ORDER BY "createdAt" ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "Run" r
    SET status = 'Running', "startedAt" = NOW(), "updatedAt" = NOW()
    FROM next
    WHERE r.id = next.id
    RETURNING r.*;
  `;
}

function getPluginPath(source: Source): string | null {
  if (source.sourceType === 'vcenter') return serverEnv.ASSET_LEDGER_VCENTER_PLUGIN_PATH ?? null;
  return null;
}

async function runPlugin(args: { pluginPath: string; input: unknown; timeoutMs: number }) {
  const child = spawn(args.pluginPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });

  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let spawnError: Error | null = null;

  child.on('error', (err) => {
    spawnError = err;
  });

  child.stdout.on('data', (buf) => {
    stdout += buf.toString('utf8');
  });
  child.stderr.on('data', (buf) => {
    stderr += buf.toString('utf8');
  });

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, args.timeoutMs);

  child.stdin.write(JSON.stringify(args.input));
  child.stdin.end();

  const exitCode = await new Promise<number | null>((resolve) => {
    child.on('close', (code) => resolve(code ?? null));
  });

  clearTimeout(timeout);

  return { exitCode, stdout, stderr, timedOut, spawnError };
}

type ProcessResult = {
  status: 'Succeeded' | 'Failed';
  error?: AppError;
  errorsCount: number;
  warningsCount: number;
  pluginExitCode: number | null;
  detectResult?: Prisma.InputJsonValue;
  stats?: Prisma.InputJsonValue;
};

async function processRun(run: Run): Promise<ProcessResult> {
  const source = await prisma.source.findUnique({ where: { id: run.sourceId } });
  if (!source) {
    const error: AppError = {
      code: ErrorCode.CONFIG_SOURCE_NOT_FOUND,
      category: 'config',
      message: 'source not found',
      retryable: false,
    };
    await prisma.run.update({
      where: { id: run.id },
      data: {
        status: 'Failed',
        finishedAt: new Date(),
        errorSummary: `source not found: ${run.sourceId}`,
        errors: [error],
      },
    });
    return { status: 'Failed', error, errorsCount: 1, warningsCount: 0, pluginExitCode: null };
  }

  const pluginPath = getPluginPath(source);
  if (!pluginPath) {
    const error: AppError = {
      code: ErrorCode.PLUGIN_EXEC_FAILED,
      category: 'unknown',
      message: 'plugin path not configured',
      retryable: false,
    };
    await prisma.run.update({
      where: { id: run.id },
      data: {
        status: 'Failed',
        finishedAt: new Date(),
        errorSummary: `plugin not configured for source_type=${source.sourceType}`,
        errors: [error],
      },
    });
    return { status: 'Failed', error, errorsCount: 1, warningsCount: 0, pluginExitCode: null };
  }

  const pluginInput = {
    schema_version: 'collector-request-v1',
    source: {
      source_id: source.id,
      source_type: source.sourceType,
      config: source.config ?? {},
      credential: {},
    },
    request: {
      run_id: run.id,
      mode: run.mode,
      now: new Date().toISOString(),
    },
  };

  const { exitCode, stdout, stderr, timedOut, spawnError } = await runPlugin({
    pluginPath,
    input: pluginInput,
    timeoutMs: serverEnv.ASSET_LEDGER_PLUGIN_TIMEOUT_MS,
  });

  if (spawnError) {
    const error: AppError = {
      code: ErrorCode.PLUGIN_EXEC_FAILED,
      category: 'unknown',
      message: 'plugin failed to start',
      retryable: false,
      redacted_context: { stderr_excerpt: stderr.slice(0, 2000) },
    };
    await prisma.run.update({
      where: { id: run.id },
      data: {
        status: 'Failed',
        finishedAt: new Date(),
        errorSummary: 'plugin failed to start',
        errors: [error],
      },
    });
    return { status: 'Failed', error, errorsCount: 1, warningsCount: 0, pluginExitCode: exitCode };
  }

  if (timedOut) {
    const error: AppError = {
      code: ErrorCode.PLUGIN_TIMEOUT,
      category: 'unknown',
      message: 'plugin timed out',
      retryable: true,
      redacted_context: { stderr_excerpt: stderr.slice(0, 2000) },
    };
    await prisma.run.update({
      where: { id: run.id },
      data: {
        status: 'Failed',
        finishedAt: new Date(),
        errorSummary: 'plugin timed out',
        errors: [error],
      },
    });
    return { status: 'Failed', error, errorsCount: 1, warningsCount: 0, pluginExitCode: exitCode };
  }

  const parsedResult = parseCollectorResponse(stdout);
  if (!parsedResult.ok) {
    const error = parsedResult.error;
    await prisma.run.update({
      where: { id: run.id },
      data: {
        status: 'Failed',
        finishedAt: new Date(),
        errorSummary: error.message,
        errors: [error],
      },
    });
    return { status: 'Failed', error, errorsCount: 1, warningsCount: 0, pluginExitCode: exitCode };
  }

  const response = parsedResult.response;

  const validateResult = validateCollectorResponse(response);
  if (!validateResult.ok) {
    const error = validateResult.error;
    await prisma.run.update({
      where: { id: run.id },
      data: {
        status: 'Failed',
        finishedAt: new Date(),
        errorSummary: error.message,
        errors: [error],
      },
    });
    return { status: 'Failed', error, errorsCount: 1, warningsCount: 0, pluginExitCode: exitCode };
  }

  const statsObj =
    response.stats && typeof response.stats === 'object' ? (response.stats as Record<string, unknown>) : undefined;
  const warningsValue = Array.isArray(statsObj?.warnings) ? (statsObj?.warnings as unknown[]) : [];
  const errorsValue = Array.isArray(response.errors) ? response.errors : [];

  const success = exitCode === 0 && errorsValue.length === 0;

  await prisma.run.update({
    where: { id: run.id },
    data: {
      status: success ? 'Succeeded' : 'Failed',
      finishedAt: new Date(),
      detectResult: response.detect !== undefined ? (response.detect as Prisma.InputJsonValue) : undefined,
      stats: response.stats !== undefined ? (response.stats as Prisma.InputJsonValue) : undefined,
      errors: errorsValue as Prisma.InputJsonValue,
      warnings: warningsValue as Prisma.InputJsonValue,
      errorSummary: success ? null : `plugin failed (exitCode=${exitCode})`,
    },
  });

  return {
    status: success ? 'Succeeded' : 'Failed',
    error: success
      ? undefined
      : ({
          code: ErrorCode.PLUGIN_EXIT_NONZERO,
          category: 'unknown',
          message: 'plugin failed',
          retryable: false,
        } satisfies AppError),
    errorsCount: errorsValue.length,
    warningsCount: warningsValue.length,
    pluginExitCode: exitCode,
    detectResult: response.detect !== undefined ? (response.detect as Prisma.InputJsonValue) : undefined,
    stats: response.stats !== undefined ? (response.stats as Prisma.InputJsonValue) : undefined,
  };
}

async function main() {
  log('starting', {
    pollMs: serverEnv.ASSET_LEDGER_WORKER_POLL_MS,
    batchSize: serverEnv.ASSET_LEDGER_WORKER_BATCH_SIZE,
  });

  let stopping = false;
  const shutdown = async (signal: string) => {
    stopping = true;
    log('shutting down', { signal });
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  while (!stopping) {
    const runs = await claimQueuedRuns(serverEnv.ASSET_LEDGER_WORKER_BATCH_SIZE);
    if (runs.length === 0) {
      await sleep(serverEnv.ASSET_LEDGER_WORKER_POLL_MS);
      continue;
    }

    for (const run of runs) {
      log('processing run', { runId: run.id, sourceId: run.sourceId, mode: run.mode, triggerType: run.triggerType });
      try {
        const result = await processRun(run);
        const startedAt = run.startedAt ? run.startedAt.getTime() : Date.now();
        const durationMs = Date.now() - startedAt;
        logRunFinished({
          run,
          status: result.status,
          durationMs,
          error: result.error,
          pluginExitCode: result.pluginExitCode,
          stats: result.stats,
          warningsCount: result.warningsCount,
          errorsCount: result.errorsCount,
        });
      } catch (err) {
        log('run processing crashed', { runId: run.id, error: err instanceof Error ? err.message : String(err) });
        const error: AppError = {
          code: ErrorCode.INTERNAL_ERROR,
          category: 'unknown',
          message: err instanceof Error ? err.message : String(err),
          retryable: true,
        };
        await prisma.run.update({
          where: { id: run.id },
          data: {
            status: 'Failed',
            finishedAt: new Date(),
            errorSummary: 'worker crashed while processing run',
            errors: [error],
          },
        });
        const startedAt = run.startedAt ? run.startedAt.getTime() : Date.now();
        const durationMs = Date.now() - startedAt;
        logRunFinished({
          run,
          status: 'Failed',
          durationMs,
          error,
          pluginExitCode: null,
          stats: undefined,
          warningsCount: 0,
          errorsCount: 1,
        });
      }
    }
  }
}

void main();
