import {
  isAdAuthPurpose,
  readAdBaseDn,
  readAdPurpose,
  readAdServerUrl,
  readAdUpnSuffixes,
} from '@/lib/directory/ad-source-config';

import type { PrismaClient, SourceType } from '@prisma/client';

type ValidateInput = {
  prisma: PrismaClient;
  sourceType: SourceType;
  config: Record<string, unknown>;
  credentialId: string | null;
  excludeSourceId?: string;
};

type ValidateResult =
  | { ok: true; normalizedConfig: Record<string, unknown> }
  | {
      ok: false;
      message: string;
    };

function overlap(a: string[], b: string[]): string[] {
  const set = new Set(a);
  const conflicts: string[] = [];
  for (const item of b) {
    if (set.has(item)) conflicts.push(item);
  }
  return conflicts;
}

export async function validateAndNormalizeAdSourceConfig(input: ValidateInput): Promise<ValidateResult> {
  if (input.sourceType !== 'activedirectory') {
    return { ok: true, normalizedConfig: input.config };
  }

  const purpose = readAdPurpose(input.config);
  if (!purpose) {
    return { ok: false, message: 'purpose is required for activedirectory sources' };
  }

  const serverUrl = readAdServerUrl(input.config);
  if (!serverUrl) {
    return { ok: false, message: 'server_url is required for activedirectory sources' };
  }

  const baseDn = readAdBaseDn(input.config);
  if (!baseDn) {
    return { ok: false, message: 'base_dn is required for activedirectory sources' };
  }

  const upnSuffixes = readAdUpnSuffixes(input.config);
  if (isAdAuthPurpose(purpose)) {
    if (!input.credentialId) {
      return { ok: false, message: 'credentialId is required for activedirectory auth sources' };
    }
    if (upnSuffixes.length === 0) {
      return { ok: false, message: 'upn_suffixes is required for activedirectory auth sources' };
    }

    const others = await input.prisma.source.findMany({
      where: {
        sourceType: 'activedirectory',
        deletedAt: null,
        ...(input.excludeSourceId ? { NOT: { id: input.excludeSourceId } } : {}),
      },
      select: { id: true, config: true },
    });

    for (const other of others) {
      const otherPurpose = readAdPurpose(other.config);
      if (!otherPurpose || !isAdAuthPurpose(otherPurpose)) continue;

      const otherSuffixes = readAdUpnSuffixes(other.config);
      const conflicts = overlap(upnSuffixes, otherSuffixes);
      if (conflicts.length > 0) {
        return {
          ok: false,
          message: `upn_suffixes conflict with another auth source: ${conflicts.join(', ')}`,
        };
      }
    }
  }

  return {
    ok: true,
    normalizedConfig: {
      ...input.config,
      purpose,
      endpoint: serverUrl,
      server_url: serverUrl,
      base_dn: baseDn,
      upn_suffixes: upnSuffixes,
    },
  };
}

export function isAdAuthCollectSource(config: unknown): boolean {
  const purpose = readAdPurpose(config);
  return purpose === 'auth_collect';
}

export function isAdCollectOnlySource(config: unknown): boolean {
  const purpose = readAdPurpose(config);
  return purpose === 'collect_only';
}

export function isAdAuthOnlySource(config: unknown): boolean {
  const purpose = readAdPurpose(config);
  return purpose === 'auth_only';
}
