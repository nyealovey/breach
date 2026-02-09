'use server';

import { z } from 'zod/v4';

import { requireServerAdminSession } from '@/lib/auth/require-server-session';
import { actionError, actionOk, getActionErrorMessage } from '@/lib/actions/action-result';
import { prisma } from '@/lib/db/prisma';
import { isAdAuthOnlySource } from '@/lib/sources/ad-source';

import type { ActionResult } from '@/lib/actions/action-result';

export type ScheduleGroupListItem = {
  groupId: string;
  name: string;
  enabled: boolean;
  timezone: string;
  runAtHhmm: string;
  sourceCount: number;
  lastTriggeredOn: string | null;
};

export type ScheduleGroupDetail = {
  groupId: string;
  name: string;
  enabled: boolean;
  timezone: string;
  runAtHhmm: string;
};

export type ScheduleGroupSourceItem = {
  sourceId: string;
  name: string;
  sourceType: string;
  enabled: boolean;
  scheduleGroupId: string | null;
  scheduleGroupName: string | null;
};

export type ManualRunResult = {
  queued: number;
  skipped_active: number;
  skipped_missing_credential: number;
  skipped_missing_config?: number;
  message: string;
};

type GroupRunMode = 'healthcheck' | 'detect' | 'collect';

function clampPageSize(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const n = Math.trunc(value);
  if (n <= 0) return fallback;
  return Math.min(n, 200);
}

function isValidTimezone(timezone: string) {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function isValidHhmm(value: string) {
  return /^(?:[01]\\d|2[0-3]):[0-5]\\d$/.test(value);
}

export async function listScheduleGroups(input?: { pageSize?: number; enabled?: boolean }) {
  await requireServerAdminSession();

  const pageSize = clampPageSize(input?.pageSize, 100);
  const enabled = typeof input?.enabled === 'boolean' ? input.enabled : undefined;
  const where = enabled === undefined ? {} : { enabled };

  const groups = await prisma.scheduleGroup.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: pageSize,
  });

  const ids = groups.map((g) => g.id);
  const counts =
    ids.length > 0
      ? await prisma.source.groupBy({
          by: ['scheduleGroupId'],
          where: { scheduleGroupId: { in: ids }, deletedAt: null },
          _count: { _all: true },
        })
      : [];
  const countMap = new Map(counts.map((item) => [item.scheduleGroupId ?? '', item._count._all]));

  return groups.map((g) => ({
    groupId: g.id,
    name: g.name,
    enabled: g.enabled,
    timezone: g.timezone,
    runAtHhmm: g.runAtHhmm,
    sourceCount: countMap.get(g.id) ?? 0,
    lastTriggeredOn: g.lastTriggeredOn?.toISOString().slice(0, 10) ?? null,
  })) satisfies ScheduleGroupListItem[];
}

export async function getScheduleGroup(groupId: string): Promise<ScheduleGroupDetail | null> {
  await requireServerAdminSession();

  const id = groupId.trim();
  if (!id) return null;

  const group = await prisma.scheduleGroup.findUnique({ where: { id } });
  if (!group) return null;

  return {
    groupId: group.id,
    name: group.name,
    enabled: group.enabled,
    timezone: group.timezone,
    runAtHhmm: group.runAtHhmm,
  };
}

export async function listEnabledSourcesForScheduleGroup() {
  await requireServerAdminSession();

  const sources = await prisma.source.findMany({
    where: { enabled: true, deletedAt: null },
    orderBy: { name: 'asc' },
    include: { scheduleGroup: { select: { name: true } } },
    take: 200,
  });

  return sources.map((s) => ({
    sourceId: s.id,
    name: s.name,
    sourceType: s.sourceType,
    enabled: s.enabled,
    scheduleGroupId: s.scheduleGroupId,
    scheduleGroupName: s.scheduleGroup?.name ?? null,
  })) satisfies ScheduleGroupSourceItem[];
}

