import { spawn } from 'node:child_process';

import { prisma } from '@/lib/db/prisma';
import { serverEnv } from '@/lib/env/server';

import type { Prisma, Run, Source } from '@prisma/client';

function log(message: string, extra?: Record<string, unknown>) {
  const payload = extra ? ` ${JSON.stringify(extra)}` : '';
  console.log(`[worker] ${message}${payload}`);
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

  child.stdout.on('data', (buf) => {
    stdout += buf.toString('utf8');
  });
  child.stderr.on('data', (buf) => {
    stderr += buf.toString('utf8');
  });

  const timeout = setTimeout(() => {
    child.kill('SIGKILL');
  }, args.timeoutMs);

  child.stdin.write(JSON.stringify(args.input));
  child.stdin.end();

  const exitCode = await new Promise<number>((resolve) => {
    child.on('close', (code) => resolve(code ?? 0));
  });

  clearTimeout(timeout);

  return { exitCode, stdout, stderr };
}

async function processRun(run: Run) {
  const source = await prisma.source.findUnique({ where: { id: run.sourceId } });
  if (!source) {
    await prisma.run.update({
      where: { id: run.id },
      data: {
        status: 'Failed',
        finishedAt: new Date(),
        errorSummary: `source not found: ${run.sourceId}`,
        errors: [{ code: 'SOURCE_NOT_FOUND', category: 'config', message: 'source not found', retryable: false }],
      },
    });
    return;
  }

  const pluginPath = getPluginPath(source);
  if (!pluginPath) {
    await prisma.run.update({
      where: { id: run.id },
      data: {
        status: 'Failed',
        finishedAt: new Date(),
        errorSummary: `plugin not configured for source_type=${source.sourceType}`,
        errors: [
          {
            code: 'PLUGIN_NOT_CONFIGURED',
            category: 'config',
            message: 'plugin path not configured',
            retryable: false,
          },
        ],
      },
    });
    return;
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

  const { exitCode, stdout, stderr } = await runPlugin({
    pluginPath,
    input: pluginInput,
    timeoutMs: serverEnv.ASSET_LEDGER_PLUGIN_TIMEOUT_MS,
  });

  if (exitCode !== 0) {
    await prisma.run.update({
      where: { id: run.id },
      data: {
        status: 'Failed',
        finishedAt: new Date(),
        errorSummary: `plugin exit code ${exitCode}`,
        errors: [
          {
            code: 'PLUGIN_FAILED',
            category: 'unknown',
            message: 'plugin returned non-zero exit code',
            retryable: true,
            redacted_context: { exit_code: exitCode, stderr_excerpt: stderr.slice(0, 2000) },
          },
        ],
      },
    });
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    await prisma.run.update({
      where: { id: run.id },
      data: {
        status: 'Failed',
        finishedAt: new Date(),
        errorSummary: 'failed to parse plugin stdout as json',
        errors: [
          {
            code: 'PLUGIN_OUTPUT_INVALID_JSON',
            category: 'parse',
            message: 'failed to parse plugin stdout as json',
            retryable: false,
            redacted_context: { stdout_excerpt: stdout.slice(0, 2000), stderr_excerpt: stderr.slice(0, 2000) },
          },
        ],
      },
    });
    return;
  }

  const response = parsed as {
    detect?: unknown;
    stats?: unknown;
    errors?: unknown;
  };

  await prisma.run.update({
    where: { id: run.id },
    data: {
      status: 'Succeeded',
      finishedAt: new Date(),
      detectResult: response.detect !== undefined ? (response.detect as Prisma.InputJsonValue) : undefined,
      stats: response.stats !== undefined ? (response.stats as Prisma.InputJsonValue) : undefined,
      errors: response.errors !== undefined ? (response.errors as Prisma.InputJsonValue) : undefined,
      warnings: undefined,
      errorSummary: null,
    },
  });
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
        await processRun(run);
      } catch (err) {
        log('run processing crashed', { runId: run.id, error: err instanceof Error ? err.message : String(err) });
        await prisma.run.update({
          where: { id: run.id },
          data: {
            status: 'Failed',
            finishedAt: new Date(),
            errorSummary: 'worker crashed while processing run',
            errors: [
              {
                code: 'WORKER_CRASH',
                category: 'unknown',
                message: err instanceof Error ? err.message : String(err),
                retryable: true,
              },
            ],
          },
        });
      }
    }
  }
}

void main();
