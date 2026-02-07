import { ErrorCode } from '@/lib/errors/error-codes';

import type { AppError } from '@/lib/errors/error';
import type { Prisma, PrismaClient } from '@prisma/client';

type DirectoryDomainPayload = {
  domain_dn?: unknown;
  dns_root?: unknown;
  netbios_name?: unknown;
  object_guid?: unknown;
  raw_payload?: unknown;
};

type DirectoryUserPayload = {
  object_guid?: unknown;
  dn?: unknown;
  upn?: unknown;
  sam_account_name?: unknown;
  display_name?: unknown;
  mail?: unknown;
  enabled?: unknown;
  raw_payload?: unknown;
};

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function cleanBool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : null;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'enabled') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'disabled') return false;
  }
  return null;
}

function normalizeDomain(input: DirectoryDomainPayload): {
  domainDn: string | null;
  dnsRoot: string | null;
  netbiosName: string | null;
  objectGuid: string | null;
  raw: Prisma.InputJsonValue;
} {
  const domainDn = cleanString(input.domain_dn);
  const dnsRoot = cleanString(input.dns_root);
  const netbiosName = cleanString(input.netbios_name);
  const objectGuid = cleanString(input.object_guid);

  const raw =
    input.raw_payload !== undefined
      ? (input.raw_payload as Prisma.InputJsonValue)
      : ({
          domain_dn: domainDn,
          dns_root: dnsRoot,
          netbios_name: netbiosName,
          object_guid: objectGuid,
        } as Prisma.InputJsonValue);

  return { domainDn, dnsRoot, netbiosName, objectGuid, raw };
}

function normalizeUser(input: DirectoryUserPayload): {
  objectGuid: string | null;
  dn: string | null;
  upn: string | null;
  samAccountName: string | null;
  displayName: string | null;
  mail: string | null;
  enabled: boolean | null;
  profile: Prisma.InputJsonValue;
  raw: Prisma.InputJsonValue;
} {
  const objectGuid = cleanString(input.object_guid);
  const dn = cleanString(input.dn);
  const upn = cleanString(input.upn)?.toLowerCase() ?? null;
  const samAccountName = cleanString(input.sam_account_name);
  const displayName = cleanString(input.display_name);
  const mail = cleanString(input.mail);
  const enabled = cleanBool(input.enabled);

  const profile = {
    object_guid: objectGuid,
    dn,
    upn,
    sam_account_name: samAccountName,
    display_name: displayName,
    mail,
    enabled,
  } as Prisma.InputJsonValue;

  const raw = input.raw_payload !== undefined ? (input.raw_payload as Prisma.InputJsonValue) : profile;

  return { objectGuid, dn, upn, samAccountName, displayName, mail, enabled, profile, raw };
}

export async function ingestDirectoryRun(args: {
  prisma: PrismaClient;
  runId: string;
  sourceId: string;
  collectedAt: Date;
  domains: DirectoryDomainPayload[];
  users: DirectoryUserPayload[];
}): Promise<{ ingestedDomains: number; ingestedUsers: number; warnings: unknown[] }> {
  const warnings: unknown[] = [];

  try {
    const result = await args.prisma.$transaction(async (tx) => {
      let ingestedDomains = 0;
      let ingestedUsers = 0;

      for (const domainPayload of args.domains) {
        const domain = normalizeDomain(domainPayload);
        if (!domain.domainDn) {
          warnings.push({
            type: 'directory.domain.skipped',
            reason: 'domain_dn_missing',
          });
          continue;
        }

        await tx.directoryDomain.upsert({
          where: {
            sourceId_domainDn: {
              sourceId: args.sourceId,
              domainDn: domain.domainDn,
            },
          },
          update: {
            runId: args.runId,
            dnsRoot: domain.dnsRoot,
            netbiosName: domain.netbiosName,
            objectGuid: domain.objectGuid,
            raw: domain.raw,
            collectedAt: args.collectedAt,
          },
          create: {
            sourceId: args.sourceId,
            runId: args.runId,
            domainDn: domain.domainDn,
            dnsRoot: domain.dnsRoot,
            netbiosName: domain.netbiosName,
            objectGuid: domain.objectGuid,
            raw: domain.raw,
            collectedAt: args.collectedAt,
          },
        });

        ingestedDomains += 1;
      }

      for (const userPayload of args.users) {
        const user = normalizeUser(userPayload);
        const objectGuid = user.objectGuid ?? user.dn ?? user.upn;
        if (!objectGuid || !user.dn) {
          warnings.push({
            type: 'directory.user.skipped',
            reason: 'identifier_missing',
            object_guid: user.objectGuid,
            dn: user.dn,
            upn: user.upn,
          });
          continue;
        }

        const upserted = await tx.directoryUser.upsert({
          where: {
            sourceId_objectGuid: {
              sourceId: args.sourceId,
              objectGuid,
            },
          },
          update: {
            dn: user.dn,
            upn: user.upn,
            samAccountName: user.samAccountName,
            displayName: user.displayName,
            mail: user.mail,
            enabled: user.enabled,
            lastSeenAt: args.collectedAt,
          },
          create: {
            sourceId: args.sourceId,
            objectGuid,
            dn: user.dn,
            upn: user.upn,
            samAccountName: user.samAccountName,
            displayName: user.displayName,
            mail: user.mail,
            enabled: user.enabled,
            lastSeenAt: args.collectedAt,
          },
        });

        await tx.directoryUserSnapshot.create({
          data: {
            directoryUserId: upserted.id,
            sourceId: args.sourceId,
            runId: args.runId,
            profile: user.profile,
            raw: user.raw,
            collectedAt: args.collectedAt,
          },
        });

        ingestedUsers += 1;
      }

      return { ingestedDomains, ingestedUsers };
    });

    return { ...result, warnings };
  } catch (error) {
    throw {
      code: ErrorCode.DB_WRITE_FAILED,
      category: 'db',
      message: 'failed to ingest directory run',
      retryable: true,
      redacted_context: { cause: error instanceof Error ? error.message : String(error) },
    } satisfies AppError;
  }
}