const ScheduleGroupSchema = z.object({
  name: z.string().min(1),
  timezone: z.string().min(1),
  runAtHhmm: z.string().min(1),
  enabled: z.boolean().optional(),
  sourceIds: z.array(z.string().min(1)).min(1),
});

export async function createScheduleGroupAction(input: unknown): Promise<ActionResult<ScheduleGroupDetail>> {
  await requireServerAdminSession();

  let body: z.infer<typeof ScheduleGroupSchema>;
  try {
    body = ScheduleGroupSchema.parse(input);
  } catch {
    return actionError('Validation failed');
  }

  if (!isValidTimezone(body.timezone)) return actionError('Invalid timezone');
  if (!isValidHhmm(body.runAtHhmm)) return actionError('Invalid HH:mm');

  try {
    const sourceIds = Array.from(new Set(body.sourceIds));
    const sources = await prisma.source.findMany({
      where: { id: { in: sourceIds }, deletedAt: null, enabled: true },
      select: { id: true },
    });
    if (sources.length !== sourceIds.length)
      return actionError('Invalid sourceIds (only enabled sources can be selected)');

    const group = await prisma.$transaction(async (tx) => {
      const group = await tx.scheduleGroup.create({
        data: { name: body.name, timezone: body.timezone, runAtHhmm: body.runAtHhmm, enabled: body.enabled ?? true },
      });

      await tx.source.updateMany({
        where: { id: { in: sourceIds }, deletedAt: null, enabled: true },
        data: { scheduleGroupId: group.id },
      });

      return group;
    });

    return actionOk({
      groupId: group.id,
      name: group.name,
      enabled: group.enabled,
      timezone: group.timezone,
      runAtHhmm: group.runAtHhmm,
    });
  } catch (err) {
    if (typeof err === 'object' && err && 'code' in err && (err as { code: string }).code === 'P2002') {
      return actionError('Name already exists');
    }
    return actionError(getActionErrorMessage(err, 'Failed to create schedule group'));
  }
}

const ScheduleGroupUpdateSchema = ScheduleGroupSchema.extend({ sourceIds: z.array(z.string().min(1)).optional() });

export async function updateScheduleGroupAction(
  groupId: string,
  input: unknown,
): Promise<ActionResult<ScheduleGroupDetail>> {
  await requireServerAdminSession();

  const id = groupId.trim();
  if (!id) return actionError('Invalid groupId');

  let body: z.infer<typeof ScheduleGroupUpdateSchema>;
  try {
    body = ScheduleGroupUpdateSchema.parse(input);
  } catch {
    return actionError('Validation failed');
  }

  if (!isValidTimezone(body.timezone)) return actionError('Invalid timezone');
  if (!isValidHhmm(body.runAtHhmm)) return actionError('Invalid HH:mm');

  const sourceIds = body.sourceIds ? Array.from(new Set(body.sourceIds)) : null;
  if (sourceIds) {
    const sources = await prisma.source.findMany({
      where: { id: { in: sourceIds }, deletedAt: null, enabled: true },
      select: { id: true },
    });
    if (sources.length !== sourceIds.length)
      return actionError('Invalid sourceIds (only enabled sources can be selected)');
  }

  try {
    const group = await prisma.$transaction(async (tx) => {
      const group = await tx.scheduleGroup.update({
        where: { id },
        data: { name: body.name, timezone: body.timezone, runAtHhmm: body.runAtHhmm, enabled: body.enabled ?? true },
      });

      if (sourceIds) {
        await tx.source.updateMany({
          where: { scheduleGroupId: id, deletedAt: null, enabled: true, id: { notIn: sourceIds } },
          data: { scheduleGroupId: null },
        });
        await tx.source.updateMany({
          where: { id: { in: sourceIds }, deletedAt: null, enabled: true },
          data: { scheduleGroupId: id },
        });
      }

      return group;
    });

    return actionOk({
      groupId: group.id,
      name: group.name,
      enabled: group.enabled,
      timezone: group.timezone,
      runAtHhmm: group.runAtHhmm,
    });
  } catch (err) {
    if (typeof err === 'object' && err && 'code' in err && (err as { code: string }).code === 'P2002') {
      return actionError('Name already exists');
    }
    return actionError(getActionErrorMessage(err, 'Failed to update schedule group'));
  }
}

