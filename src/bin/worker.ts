import { spawn } from 'node:child_process';

import { parseCollectorResponse, validateCollectorResponse } from '@/lib/collector/collector-response';
import { decryptJson } from '@/lib/crypto/aes-gcm';
import { prisma } from '@/lib/db/prisma';
import {
  claimQueuedDuplicateCandidateJobs,
  enqueueDuplicateCandidateJob,
  processDuplicateCandidateJob,
} from '@/lib/duplicate-candidates/job';
import { serverEnv } from '@/lib/env/server';
import { ErrorCode } from '@/lib/errors/error-codes';
import { ingestCollectRun } from '@/lib/ingest/ingest-run';
import { ingestSignalRun } from '@/lib/ingest/ingest-signal-run';
import { logEvent } from '@/lib/logging/logger';
import { recycleStaleRuns } from '@/lib/runs/recycle-stale-runs';
import { processAssetLedgerExport } from '@/lib/exports/asset-ledger-export-job';

import type { AppError } from '@/lib/errors/error';
import type { AssetLedgerExport, Prisma, Run, Source } from '@prisma/client';

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

  logEvent({
    level: input.status === 'Failed' ? 'error' : 'info',
    service: 'worker',
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
  });
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

async function claimQueuedAssetLedgerExports(batchSize: number): Promise<AssetLedgerExport[]> {
  return prisma.$queryRaw<AssetLedgerExport[]>`
    WITH next AS (
      SELECT id
      FROM "AssetLedgerExport"
      WHERE status = 'Queued'
      ORDER BY "createdAt" ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "AssetLedgerExport" e
    SET status = 'Running', "startedAt" = NOW()
    FROM next
    WHERE e.id = next.id
    RETURNING e.*;
  `;
}

