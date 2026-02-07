import { z } from 'zod/v4';

import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { fail, ok } from '@/lib/http/response';
import { isAdAuthOnlySource } from '@/lib/sources/ad-source';

const BodySchema = z
  .object({
    mode: z.enum(['collect', 'detect', 'healthcheck']).optional(),
  })
  .strict();

type RequestedMode = z.infer<typeof BodySchema>['mode'];

type TxResult = {
  queued: number;
  skipped_active: number;
  skipped_missing_credential: number;
  skipped_missing_config: number;
  message: string;
};

function hasVcenterPreferredVersion(config: unknown): boolean {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
  const value = (config as Record<string, unknown>).preferred_vcenter_version;
  return value === '6.5-6.7' || value === '7.0-8.x';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function hasExplicitCollectScope(config: unknown): boolean {
  if (!isRecord(config)) return false;
  const scope = (config as Record<string, unknown>).scope;
  return scope === 'standalone' || scope === 'cluster';
}

function getHypervConnectionMethod(config: unknown): 'agent' | 'winrm' {
  if (!isRecord(config)) return 'winrm';
  return (config as Record<string, unknown>).connection_method === 'agent' ? 'agent' : 'winrm';
}

function hasExplicitHypervAuthMethod(config: unknown): boolean {
  if (!isRecord(config)) return false;
  const auth = (config as Record<string, unknown>).auth_method;
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

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;

  // Back-compat: old UI sends empty body; default to collect.
  let requestedMode: RequestedMode = 'collect';
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const text = await request.text();
    if (text.trim().length > 0) {
      let raw: unknown;
      try {
        raw = JSON.parse(text) as unknown;
      } catch {
        return fail(
          {
            code: ErrorCode.CONFIG_INVALID_REQUEST,
            category: 'config',
            message: 'Validation failed',
            retryable: false,
          },
          400,
          { requestId: auth.requestId },
        );
      }

      const parsed = BodySchema.safeParse(raw);
      if (!parsed.success) {
        return fail(
          {
            code: ErrorCode.CONFIG_INVALID_REQUEST,
            category: 'config',
            message: 'Validation failed',
            retryable: false,
          },
          400,
          { requestId: auth.requestId },
        );
      }
      requestedMode = parsed.data.mode ?? 'collect';
    }
  }

  const group = await prisma.scheduleGroup.findUnique({ where: { id }, select: { id: true } });
  if (!group) {
    return fail(
      {
        code: ErrorCode.CONFIG_SCHEDULE_GROUP_NOT_FOUND,
        category: 'config',
        message: 'Schedule group not found',
        retryable: false,
      },
      404,
      { requestId: auth.requestId },
    );
  }

  const result = await prisma.$transaction(async (tx): Promise<TxResult> => {
    // Concurrency control: lock eligible sources in the group to avoid duplicate enqueue.
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

    // Create in order so hosts runs are likely processed before vm runs.
    if (hostRuns.length > 0) await tx.run.createMany({ data: hostRuns });
    if (vmRuns.length > 0) await tx.run.createMany({ data: vmRuns });
    if (collectRuns.length > 0) await tx.run.createMany({ data: collectRuns });

    const queued = hostRuns.length + vmRuns.length + collectRuns.length;
    const wanted = vcenterSources.length * 2 + otherSources.length;
    const skipped_active = Math.max(0, wanted - queued);

    const message =
      queued === 0 ? (skipped_active > 0 ? 'all eligible sources have active runs' : 'no eligible sources') : 'queued';

    return { queued, skipped_active, skipped_missing_credential, skipped_missing_config, message };
  });

  return ok(result, { requestId: auth.requestId });
}