export async function deleteScheduleGroupAction(groupId: string): Promise<ActionResult<{ deleted: true }>> {
  await requireServerAdminSession();

  const id = groupId.trim();
  if (!id) return actionError('Invalid groupId');

  const exists = await prisma.scheduleGroup.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return actionError('Schedule group not found');

  const sourceCount = await prisma.source.count({ where: { scheduleGroupId: id, deletedAt: null } });
  if (sourceCount > 0) return actionError('Schedule group still has active sources');

  try {
    await prisma.scheduleGroup.delete({ where: { id } });
    return actionOk({ deleted: true });
  } catch (err) {
    return actionError(getActionErrorMessage(err, 'Failed to delete schedule group'));
  }
}

// Manual run / enqueue logic (ported from /api/v1/schedule-groups/[id]/runs).
function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function hasVcenterPreferredVersion(config: unknown): boolean {
  if (!isRecord(config)) return false;
  const value = config.preferred_vcenter_version;
  return value === '6.5-6.7' || value === '7.0-8.x';
}

function hasExplicitCollectScope(config: unknown): boolean {
  if (!isRecord(config)) return false;
  const scope = config.scope;
  return scope === 'standalone' || scope === 'cluster';
}

function getHypervConnectionMethod(config: unknown): 'agent' | 'winrm' {
  if (!isRecord(config)) return 'winrm';
  return config.connection_method === 'agent' ? 'agent' : 'winrm';
}

function hasExplicitHypervAuthMethod(config: unknown): boolean {
  if (!isRecord(config)) return false;
  const auth = config.auth_method;
  return auth === 'kerberos' || auth === 'ntlm' || auth === 'basic';
}

function hasValidCollectConfig(params: { sourceType: string; config: unknown }): boolean {
  if (params.sourceType === 'vcenter') return hasVcenterPreferredVersion(params.config);
  if (params.sourceType === 'pve') return hasExplicitCollectScope(params.config);
  if (params.sourceType === 'hyperv') {
    if (!hasExplicitCollectScope(params.config)) return false;
    if (getHypervConnectionMethod(params.config) === 'agent') return true;
    return hasExplicitHypervAuthMethod(params.config);
  }
  if (params.sourceType === 'activedirectory') return !isAdAuthOnlySource(params.config);
  return true;
}

const ManualRunBodySchema = z.object({ mode: z.enum(['collect', 'detect', 'healthcheck']).optional() }).strict();

