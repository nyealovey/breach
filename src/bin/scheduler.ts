import { prisma } from '@/lib/db/prisma';
import { serverEnv } from '@/lib/env/server';
import { logEvent } from '@/lib/logging/logger';
import { getLocalParts, localDateToUtcDateOnly } from '@/lib/timezone';

function log(message: string, extra?: Record<string, unknown>) {
  const payload = extra ? ` ${JSON.stringify(extra)}` : '';
  console.log(`[scheduler] ${message}${payload}`);
}

async function enqueueDueGroups(now: Date) {
  const groups = await prisma.scheduleGroup.findMany({
    where: { enabled: true },
    select: {
      id: true,
      name: true,
      timezone: true,
      runAtHhmm: true,
      lastTriggeredOn: true,
    },
  });

  for (const group of groups) {
    let local;
    try {
      local = getLocalParts(now, group.timezone);
    } catch {
      log('invalid timezone; skipping group', { groupId: group.id, timezone: group.timezone });
      continue;
    }

    if (local.hhmm !== group.runAtHhmm) continue;

    const today = localDateToUtcDateOnly(local.localDate);

    // Idempotency: trigger at most once per (group, local_date).
    const updated = await prisma.scheduleGroup.updateMany({
      where: {
        id: group.id,
        enabled: true,
        OR: [{ lastTriggeredOn: null }, { lastTriggeredOn: { not: today } }],
      },
      data: { lastTriggeredOn: today },
    });

    if (updated.count === 0) continue;

    const sources = await prisma.source.findMany({
      where: { enabled: true, scheduleGroupId: group.id, deletedAt: null, credentialId: { not: null } },
      select: { id: true },
    });
    const sourceIds = sources.map((s) => s.id);

    if (sourceIds.length === 0) {
      log('triggered group but has no enabled sources', {
        groupId: group.id,
        localDate: local.localDate,
        hhmm: local.hhmm,
      });
      continue;
    }

    // Single-source single-flight (MVP): do not enqueue if an active run exists.
    const active = await prisma.run.findMany({
      where: { sourceId: { in: sourceIds }, status: { in: ['Queued', 'Running'] } },
      select: { sourceId: true },
      distinct: ['sourceId'],
    });
    const activeSet = new Set(active.map((r) => r.sourceId));

    const toQueue = sourceIds.filter((id) => !activeSet.has(id));

    if (toQueue.length > 0) {
      await prisma.run.createMany({
        data: toQueue.map((sourceId) => ({
          sourceId,
          scheduleGroupId: group.id,
          triggerType: 'schedule',
          mode: 'collect',
        })),
      });
    }

    logEvent({
      level: 'info',
      service: 'scheduler',
      event_type: 'schedule_group.triggered',
      schedule_group_id: group.id,
      timezone: group.timezone,
      local_date: local.localDate,
      hhmm: local.hhmm,
      queued: toQueue.length,
      skipped_active: activeSet.size,
    });
  }
}

async function main() {
  log('starting', { tickMs: serverEnv.ASSET_LEDGER_SCHEDULER_TICK_MS });

  const tick = async () => {
    try {
      await enqueueDueGroups(new Date());
    } catch (err) {
      log('tick failed', { error: err instanceof Error ? err.message : String(err) });
    }
  };

  await tick();
  const interval = setInterval(tick, serverEnv.ASSET_LEDGER_SCHEDULER_TICK_MS);

  const shutdown = async (signal: string) => {
    clearInterval(interval);
    log('shutting down', { signal });
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
