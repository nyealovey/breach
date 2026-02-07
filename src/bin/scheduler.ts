import { prisma } from '@/lib/db/prisma';
import { serverEnv } from '@/lib/env/server';
import { logEvent } from '@/lib/logging/logger';
import { recycleStaleRuns } from '@/lib/runs/recycle-stale-runs';
import { isAdAuthOnlySource } from '@/lib/sources/ad-source';
import { getLocalParts, localDateToUtcDateOnly } from '@/lib/timezone';

function log(message: string, extra?: Record<string, unknown>) {
  const payload = extra ? ` ${JSON.stringify(extra)}` : '';
  console.log(`[scheduler] ${message}${payload}`);
}

function hasVcenterPreferredVersion(config: unknown): boolean {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
  const value = (config as Record<string, unknown>).preferred_vcenter_version;
  return value === '6.5-6.7' || value === '7.0-8.x';
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
      select: { id: true, sourceType: true, config: true },
    });
    const eligibleSources = sources.filter((s) => {
      if (s.sourceType === 'vcenter') return hasVcenterPreferredVersion(s.config);
      if (s.sourceType === 'activedirectory') return !isAdAuthOnlySource(s.config);
      return true;
    });
    const sourceIds = eligibleSources.map((s) => s.id);

    if (sourceIds.length === 0) {
      log('triggered group but has no enabled sources', {
        groupId: group.id,
        localDate: local.localDate,
        hhmm: local.hhmm,
      });
      continue;
    }

    // Single-source single-flight (MVP): do not enqueue if an active run exists for the same (source, mode).
    const active = await prisma.run.findMany({
      where: { sourceId: { in: sourceIds }, status: { in: ['Queued', 'Running'] } },
      select: { sourceId: true, mode: true },
      distinct: ['sourceId', 'mode'],
    });
    const activeSet = new Set(active.map((r) => `${r.sourceId}:${r.mode}`));

    const vcenterSources = eligibleSources.filter((s) => s.sourceType === 'vcenter');
    const otherSources = eligibleSources.filter((s) => s.sourceType !== 'vcenter');

    const hostRuns = vcenterSources
      .filter((s) => !activeSet.has(`${s.id}:collect_hosts`))
      .map((s) => ({
        sourceId: s.id,
        scheduleGroupId: group.id,
        triggerType: 'schedule' as const,
        mode: 'collect_hosts' as const,
      }));

    const vmRuns = vcenterSources
      .filter((s) => !activeSet.has(`${s.id}:collect_vms`))
      .map((s) => ({
        sourceId: s.id,
        scheduleGroupId: group.id,
        triggerType: 'schedule' as const,
        mode: 'collect_vms' as const,
      }));

    const collectRuns = otherSources
      .filter((s) => !activeSet.has(`${s.id}:collect`))
      .map((s) => ({
        sourceId: s.id,
        scheduleGroupId: group.id,
        triggerType: 'schedule' as const,
        mode: 'collect' as const,
      }));

    // Create in order so hosts runs are likely processed before vm runs.
    if (hostRuns.length > 0) await prisma.run.createMany({ data: hostRuns });
    if (vmRuns.length > 0) await prisma.run.createMany({ data: vmRuns });
    if (collectRuns.length > 0) await prisma.run.createMany({ data: collectRuns });

    logEvent({
      level: 'info',
      service: 'scheduler',
      event_type: 'schedule_group.triggered',
      schedule_group_id: group.id,
      timezone: group.timezone,
      local_date: local.localDate,
      hhmm: local.hhmm,
      queued: hostRuns.length + vmRuns.length + collectRuns.length,
      queued_by_mode: { collect_hosts: hostRuns.length, collect_vms: vmRuns.length, collect: collectRuns.length },
      skipped_active_by_mode: {
        collect_hosts: vcenterSources.length - hostRuns.length,
        collect_vms: vcenterSources.length - vmRuns.length,
        collect: otherSources.length - collectRuns.length,
      },
    });
  }
}

async function main() {
  log('starting', { tickMs: serverEnv.ASSET_LEDGER_SCHEDULER_TICK_MS });

  const tick = async () => {
    try {
      const recycleRes = await recycleStaleRuns({
        prisma,
        now: new Date(),
        staleAfterMs: serverEnv.ASSET_LEDGER_RUN_RECYCLE_AFTER_MS,
      });
      if (recycleRes.recycled > 0) {
        logEvent({
          level: 'info',
          service: 'scheduler',
          event_type: 'run.recycled',
          recycled: recycleRes.recycled,
          stale_before: recycleRes.staleBefore.toISOString(),
        });
      }

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