function getPluginPath(source: Source): string | null {
  if (source.sourceType === 'vcenter') return serverEnv.ASSET_LEDGER_VCENTER_PLUGIN_PATH ?? null;
  if (source.sourceType === 'pve') return serverEnv.ASSET_LEDGER_PVE_PLUGIN_PATH ?? null;
  if (source.sourceType === 'hyperv') return serverEnv.ASSET_LEDGER_HYPERV_PLUGIN_PATH ?? null;
  if (source.sourceType === 'solarwinds') return serverEnv.ASSET_LEDGER_SOLARWINDS_PLUGIN_PATH ?? null;
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
  const source = await prisma.source.findUnique({
    where: { id: run.sourceId },
    include: { credential: true },
  });
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

  let credential: unknown = {};
  if (source.credentialId) {
    const payloadCiphertext = source.credential?.payloadCiphertext ?? null;
    if (!payloadCiphertext) {
      const error: AppError = {
        code: ErrorCode.CONFIG_CREDENTIAL_NOT_FOUND,
        category: 'config',
        message: 'credential not found',
        retryable: false,
        redacted_context: { credentialId: source.credentialId },
      };
      await prisma.run.update({
        where: { id: run.id },
        data: {
          status: 'Failed',
          finishedAt: new Date(),
          errorSummary: 'credential not found',
          errors: [error],
        },
      });
      return { status: 'Failed', error, errorsCount: 1, warningsCount: 0, pluginExitCode: null };
    }

    try {
      credential = decryptJson(payloadCiphertext);
    } catch (err) {
      const error: AppError = {
        code: ErrorCode.INTERNAL_ERROR,
        category: 'unknown',
        message: 'failed to decrypt credential',
        retryable: false,
        redacted_context: { cause: err instanceof Error ? err.message : String(err) },
      };
      await prisma.run.update({
        where: { id: run.id },
        data: {
          status: 'Failed',
          finishedAt: new Date(),
          errorSummary: 'failed to decrypt credential',
          errors: [error],
        },
      });
      return { status: 'Failed', error, errorsCount: 1, warningsCount: 0, pluginExitCode: null };
    }
  }

  const configObj =
    source.config && typeof source.config === 'object' ? (source.config as Record<string, unknown>) : {};
  const resolvedConfig: Record<string, unknown> = { ...configObj };

  if (source.sourceType === 'hyperv' && resolvedConfig.connection_method === 'agent') {
    if (source.agentId) {
      const agent = await prisma.agent.findUnique({ where: { id: source.agentId } });
      if (!agent) {
        const error: AppError = {
          code: ErrorCode.CONFIG_AGENT_NOT_FOUND,
          category: 'config',
          message: 'agent not found',
          retryable: false,
          redacted_context: { agentId: source.agentId },
        };
        await prisma.run.update({
          where: { id: run.id },
          data: {
            status: 'Failed',
            finishedAt: new Date(),
            errorSummary: 'agent not found',
            errors: [error],
          },
        });
        return { status: 'Failed', error, errorsCount: 1, warningsCount: 0, pluginExitCode: null };
      }

      if (!agent.enabled) {
        const error: AppError = {
          code: ErrorCode.CONFIG_INVALID_REQUEST,
          category: 'config',
          message: 'agent is disabled',
          retryable: false,
          redacted_context: { agentId: agent.id },
        };
        await prisma.run.update({
          where: { id: run.id },
          data: {
            status: 'Failed',
            finishedAt: new Date(),
            errorSummary: 'agent is disabled',
            errors: [error],
          },
        });
        return { status: 'Failed', error, errorsCount: 1, warningsCount: 0, pluginExitCode: null };
      }

      if (agent.agentType !== 'hyperv') {
        const error: AppError = {
          code: ErrorCode.CONFIG_INVALID_REQUEST,
          category: 'config',
          message: 'agent type mismatch',
          retryable: false,
          redacted_context: { agentId: agent.id, agentType: agent.agentType },
        };
        await prisma.run.update({
          where: { id: run.id },
          data: {
            status: 'Failed',
            finishedAt: new Date(),
            errorSummary: 'agent type mismatch',
            errors: [error],
          },
        });
        return { status: 'Failed', error, errorsCount: 1, warningsCount: 0, pluginExitCode: null };
      }

      // Keep plugins backward-compatible: inject the resolved agent URL + runtime settings.
      resolvedConfig.agent_url = agent.endpoint;
      resolvedConfig.agent_tls_verify = agent.tlsVerify;
      resolvedConfig.agent_timeout_ms = agent.timeoutMs;
    } else {
      const agentUrl = typeof resolvedConfig.agent_url === 'string' ? resolvedConfig.agent_url.trim() : '';
      if (!agentUrl) {
        const error: AppError = {
          code: ErrorCode.CONFIG_INVALID_REQUEST,
          category: 'config',
          message: 'agentId or agent_url is required when connection_method=agent',
          retryable: false,
        };
        await prisma.run.update({
          where: { id: run.id },
          data: {
            status: 'Failed',
            finishedAt: new Date(),
            errorSummary: 'agent missing',
            errors: [error],
          },
        });
        return { status: 'Failed', error, errorsCount: 1, warningsCount: 0, pluginExitCode: null };
      }
    }
  }

  const pluginInput = {
    schema_version: 'collector-request-v1',
    source: {
      source_id: source.id,
      source_type: source.sourceType,
      config: resolvedConfig,
      credential,
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

  // DEBUG: 仅在 debug 开关开启时回显插件 stderr（避免污染常规日志）
  if (serverEnv.ASSET_LEDGER_DEBUG && stderr.trim()) {
    console.error(`[Worker DEBUG] Plugin stderr for run ${run.id}:\n${stderr}`);
  }

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
    const parsedError = parsedResult.error;
    const error: AppError = {
      ...parsedError,
      redacted_context: {
        ...(parsedError.redacted_context ?? {}),
        ...(stderr ? { stderr_excerpt: stderr.slice(0, 2000) } : {}),
      },
    };
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
  const finishedAt = new Date();

  if (!success) {
    const fallbackError: AppError = {
      code: ErrorCode.PLUGIN_EXIT_NONZERO,
      category: 'unknown',
      message: 'plugin failed',
      retryable: false,
      redacted_context: { exit_code: exitCode, stderr_excerpt: stderr.slice(0, 2000) },
    };
    const errorsToStore = errorsValue.length > 0 ? errorsValue : [fallbackError];
    await prisma.run.update({
      where: { id: run.id },
      data: {
        status: 'Failed',
        finishedAt,
        detectResult: response.detect !== undefined ? (response.detect as Prisma.InputJsonValue) : undefined,
        stats: response.stats !== undefined ? (response.stats as Prisma.InputJsonValue) : undefined,
        errors: errorsToStore as Prisma.InputJsonValue,
        warnings: warningsValue as Prisma.InputJsonValue,
        errorSummary: `plugin failed (exitCode=${exitCode})`,
      },
    });

    return {
      status: 'Failed',
      error: fallbackError,
      errorsCount: errorsToStore.length,
      warningsCount: warningsValue.length,
      pluginExitCode: exitCode,
      detectResult: response.detect !== undefined ? (response.detect as Prisma.InputJsonValue) : undefined,
      stats: response.stats !== undefined ? (response.stats as Prisma.InputJsonValue) : undefined,
    };
  }

  if (run.mode === 'collect' || run.mode === 'collect_hosts' || run.mode === 'collect_vms') {
    const inventoryComplete =
      typeof statsObj?.inventory_complete === 'boolean'
        ? statsObj.inventory_complete
        : typeof statsObj?.inventoryComplete === 'boolean'
          ? statsObj.inventoryComplete
          : null;

    if (!inventoryComplete) {
      const error: AppError = {
        code: ErrorCode.INVENTORY_INCOMPLETE,
        category: 'schema',
        message: 'inventory not complete',
        retryable: false,
      };
      await prisma.run.update({
        where: { id: run.id },
        data: {
          status: 'Failed',
          finishedAt,
          detectResult: response.detect !== undefined ? (response.detect as Prisma.InputJsonValue) : undefined,
          stats: response.stats !== undefined ? (response.stats as Prisma.InputJsonValue) : undefined,
          errors: [error],
          warnings: warningsValue as Prisma.InputJsonValue,
          errorSummary: 'inventory not complete',
        },
      });
      return { status: 'Failed', error, errorsCount: 1, warningsCount: warningsValue.length, pluginExitCode: exitCode };
    }

    const assets = Array.isArray((response as any).assets) ? ((response as any).assets as any[]) : null;
    const relations = Array.isArray((response as any).relations) ? ((response as any).relations as any[]) : [];
    if (!assets) {
      const error: AppError = {
        code: ErrorCode.SCHEMA_VALIDATION_FAILED,
        category: 'schema',
        message: 'collector response missing assets[]',
        retryable: false,
      };
      await prisma.run.update({
        where: { id: run.id },
        data: {
          status: 'Failed',
          finishedAt,
          detectResult: response.detect !== undefined ? (response.detect as Prisma.InputJsonValue) : undefined,
          stats: response.stats !== undefined ? (response.stats as Prisma.InputJsonValue) : undefined,
          errors: [error],
          warnings: warningsValue as Prisma.InputJsonValue,
          errorSummary: 'collector response missing assets[]',
        },
      });
      return { status: 'Failed', error, errorsCount: 1, warningsCount: warningsValue.length, pluginExitCode: exitCode };
    }

    try {
      const ingestResult =
        source.role === 'signal'
          ? await ingestSignalRun({
              prisma,
              runId: run.id,
              sourceId: source.id,
              sourceType: source.sourceType,
              collectedAt: finishedAt,
              assets,
            })
          : await ingestCollectRun({
              prisma,
              runId: run.id,
              sourceId: source.id,
              runMode: run.mode,
              collectedAt: finishedAt,
              assets,
              relations,
            });

      const mergedWarnings = [...warningsValue, ...ingestResult.warnings];

      // Signal sources are not inventory: do not enqueue dedup jobs (they don't create/merge assets).
      if (source.role !== 'signal') {
        try {
          await enqueueDuplicateCandidateJob({ prisma, runId: run.id });
        } catch (err) {
          mergedWarnings.push({
            type: 'duplicate_candidates.enqueue_failed',
            error: err instanceof Error ? err.message : String(err),
          });
          logEvent({
            level: 'error',
            service: 'worker',
            event_type: 'duplicate_candidate_job.enqueue_failed',
            run_id: run.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      await prisma.run.update({
        where: { id: run.id },
        data: {
          status: 'Succeeded',
          finishedAt,
          detectResult: response.detect !== undefined ? (response.detect as Prisma.InputJsonValue) : undefined,
          stats: response.stats !== undefined ? (response.stats as Prisma.InputJsonValue) : undefined,
          errors: [],
          warnings: mergedWarnings as Prisma.InputJsonValue,
          errorSummary: null,
        },
      });

      return {
        status: 'Succeeded',
        errorsCount: 0,
        warningsCount: mergedWarnings.length,
        pluginExitCode: exitCode,
        detectResult: response.detect !== undefined ? (response.detect as Prisma.InputJsonValue) : undefined,
        stats: response.stats !== undefined ? (response.stats as Prisma.InputJsonValue) : undefined,
      };
    } catch (err) {
      const error: AppError =
        typeof err === 'object' && err && 'code' in err && 'category' in err
          ? (err as AppError)
          : {
              code: ErrorCode.DB_WRITE_FAILED,
              category: 'db',
              message: 'ingest failed',
              retryable: true,
              redacted_context: { cause: err instanceof Error ? err.message : String(err) },
            };

      await prisma.run.update({
        where: { id: run.id },
        data: {
          status: 'Failed',
          finishedAt,
          detectResult: response.detect !== undefined ? (response.detect as Prisma.InputJsonValue) : undefined,
          stats: response.stats !== undefined ? (response.stats as Prisma.InputJsonValue) : undefined,
          errors: [error],
          warnings: warningsValue as Prisma.InputJsonValue,
          errorSummary: error.message,
        },
      });

      return {
        status: 'Failed',
        error,
        errorsCount: 1,
        warningsCount: warningsValue.length,
        pluginExitCode: exitCode,
        detectResult: response.detect !== undefined ? (response.detect as Prisma.InputJsonValue) : undefined,
        stats: response.stats !== undefined ? (response.stats as Prisma.InputJsonValue) : undefined,
      };
    }
  }

  await prisma.run.update({
    where: { id: run.id },
    data: {
      status: 'Succeeded',
      finishedAt,
      detectResult: response.detect !== undefined ? (response.detect as Prisma.InputJsonValue) : undefined,
      stats: response.stats !== undefined ? (response.stats as Prisma.InputJsonValue) : undefined,
      errors: [],
      warnings: warningsValue as Prisma.InputJsonValue,
      errorSummary: null,
    },
  });

  return {
    status: 'Succeeded',
    errorsCount: 0,
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
  let lastRecycleAtMs = 0;
  const shutdown = async (signal: string) => {
    stopping = true;
    log('shutting down', { signal });
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  while (!stopping) {
    // Auto-recycle stale `Running` runs (e.g. worker crash left them stuck forever).
    // Do this at a low frequency to avoid extra DB load on every poll.
    if (Date.now() - lastRecycleAtMs >= serverEnv.ASSET_LEDGER_SCHEDULER_TICK_MS) {
      lastRecycleAtMs = Date.now();
      try {
        const res = await recycleStaleRuns({
          prisma,
          now: new Date(),
          staleAfterMs: serverEnv.ASSET_LEDGER_RUN_RECYCLE_AFTER_MS,
        });
        if (res.recycled > 0) {
          logEvent({
            level: 'info',
            service: 'worker',
            event_type: 'run.recycled',
            recycled: res.recycled,
            stale_before: res.staleBefore.toISOString(),
          });
        }
      } catch (err) {
        log('failed to recycle stale runs', { error: err instanceof Error ? err.message : String(err) });
      }
    }

    const runs = await claimQueuedRuns(serverEnv.ASSET_LEDGER_WORKER_BATCH_SIZE);
    if (runs.length === 0) {
      const jobs = await claimQueuedDuplicateCandidateJobs({ prisma, batchSize: 1 });
      if (jobs.length > 0) {
        for (const job of jobs) {
          log('processing duplicate-candidate job', { jobId: job.id, runId: job.runId });
          const now = new Date();
          try {
            const res = await processDuplicateCandidateJob({ prisma, job, now });
            await prisma.duplicateCandidateJob.update({
              where: { id: job.id },
              data: { status: 'Succeeded', finishedAt: now, errorSummary: null },
            });
            logEvent({
              level: 'info',
              service: 'worker',
              event_type: 'duplicate_candidate_job.succeeded',
              job_id: job.id,
              run_id: job.runId,
              candidates: res.candidates,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await prisma.duplicateCandidateJob.update({
              where: { id: job.id },
              data: { status: 'Failed', finishedAt: now, errorSummary: message.slice(0, 2000) },
            });
            logEvent({
              level: 'error',
              service: 'worker',
              event_type: 'duplicate_candidate_job.failed',
              job_id: job.id,
              run_id: job.runId,
              error: message,
            });
          }
        }
        continue;
      }

      const exports = await claimQueuedAssetLedgerExports(1);
      if (exports.length > 0) {
        for (const exp of exports) {
          log('processing asset-ledger export', { exportId: exp.id, status: exp.status });
          try {
            await processAssetLedgerExport({
              prisma,
              exportRow: {
                id: exp.id,
                requestedByUserId: exp.requestedByUserId,
                params: exp.params,
                requestId: exp.requestId,
              },
            });
          } catch (err) {
            log('export processing crashed', {
              exportId: exp.id,
              error: err instanceof Error ? err.message : String(err),
            });
            const error: AppError = {
              code: ErrorCode.INTERNAL_ERROR,
              category: 'unknown',
              message: 'worker crashed while processing export',
              retryable: true,
              redacted_context: { cause: err instanceof Error ? err.message : String(err) },
            };
            await prisma.assetLedgerExport.update({
              where: { id: exp.id },
              data: {
                status: 'Failed',
                finishedAt: new Date(),
                error: error as Prisma.InputJsonValue,
                fileBytes: null,
              },
            });
          }
        }
        continue;
      }

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