export async function triggerScheduleGroupRunAction(
  groupId: string,
  input: unknown,
): Promise<ActionResult<ManualRunResult>> {
  await requireServerAdminSession();

  const id = groupId.trim();
  if (!id) return actionError('Invalid groupId');

  let body: z.infer<typeof ManualRunBodySchema>;
  try {
    body = ManualRunBodySchema.parse(input ?? {});
  } catch {
    return actionError('Validation failed');
  }

  const requestedMode: GroupRunMode = body.mode ?? 'collect';

  const group = await prisma.scheduleGroup.findUnique({ where: { id }, select: { id: true } });
  if (!group) return actionError('Schedule group not found');

  try {
    type TxResult = {
      queued: number;
      skipped_active: number;
      skipped_missing_credential: number;
      skipped_missing_config: number;
      message: string;
    };

    const result = await prisma.$transaction(async (tx): Promise<TxResult> => {
      const sources = await tx.$queryRaw<
        Array<{ id: string; credentialId: string | null; sourceType: string; config: unknown }>
      >`
        SELECT id, "credentialId", "sourceType", config
        FROM "Source"
        WHERE "scheduleGroupId" = ${group.id}
          AND "deletedAt" IS NULL
          AND enabled = true
        FOR UPDATE SKIP LOCKED
      `;

      const skipped_missing_credential = sources.filter((s) => s.credentialId === null).length;
      const isCollectMode = requestedMode === 'collect';
      const skipped_missing_config = isCollectMode ? sources.filter((s) => !hasValidCollectConfig(s)).length : 0;

      const eligibleSources = sources.filter((s) => {
        if (s.credentialId === null) return false;
        if (isCollectMode) return hasValidCollectConfig(s);
        return true;
      });
      const eligibleSourceIds = eligibleSources.map((s) => s.id);

      if (eligibleSourceIds.length === 0) {
        return {
          queued: 0,
          skipped_active: 0,
          skipped_missing_credential,
          skipped_missing_config,
          message: 'no eligible sources',
        };
      }

      const active = await tx.run.findMany({
        where: { sourceId: { in: eligibleSourceIds }, status: { in: ['Queued', 'Running'] } },
        select: { sourceId: true, mode: true },
        distinct: ['sourceId', 'mode'],
      });
      const activeSet = new Set(active.map((r) => `${r.sourceId}:${r.mode}`));

      if (!isCollectMode) {
        const runs = eligibleSources
          .filter((s) => !activeSet.has(`${s.id}:${requestedMode}`))
          .map((s) => ({
            sourceId: s.id,
            scheduleGroupId: group.id,
            triggerType: 'manual' as const,
            mode: requestedMode,
            status: 'Queued' as const,
          }));

        if (runs.length > 0) await tx.run.createMany({ data: runs });

        const queued = runs.length;
        const wanted = eligibleSources.length;
        const skipped_active = Math.max(0, wanted - queued);
        const message =
          queued === 0
            ? skipped_active > 0
              ? 'all eligible sources have active runs'
              : 'no eligible sources'
            : 'queued';
        return { queued, skipped_active, skipped_missing_credential, skipped_missing_config, message };
      }

      const vcenterSources = eligibleSources.filter((s) => s.sourceType === 'vcenter');
      const otherSources = eligibleSources.filter((s) => s.sourceType !== 'vcenter');

      const hostRuns = vcenterSources
        .filter((s) => !activeSet.has(`${s.id}:collect_hosts`))
        .map((s) => ({
          sourceId: s.id,
          scheduleGroupId: group.id,
          triggerType: 'manual' as const,
          mode: 'collect_hosts' as const,
          status: 'Queued' as const,
        }));

      const vmRuns = vcenterSources
        .filter((s) => !activeSet.has(`${s.id}:collect_vms`))
        .map((s) => ({
          sourceId: s.id,
          scheduleGroupId: group.id,
          triggerType: 'manual' as const,
          mode: 'collect_vms' as const,
          status: 'Queued' as const,
        }));

      const collectRuns = otherSources
        .filter((s) => !activeSet.has(`${s.id}:collect`))
        .map((s) => ({
          sourceId: s.id,
          scheduleGroupId: group.id,
          triggerType: 'manual' as const,
          mode: 'collect' as const,
          status: 'Queued' as const,
        }));

      if (hostRuns.length > 0) await tx.run.createMany({ data: hostRuns });
      if (vmRuns.length > 0) await tx.run.createMany({ data: vmRuns });
      if (collectRuns.length > 0) await tx.run.createMany({ data: collectRuns });

      const queued = hostRuns.length + vmRuns.length + collectRuns.length;
      const wanted = vcenterSources.length * 2 + otherSources.length;
      const skipped_active = Math.max(0, wanted - queued);
      const message =
        queued === 0
          ? skipped_active > 0
            ? 'all eligible sources have active runs'
            : 'no eligible sources'
          : 'queued';
      return { queued, skipped_active, skipped_missing_credential, skipped_missing_config, message };
    });

    return actionOk(result);
  } catch (err) {
    return actionError(getActionErrorMessage(err, 'Failed to trigger run'));
  }
}
